// server/domains/chat-moats.js
//
// Chat lens Sprint C — concord-native moats.
//
//   1. Mint chat session as chat_session DTU + royalty cascade
//   2. Cross-lens cite cascade from chat
//   3. Persona marketplace (publish persona as agent_spec DTU)
//   4. 5-brain council mode (multi-brain debate)
//   5. Public chat links (Calendly-style read-only share)
//   6. Conversation export (md/json)

import { randomUUID } from "node:crypto";
import { getPersona, bumpPersonaUsage } from "../lib/chat/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

const VALID_VIS = new Set(["private","workspace","public","published","global"]);

export default function registerChatMoatsMacros(register) {

  // ─── Mint chat session as DTU ──────────────────────────────────

  register("chat", "session_mint", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const sessionId = String(input.sessionId || "");
    if (!sessionId) return { ok: false, reason: "sessionId_required" };
    // Verify ownership via chat_sessions (migration 193)
    const session = db.prepare(`SELECT user_id, title FROM chat_sessions WHERE id = ?`).get(sessionId);
    if (!session) return { ok: false, reason: "not_found" };
    if (session.user_id !== userId) return { ok: false, reason: "forbidden" };
    // Idempotent
    const existing = db.prepare(`SELECT * FROM chat_session_mints WHERE session_id = ?`).get(sessionId);
    if (existing) return { ok: true, dtuId: existing.dtu_id, alreadyMinted: true };
    const visibility = VALID_VIS.has(input.visibility) ? input.visibility : "workspace";
    const royaltyRate = typeof input.royaltyRate === "number" ? Math.max(0, Math.min(0.30, input.royaltyRate)) : 0.21;
    const dtuId = `chat_session:${randomUUID()}`;
    try {
      const tx = db.transaction(() => {
        db.prepare(`
          INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
          VALUES (?, 'chat_session', ?, ?, ?, unixepoch())
        `).run(dtuId, session.title || "Chat session", userId, JSON.stringify({
          type: "chat_session", session_id: sessionId,
          royalty_rate: royaltyRate, visibility,
        }));
        db.prepare(`
          INSERT INTO chat_session_mints (session_id, dtu_id, creator_id, royalty_rate, visibility, allow_citation, minted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(sessionId, dtuId, userId, royaltyRate, visibility, input.allowCitation === false ? 0 : 1, _now());
      });
      tx();
      return { ok: true, dtuId, royaltyRate, visibility };
    } catch (err) {
      return { ok: false, reason: "mint_failed", error: err?.message };
    }
  }, { destructive: true, note: "Mint a chat session as a citable chat_session DTU" });

  register("chat", "session_mint_status", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const m = db.prepare(`SELECT * FROM chat_session_mints WHERE session_id = ?`).get(String(input.sessionId || ""));
    return { ok: true, minted: !!m, mint: m || null };
  }, { note: "Check whether a chat session is minted" });

  register("chat", "session_cite_dtu", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const sessionId = String(input.sessionId || "");
    const parentDtuId = String(input.dtuId || input.parentDtuId || "");
    if (!sessionId || !parentDtuId) return { ok: false, reason: "sessionId_and_dtuId_required" };
    const mint = db.prepare(`SELECT dtu_id, creator_id FROM chat_session_mints WHERE session_id = ?`).get(sessionId);
    if (!mint) return { ok: false, reason: "session_not_minted_yet" };
    if (mint.creator_id !== userId) return { ok: false, reason: "forbidden" };
    const parentDtu = db.prepare(`SELECT id, creator_id, kind, meta_json FROM dtus WHERE id = ?`).get(parentDtuId);
    if (!parentDtu) return { ok: false, reason: "parent_dtu_not_found" };
    try {
      const { registerCitation } = await import("../economy/royalty-cascade.js");
      const r = registerCitation(db, {
        childId: mint.dtu_id, parentId: parentDtu.id,
        creatorId: mint.creator_id, parentCreatorId: parentDtu.creator_id,
        parentDtu, hasPurchasedLicense: !!input.hasPurchasedLicense, generation: 1,
      });
      if (!r.ok) return r;
      db.prepare(`UPDATE chat_session_mints SET citation_count = citation_count + 1 WHERE session_id = ?`).run(sessionId);
      return { ok: true, childDtuId: mint.dtu_id, parentDtuId, cascade: r };
    } catch (err) {
      return { ok: true, childDtuId: mint.dtu_id, parentDtuId, cascade: { ok: false, reason: "engine_unavailable", error: err?.message } };
    }
  }, { destructive: true, note: "Chat session cites a cross-lens DTU (fires royalty cascade)" });

  // ─── Persona marketplace ────────────────────────────────────────

  register("chat", "persona_publish", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const personaId = String(input.id || input.personaId || "");
    const persona = getPersona(db, personaId);
    if (!persona) return { ok: false, reason: "not_found" };
    if (persona.owner_id !== userId) return { ok: false, reason: "forbidden" };
    const existing = db.prepare(`SELECT * FROM chat_persona_mints WHERE persona_id = ?`).get(personaId);
    if (existing) return { ok: true, dtuId: existing.dtu_id, alreadyPublished: true };
    const royaltyRate = typeof input.royaltyRate === "number" ? Math.max(0, Math.min(0.30, input.royaltyRate)) : 0.21;
    const visibility = VALID_VIS.has(input.visibility) ? input.visibility : "public";
    const dtuId = `agent_spec:${randomUUID()}`;
    try {
      const tx = db.transaction(() => {
        db.prepare(`
          INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
          VALUES (?, 'agent_spec', ?, ?, ?, unixepoch())
        `).run(dtuId, `Persona: ${persona.name}`, userId, JSON.stringify({
          type: "agent_spec", kind: "chat_persona",
          name: persona.name, description: persona.description,
          system_prompt: persona.system_prompt,
          brain_slot: persona.brain_slot,
          style_vector: persona.style_vector,
          tool_allowlist: persona.tool_allowlist,
          royalty_rate: royaltyRate,
        }));
        db.prepare(`
          INSERT INTO chat_persona_mints (persona_id, dtu_id, creator_id, royalty_rate, visibility, minted_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(personaId, dtuId, userId, royaltyRate, visibility, _now());
        db.prepare(`UPDATE chat_personas SET dtu_id = ?, visibility = ?, updated_at = ? WHERE id = ?`).run(dtuId, visibility, _now(), personaId);
      });
      tx();
      return { ok: true, dtuId, royaltyRate, visibility };
    } catch (err) {
      return { ok: false, reason: "publish_failed", error: err?.message };
    }
  }, { destructive: true, note: "Publish a persona as an agent_spec DTU (marketplace)" });

  register("chat", "persona_install", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    // Install another user's published persona as my own copy
    const sourceId = String(input.personaId || "");
    const source = getPersona(db, sourceId);
    if (!source) return { ok: false, reason: "not_found" };
    if (source.visibility === "private") return { ok: false, reason: "not_published" };
    const newId = `persona:${randomUUID()}`;
    db.prepare(`
      INSERT INTO chat_personas (id, owner_id, name, description, icon, system_prompt, brain_slot, style_vector_json, tool_allowlist_json, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'private', unixepoch(), unixepoch())
    `).run(newId, userId,
      source.name, source.description, source.icon,
      source.system_prompt, source.brain_slot,
      source.style_vector ? JSON.stringify(source.style_vector) : null,
      source.tool_allowlist ? JSON.stringify(source.tool_allowlist) : null);
    bumpPersonaUsage(db, sourceId);
    db.prepare(`UPDATE chat_persona_mints SET install_count = install_count + 1 WHERE persona_id = ?`).run(sourceId);
    return { ok: true, newPersonaId: newId, source: sourceId };
  }, { destructive: true, note: "Install a marketplace persona as my own copy" });

  // ─── 5-brain council mode ──────────────────────────────────────

  register("chat", "council_start", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const question = String(input.question || "").trim();
    if (!question) return { ok: false, reason: "question_required" };
    const brains = Array.isArray(input.brains) && input.brains.length > 0
      ? input.brains.filter((b) => ["conscious","subconscious","utility","repair","multimodal"].includes(b))
      : ["conscious", "subconscious", "utility"];
    const id = `chcouncil:${randomUUID()}`;
    db.prepare(`
      INSERT INTO chat_council_runs (id, session_id, user_id, question, brains_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, input.sessionId || null, userId, question.slice(0, 4000), JSON.stringify(brains), _now());
    return { ok: true, id, brains };
  }, { destructive: true, note: "Start a 5-brain council debate; collection happens in caller code" });

  register("chat", "council_record_response", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    const run = db.prepare(`SELECT * FROM chat_council_runs WHERE id = ?`).get(id);
    if (!run) return { ok: false, reason: "not_found" };
    if (run.user_id !== userId) return { ok: false, reason: "forbidden" };
    const brainSlot = String(input.brainSlot || "");
    const response = String(input.response || "");
    const tokens = Number(input.tokens) || 0;
    const responses = _safeJson(run.responses_json, {});
    responses[brainSlot] = { response, tokens, at: _now() };
    const brains = _safeJson(run.brains_json, []);
    const allCollected = brains.every((b) => responses[b]);
    db.prepare(`
      UPDATE chat_council_runs
      SET responses_json = ?, status = ?, tokens = tokens + ?
      WHERE id = ?
    `).run(JSON.stringify(responses),
      allCollected ? "synthesizing" : "collecting",
      tokens, id);
    return { ok: true, collectedCount: Object.keys(responses).length, allCollected };
  }, { destructive: true, note: "Record one brain's response to the council question" });

  register("chat", "council_synthesize", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    const run = db.prepare(`SELECT * FROM chat_council_runs WHERE id = ?`).get(id);
    if (!run) return { ok: false, reason: "not_found" };
    if (run.user_id !== userId) return { ok: false, reason: "forbidden" };
    const synthesis = String(input.synthesis || "").trim();
    if (!synthesis) return { ok: false, reason: "synthesis_required" };
    db.prepare(`UPDATE chat_council_runs SET synthesis = ?, status = 'complete', completed_at = ? WHERE id = ?`)
      .run(synthesis.slice(0, 16_000), _now(), id);
    return { ok: true };
  }, { destructive: true, note: "Record the final synthesized answer for a council run" });

  register("chat", "council_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const run = db.prepare(`SELECT * FROM chat_council_runs WHERE id = ?`).get(String(input.id || ""));
    if (!run) return { ok: false, reason: "not_found" };
    if (run.user_id !== userId) return { ok: false, reason: "forbidden" };
    return {
      ok: true,
      run: {
        ...run,
        brains: _safeJson(run.brains_json, []),
        responses: _safeJson(run.responses_json, {}),
      },
    };
  }, { note: "Get a council run with all collected responses + synthesis" });

  // ─── Public links ──────────────────────────────────────────────

  register("chat", "public_link_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const sessionId = String(input.sessionId || "");
    if (!sessionId) return { ok: false, reason: "sessionId_required" };
    const session = db.prepare(`SELECT user_id, title FROM chat_sessions WHERE id = ?`).get(sessionId);
    if (!session) return { ok: false, reason: "not_found" };
    if (session.user_id !== userId) return { ok: false, reason: "forbidden" };
    const id = randomUUID().replace(/-/g, "").slice(0, 22);
    const expiresAt = input.expiresInHours ? _now() + Number(input.expiresInHours) * 3600 : null;
    db.prepare(`
      INSERT INTO chat_public_links (id, session_id, owner_id, title, visibility, expires_at, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(id, sessionId, userId,
      input.title ? String(input.title).slice(0, 200) : session.title,
      ["read_only","readable_branchable"].includes(input.visibility) ? input.visibility : "read_only",
      expiresAt, _now());
    return { ok: true, slug: id };
  }, { destructive: true, note: "Create a public read-only link for a chat session" });

  register("chat", "public_link_get", async (_ctx, input = {}) => {
    const db = _resolveDb(_ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const slug = String(input.slug || "");
    if (!slug) return { ok: false, reason: "slug_required" };
    const link = db.prepare(`SELECT * FROM chat_public_links WHERE id = ? AND active = 1`).get(slug);
    if (!link) return { ok: false, reason: "not_found" };
    if (link.expires_at && link.expires_at < _now()) return { ok: false, reason: "expired" };
    // Pull the session + messages
    const session = db.prepare(`SELECT id, title, created_at, updated_at FROM chat_sessions WHERE id = ?`).get(link.session_id);
    const messages = db.prepare(`SELECT role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at`).all(link.session_id);
    db.prepare(`UPDATE chat_public_links SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?`).run(_now(), slug);
    return { ok: true, link: { ...link, session, messages } };
  }, { note: "Public-read a shared chat session by slug (no auth needed)" });

  register("chat", "public_link_list", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, links: db.prepare(`SELECT * FROM chat_public_links WHERE owner_id = ? ORDER BY created_at DESC`).all(userId) };
  }, { note: "List my public chat links" });

  register("chat", "public_link_revoke", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = db.prepare(`UPDATE chat_public_links SET active = 0 WHERE id = ? AND owner_id = ?`).run(String(input.slug), userId);
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Revoke a public link" });

  // ─── Conversation export ───────────────────────────────────────

  register("chat", "session_export", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const sessionId = String(input.sessionId || "");
    const session = db.prepare(`SELECT id, user_id, title, created_at, updated_at FROM chat_sessions WHERE id = ?`).get(sessionId);
    if (!session) return { ok: false, reason: "not_found" };
    if (session.user_id !== userId) return { ok: false, reason: "forbidden" };
    const messages = db.prepare(`SELECT role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at`).all(sessionId);
    const format = ["md","json"].includes(input.format) ? input.format : "md";
    if (format === "json") {
      return { ok: true, format: "json", data: { session, messages }, filename: `chat-${sessionId.slice(0, 8)}.json` };
    }
    const md = [
      `# ${session.title || "Chat session"}`,
      ``,
      `_${new Date(session.created_at * 1000).toISOString()}_`,
      ``,
      ...messages.map((m) => `**${m.role}:** ${m.content}\n`),
    ].join("\n");
    return { ok: true, format: "md", data: md, filename: `chat-${sessionId.slice(0, 8)}.md` };
  }, { note: "Export a chat session as markdown or JSON" });
}
