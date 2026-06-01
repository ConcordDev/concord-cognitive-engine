// server/lib/temperament-combat.js
//
// Live wiring for the Temperament engine (P2–P5) into the combat path. The
// resolver halves (combat-restraint / capture-transport / authority-heat /
// temperament-ladder) were built + migrated (317/318) + tested, but nothing in
// live gameplay called them. This module is the thin integration layer that does
// — every entry point no-ops cleanly when CONCORD_TEMPERAMENT is off and is
// wrapped so it can NEVER break combat.

import { applyCombatHit, shouldSpareExecution } from "./combat-restraint.js";
import { captureNpc } from "./capture-transport.js";
import { applyDeescalation, RUNGS, barkFor, isEngaged, DEESCALATION_VERBS } from "./temperament-ladder.js";
import {
  wantedLevelFor, bountyTier, arrestOffer, resolveArrestResponse,
  addHeat, clearHeat,
} from "./authority-heat.js";
import { temperamentEnabled } from "./npc-temperament.js";
import logger from "../logger.js";

const ENGAGED_DEFAULT_RUNG = "hostile"; // an NPC mid-combat reads as hostile unless its state says otherwise

function emitTo(io, worldId, event, payload) {
  try { io?.to?.(`world:${worldId}`)?.emit?.(event, payload); } catch { /* emit best-effort */ }
}

/** Read the NPC's current intent rung from world_npcs.state JSON (default by combat_state). */
export function rungOf(db, npc) {
  try {
    const raw = npc?.state ?? db?.prepare?.("SELECT state FROM world_npcs WHERE id=?").get(npc?.id)?.state;
    const st = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {});
    if (st && RUNGS.includes(st.intent_rung)) return st.intent_rung;
  } catch { /* no state / bad JSON → default */ }
  return ENGAGED_DEFAULT_RUNG;
}

/** Persist a new intent rung into world_npcs.state JSON (read-modify-write, guarded). */
function writeRung(db, npcId, rung) {
  try {
    const row = db.prepare("SELECT state FROM world_npcs WHERE id=?").get(String(npcId));
    const st = row?.state ? (typeof row.state === "string" ? JSON.parse(row.state) : row.state) : {};
    st.intent_rung = rung;
    db.prepare("UPDATE world_npcs SET state=? WHERE id=?").run(JSON.stringify(st), String(npcId));
  } catch { /* state column absent / bad JSON → skip persistence */ }
}

/**
 * Lethal force on an NPC already hors de combat is refused. Call BEFORE applying
 * damage. Returns { spare:true, ... } to short-circuit the strike, else { spare:false }.
 */
export function checkSpareBeforeHit(db, npcId) {
  if (!temperamentEnabled()) return { spare: false };
  try { return shouldSpareExecution(db, npcId); }
  catch { return { spare: false }; }
}

/**
 * P4 + P5-init. Called AFTER damage lands (and only when the hit didn't kill):
 * folds the hit into morale, transitions the restraint FSM, and — on a morale
 * break → surrender — opens a capture. Returns a compact summary for the response
 * + socket, or null when temperament is off / errored.
 */
export function resolveHitTemperament(db, { worldId, npc, userId, damage = 0, nonLethal = false, io } = {}) {
  if (!temperamentEnabled() || !npc?.id) return null;
  try {
    const targetRung = rungOf(db, npc);
    const warned = ["warning", "threatening", "hostile"].includes(targetRung);
    const r = applyCombatHit(db, npc, { damage, nonLethal, warned, targetRung });
    if (!r) return null;

    let capture = null;
    if (r.surrendered) {
      const cap = captureNpc(db, { npcId: npc.id, captorId: userId, worldId });
      if (cap.ok) capture = { captureId: cap.captureId, stage: cap.stage };
      emitTo(io, worldId, "combat:surrender", {
        npcId: npc.id, by: userId, captureId: cap.ok ? cap.captureId : null,
        bark: barkFor("fleeing", npc.archetype),
      });
    }
    return {
      combatState: r.combatState,
      morale: Math.round((r.morale ?? 1) * 100) / 100,
      surrendered: !!r.surrendered,
      excessive: !!r.force?.excessive,
      capture,
    };
  } catch (e) {
    logger.warn?.("temperament-combat", "hit_error", { error: e?.message });
    return null;
  }
}

/**
 * P2 — a player de-escalation verb (holster/yield/comply/…) steps the NPC's
 * intent rung down. Persists the rung + emits a bark so the client can read the
 * NPC standing down. Returns { ok, rung, deescalated, calmed, bark }.
 */
export function applyNpcDeescalation(db, { worldId, npc, verb, io } = {}) {
  if (!temperamentEnabled()) return { ok: false, reason: "disabled" };
  if (!npc?.id || !verb) return { ok: false, reason: "missing_inputs" };
  if (!DEESCALATION_VERBS.includes(verb)) return { ok: false, reason: "unknown_verb", verbs: DEESCALATION_VERBS };
  try {
    const cur = rungOf(db, npc);
    const next = applyDeescalation(cur, verb);
    writeRung(db, npc.id, next);
    const calmed = isEngaged(cur) && !isEngaged(next);
    const bark = barkFor(next, npc.archetype);
    emitTo(io, worldId, "npc:deescalate", { npcId: npc.id, by: undefined, rung: next, calmed, bark });
    return { ok: true, rung: next, deescalated: next !== cur, calmed, bark };
  } catch (e) {
    logger.warn?.("temperament-combat", "deescalate_error", { error: e?.message });
    return { ok: false, reason: e?.message };
  }
}

/**
 * P3 — resolve a player's response to an authority arrest offer. Reads the slow
 * bounty tier, builds the offer, and resolves the chosen verb: a stand-down clears
 * heat; resisting flips to hostile + spikes heat. Returns the offer/outcome.
 */
export function resolvePlayerArrest(db, { worldId, userId, verb, io } = {}) {
  if (!temperamentEnabled()) return { ok: false, reason: "disabled" };
  if (!userId) return { ok: false, reason: "missing_inputs" };
  try {
    const tier = bountyTier(wantedLevelFor(db, worldId, userId));
    const offer = arrestOffer("threatening", tier);
    if (!offer) return { ok: true, offered: false, tier, reason: "no_offer" };
    if (offer.killOnSight) {
      emitTo(io, worldId, "authority:kill-on-sight", { userId, tier });
      return { ok: true, offered: false, killOnSight: true, tier };
    }
    const resp = resolveArrestResponse(verb);
    if (resp.outcome === "none") return { ok: false, reason: "unknown_verb", options: offer.options };
    if (resp.standDown) {
      clearHeat(worldId, userId);
    } else if (resp.escalateTo === "hostile") {
      addHeat(worldId, userId, 40);
    }
    emitTo(io, worldId, "authority:arrest-resolved", { userId, tier, outcome: resp.outcome, standDown: resp.standDown });
    return { ok: true, offered: true, tier, ...resp };
  } catch (e) {
    logger.warn?.("temperament-combat", "arrest_error", { error: e?.message });
    return { ok: false, reason: e?.message };
  }
}
