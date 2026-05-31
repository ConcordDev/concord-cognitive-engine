// server/lib/authority-heat.js
//
// Phase 3 of the Temperament engine: the TWO-METER AUTHORITY machine (Part 4).
//
// Concordia already tracks the SLOW meter — `player_wanted.wanted_level` (0–5)
// via server/lib/law.js. What was missing is the FAST meter and the doctrine
// around both. This module adds them (ESO/RDR2 two-meter model):
//
//   HEAT   (fast):  fills on perception of a crime, decays on no-contact.
//                   drives the suspicion FSM: idle → suspicious → search → alert.
//   BOUNTY (slow):  the persistent wanted scalar, named:
//                   clean → wanted → notorious(seek arrest) → fugitive(kill on sight).
//
// HEAT is in-memory by design (ephemeral, fast, per-process — like the brawl and
// combat-state substrates). BOUNTY persists in `player_wanted`. The arrest gate,
// suspicion FSM, tiers, and responder escalation are pure functions.

import { LruMap } from "./lru-map.js";

const num = (env, d) => {
  const v = Number(process.env[env]);
  return Number.isFinite(v) ? v : d;
};

export const HEAT_MAX = 100;
const HEAT_DECAY_PER_SEC = num("CONCORD_HEAT_DECAY_PER_SEC", 2); // ~50s full cool
const HEAT_SUSPICIOUS = num("CONCORD_HEAT_SUSPICIOUS", 25);
const HEAT_SEARCH = num("CONCORD_HEAT_SEARCH", 55);
const HEAT_ALERT = num("CONCORD_HEAT_ALERT", 80);

// key `${worldId}:${entityId}` → { value, at } (lazy time-decay on read)
const _heat = new LruMap();

function heatKey(worldId, entityId) {
  return `${worldId}:${entityId}`;
}

/** Current heat after lazy time-decay since the last write. Never negative. */
export function getHeat(worldId, entityId, now = Date.now()) {
  const rec = _heat.get(heatKey(worldId, entityId));
  if (!rec) return 0;
  const elapsedSec = Math.max(0, (now - rec.at) / 1000);
  return Math.max(0, rec.value - elapsedSec * HEAT_DECAY_PER_SEC);
}

/** Add (or subtract) heat. Clamped to [0, HEAT_MAX]. Returns the new value. */
export function addHeat(worldId, entityId, amount, now = Date.now()) {
  const cur = getHeat(worldId, entityId, now);
  const v = Math.max(0, Math.min(HEAT_MAX, cur + amount));
  _heat.set(heatKey(worldId, entityId), { value: v, at: now });
  return v;
}

export function clearHeat(worldId, entityId) {
  _heat.delete(heatKey(worldId, entityId));
}

// Test/GC affordance — wipe the whole in-memory store.
export function _resetHeat() {
  _heat.clear();
}

export const SUSPICION_STATES = Object.freeze(["idle", "suspicious", "search", "alert"]);

/** The guard's immediate suspicion FSM, driven purely by heat. */
export function suspicionState(heat) {
  const h = Number(heat) || 0;
  if (h >= HEAT_ALERT) return "alert";
  if (h >= HEAT_SEARCH) return "search";
  if (h >= HEAT_SUSPICIOUS) return "suspicious";
  return "idle";
}

export const BOUNTY_TIERS = Object.freeze(["clean", "wanted", "notorious", "fugitive"]);

/** Map the slow wanted scalar (0–5) to its named tier. */
export function bountyTier(wantedLevel) {
  const w = Number(wantedLevel) || 0;
  if (w <= 0) return "clean";
  if (w <= 2) return "wanted";
  if (w <= 4) return "notorious";
  return "fugitive";
}

/** Who responds — repeat/severe crime escalates the responder. */
export function responderTier(wantedLevel, repeatCount = 0) {
  const w = (Number(wantedLevel) || 0) + Math.floor((Number(repeatCount) || 0) / 3);
  if (w >= 5) return "army";
  if (w >= 3) return "elite";
  return "local";
}

/**
 * The arrest gate. An authority NPC at THREATENING facing a wanted target offers
 * arrest instead of attacking; a fugitive is kill-on-sight (no offer). Returns
 * null when no offer applies (clean target, or wrong rung).
 */
export function arrestOffer(rung, tier) {
  if (rung !== "threatening") return null;
  if (tier === "clean") return null;
  if (tier === "fugitive") return { offer: false, killOnSight: true, tier };
  return { offer: true, killOnSight: false, tier, options: ["pay", "jail", "yield", "resist"] };
}

/**
 * Resolve a target's response to an arrest offer. Comply paths stand the NPC
 * down (→ jail/fine, recoverable); resisting is the hard flip to HOSTILE.
 */
export function resolveArrestResponse(verb) {
  switch (verb) {
    case "pay":
      return { outcome: "paid", standDown: true };
    case "jail":
    case "yield":
    case "comply":
      return { outcome: "jailed", standDown: true };
    case "resist":
      return { outcome: "resisted", standDown: false, escalateTo: "hostile" };
    default:
      return { outcome: "none", standDown: false };
  }
}

/** Read the slow wanted scalar directly (decoupled from law.js internals). */
export function wantedLevelFor(db, worldId, userId) {
  try {
    const row = db
      .prepare(`SELECT wanted_level FROM player_wanted WHERE user_id = ? AND world_id = ?`)
      .get(userId, worldId);
    return row?.wanted_level || 0;
  } catch {
    return 0;
  }
}

/**
 * Combined authority pressure in [0,1] a guard feels toward a user — the slow
 * bounty (weighted 0.7) + the fast heat (0.3). Feeds the disposition gate's
 * authority term, so a wanted player finally makes guards escalate.
 */
export function authorityPressure(db, worldId, userId, now = Date.now()) {
  const wanted = Math.min(5, wantedLevelFor(db, worldId, userId));
  const heat = getHeat(worldId, userId, now);
  return Math.min(1, (wanted / 5) * 0.7 + (heat / HEAT_MAX) * 0.3);
}
