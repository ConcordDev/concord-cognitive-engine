// server/lib/ecosystem/core-affect.js
//
// Wave 7 / Layer 2 — core affect (Damasio: feeling is the brain's readout of
// body/homeostatic state). Folds the umwelt-filtered signal salience (Layer 1) +
// homeostatic needs (creature-needs.js) + somatic pain + predator proximity into a
// single 2D point: valence × arousal. This is the cheap, always-on number the
// instinct loop runs on — "is my affect in the normal band?" — and the spike of
// which (Layer 5) is the interrupt that wakes deliberation.
//
//   computeCoreAffect(perceived, needs, ctx, prior?) -> { v: [-1,1], a: [0,1] }
//
// Pure + total. Mirrors the affect/engine.js v/a semantics (valence, arousal) but
// is a STATE readout (fold), not the event-delta engine — creatures only need the
// 2D core, computed fresh each flock pass and kept in-memory on STATE.creatureMotion.

import { CREATURE_NEED_KINDS } from "./creature-needs.js";

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const clamp11 = (x) => Math.max(-1, Math.min(1, Number(x) || 0));

const SMOOTH = 0.3; // hysteresis toward the prior reading (cheap momentum)

/**
 * @param {object} perceived  output of umwelt.perceiveSignals — uses .salience (0..1)
 * @param {object} needs       normalized creature needs (0..1 deficits)
 * @param {object} [ctx]       { predatorNear:bool, predatorDist:number, painIntensity:0..1, isHunting:bool }
 * @param {object|null} [prior] previous { v, a } for smoothing
 * @returns {{ v:number, a:number }}
 */
export function computeCoreAffect(perceived, needs, ctx = {}, prior = null) {
  const salience = clamp01(perceived?.salience);
  const c = ctx || {};
  const pain = clamp01(c.painIntensity);
  const predatorNear = !!c.predatorNear;
  const isHunting = !!c.isHunting;

  // need pressures
  let sum = 0, max = 0, count = 0;
  for (const k of CREATURE_NEED_KINDS) {
    const p = clamp01(needs?.[k]);
    sum += p; max = Math.max(max, p); count++;
  }
  const meanDeficit = count > 0 ? sum / count : 0;
  const maxNeedPressure = max;

  // Arousal: perceived salience + need pressure + pain + acute predator threat.
  let a = clamp01(
    0.45 * salience +
    0.30 * maxNeedPressure +
    0.20 * pain +
    (predatorNear ? 0.4 : 0),
  );

  // Valence: well-fed/safe → positive; deficits/pain/predator → negative.
  // (1 - meanDeficit) gives 1.0 when every need is satisfied, 0 when starving.
  // Acute predator presence is strongly aversive (the FEAR signal) — it dominates
  // valence even when homeostasis is otherwise fine.
  let v = clamp11(
    (1 - meanDeficit) - 0.6 * pain - (predatorNear ? 0.7 : 0) + (isHunting ? 0.1 : 0),
  );

  // Smooth toward the prior reading so affect has inertia (no per-pass flicker).
  if (prior && Number.isFinite(prior.v) && Number.isFinite(prior.a)) {
    v = clamp11(prior.v + (v - prior.v) * (1 - SMOOTH));
    a = clamp01(prior.a + (a - prior.a) * (1 - SMOOTH));
  }

  return { v, a };
}

export const _internal = { SMOOTH };
