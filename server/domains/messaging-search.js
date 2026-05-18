// server/domains/messaging-search.js
//
// Message lens Sprint B #19 — workspace cross-channel semantic
// search. Reuses lib/code/embeddings.js (Sprint D Code) for real
// Ollama embeddings. Two macros:
//   search_messages   — substring + tokenised match (no LLM)
//   semantic_search   — Ollama embedding + cosine over indexed msgs
//
// Embeddings are lazy-built per message on first read; the
// `embed_message_batch` macro bulk-embeds N most recent messages
// across the caller's conversations.

import { embedText, persistEmbedding, semanticSearch } from "../lib/code/embeddings.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

export default function registerMessagingSearchMacros(register) {
  register("messaging", "search_messages", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const query = String(input.query || "").trim().toLowerCase();
    if (!query || query.length < 2) return { ok: false, reason: "query_too_short" };
    const limit = Math.min(100, Math.max(1, Number(input.limit) || 30));
    const terms = query.split(/\s+/).filter(Boolean);
    // SQL substring match across all conversations the caller participates in
    const rows = db.prepare(`
      SELECT m.id, m.conversation_id, m.author_id, m.body, m.server_ts
      FROM messages m
      JOIN conversation_participants p ON p.conversation_id = m.conversation_id
      WHERE p.user_id = ?
        AND m.deleted_at IS NULL
        AND m.body IS NOT NULL
        AND LOWER(m.body) LIKE ?
      ORDER BY m.server_ts DESC LIMIT ?
    `).all(userId, `%${terms[0]}%`, limit * 4);
    const hits = [];
    for (const r of rows) {
      const body = String(r.body || "").toLowerCase();
      let score = 0;
      for (const t of terms) if (body.includes(t)) score++;
      if (score === terms.length) hits.push({ ...r, score });
    }
    hits.sort((a, b) => b.score - a.score || b.server_ts - a.server_ts);
    return { ok: true, hits: hits.slice(0, limit), total: hits.length };
  }, { note: "Cross-channel substring search over messages the caller can see" });

  register("messaging", "embed_message", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const messageId = String(input.messageId || "");
    if (!messageId) return { ok: false, reason: "messageId_required" };
    const row = db.prepare(`SELECT body FROM messages WHERE id = ?`).get(messageId);
    if (!row || !row.body) return { ok: false, reason: "no_body" };
    const e = await embedText(row.body);
    if (!e.ok) return e;
    const p = persistEmbedding(db, {
      sourceType: "message", sourceId: messageId, model: e.model,
      vector: e.vector, textPreview: String(row.body).slice(0, 500),
    });
    if (!p.ok) return p;
    return { ok: true, id: p.id, model: e.model, dim: e.dim };
  }, { destructive: true, requiresLLM: true, note: "Embed a single message into the code_embeddings table (kind='message')" });

  register("messaging", "embed_message_batch", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const limit = Math.min(500, Math.max(1, Number(input.limit) || 100));
    // Pull caller's recent messages that don't have an embedding yet
    const rows = db.prepare(`
      SELECT m.id, m.body FROM messages m
      JOIN conversation_participants p ON p.conversation_id = m.conversation_id
      LEFT JOIN code_embeddings e ON e.source_type = 'message' AND e.source_id = m.id
      WHERE p.user_id = ?
        AND m.deleted_at IS NULL
        AND m.body IS NOT NULL AND length(m.body) > 0
        AND e.id IS NULL
      ORDER BY m.server_ts DESC LIMIT ?
    `).all(userId, limit);
    let embedded = 0, failed = 0;
    for (const r of rows) {
      const e = await embedText(r.body);
      if (!e.ok) { failed++; continue; }
      const w = persistEmbedding(db, {
        sourceType: "message", sourceId: r.id, model: e.model,
        vector: e.vector, textPreview: String(r.body).slice(0, 500),
      });
      if (w.ok) embedded++; else failed++;
    }
    return { ok: true, seen: rows.length, embedded, failed };
  }, { destructive: true, requiresLLM: true, note: "Bulk-embed up to N recent visible messages for semantic search" });

  register("messaging", "semantic_search", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const query = String(input.query || "").trim();
    if (!query) return { ok: false, reason: "query_required" };
    const e = await embedText(query);
    if (!e.ok) return e;
    const all = semanticSearch(db, {
      queryVector: e.vector, sourceType: "message", model: e.model,
      topK: Math.min(50, Number(input.topK) || 20),
      minScore: typeof input.minScore === "number" ? input.minScore : 0.0,
    });
    if (!all.ok) return all;
    // Filter to messages the caller can see (participant check)
    const ids = all.results.map((r) => r.source_id);
    if (ids.length === 0) return { ok: true, results: [], scanned: all.scanned };
    const visible = new Set(
      db.prepare(`
        SELECT m.id FROM messages m
        JOIN conversation_participants p ON p.conversation_id = m.conversation_id
        WHERE p.user_id = ? AND m.id IN (${ids.map(() => "?").join(",")})
      `).all(userId, ...ids).map((r) => r.id),
    );
    const visibleResults = all.results.filter((r) => visible.has(r.source_id));
    return { ok: true, results: visibleResults, scanned: all.scanned, dim: all.dim };
  }, { requiresLLM: true, note: "Embed the query and cosine-search the user's message corpus (semantic)" });
}
