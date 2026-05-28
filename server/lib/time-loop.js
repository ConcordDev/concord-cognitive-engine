// server/lib/time-loop.js
//
// Phase CC5 — time loop (Outer Wilds-style).
//
// Default loop duration: 22 minutes (1320s). Each loop's end captures
// inventory + position; on next loop-start, these are restored.
// Memories live as DTUs flagged retained_across_loops.

import crypto from "node:crypto";
import logger from "../logger.js";

const DEFAULT_LOOP_DURATION_S = 22 * 60;

export function startLoop(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const { worldId, duration = DEFAULT_LOOP_DURATION_S, inventorySnapshot, positionSnapshot } = opts;
  if (!worldId) return { ok: false, error: "missing_worldId" };
  if (process.env.CONCORD_TIME_LOOPS === "0") {
    return { ok: false, error: "disabled" };
  }
  try {
    // Restore from prior loop if it exists.
    const prior = db.prepare(`
      SELECT loop_number, inventory_snapshot_json, position_snapshot_json
      FROM time_loop_sessions
      WHERE user_id = ? AND world_id = ? AND ended_at IS NOT NULL
      ORDER BY started_at DESC LIMIT 1
    `).get(userId, worldId);

    // Active session — return alreadyActive.
    const active = db.prepare(`
      SELECT id, loop_number FROM time_loop_sessions
      WHERE user_id = ? AND world_id = ? AND ended_at IS NULL
    `).get(userId, worldId);
    if (active) return { ok: true, sessionId: active.id, loopNumber: active.loop_number, alreadyActive: true };

    const id = `tls_${crypto.randomBytes(6).toString("hex")}`;
    const loopNumber = (prior?.loop_number || 0) + 1;
    db.prepare(`
      INSERT INTO time_loop_sessions
        (id, user_id, world_id, loop_number, duration_s,
         inventory_snapshot_json, position_snapshot_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId, worldId, loopNumber, Math.max(60, Math.floor(duration)),
      inventorySnapshot ? JSON.stringify(inventorySnapshot) : (prior?.inventory_snapshot_json || null),
      positionSnapshot ? JSON.stringify(positionSnapshot) : (prior?.position_snapshot_json || null),
    );
    logger.info?.("time-loop", "loop_started", { sessionId: id, userId, loopNumber });
    return {
      ok: true, sessionId: id, loopNumber, alreadyActive: false,
      restoredInventory: prior?.inventory_snapshot_json ? JSON.parse(prior.inventory_snapshot_json) : null,
      restoredPosition: prior?.position_snapshot_json ? JSON.parse(prior.position_snapshot_json) : null,
    };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function endLoop(db, sessionId, opts = {}) {
  if (!db || !sessionId) return { ok: false, error: "missing_inputs" };
  const { reason = "timeout", inventorySnapshot, positionSnapshot } = opts;
  if (!["death", "timeout", "manual_exit", "complete"].includes(reason)) {
    return { ok: false, error: "invalid_reason" };
  }
  try {
    const session = db.prepare(`SELECT user_id, world_id, ended_at FROM time_loop_sessions WHERE id = ?`).get(sessionId);
    if (!session) return { ok: false, error: "no_session" };
    if (session.ended_at) return { ok: false, error: "already_ended" };

    db.prepare(`
      UPDATE time_loop_sessions
      SET ended_at = unixepoch(), end_reason = ?,
          inventory_snapshot_json = COALESCE(?, inventory_snapshot_json),
          position_snapshot_json = COALESCE(?, position_snapshot_json)
      WHERE id = ?
    `).run(
      reason,
      inventorySnapshot ? JSON.stringify(inventorySnapshot) : null,
      positionSnapshot ? JSON.stringify(positionSnapshot) : null,
      sessionId,
    );
    logger.info?.("time-loop", "loop_ended", { sessionId, reason });
    return { ok: true, reason };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function recordMemory(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const { worldId, summary, memoryDtuId, firstLoopNumber } = opts;
  if (!worldId || !summary) return { ok: false, error: "missing_summary" };
  try {
    const id = `lmem_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO loop_memories
        (id, user_id, world_id, memory_dtu_id, summary, first_loop_number)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, worldId, memoryDtuId || null, summary, firstLoopNumber || 1);
    return { ok: true, memoryId: id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function getMemories(db, userId, worldId) {
  if (!db || !userId || !worldId) return [];
  try {
    return db.prepare(`
      SELECT id, summary, memory_dtu_id, first_loop_number, recorded_at
      FROM loop_memories
      WHERE user_id = ? AND world_id = ? AND retained_across_loops = 1
      ORDER BY recorded_at ASC
    `).all(userId, worldId);
  } catch { return []; }
}

export function getActiveLoop(db, userId, worldId) {
  if (!db || !userId || !worldId) return null;
  try {
    return db.prepare(`
      SELECT * FROM time_loop_sessions
      WHERE user_id = ? AND world_id = ? AND ended_at IS NULL
    `).get(userId, worldId) || null;
  } catch { return null; }
}

export { DEFAULT_LOOP_DURATION_S };
