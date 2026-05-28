// server/lib/roguelite.js
//
// Phase CB1 — roguelite meta-progression.
//
// Wraps the Phase 5e procgen-regions in a "run" concept: entering a
// region starts a run, leaving / dying ends it, meta-currency banks
// based on depth + end_reason. Unlocks gate persistent items via PK
// on (user, unlock_id).
//
// One active run per user at a time — `startRun` returns the existing
// active row if the user re-enters the same region.

import crypto from "node:crypto";
import logger from "../logger.js";

const DEATH_PENALTY_MULT = 0.5;       // half the banked currency on death
const EXTRACT_BONUS_MULT = 1.25;
const CURRENCY_PER_DEPTH = 5;

function _earnedCurrency(depth, reason) {
  const base = Math.max(0, depth) * CURRENCY_PER_DEPTH;
  if (reason === "death") return Math.floor(base * DEATH_PENALTY_MULT);
  if (reason === "extract") return Math.floor(base * EXTRACT_BONUS_MULT);
  return base;
}

export function startRun(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const { worldId, regionId } = opts;
  if (!worldId || !regionId) return { ok: false, error: "missing_world_or_region" };

  try {
    // Idempotency: if user has an active run for this region, return it.
    const active = db.prepare(`
      SELECT id, region_id FROM roguelite_runs
      WHERE user_id = ? AND ended_at IS NULL
    `).get(userId);
    if (active) {
      if (active.region_id === regionId) {
        return { ok: true, runId: active.id, alreadyActive: true };
      }
      // Different region — close the prior run as timeout, start fresh.
      db.prepare(`
        UPDATE roguelite_runs
        SET ended_at = unixepoch(), end_reason = 'timeout'
        WHERE id = ?
      `).run(active.id);
    }

    const id = `rgl_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO roguelite_runs (id, user_id, world_id, region_id)
      VALUES (?, ?, ?, ?)
    `).run(id, userId, worldId, regionId);
    logger.info?.("roguelite", "run_started", { runId: id, userId, regionId });
    return { ok: true, runId: id, alreadyActive: false };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function endRun(db, runId, opts = {}) {
  if (!db || !runId) return { ok: false, error: "missing_inputs" };
  const { reason = "manual_exit", depthReached = 1 } = opts;
  if (!["death", "extract", "timeout", "manual_exit"].includes(reason)) {
    return { ok: false, error: "invalid_reason" };
  }

  try {
    const run = db.prepare(`SELECT * FROM roguelite_runs WHERE id = ?`).get(runId);
    if (!run) return { ok: false, error: "no_run" };
    if (run.ended_at) return { ok: false, error: "already_ended" };

    const earned = _earnedCurrency(depthReached, reason);
    db.prepare(`
      UPDATE roguelite_runs
      SET ended_at = unixepoch(), end_reason = ?,
          meta_currency_earned = ?, depth_reached = ?
      WHERE id = ?
    `).run(reason, earned, depthReached, runId);

    if (earned > 0) {
      _grantCurrency(db, run.user_id, earned);
    }
    logger.info?.("roguelite", "run_ended", { runId, reason, earned, depthReached });
    return { ok: true, earned, reason };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

function _grantCurrency(db, userId, amount) {
  db.prepare(`
    INSERT INTO roguelite_meta_currency (user_id, balance, lifetime)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      balance = balance + excluded.balance,
      lifetime = lifetime + excluded.balance,
      updated_at = unixepoch()
  `).run(userId, amount, amount);
}

export function getBalance(db, userId) {
  if (!db || !userId) return { balance: 0, lifetime: 0 };
  try {
    const r = db.prepare(`SELECT balance, lifetime FROM roguelite_meta_currency WHERE user_id = ?`).get(userId);
    return r ? { balance: Number(r.balance), lifetime: Number(r.lifetime) } : { balance: 0, lifetime: 0 };
  } catch { return { balance: 0, lifetime: 0 }; }
}

/**
 * Spend meta-currency on a permanent unlock. Idempotent on
 * (user, unlock_id) — re-purchase rejected.
 */
export function purchaseUnlock(db, userId, unlockId, costCc) {
  if (!db || !userId || !unlockId) return { ok: false, error: "missing_inputs" };
  const cost = Math.max(0, Number(costCc) || 0);
  try {
    const existing = db.prepare(`
      SELECT 1 FROM roguelite_unlocks WHERE user_id = ? AND unlock_id = ?
    `).get(userId, unlockId);
    if (existing) return { ok: false, error: "already_unlocked" };

    const bal = getBalance(db, userId);
    if (bal.balance < cost) return { ok: false, error: "insufficient_funds", balance: bal.balance };

    db.prepare(`
      UPDATE roguelite_meta_currency SET balance = balance - ?, updated_at = unixepoch()
      WHERE user_id = ?
    `).run(cost, userId);
    db.prepare(`
      INSERT INTO roguelite_unlocks (user_id, unlock_id, cost_paid)
      VALUES (?, ?, ?)
    `).run(userId, unlockId, cost);
    return { ok: true, balanceRemaining: bal.balance - cost };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listUnlocks(db, userId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT unlock_id, unlocked_at, cost_paid FROM roguelite_unlocks
      WHERE user_id = ?
      ORDER BY unlocked_at DESC
    `).all(userId);
  } catch { return []; }
}

export function hasUnlock(db, userId, unlockId) {
  if (!db || !userId || !unlockId) return false;
  try {
    const r = db.prepare(`
      SELECT 1 FROM roguelite_unlocks WHERE user_id = ? AND unlock_id = ?
    `).get(userId, unlockId);
    return !!r;
  } catch { return false; }
}

export function getActiveRun(db, userId) {
  if (!db || !userId) return null;
  try {
    return db.prepare(`
      SELECT id, world_id, region_id, started_at, depth_reached
      FROM roguelite_runs WHERE user_id = ? AND ended_at IS NULL
    `).get(userId) || null;
  } catch { return null; }
}

export function listRecentRuns(db, userId, limit = 10) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, world_id, region_id, started_at, ended_at, end_reason,
             meta_currency_earned, depth_reached
      FROM roguelite_runs WHERE user_id = ?
      ORDER BY started_at DESC LIMIT ?
    `).all(userId, Math.max(1, Math.min(50, limit)));
  } catch { return []; }
}

export { CURRENCY_PER_DEPTH, DEATH_PENALTY_MULT, EXTRACT_BONUS_MULT };
