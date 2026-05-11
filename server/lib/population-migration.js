// server/lib/population-migration.js
//
// Population migration engine — sprint 3 of multi-world parity.
//
// An NPC is in EXACTLY one of two states at any moment:
//   (a) resident: world_npcs.world_id = X, no in_transit event
//   (b) in_transit: a population_flow_events row with status='in_transit'
//       and from_world_id = X (their last known world)
//
// initiateMigration moves them (a)→(b): inserts the flow event, leaves
// world_npcs.world_id = from for now (so a "where was Iyatte last seen?"
// query still works during transit).
//
// arriveAtDestination moves them (b)→(a): updates world_npcs.world_id
// to to_world_id, marks the event status='arrived'. Optionally fires a
// cross-world signal back to the from-world correspondents to mark
// "they have crossed."
//
// Conservation invariant: every successful initiateMigration creates
// exactly one in_transit row; every successful arrival flips that row
// to 'arrived' and updates world_npcs. NPC count is conserved across
// all worlds + in_transit; never duplicated, never lost.
//
// Boundary discipline: every public function takes both world IDs
// explicitly. transport_routes (Sprint 1) is consulted for distance
// → transit time. Every cross-world op gates on the kill switch.

import { getKillSwitchMode } from "./cross-world-economy.js";

const TRANSIT_SECONDS_PER_UNIT = 600; // 10 in-game minutes per distance unit (deterministic)
const LOST_AFTER_OVERDUE_S = 86400 * 7; // 7 days overdue → marked lost (NPC conserved as 'lost', not deleted)

function killSwitchAllowsCrossWorld(db) {
  return getKillSwitchMode(db) === "live";
}

// ── Initiate migration ────────────────────────────────────────────

export function initiateMigration(db, opts = {}) {
  if (!killSwitchAllowsCrossWorld(db)) {
    return { ok: false, reason: `kill_switch_${getKillSwitchMode(db)}` };
  }
  const { npcId, fromWorld, toWorld, reason = "voluntary" } = opts;
  if (!db || !npcId || !fromWorld || !toWorld) {
    return { ok: false, reason: "missing_inputs" };
  }
  if (fromWorld === toWorld) {
    return { ok: false, reason: "same_world" };
  }

  // Sprint 1 transport_routes provides distance.
  const route = db.prepare(`
    SELECT distance_units FROM transport_routes WHERE from_world = ? AND to_world = ?
  `).get(fromWorld, toWorld);
  if (!route) return { ok: false, reason: "no_route" };

  // The NPC must currently be a resident of fromWorld.
  let resident;
  try {
    resident = db.prepare(`SELECT world_id FROM world_npcs WHERE id = ?`).get(npcId);
  } catch {
    return { ok: false, reason: "npc_not_found" };
  }
  if (!resident) return { ok: false, reason: "npc_not_found" };
  if (resident.world_id !== fromWorld) {
    return { ok: false, reason: "npc_not_in_from_world", actualWorld: resident.world_id };
  }

  // Block double-migration: the partial unique index would also block
  // this at the SQL layer, but a clean error is friendlier.
  const inFlight = db.prepare(`
    SELECT id FROM population_flow_events WHERE npc_id = ? AND status = 'in_transit'
  `).get(npcId);
  if (inFlight) return { ok: false, reason: "already_in_transit", eventId: inFlight.id };

  const now = Math.floor(Date.now() / 1000);
  const expectedArrival = now + (route.distance_units * TRANSIT_SECONDS_PER_UNIT);

  const result = db.prepare(`
    INSERT INTO population_flow_events
      (npc_id, from_world_id, to_world_id, departed_at, expected_arrival_at, status, reason)
    VALUES (?, ?, ?, ?, ?, 'in_transit', ?)
  `).run(npcId, fromWorld, toWorld, now, expectedArrival, reason);

  return {
    ok: true,
    eventId: result.lastInsertRowid,
    npcId,
    fromWorld,
    toWorld,
    expectedArrival,
    transitSeconds: route.distance_units * TRANSIT_SECONDS_PER_UNIT,
  };
}

// ── Arrive at destination ─────────────────────────────────────────

export function arriveAtDestination(db, eventId, opts = {}) {
  if (!killSwitchAllowsCrossWorld(db)) {
    return { ok: false, reason: `kill_switch_${getKillSwitchMode(db)}` };
  }
  if (!db || !eventId) return { ok: false, reason: "missing_inputs" };

  const event = db.prepare(`
    SELECT * FROM population_flow_events WHERE id = ?
  `).get(eventId);
  if (!event) return { ok: false, reason: "event_not_found" };
  if (event.status !== "in_transit") {
    return { ok: false, reason: `already_${event.status}` };
  }

  const now = Math.floor(Date.now() / 1000);
  const arrivalTime = opts.forceTime ?? now;

  // Two-phase: flip event to arrived, then update NPC's world_id. Both
  // in a single transaction so we can't end up with NPC half-moved.
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE population_flow_events
      SET status = 'arrived', arrived_at = ?
      WHERE id = ? AND status = 'in_transit'
    `).run(arrivalTime, eventId);
    db.prepare(`
      UPDATE world_npcs SET world_id = ? WHERE id = ?
    `).run(event.to_world_id, event.npc_id);
  });
  tx();

  return {
    ok: true,
    eventId,
    npcId: event.npc_id,
    fromWorld: event.from_world_id,
    toWorld: event.to_world_id,
    arrivalTime,
  };
}

// ── Sweep helpers for the heartbeat ───────────────────────────────

export function findArrivalsDue(db, asOfTime = null) {
  if (!db) return [];
  const cutoff = asOfTime ?? Math.floor(Date.now() / 1000);
  try {
    return db.prepare(`
      SELECT * FROM population_flow_events
      WHERE status = 'in_transit' AND expected_arrival_at <= ?
      ORDER BY expected_arrival_at ASC
    `).all(cutoff);
  } catch {
    return [];
  }
}

export function findOverdue(db, asOfTime = null) {
  if (!db) return [];
  const now = asOfTime ?? Math.floor(Date.now() / 1000);
  const cutoff = now - LOST_AFTER_OVERDUE_S;
  try {
    return db.prepare(`
      SELECT * FROM population_flow_events
      WHERE status = 'in_transit' AND expected_arrival_at <= ?
    `).all(cutoff);
  } catch {
    return [];
  }
}

export function markLost(db, eventId, reason = "transit_timeout") {
  if (!db || !eventId) return { ok: false, reason: "missing_inputs" };
  const r = db.prepare(`
    UPDATE population_flow_events
    SET status = 'lost', meta_json = ?
    WHERE id = ? AND status = 'in_transit'
  `).run(JSON.stringify({ lost_reason: reason }), eventId);
  return { ok: r.changes > 0, changes: r.changes };
}

// ── Population read helpers ───────────────────────────────────────

/** Resident count for a world (excludes in-transit and dead NPCs). */
export function residentCount(db, worldId) {
  if (!db || !worldId) return 0;
  try {
    const r = db.prepare(`
      SELECT COUNT(*) AS c FROM world_npcs
      WHERE world_id = ? AND COALESCE(is_dead, 0) = 0
        AND id NOT IN (SELECT npc_id FROM population_flow_events WHERE status = 'in_transit')
    `).get(worldId);
    return r?.c || 0;
  } catch {
    return 0;
  }
}

/** Count of NPCs currently in transit FROM a given world. */
export function outboundInTransitCount(db, fromWorldId) {
  if (!db || !fromWorldId) return 0;
  try {
    const r = db.prepare(`
      SELECT COUNT(*) AS c FROM population_flow_events
      WHERE from_world_id = ? AND status = 'in_transit'
    `).get(fromWorldId);
    return r?.c || 0;
  } catch {
    return 0;
  }
}

/** Count of NPCs currently in transit TO a given world. */
export function inboundInTransitCount(db, toWorldId) {
  if (!db || !toWorldId) return 0;
  try {
    const r = db.prepare(`
      SELECT COUNT(*) AS c FROM population_flow_events
      WHERE to_world_id = ? AND status = 'in_transit'
    `).get(toWorldId);
    return r?.c || 0;
  } catch {
    return 0;
  }
}

/**
 * Conservation check: total NPC count across (residents per world) +
 * (in-transit) + (lost) + (dead) must equal the total NPC count in
 * world_npcs. This is the invariant the Sprint 3 acceptance test pins.
 */
export function conservationCheck(db) {
  if (!db) return { ok: false, reason: "no_db" };
  try {
    const totalNpcs = db.prepare(`SELECT COUNT(*) AS c FROM world_npcs`).get().c;
    const dead = db.prepare(`SELECT COUNT(*) AS c FROM world_npcs WHERE COALESCE(is_dead, 0) = 1`).get().c;
    const inTransit = db.prepare(`SELECT COUNT(*) AS c FROM population_flow_events WHERE status = 'in_transit'`).get().c;

    const allWorlds = db.prepare(`SELECT DISTINCT world_id FROM world_npcs`).all();
    let totalResidents = 0;
    const perWorld = {};
    for (const w of allWorlds) {
      const c = residentCount(db, w.world_id);
      perWorld[w.world_id] = c;
      totalResidents += c;
    }

    // Conservation: every NPC is in exactly one of:
    //   resident (world_npcs.world_id and not in transit and not dead)
    //   in_transit (in transit)
    //   dead (is_dead=1)
    // Note: an in-transit NPC may also be a row in world_npcs (their
    // current world_id is the from-world); the residentCount function
    // excludes them. So expected = totalResidents + inTransit + dead.
    const accountedFor = totalResidents + inTransit + dead;
    return {
      ok: accountedFor === totalNpcs,
      totalNpcs,
      totalResidents,
      inTransit,
      dead,
      accountedFor,
      perWorld,
    };
  } catch (err) {
    return { ok: false, reason: "check_threw", error: String(err?.message || err) };
  }
}

/** Net flow analytics: outflow from world A vs inflow to world B in a window. */
export function flowBetween(db, fromWorld, toWorld, sinceTs = 0) {
  if (!db || !fromWorld || !toWorld) return { departed: 0, arrived: 0, in_transit: 0 };
  try {
    const departed = db.prepare(`
      SELECT COUNT(*) AS c FROM population_flow_events
      WHERE from_world_id = ? AND to_world_id = ? AND departed_at >= ?
    `).get(fromWorld, toWorld, sinceTs)?.c || 0;
    const arrived = db.prepare(`
      SELECT COUNT(*) AS c FROM population_flow_events
      WHERE from_world_id = ? AND to_world_id = ? AND status = 'arrived' AND arrived_at >= ?
    `).get(fromWorld, toWorld, sinceTs)?.c || 0;
    const in_transit = db.prepare(`
      SELECT COUNT(*) AS c FROM population_flow_events
      WHERE from_world_id = ? AND to_world_id = ? AND status = 'in_transit'
    `).get(fromWorld, toWorld)?.c || 0;
    return { departed, arrived, in_transit };
  } catch {
    return { departed: 0, arrived: 0, in_transit: 0 };
  }
}

export const POPULATION_MIGRATION_CONSTANTS = Object.freeze({
  TRANSIT_SECONDS_PER_UNIT,
  LOST_AFTER_OVERDUE_S,
});
