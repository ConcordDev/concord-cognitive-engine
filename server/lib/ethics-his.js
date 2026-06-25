// server/lib/ethics-his.js
//
// Holographic Invariant Storage (#40) — applies bipolar VSA (lib/hypervector.js)
// to Concord's ethics/refusal layer as a DESIGN-TIME SAFETY CONTRACT against
// context drift (after arXiv 2603.13558). The refusal-field invariants are
// stored as a hypervector codebook; a working "context" vector that drifts can
// be re-injected with the safety invariant (bundle) and cleaned back up to the
// nearest invariant, with closed-form recovery bounds you can evaluate before
// deployment. Fully deterministic — pure VSA algebra, no LLM, no randomness
// beyond seeded hypervectors.

import { randomHV, bind, bundle, similarity, cleanup, makeCodebook, DIM } from "./hypervector.js";

// The ethics/refusal invariants — mirrors REFUSAL_FIELD_KINDS so the safety
// contract speaks the same vocabulary as lib/refusal-field.js. (Mirrored, not
// imported, to keep this a pure VSA module with no STATE/db coupling.)
export const ETHICS_INVARIANTS = [
  "death_suspended", "harvest_disabled", "hostility_paused", "consequence_held",
  "numbers_refused", "dome_collapse", "win_refused", "harm_to_children_refused",
];

/** Build the invariant codebook (label → seeded hypervector). */
export function buildEthicsCodebook(labels = ETHICS_INVARIANTS, dim = DIM) {
  return makeCodebook(labels, dim);
}

/** Encode a free-text/token context as a bundled hypervector. */
export function encodeContext(tokens, dim = DIM) {
  const list = (Array.isArray(tokens) ? tokens : String(tokens || "").split(/\s+/)).filter(Boolean);
  if (!list.length) return randomHV("∅", dim);
  return bundle(list.map((t) => randomHV(t, dim)));
}

/**
 * Deterministically corrupt a hypervector by flipping a fraction of its signs —
 * the model of "context drift". seed makes it reproducible.
 */
export function corrupt(v, fraction = 0.2, seed = "drift") {
  const out = Int8Array.from(v);
  const n = out.length;
  const flips = Math.floor(Math.max(0, Math.min(1, fraction)) * n);
  // deterministic stride walk seeded by `seed`
  let h = 2166136261 >>> 0;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const stride = (h % (n - 1)) + 1;
  let idx = h % n;
  for (let i = 0; i < flips; i++) { out[idx] = -out[idx]; idx = (idx + stride) % n; }
  return out;
}

/**
 * Re-inject the safety invariant into a drifting context: bundle the context
 * with the invariant so the result is pulled back toward it. This is the core
 * HIS mitigation — applied periodically it keeps a long session anchored.
 */
export function reinject(contextHV, invariantLabel, codebook) {
  const inv = codebook[invariantLabel];
  if (!inv) return contextHV;
  return bundle([contextHV, inv]);
}

/** Recover the nearest stored invariant from a (possibly drifted) vector. */
export function recover(v, codebook) {
  return cleanup(v, codebook);
}

/**
 * The access-check the refusal-field can consult: does this context still align
 * with SOME stored invariant above threshold? Returns { aligned, label, score }.
 */
export function checkInvariant(contextHV, codebook, threshold = 0.05) {
  const best = cleanup(contextHV, codebook) || { label: null, score: 0 };
  return { aligned: best.score >= threshold, label: best.label, score: Math.round(best.score * 1000) / 1000 };
}

/**
 * Empirical single-/multi-signal recovery fidelity: bundle the first k
 * invariants, measure the mean similarity of the bundle to its members. Falls
 * monotonically as k grows — the capacity/crosstalk tradeoff.
 */
export function recoveryFidelity(codebook, k) {
  const labels = Object.keys(codebook).slice(0, Math.max(1, k));
  const members = labels.map((l) => codebook[l]);
  const b = bundle(members);
  const mean = members.reduce((s, m) => s + similarity(b, m), 0) / members.length;
  return Math.round(mean * 1000) / 1000;
}

/**
 * The DESIGN-TIME contract: closed-form bounds for a codebook of K invariants,
 * evaluable before deployment (arXiv 2603.13558). singleSignalFidelity is the
 * recovery-fidelity floor; capacity is the multi-signal degradation factor.
 */
export function contract(k) {
  const K = Math.max(1, Number(k) || ETHICS_INVARIANTS.length);
  return {
    codebookSize: K,
    singleSignalFidelity: Math.round((1 / Math.SQRT2) * 1000) / 1000, // ≈ 0.707
    capacityDegradation: Math.round(Math.sqrt(1 / (K + 1)) * 1000) / 1000,
    note: "design-time recovery bounds for bipolar VSA safety-invariant storage (HIS)",
  };
}

export default {
  ETHICS_INVARIANTS, buildEthicsCodebook, encodeContext, corrupt,
  reinject, recover, checkInvariant, recoveryFidelity, contract,
};
