// server/lib/world-doors.js
//
// Wave G6 — door open/close state + auto-close sweep.
//
// API:
//   listForBuilding(db, buildingId)
//   listForWorld(db, worldId)
//   getDoor(db, doorId)
//   openDoor(db, opts)
//   closeDoor(db, opts)
//   autoCloseSweep(db, opts) — heartbeat helper
//
// A door has four states: closed → opening → open → closing → closed.
// `openDoor` flips closed/closing → open. `closeDoor` flips open/opening →
// closed. Both are idempotent: re-opening an open door is a no-op.

import logger from "../logger.js";

const AUTO_CLOSE_AFTER_S = 60;

export function listForBuilding(db, buildingId) {
  if (!db || !buildingId) return [];
  try {
    return db.prepare(`
      SELECT * FROM world_doors WHERE building_id = ?
    `).all(buildingId);
  } catch { return []; }
}

export function listForWorld(db, worldId) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT * FROM world_doors WHERE world_id = ?
    `).all(worldId);
  } catch { return []; }
}

export function getDoor(db, doorId) {
  if (!db || !doorId) return null;
  try {
    return db.prepare(`SELECT * FROM world_doors WHERE id = ?`).get(doorId);
  } catch { return null; }
}

export function openDoor(db, { doorId } = {}) {
  if (!db || !doorId) return { ok: false, reason: "missing_args" };
  const door = getDoor(db, doorId);
  if (!door) return { ok: false, reason: "door_not_found" };
  if (door.state === "open") {
    // Refresh last_opened_at so auto-close doesn't fire prematurely.
    try {
      db.prepare(`UPDATE world_doors SET last_opened_at = unixepoch() WHERE id = ?`).run(doorId);
    } catch { /* ok */ }
    return { ok: true, doorId, state: "open", refreshed: true, worldId: door.world_id };
  }
  try {
    db.prepare(`
      UPDATE world_doors SET state = 'open', last_opened_at = unixepoch() WHERE id = ?
    `).run(doorId);
  } catch (err) {
    return { ok: false, reason: "update_failed", error: err?.message };
  }
  return { ok: true, doorId, state: "open", worldId: door.world_id };
}

export function closeDoor(db, { doorId } = {}) {
  if (!db || !doorId) return { ok: false, reason: "missing_args" };
  const door = getDoor(db, doorId);
  if (!door) return { ok: false, reason: "door_not_found" };
  if (door.state === "closed") {
    return { ok: true, doorId, state: "closed", worldId: door.world_id, alreadyClosed: true };
  }
  try {
    db.prepare(`UPDATE world_doors SET state = 'closed' WHERE id = ?`).run(doorId);
  } catch (err) {
    return { ok: false, reason: "update_failed", error: err?.message };
  }
  return { ok: true, doorId, state: "closed", worldId: door.world_id };
}

/**
 * Heartbeat helper. Closes any door that has been open for more than
 * AUTO_CLOSE_AFTER_S seconds. Bounded by maxRows.
 */
export function autoCloseSweep(db, { maxRows = 500 } = {}) {
  if (!db) return { ok: false, reason: "no_db", closed: 0 };
  let closed = 0;
  try {
    const stale = db.prepare(`
      SELECT id FROM world_doors
      WHERE state = 'open'
        AND last_opened_at IS NOT NULL
        AND last_opened_at < unixepoch() - ?
      LIMIT ?
    `).all(AUTO_CLOSE_AFTER_S, maxRows);
    for (const row of stale) {
      try {
        db.prepare(`UPDATE world_doors SET state = 'closed' WHERE id = ?`).run(row.id);
        closed++;
      } catch { /* ok — per-row */ }
    }
  } catch (err) {
    logger?.warn?.("world-doors", "auto_close_failed", { error: err?.message });
  }
  return { ok: true, closed };
}
