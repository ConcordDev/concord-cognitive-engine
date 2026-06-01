// server/lib/temperament-ladder.js
//
// Phase 2 of the Temperament engine: the GRADED ESCALATION LADDER.
//
// Today's combat FSM is binary — idle→alerted→pursuing→attacking, no warning,
// no de-escalation. This module layers the intent ladder on top:
//
//   NEUTRAL → WARY → WARNING → THREATENING → HOSTILE   (+ FLEEING, terminal)
//
// Two research-load-bearing rules (F.E.A.R. + RDR2, verified):
//   1. BARKS externalize state — every rung transition emits one bark, so the
//      player can READ that the NPC is deciding, not tripwiring.
//   2. BIDIRECTIONAL — escalation walks back down. Time without provocation
//      decays one rung; player verbs (holster/yield/comply/pay) subtract rungs.
//
// A pacifist can never be struck without a warning: the climb is capped so
// THREATENING (the final warning) always precedes HOSTILE by at least one tick.
//
// Pure module — no DB, no IO, fully unit-testable. The simulator wires it behind
// the CONCORD_TEMPERAMENT kill-switch.

import { dispositionLevel } from "./npc-temperament.js";

// The climb ladder, low → high. FLEEING is terminal and lives off-ladder.
export const RUNGS = Object.freeze([
  "neutral",
  "wary",
  "warning",
  "threatening",
  "hostile",
]);

const RUNG_IDX = Object.freeze(
  RUNGS.reduce((m, r, i) => { m[r] = i; return m; }, {})
);

function idx(rung) {
  const i = RUNG_IDX[rung];
  return i === undefined ? 0 : i;
}

// Archetype → bark family. Authority warns and arrests; outlaws taunt; monsters
// snarl wordlessly; everyone else gets the neutral civilian line.
const ARCHETYPE_FAMILY = Object.freeze({
  guard: "authority",
  soldier: "authority",
  bandit: "outlaw",
  criminal: "outlaw",
  wraith: "monster",
  drift_eater: "monster",
  shard_husk: "monster",
});

export function archetypeFamily(archetype) {
  return ARCHETYPE_FAMILY[archetype] || "default";
}

// One bark per (rung, family). HOSTILE's authority/outlaw line is the commit;
// monsters say nothing (a snarl is the audio layer's job). FLEEING is the yield.
const BARKS = Object.freeze({
  wary: {
    authority: "Eyes up — I'm watching you.",
    outlaw: "Well, well. What do we have here.",
    monster: "",
    default: "...I see you there.",
  },
  warning: {
    authority: "That's far enough. Move along.",
    outlaw: "Wrong place to be, friend.",
    monster: "",
    default: "Back off.",
  },
  threatening: {
    authority: "Last warning — stand down!",
    outlaw: "Don't make me do this.",
    monster: "",
    default: "Stay back! I mean it!",
  },
  hostile: {
    authority: "Have it your way!",
    outlaw: "You asked for this!",
    monster: "",
    default: "",
  },
  fleeing: {
    authority: "Fall back! Regroup!",
    outlaw: "I yield — I'm done!",
    monster: "",
    default: "Please — no more!",
  },
});

/**
 * The bark for a rung transition, or "" when this rung+family is wordless
 * (monsters, or HOSTILE for civilians — the audio/snarl layer covers those).
 */
export function barkFor(rung, archetype) {
  const fam = archetypeFamily(archetype);
  const row = BARKS[rung];
  if (!row) return "";
  return row[fam] ?? row.default ?? "";
}

/**
 * Map disposition level → the highest rung that level alone permits. A merely
 * 'wary' disposition can't reach 'hostile' however close the target is.
 */
function dispCapRung(level) {
  switch (level) {
    case "friendly":
    case "neutral":
      return "neutral";
    case "wary":
      return "wary";
    case "warning":
      return "warning";
    case "hostile":
    case "lethal":
      return "hostile";
    default:
      return "neutral";
  }
}

/**
 * Map proximity → the highest rung proximity permits. You don't get to be
 * THREATENING from across the field; the body has to be close for the posture
 * to mean anything.
 */
function proximityCapRung({ nearestDist, alertRadius, pursuitRadius, melee }) {
  if (!Number.isFinite(nearestDist)) return "neutral";
  // Nested bands, closer is always a higher rung:
  //   melee → hostile · inner-alert → threatening · alert → warning · pursuit → wary
  const alert = alertRadius ?? 0;
  if (nearestDist <= (melee ?? 2)) return "hostile";
  if (nearestDist <= alert * 0.5) return "threatening";
  if (nearestDist <= alert) return "warning";
  if (nearestDist <= (pursuitRadius ?? 0)) return "wary";
  return "neutral";
}

/**
 * The rung the NPC *wants* to be at this tick — the min of what its disposition
 * permits and what proximity permits. min() is the gate: BOTH a hot disposition
 * AND closeness are required to threaten.
 */
export function targetRung({ effectiveAggro, nearestDist, alertRadius, pursuitRadius, melee }) {
  if ((Number(effectiveAggro) || 0) <= 0.05) return "neutral";
  // Outer awareness band — the NPC tracks out to the wider of alert/pursuit.
  const outer = Math.max(alertRadius ?? 0, pursuitRadius ?? 0);
  if (!Number.isFinite(nearestDist) || nearestDist > outer) return "neutral";
  const dCap = dispCapRung(dispositionLevel(effectiveAggro));
  const pCap = proximityCapRung({ nearestDist, alertRadius, pursuitRadius, melee });
  return idx(dCap) <= idx(pCap) ? dCap : pCap;
}

/**
 * One step of the ladder toward `target`. Escalation is capped so that
 * THREATENING always precedes HOSTILE by a tick — the guaranteed final warning.
 * De-escalation steps down exactly one rung per call.
 *
 * @returns {{ rung, transition: 'up'|'down'|'none' }}
 */
export function stepRung(current, target) {
  const ci = idx(current);
  const ti = idx(target);
  if (ti > ci) {
    // Escalating. Rise freely up to THREATENING, but never jump straight to
    // HOSTILE from below it — force one THREATENING (final-warning) tick first.
    const threat = idx("threatening");
    let next = ti;
    if (ci < threat && ti >= idx("hostile")) next = threat;
    return { rung: RUNGS[next], transition: "up" };
  }
  if (ti < ci) {
    return { rung: RUNGS[ci - 1], transition: "down" };
  }
  return { rung: current, transition: "none" };
}

/** Is the NPC cleared to actually strike? Only at the top of the ladder. */
export function isEngaged(rung) {
  return rung === "hostile";
}

// Player de-escalation verbs → how many rungs they subtract (RDR2 antagonise/
// defuse, RoN comply). `comply`/`pay_bounty` fully stand the NPC down.
const DEESCALATION = Object.freeze({
  holster: 1,
  back_off: 1,
  leave_zone: 2,
  yield: 2,
  defuse: 2,
  comply: Infinity,
  pay_bounty: Infinity,
});

export const DEESCALATION_VERBS = Object.freeze(Object.keys(DEESCALATION));

/**
 * Apply a player de-escalation verb to the current rung. Returns the new rung
 * (never below neutral). Unknown verbs are no-ops.
 */
export function applyDeescalation(currentRung, verb) {
  const drop = DEESCALATION[verb];
  if (!drop) return currentRung;
  const next = Math.max(0, idx(currentRung) - (drop === Infinity ? RUNGS.length : drop));
  return RUNGS[next];
}
