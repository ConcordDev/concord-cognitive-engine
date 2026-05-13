// server/lib/tunyan-jobs.js
//
// Concordia Phase 10 — Tunyan jobs + rations lib.
//
// Macros surface:
//   - listOpenJobs(db) — authored Tunyan job catalog
//   - applyForJob(db, userId, worldId, jobId) — set employment row
//   - completeShift(db, userId, worldId) — pay wage, bump counter,
//     log shift. Returns { ok, paid_sparks, shifts_completed }.
//   - resign(db, userId, worldId) — clear job (demographic_kind ←
//     'unemployed').
//   - getMyEmployment(db, userId, worldId)
//   - mintRationsForEligible(db) — heartbeat tick. Reads
//     player_employment rows, for each demographic_kind in the
//     entitlement table, mints the monthly stipend if the player has
//     not been minted within the past 30 days.

import logger from "../logger.js";

const RATION_TICK_DAYS = 30;
const SHIFT_COOLDOWN_S = 6 * 3600; // can complete one shift per 6 in-real-time hours

export function listOpenJobs(db) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT id, name, archetype, wage_sparks, shift_hours, risk_pct, location_hint, skill_required
      FROM tunyan_jobs ORDER BY wage_sparks DESC
    `).all();
  } catch { return []; }
}

export function getMyEmployment(db, userId, worldId = "concordia-hub") {
  if (!db || !userId) return null;
  try {
    return db.prepare(`
      SELECT user_id, world_id, job_id, demographic_kind, employed_at, last_shift_at, shifts_completed
      FROM player_employment WHERE user_id = ? AND world_id = ?
    `).get(userId, worldId) || null;
  } catch { return null; }
}

export function applyForJob(db, userId, worldId, jobId) {
  if (!db || !userId || !worldId || !jobId) return { ok: false, reason: "missing_inputs" };
  try {
    const job = db.prepare(`SELECT id FROM tunyan_jobs WHERE id = ?`).get(jobId);
    if (!job) return { ok: false, reason: "job_not_found" };
    db.prepare(`
      INSERT INTO player_employment (user_id, world_id, job_id, demographic_kind, employed_at)
      VALUES (?, ?, ?, 'employed_baseline', unixepoch())
      ON CONFLICT(user_id, world_id) DO UPDATE
        SET job_id = excluded.job_id,
            demographic_kind = 'employed_baseline',
            employed_at = unixepoch(),
            last_shift_at = NULL
    `).run(userId, worldId, jobId);
    return { ok: true, action: "hired", jobId };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function resign(db, userId, worldId = "concordia-hub") {
  if (!db || !userId) return { ok: false, reason: "missing_inputs" };
  try {
    db.prepare(`
      INSERT INTO player_employment (user_id, world_id, job_id, demographic_kind)
      VALUES (?, ?, NULL, 'unemployed')
      ON CONFLICT(user_id, world_id) DO UPDATE
        SET job_id = NULL, demographic_kind = 'unemployed'
    `).run(userId, worldId);
    return { ok: true, action: "resigned" };
  } catch (err) {
    return { ok: false, reason: "update_failed", error: err?.message };
  }
}

/**
 * Complete a shift. Returns paid wage. Wage is credited via
 * mintCoins if the wallet module is present; otherwise we still
 * advance the shifts_completed counter (audit-only mode).
 */
export async function completeShift(db, userId, worldId = "concordia-hub", { mintFn = null } = {}) {
  if (!db || !userId) return { ok: false, reason: "missing_inputs" };
  const emp = getMyEmployment(db, userId, worldId);
  if (!emp || !emp.job_id) return { ok: false, reason: "not_employed" };
  const now = Math.floor(Date.now() / 1000);
  if (emp.last_shift_at && now - emp.last_shift_at < SHIFT_COOLDOWN_S) {
    return { ok: false, reason: "shift_cooldown", retry_at: emp.last_shift_at + SHIFT_COOLDOWN_S };
  }
  const job = db.prepare(`SELECT wage_sparks FROM tunyan_jobs WHERE id = ?`).get(emp.job_id);
  if (!job) return { ok: false, reason: "job_missing" };

  db.prepare(`
    UPDATE player_employment
    SET last_shift_at = ?, shifts_completed = shifts_completed + 1
    WHERE user_id = ? AND world_id = ?
  `).run(now, userId, worldId);

  // Wage payment. Try to mint via the supplied mintFn (caller passes
  // it from world-events.js#mintCoins). On builds without the wallet,
  // skip silently — the shift counter still advances.
  let paidViaMint = false;
  if (typeof mintFn === "function") {
    try {
      const r = await mintFn(db, userId, job.wage_sparks, { refId: `wage:${emp.job_id}:${userId}:${now}` });
      paidViaMint = !!r?.ok;
    } catch { /* mint failed — counter still incremented */ }
  }
  return { ok: true, action: "shift_paid", paid_sparks: job.wage_sparks, shifts_completed: emp.shifts_completed + 1, paidViaMint };
}

/**
 * Mint monthly rations for everyone eligible. Skips users whose last
 * mint within the past RATION_TICK_DAYS. Returns counts.
 *
 * `mintFn(db, userId, sparks, { refId })` matches the wallet API.
 */
export async function mintRationsForEligible(db, { mintFn = null } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  let minted = 0, skipped = 0;
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - RATION_TICK_DAYS * 86400;

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ration_mint_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        world_id TEXT NOT NULL,
        demographic_kind TEXT NOT NULL,
        amount_sparks INTEGER NOT NULL,
        minted_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
  } catch { /* table exists */ }

  const rows = db.prepare(`
    SELECT pe.user_id, pe.world_id, pe.demographic_kind, re.monthly_sparks,
           (SELECT MAX(minted_at) FROM ration_mint_log
              WHERE user_id = pe.user_id AND world_id = pe.world_id) AS last_minted_at
    FROM player_employment pe
    JOIN ration_entitlements re ON re.demographic_kind = pe.demographic_kind
    WHERE re.monthly_sparks > 0
  `).all();

  for (const row of rows) {
    if (row.last_minted_at && row.last_minted_at > cutoff) {
      skipped++;
      continue;
    }
    if (typeof mintFn === "function") {
      try {
        await mintFn(db, row.user_id, row.monthly_sparks, {
          refId: `ration:${row.world_id}:${row.user_id}:${now}`,
        });
      } catch (err) {
        try { logger.warn?.("ration_mint_failed", { userId: row.user_id, error: err?.message }); } catch { /* noop */ }
      }
    }
    db.prepare(`
      INSERT INTO ration_mint_log (user_id, world_id, demographic_kind, amount_sparks)
      VALUES (?, ?, ?, ?)
    `).run(row.user_id, row.world_id, row.demographic_kind, row.monthly_sparks);
    minted++;
  }

  return { ok: true, minted, skipped };
}

export function setDemographicKind(db, userId, worldId, demographic_kind) {
  if (!db || !userId || !worldId || !demographic_kind) return { ok: false, reason: "missing_inputs" };
  const exists = db.prepare(`SELECT 1 FROM ration_entitlements WHERE demographic_kind = ?`).get(demographic_kind);
  if (!exists) return { ok: false, reason: "unknown_demographic" };
  try {
    db.prepare(`
      INSERT INTO player_employment (user_id, world_id, demographic_kind)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, world_id) DO UPDATE SET demographic_kind = excluded.demographic_kind
    `).run(userId, worldId, demographic_kind);
    return { ok: true, action: "set", demographic_kind };
  } catch (err) {
    return { ok: false, reason: "update_failed", error: err?.message };
  }
}

export function listRationEntitlements(db) {
  if (!db) return [];
  try {
    return db.prepare(`SELECT demographic_kind, monthly_sparks, description FROM ration_entitlements`).all();
  } catch { return []; }
}

export const JOBS_CONSTANTS = Object.freeze({
  RATION_TICK_DAYS,
  SHIFT_COOLDOWN_S,
});
