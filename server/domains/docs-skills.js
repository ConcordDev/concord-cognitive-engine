// server/domains/docs-skills.js
//
// Docs Sprint B item #6 — Custom AI Skills.
//
// The Notion 3.4 flagship: save a workflow ("draft weekly update in
// our team's format") as a named, reusable button. CRUD here +
// `skill_run` macro that re-templates the saved prompt against the
// current document body, then routes through the brain like
// ai_inline_edit.

import { randomUUID } from "node:crypto";
import { withTimeout, stripFences, htmlToContext, recordAiRun, plainTextToHtml } from "../lib/docs/ai-compose.js";
import { hasRole, getDocument } from "../lib/docs/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }

const VALID_KINDS = new Set(["rewrite", "compose", "analyze", "format", "custom"]);
const VALID_VIS = new Set(["private", "workspace", "public"]);

export default function registerDocsSkillsMacros(register) {

  register("docs", "skill_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const name = String(input.name || "").trim();
    const prompt = String(input.prompt || "").trim();
    if (!name) return { ok: false, reason: "name_required" };
    if (!prompt) return { ok: false, reason: "prompt_required" };
    const kind = VALID_KINDS.has(input.kind) ? input.kind : "custom";
    const visibility = VALID_VIS.has(input.visibility) ? input.visibility : "private";
    const id = `skill:${randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO doc_skills (id, owner_id, name, description, prompt, kind, visibility, example_input, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, userId, name.slice(0, 120),
        input.description ? String(input.description).slice(0, 600) : null,
        prompt.slice(0, 4000),
        kind, visibility,
        input.exampleInput ? String(input.exampleInput).slice(0, 1000) : null,
        _now(), _now(),
      );
      return { ok: true, id };
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Save a Custom AI Skill (Notion 3.4-style reusable workflow)" });

  register("docs", "skill_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const row = db.prepare(`SELECT owner_id FROM doc_skills WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.owner_id !== userId) return { ok: false, reason: "forbidden" };
    const fields = [];
    const args = [];
    if (input.name !== undefined) { fields.push("name = ?"); args.push(String(input.name).slice(0, 120)); }
    if (input.description !== undefined) { fields.push("description = ?"); args.push(input.description ? String(input.description).slice(0, 600) : null); }
    if (input.prompt !== undefined) { fields.push("prompt = ?"); args.push(String(input.prompt).slice(0, 4000)); }
    if (input.kind !== undefined && VALID_KINDS.has(input.kind)) { fields.push("kind = ?"); args.push(input.kind); }
    if (input.visibility !== undefined && VALID_VIS.has(input.visibility)) { fields.push("visibility = ?"); args.push(input.visibility); }
    if (input.exampleInput !== undefined) { fields.push("example_input = ?"); args.push(input.exampleInput ? String(input.exampleInput).slice(0, 1000) : null); }
    if (fields.length === 0) return { ok: false, reason: "nothing_to_update" };
    fields.push("updated_at = ?"); args.push(_now());
    args.push(id);
    db.prepare(`UPDATE doc_skills SET ${fields.join(", ")} WHERE id = ?`).run(...args);
    return { ok: true };
  }, { destructive: true, note: "Update a Custom AI Skill (owner only)" });

  register("docs", "skill_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const r = db.prepare(`DELETE FROM doc_skills WHERE id = ? AND owner_id = ?`).run(id, userId);
    return { ok: r.changes > 0, deleted: r.changes };
  }, { destructive: true, note: "Delete a Custom AI Skill (owner only)" });

  register("docs", "skill_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    // Mine + workspace-visible + public
    const rows = db.prepare(`
      SELECT id, owner_id, name, description, kind, visibility, run_count, created_at, updated_at
      FROM doc_skills
      WHERE owner_id = ? OR visibility IN ('workspace','public')
      ORDER BY (owner_id = ?) DESC, updated_at DESC
      LIMIT ?
    `).all(userId, userId, Math.min(Number(input.limit) || 100, 200));
    return { ok: true, skills: rows };
  }, { note: "List my skills + workspace/public skills" });

  register("docs", "skill_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const row = db.prepare(`SELECT * FROM doc_skills WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.owner_id !== userId && row.visibility === "private") return { ok: false, reason: "forbidden" };
    return { ok: true, skill: row };
  }, { note: "Get a single skill by id" });

  register("docs", "skill_run", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const skillId = String(input.id || input.skillId || "");
    if (!skillId) return { ok: false, reason: "skill_id_required" };
    const skill = db.prepare(`SELECT * FROM doc_skills WHERE id = ?`).get(skillId);
    if (!skill) return { ok: false, reason: "skill_not_found" };
    if (skill.owner_id !== userId && skill.visibility === "private") return { ok: false, reason: "forbidden" };

    const documentId = input.documentId ? String(input.documentId) : null;
    if (documentId && !hasRole(db, documentId, userId, "editor")) return { ok: false, reason: "forbidden" };

    // Template substitution: {{doc}} → current doc text, {{selection}} → user selection,
    // {{input}} → arbitrary user-supplied string.
    let prompt = skill.prompt;
    const docText = documentId ? htmlToContext(getDocument(db, documentId)?.content_html || "", 4000) : "";
    const selectionText = String(input.selection || "");
    const userInput = String(input.input || "");
    prompt = prompt.replace(/\{\{doc\}\}/g, docText)
      .replace(/\{\{selection\}\}/g, selectionText)
      .replace(/\{\{input\}\}/g, userInput);

    const llm = ctx?.llm;
    const t0 = Date.now();
    if (!llm?.chat) {
      recordAiRun(db, { documentId, userId, kind: "skill", skillId, prompt: skill.name, response: "(brain offline)", source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: false, reason: "llm_unavailable" };
    }

    const sys = `You execute a Custom AI Skill named "${skill.name}". The user's saved instructions follow. Output ONLY the result the user expects — no preamble or meta commentary.`;
    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: prompt }],
        temperature: skill.kind === "analyze" ? 0.3 : 0.6,
        maxTokens: skill.kind === "compose" ? 1600 : 900,
        slot: skill.kind === "compose" ? "subconscious" : "utility",
      }));
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const output = stripFences(raw).trim();
      // bump run_count + record
      db.prepare(`UPDATE doc_skills SET run_count = run_count + 1, updated_at = ? WHERE id = ?`).run(_now(), skillId);
      recordAiRun(db, { documentId, userId, kind: "skill", skillId, prompt: skill.name, selectionText, response: output, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, output, html: plainTextToHtml(output), skill: { id: skill.id, name: skill.name, kind: skill.kind }, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Run a Custom AI Skill against the current doc/selection (templates {{doc}}, {{selection}}, {{input}})" });

  register("docs", "ai_runs_recent", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const documentId = input.documentId ? String(input.documentId) : null;
    const sql = documentId
      ? `SELECT id, document_id, kind, skill_id, prompt, source, latency_ms, created_at
         FROM doc_ai_runs WHERE user_id = ? AND document_id = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT id, document_id, kind, skill_id, prompt, source, latency_ms, created_at
         FROM doc_ai_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`;
    const args = documentId ? [userId, documentId, Math.min(Number(input.limit) || 50, 200)]
                            : [userId, Math.min(Number(input.limit) || 50, 200)];
    return { ok: true, runs: db.prepare(sql).all(...args) };
  }, { note: "Recent AI runs (audit + provenance trail)" });
}
