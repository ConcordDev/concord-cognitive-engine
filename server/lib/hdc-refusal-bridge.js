// server/lib/hdc-refusal-bridge.js
//
// Item 3 — anchor the HDC/VSA core (lib/hdc.js) to the base-6 refusal-glyph
// algebra, and provide a compositional concept-recall encoder the Oracle can use
// alongside embeddings. The refusal algebra represents a value as base-6 glyph
// digits (server/lib/refusal-algebra/conversion.js#decimalToRefusalGlyphs);
// `numberToHypervector` maps that SAME base-6 decomposition into hyperdimensional
// space — VSA binding is the high-dimensional cousin of the glyph composition.
//
// `encodeConcepts` / `hdcRecall` are the practical retrieval side: bundle a set of
// concept hypervectors and rank candidates by HD concept-overlap (a cheap,
// interpretable associative pass that COMPLEMENTS the embedding rank — it never
// replaces it). Pure-compute, no I/O.

import hdc from "./hdc.js";

const DIM = 2048;
const space = hdc.makeSpace(DIM); // process-lifetime deterministic codebook

function digitSym(d) { return space.symbol(`b6digit:${d}`); }
function posSym(k) { return space.symbol(`b6pos:${k}`); }

/**
 * Map a finite number to a hypervector via its base-6 integer digits — the same
 * radix the refusal-glyph algebra uses, so a glyph value and its number share a
 * representation. Deterministic.
 */
export function numberToHypervector(value) {
  let n = Math.abs(Math.floor(Number(value) || 0));
  if (n === 0) return hdc.bind(posSym(0), digitSym(0));
  const bound = [];
  let k = 0;
  while (n > 0 && k < 32) {
    bound.push(hdc.bind(posSym(k), digitSym(n % 6)));
    n = Math.floor(n / 6);
    k++;
  }
  return hdc.bundle(bound);
}

/** Concept strings → a bundled hypervector (the retrieval encoder). null if empty. */
export function encodeConcepts(input) {
  const toks = (Array.isArray(input) ? input : [input])
    .flatMap((s) => String(s || "").toLowerCase().split(/[^a-z0-9]+/))
    .filter((w) => w.length > 2);
  if (!toks.length) return null;
  const uniq = [...new Set(toks)].slice(0, 64);
  return hdc.bundle(uniq.map((w) => space.symbol(`concept:${w}`)));
}

/**
 * Compositional recall: rank candidate DTUs by HD concept-overlap with the query.
 * Returns DTUs above `threshold`, excluding ids already surfaced by the embedding
 * rank — so this only ADDS associative hits.
 */
export function hdcRecall(query, candidates, { topK = 8, threshold = 0.12, exclude = new Set() } = {}) {
  const qv = encodeConcepts(query);
  if (!qv || !Array.isArray(candidates)) return [];
  const scored = [];
  for (const d of candidates) {
    if (!d || !d.id || exclude.has(d.id)) continue;
    const cv = encodeConcepts([d.title, ...(Array.isArray(d.tags) ? d.tags : [])].filter(Boolean));
    if (!cv) continue;
    const score = hdc.similarity(qv, cv);
    if (score >= threshold) scored.push({ d, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.d);
}

export { space };
export default { numberToHypervector, encodeConcepts, hdcRecall };
