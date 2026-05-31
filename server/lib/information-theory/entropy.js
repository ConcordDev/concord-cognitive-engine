// server/lib/information-theory/entropy.js
//
// Engine N2 — information theory = the substrate's own MEASURE. The whole
// platform is a knowledge substrate (DTUs), yet it had no measure of its own
// information content / redundancy / channel capacity. Shannon entropy is that
// measure: how much a corpus's tag/kind distribution actually carries, how
// compressible it is (the DTU-consolidation ceiling), how much two channels
// share. Pure, deterministic, zero-dep. All in bits (log base 2).

const LOG2 = Math.log(2);
function log2(x) { return Math.log(x) / LOG2; }

function _normalize(weights) {
  const vals = weights.filter((w) => Number(w) > 0).map(Number);
  const sum = vals.reduce((a, b) => a + b, 0);
  return sum > 0 ? vals.map((v) => v / sum) : [];
}

/** Shannon entropy H = −Σ p·log2(p), in bits, from a probability or weight vector. */
export function shannonEntropy(weights) {
  const p = _normalize(weights || []);
  let h = 0;
  for (const pi of p) h -= pi * log2(pi);
  return h;
}

/** Entropy of an empirical distribution given raw frequency counts. */
export function entropyFromCounts(counts) {
  return shannonEntropy(Object.values(counts || {}));
}

/** Normalized entropy H / log2(n) ∈ [0,1] — 1 = perfectly uniform, 0 = certain. */
export function normalizedEntropy(weights) {
  const n = (weights || []).filter((w) => Number(w) > 0).length;
  if (n <= 1) return 0;
  return shannonEntropy(weights) / log2(n);
}

/** Redundancy = 1 − normalized entropy: how compressible the distribution is. */
export function redundancy(weights) {
  return Math.max(0, Math.min(1, 1 - normalizedEntropy(weights)));
}

/** Kullback–Leibler divergence D(P‖Q) in bits (P, Q are weight vectors of equal length). */
export function klDivergence(P, Q) {
  const p = _normalize(P || []);
  const qRaw = (Q || []).map(Number);
  const qSum = qRaw.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (qSum <= 0 || p.length === 0) return Infinity;
  const q = qRaw.map((v) => (v > 0 ? v : 0) / qSum);
  let d = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i] === 0) continue;
    if (!(q[i] > 0)) return Infinity; // P has support where Q doesn't
    d += p[i] * log2(p[i] / q[i]);
  }
  return d;
}

/**
 * Mutual information I(X;Y) in bits from a joint count/probability matrix
 * `joint[x][y]`. 0 ⇔ X and Y independent.
 */
export function mutualInformation(joint) {
  const rows = joint.length;
  const cols = rows ? joint[0].length : 0;
  let total = 0;
  for (let x = 0; x < rows; x++) for (let y = 0; y < cols; y++) total += Math.max(0, joint[x][y]);
  if (total <= 0) return 0;
  const px = new Array(rows).fill(0);
  const py = new Array(cols).fill(0);
  for (let x = 0; x < rows; x++) for (let y = 0; y < cols; y++) {
    const p = Math.max(0, joint[x][y]) / total;
    px[x] += p; py[y] += p;
  }
  let mi = 0;
  for (let x = 0; x < rows; x++) for (let y = 0; y < cols; y++) {
    const pxy = Math.max(0, joint[x][y]) / total;
    if (pxy > 0 && px[x] > 0 && py[y] > 0) mi += pxy * log2(pxy / (px[x] * py[y]));
  }
  return Math.max(0, mi);
}

/** Shannon lower bound on total bits to encode `counts` items (Σ count·−log2 p). */
export function optimalCodeLengthBits(counts) {
  const vals = Object.values(counts || {}).map(Number).filter((v) => v > 0);
  const total = vals.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let bits = 0;
  for (const c of vals) bits += c * -log2(c / total);
  return bits;
}
