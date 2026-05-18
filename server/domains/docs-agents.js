// server/domains/docs-agents.js
//
// Docs Sprint C — page-bound agents (Notion Agents parity + the
// concord-native moat of publishing them as agent_spec DTUs so they
// flow into the marketplace).
//
// A page-bound agent is a saved system prompt + capability set
// scoped to a single document. `agent_run` invokes it with the
// current doc context. `agent_publish` mints an agent_spec DTU and
// fills in dtu_id on the row so subsequent runs surface a "published"
// badge + can flow into the marketplace via existing pipelines.

import { randomUUID } from "node:crypto";
import { withTimeout, stripFences, htmlToContext, recordAiRun, plainTextToHtml } from "../lib/docs/ai-compose.js";
import { hasRole, getDocument } from "../lib/docs/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

const VALID_SLOTS = new Set(["conscious","subconscious","utility","repair","multimodal"]);
const VALID_CAPS = new Set(["read_doc","read_comments","write_section","query_workspace","read_database","summarize"]);

export default function registerDocsAgentsMacros(register) {

  register("docs", "agent_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const documentId = String(input.documentId || "");
    if (!documentId) return { ok: false, reason: "documentId_required" };
    if (!hasRole(db, documentId, userId, "editor")) return { ok: false, reason: "forbidden" };
    const name = String(input.name || "").trim();
    const systemPrompt = String(input.systemPrompt || "").trim();
    if (!name || !systemPrompt) return { ok: false, reason: "name_and_systemPrompt_required" };
    const slot = VALID_SLOTS.has(input.slot) ? input.slot : "utility";
    const caps = Array.isArray(input.capabilities) ? input.capabilities.filter((c) => VALID_CAPS.has(c)) : ["read_doc"];
    const id = `pagent:${randomUUID()}`;
    db.prepare(`
      INSERT INTO doc_page_agents (id, document_id, owner_id, name, description, system_prompt, capabilities_json, slot, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, documentId, userId,
      name.slice(0, 120),
      input.description ? String(input.description).slice(0, 400) : null,
      systemPrompt.slice(0, 4000),
      JSON.stringify(caps), slot, _now(), _now());
    return { ok: true, id };
  }, { destructive: true, note: "Create a page-bound agent" });

  register("docs", "agent_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const row = db.prepare(`SELECT owner_id FROM doc_page_agents WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.owner_id !== userId) return { ok: false, reason: "forbidden" };
    const updates = [];
    const args = [];
    if (input.name !== undefined) { updates.push("name = ?"); args.push(String(input.name).slice(0, 120)); }
    if (input.description !== undefined) { updates.push("description = ?"); args.push(input.description ? String(input.description).slice(0, 400) : null); }
    if (input.systemPrompt !== undefined) { updates.push("system_prompt = ?"); args.push(String(input.systemPrompt).slice(0, 4000)); }
    if (input.capabilities !== undefined && Array.isArray(input.capabilities)) {
      updates.push("capabilities_json = ?");
      args.push(JSON.stringify(input.capabilities.filter((c) => VALID_CAPS.has(c))));
    }
    if (input.slot && VALID_SLOTS.has(input.slot)) { updates.push("slot = ?"); args.push(input.slot); }
    if (input.active !== undefined) { updates.push("active = ?"); args.push(input.active ? 1 : 0); }
    if (updates.length === 0) return { ok: false, reason: "nothing_to_update" };
    updates.push("updated_at = ?"); args.push(_now());
    args.push(id);
    db.prepare(`UPDATE doc_page_agents SET ${updates.join(", ")} WHERE id = ?`).run(...args);
    return { ok: true };
  }, { destructive: true, note: "Update a page-bound agent (owner only)" });

  register("docs", "agent_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const r = db.prepare(`DELETE FROM doc_page_agents WHERE id = ? AND owner_id = ?`).run(id, userId);
    return { ok: r.changes > 0, deleted: r.changes };
  }, { destructive: true, note: "Delete a page-bound agent" });

  register("docs", "agent_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const documentId = String(input.documentId || "");
    if (!documentId) return { ok: false, reason: "documentId_required" };
    if (!hasRole(db, documentId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const rows = db.prepare(`
      SELECT id, owner_id, name, description, slot, dtu_id, active, invocation_count, capabilities_json, created_at, updated_at
      FROM doc_page_agents WHERE document_id = ? ORDER BY updated_at DESC
    `).all(documentId);
    return {
      ok: true,
      agents: rows.map((r) => ({ ...r, capabilities: _safeJson(r.capabilities_json, []) })),
    };
  }, { note: "List page-bound agents for a document" });

  register("docs", "agent_run", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || input.agentId || "");
    if (!id) return { ok: false, reason: "agentId_required" };
    const agent = db.prepare(`SELECT * FROM doc_page_agents WHERE id = ?`).get(id);
    if (!agent) return { ok: false, reason: "not_found" };
    if (!agent.active) return { ok: false, reason: "agent_inactive" };
    if (!hasRole(db, agent.document_id, userId, "viewer")) return { ok: false, reason: "forbidden" };

    const llm = ctx?.llm;
    const t0 = Date.now();
    const caps = _safeJson(agent.capabilities_json, []);
    const userMsg = String(input.message || "").trim() || "Help with this document.";

    // Build context window per capabilities
    const ctxParts = [];
    if (caps.includes("read_doc")) {
      const doc = getDocument(db, agent.document_id);
      if (doc) ctxParts.push(`# Current document: ${doc.title}\n${htmlToContext(doc.content_html, 4000)}`);
    }
    if (caps.includes("read_comments")) {
      const cmt = db.prepare(`SELECT body, author_id FROM document_comments WHERE document_id = ? AND resolved = 0 LIMIT 30`).all(agent.document_id);
      if (cmt.length) ctxParts.push("# Open comments\n" + cmt.map((c) => `- [${c.author_id.slice(0, 8)}] ${c.body}`).join("\n"));
    }
    if (caps.includes("read_database")) {
      const dbases = db.prepare(`SELECT id, name, schema_json FROM doc_databases WHERE document_id = ?`).all(agent.document_id);
      for (const d of dbases) {
        const rows = db.prepare(`SELECT properties_json FROM doc_database_rows WHERE database_id = ? LIMIT 30`).all(d.id);
        ctxParts.push(`# Database: ${d.name}\n${rows.length} rows.\n${rows.slice(0, 8).map((r) => r.properties_json).join("\n")}`);
      }
    }

    if (!llm?.chat) {
      recordAiRun(db, { documentId: agent.document_id, userId, kind: "skill", skillId: agent.id, prompt: userMsg, response: "(brain offline)", source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: false, reason: "llm_unavailable" };
    }

    try {
      const r = await withTimeout(llm.chat({
        messages: [
          { role: "system", content: `${agent.system_prompt}\n\n--- Document context ---\n${ctxParts.join("\n\n---\n\n")}` },
          { role: "user", content: userMsg },
        ],
        temperature: 0.6, maxTokens: 1200, slot: agent.slot,
      }));
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const output = stripFences(raw).trim();
      db.prepare(`UPDATE doc_page_agents SET invocation_count = invocation_count + 1, updated_at = ? WHERE id = ?`).run(_now(), agent.id);
      recordAiRun(db, { documentId: agent.document_id, userId, kind: "skill", skillId: agent.id, prompt: userMsg, response: output, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, output, html: plainTextToHtml(output), agent: { id: agent.id, name: agent.name }, capabilities: caps, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Invoke a page-bound agent with the doc's context loaded per its capabilities" });

  register("docs", "agent_publish", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const agent = db.prepare(`SELECT * FROM doc_page_agents WHERE id = ?`).get(id);
    if (!agent) return { ok: false, reason: "not_found" };
    if (agent.owner_id !== userId) return { ok: false, reason: "forbidden" };
    if (agent.dtu_id) return { ok: true, dtuId: agent.dtu_id, alreadyPublished: true };

    const dtuId = `agent_spec:${randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
        VALUES (?, 'agent_spec', ?, ?, ?, unixepoch())
      `).run(dtuId, `Agent: ${agent.name}`, userId, JSON.stringify({
        type: "agent_spec",
        kind: "page_bound_agent",
        name: agent.name,
        description: agent.description,
        system_prompt: agent.system_prompt,
        capabilities: _safeJson(agent.capabilities_json, []),
        slot: agent.slot,
        published_from_doc: agent.document_id,
      }));
      db.prepare(`UPDATE doc_page_agents SET dtu_id = ?, updated_at = ? WHERE id = ?`).run(dtuId, _now(), id);
      return { ok: true, dtuId };
    } catch (err) {
      return { ok: false, reason: "publish_failed", error: err?.message };
    }
  }, { destructive: true, note: "Mint the agent as an agent_spec DTU (flows into marketplace)" });
}
