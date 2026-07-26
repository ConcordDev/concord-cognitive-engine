// server/lib/cross-lens-discovery.js
//
// Phase 6c — Cross-lens Discovery.
//
// Search the entire DTU corpus across all 203 lenses with a single
// query. Title + meta-content + creator filters; respects DTU
// visibility (only public/published returned to non-owners). Bounded
// result count.
//
// Backed by SQLite LIKE on title + meta_json. For 1.5M-DTU substrates
// this is ~50ms; for the typical 50K-DTU instance it's <5ms. Future
// work: FTS5 index. We deliberately don't add it yet — the bottleneck
// is content authoring, not query latency.

import logger from "../logger.js";

// `dtus.content` (migration 295) and `dtus.body_json` (migration 001) don't
// exist on every `dtus` table this module might run against — several test
// files (and any legacy/minimal DB) create a slimmer `dtus` shape with just
// id/type/title/creator_id/data/lens_id/created_at. Detect presence once per
// db handle (PRAGMA is cheap but not free — worth memoizing on the hot
// search path) rather than assuming the column exists and letting the whole
// query throw.
const _dtusColumnCache = new WeakMap();
function _dtusOptionalColumns(db) {
  let cached = _dtusColumnCache.get(db);
  if (cached) return cached;
  let names = new Set();
  try { names = new Set(db.prepare(`PRAGMA table_info(dtus)`).all().map((r) => r.name)); }
  catch { /* leave empty — every optional column reads as absent */ }
  cached = { hasContent: names.has("content"), hasBodyJson: names.has("body_json") };
  _dtusColumnCache.set(db, cached);
  return cached;
}

const MAX_RESULTS = 100;
// Recall width for the semantic re-rank: keyword/metadata prefilter pulls this
// many candidates, then we re-order by embedding cosine similarity. Wider recall
// = better semantic results, bounded so the cosine pass stays sub-10ms.
const SEMANTIC_RECALL = 100;

// R8/CL3 gap fix (2026-07-24): per-result body-text cap for the `content`
// field below. Bounded like code-retrieval.js's `maxCharsPerFile` convention
// (default 6000, clamped [200, 50000]) and repair-brain.js's 1500-char BODY
// slice — this is a tighter budget than either because `content` here is
// consumed by reason.evaluate_answer's RAG-style faithfulness scoring, which
// typically pulls in several retrieved DTUs at once (ConKay attaches up to 8
// per skill call — see conkay-skills.ts), so per-item size has to stay modest
// to keep that call's total payload sane.
const CONTENT_MAX_CHARS = 1500;

/**
 * Best-effort extraction of a DTU's real, readable body text for retrieval-
 * grounding purposes (the RAG context `reason.evaluate_answer`'s
 * `normalizeContext` scores an answer against). DTU-creation call sites across
 * this codebase disagree on which column carries prose — `content`
 * (economy/dtu-pipeline.js's marketplace path), `data` (most game-systems
 * domains; sometimes plain prose, sometimes JSON with a nested human-readable
 * field), `body_json` (the oldest, mostly-JSON path). Try each in the order a
 * human is most likely to have put real prose; never fabricate content when
 * none of them has any — an empty/omitted `content` field is the honest
 * result for a DTU that's genuinely just structured metadata.
 *
 * REAL GAP this closes (R8/CL3): `searchDtus`'s result shape used to carry
 * only `{ id, kind, title, creator_id, snippet, meta_summary }` — no body
 * field at all — so ConKay's "search" skill (the one alternate-retrieval path
 * to the id/title/tier-only `dtuRefs` shape, per
 * server/tests/e2e/conkay-verified-answer-loop.test.js's header) fed
 * `reason.evaluate_answer` nothing but titles to score faithfulness against.
 *
 * @param {{ content?: string|null, data?: string|null, body_json?: string|null }} row
 * @returns {string|null}
 */
export function extractDtuBodyText(row) {
  const candidates = [row?.content, row?.data, row?.body_json];
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      // Structured payload — pull a human-readable field if one exists;
      // otherwise this column is just machine metadata for this DTU, so
      // silently move on to the next candidate rather than dumping raw JSON
      // into a faithfulness-scoring context.
      let parsed;
      try { parsed = JSON.parse(trimmed); } catch { parsed = undefined; }
      if (parsed === undefined) {
        // Started with a brace/bracket but isn't actually valid JSON — treat
        // as literal prose (matches the E2E test's plain-text `data` shape).
        return trimmed.slice(0, CONTENT_MAX_CHARS);
      }
      const text = parsed?.human?.summary || parsed?.summary || parsed?.text || parsed?.body || null;
      if (typeof text === "string" && text.trim()) return text.trim().slice(0, CONTENT_MAX_CHARS);
      continue;
    }
    return trimmed.slice(0, CONTENT_MAX_CHARS);
  }
  return null;
}

/**
 * Search across all DTUs for a query string. Supports filters:
 *   { kind, creatorId, lensHint, includeArchived }
 *
 * Returns { ok, results: [{ id, kind, title, creator_id, snippet, meta }] }
 */
export function searchDtus(db, query, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const q = String(query || "").trim();
  if (q.length < 2) return { ok: false, reason: "query_too_short" };
  if (q.length > 200) return { ok: false, reason: "query_too_long" };

  // Honest ConKay HUD beat (K1): the keyword/metadata prefilter is a real
  // step in both the keyword-only and semantic paths. Best-effort decoration.
  try { opts.onStage?.("searching"); } catch { /* decoration only */ }

  const limit = Math.min(MAX_RESULTS, Math.max(1, Number(opts.limit) || 30));
  const requesterId = opts.requesterId || null;

  // Build the LIKE pattern. Escape SQL wildcards in the user input.
  const safeQ = q.replace(/[%_\\]/g, "\\$&");
  const likePattern = `%${safeQ}%`;

  const where = [];
  const params = [];

  // Always: title or meta contains the query.
  // NOTE: the real column is `data` (aliased to meta_json in the SELECT); SQLite
  // can't resolve a SELECT alias in WHERE, so referencing d.meta_json here threw
  // "no such column" on every call — searchDtus/discovery.search were silently
  // dead. Use the real column.
  where.push(`(d.title LIKE ? ESCAPE '\\' OR d.data LIKE ? ESCAPE '\\')`);
  params.push(likePattern, likePattern);

  if (opts.kind) {
    where.push(`d.type = ?`);
    params.push(opts.kind);
  }

  // DTU→lens routing: when a lens (lensHint) is supplied, filter to that lens's
  // own grounding instead of the flat pool. Falls back to flat when the lens
  // owns nothing yet (so an unrouted corpus still searches). 2026 RAG best-
  // practice: metadata-filter (lens) before the text LIKE.
  if (opts.lens && process.env.CONCORD_DTU_ROUTING !== "0") {
    where.push(`d.lens_id = ?`);
    params.push(String(opts.lens));
  }

  if (opts.creatorId) {
    where.push(`d.creator_id = ?`);
    params.push(opts.creatorId);
  }

  // Visibility: a non-owner can only see public/published DTUs OR DTUs
  // whose meta_json doesn't include "scope":"personal".
  // We use a meta_json LIKE check as a coarse filter; a true privacy
  // gate happens at the macro layer via publicReadDomains.
  if (requesterId) {
    where.push(`(d.creator_id = ? OR d.data NOT LIKE '%"scope":"personal"%')`);
    params.push(requesterId);
  } else {
    where.push(`d.data NOT LIKE '%"scope":"personal"%'`);
  }

  const { hasContent, hasBodyJson } = _dtusOptionalColumns(db);
  const optionalCols = [hasContent ? "content" : "NULL AS content", hasBodyJson ? "body_json" : "NULL AS body_json"].join(", ");

  let rows = [];
  try {
    rows = db.prepare(`
      SELECT id, type AS kind, title, creator_id, data AS meta_json, ${optionalCols}, created_at
      FROM dtus d
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params, limit);
  } catch (err) {
    try { logger.warn?.("cross-lens-discovery", "search_failed", { error: err?.message }); }
    catch { /* ignore */ }
    return { ok: false, reason: "search_failed" };
  }

  // Compute a simple snippet by finding the query position in title or
  // meta_json and slicing 80 chars around it.
  const results = rows.map(r => {
    const meta = safeParse(r.meta_json);
    const haystack = `${r.title} ${r.meta_json || ""}`;
    const idx = haystack.toLowerCase().indexOf(q.toLowerCase());
    let snippet = "";
    if (idx >= 0) {
      const start = Math.max(0, idx - 30);
      const end = Math.min(haystack.length, idx + q.length + 50);
      snippet = (start > 0 ? "…" : "") + haystack.slice(start, end) + (end < haystack.length ? "…" : "");
    }
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      creator_id: r.creator_id,
      snippet,
      created_at: r.created_at,
      meta_summary: meta ? summarizeMeta(meta) : null,
      // R8/CL3 gap fix: the DTU's real body text (bounded, best-effort — see
      // extractDtuBodyText's doc comment), so a caller wiring this into
      // reason.evaluate_answer's `retrievedDtus` gets real grounding content
      // to score against, not just the (often short, label-like) title.
      content: extractDtuBodyText({ content: r.content, data: r.meta_json, body_json: r.body_json }),
    };
  });

  return { ok: true, results, count: results.length, query: q };
}

/**
 * Semantic archive search — the upgrade from keyword+recency to meaning.
 *
 * Hybrid retrieval (2026 RAG best practice): the keyword/metadata `searchDtus`
 * is the RECALL prefilter (and the honest fallback), then DTUs are RE-RANKED by
 * embedding cosine similarity against the query via the existing
 * embeddings.js#semanticSearch (nomic-embed-text over Ollama; DTUs are embedded
 * on create). When embeddings are unavailable (Ollama/embed model offline) the
 * re-rank yields nothing and we return the keyword+recency results unchanged —
 * so this NEVER regresses below today's behaviour and never blocks.
 *
 * The `semantic` flag in the result tells the caller (and the UI) honestly
 * whether meaning-ranking actually happened — no fake "AI-powered" badge when
 * it silently fell back to keyword.
 *
 * @returns {Promise<{ ok, results, count, query, semantic }>}
 */
export async function semanticSearchDtus(db, query, opts = {}) {
  const limit = Math.min(MAX_RESULTS, Math.max(1, Number(opts.limit) || 30));
  // Recall: broad keyword/metadata prefilter (also our fallback set).
  const base = searchDtus(db, query, { ...opts, limit: Math.max(limit, SEMANTIC_RECALL) });
  if (!base.ok) return { ...base, semantic: false };
  if (base.results.length <= 1) {
    return { ok: true, results: base.results.slice(0, limit), count: Math.min(base.results.length, limit), query: base.query, semantic: false };
  }

  // Honest ConKay HUD beat (K1): the embedding re-rank only fires when it
  // actually runs (>1 candidate). The result's `semantic` flag reports which
  // path won; this beat mirrors that truthfully. Best-effort decoration.
  try { opts.onStage?.("reranking"); } catch { /* decoration only */ }
  try {
    const { semanticSearch } = await import("../embeddings.js");
    const candidates = base.results.map((r) => ({ id: r.id, title: r.title, _row: r }));
    const ranked = await semanticSearch(String(query).trim(), candidates, { topK: limit });
    if (Array.isArray(ranked) && ranked.length > 0) {
      const results = ranked.map((c) => ({
        ...c._row,
        similarity: Math.round((c.rawSimilarity ?? 0) * 1000) / 1000,
      }));
      return { ok: true, results, count: results.length, query: base.query, semantic: true };
    }
  } catch (err) {
    try { logger.warn?.("cross-lens-discovery", "semantic_rerank_failed", { error: err?.message }); }
    catch { /* ignore */ }
  }

  // Embeddings offline / empty → honest keyword + recency fallback.
  return { ok: true, results: base.results.slice(0, limit), count: Math.min(base.results.length, limit), query: base.query, semantic: false };
}

function safeParse(json) {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

function summarizeMeta(meta) {
  // Surface the few fields the discovery UI most often wants.
  return {
    skill_kind:  meta.skill_kind || null,
    element:     meta.element || null,
    revision_num: meta.revision_num || 0,
    author_kind: meta.author_kind || null,
  };
}

/**
 * Aggregate facets — counts of DTUs by kind across the corpus.
 * Useful for the discovery UI's filter sidebar.
 */
export function getKindFacets(db, requesterId = null) {
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT type AS kind, COUNT(*) AS n FROM dtus
      ${requesterId ? `WHERE (creator_id = ? OR data NOT LIKE '%"scope":"personal"%')` : ""}
      GROUP BY type ORDER BY n DESC LIMIT 50
    `).all(...(requesterId ? [requesterId] : []));
    return rows;
  } catch { return []; }
}

/**
 * "Trending" — DTUs with high recent citation activity. Reads
 * dtu_citations grouped by parent_id within the last N hours.
 */
export function getTrending(db, opts = {}) {
  if (!db) return [];
  const lookbackS = Math.max(60, Math.min(86400 * 7, Number(opts.lookbackS) || 86400));
  const cutoff = Math.floor(Date.now() / 1000) - lookbackS;
  const limit = Math.min(50, Math.max(1, Number(opts.limit) || 10));
  try {
    return db.prepare(`
      SELECT c.parent_id AS id, COUNT(*) AS citations,
             d.title, d.type AS kind, d.creator_id
      FROM royalty_lineage c
      JOIN dtus d ON d.id = c.parent_id
      WHERE c.created_at > datetime(?, 'unixepoch')
      GROUP BY c.parent_id
      ORDER BY citations DESC
      LIMIT ?
    `).all(cutoff, limit);
  } catch { return []; }
}

export const _internal = { MAX_RESULTS, summarizeMeta };
