// server/lib/npc-temperament.js
//
// Phase 1 keystone of the Temperament, Restraint & Capture engine
// (docs/TEMPERAMENT_ENGINE_SPEC.md + docs/TEMPERAMENT_BUILD_PLAN.md).
//
// The disposition GATE: reads the NPC nervous system that already exists but was
// never wired to violence — stress + coping traits, grudges, opinions, faction
// relations, family grief/radicalization, CK3 hooks — and MODULATES (never
// replaces) the archetype aggression in npc-simulator.js. The archetype stays
// the floor; emotional/social state decides how far above (or below) it the NPC
// actually sits toward a specific target.
//
// Kill-switch CONCORD_TEMPERAMENT (unset/"0" == archetype-only, byte-identical).
// Every reader is table-guarded: a minimal DB missing these tables degrades to a
// zero modulation, so this is safe to wire anywhere.

import { getStress } from "./npc-stress.js";
import { getRelation } from "./embodied/faction-strategy.js";
import { blocksHostileAction } from "./hooks.js";
import { authorityPressure } from "./authority-heat.js";

// ── kill-switch ──────────────────────────────────────────────────────────────
export function temperamentEnabled() {
  const v = process.env.CONCORD_TEMPERAMENT;
  return v !== "0" && v !== "false";
}

// ── dials (env-overridable — see docs/BALANCE_DIALS.md) ──────────────────────
const num = (env, d) => {
  const v = Number(process.env[env]);
  return Number.isFinite(v) ? v : d;
};
const W = {
  stress: num("CONCORD_TEMP_W_STRESS", 0.4),
  grudge: num("CONCORD_TEMP_W_GRUDGE", 0.6),
  opinion: num("CONCORD_TEMP_W_OPINION", 0.5),
  faction: num("CONCORD_TEMP_W_FACTION", 0.5),
  emotion: num("CONCORD_TEMP_W_EMOTION", 0.5),
  authority: num("CONCORD_TEMP_W_AUTHORITY", 0.7),
};

// Archetypes that enforce the law — the authority term only applies to these.
const AUTHORITY_ARCHETYPES = new Set(["guard", "soldier"]);
// Severe grudge / radicalization lift an *emotional floor* — the one path by
// which a pacifist archetype (farmer aggro 0.0) can be carried into hostility.
const GRUDGE_FLOOR_SEVERITY = num("CONCORD_TEMP_GRUDGE_FLOOR_SEVERITY", 8);
const GRUDGE_FLOOR = num("CONCORD_TEMP_GRUDGE_FLOOR", 0.45);
const RADICALIZED_FLOOR = num("CONCORD_TEMP_RADICALIZED_FLOOR", 0.7);
// Above this effective-aggro a non-pursuing archetype is granted the physical
// capacity to act (radicalization swaps faction, not the AGGRO_PROFILE).
const ENGAGE_THRESHOLD = num("CONCORD_TEMP_ENGAGE_THRESHOLD", 0.4);

// Coping trait → aggro bias. Paranoid over-reads threat, cruel enjoys it,
// reckless lashes out; withdrawn pulls back; drink slightly disinhibits.
const COPING_BIAS = Object.freeze({
  paranoid: 0.25,
  cruel: 0.3,
  reckless: 0.2,
  withdraw: -0.15,
  drink: 0.1,
});

export const DISPOSITION_LEVELS = Object.freeze([
  "friendly",
  "neutral",
  "wary",
  "warning",
  "hostile",
  "lethal",
]);

/**
 * Map an effective-aggro magnitude to a discrete disposition level. Used for
 * observability now; Phase 2 attaches one bark per transition.
 */
export function dispositionLevel(effectiveAggro) {
  const a = Number(effectiveAggro) || 0;
  if (a <= 0.05) return "friendly";
  if (a < 0.3) return "neutral";
  if (a < 0.5) return "wary";
  if (a < 0.7) return "warning";
  if (a < 0.9) return "hostile";
  return "lethal";
}

/**
 * The disposition gate — pure read of the dormant nervous-system state for a
 * (npc → target) pair. Never throws; never writes.
 *
 * @param {Database} db
 * @param {{ id:string, faction?:string }} npc
 * @param {{ kind?:'player'|'npc'|'faction', id:string }} target
 * @param {{ targetFaction?:string }} [opts]  faction of an npc target, for factionTerm
 * @returns {{ mod:number, floor:number, hookCapped:boolean, level:string, terms:object }}
 */
export function disposition(db, npc, target, opts = {}) {
  const terms = {};
  let mod = 0;
  let floor = 0;
  let hookCapped = false;

  if (!db || !npc || !npc.id || !target || !target.id) {
    return { mod, floor, hookCapped, level: "neutral", terms };
  }

  const tKind = target.kind || "player";
  const tId = target.id;

  // stress + coping trait
  try {
    const s = getStress(db, npc.id);
    if (s) {
      const stressNorm = Math.max(0, ((s.stress ?? 30) - 30) / 70); // baseline 30 → 0
      const cope = COPING_BIAS[s.coping_trait] || 0;
      terms.stress = W.stress * stressNorm + cope;
      mod += terms.stress;
    }
  } catch { /* table absent — no contribution */ }

  // grudge severity (+ severe-grudge emotional floor)
  try {
    const g = db
      .prepare(
        `SELECT MAX(severity) AS sev FROM npc_grudges
          WHERE npc_id = ? AND target_kind = ? AND target_id = ?
            AND resolved_at IS NULL`
      )
      .get(npc.id, tKind, tId);
    if (g && g.sev) {
      terms.grudge = W.grudge * (g.sev / 10);
      mod += terms.grudge;
      if (g.sev >= GRUDGE_FLOOR_SEVERITY) floor = Math.max(floor, GRUDGE_FLOOR);
    }
  } catch { /* table absent */ }

  // opinion (score ≤ -50 = "hates" → positive aggro; admiration de-escalates)
  try {
    const o = db
      .prepare(
        `SELECT score FROM character_opinions
          WHERE npc_id = ? AND target_kind = ? AND target_id = ?`
      )
      .get(npc.id, tKind, tId);
    if (o && typeof o.score === "number") {
      terms.opinion = W.opinion * (-o.score / 100); // -100 → +W; +100 → -W
      mod += terms.opinion;
    }
  } catch { /* table absent */ }

  // faction relation (npc targets only — players aren't factions)
  try {
    if (tKind === "npc" && opts.targetFaction && npc.faction) {
      const rel = getRelation(db, npc.faction, opts.targetFaction);
      terms.faction = W.faction * -(rel.score || 0); // enemy(-1) → +W; ally(+1) → -W
      mod += terms.faction;
    }
  } catch { /* table absent */ }

  // family grief + radicalization (the grieving-kin payoff)
  try {
    const row = db
      .prepare(`SELECT grief_level, radicalized FROM world_npcs WHERE id = ?`)
      .get(npc.id);
    if (row) {
      const grief = Math.max(0, Math.min(1, row.grief_level || 0));
      terms.emotion = W.emotion * grief;
      mod += terms.emotion;
      if (row.radicalized) floor = Math.max(floor, RADICALIZED_FLOOR);
    }
  } catch { /* column/table absent */ }

  // authority term — a guard/soldier reads the target's two-meter crime state
  // (slow wanted scalar + fast heat). This is "guards finally read crime."
  try {
    if (opts.worldId && tKind === "player" && AUTHORITY_ARCHETYPES.has(npc.archetype)) {
      const pressure = authorityPressure(db, opts.worldId, tId);
      if (pressure > 0) {
        terms.authority = W.authority * pressure;
        mod += terms.authority;
      }
    }
  } catch { /* law table absent */ }

  // CK3 hook the TARGET holds over the NPC — stays its hand (emotional escalation)
  try {
    if (
      blocksHostileAction(db, {
        plotterKind: "npc",
        plotterId: npc.id,
        targetKind: tKind,
        targetId: tId,
      })
    ) {
      hookCapped = true;
    }
  } catch { /* table absent */ }

  const level = dispositionLevel(effectiveAggroFor(0, false, { mod, floor, hookCapped }));
  return { mod, floor, hookCapped, level, terms };
}

/**
 * Combine the disposition with the archetype base aggro. The archetype is the
 * FLOOR; disposition modulates around it.
 *  - wanted NPCs keep the existing 0.9 floor unchanged (matches today exactly).
 *  - an emotional floor (severe grudge / radicalized) can lift a pacifist.
 *  - a hook the target holds neutralises *emotional escalation* only — a base
 *    hostile stays hostile (full stand-down is the Phase 4 surrender layer).
 */
export function effectiveAggroFor(baseAggro, isWanted, disp) {
  const base = Number(baseAggro) || 0;
  if (isWanted) return 0.9;
  if (!disp) return base;
  let mod = disp.mod || 0;
  let floor = disp.floor || 0;
  if (disp.hookCapped) {
    mod = Math.min(mod, 0); // remove escalation; never amplify
    floor = 0; // leverage cancels the emotional lift
  }
  const lifted = Math.max(base, floor);
  return Math.max(0, Math.min(1, lifted * (1 + mod)));
}

/**
 * A pacifist archetype (pursuitRadius 0 / melee 0) lifted into hostility by
 * emotion needs the physical capacity to act on it — radicalization swaps the
 * NPC's faction, not its AGGRO_PROFILE. Returns the original profile unchanged
 * below the engagement threshold, or a minimally-engaged copy above it.
 */
export function engagementProfile(baseProfile, effectiveAggro) {
  if (!baseProfile) return baseProfile;
  const a = Number(effectiveAggro) || 0;
  const inert = (baseProfile.pursuitRadius || 0) === 0 || (baseProfile.melee || 0) === 0;
  if (a >= ENGAGE_THRESHOLD && inert) {
    return {
      ...baseProfile,
      pursuitRadius: Math.max(baseProfile.pursuitRadius || 0, 14),
      melee: Math.max(baseProfile.melee || 0, 2),
    };
  }
  return baseProfile;
}

/**
 * The single call npc-simulator makes. Returns the modulated aggro, the discrete
 * level, and a possibly-patched engagement profile.
 *
 * @returns {{ effectiveAggro:number, level:string, profile:object, disp:object }}
 */
export function resolveAggro(db, npc, target, baseAggro, isWanted, baseProfile, opts = {}) {
  const disp = disposition(db, npc, target, opts);
  const effectiveAggro = effectiveAggroFor(baseAggro, isWanted, disp);
  const profile = engagementProfile(baseProfile, effectiveAggro);
  return { effectiveAggro, level: dispositionLevel(effectiveAggro), profile, disp };
}
