// economy/reserves.js
// SQLite-backed reserve accounting for the chargeback reserve policy.
//
// Policy summary:
//   - Platform reserves cover chargebacks (creators keep distributions).
//   - Reserve funded by 25% of platform fee revenue (6-month target).
//   - Once at target, drops to 5% maintenance rate.
//
// All monetary amounts stored as integer cents (no floating-point in DB).

import { randomUUID } from "crypto";

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function reserveLedgerId() {
  return "rl_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

// ── Reserve names ────────────────────────────────────────────────────────────

const RESERVE_CHARGEBACK = "chargebackReserve";
const RESERVE_OPERATING  = "operatingReserve";
const RESERVE_TREASURY   = "treasuryReserve";

// ── Policy constants ─────────────────────────────────────────────────────────

// 25% of each fee goes to chargebackReserve until 6-month target is reached.
const CHARGEBACK_ALLOCATION_RATE      = 0.25;
// 5% maintenance rate once target is met.
const CHARGEBACK_MAINTENANCE_RATE     = 0.05;
// Operating reserve receives the remainder after chargeback allocation.
const OPERATING_ALLOCATION_RATE_FULL  = 0.75; // = 1 - 0.25 when building
const OPERATING_ALLOCATION_RATE_MAINT = 0.95; // = 1 - 0.05 when at target

// 6-month target: approximated as 180 days × average daily chargeback spend.
// In the absence of historical data, we use a fixed seed target (100 USD =
// 10_000 cents) that grows as the reserve history builds up.
const SIX_MONTH_TARGET_SEED_CENTS = 10_000_00; // $10,000 default seed target

// Coverage thresholds (days) for health status
const COVERAGE_HEALTHY  = 90;
const COVERAGE_LOW      = 30;

// ── Schema ───────────────────────────────────────────────────────────────────

/**
 * Create reserves_balance and reserves_ledger tables if they do not exist.
 * Safe to call multiple times (idempotent).
 *
 * @param {import('better-sqlite3').Database} db
 */
export function initReservesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reserves_balance (
      reserve    TEXT    PRIMARY KEY,
      balance_cents INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reserves_ledger (
      id          TEXT PRIMARY KEY,
      reserve     TEXT NOT NULL,
      type        TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      source_tx_id TEXT,
      description TEXT,
      created_at  TEXT NOT NULL
    );
  `);

  // Ensure all three reserve rows exist with a zero balance if not already set.
  const upsertBalance = db.prepare(`
    INSERT OR IGNORE INTO reserves_balance (reserve, balance_cents, updated_at)
    VALUES (?, 0, ?)
  `);
  const now = nowISO();
  upsertBalance.run(RESERVE_CHARGEBACK, now);
  upsertBalance.run(RESERVE_OPERATING,  now);
  upsertBalance.run(RESERVE_TREASURY,   now);
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Read current balance for a reserve (returns 0 if missing).
 */
function readBalance(db, reserve) {
  const row = db.prepare(
    "SELECT balance_cents FROM reserves_balance WHERE reserve = ?"
  ).get(reserve);
  return row ? row.balance_cents : 0;
}

/**
 * Add delta_cents to a reserve balance and record a ledger entry.
 * delta_cents may be negative (debit).
 */
function applyBalanceDelta(db, { reserve, deltaCents, type, sourceTxId, description }) {
  const now = nowISO();

  // Single-transaction delta: the balance UPDATE and its ledger INSERT
  // either both land or neither does. better-sqlite3 nests transactions
  // as SAVEPOINTs, so a caller (e.g. allocateFromFee) that wraps two
  // applyBalanceDelta calls in an outer db.transaction(...) composes
  // safely — this inner transaction becomes a savepoint of the outer one.
  const tx = db.transaction(() => {
    // Update balance
    db.prepare(`
      UPDATE reserves_balance
         SET balance_cents = balance_cents + ?,
             updated_at    = ?
       WHERE reserve = ?
    `).run(deltaCents, now, reserve);

    // Ledger entry (always positive amount; type encodes direction)
    db.prepare(`
      INSERT INTO reserves_ledger (id, reserve, type, amount_cents, source_tx_id, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      reserveLedgerId(),
      reserve,
      type,
      Math.abs(deltaCents),
      sourceTxId || null,
      description || null,
      now,
    );
  });
  tx();
}

/**
 * Compute the 6-month target based on historical chargeback spend.
 * Falls back to the seed target when there is insufficient history.
 */
function computeSixMonthTarget(db) {
  try {
    const cutoff180 = new Date(Date.now() - 180 * 86400 * 1000)
      .toISOString().replace("T", " ").replace("Z", "");
    const row = db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS total
        FROM reserves_ledger
       WHERE type = 'chargeback_payout'
         AND created_at >= ?
    `).get(cutoff180);
    const spent180 = row ? row.total : 0;
    // Target = what we spent in the last 180 days (at minimum the seed)
    return Math.max(SIX_MONTH_TARGET_SEED_CENTS, spent180);
  } catch {
    return SIX_MONTH_TARGET_SEED_CENTS;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Allocate a portion of a platform fee to reserves.
 *
 * 25% → chargebackReserve (while below 6-month target; 5% in maintenance)
 * remainder → operatingReserve
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ feeAmount: number, sourceTxId: string, requestId?: string, ip?: string }} opts
 *   feeAmount is in the same units as the rest of the economy (Concord Coins).
 *   Stored internally as integer cents (multiply by 100).
 * @returns {{ ok: boolean, chargebackAllocation: number, operatingAllocation: number }}
 */
export function allocateFromFee(db, { feeAmount, sourceTxId, requestId, ip }) {
  try {
    // Convert to integer cents
    const feeCents = Math.round((feeAmount || 0) * 100);
    if (feeCents <= 0) {
      return { ok: true, chargebackAllocation: 0, operatingAllocation: 0 };
    }

    const chargebackBalance = readBalance(db, RESERVE_CHARGEBACK);
    const target            = computeSixMonthTarget(db);
    const atTarget          = chargebackBalance >= target;

    const chargebackRate = atTarget ? CHARGEBACK_MAINTENANCE_RATE : CHARGEBACK_ALLOCATION_RATE;
    const operatingRate  = atTarget ? OPERATING_ALLOCATION_RATE_MAINT : OPERATING_ALLOCATION_RATE_FULL;

    // Use integer arithmetic to avoid floating-point drift
    const chargebackCents = Math.round(feeCents * chargebackRate);
    const operatingCents  = feeCents - chargebackCents; // exact complement

    // Outer transaction: the chargeback + operating allocations from the
    // same fee split either both land or neither does. applyBalanceDelta's
    // own db.transaction(...) nests as a SAVEPOINT inside this one (see
    // its comment) — a crash between the two calls no longer leaves one
    // reserve credited without its sibling.
    const allocateTx = db.transaction(() => {
      applyBalanceDelta(db, {
        reserve:     RESERVE_CHARGEBACK,
        deltaCents:  chargebackCents,
        type:        "fee_allocation",
        sourceTxId,
        description: `Fee allocation (${atTarget ? "maintenance" : "building"} phase); requestId=${requestId || "-"} ip=${ip || "-"}`,
      });

      applyBalanceDelta(db, {
        reserve:     RESERVE_OPERATING,
        deltaCents:  operatingCents,
        type:        "fee_allocation",
        sourceTxId,
        description: `Operating allocation from fee; requestId=${requestId || "-"} ip=${ip || "-"}`,
      });
    });
    allocateTx();

    return {
      ok:                   true,
      chargebackAllocation: chargebackCents / 100,
      operatingAllocation:  operatingCents  / 100,
    };
  } catch (err) {
    console.error("[reserves] allocateFromFee failed:", err.message);
    return { ok: false, chargebackAllocation: 0, operatingAllocation: 0 };
  }
}

/**
 * Debit the chargeback reserve to cover a dispute payout.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ chargebackAmount: number, sourceTxId: string, requestId?: string, ip?: string }} opts
 *   chargebackAmount in Concord Coins.
 * @returns {{ ok: boolean, error?: string }}
 */
export function payChargeback(db, { chargebackAmount, sourceTxId, requestId, ip }) {
  try {
    const amountCents = Math.round((chargebackAmount || 0) * 100);
    if (amountCents <= 0) return { ok: true };

    const balance = readBalance(db, RESERVE_CHARGEBACK);
    if (balance < amountCents) {
      return {
        ok:    false,
        error: "insufficient_reserve",
        detail: `Reserve has ${balance} cents; need ${amountCents} cents`,
      };
    }

    applyBalanceDelta(db, {
      reserve:     RESERVE_CHARGEBACK,
      deltaCents:  -amountCents,
      type:        "chargeback_payout",
      sourceTxId,
      description: `Chargeback payout; requestId=${requestId || "-"} ip=${ip || "-"}`,
    });

    return { ok: true };
  } catch (err) {
    console.error("[reserves] payChargeback failed:", err.message);
    return { ok: false, error: "reserve_debit_failed" };
  }
}

/**
 * Return current balances for all three reserves.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ chargebackReserve: number, operatingReserve: number, treasuryReserve: number }}
 *   Values in Concord Coins (divide internal cents by 100).
 */
export function getReserveBalance(db) {
  const rows = db.prepare(
    "SELECT reserve, balance_cents FROM reserves_balance"
  ).all();

  const map = {};
  for (const row of rows) map[row.reserve] = row.balance_cents;

  return {
    chargebackReserve: (map[RESERVE_CHARGEBACK] || 0) / 100,
    operatingReserve:  (map[RESERVE_OPERATING]  || 0) / 100,
    treasuryReserve:   (map[RESERVE_TREASURY]   || 0) / 100,
  };
}

/**
 * Return reserve health metrics.
 *
 * Status:
 *   'healthy'  — >90 days coverage
 *   'low'      — 30–90 days coverage
 *   'critical' — <30 days coverage
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{
 *   status: 'healthy'|'low'|'critical',
 *   chargebackReserve: number,
 *   target6Months: number,
 *   sufficiencyDays: number,
 *   chargebackRateLast30Days: number
 * }}
 */
export function getReserveHealth(db) {
  const chargebackCents = readBalance(db, RESERVE_CHARGEBACK);
  const target6Months   = computeSixMonthTarget(db);

  // Average daily chargeback spend over last 30 days
  let chargebackRateLast30Days = 0;
  try {
    const cutoff30 = new Date(Date.now() - 30 * 86400 * 1000)
      .toISOString().replace("T", " ").replace("Z", "");
    const row = db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS total
        FROM reserves_ledger
       WHERE type = 'chargeback_payout'
         AND created_at >= ?
    `).get(cutoff30);
    const spent30 = row ? row.total : 0;
    chargebackRateLast30Days = spent30 / 30; // average daily cents
  } catch {
    chargebackRateLast30Days = 0;
  }

  // sufficiencyDays = how many days current reserve covers at current burn rate
  const sufficiencyDays = chargebackRateLast30Days > 0
    ? Math.floor(chargebackCents / chargebackRateLast30Days)
    : Infinity;

  let status;
  if (sufficiencyDays === Infinity || sufficiencyDays > COVERAGE_HEALTHY) {
    status = "healthy";
  } else if (sufficiencyDays >= COVERAGE_LOW) {
    status = "low";
  } else {
    status = "critical";
  }

  return {
    status,
    chargebackReserve:        chargebackCents / 100,
    target6Months:            target6Months   / 100,
    sufficiencyDays:          sufficiencyDays === Infinity ? null : sufficiencyDays,
    chargebackRateLast30Days: chargebackRateLast30Days     / 100,
  };
}
