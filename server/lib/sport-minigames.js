// server/lib/sport-minigames.js
//
// WAVE JOBS — per-sport skill-minigames as CONTENT PACKS over ONE engine. Each
// sport is a thin pack (attribute key + input type + a scoreInput that maps the
// player's raw timing/aim into a 0..1 skillInput); the shared ActionResolver
// (career-fidelity.js) does the actual resolve, so the floor-gated band + the
// 2K "can't green a bad shot" rule hold uniformly. Brawl proves the pattern.
// Pure; add a sport = add a row. Behind CONCORD_LIVING_CAREER.

import { resolveAction } from "./career-fidelity.js";

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
// A timing-window score: 1.0 at perfect (error 0), linear to 0 at ±window.
const timingScore = (errorMs, windowMs) => clamp01(1 - Math.abs(Number(errorMs) || 0) / Math.max(1, windowMs));

export const MINIGAMES = Object.freeze({
  // basketball: tap inside the shot-release window
  shot_timing:   { sport: "basketball", attribute: "shooting", input: "timing", windowMs: 140, scoreInput: (raw) => timingScore(raw.errorMs, 140) },
  // baseball: a pitch-meter (timing) × PCI placement (aim) — both matter
  pitch_meter:   { sport: "baseball", attribute: "batting", input: "timing+aim", windowMs: 120, scoreInput: (raw) => clamp01(0.6 * timingScore(raw.errorMs, 120) + 0.4 * (1 - clamp01(raw.aimError))) },
  // soccer: pass-power meter (hold to a target band)
  pass_power:    { sport: "soccer", attribute: "passing", input: "power", windowMs: 0, scoreInput: (raw) => clamp01(1 - Math.abs(clamp01(raw.power) - clamp01(raw.targetPower))) },
  // boxing/brawl: punch-stick direction + timing
  punch_stick:   { sport: "boxing", attribute: "striking", input: "stick+timing", windowMs: 160, scoreInput: (raw) => clamp01(0.5 * timingScore(raw.errorMs, 160) + 0.5 * clamp01(raw.aimAccuracy)) },
});

export function isMinigame(id) { return Object.prototype.hasOwnProperty.call(MINIGAMES, id); }

/** Map a player's raw input for a minigame to the 0..1 skillInput. */
export function scoreInput(minigameId, raw = {}) {
  const mg = MINIGAMES[minigameId];
  if (!mg) return 0;
  try { return clamp01(mg.scoreInput(raw)); } catch { return 0; }
}

/**
 * Resolve a minigame attempt: the pack maps raw input → skillInput, the shared
 * ActionResolver applies the attribute floor-gated band → a performanceScore the
 * career-engine pays + XPs. `attribute` is the player's stat for this sport.
 * @returns {{ minigame:string, sport:string, performanceScore:number, floor:number, ceiling:number, skillInput:number }}
 */
export function resolveMinigame(minigameId, { attribute = 0.5, raw = {} } = {}) {
  const mg = MINIGAMES[minigameId];
  if (!mg) return { minigame: minigameId, sport: null, performanceScore: 0, floor: 0, ceiling: 0, skillInput: 0 };
  const skillInput = scoreInput(minigameId, raw);
  const r = resolveAction({ attribute, skillInput });
  return { minigame: minigameId, sport: mg.sport, performanceScore: r.outcome, floor: r.floor, ceiling: r.ceiling, skillInput };
}
