// server/lib/ecosystem/food-web.js
//
// Animal Kingdom — the SYSTEMIC layer over the existing fauna substrate
// (spawner + boids + needs + loot). The pieces existed (species with a
// `lifestyle`, boids that flock, a needs/intent model, carcass loot) but nothing
// linked them into a *system*: there were no trophic edges (who-eats-whom) and
// no population-balance rule, so a biome was a set of independent point-clouds,
// not a food chain. This module adds:
//
//   1. TROPHIC LINKS — predator → prey edges derived from lifestyle + a size
//      rank (a wolf eats deer/rabbit/boar; a hawk eats only small prey), with a
//      small explicit override table for the canonical pairs. Deterministic,
//      scales to flavor species (novel ids fall through to the size heuristic).
//   2. POPULATION BALANCE — a *damped* Lotka–Volterra rule: too many predators +
//      a crashed prey population pushes predator targets DOWN (starvation) and
//      lets prey recover over cycles; too few predators lets prey overgrow, which
//      in turn supports more predators. Bounded multipliers so it self-corrects
//      toward equilibrium instead of oscillating to extinction (the classic
//      naive-LV failure).
//
// Pure + total (no DB, no throw) so it unit-tests cleanly and the spawner /
// flock cycle can call it inline. The behaviour wiring (predator-awareness flee,
// hunt steering, predation kills) lives in creature-behaviors.js; this module is
// the data + the math it steers on.

import { speciesForBiome, lifestyleForSpecies } from "./loot-tables.js";

// Relative size rank — a predator only preys on species ranked strictly below
// it. Keyed by species id; unknown ids fall through to a lifestyle default.
const SIZE_RANK = Object.freeze({
  // small prey
  rabbit: 1, fish: 1, sandsong_finch: 1, shimmer_finch: 1, plasma_pigeon: 1,
  wire_corvid: 1, trail_falcon: 1, crab: 1, sand_scorpion: 1, drone_rat: 1, dock_rat: 1,
  // mid prey / omnivores
  deer: 3, goat: 3, boar: 3, kraal_buck: 3, sangmoth: 3, drift_stag: 3,
  wraith_deer: 3, moonbloom_sprite: 2, star_seed_kin: 2, alley_cat: 2,
  // mid predators
  wolf: 4, hawk: 2, dust_jackal: 3, desert_snake: 2, reef_eel: 3,
  walker_hound: 4, meta_coyote: 4, cliff_condor: 3, archive_owl: 2,
  // apex
  bear: 6, reef_shark: 6, deep_octopus: 5,
});

const LIFESTYLE_DEFAULT_RANK = { carnivore: 4, omnivore: 3, herbivore: 2 };

// Explicit canonical predator → prey edges. When present they're authoritative
// (a wolf eats these regardless of the size heuristic); they DON'T restrict the
// heuristic from adding biome-appropriate extras.
const TROPHIC_OVERRIDES = Object.freeze({
  wolf: ["deer", "rabbit", "boar"],
  bear: ["deer", "goat", "boar"],
  hawk: ["rabbit"],
  dust_jackal: ["desert_snake", "sandsong_finch"],
  reef_shark: ["fish", "crab", "reef_eel"],
  reef_eel: ["fish"],
  deep_octopus: ["fish", "crab"],
  walker_hound: ["deer", "rabbit"],
  meta_coyote: ["plasma_pigeon"],
  archive_owl: ["wraith_deer"],
});

/** Numeric size rank for a species (table → lifestyle default → 3). */
export function sizeRankOf(speciesId, lifestyle = null) {
  if (speciesId && SIZE_RANK[speciesId] != null) return SIZE_RANK[speciesId];
  const ls = lifestyle || lifestyleForSpecies(speciesId) || "omnivore";
  return LIFESTYLE_DEFAULT_RANK[ls] ?? 3;
}

/** Is `predId` a predator that eats `preyId`? Pure; uses the roster lifestyles. */
export function eats(predId, preyId) {
  if (!predId || !preyId || predId === preyId) return false;
  const ovr = TROPHIC_OVERRIDES[predId];
  if (ovr && ovr.includes(preyId)) return true;
  const predLs = lifestyleForSpecies(predId);
  if (predLs !== "carnivore" && predLs !== "omnivore") return false;
  const preyLs = lifestyleForSpecies(preyId);
  // Predators eat herbivores + omnivores, never another carnivore (no cannibal
  // edges in this model — keeps the web a clean two-trophic-level chain).
  if (preyLs === "carnivore") return false;
  return sizeRankOf(preyId, preyLs) < sizeRankOf(predId, predLs);
}

/**
 * The prey species a predator hunts within a (universe, biome). Override edges
 * first, then any same-biome herbivore/omnivore ranked below the predator.
 * @returns {string[]} prey species ids
 */
export function preyForPredator(universe, biome, predatorId) {
  const roster = safeRoster(universe, biome);
  const out = new Set();
  const ovr = TROPHIC_OVERRIDES[predatorId];
  if (ovr) for (const p of ovr) if (roster.some((s) => s.id === p)) out.add(p);
  for (const s of roster) if (eats(predatorId, s.id)) out.add(s.id);
  return [...out];
}

/** Inverse: predator species that hunt `preyId` in a (universe, biome). */
export function predatorsOf(universe, biome, preyId) {
  const roster = safeRoster(universe, biome);
  return roster.filter((s) => eats(s.id, preyId)).map((s) => s.id);
}

function safeRoster(universe, biome) {
  try {
    const r = speciesForBiome(universe, biome);
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

// ── Damped Lotka–Volterra population balance ────────────────────────────────

const LV_GAIN = Number(process.env.CONCORD_ECOLOGY_LV_GAIN) || 0.3;
const LV_MIN = 0.5; // floor — never starve a tier to extinction in one pass
const LV_MAX = 1.5; // ceiling — never explode a tier in one pass

const clampMult = (x) => Math.max(LV_MIN, Math.min(LV_MAX, Number.isFinite(x) ? x : 1));

/**
 * Damped predator–prey balance. Given live vs target counts for the predator and
 * prey aggregates of a biome, return spawn-target multipliers that nudge the
 * system toward equilibrium:
 *
 *   • predators above target while prey is below target  → predators starve
 *     (predTargetMult < 1); prey stays suppressed until predators thin, then
 *     recovers (preyTargetMult rises as predRatio falls — the LV feedback).
 *   • predators below target while prey overgrows         → predators can grow
 *     (predTargetMult > 1); prey target eases (preyTargetMult ≤ 1).
 *
 * Multipliers are bounded to [0.5, 1.5] per pass so the loop converges instead
 * of oscillating to extinction. Pure + total.
 *
 * @param {{predLive:number,predTarget:number,preyLive:number,preyTarget:number}} p
 * @returns {{predTargetMult:number, preyTargetMult:number, predRatio:number, preyRatio:number, note:string}}
 */
export function balancePopulations({ predLive = 0, predTarget = 0, preyLive = 0, preyTarget = 0 } = {}) {
  // No predators or no prey → nothing to balance; pass through unchanged.
  if (predTarget <= 0 || preyTarget <= 0) {
    return { predTargetMult: 1, preyTargetMult: 1, predRatio: 0, preyRatio: 0, note: "no_trophic_pair" };
  }
  const predRatio = predLive / predTarget;
  const preyRatio = preyLive / preyTarget;

  // Predators grow when prey is abundant, shrink when prey is scarce AND they're
  // already crowded. Prey grows when predators are scarce, shrinks under heavy
  // predation. Each term is a damped deviation-from-equilibrium nudge.
  const predTargetMult = clampMult(1 + LV_GAIN * (preyRatio - 1) - LV_GAIN * (predRatio - 1));
  const preyTargetMult = clampMult(1 - LV_GAIN * (predRatio - 1));

  let note = "stable";
  if (preyRatio < 0.5 && predRatio > 1.2) note = "prey_crash_predators_starve";
  else if (preyRatio > 1.4 && predRatio < 0.8) note = "prey_bloom_predators_grow";
  else if (predRatio > 1.5) note = "predator_excess";

  return { predTargetMult, preyTargetMult, predRatio, preyRatio, note };
}

export const ECOLOGY_TUNING = Object.freeze({ LV_GAIN, LV_MIN, LV_MAX });
