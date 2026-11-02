// economy/treasury.js
// The canonical platform pool: the __TREASURY__ ledger account.
//
// Gate 5 R1+R2 convergence (founder-approved, 2026-10-29): there is ONE
// reserve accounting. Fees are split 80/10/10 by economy/fee-split.js into
// __TREASURY__ / __OPERATING__ / __PAYROLL__ on the append-only
// economy_ledger; this module is the pool's read + single debit path:
//
//   - getTreasuryBalance — the pool balance, derived from the ledger.
//   - payChargeback      — the pool's ONLY debit: covers a chargeback by
//                          transferring __TREASURY__ → __PLATFORM__ (the
//                          platform settles the dispute externally), and
//                          only when the balance covers it in full.
//   - getReserveHealth   — coverage health for the admin/user surfaces,
//                          computed from the pool balance and the ledger's
//                          own chargeback payout history.
//
// This replaces the retired economy/reserves.js, which kept a second,
// unreconciled accounting in its own tables (reserves_balance /
// reserves_ledger) at different rates (25% chargeback / 75% operating,
// plus a treasuryReserve bucket nothing funded). Its tables are left in
// place in existing databases, unread; no code path writes them any more.
//
// All amounts are in Concord Coins (the ledger's unit), matching the
// retired module's public contract.

import { recordTransactionBatch, generateTxId } from "./ledger.js";
import { PLATFORM_ACCOUNT_ID, TREASURY_ACCOUNT_ID } from "./fees.js";

// 6-month target: approximated as 180 days of chargeback spend. In the
// absence of history, a fixed seed target ($10,000) that grows as the
// payout history builds up. (Carried over from the retired policy model.)
const SIX_MONTH_TARGET_SEED = 10_000;

// Coverage thresholds (days) for health status
const COVERAGE_HEALTHY = 90;
const COVERAGE_LOW = 30;

function accountBalance(db, accountId) {
  const credits = db.prepare(`
    SELECT COALESCE(SUM(CAST(ROUND(net * 100) AS INTEGER)), 0) as total_cents
    FROM economy_ledger WHERE to_user_id = ? AND status = 'complete'
  `).get(accountId)?.total_cents || 0;

  const debits = db.prepare(`
    SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0) as total_cents
    FROM economy_ledger WHERE from_user_id = ? AND status = 'complete'
  `).get(accountId)?.total_cents || 0;

  return (credits - debits) / 100;
}

/**
 * Current balance of the canonical pool (__TREASURY__), derived from the
 * append-only ledger.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {number} balance in Concord Coins
 */
export function getTreasuryBalance(db) {
  return accountBalance(db, TREASURY_ACCOUNT_ID);
}

/**
 * Total chargeback payouts (coins) recorded in the ledger in the last
 * `days` days. Payouts are the CHARGEBACK-type entries written by
 * payChargeback below.
 */
function chargebackSpend(db, days) {
  const cutoff = new Date(Date.now() - days * 86400 * 1000)
    .toISOString().replace("T", " ").replace("Z", "");
  const row = db.prepare(`
    SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0) AS total_cents
      FROM economy_ledger
     WHERE type = 'CHARGEBACK' AND status = 'complete'
       AND created_at >= ?
  `).get(cutoff);
  return (row ? row.total_cents : 0) / 100;
}

function computeSixMonthTarget(db) {
  try {
    return Math.max(SIX_MONTH_TARGET_SEED, chargebackSpend(db, 180));
  } catch {
    return SIX_MONTH_TARGET_SEED;
  }
}

/**
 * Debit the canonical pool to cover a dispute payout.
 *
 * The debit is a single ledger transfer __TREASURY__ → __PLATFORM__,
 * written in one transaction; the balance check and the write are the
 * same code path chargeback-handler.js has always consumed:
 * insufficient funds return an error and move nothing (the caller flags
 * the dispute for manual review).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ chargebackAmount: number, sourceTxId: string, requestId?: string, ip?: string }} opts
 *   chargebackAmount in Concord Coins.
 * @returns {{ ok: boolean, error?: string, detail?: string }}
 */
export function payChargeback(db, { chargebackAmount, sourceTxId, requestId, ip }) {
  try {
    const amount = Math.round((chargebackAmount || 0) * 100) / 100;
    if (amount <= 0) return { ok: true };

    const balance = getTreasuryBalance(db);
    if (balance < amount) {
      return {
        ok: false,
        error: "insufficient_reserve",
        detail: `Treasury has ${balance} coins; need ${amount} coins`,
      };
    }

    const doPay = db.transaction(() => {
      recordTransactionBatch(db, [{
        id: generateTxId(),
        type: "CHARGEBACK",
        from: TREASURY_ACCOUNT_ID,
        to: PLATFORM_ACCOUNT_ID,
        amount,
        fee: 0,
        net: amount,
        status: "complete",
        refId: `chargeback:${sourceTxId}`,
        metadata: { role: "chargeback_payout", sourceTxId },
        requestId,
        ip,
      }]);
    });
    doPay();

    return { ok: true };
  } catch (err) {
    console.error("[treasury] payChargeback failed:", err.message);
    return { ok: false, error: "reserve_debit_failed" };
  }
}

/**
 * Return reserve health metrics for the canonical pool.
 *
 * Status:
 *   'healthy'  — >90 days coverage
 *   'low'      — 30–90 days coverage
 *   'critical' — <30 days coverage
 *
 * The return shape is the one the retired reserves.js health function
 * served to /api/admin/reserves/health and /api/wallet/protection-status;
 * `chargebackReserve` is the canonical pool's balance.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{
 *   status: 'healthy'|'low'|'critical',
 *   chargebackReserve: number,
 *   target6Months: number,
 *   sufficiencyDays: number|null,
 *   chargebackRateLast30Days: number
 * }}
 */
export function getReserveHealth(db) {
  const pool = getTreasuryBalance(db);
  const target6Months = computeSixMonthTarget(db);

  // Average daily chargeback spend over last 30 days
  let chargebackRateLast30Days = 0;
  try {
    chargebackRateLast30Days = chargebackSpend(db, 30) / 30;
  } catch {
    chargebackRateLast30Days = 0;
  }

  // sufficiencyDays = how many days the pool covers at the current burn rate
  const sufficiencyDays = chargebackRateLast30Days > 0
    ? Math.floor(pool / chargebackRateLast30Days)
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
    chargebackReserve: pool,
    target6Months,
    sufficiencyDays: sufficiencyDays === Infinity ? null : sufficiencyDays,
    chargebackRateLast30Days: Math.round(chargebackRateLast30Days * 100) / 100,
  };
}
