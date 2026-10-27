// Semantic retrieval over DTUs that are NOT in hot memory.
//
// Ramaj, 2026-10-27: megas/hypers and archived DTUs are the compressed
// knowledge, but retrieval only scored STATE.dtus. The cold sweep moves rows
// to dtu_store_archive and consolidation moves members to archived_dtus;
// both keep (or now keep) their embedding vectors, so a cosine pass over the
// cached vectors that are not hot finds them, and only the top few rows are
// read back from SQLite.
import { unpackDtuData } from "./dtu-at-rest.js";

/** Cosine similarity (local copy so this module stays dependency-free). */
function cosine(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; ma += a[i] * a[i]; mb += b[i] * b[i]; }
  const d = Math.sqrt(ma) * Math.sqrt(mb);
  return d === 0 ? 0 : dot / d;
}

export const TIER_WEIGHT = Object.freeze({ hyper: 1.3, mega: 1.15, regular: 1.0 });

/** Rank boost for consolidated nodes (applied on top of similarity). */
export function tierBoost(d) {
  return TIER_WEIGHT[d?.tier] || 1.0;
}

/**
 * Archived row → DTU. Older cold rows keep id/title/tier/tags only in the
 * table columns, not in the packed data JSON; fill them from the row.
 */
export function archiveRowToDtu(row) {
  if (!row || row.data == null) return null;
  let d = null;
  try { d = JSON.parse(unpackDtuData(row.data)); } catch { return null; }
  // Legacy cold rows store the body as a JSON string (markdown, or rarely
  // JSON text); the DTU fields live in the table columns.
  if (typeof d === "string") {
    const text = d;
    try { d = JSON.parse(text); } catch { d = null; }
    if (!d || typeof d !== "object") d = { content: text, cretiHuman: text.slice(0, 4000) };
  }
  if (!d || typeof d !== "object") return null;
  let tags = d.tags;
  if (!Array.isArray(tags) && typeof row.tags === "string") { try { tags = JSON.parse(row.tags); } catch { tags = undefined; } }
  const out = { ...d, id: d.id || row.id, title: d.title || row.title, tier: d.tier || row.tier || "regular" };
  if (Array.isArray(tags)) out.tags = tags;
  if (!out.source && row.source) out.source = row.source;
  if (!out.scope && row.scope) out.scope = row.scope;
  return out.id ? out : null;
}

/**
 * Load an archived DTU by id from the cold table, then the consolidation
 * archive. Returns the parsed DTU object or null.
 */
export function loadArchivedDtu(db, id) {
  if (!db || !id) return null;
  try {
    const d = archiveRowToDtu(db.prepare("SELECT * FROM dtu_store_archive WHERE id = ?").get(id));
    if (d) return { ...d, _archived: "cold" };
  } catch { /* fall through */ }
  try {
    const d = archiveRowToDtu(db.prepare("SELECT * FROM archived_dtus WHERE id = ?").get(id));
    if (d) return { ...d, _archived: "consolidated" };
  } catch { /* none */ }
  return null;
}

/**
 * Top-K archived DTUs for a query vector.
 * @param {object} p
 * @param {ArrayLike<number>} p.queryVec
 * @param {Iterable<[string, ArrayLike<number>]>} p.entries  cached (id, vector) pairs
 * @param {(id: string) => boolean} p.isHot   ids already scored from hot memory
 * @param {(id: string) => object|null} p.load
 * @param {(d: object) => boolean} [p.allow]  visibility / consent predicate
 * @param {number} [p.topK]
 * @param {number} [p.minSim]
 * @param {number} [p.maxScan]   cap on vectors compared (bounds CPU)
 * @returns {{ dtu: object, sim: number, score: number }[]}
 */
export function searchArchiveByVector({ queryVec, entries, isHot, load, allow = () => true, topK = 5, minSim = 0.35, maxScan = 60000 }) {
  if (!queryVec || !entries) return [];
  const cands = [];
  let scanned = 0;
  for (const [id, vec] of entries) {
    if (scanned++ >= maxScan) break;
    if (!id || isHot(id)) continue;
    const sim = cosine(queryVec, vec);
    if (sim >= minSim) cands.push({ id, sim });
  }
  cands.sort((a, b) => b.sim - a.sim);
  const out = [];
  // Read a few extra rows: some are filtered by visibility or are gone.
  for (const c of cands.slice(0, topK * 4)) {
    if (out.length >= topK) break;
    const dtu = load(c.id);
    if (!dtu || dtu.tier === "shadow") continue;
    if (!allow(dtu)) continue;
    out.push({ dtu, sim: c.sim, score: c.sim * tierBoost(dtu) });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Order retrieval hits for an agent prompt: megas/hypers first, then by score.
 * @param {{ dtu: object, score: number }[]} hits
 */
export function orderConsolidatedFirst(hits, query = "") {
  const rank = (d) => (d?.tier === "hyper" ? 0 : d?.tier === "mega" ? 1 : 2);
  // A DTU the question names by title goes first: otherwise every hyper
  // outranked the mega the user asked about (cluster boilerplate embeds alike).
  const named = (h) => (query && titleNamedIn(query, h.dtu) ? 0 : 1);
  return [...(hits || [])].sort((a, b) => named(a) - named(b) || rank(a.dtu) - rank(b.dtu) || b.score - a.score);
}

const _norm = (t) => String(t || "").toLowerCase().replace(/[\u2018\u2019\u201c\u201d"'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Title without the "MEGA — " / "HYPER — " / "Analogy:" prefixes, normalized. */
export function coreTitle(d) {
  let t = String(d?.title || "");
  for (let i = 0; i < 4; i++) t = t.replace(/^\s*(?:MEGA|HYPER)\s*[—–-]\s*|^\s*Analogy:\s*/i, "");
  return _norm(t);
}

/** True when the query contains the DTU's (core) title, at least 12 chars. */
export function titleNamedIn(query, d) {
  const t = coreTitle(d);
  return t.length >= 12 && ` ${_norm(query)} `.includes(` ${t} `);
}

/** Member count of a mega/hyper (lineage parents, else promotedFrom). */
export function memberCount(d) {
  const p = d?.lineage?.parents;
  if (Array.isArray(p) && p.length) return p.length;
  const n = Number(d?.meta?.promotedFrom);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Retrieved DTUs answer the question when one is named or matches strongly. */
export function strongDtuMatch(hits, query = "", minSim = 0.5) {
  return (hits || []).some((h) => (Number(h?.sim) || 0) >= minSim || (query && titleNamedIn(query, h?.dtu)));
}
