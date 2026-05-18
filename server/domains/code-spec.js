// server/domains/code-spec.js
//
// Code Sprint C Item #10 — spec-driven development.
//
// GitHub Spec Kit reached 90k stars in 2 months; the pattern is
// becoming the 2026 standard. We add the substrate:
//   spec → plan → code (→ tests)
// Each step mints a citable DTU. Specs published by experienced
// devs earn royalties forever when others cite the spec in their
// implementation; the cascade halves per generation (21%/halving
// per royalty-cascade.js) but persists 50 deep.

import { randomUUID } from "node:crypto";

const TIMEOUT_MS = 25_000;

function _runMacro(ctx, domain, name, input) {
  if (typeof ctx?.runMacro === "function") return ctx.runMacro(domain, name, input);
  if (typeof globalThis._concordRunMacro === "function") {
    return globalThis._concordRunMacro(domain, name, input, ctx);
  }
  throw new Error("no_macro_dispatcher");
}

async function _registerCascadeCitation(db, childId, parentId, childCreatorId) {
  if (!db || !childId || !parentId || !childCreatorId) return false;
  try {
    const { registerCitation } = await import("../economy/royalty-cascade.js");
    // Look up parent creator from dtus so the cascade lineage is real.
    const parent = db.prepare("SELECT creator_id FROM dtus WHERE id = ?").get(parentId);
    if (!parent?.creator_id) return false;
    const r = registerCitation(db, {
      childId, parentId,
      creatorId: childCreatorId,
      parentCreatorId: parent.creator_id,
      parentDtu: { visibility: "public" },
    });
    return !!r?.ok;
  } catch {
    return false;
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout_${ms}ms`)), ms)),
  ]);
}

export default function registerCodeSpecMacros(register) {
  register("code", "spec_create", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const title = String(input.title || "").trim();
    if (!title) return { ok: false, reason: "title_required" };
    const requirements = Array.isArray(input.requirements)
      ? input.requirements.map(String).filter(Boolean)
      : (typeof input.requirements === "string" ? input.requirements.split("\n").map((s) => s.trim()).filter(Boolean) : []);
    if (requirements.length === 0 && !input.body) return { ok: false, reason: "requirements_or_body_required" };
    const body = String(input.body || "").trim() || requirements.map((r, i) => `${i + 1}. ${r}`).join("\n");
    const id = `code_spec:${randomUUID()}`;
    const meta = {
      type: "code_spec",
      title, requirements, body,
      visibility: input.visibility || "personal",
      consent: { allowCitations: true },
      projectPath: input.projectPath || null,
    };
    try {
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
        VALUES (?, 'code_spec', ?, ?, ?, 1, 0, unixepoch())
      `).run(id, title.slice(0, 200), userId, JSON.stringify(meta));
      return { ok: true, specDtuId: id, title, requirementsCount: requirements.length };
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Mint a kind='code_spec' DTU; first step of the spec→plan→code chain" });

  register("code", "spec_to_plan", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    const llm = ctx?.llm;
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const specDtuId = String(input.specDtuId || "").trim();
    if (!specDtuId) return { ok: false, reason: "spec_dtu_id_required" };
    const specRow = db.prepare("SELECT * FROM dtus WHERE id = ? AND kind = 'code_spec'").get(specDtuId);
    if (!specRow) return { ok: false, reason: "spec_not_found" };
    let specMeta = {};
    try { specMeta = JSON.parse(specRow.meta_json || "{}"); } catch { /* tolerate */ }
    if (!llm?.chat) return { ok: false, reason: "llm_unavailable" };
    const sys = `You are a senior software architect translating a spec into a concrete implementation plan.
Output a JSON object: { "summary": "1-2 sentence high-level approach", "milestones": [{"title": "...", "steps": ["...", "..."]}, ...] }.
Cover only what's actually requested in the spec. Plain JSON. No prose around it.`;
    const user = `Spec title: ${specRow.title}\n\nSpec body:\n${specMeta.body || ""}\n\nProduce the plan JSON.`;
    let raw = "";
    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        temperature: 0.2, maxTokens: 2048, slot: input.architectBrain || "conscious",
      }), TIMEOUT_MS);
      raw = String(r?.text || r?.content || r?.message?.content || "");
    } catch (err) {
      return { ok: false, reason: "llm_error", error: err?.message };
    }
    let parsed = null;
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) { try { parsed = JSON.parse(match[0]); } catch { /* parse fail */ } }
    if (!parsed || !Array.isArray(parsed.milestones)) {
      return { ok: false, reason: "plan_parse_failed", raw: raw.slice(0, 500) };
    }
    const planId = `code_plan:${randomUUID()}`;
    const planMeta = {
      type: "code_plan",
      specDtuId, specTitle: specRow.title,
      summary: parsed.summary, milestones: parsed.milestones,
      visibility: input.visibility || "personal",
      consent: { allowCitations: true },
    };
    try {
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
        VALUES (?, 'code_plan', ?, ?, ?, 1, 0, unixepoch())
      `).run(planId, `Plan for ${specRow.title}`.slice(0, 200), userId, JSON.stringify(planMeta));
      // First link in the chain: plan cites spec.
      await _registerCascadeCitation(db, planId, specDtuId, userId);
      return { ok: true, planDtuId: planId, specDtuId, summary: parsed.summary, milestoneCount: parsed.milestones.length };
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, requiresLLM: true, note: "Convert spec → kind='code_plan' DTU; cites the spec" });

  register("code", "plan_to_code", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const planDtuId = String(input.planDtuId || "").trim();
    if (!planDtuId) return { ok: false, reason: "plan_dtu_id_required" };
    const projectPath = String(input.projectPath || input.project_path || "");
    if (!projectPath) return { ok: false, reason: "project_path_required" };
    const planRow = db.prepare("SELECT * FROM dtus WHERE id = ? AND kind = 'code_plan'").get(planDtuId);
    if (!planRow) return { ok: false, reason: "plan_not_found" };
    let planMeta = {};
    try { planMeta = JSON.parse(planRow.meta_json || "{}"); } catch { /* tolerate */ }
    const milestoneText = (planMeta.milestones || []).map((m, i) => `${i + 1}. ${m.title}\n   ${(m.steps || []).join("\n   ")}`).join("\n\n");
    const task = `Implement this plan:\n\n${planMeta.summary || ""}\n\n${milestoneText}`;
    // Real dispatch to the agent loop.
    const result = await _runMacro(ctx, "code", "agent_loop", {
      task,
      files: input.files || [],
      projectPath,
      runner: input.runner || "npm",
      runnerArgs: input.runnerArgs || ["test"],
      maxIterations: Number(input.maxIterations) || 5,
      architectBrain: input.architectBrain || "conscious",
      editorBrain: input.editorBrain || "utility",
    });
    if (!result?.ok) return result;
    // Cite plan from the session DTU.
    if (result.sessionId) {
      await _registerCascadeCitation(db, result.sessionId, planDtuId, userId);
    }
    return { ok: true, ...result, planDtuId };
  }, { destructive: true, requiresLLM: true, note: "Run agent loop driven by a kind='code_plan'; the session DTU cites the plan, which cites the spec" });

  register("code", "spec_get", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const id = String(input.id || "").trim();
    if (!id) return { ok: false, reason: "id_required" };
    const row = db.prepare("SELECT * FROM dtus WHERE id = ? AND kind IN ('code_spec','code_plan','code_agent_session')").get(id);
    if (!row) return { ok: false, reason: "not_found" };
    let meta = {};
    try { meta = JSON.parse(row.meta_json || "{}"); } catch { /* ok */ }
    return { ok: true, dtu: { ...row, meta } };
  }, { note: "Fetch a spec / plan / agent-session DTU by id" });

  register("code", "spec_list", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    const kind = String(input.kind || "code_spec");
    if (!["code_spec", "code_plan", "code_agent_session"].includes(kind)) {
      return { ok: false, reason: "invalid_kind" };
    }
    const limit = Math.min(100, Number(input.limit) || 50);
    const rows = userId
      ? db.prepare(`SELECT id, title, created_at, meta_json FROM dtus WHERE kind = ? AND creator_id = ? ORDER BY created_at DESC LIMIT ?`).all(kind, userId, limit)
      : db.prepare(`SELECT id, title, created_at, meta_json FROM dtus WHERE kind = ? ORDER BY created_at DESC LIMIT ?`).all(kind, limit);
    return { ok: true, items: rows };
  }, { note: "List the user's specs / plans / sessions" });
}
