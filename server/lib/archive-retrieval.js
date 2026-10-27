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
 * Load an archived DTU by id from the cold table, then the consolidation
 * archive. Returns the parsed DTU object or null.
 */
export function loadArchivedDtu(db, id) {
  if (!db || !id) return null;
  try {
    const row = db.prepare("SELECT data FROM dtu_store_archive WHERE id = ?").get(id);
    if (row?.data != null) {
      const d = JSON.parse(unpackDtuData(row.data));
      if (d && d.id) return { ...d, _archived: "cold" };
    }
  } catch { /* fall through */ }
  try {
    const row = db.prepare("SELECT data FROM archived_dtus WHERE id = ?").get(id);
    if (row?.data != null) {
      const d = JSON.parse(unpackDtuData(row.data));
      if (d && d.id) return { ...d, _archived: "consolidated" };
    }
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
export function orderConsolidatedFirst(hits) {
  const rank = (d) => (d?.tier === "hyper" ? 0 : d?.tier === "mega" ? 1 : 2);
  return [...(hits || [])].sort((a, b) => rank(a.dtu) - rank(b.dtu) || b.score - a.score);
}
