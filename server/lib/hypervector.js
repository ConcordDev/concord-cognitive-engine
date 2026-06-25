// server/lib/hypervector.js
//
// Bipolar Vector Symbolic Architecture (VSA / HDC) primitives (#40). High-
// dimensional ±1 hypervectors with the three algebraic operations the whole
// field rests on — bind, bundle, permute — plus similarity and a cleanup
// (associative) memory. This is the substrate for Holographic Invariant Storage
// (lib/ethics-his.js): the refusal/ethics invariants are stored as hypervectors
// and re-injected to counter context drift, with closed-form recovery bounds.
//
// Everything is DETERMINISTIC: hypervectors are seeded from a string via a small
// xorshift PRNG (no Math.random — that would break resume + reproducibility).
// Pure Int8Array math, no dependencies.

export const DIM = 10000;

// ── deterministic seeding ───────────────────────────────────────────────────
function hashStr(s) {
  let h = 2166136261 >>> 0; // FNV-1a
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function xorshift32(seed) {
  let x = seed >>> 0 || 0x9e3779b9;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
}

/** Deterministic random bipolar hypervector for a label/seed. */
export function randomHV(seed, dim = DIM) {
  const rnd = xorshift32(hashStr(seed));
  const v = new Int8Array(dim);
  for (let i = 0; i < dim; i++) v[i] = (rnd() & 1) ? 1 : -1;
  return v;
}

/** Bind two hypervectors — elementwise product. Self-inverse: bind(bind(a,b),b)===a. */
export function bind(a, b) {
  const n = Math.min(a.length, b.length);
  const out = new Int8Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] * b[i];
  return out;
}

/** Unbind == bind (bipolar vectors are their own inverse under elementwise product). */
export const unbind = bind;

/**
 * Bundle (superpose) a set of hypervectors — elementwise majority sign. Ties
 * (sum === 0, only possible for an even count) resolve to +1 deterministically.
 */
export function bundle(vectors) {
  const list = (vectors || []).filter((v) => v && v.length);
  if (!list.length) return new Int8Array(0);
  const dim = list[0].length;
  const acc = new Int32Array(dim);
  for (const v of list) for (let i = 0; i < dim; i++) acc[i] += v[i];
  const out = new Int8Array(dim);
  for (let i = 0; i < dim; i++) out[i] = acc[i] >= 0 ? 1 : -1;
  return out;
}

/** Permute (rotate) — encodes order/position. shift defaults to 1. */
export function permute(v, shift = 1) {
  const n = v.length;
  const s = ((shift % n) + n) % n;
  const out = new Int8Array(n);
  for (let i = 0; i < n; i++) out[(i + s) % n] = v[i];
  return out;
}

/** Cosine-equivalent similarity for bipolar vectors: normalized dot in [-1, 1]. */
export function similarity(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot / n; // each |component| === 1, so ‖a‖‖b‖ === n
}

/**
 * Cleanup (associative) memory: nearest codebook entry to `v` by similarity.
 * codebook is { label: hypervector }. Returns { label, score } or null.
 */
export function cleanup(v, codebook) {
  let best = null;
  for (const label of Object.keys(codebook || {})) {
    const score = similarity(v, codebook[label]);
    if (!best || score > best.score) best = { label, score };
  }
  return best;
}

/** Build a codebook of seeded hypervectors from a list of labels. */
export function makeCodebook(labels, dim = DIM) {
  const cb = {};
  for (const l of labels) cb[String(l)] = randomHV(l, dim);
  return cb;
}

export default { DIM, randomHV, bind, unbind, bundle, permute, similarity, cleanup, makeCodebook };
