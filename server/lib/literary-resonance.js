// server/lib/literary-resonance.js
//
// LRL Phase 2 — cross-domain resonance. For a literary chunk's DTU, find the
// semantically-nearest DTUs in OTHER lenses/domains (by embedding cosine) and
// record them as resonance edges (migration 338). This is the bridge layer: a
// "power dynamics" passage in Shakespeare connects to a faction-sim DTU; an
// "elasticity" metaphor connects to an FEA DTU; etc.
//
// Reuse: cosineSimilarity from embeddings.js; embeddings are read directly from
// the embedding_cache SQLite table (decode BLOB) so this works regardless of the
// in-memory cache warm-state. Graceful: no embedding for the source, or no
// embedding_cache table, → zero edges (never throws).

import { cosineSimilarity } from "../embeddings.js";

const SCAN_CAP = Number(process.env.LRL_RESONANCE_SCAN_CAP || 5000);

function decodeVec(buf) {
  if (!buf || !buf.byteLength) return null;
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

let _idc = 0;
function edgeId() {
  return `lre_${Date.now().toString(36)}_${(_idc++).toString(36)}`;
}

/**
 * Compute + persist cross-domain resonance edges for one literary DTU.
 * @returns {{ok:boolean, edges:number, reason?:string}}
 */
export function computeResonanceForDtu(db, literaryDtuId, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 5, 1), 25);
  const minScore = opts.minScore != null ? Number(opts.minScore) : 0.45;

  let srcVec = null;
  try {
    const row = db.prepare("SELECT embedding FROM embedding_cache WHERE dtu_id = ?").get(literaryDtuId);
    srcVec = row ? decodeVec(row.embedding) : null;
  } catch {
    return { ok: true, edges: 0, reason: "no_embedding_cache" };
  }
  if (!srcVec) return { ok: true, edges: 0, reason: "no_embedding" };

  // Candidate pool: DTUs in OTHER domains that carry an embedding.
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT d.id AS id, d.lens_id AS domain, e.embedding AS emb
      FROM dtus d
      JOIN embedding_cache e ON e.dtu_id = d.id
      WHERE d.lens_id IS NOT NULL AND d.lens_id != 'literary'
      LIMIT ?
    `).all(SCAN_CAP);
  } catch {
    return { ok: true, edges: 0, reason: "no_candidates" };
  }

  const scored = [];
  for (const r of rows) {
    const v = decodeVec(r.emb);
    if (v && v.length === srcVec.length) {
      const s = cosineSimilarity(srcVec, v);
      if (s >= minScore) scored.push([r.id, r.domain, s]);
    }
  }
  scored.sort((a, b) => b[2] - a[2]);
  const top = scored.slice(0, limit);

  const ins = db.prepare(`
    INSERT INTO literary_resonance_edges (id, literary_dtu_id, target_dtu_id, target_domain, kind, score)
    VALUES (?, ?, ?, ?, 'cross_domain', ?)
    ON CONFLICT (literary_dtu_id, target_dtu_id)
      DO UPDATE SET score = excluded.score, target_domain = excluded.target_domain
  `);
  const tx = db.transaction(() => {
    for (const [targetId, domain, score] of top) {
      ins.run(edgeId(), literaryDtuId, targetId, domain, Math.round(score * 1e4) / 1e4);
    }
  });
  tx();

  return { ok: true, edges: top.length };
}

/**
 * Read the recorded cross-domain resonance edges for a literary DTU, joined to
 * the target DTU for a display title.
 */
export function getResonanceEdges(db, literaryDtuId, limit = 10) {
  try {
    return db.prepare(`
      SELECT r.target_dtu_id AS dtuId, r.target_domain AS domain, r.score, r.kind,
             d.title AS title
      FROM literary_resonance_edges r
      LEFT JOIN dtus d ON d.id = r.target_dtu_id
      WHERE r.literary_dtu_id = ?
      ORDER BY r.score DESC
      LIMIT ?
    `).all(literaryDtuId, Math.min(Math.max(Number(limit) || 10, 1), 50));
  } catch {
    return [];
  }
}

/**
 * Resonance salience for a literary DTU in [0,1] — how strongly it bridges other
 * domains (#8): saturating breadth (distinct cross-domain edges) blended with the
 * average bridge strength. This is the signal a MEGA/HYPER consolidation pass
 * should prefer (high-resonance DTUs make better cluster seeds) and that
 * literary.crystallize ranks by. Pure read; 0 when no edges / table absent.
 */
export function salienceFrom(edgeCount, avgScore) {
  const n = Number(edgeCount) || 0;
  if (n <= 0) return 0;
  const breadth = 1 - Math.exp(-n / 3); // ~0.28 at 1 edge → ~0.95 at 9
  return Math.min(1, breadth * 0.6 + (Number(avgScore) || 0) * 0.4);
}

export function resonanceSalience(db, literaryDtuId) {
  try {
    const r = db.prepare(
      "SELECT COUNT(*) AS n, AVG(score) AS avg FROM literary_resonance_edges WHERE literary_dtu_id = ?"
    ).get(literaryDtuId);
    return salienceFrom(r?.n, r?.avg);
  } catch {
    return 0;
  }
}

export default { computeResonanceForDtu, getResonanceEdges, resonanceSalience, salienceFrom };
