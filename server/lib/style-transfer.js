// server/lib/style-transfer.js
//
// Style Transfer across domains (#45) — applies the linear-representation
// hypothesis (style is a linear DIRECTION in embedding space; the classic
// king−man+woman≈queen) to Concord's REAL DTU embeddings. A style vector is the
// mean of exemplars in style A minus the mean in style B; adding it to a source
// DTU's embedding moves it toward style A, and the nearest real DTU to the
// result is the transferred analogue. Operates on real stored embeddings only —
// when a DTU hasn't been embedded it reports semantic:false honestly and returns
// nothing fabricated.

import { getEmbedding, cosineSimilarity } from "../embeddings.js";

/** Mean of a list of equal-length vectors. Pure. */
export function meanVec(vecs) {
  const list = (vecs || []).filter((v) => v && v.length);
  if (!list.length) return null;
  const dim = list[0].length;
  const out = new Float32Array(dim);
  for (const v of list) for (let i = 0; i < dim; i++) out[i] += v[i];
  for (let i = 0; i < dim; i++) out[i] /= list.length;
  return out;
}

/** Style direction = mean(A) − mean(B). Pure. */
export function styleVector(aVecs, bVecs) {
  const a = meanVec(aVecs), b = meanVec(bVecs);
  if (!a || !b || a.length !== b.length) return null;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] - b[i];
  return out;
}

/** Apply a style direction to a vector: v + α·style. Pure. */
export function applyStyle(vec, style, alpha = 1) {
  if (!vec || !style || vec.length !== style.length) return vec;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] + alpha * style[i];
  return out;
}

function norm(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s); }

/** Resolve a list of DTU ids to their REAL stored embeddings (skips unembedded). */
function vecsFor(ids) {
  const out = [];
  for (const id of ids || []) { const v = getEmbedding(id); if (v && v.length) out.push(v); }
  return out;
}

/**
 * Transfer a style onto a source DTU and return the nearest real DTUs to the
 * restyled vector.
 * @param {object} _db (embeddings module holds its own handle from initEmbeddings)
 * @param {object} opts { sourceDtuId, styleAIds, styleBIds, candidateIds, alpha=1, topK=5 }
 * @returns {{ok, semantic, neighbors?, reason?}}
 */
export function transferStyle(_db, { sourceDtuId, styleAIds = [], styleBIds = [], candidateIds = [], alpha = 1, topK = 5 } = {}) {
  const aVecs = vecsFor(styleAIds);
  const bVecs = vecsFor(styleBIds);
  const style = styleVector(aVecs, bVecs);
  if (!style) return { ok: true, semantic: false, reason: "no_style_embeddings", neighbors: [] };

  const src = getEmbedding(sourceDtuId);
  if (!src || !src.length) return { ok: true, semantic: false, reason: "source_not_embedded", neighbors: [] };

  const restyled = applyStyle(src, style, alpha);
  const scored = [];
  for (const id of candidateIds) {
    const v = getEmbedding(id);
    if (v && v.length === restyled.length) scored.push({ dtuId: id, score: Math.round(cosineSimilarity(restyled, v) * 10000) / 10000 });
  }
  scored.sort((a, b) => b.score - a.score);
  return { ok: true, semantic: true, styleStrength: Math.round(norm(style) * 10000) / 10000, neighbors: scored.slice(0, Math.max(1, topK)) };
}

export default { meanVec, styleVector, applyStyle, transferStyle };
