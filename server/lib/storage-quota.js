// server/lib/storage-quota.js
//
// Per-user storage quota with earned expansion via creator activity.
// See migrations/099_user_storage.js for the schema rationale.
//
// Public API:
//   getUserStorage(db, userId)        → { used, quota, remainingBytes, percentUsed, earnedTotal }
//   assertHasSpaceFor(db, userId, b)  → throws { code: "quota_exceeded", ... } when insufficient
//   recordStorageDelta(...)           → updates counter + audit ledger (also handles deletes)
//   grantEarnedStorage(...)           → idempotent grant keyed by trigger event id
//
// Knobs (env-tunable):
//   CONCORD_STORAGE_BASELINE_GB                 default 5
//   CONCORD_STORAGE_EARN_PER_ROYALTY_BATCH_MB   default 1024
//   CONCORD_STORAGE_EARN_PER_MEGA_MB            default 512
//   CONCORD_STORAGE_EARN_PER_SALE_BATCH_MB      default 1024
//   CONCORD_STORAGE_MAX_EARNED_GB               default 50

import crypto from "node:crypto";

const GiB = 1024 * 1024 * 1024;
const MiB = 1024 * 1024;

export const STORAGE_BASELINE_BYTES =
  Number(process.env.CONCORD_STORAGE_BASELINE_GB || 5) * GiB;

export const STORAGE_EARN_PER_ROYALTY_BATCH_BYTES =
  Number(process.env.CONCORD_STORAGE_EARN_PER_ROYALTY_BATCH_MB || 1024) * MiB;

export const STORAGE_EARN_PER_MEGA_BYTES =
  Number(process.env.CONCORD_STORAGE_EARN_PER_MEGA_MB || 512) * MiB;

export const STORAGE_EARN_PER_SALE_BATCH_BYTES =
  Number(process.env.CONCORD_STORAGE_EARN_PER_SALE_BATCH_MB || 1024) * MiB;

export const STORAGE_MAX_EARNED_BYTES =
  Number(process.env.CONCORD_STORAGE_MAX_EARNED_GB || 50) * GiB;

// Royalty payouts get bundled into batches before granting. Same for sales.
export const ROYALTY_BATCH_SIZE = Number(process.env.CONCORD_STORAGE_ROYALTY_BATCH_SIZE || 100);
export const SALE_BATCH_SIZE    = Number(process.env.CONCORD_STORAGE_SALE_BATCH_SIZE    || 10);

const REASONS = Object.freeze({
  UPLOAD: "upload",
  DELETE: "delete",
  EARNED_ROYALTY: "earned_royalty",
  EARNED_MEGA:    "earned_mega",
  EARNED_SALE:    "earned_sale",
});

/**
 * Read the user's current storage state.
 * @returns {{ used: number, quota: number, remainingBytes: number, percentUsed: number, earnedTotal: number }}
 */
export function getUserStorage(db, userId) {
  if (!db || !userId) {
    return { used: 0, quota: STORAGE_BASELINE_BYTES, remainingBytes: STORAGE_BASELINE_BYTES, percentUsed: 0, earnedTotal: 0 };
  }
  const row = db.prepare(
    `SELECT storage_bytes_used AS used, storage_bytes_quota AS quota FROM users WHERE id = ?`
  ).get(userId);
  if (!row) {
    return { used: 0, quota: STORAGE_BASELINE_BYTES, remainingBytes: STORAGE_BASELINE_BYTES, percentUsed: 0, earnedTotal: 0 };
  }
  const used = Number(row.used) || 0;
  const quota = Number(row.quota) || STORAGE_BASELINE_BYTES;
  const remainingBytes = Math.max(0, quota - used);
  const percentUsed = quota > 0 ? Math.min(100, Math.round((used / quota) * 1000) / 10) : 0;
  const earnedTotal = Math.max(0, quota - STORAGE_BASELINE_BYTES);
  return { used, quota, remainingBytes, percentUsed, earnedTotal };
}

/**
 * Throws when the requested byte count would exceed the user's quota.
 * Caller catches and returns 413 with the structured payload.
 */
export function assertHasSpaceFor(db, userId, bytes) {
  const requested = Math.max(0, Number(bytes) || 0);
  if (!userId) {
    const err = new Error("auth_required");
    err.code = "auth_required";
    throw err;
  }
  const { used, quota } = getUserStorage(db, userId);
  if (used + requested > quota) {
    const err = new Error("quota_exceeded");
    err.code = "quota_exceeded";
    err.payload = {
      ok: false,
      error: "quota_exceeded",
      used,
      quota,
      requested,
      shortBy: used + requested - quota,
      earnPaths: ["royalty_payouts", "mega_promotions", "marketplace_sales"],
      message: "Storage quota reached. Earn more space by receiving royalty payouts, having DTUs promoted to MEGA, or selling artifacts on the marketplace.",
    };
    throw err;
  }
  return true;
}

/**
 * Record a byte change (upload positive, delete negative). Updates the
 * users counter atomically and writes an audit row. Heartbeat-tolerant:
 * any failure is logged and re-thrown only when the caller asks.
 */
export function recordStorageDelta(db, userId, deltaBytes, reason, artifactId = null) {
  if (!db || !userId || !Number.isFinite(deltaBytes) || deltaBytes === 0) return;
  const trx = db.transaction(() => {
    db.prepare(
      `UPDATE users SET storage_bytes_used = MAX(0, storage_bytes_used + ?) WHERE id = ?`
    ).run(Math.trunc(deltaBytes), userId);
    db.prepare(
      `INSERT INTO storage_audit (id, user_id, delta_bytes, reason, artifact_id) VALUES (?, ?, ?, ?, ?)`
    ).run(`stx_${crypto.randomUUID()}`, userId, Math.trunc(deltaBytes), String(reason || REASONS.UPLOAD), artifactId);
  });
  try { trx(); } catch (e) {
    // Logged but not thrown — storage accounting drift is recoverable;
    // crashing the upload pipeline is not.
    try { console.warn("[storage-quota] recordStorageDelta failed", { userId, deltaBytes, reason, error: e?.message }); } catch { /* ignore */ }
  }
}

/**
 * Grant earned storage. Idempotent — the grantKey (e.g., the royalty
 * payout id, MEGA dtu id, or sale id) is unique-indexed so retries are
 * safe. Grants are capped per user at STORAGE_MAX_EARNED_BYTES so a
 * single power-creator can't consume the whole disk.
 *
 * @returns {{ granted: boolean, deltaBytes: number, newQuota: number, reason: string }}
 */
export function grantEarnedStorage(db, userId, reason, deltaBytes, grantKey) {
  if (!db || !userId || !grantKey) return { granted: false, deltaBytes: 0, newQuota: 0, reason };
  const ask = Math.max(0, Math.trunc(Number(deltaBytes) || 0));
  if (ask <= 0) return { granted: false, deltaBytes: 0, newQuota: 0, reason };

  const trx = db.transaction(() => {
    // Idempotency: skip if this grant_key already recorded.
    const existing = db.prepare(`SELECT id FROM storage_audit WHERE grant_key = ?`).get(grantKey);
    if (existing) return { granted: false, deltaBytes: 0 };

    const row = db.prepare(`SELECT storage_bytes_quota AS quota FROM users WHERE id = ?`).get(userId);
    if (!row) return { granted: false, deltaBytes: 0 };

    const earnedSoFar = Math.max(0, Number(row.quota) - STORAGE_BASELINE_BYTES);
    const remainingHeadroom = Math.max(0, STORAGE_MAX_EARNED_BYTES - earnedSoFar);
    const actualDelta = Math.min(ask, remainingHeadroom);
    if (actualDelta <= 0) return { granted: false, deltaBytes: 0 };

    db.prepare(`UPDATE users SET storage_bytes_quota = storage_bytes_quota + ? WHERE id = ?`)
      .run(actualDelta, userId);
    db.prepare(
      `INSERT INTO storage_audit (id, user_id, delta_bytes, reason, grant_key) VALUES (?, ?, ?, ?, ?)`
    ).run(`stx_${crypto.randomUUID()}`, userId, actualDelta, String(reason), grantKey);

    return { granted: true, deltaBytes: actualDelta };
  });

  try {
    const result = trx();
    const fresh = db.prepare(`SELECT storage_bytes_quota AS quota FROM users WHERE id = ?`).get(userId);
    return { ...result, newQuota: Number(fresh?.quota) || 0, reason };
  } catch (e) {
    try { console.warn("[storage-quota] grantEarnedStorage failed", { userId, reason, grantKey, error: e?.message }); } catch { /* ignore */ }
    return { granted: false, deltaBytes: 0, newQuota: 0, reason };
  }
}

/**
 * Helper: count receipts of a given type since the user's last grant.
 * Used by the earning hooks to decide whether a new batch threshold
 * has been crossed. Returns total received vs. how many have already
 * triggered a grant — the difference becomes new grants.
 */
export function countTriggersSinceLastGrant(db, userId, reason) {
  if (!db || !userId) return 0;
  try {
    const row = db.prepare(
      `SELECT COUNT(*) AS n FROM storage_audit WHERE user_id = ? AND reason = ?`
    ).get(userId, reason);
    return Number(row?.n) || 0;
  } catch {
    return 0;
  }
}

export const STORAGE_REASONS = REASONS;
