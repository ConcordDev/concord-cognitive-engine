// server/lib/temperament-spread.js
//
// Temperament P7 — social-spread assistance-gate + depth-cap + zone/child weld.
//
// Today _callForHelp alerts EVERY NPC within 15m indiscriminately — strangers,
// merchants, children, even inside a sanctuary. P7 welds the help cry to canon:
//
//   • assistance-gate — only an ALLY answers (positive opinion of the caller, or
//     same faction). A stranger doesn't drop their cart to join your brawl.
//   • child/non-combatant weld — a child (archetype or age) is NEVER recruited to
//     fight and is never a valid escalation target. Concord's protected class.
//   • zone weld — inside a sanctuary / noAggro zone the cry is suppressed; the
//     world-zones rule wins (agrees with Concordant Law).
//   • depth-cap — the alert cascade is bounded (A→B→C…), so one scuffle can't
//     aggro the whole map.
//
// Pure-ish + table-guarded. Behind CONCORD_TEMPERAMENT (off → today's
// indiscriminate alert, byte-identical). Dials in docs/BALANCE_DIALS.md.

import { temperamentEnabled } from "./npc-temperament.js";

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const dial = (name, def) => num(process.env[name], def);

// Non-combatants who must never be recruited or escalated (lore-weld).
const PROTECTED_ARCHETYPES = new Set(["child", "infant", "toddler", "civilian_child", "youth"]);

export function isProtectedNonCombatant(npc) {
  if (!npc) return false;
  const arch = String(npc.archetype || "").toLowerCase();
  if (PROTECTED_ARCHETYPES.has(arch)) return true;
  const childMaxAge = dial("CONCORD_TEMP_CHILD_MAX_AGE", 16);
  const age = npc.age == null ? null : num(npc.age, NaN);
  return age != null && Number.isFinite(age) && age < childMaxAge;
}

/** Does a zone rule suppress the call (sanctuary / noAggro)? Pure predicate. */
export function zoneSuppresses(rule) {
  return !!rule && (rule.combat === false || rule.noAggro === true);
}

function opinionOf(db, npcId, targetKind, targetId) {
  try {
    const r = db.prepare(`SELECT score FROM character_opinions WHERE npc_id=? AND target_kind=? AND target_id=?`)
      .get(String(npcId), targetKind, String(targetId));
    return r ? num(r.score, 0) : null;
  } catch {
    return null;
  }
}

function sameFaction(db, aId, bId) {
  try {
    const cols = db.prepare(`PRAGMA table_info(world_npcs)`).all().map((c) => c.name);
    const col = cols.includes("faction_id") ? "faction_id" : cols.includes("faction") ? "faction" : null;
    if (!col) return false;
    const a = db.prepare(`SELECT ${col} AS f FROM world_npcs WHERE id=?`).get(String(aId));
    const b = db.prepare(`SELECT ${col} AS f FROM world_npcs WHERE id=?`).get(String(bId));
    return !!(a?.f && b?.f && a.f === b.f);
  } catch {
    return false;
  }
}

/**
 * Should `responder` answer `caller`'s help cry?
 * @param {object} opts
 * @param {(db,worldId,x,z)=>object} [opts.combatRuleFor]  injected zone rule fn (avoids ESM cycle)
 * @returns {{assist:boolean, reason:string}}
 */
export function shouldAssist(db, { callerId, responderId, worldId, responderRow, responderLoc, combatRuleFor } = {}) {
  if (!temperamentEnabled()) return { assist: true, reason: "temperament_off" }; // off == legacy: everyone
  if (!db || !callerId || !responderId) return { assist: false, reason: "missing_inputs" };

  // world_npcs has no `age` column — age-based child detection is unavailable here
  // (archetype-based still applies); selecting it threw and dropped archetype too.
  const r = responderRow || (() => { try { return db.prepare(`SELECT id, archetype FROM world_npcs WHERE id=?`).get(String(responderId)); } catch { return null; } })();

  // Children + non-combatants never fight.
  if (isProtectedNonCombatant(r)) return { assist: false, reason: "protected_noncombatant" };

  // Sanctuary / noAggro zone suppresses the cry.
  const loc = responderLoc || (r && r.x != null && r.z != null ? { x: r.x, z: r.z } : null);
  if (loc && typeof combatRuleFor === "function") {
    try {
      if (zoneSuppresses(combatRuleFor(db, worldId, loc.x, loc.z))) return { assist: false, reason: "sanctuary" };
    } catch { /* zone read best-effort */ }
  }

  // Ally check: positive opinion of the caller, or same faction.
  const allyThreshold = dial("CONCORD_TEMP_ASSIST_OPINION_MIN", 20);
  const op = opinionOf(db, responderId, "npc", callerId);
  if (op != null && op >= allyThreshold) return { assist: true, reason: "ally_opinion" };
  if (sameFaction(db, callerId, responderId)) return { assist: true, reason: "same_faction" };

  return { assist: false, reason: "not_ally" };
}

/** Cap the responder set: only allies, capped at the fan-out. */
export function filterResponders(db, { callerId, worldId, candidates = [], combatRuleFor } = {}) {
  if (!temperamentEnabled()) return candidates; // off == legacy: all candidates
  const fanout = dial("CONCORD_TEMP_SPREAD_FANOUT", 5);
  const out = [];
  for (const c of candidates) {
    const id = typeof c === "string" ? c : c?.id;
    if (!id) continue;
    if (shouldAssist(db, { callerId, responderId: id, worldId, responderRow: typeof c === "object" ? c : null, combatRuleFor }).assist) {
      out.push(c);
      if (out.length >= fanout) break;
    }
  }
  return out;
}

/** Is a help-cascade at this depth still allowed to spread? */
export function cascadeDepthOk(depth) {
  return num(depth, 0) <= dial("CONCORD_TEMP_SPREAD_DEPTH_CAP", 2);
}

export default shouldAssist;
