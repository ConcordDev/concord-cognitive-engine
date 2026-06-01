// server/lib/world-density.js
//
// WAVE WD — World Density (every door opens). This is the BACKEND core of the
// "every building has an interior, never empty" feature — and it is a WIRING
// layer over substrate that already exists (building-interiors.js room system,
// world-crime.js access/locks), not a new build.
//
// The user's three locked tiers:
//   Tier 1 (gen-from-seed)        — the frontend regenerates geometry from
//                                   building.id every load (procedural-buildings.ts);
//                                   nothing to persist here.
//   Tier 2 (persist STATE)        — ensureInterior() lazily seeds the room
//                                   *state rows* on first entry so mutations
//                                   (furniture/locks/damage) have something to
//                                   attach to. A never-entered building costs
//                                   zero storage. THE "NEVER EMPTY" GUARANTEE:
//                                   if no authored blueprint exists for the
//                                   building_type, synthesize one room from the
//                                   matching ROOM_TEMPLATE (or 'generic').
//   Tier 3 (simulate-only-active) — an in-memory activity Map + an NPC-occupant
//                                   check answer "should this interior tick?"
//                                   (the dormancy / LOD-of-simulation pattern —
//                                   the resource Bethesda buys with load-doors,
//                                   without the loading screen).
//
// Everything here is best-effort + never-throws-on-missing-substrate, and the
// CALLERS gate on worldDensityEnabled() so off == today (byte-identical).

import {
  seedRoomsForBuilding,
  addRoom,
  ROOM_TEMPLATES,
} from "./building-interiors.js";

// Buildings whose interiors are intentionally empty (no room state ever seeded).
export const INTENTIONALLY_EMPTY = new Set(["well", "generator"]);

// How long after the last player entry an interior is still considered "active".
export const DEFAULT_ACTIVITY_TTL_MS = 5 * 60 * 1000; // 5 min

export function worldDensityEnabled() {
  return process.env.CONCORD_WORLD_DENSITY !== "0";
}

/**
 * Tier 2 — the "never empty" guarantee. Idempotently ensure a building has
 * interior room state. Order: existing rooms → intentionally-empty → authored
 * blueprint (seedRoomsForBuilding) → single-room fallback from the template.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{id:string, world_id:string, building_type?:string, name?:string}} building
 * @returns {{ok:boolean, seeded?:boolean, roomCount?:number, fallback?:boolean, intentionallyEmpty?:boolean, reason?:string}}
 */
export function ensureInterior(db, building) {
  if (!db || !building || !building.id) return { ok: false, reason: "no_building" };
  const buildingId = building.id;
  const worldId = building.world_id;
  const buildingType = building.building_type || "generic";

  let existing = 0;
  try {
    existing = db.prepare("SELECT COUNT(*) AS c FROM building_rooms WHERE building_id = ?").get(buildingId)?.c ?? 0;
  } catch {
    return { ok: false, reason: "no_rooms_table" };
  }
  if (existing > 0) return { ok: true, seeded: false, roomCount: existing };
  if (INTENTIONALLY_EMPTY.has(buildingType)) {
    return { ok: true, seeded: false, roomCount: 0, intentionallyEmpty: true };
  }

  // Authored blueprint path (inn/forge/market/tower/house/...).
  let seed = { created: 0 };
  try { seed = seedRoomsForBuilding(db, buildingId, worldId, buildingType); } catch { /* fall through to fallback */ }
  if (seed.created > 0) return { ok: true, seeded: true, roomCount: seed.created };

  // Fallback — synthesize ONE room so the building is never empty. The room
  // type matches the building_type when a template exists (tavern, restaurant,
  // farm_plot, ...), else 'generic'.
  const roomType = ROOM_TEMPLATES[buildingType] ? buildingType : "generic";
  const name = building.name ? `${building.name} — Interior` : `${roomType} room`;
  try {
    addRoom(db, buildingId, worldId, { room_type: roomType, name, floor: 1 });
    return { ok: true, seeded: true, roomCount: 1, fallback: true };
  } catch {
    return { ok: false, reason: "seed_failed" };
  }
}

// ── Tier 3 — activity / dormancy gate ──────────────────────────────────────

// Hot path: buildingId -> lastActivityAtMs (cleared on restart; the persisted
// world_buildings.interior_last_activity_at column is the cold-start fallback).
const _activity = new Map();

/**
 * Mark an interior active (a player entered / acted inside it). Bumps the
 * in-memory Map and best-effort persists the unix-seconds stamp.
 */
export function recordInteriorActivity(db, buildingId, nowMs = Date.now()) {
  if (!buildingId) return;
  _activity.set(buildingId, nowMs);
  if (db) {
    try {
      db.prepare("UPDATE world_buildings SET interior_last_activity_at = ? WHERE id = ?")
        .run(Math.floor(nowMs / 1000), buildingId);
    } catch { /* column optional */ }
  }
}

/** True if any NPC calls this building home or works here. */
export function hasOccupants(db, buildingId) {
  if (!db || !buildingId) return false;
  try {
    const r = db.prepare(
      "SELECT COUNT(*) AS c FROM world_npcs WHERE (home_building_id = ? OR job_location_id = ?) AND is_dead = 0"
    ).get(buildingId, buildingId);
    return (r?.c ?? 0) > 0;
  } catch { return false; }
}

/**
 * Tier 3 — should this interior be simulated? Active iff a player acted inside
 * it recently (Map, then the persisted column post-restart) OR an NPC lives /
 * works there. Everything else is dormant and can be skipped.
 */
export function isInteriorActive(db, buildingId, { ttlMs = DEFAULT_ACTIVITY_TTL_MS, nowMs = Date.now() } = {}) {
  if (!buildingId) return false;
  const t = _activity.get(buildingId);
  if (t != null && (nowMs - t) <= ttlMs) return true;
  if (db) {
    try {
      const row = db.prepare("SELECT interior_last_activity_at FROM world_buildings WHERE id = ?").get(buildingId);
      const ts = row?.interior_last_activity_at;
      if (ts != null && (nowMs - ts * 1000) <= ttlMs) return true;
    } catch { /* column optional */ }
  }
  return hasOccupants(db, buildingId);
}

// test seam
export const _testing = {
  reset() { _activity.clear(); },
  activitySize() { return _activity.size; },
};
