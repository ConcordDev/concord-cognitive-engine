// economy/fee-split.js
// Fee Split Engine: Automatic 80/10/10 distribution of collected fees.
// All collected fees are split into:
//   - 80% Treasury (the canonical pool: war chest / chargeback backstop /
//     operational buffer — see economy/treasury.js)
//   - 10% Operating Costs (infrastructure, compute, Stripe fees)
//   - 10% Payroll (team compensation)

import { randomUUID } from "crypto";
import { recordTransactionBatch, generateTxId } from "./ledger.js";
import {
  FEE_SPLIT,
  PLATFORM_ACCOUNT_ID,
  TREASURY_ACCOUNT_ID,
  OPERATING_ACCOUNT_ID,
  PAYROLL_ACCOUNT_ID,
} from "./fees.js";

function uid(prefix = "fsd") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

// Payroll cap: $150,000/year. Excess redirected to treasury.
const ANNUAL_PAYROLL_CAP = 150_000;

/**
 * Distribute a fee payment across the 80/10/10 split.
 * Called after every fee collection event.
 *
 * @param {object} db
 * @param {object} opts
 * @param {number} opts.feeAmount — total fee collected
 * @param {string} opts.sourceTxId — the originating transaction
 * @param {string} [opts.refId]
 * @param {string} [opts.requestId]
 * @param {string} [opts.ip]
 * @returns {{ ok: boolean, distribution: object }}
 */
export function distributeFee(db, { feeAmount, sourceTxId, refId, requestId, ip }) {
  if (!feeAmount || feeAmount <= 0) return { ok: false, error: "invalid_fee_amount" };

  let treasuryAmount = Math.round(feeAmount * FEE_SPLIT.TREASURY * 100) / 100;
  const operatingAmount = Math.round(feeAmount * FEE_SPLIT.OPERATING_COSTS * 100) / 100;
  // Payroll gets the remainder to avoid rounding drift
  let payrollAmount = Math.round((feeAmount - treasuryAmount - operatingAmount) * 100) / 100;

  // Payroll cap enforcement: $150,000/year — excess redirected to treasury
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const ytdPayroll = db.prepare(`
    SELECT COALESCE(SUM(CAST(ROUND(net * 100) AS INTEGER)), 0) AS total_cents
    FROM economy_ledger
    WHERE to_user_id = ? AND type = 'FEE' AND status = 'complete'
      AND created_at >= ?
  `).get(PAYROLL_ACCOUNT_ID, yearStart)?.total_cents || 0;
  const ytdPayrollDollars = ytdPayroll / 100;

  if (ytdPayrollDollars + payrollAmount > ANNUAL_PAYROLL_CAP) {
    const remaining = Math.max(0, Math.round((ANNUAL_PAYROLL_CAP - ytdPayrollDollars) * 100) / 100);
    const overflow = Math.round((payrollAmount - remaining) * 100) / 100;
    treasuryAmount = Math.round((treasuryAmount + overflow) * 100) / 100;
    payrollAmount = remaining;
  }

  const batchId = generateTxId();

  const doDistribute = db.transaction(() => {
    const entries = [];

    // Transfer from platform to treasury (80%)
    if (treasuryAmount > 0) {
      entries.push({
        id: generateTxId(),
        type: "FEE",
        from: PLATFORM_ACCOUNT_ID,
        to: TREASURY_ACCOUNT_ID,
        amount: treasuryAmount,
        fee: 0,
        net: treasuryAmount,
        status: "complete",
        refId: refId || `fee_split:${sourceTxId}`,
        metadata: { batchId, role: "fee_split_treasury", sourceTxId, splitRate: FEE_SPLIT.TREASURY },
        requestId,
        ip,
      });
    }

    // Transfer from platform to operating (10%)
    if (operatingAmount > 0) {
      entries.push({
        id: generateTxId(),
        type: "FEE",
        from: PLATFORM_ACCOUNT_ID,
        to: OPERATING_ACCOUNT_ID,
        amount: operatingAmount,
        fee: 0,
        net: operatingAmount,
        status: "complete",
        refId: refId || `fee_split:${sourceTxId}`,
        metadata: { batchId, role: "fee_split_operating", sourceTxId, splitRate: FEE_SPLIT.OPERATING_COSTS },
        requestId,
        ip,
      });
    }

    // Transfer from platform to payroll (10%)
    if (payrollAmount > 0) {
      entries.push({
        id: generateTxId(),
        type: "FEE",
        from: PLATFORM_ACCOUNT_ID,
        to: PAYROLL_ACCOUNT_ID,
        amount: payrollAmount,
        fee: 0,
        net: payrollAmount,
        status: "complete",
        refId: refId || `fee_split:${sourceTxId}`,
        metadata: { batchId, role: "fee_split_payroll", sourceTxId, splitRate: FEE_SPLIT.PAYROLL },
        requestId,
        ip,
      });
    }

    const results = recordTransactionBatch(db, entries);

    // Record in fee_distributions table
    db.prepare(`
      INSERT INTO fee_distributions (id, source_tx_id, total_fee, reserves_amount, operating_amount, payroll_amount, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uid("fsd"), sourceTxId, feeAmount, treasuryAmount, operatingAmount, payrollAmount, nowISO());

    return results;
  });

  try {
    const results = doDistribute();
    return {
      ok: true,
      batchId,
      distribution: {
        totalFee: feeAmount,
        treasury: treasuryAmount,
        operating: operatingAmount,
        payroll: payrollAmount,
      },
      transactions: results,
    };
  } catch (err) {
    console.error("[economy] fee_distribution_failed:", err.message);
    return { ok: false, error: "fee_distribution_failed" };
  }
}

/**
 * Get the current balance of each fee split account.
 */
export function getFeeSplitBalances(db) {
  const getAccountBalance = (accountId) => {
    const credits = db.prepare(`
      SELECT COALESCE(SUM(CAST(ROUND(net * 100) AS INTEGER)), 0) as total_cents
      FROM economy_ledger WHERE to_user_id = ? AND status = 'complete'
    `).get(accountId)?.total_cents || 0;

    const debits = db.prepare(`
      SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0) as total_cents
      FROM economy_ledger WHERE from_user_id = ? AND status = 'complete'
    `).get(accountId)?.total_cents || 0;

    return (credits - debits) / 100;
  };

  return {
    treasury: getAccountBalance(TREASURY_ACCOUNT_ID),
    operating: getAccountBalance(OPERATING_ACCOUNT_ID),
    payroll: getAccountBalance(PAYROLL_ACCOUNT_ID),
    platform: getAccountBalance(PLATFORM_ACCOUNT_ID),
  };
}

/**
 * Get fee distribution history.
 */
export function getFeeDistributions(db, { limit = 50, offset = 0 } = {}) {
  const items = db.prepare(`
    SELECT * FROM fee_distributions ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);

  const total = db.prepare("SELECT COUNT(*) as c FROM fee_distributions").get()?.c || 0;

  const totalDistributed = db.prepare(`
    SELECT COALESCE(SUM(total_fee), 0) as total FROM fee_distributions
  `).get()?.total || 0;

  return {
    items,
    total,
    totalDistributed: Math.round(totalDistributed * 100) / 100,
    limit,
    offset,
  };
}
