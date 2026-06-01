// server/lib/combat-restraint.js
//
// Temperament P4 — proportionality + the surrender/arrest state machine.
//
// Combat today is binary: full force until DEAD. This layer adds the restraint
// half the spec calls for (Graham proportionality + RoN morale/surrender):
//
//   • proportionality — the LEGITIMATE force ceiling scales with the target's
//     actual threat (its ladder rung). Lethal force on a surrendered/neutral
//     target, or lethal force never preceded by a warning, is EXCESSIVE — flagged
//     (feeds the P6 legitimacy rubric), not silently allowed.
//   • morale — non-lethal force and flashes deplete morale faster than lethal
//     (the point of non-lethal is to break the will, not the body); a morale
//     break forces SURRENDER.
//   • the combat-state FSM — active → surrendering → surrendered → arrested, with
//     a bounded RoN "betray window" after surrender during which the NPC can
//     resume the fight; once the window closes the surrender is safe to approach.
//
// Pure logic + thin, table-guarded persistence. Off (CONCORD_TEMPERAMENT unset)
// nothing calls this; combat stays binary. Dials in docs/BALANCE_DIALS.md.

import { temperamentEnabled } from "./npc-temperament.js";

export const COMBAT_STATES = Object.freeze(["active", "surrendering", "surrendered", "arrested", "fleeing", "downed"]);

// Ladder rungs (mirror temperament-ladder.js) → the legitimate force ceiling
// against a target AT that threat level. A neutral/wary target never legitimises
// lethal force; only a threatening (warned) or hostile target does.
const RUNG_FORCE_CEILING = Object.freeze({
  neutral: "none",
  wary: "nonlethal",
  warning: "nonlethal",
  threatening: "lethal",
  hostile: "lethal",
});

const FORCE_RANK = Object.freeze({ none: 0, nonlethal: 1, lethal: 2 });

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function dial(name, def) { return num(process.env[name], def); }

/** The legitimate force ceiling against a target at threat `rung` / in `state`. */
export function legitimateCeiling(rung, combatState = "active") {
  // A target that has surrendered/downed/arrested is hors de combat — only
  // 'none' is legitimate (capture, not kill).
  if (combatState === "surrendered" || combatState === "downed" || combatState === "arrested") return "none";
  return RUNG_FORCE_CEILING[rung] || "nonlethal";
}

/**
 * Was the force used proportional + warned?
 * @returns {{legitimate:boolean, excessive:boolean, ceiling:string, reasons:string[]}}
 */
export function assessForce({ targetRung = "neutral", targetState = "active", lethal = false, warned = false } = {}) {
  const ceiling = legitimateCeiling(targetRung, targetState);
  const used = lethal ? "lethal" : "nonlethal";
  const reasons = [];
  let excessive = false;

  if (FORCE_RANK[used] > FORCE_RANK[ceiling]) {
    excessive = true;
    reasons.push(ceiling === "none" ? "force_on_hors_de_combat" : `force_exceeds_ceiling:${used}>${ceiling}`);
  }
  // Lethal force is only legitimate if a warning preceded it (the ladder forces a
  // THREATENING tick before HOSTILE — skipping it is unlawful escalation).
  if (lethal && !warned && !excessive) {
    excessive = true;
    reasons.push("lethal_without_warning");
  }
  return { legitimate: !excessive, excessive, ceiling, reasons };
}

/**
 * Morale after a hit. Non-lethal + flashes break will faster than lethal damage.
 * @param {number} morale current 0..1
 * @returns {number} new morale 0..1
 */
export function updateMorale(morale, { damage = 0, nonLethal = false, flashed = false } = {}) {
  const m0 = clamp01(num(morale, 1));
  const dNorm = clamp01(num(damage, 0) / 100); // damage scale mirrors the combat code
  const lethalW = dial("CONCORD_TEMP_MORALE_LETHAL_W", 0.35);
  const nonLethalW = dial("CONCORD_TEMP_MORALE_NONLETHAL_W", 0.8); // non-lethal hits will harder
  const flashHit = dial("CONCORD_TEMP_MORALE_FLASH", 0.5);
  let drop = dNorm * (nonLethal ? nonLethalW : lethalW);
  if (flashed) drop += flashHit;
  return clamp01(m0 - drop);
}

/** A morale break (or a flash that drops below the threshold) forces surrender. */
export function shouldSurrender(morale, { threshold } = {}) {
  const t = threshold != null ? threshold : dial("CONCORD_TEMP_SURRENDER_THRESHOLD", 0.2);
  return clamp01(num(morale, 1)) <= t;
}

/** Betray window: seconds after surrender during which the NPC may resume fighting. */
export function canBetray(surrenderedAt, nowMs = Date.now()) {
  if (!surrenderedAt) return false;
  const windowS = dial("CONCORD_TEMP_BETRAY_WINDOW_S", 20);
  const sAt = num(surrenderedAt, 0);
  const sMs = sAt < 1e12 ? sAt * 1000 : sAt; // accept unixepoch seconds or ms
  return (nowMs - sMs) <= windowS * 1000;
}

/**
 * The combat-state FSM. Returns the next state (or current if the event is
 * illegal from here). Events: morale_break, surrender_complete, arrest, betray,
 * flee, down, revive.
 */
export function nextCombatState(current, event, { surrenderedAt, nowMs = Date.now() } = {}) {
  const c = COMBAT_STATES.includes(current) ? current : "active";
  switch (event) {
    case "morale_break":
      return c === "active" || c === "fleeing" ? "surrendering" : c;
    case "surrender_complete":
      return c === "surrendering" ? "surrendered" : c;
    case "arrest":
      return c === "surrendered" || c === "downed" ? "arrested" : c;
    case "betray":
      return (c === "surrendered" && canBetray(surrenderedAt, nowMs)) ? "active" : c;
    case "flee":
      return c === "active" ? "fleeing" : c;
    case "down":
      return (c === "active" || c === "fleeing" || c === "surrendering") ? "downed" : c;
    case "revive":
      return c === "downed" ? "active" : c;
    default:
      return c;
  }
}

// ── Thin, table-guarded persistence (degrades to no-op without the columns). ──

export function getCombatState(db, npcId) {
  if (!db || !npcId) return { combatState: "active", morale: 1, surrenderedAt: null };
  try {
    const r = db.prepare(`SELECT combat_state AS s, morale AS m, surrendered_at AS sa FROM world_npcs WHERE id=?`).get(String(npcId));
    if (!r) return { combatState: "active", morale: 1, surrenderedAt: null };
    return { combatState: r.s || "active", morale: r.m == null ? 1 : r.m, surrenderedAt: r.sa ?? null };
  } catch {
    return { combatState: "active", morale: 1, surrenderedAt: null };
  }
}

export function setCombatState(db, npcId, { combatState, morale, surrenderedAt } = {}) {
  if (!db || !npcId) return false;
  try {
    const sets = [];
    const args = [];
    if (combatState != null) { sets.push("combat_state=?"); args.push(String(combatState)); }
    if (morale != null) { sets.push("morale=?"); args.push(clamp01(num(morale, 1))); }
    if (surrenderedAt !== undefined) { sets.push("surrendered_at=?"); args.push(surrenderedAt); }
    if (!sets.length) return false;
    args.push(String(npcId));
    db.prepare(`UPDATE world_npcs SET ${sets.join(", ")} WHERE id=?`).run(...args);
    return true;
  } catch {
    return false;
  }
}

/**
 * The one call a combat hit makes (when CONCORD_TEMPERAMENT is on): fold the hit
 * into morale, transition the state on a break, persist, and report whether the
 * force was excessive. Off → returns null (caller keeps binary combat).
 *
 * @returns {null | {combatState:string, morale:number, surrendered:boolean, force:object}}
 */
export function applyCombatHit(db, npc, { damage = 0, nonLethal = false, flashed = false, warned = false, targetRung = "neutral", nowMs = Date.now() } = {}) {
  if (!temperamentEnabled()) return null;
  const id = npc?.id;
  const prev = getCombatState(db, id);
  const force = assessForce({ targetRung, targetState: prev.combatState, lethal: !nonLethal, warned });

  // Already hors de combat — no morale change; just report the (likely excessive) force.
  if (prev.combatState === "surrendered" || prev.combatState === "arrested" || prev.combatState === "downed") {
    return { combatState: prev.combatState, morale: prev.morale, surrendered: prev.combatState === "surrendered", force };
  }

  const morale = updateMorale(prev.morale, { damage, nonLethal, flashed });
  let combatState = prev.combatState;
  let surrenderedAt = prev.surrenderedAt;
  let surrendered = false;

  if (shouldSurrender(morale)) {
    // morale_break → surrendering → surrendered (atomic for the hit).
    combatState = nextCombatState(nextCombatState(prev.combatState, "morale_break"), "surrender_complete");
    if (combatState === "surrendered") { surrenderedAt = Math.floor(nowMs / 1000); surrendered = true; }
  }

  setCombatState(db, id, { combatState, morale, surrenderedAt });
  return { combatState, morale, surrendered, force };
}

/**
 * Outcome gate for the kill path: a target that is hors de combat (surrendered /
 * arrested / downed) cannot be executed. Off (CONCORD_TEMPERAMENT unset) → never
 * spares (binary combat preserved). Safe to wire ahead of the morale-accrual path
 * — nothing reaches those states until accrual is enabled, so it's a correct
 * no-op until then and active the moment surrender becomes reachable.
 *
 * @returns {{spare:boolean, combatState?:string, reason?:string}}
 */
export function shouldSpareExecution(db, npcId) {
  if (!temperamentEnabled()) return { spare: false };
  const { combatState } = getCombatState(db, npcId);
  if (combatState === "surrendered" || combatState === "arrested" || combatState === "downed") {
    return { spare: true, combatState, reason: "hors_de_combat" };
  }
  return { spare: false, combatState };
}

export default applyCombatHit;
