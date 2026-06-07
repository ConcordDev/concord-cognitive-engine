// server/lib/ecosystem/temperament.js
//
// Wave 7 / Layer 3b — INDIVIDUAL temperament. The species prior (drives.js
// restingDrivesForSpecies) is just the starting distribution; each individual
// carries its OWN mutable temperament vector — a 7-drive Panksepp balance (the
// same DRIVE_KINDS) — shaped by the three biological sources:
//
//   1. inherited prior      — birthTemperament(): blend of parents (stability-gated)
//                             or a seeded sample around the species resting balance.
//   2. developmental tuning — applyDevelopmentalTuning(): early-life experience
//                             reprograms the baseline, age-plasticity-weighted.
//   3. lifelong plasticity  — driftFromFeltPeak(): a high-intensity felt peak (A6)
//                             nudges the matching resting drive, age-scaled. Bounded
//                             so a single event can't rewrite a character; a hard
//                             *year* of peaks can.
//
// COPING STYLE (boldShy / proactiveReactive) is derived from the vector and is the
// individual's grip on the constraint-ladder (A5): a bold/proactive animal routes
// around an obstacle; a shy/reactive one freezes or abandons sooner.
//
// Pure + total. Deterministic: same seed → same vector (idempotent across restart).
// Creatures keep it on motion[m.id].temperament; NPCs/agents round-trip it through
// world_npcs.temperament_json (mig 324) / affect_state.meta_json.
//
//   birthTemperament({ speciesId, parents?, seed, stability? }) -> drives vector
//   copingStyle(temperament)                                    -> { boldShy, proactiveReactive }
//   plasticityAtAge(maturity)                                   -> 0..1
//   applyDevelopmentalTuning(temperament, maturity, expDelta)   -> drives vector
//   driftFromFeltPeak(temperament, peak, maturity)              -> drives vector

import crypto from "crypto";
import { DRIVE_KINDS, restingDrivesForSpecies } from "./drives.js";

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const clamp11 = (x) => Math.max(-1, Math.min(1, Number(x) || 0));

// Per-event drift is intentionally small — character is the integral of many peaks,
// never a single one. A hard year (dozens of high-intensity peaks) accumulates.
const PEAK_DRIFT_BASE = 0.06;
// Sampling spread around the species prior when there are no parents.
const SAMPLE_STD = 0.12;
// How much wider mutation gets when parents disagree (low stability).
const PARENT_MUT_MAX = 0.18;

function sha1Bytes(seed) {
  return crypto.createHash("sha1").update(String(seed)).digest();
}
// Deterministic uniform [0,1) from a seed buffer + offset (npc-generator idiom).
function uniform(buf, offset) {
  const i = ((offset % buf.length) + buf.length) % buf.length;
  const lo = buf[i];
  const hi = buf[(i + 1) % buf.length];
  return ((hi << 8) + lo) / 65536;
}
// Deterministic normal sample via Box-Muller from two uniforms.
function normal(buf, offA, offB, mean = 0, std = 1) {
  const u1 = Math.max(uniform(buf, offA), 1e-9);
  const u2 = uniform(buf, offB);
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + std * z;
}

function blankVector(fill = 0.3) {
  const o = {};
  for (const k of DRIVE_KINDS) o[k] = fill;
  return o;
}
function completeVector(partial, fallback) {
  const out = {};
  for (const k of DRIVE_KINDS) {
    const v = Number(partial?.[k]);
    out[k] = Number.isFinite(v) ? clamp01(v) : clamp01(fallback?.[k] ?? 0.3);
  }
  return out;
}

/**
 * Mean absolute agreement between two drive vectors → 0..1 stability proxy
 * (1 = identical, 0 = maximally divergent). Used to gate mutation width when
 * blending parents: similar parents breed-true, divergent parents → wider variation.
 */
function vectorStability(a, b) {
  let sum = 0;
  for (const k of DRIVE_KINDS) sum += Math.abs(clamp01(a?.[k]) - clamp01(b?.[k]));
  const meanDiff = sum / DRIVE_KINDS.length;
  return clamp01(1 - meanDiff);
}

/**
 * Birth an individual temperament vector.
 *   - parents present (array of 1+ temperament vectors): blend (mean), then apply
 *     seeded mutation whose width scales with (1 - stability). High stability (parents
 *     agree) → child resembles parents closely; low → wider spread. Two children of
 *     the same parents get different-but-correlated vectors (different seed offset).
 *   - no parents: sample around restingDrivesForSpecies(speciesId) with SAMPLE_STD.
 * Deterministic on `seed`. Total.
 */
export function birthTemperament({ speciesId, parents = null, seed = null, stability = null } = {}) {
  const key = seed != null ? String(seed) : `${speciesId || "unknown"}|${Math.random()}`;
  const buf = sha1Bytes(key);
  const list = Array.isArray(parents) ? parents.filter((p) => p && typeof p === "object") : [];

  if (list.length > 0) {
    // blend: mean of parent vectors
    const mean = blankVector(0);
    for (const k of DRIVE_KINDS) {
      let s = 0;
      for (const p of list) s += clamp01(p[k]);
      mean[k] = s / list.length;
    }
    // stability: explicit, else derived from how much the parents agree (2-parent
    // case uses pairwise agreement; single parent breeds nearly true).
    let stab = (stability != null && Number.isFinite(Number(stability))) ? clamp01(stability)
      : list.length >= 2 ? vectorStability(list[0], list[1]) : 0.9;
    const mutWidth = PARENT_MUT_MAX * (1 - stab);
    const out = {};
    let off = 0;
    for (const k of DRIVE_KINDS) {
      out[k] = clamp01(normal(buf, off, off + 1, mean[k], mutWidth));
      off += 2;
    }
    return out;
  }

  // no parents → sample around the species prior
  const prior = restingDrivesForSpecies(speciesId);
  const out = {};
  let off = 0;
  for (const k of DRIVE_KINDS) {
    out[k] = clamp01(normal(buf, off, off + 1, clamp01(prior[k]), SAMPLE_STD));
    off += 2;
  }
  return out;
}

/**
 * Derived coping style — what A5's constraint-ladder reads to choose grip.
 *   boldShy          ∈ [-1,1]: + = bold (high SEEKING+RAGE, low FEAR), − = shy.
 *   proactiveReactive∈ [-1,1]: + = proactive (acts on the world), − = reactive (waits/flees).
 * Pure/total.
 */
export function copingStyle(temperament) {
  const t = completeVector(temperament, blankVector());
  const boldShy = clamp11(
    0.6 * t.SEEKING + 0.4 * t.RAGE - 0.7 * t.FEAR - 0.3 * t.PANIC,
  );
  const proactiveReactive = clamp11(
    0.5 * t.SEEKING + 0.5 * t.RAGE - 0.5 * t.FEAR - 0.5 * t.PANIC + 0.1 * t.PLAY,
  );
  return { boldShy, proactiveReactive };
}

/**
 * Age plasticity: how much experience reprograms the baseline. Infants are soft
 * clay (~0.8), adults nearly set (~0.05). `maturity` ∈ [0,1] (0 = newborn, 1 = adult).
 * Smooth monotone decay. Total.
 */
export function plasticityAtAge(maturity) {
  const m = clamp01(maturity);
  // 0.8 at m=0 → ~0.05 at m=1, convex (most plasticity is spent early).
  return 0.05 + 0.75 * Math.pow(1 - m, 2);
}

/**
 * Developmental tuning — early-life programming. Shift the temperament toward
 * `experienceDelta` (a partial drive vector of signed nudges), weighted by age
 * plasticity. A cub raised under constant threat (FEAR delta) becomes a fearful
 * adult; the same experience barely moves a grown animal. Pure (returns new vector).
 */
export function applyDevelopmentalTuning(temperament, maturity, experienceDelta = {}) {
  const t = completeVector(temperament, blankVector());
  const w = plasticityAtAge(maturity);
  const out = {};
  for (const k of DRIVE_KINDS) {
    const d = Number(experienceDelta?.[k]) || 0;
    out[k] = clamp01(t[k] + d * w);
  }
  return out;
}

/**
 * The plasticity mechanism (called by A6 felt-per). A high-intensity felt peak
 * nudges the matching resting drive: a lost fight (high-FEAR peak) raises resting
 * FEAR; a triumphant hunt (SEEKING/RAGE peak) raises those. Scaled by intensity ×
 * age plasticity, bounded by PEAK_DRIFT_BASE so no single event rewrites a character.
 *
 * @param {object} temperament  current individual vector
 * @param {object} peak         { dominantDrive?, intensity (0..1), valence? }
 * @param {number} maturity     0..1
 * @returns new temperament vector
 */
export function driftFromFeltPeak(temperament, peak, maturity) {
  const t = completeVector(temperament, blankVector());
  const drive = peak?.dominantDrive;
  const intensity = clamp01(peak?.intensity);
  if (!drive || !DRIVE_KINDS.includes(drive) || intensity <= 0) return t;
  const w = plasticityAtAge(maturity);
  const out = { ...t };
  out[drive] = clamp01(t[drive] + PEAK_DRIFT_BASE * intensity * w);
  return out;
}

export const _internal = { PEAK_DRIFT_BASE, SAMPLE_STD, PARENT_MUT_MAX, vectorStability };
