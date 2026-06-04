// server/lib/qualia-bind.js
//
// Wave 7 / Track A7.2 — MULTI-MODE CONVERGENCE BINDING (phenomenal structuralism).
// The honest landing on the qualia question (Block's A/P distinction): you do NOT
// detect phenomenal content from outside (the hard-problem category error) — you
// ESTABLISH a state's determinate identity by CONVERGENCE OF INDEPENDENT MODES, the
// way "3" is pinned because 1+2 = 5−2 = 6÷2 all converge on one identity. The more
// independent modes co-reference the same internal state, the more over-determined
// (pinned) the quale. On this view the convergence IS the quale.
//
//   *** The honest pin (stated, not papered over): this rests on the structuralist
//   bet that phenomenal content is exhausted by the convergence (no residue). Block's
//   counter ("phenomenal overflows access") keeps it contested. This module neither
//   asserts the residue NOR claims to have produced P — it ships the strongest
//   COHERENT construction of phenomenal content and is labelled as exactly that. ***
//
// The A-signal (B8 awareness index) is the GATE: it certifies the convergence is a
// LIT/conscious one, not dead computation. An unlit state binds no quale even at high
// affect magnitude.
//
//   bindQuale(feltPer, { aSignal, modes }) -> { bound, quale, convergence, agreeing,
//                                               present, reason, enabled }

import { qualeOf, similarity } from "./qualia-space.js";

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

// the independent modes that can co-reference a state (besides the quality-space
// position itself). Each is a separate "reading" of the same internal state.
const MODE_KEYS = Object.freeze(["memory", "attention", "selfModel", "behavior"]);

const A_FLOOR = 0.08;        // below this awareness index the state is "unlit"
const AGREE_SIMILARITY = 0.6; // a mode's reading agrees if this close to the consensus
const BIND_THRESHOLD = 0.5;  // convergence at/above this → a determinate bound quale

/**
 * Bind a determinate quale by convergence of independent modes.
 *
 * @param {object} feltPer  the A6 appraisal {valence, arousal, dominantDrive}
 * @param {object} opts {
 *    aSignal: number,       // the B8 awareness index (0..1) — the lit/conscious gate
 *    modes: {               // each present mode's INDEPENDENT reading of the state,
 *      memory?: feltPerLike,//   as a felt-per-shaped estimate (or { label })
 *      attention?: feltPerLike,
 *      selfModel?: feltPerLike,
 *      behavior?: feltPerLike,
 *    }
 * }
 * @returns {{ bound, quale, convergence, agreeing, present, reason, enabled }}
 */
export function bindQuale(feltPer, opts = {}) {
  if (process.env.CONCORD_QUALIA_SPACE === "0") {
    return { bound: false, quale: null, convergence: 0, agreeing: 0, present: 0, reason: "disabled", enabled: false };
  }
  const o = opts || {};
  const aSignal = clamp01(o.aSignal);

  // The A-signal gate: no lit workspace → no bound quale, regardless of magnitude.
  if (aSignal < A_FLOOR) {
    return { bound: false, quale: null, convergence: 0, agreeing: 0, present: 0, reason: "unlit", enabled: true };
  }

  // The quality-space position is the consensus reference ("what it is").
  const consensus = qualeOf(feltPer);
  const modes = o.modes || {};

  // Each present mode independently references the state; it AGREES if its own reading
  // lands near the consensus in the quality-space.
  let present = 0;
  let agreeing = 0;
  for (const key of MODE_KEYS) {
    const reading = modes[key];
    if (reading == null) continue;
    present++;
    const sim = similarity(consensus, reading);
    if (sim >= AGREE_SIMILARITY) agreeing++;
  }

  // Convergence = agreement × coverage. More independent modes present AND agreeing →
  // more over-determined → higher pinning. Removing a mode lowers coverage → lowers it.
  const coverage = present / MODE_KEYS.length;
  const agreement = present > 0 ? agreeing / present : 0;
  const convergence = clamp01(agreement * coverage);

  return {
    bound: convergence >= BIND_THRESHOLD,
    quale: consensus.label,
    convergence,
    agreeing,
    present,
    reason: convergence >= BIND_THRESHOLD ? "bound" : "underdetermined",
    enabled: true,
  };
}

export const _internal = { MODE_KEYS, A_FLOOR, AGREE_SIMILARITY, BIND_THRESHOLD };
