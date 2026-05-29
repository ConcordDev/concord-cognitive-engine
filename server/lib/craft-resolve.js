// server/lib/craft-resolve.js
//
// Living Society — Phase 0: the SINGLE craft-resolve all crafting systems call.
//
// Output quality is derived from input resource PROPERTIES (Phase 0
// resources.js) + player skill + station quality + an optional risk choice —
// not a hardcoded scalar. This is what makes UGC grounded + balanced: a beginner
// crafts basics immediately; a god-tier output needs rare-tier mats + a power
// source (soul gem / aether / essence) + skill + station, and may risk a
// backfire. Failure is SOFT (wasted mats + a minor debuff), never a hard lock.
//
// Deterministic: given the same inputs + seed, the same result — so it's
// contract-testable and has no RNG in the resolution path (the backfire roll is
// a seeded hash). The Concordia twist on BotW's "mixed effects cancel": instead
// of no-effect, CONFLICTING affinities lower STABILITY → a backfire chance.

import crypto from "node:crypto";
import { propsFor } from "./resources.js";

// Tunables (env-overridable; documented in docs/BALANCE_DIALS.md).
const SKILL_WEIGHT   = Number(process.env.CONCORD_CRAFT_SKILL_WEIGHT)   || 20; // max +potency from skill 100
const STATION_WEIGHT = Number(process.env.CONCORD_CRAFT_STATION_WEIGHT) || 15; // max +potency from station 100
const INPUT_WEIGHT   = Number(process.env.CONCORD_CRAFT_INPUT_WEIGHT)   || 0.7; // share of output from input potency
const CONFLICT_PENALTY = Number(process.env.CONCORD_CRAFT_CONFLICT_PENALTY) || 18; // stability lost per extra affinity
const POWER_BONUS    = Number(process.env.CONCORD_CRAFT_POWER_BONUS)    || 0.25; // magical-fuel potency multiplier

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/** Normalize one input entry to { props, qty }. */
function _resolveInput(entry, db) {
  if (!entry) return null;
  const itemId = typeof entry === "string" ? entry : entry.itemId;
  if (!itemId) return null;
  const qty = typeof entry === "string" ? 1 : Math.max(1, Number(entry.qty) || 1);
  const props = propsFor(itemId, { db: db || null, overrideJson: entry?.overrideJson || null });
  return { itemId, qty, props };
}

/**
 * Resolve a craft. Pure given (inputs, recipe, skill, station, risk, seed).
 * @param inputs       array of itemId strings or { itemId, qty, overrideJson }
 * @param recipe       { minPotency?, intendedAffinity?, name? } (optional gating)
 * @param playerSkill  0..100
 * @param stationQuality 0..100
 * @param risk         0..1 — how much the crafter pushes potency at backfire cost
 * @param seed         string — deterministic backfire roll (defaults to a hash of inputs)
 * @param db           optional better-sqlite3 (DB-backed property overrides)
 * @returns { ok, outputPotency, outputAffinity, outputStability, qualityMultiplier,
 *            backfireChance, failed, debuff?, reason? }
 */
export function resolveCraft({ inputs = [], recipe = {}, playerSkill = 0, stationQuality = 0, risk = 0, seed = null, db = null } = {}) {
  const resolved = inputs.map((e) => _resolveInput(e, db)).filter(Boolean);
  if (resolved.length === 0) return { ok: false, reason: "no_inputs" };

  const skill = clamp(Number(playerSkill) || 0, 0, 100);
  const station = clamp(Number(stationQuality) || 0, 0, 100);
  const riskF = clamp(Number(risk) || 0, 0, 1);

  // ── Potency: weighted input potency + skill + station + magical-fuel bonus ──
  let totalQty = 0, wPotency = 0, wStability = 0;
  const affinityPotency = {};   // affinity → summed potency (for dominant)
  let powerFuel = 0;            // bonus potency from magical sub-tier inputs
  for (const r of resolved) {
    totalQty += r.qty;
    wPotency += r.props.potency * r.qty;
    wStability += r.props.stability * r.qty;
    affinityPotency[r.props.affinity] = (affinityPotency[r.props.affinity] || 0) + r.props.potency * r.qty;
    if (r.props.magical_sub) powerFuel += r.props.potency * r.qty * POWER_BONUS;
  }
  const avgPotency = wPotency / totalQty;
  const avgStability = wStability / totalQty;
  const fuelBonus = powerFuel / totalQty;

  // risk pushes potency up but stability down (the "push it" lever).
  const outputPotency = clamp(
    avgPotency * INPUT_WEIGHT + (skill / 100) * SKILL_WEIGHT + (station / 100) * STATION_WEIGHT
      + fuelBonus + riskF * 10,
    0, 100,
  );

  // ── Affinity cascade: dominant = affinity with the most summed potency ──
  const affinities = Object.keys(affinityPotency);
  const outputAffinity = affinities.reduce((a, b) => (affinityPotency[b] > (affinityPotency[a] ?? -1) ? b : a), affinities[0]);

  // ── Stability: base avg, minus conflict penalty per EXTRA affinity, minus risk ──
  const conflict = Math.max(0, affinities.length - 1) * CONFLICT_PENALTY;
  const outputStability = clamp(avgStability - conflict - riskF * 25, 0, 100);

  // ── Backfire chance from instability; deterministic seeded roll ──
  const backfireChance = clamp((100 - outputStability) / 100, 0, 1);
  const rollSeed = seed || resolved.map((r) => `${r.itemId}:${r.qty}`).join("|") + `|${skill}|${station}|${riskF}`;
  const rollByte = crypto.createHash("sha1").update(String(rollSeed)).digest()[0]; // 0..255
  const roll = rollByte / 255; // deterministic 0..1
  const failed = roll < backfireChance;

  // ── Potency floor: god-tier output gated behind strong-enough mats (soft) ──
  const minPotency = Number(recipe?.minPotency) || 0;
  if (!failed && minPotency > 0 && outputPotency < minPotency) {
    return {
      ok: true, failed: true, reason: "potency_floor_not_met",
      outputPotency, outputAffinity, outputStability, backfireChance,
      qualityMultiplier: 0.5, // fizzle — minimal output, mats consumed (soft)
      debuff: { effect_id: "craft_fizzle", magnitude: 0.05, durationMs: 60_000 },
    };
  }

  if (failed) {
    // Soft failure: wasted mats + a minor debuff scaled by how unstable it was.
    return {
      ok: true, failed: true, reason: "backfire",
      outputPotency, outputAffinity, outputStability, backfireChance,
      qualityMultiplier: 0.5,
      debuff: { effect_id: "craft_backfire", magnitude: clamp(0.05 + backfireChance * 0.2, 0.05, 0.25), durationMs: 120_000 },
    };
  }

  // Map output potency → the existing executeCraft qualityMultiplier range [0.5, 2.0]
  // so wrapping the 5 systems is a drop-in (potency 0→0.5×, 50→1.25×, 100→2.0×).
  const qualityMultiplier = clamp(0.5 + (outputPotency / 100) * 1.5, 0.5, 2.0);

  return {
    ok: true, failed: false,
    outputPotency: Math.round(outputPotency * 10) / 10,
    outputAffinity,
    outputStability: Math.round(outputStability * 10) / 10,
    backfireChance: Math.round(backfireChance * 100) / 100,
    qualityMultiplier: Math.round(qualityMultiplier * 1000) / 1000,
  };
}

export const CRAFT_RESOLVE_CONSTANTS = Object.freeze({
  SKILL_WEIGHT, STATION_WEIGHT, INPUT_WEIGHT, CONFLICT_PENALTY, POWER_BONUS,
});
