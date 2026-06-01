// server/lib/capture-transport.js
//
// Temperament P5 — the capture / carry / load / transport / deliver loop.
//
// P4 makes an NPC go hors de combat (surrendered / downed). This is the economy
// on top: a captor binds the body, carries it (or loads it onto a mount/vehicle),
// hauls it, and delivers it to JAIL (→ combat_state 'arrested') or for RANSOM (a
// CC payout the caller mints). A captive can attempt ESCAPE while in transit —
// the longer the haul and the higher its morale, the better its odds.
//
// Pure FSM + guarded persistence (npc_captures, mig 318). Behind
// CONCORD_TEMPERAMENT — off → nothing here runs. Dials in docs/BALANCE_DIALS.md.

import crypto from "crypto";
import { temperamentEnabled, } from "./npc-temperament.js";
import { getCombatState, setCombatState, nextCombatState } from "./combat-restraint.js";

export const CAPTURE_STAGES = Object.freeze(["captured", "carried", "loaded", "transported", "delivered", "released", "escaped"]);
const ACTIVE_STAGES = new Set(["captured", "carried", "loaded", "transported"]);

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const dial = (name, def) => num(process.env[name], def);
const newId = () => `cap_${crypto.randomBytes(8).toString("hex")}`;

/** Legal stage transitions for the capture chain. */
const STAGE_NEXT = Object.freeze({
  captured: new Set(["carried", "released", "escaped"]),
  carried: new Set(["loaded", "transported", "delivered", "released", "escaped"]),
  loaded: new Set(["transported", "delivered", "released", "escaped"]),
  transported: new Set(["delivered", "released", "escaped"]),
});

export function canTransition(from, to) {
  return !!STAGE_NEXT[from]?.has(to);
}

function row(db, captureId) {
  try { return db.prepare(`SELECT * FROM npc_captures WHERE id=?`).get(String(captureId)) || null; }
  catch { return null; }
}

/**
 * Capture an NPC. Only legal against a target that is hors de combat
 * (surrendered/downed). Returns the new capture row id, or a reason.
 */
export function captureNpc(db, { npcId, captorId, worldId }) {
  if (!temperamentEnabled()) return { ok: false, reason: "disabled" };
  if (!db || !npcId || !captorId) return { ok: false, reason: "missing_inputs" };
  const { combatState } = getCombatState(db, npcId);
  if (combatState !== "surrendered" && combatState !== "downed") {
    return { ok: false, reason: "not_hors_de_combat", combatState };
  }
  try {
    // One active capture per NPC.
    const existing = db.prepare(`SELECT id FROM npc_captures WHERE npc_id=? AND stage IN ('captured','carried','loaded','transported')`).get(String(npcId));
    if (existing) return { ok: false, reason: "already_captured", captureId: existing.id };
    const id = newId();
    db.prepare(`INSERT INTO npc_captures (id, npc_id, captor_id, world_id, stage) VALUES (?,?,?,?,'captured')`)
      .run(id, String(npcId), String(captorId), String(worldId || ""));
    return { ok: true, captureId: id, stage: "captured" };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

/** Advance a capture's stage (carry / load / transport). carrier_* set on load. */
export function advanceCapture(db, captureId, toStage, { carrierKind, carrierId } = {}) {
  if (!temperamentEnabled()) return { ok: false, reason: "disabled" };
  const r = row(db, captureId);
  if (!r) return { ok: false, reason: "no_capture" };
  if (!canTransition(r.stage, toStage)) return { ok: false, reason: `illegal_transition:${r.stage}->${toStage}` };
  try {
    if (toStage === "loaded") {
      const ck = carrierKind === "mount" || carrierKind === "vehicle" ? carrierKind : "self";
      db.prepare(`UPDATE npc_captures SET stage='loaded', carrier_kind=?, carrier_id=? WHERE id=?`).run(ck, carrierId || null, r.id);
    } else {
      db.prepare(`UPDATE npc_captures SET stage=? WHERE id=?`).run(toStage, r.id);
    }
    return { ok: true, stage: toStage };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

/**
 * Deliver the captive. destination 'jail' → the NPC's combat_state becomes
 * 'arrested'; 'ransom' → records the CC owed (the caller mints it). Returns the
 * ransom owed so the caller can pay the captor.
 */
export function deliverCapture(db, captureId, destination, { ransom } = {}) {
  if (!temperamentEnabled()) return { ok: false, reason: "disabled" };
  const r = row(db, captureId);
  if (!r) return { ok: false, reason: "no_capture" };
  if (!ACTIVE_STAGES.has(r.stage)) return { ok: false, reason: `not_deliverable:${r.stage}` };
  if (destination !== "jail" && destination !== "ransom") return { ok: false, reason: "bad_destination" };
  try {
    const owed = destination === "ransom" ? Math.max(0, num(ransom, dial("CONCORD_TEMP_RANSOM_DEFAULT", 50))) : 0;
    db.prepare(`UPDATE npc_captures SET stage='delivered', destination=?, ransom=?, delivered_at=unixepoch(), ended_reason='delivered' WHERE id=?`)
      .run(destination, owed, r.id);
    if (destination === "jail") {
      // hors de combat → arrested (FSM-legal from surrendered/downed).
      const cur = getCombatState(db, r.npc_id).combatState;
      setCombatState(db, r.npc_id, { combatState: nextCombatState(cur, "arrest") });
    }
    return { ok: true, stage: "delivered", destination, ransomOwed: owed, npcId: r.npc_id, captorId: r.captor_id };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

/**
 * A captive attempts to escape while in transit. Odds rise with morale + how long
 * it's been hauled; a delivered/ended capture can't escape. Deterministic when a
 * `roll` (0..1) is supplied (tests); else random.
 */
export function attemptEscape(db, captureId, { nowS = Math.floor(Date.now() / 1000), roll } = {}) {
  if (!temperamentEnabled()) return { ok: false, reason: "disabled" };
  const r = row(db, captureId);
  if (!r) return { ok: false, reason: "no_capture" };
  if (!ACTIVE_STAGES.has(r.stage)) return { ok: false, reason: `not_active:${r.stage}` };
  const { morale } = getCombatState(db, r.npc_id);
  const base = dial("CONCORD_TEMP_ESCAPE_BASE", 0.02);
  const moraleW = dial("CONCORD_TEMP_ESCAPE_MORALE_W", 0.15);
  const haulMin = Math.max(0, (nowS - num(r.captured_at, nowS)) / 60);
  const haulW = dial("CONCORD_TEMP_ESCAPE_HAUL_W", 0.01);
  // A captive loaded on a mount/vehicle is harder to escape from than carried.
  const restraint = r.carrier_kind === "vehicle" ? 0.4 : r.carrier_kind === "mount" ? 0.6 : 1.0;
  const chance = Math.max(0, Math.min(0.95, (base + morale * moraleW + haulMin * haulW) * restraint));
  const r0 = roll != null ? roll : Math.random();
  if (r0 < chance) {
    try {
      db.prepare(`UPDATE npc_captures SET stage='escaped', ended_reason='escaped' WHERE id=?`).run(r.id);
      setCombatState(db, r.npc_id, { combatState: "active", surrenderedAt: null });
    } catch { /* persistence best-effort */ }
    return { ok: true, escaped: true, chance };
  }
  return { ok: true, escaped: false, chance };
}

export function getCapture(db, captureId) { return row(db, captureId); }

export function listCaptivesFor(db, captorId) {
  try { return db.prepare(`SELECT * FROM npc_captures WHERE captor_id=? AND stage IN ('captured','carried','loaded','transported') ORDER BY captured_at DESC`).all(String(captorId)); }
  catch { return []; }
}

export default captureNpc;
