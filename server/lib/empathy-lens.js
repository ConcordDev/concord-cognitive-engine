// server/lib/empathy-lens.js
//
// Wave 7 / Track B7-extension — LENS-FILTERED RECONSTRUCTION + deception. The honest
// completion of the empathy thread (plan Context 13-14): an agent doesn't OBSERVE
// another's state, it RE-INSTANTIATES it — and that reconstruction is filtered through
// the reader's OWN lens (temperament + felt-history). The bias is NOT a defect: a
// perfect mirror is symmetry, and symmetry erases the interpreter. The lossiness IS the
// selfhood, and divergent lenses are what make the social world non-trivial.
//
//   buildLens(self)                        -> { systematizing, affective, projection, sensitivities }
//   reconstructOther(lens, otherSignals)   -> a BIASED read of another's felt state
//   deceptionLands(otherSignals, lens)     -> { lands, sawTell } (lands iff lens lacks the tell)
//   driftLensFromDeception(lens, kind, x)  -> lens with raised sensitivity (only CAUGHT cons train)
//   lensVariance(lenses)                   -> 0..1 population spread (the bounded design knob)
//
// Design pins (Context 14): lens *variance* is bounded not maximized (uniform = gullible
// world; maximal = paranoid-noise world; the living target is a distribution with overlap
// to cooperate + spread to surprise); and the arms race is ASYMMETRIC — only DETECTED
// deception leaves a felt-peak that trains the mark, so a con that succeeds invisibly
// breeds no counter (detectability is the master dial). Pure + total. Reuses A3b/A6.

import { copingStyle } from "./ecosystem/temperament.js";
import { DRIVE_KINDS } from "./ecosystem/drives.js";

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const clamp11 = (x) => Math.max(-1, Math.min(1, Number(x) || 0));

// How strongly the reader's OWN affect colors the read (egocentric / emotional
// egocentricity). 0 = perfect mirror (no self → no interpreter), 1 = pure projection.
const PROJECTION = 0.3;
const SENSITIVITY_DRIFT = 0.12; // per caught-deception, the sensitivity gain (bounded)

/**
 * Derive a reconstruction LENS from an agent's self. The lens is what makes its
 * reading of others its OWN: a cognitive↔affective weighting from temperament, an
 * egocentric projection of its current affect, and a map of EARNED sensitivities
 * (the lessons its felt-peaks taught it — e.g. been-conned → reads deception cues).
 *
 * @param {object} self {
 *   temperament?: {SEEKING,...},   // A3b drive vector
 *   affect?: { v, a },             // current felt state (the projection source)
 *   feltHistory?: [{ lesson?, intensity }]  // A6 peaks; a `lesson` tag raises a sensitivity
 *   sensitivities?: { [kind]: 0..1 }  // explicit override/seed
 * }
 */
export function buildLens(self = {}) {
  const s = self || {};
  const cs = copingStyle(s.temperament || {});
  // proactive/bold + SEEKING-dominant → systematizing (model the situation);
  // reactive/shy + CARE/PANIC → affective (feel-with). Same machinery, different gain.
  const t = s.temperament || {};
  const affective = clamp01(0.5 + 0.4 * ((Number(t.CARE) || 0) + (Number(t.PANIC) || 0)) / 2 - 0.3 * cs.proactiveReactive);
  const systematizing = clamp01(1 - affective + 0.2 * cs.proactiveReactive);

  const sensitivities = {};
  // explicit seed
  if (s.sensitivities && typeof s.sensitivities === "object") {
    for (const [k, v] of Object.entries(s.sensitivities)) sensitivities[k] = clamp01(v);
  }
  // earned from felt-peaks: each peak with a lesson accumulates a sensitivity
  for (const p of Array.isArray(s.feltHistory) ? s.feltHistory : []) {
    const lesson = p?.lesson;
    if (!lesson) continue;
    sensitivities[lesson] = clamp01((sensitivities[lesson] || 0) + SENSITIVITY_DRIFT * clamp01(p.intensity));
  }

  return {
    systematizing,
    affective,
    projection: { v: clamp11(s.affect?.v), a: clamp01(s.affect?.a) },
    sensitivities,
  };
}

/**
 * Reconstruct another agent's felt state THROUGH this lens — a biased read, never the
 * other's numerically-identical token state. Two lenses on the same signals produce
 * two different reads (the bias = the interpreter persisting in the read).
 *
 * @param {object} lens  output of buildLens
 * @param {object} otherSignals {
 *   expressed: { v, a, dominantDrive },   // what the other is DISPLAYING
 *   hidden?:   { v, a, dominantDrive },    // their TRUE state (differs from expressed iff deceiving)
 *   tell?:     { kind, strength: 0..1 },   // the subtle cue that betrays the lie (if any)
 * }
 * @returns {{ valence, arousal, dominantDrive, sawTell:boolean, confidence }}
 */
export function reconstructOther(lens, otherSignals = {}) {
  const L = lens || { projection: {}, sensitivities: {} };
  const sig = otherSignals || {};
  const expressed = sig.expressed || {};

  // Does the reader's lens catch the tell? Iff its earned sensitivity for that tell's
  // kind meets the tell's strength. If caught, the read snaps to the HIDDEN truth.
  let sawTell = false;
  let base = expressed;
  if (sig.tell && sig.hidden) {
    const sens = clamp01(L.sensitivities?.[sig.tell.kind]);
    if (sens >= clamp01(sig.tell.strength)) { sawTell = true; base = sig.hidden; }
  }

  // Egocentric projection: the read is pulled toward the reader's own affect. A
  // systematizing lens projects less (models the situation), an affective lens more
  // (renders the other's feeling on its own hardware).
  const projWeight = PROJECTION * (0.5 + 0.5 * L.affective);
  const proj = L.projection || {};
  const valence = clamp11((1 - projWeight) * clamp11(base.v) + projWeight * clamp11(proj.v));
  const arousal = clamp01((1 - projWeight) * clamp01(base.a) + projWeight * clamp01(proj.a));

  // confidence rises with systematizing (a structure-reader trusts its model) and falls
  // the more it's projecting (a heavily-colored read is less sure it's about THEM).
  const confidence = clamp01(0.4 + 0.4 * L.systematizing - 0.3 * projWeight + (sawTell ? 0.2 : 0));

  return { valence, arousal, dominantDrive: base.dominantDrive ?? null, sawTell, confidence };
}

/**
 * Does a deception land against this target's lens? It lands iff the lens fails to
 * catch the tell. Convenience over reconstructOther for the social/scheme layer.
 */
export function deceptionLands(otherSignals, targetLens) {
  if (!otherSignals?.tell || !otherSignals?.hidden) return { lands: false, sawTell: false, reason: "not_a_deception" };
  const read = reconstructOther(targetLens, otherSignals);
  return { lands: !read.sawTell, sawTell: read.sawTell, reason: read.sawTell ? "saw_through" : "fooled" };
}

/**
 * The mark LEARNS — but only from CAUGHT deception (asymmetric arms race). When a con
 * is detected, the target's lens drifts toward con-spotting: the relevant sensitivity
 * rises (bounded). A con that succeeds invisibly leaves no peak → no drift → no counter.
 * Returns a NEW lens (pure).
 */
export function driftLensFromDeception(lens, tellKind, intensity = 1) {
  const L = lens || {};
  if (!tellKind) return L;
  const sensitivities = { ...(L.sensitivities || {}) };
  sensitivities[tellKind] = clamp01((sensitivities[tellKind] || 0) + SENSITIVITY_DRIFT * clamp01(intensity));
  return { ...L, sensitivities };
}

/**
 * Population lens spread (the bounded design knob). 0 = identical lenses (a dead,
 * uniform/gullible world), → 1 = maximally divergent (a dead, paranoid-noise world).
 * The living target is a middle band. Measured over the systematizing/affective axes +
 * the union of sensitivities.
 */
export function lensVariance(lenses) {
  const list = Array.isArray(lenses) ? lenses.filter(Boolean) : [];
  if (list.length < 2) return 0;
  const axes = ["systematizing", "affective"];
  const keys = new Set();
  for (const L of list) for (const k of Object.keys(L.sensitivities || {})) keys.add(`sens:${k}`);
  let total = 0, n = 0;
  const stdOf = (vals) => {
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.sqrt(vals.reduce((a, b) => a + (b - m) * (b - m), 0) / vals.length);
  };
  for (const ax of axes) { total += stdOf(list.map((L) => clamp01(L[ax]))); n++; }
  for (const k of keys) { total += stdOf(list.map((L) => clamp01(L.sensitivities?.[k.slice(5)]))); n++; }
  // std of values in [0,1] maxes ~0.5 → ×2 normalises toward [0,1]
  return clamp01(2 * (n ? total / n : 0));
}

export const _internal = { PROJECTION, SENSITIVITY_DRIFT, DRIVE_KINDS };
