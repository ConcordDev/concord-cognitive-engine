// server/domains/code-embeddings.js
//
// Code Sprint D — semantic search macros.

import { embedText, persistEmbedding, semanticSearch } from "../lib/code/embeddings.js";

export default function registerCodeEmbeddingMacros(register) {
  register("code", "embed_text", async (_ctx, input = {}) => {
    return embedText(String(input.text || ""), { model: input.model, url: input.url });
  }, { requiresLLM: true, note: "Real Ollama /api/embeddings call (defaults to nomic-embed-text)" });

  register("code", "embed_pattern", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const sourceType = String(input.sourceType || "code_pattern");
    const sourceId = String(input.sourceId || "");
    const text = String(input.text || "");
    if (!sourceId) return { ok: false, reason: "sourceId_required" };
    if (!text) return { ok: false, reason: "text_required" };
    const e = await embedText(text, { model: input.model });
    if (!e.ok) return e;
    const p = persistEmbedding(db, {
      sourceType, sourceId, model: e.model, vector: e.vector, textPreview: text,
    });
    if (!p.ok) return p;
    return { ok: true, id: p.id, model: e.model, dim: e.dim };
  }, { destructive: true, requiresLLM: true, note: "Embed + persist an arbitrary source (pattern / spec / skill / etc.)" });

  register("code", "embed_all_patterns", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const limit = Math.min(500, Number(input.limit) || 100);
    const model = String(input.model || "");
    let patterns;
    try {
      patterns = db.prepare(`
        SELECT id, name, description, language, code_snippet FROM code_patterns
        ORDER BY created_at DESC LIMIT ?
      `).all(limit);
    } catch (err) {
      return { ok: false, reason: "no_code_patterns_table", error: err?.message };
    }
    let embedded = 0, failed = 0;
    for (const p of patterns) {
      const text = `${p.name}\n${p.description || ""}\n${p.code_snippet || ""}`;
      const e = await embedText(text, { model: model || undefined });
      if (!e.ok) { failed++; continue; }
      const w = persistEmbedding(db, {
        sourceType: "code_pattern", sourceId: p.id, model: e.model,
        vector: e.vector, textPreview: text,
      });
      if (w.ok) embedded++; else failed++;
    }
    return { ok: true, totalSeen: patterns.length, embedded, failed };
  }, { destructive: true, requiresLLM: true, note: "Bulk-embed all (or last N) code_patterns" });

  register("code", "semantic_search", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const query = String(input.query || "");
    if (!query) return { ok: false, reason: "query_required" };
    const e = await embedText(query, { model: input.model });
    if (!e.ok) return e;
    return semanticSearch(db, {
      queryVector: e.vector, sourceType: input.sourceType, model: e.model,
      topK: Math.min(50, Number(input.topK) || 10),
      minScore: typeof input.minScore === "number" ? input.minScore : 0.0,
    });
  }, { requiresLLM: true, note: "Embed the query and cosine-similarity scan the code_embeddings table" });
}
