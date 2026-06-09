// server/lib/hdc.js
//
// ConKay Phase 6 Tier 2 — a native-JS Vector-Symbolic-Architecture (HDC/VSA),
// the MAP model (Multiply-Add-Permute) over bipolar Float32 hypervectors. In
// stack + sovereign (no Python, no GPU, no deps); Torchhd is reserved for a
// research-grade sidecar later. This is the compositional-association layer that
// sits ALONGSIDE the LLM (fluency) + Qdrant/embeddings (vector memory) in the
// Oracle pipeline — it complements, it does not replace.
//
// Core ops (the whole algebra):
//   bind    = elementwise multiply  (self-inverse for bipolar: a⊗b⊗b = a)
//   bundle  = elementwise add + sign (majority superposition — a SET you can
//             query by similarity; the high-dimensional cousin of the base-6
//             glyphAdd composition)
//   permute = cyclic roll (protect / sequence position; decorrelates yet is
//             exactly invertible)
//   similarity = cosine
//
// A `space` is an item-memory codebook: symbol(name) → a deterministic
// hypervector (seeded by the name), so the same concept always maps to the same
// vector and `cleanup` can recover the nearest symbol from a noisy query. The
// NeuSymMS pattern (facts → role-filler records → compositional recall) is
// `encodeRecord` / `query`.

const DEFAULT_DIM = 2048;

// Deterministic RNG (mulberry32) so symbol vectors + tests are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A random bipolar (±1) hypervector. Pass `seed` for a deterministic vector. */
export function random(dim = DEFAULT_DIM, seed = null) {
  const rng = seed != null ? mulberry32(seed >>> 0) : Math.random;
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = rng() < 0.5 ? -1 : 1;
  return v;
}

/** Bind two hypervectors (elementwise multiply). Self-inverse for bipolar. */
export function bind(a, b) {
  const n = a.length;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = a[i] * b[i];
  return v;
}
export const unbind = bind; // a⊗b⊗b = a for bipolar vectors

/** Bundle (superpose) hypervectors: elementwise sum then sign (majority). */
export function bundle(...vecs) {
  const list = vecs.length === 1 && Array.isArray(vecs[0]) ? vecs[0] : vecs;
  if (!list.length) throw new Error("bundle: need at least one vector");
  const n = list[0].length;
  const acc = new Float32Array(n);
  for (const v of list) for (let i = 0; i < n; i++) acc[i] += v[i];
  const out = new Float32Array(n);
  // Ties (sum===0, only with an even operand count) must break UNBIASED — a
  // constant tie-break biases the vector and creates spurious similarity. Break
  // deterministically by index parity (~half +1, half −1).
  for (let i = 0; i < n; i++) out[i] = acc[i] > 0 ? 1 : acc[i] < 0 ? -1 : (i & 1 ? 1 : -1);
  return out;
}

/** Cyclic-roll permute by `shift` (sequence position / protection). Invertible. */
export function permute(v, shift = 1) {
  const n = v.length;
  const s = (((shift % n) + n) % n);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[(i + s) % n] = v[i];
  return out;
}
export function unpermute(v, shift = 1) { return permute(v, -shift); }

/** Cosine similarity in [-1, 1]. */
export function similarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * An item-memory space: a codebook of symbol → deterministic hypervector, plus
 * the algebra bound to its dimension, plus `cleanup` (nearest-symbol recovery)
 * and the NeuSymMS role-filler record helpers.
 */
export function makeSpace(dim = DEFAULT_DIM) {
  const codebook = new Map();

  function symbol(name) {
    const key = String(name);
    if (!codebook.has(key)) codebook.set(key, random(dim, hashStr(key)));
    return codebook.get(key);
  }

  /** Nearest symbols in the codebook to a (noisy) query vector. */
  function cleanup(query, { topK = 1, threshold = -Infinity } = {}) {
    const scored = [];
    for (const [name, v] of codebook) scored.push({ name, score: similarity(query, v) });
    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score >= threshold).slice(0, topK);
  }

  /**
   * NeuSymMS — encode a fact/record as a bundle of bound role⊗filler pairs.
   * `pairs` is an object { role: fillerName | hypervector }. Returns the record HV.
   */
  function encodeRecord(pairs) {
    const bound = [];
    for (const [role, filler] of Object.entries(pairs || {})) {
      const fv = filler instanceof Float32Array ? filler : symbol(filler);
      bound.push(bind(symbol(role), fv));
    }
    if (!bound.length) throw new Error("encodeRecord: no pairs");
    return bundle(bound);
  }

  /** Query a record by role: unbind the role, clean up to the nearest filler. */
  function query(record, role, opts = {}) {
    const noisy = unbind(record, symbol(role));
    return cleanup(noisy, { topK: 1, ...opts });
  }

  return {
    dim,
    symbol,
    has: (name) => codebook.has(String(name)),
    size: () => codebook.size,
    cleanup,
    encodeRecord,
    query,
    // the algebra, dimension-bound
    random: (seed) => random(dim, seed),
    bind, unbind, bundle, permute, unpermute, similarity,
  };
}

export default { random, bind, unbind, bundle, permute, unpermute, similarity, makeSpace, DEFAULT_DIM };
