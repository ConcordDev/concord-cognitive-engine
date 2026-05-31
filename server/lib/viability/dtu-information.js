// server/lib/viability/dtu-information.js
//
// Engine N2 (information theory) × the DTU substrate. The substrate's whole job
// is COMPRESSION — regular DTUs consolidate into MEGA → HYPER. Information theory
// is the measure of how well: a cluster's Shannon entropy is its information
// content, and a consolidation is FAITHFUL when the summary's topic distribution
// matches the originals' (low KL divergence) — lossy/hallucinated summaries
// drift away. Composes the shipped N2 core (entropy / KL / optimal code length).
// Pure. Ready for the consolidation quality validator to consume.

import { entropyFromCounts, klDivergence, optimalCodeLengthBits } from "../information-theory/entropy.js";

/** Tally tags across a list of DTUs → { tag: count }. */
export function tagCounts(dtus = []) {
  const counts = {};
  for (const d of dtus) {
    for (const t of (d && d.tags) || []) counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
}

/** Shannon entropy (bits) of a cluster's tag distribution — its topical diversity. */
export function clusterEntropy(dtus = []) {
  return entropyFromCounts(tagCounts(dtus));
}

/**
 * How faithfully does `summary` (the consolidated MEGA/HYPER DTU) preserve the
 * originals' topic distribution? exp(−KL(originals ‖ summary)) ∈ (0,1], 1 =
 * perfect preservation. Laplace-smoothed so a missing tag is low-but-finite,
 * not a hard Infinity. Below ~0.4 the consolidation has distorted the cluster.
 */
export function compressionFidelity(originals = [], summary = {}) {
  const orig = tagCounts(originals);
  const sum = tagCounts([summary]);
  const tags = [...new Set([...Object.keys(orig), ...Object.keys(sum)])];
  if (tags.length === 0) return 1;
  const P = tags.map((t) => orig[t] || 0);
  const Q = tags.map((t) => (sum[t] || 0) + 0.5); // smoothing → finite KL
  const kl = klDivergence(P, Q);
  return Number.isFinite(kl) ? Math.exp(-kl) : 0;
}

/**
 * Information compression ratio: optimal-code bits to encode the originals'
 * topic mix vs the summary's. > 1 means the summary is a genuine compression.
 */
export function informationRatio(originals = [], summary = {}) {
  const ob = optimalCodeLengthBits(tagCounts(originals));
  const sb = optimalCodeLengthBits(tagCounts([summary]));
  if (sb > 0) return ob / sb;
  return ob > 0 ? Infinity : 1;
}
