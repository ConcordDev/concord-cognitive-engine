// server/lib/world-bosses.js
//
// Phase BD1 — world boss scheduler + lockout primitives.
//
// The heartbeat (server/emergent/world-boss-cycle.js) scans the
// schedule and opens any whose next_spawn_at <= now. This file
// exposes the read + defeat + lockout primitives.

import crypto from "node:crypto";
import logger from "../logger.js";

const DEFAULT_LOCKOUT_HOURS = {
  finder: 24,
  normal: 72,
  heroic: 168,
  mythic: 168,
};

const DEFAULT_ENCOUNTER_WINDOW_S = 60 * 60; // 1h to engage after spawn

export function registerSchedule(db, opts = {}) {
  const id = opts.id || `wbs_${crypto.randomBytes(6).toString("hex")}`;
  const { worldId, bossTemplate, cadenceSeconds = 86400, difficultyTierDefault = "normal" } = opts;
  if (!worldId || !bossTemplate) return { ok: false, error: "missing_inputs" };
  try {
    const nextSpawnAt = opts.nextSpawnAt || (Math.floor(Date.now() / 1000) + 30);
    db.prepare(`
      INSERT INTO world_boss_schedule
        (id, world_id, boss_template, cadence_seconds, next_spawn_at, difficulty_tier_default)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        world_id = excluded.world_id,
        boss_template = excluded.boss_template,
        cadence_seconds = excluded.cadence_seconds,
        next_spawn_at = excluded.next_spawn_at,
        difficulty_tier_default = excluded.difficulty_tier_default
    `).run(id, worldId, bossTemplate, cadenceSeconds, nextSpawnAt, difficultyTierDefault);
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * One trigger pass: open every schedule whose next_spawn_at <= now,
 * advance its next_spawn_at by cadence. Idempotent within the same
 * pass (uses UPDATE-then-INSERT).
 */
export function runTriggerPass(db, opts = {}) {
  if (!db) return { ok: false, error: "missing_db" };
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const opened = [];
  try {
    const wallNow = Math.floor(Date.now() / 1000);
    const due = db.prepare(`
      SELECT * FROM world_boss_schedule WHERE enabled = 1 AND next_spawn_at <= ?
    `).all(now);
    for (const s of due) {
      const activeId = `wba_${crypto.randomBytes(6).toString("hex")}`;
      // opened_at + closes_at use wall-clock so listActiveBosses (which
      // filters closes_at > unixepoch()) returns the row correctly.
      db.prepare(`
        INSERT INTO world_boss_active
          (id, schedule_id, world_id, boss_template, difficulty_tier, opened_at, closes_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        activeId, s.id, s.world_id, s.boss_template,
        s.difficulty_tier_default, wallNow, wallNow + DEFAULT_ENCOUNTER_WINDOW_S,
      );
      const nextSpawnAt = now + s.cadence_seconds;
      db.prepare(`
        UPDATE world_boss_schedule
        SET last_spawn_at = ?, next_spawn_at = ?
        WHERE id = ?
      `).run(now, nextSpawnAt, s.id);
      opened.push({ activeId, scheduleId: s.id, worldId: s.world_id, bossTemplate: s.boss_template });
    }
    return { ok: true, opened };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Mark a boss defeated + apply lockouts to the participating players.
 * Idempotent on (user_id, schedule_id) lockouts.
 */
export function defeatBoss(db, opts = {}) {
  if (!db) return { ok: false, error: "missing_db" };
  const { activeId, participantUserIds = [] } = opts;
  if (!activeId) return { ok: false, error: "missing_activeId" };
  try {
    const active = db.prepare(`SELECT * FROM world_boss_active WHERE id = ?`).get(activeId);
    if (!active) return { ok: false, error: "no_active" };
    if (active.status === "defeated") return { ok: false, error: "already_defeated" };

    db.prepare(`UPDATE world_boss_active SET status = 'defeated' WHERE id = ?`).run(activeId);
    const tier = active.difficulty_tier || "normal";
    const lockoutH = DEFAULT_LOCKOUT_HOURS[tier] || 72;
    const lockedUntil = Math.floor(Date.now() / 1000) + lockoutH * 3600;

    for (const uid of participantUserIds) {
      db.prepare(`
        INSERT INTO world_boss_lockouts (user_id, schedule_id, locked_until)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, schedule_id) DO UPDATE
          SET locked_until = excluded.locked_until
      `).run(uid, active.schedule_id, lockedUntil);
    }
    logger.info?.("world-bosses", "defeated", { activeId, scheduleId: active.schedule_id, lockedUntil, participants: participantUserIds.length });
    return { ok: true, lockedUntil, lockoutHours: lockoutH };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function isLockedOut(db, userId, scheduleId) {
  if (!db || !userId || !scheduleId) return false;
  try {
    const row = db.prepare(`
      SELECT locked_until FROM world_boss_lockouts
      WHERE user_id = ? AND schedule_id = ?
    `).get(userId, scheduleId);
    return !!row && row.locked_until > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

export function listActiveBosses(db, worldId) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT id, schedule_id, boss_template, difficulty_tier, opened_at, closes_at, status
      FROM world_boss_active
      WHERE world_id = ? AND status = 'open' AND closes_at > unixepoch()
      ORDER BY opened_at DESC
    `).all(worldId);
  } catch { return []; }
}

export function listSchedule(db, worldId) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT id, boss_template, cadence_seconds, next_spawn_at, difficulty_tier_default, enabled
      FROM world_boss_schedule WHERE world_id = ?
    `).all(worldId);
  } catch { return []; }
}

/** Expire active bosses past their closes_at window. */
export function sweepExpiredActive(db) {
  if (!db) return { ok: false };
  try {
    const r = db.prepare(`
      UPDATE world_boss_active
      SET status = 'expired'
      WHERE status = 'open' AND closes_at <= unixepoch()
    `).run();
    return { ok: true, expired: r.changes || 0 };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export { DEFAULT_LOCKOUT_HOURS, DEFAULT_ENCOUNTER_WINDOW_S };
