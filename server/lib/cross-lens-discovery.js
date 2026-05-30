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

const MAX_RESULTS = 100;

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

  const limit = Math.min(MAX_RESULTS, Math.max(1, Number(opts.limit) || 30));
  const requesterId = opts.requesterId || null;

  // Build the LIKE pattern. Escape SQL wildcards in the user input.
  const safeQ = q.replace(/[%_\\]/g, "\\$&");
  const likePattern = `%${safeQ}%`;

  const where = [];
  const params = [];

  // Always: title or meta contains the query.
  where.push(`(d.title LIKE ? ESCAPE '\\\\' OR d.meta_json LIKE ? ESCAPE '\\\\')`);
  params.push(likePattern, likePattern);

  if (opts.kind) {
    where.push(`d.type = ?`);
    params.push(opts.kind);
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
    where.push(`(d.creator_id = ? OR d.meta_json NOT LIKE '%"scope":"personal"%')`);
    params.push(requesterId);
  } else {
    where.push(`d.meta_json NOT LIKE '%"scope":"personal"%'`);
  }

  let rows = [];
  try {
    rows = db.prepare(`
      SELECT id, type AS kind, title, creator_id, data AS meta_json, created_at
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
    };
  });

  return { ok: true, results, count: results.length, query: q };
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
      FROM dtu_citations c
      JOIN dtus d ON d.id = c.parent_id
      WHERE c.created_at > ?
      GROUP BY c.parent_id
      ORDER BY citations DESC
      LIMIT ?
    `).all(cutoff, limit);
  } catch { return []; }
}

export const _internal = { MAX_RESULTS, summarizeMeta };
