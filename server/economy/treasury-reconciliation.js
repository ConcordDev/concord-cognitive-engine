// economy/treasury-reconciliation.js
// Nightly reconciliation job: compares ledger totals against Stripe dashboard balance.
// Any drift of even $0.01 triggers an immediate alert.
// This job is MANDATORY before marketplace launch.

import { randomUUID } from "crypto";
import { getTreasuryState, verifyTreasuryInvariant } from "./coin-service.js";
import { economyAudit } from "./audit.js";
import { PLATFORM_ACCOUNT_ID } from "./fees.js";
import { CREDIT_ROW_PREDICATE } from "./balances.js";
import logger from '../logger.js';

function uid(prefix = "rec") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

// Alert threshold: any drift of $0.01 or more triggers alert
const DRIFT_THRESHOLD = 0.01;

/**
 * Run nightly treasury reconciliation.
 * Sums all purchases minus all withdrawals in the ledger and compares
 * against the Stripe dashboard balance (if available).
 *
 * @param {object} db — better-sqlite3 instance
 * @param {object} [opts]
 * @param {number} [opts.stripeBalance] — current Stripe balance in USD (from API)
 * @param {boolean} [opts.alertCallback] — function to call on drift alert
 * @returns {{ ok: boolean, reconciliation: object }}
 */
export function runTreasuryReconciliation(db, { stripeBalance, alertCallback } = {}) {
  const now = nowISO();

  // 1. Calculate expected balance from ledger
  const ledgerTotals = calculateLedgerTotals(db);

  // 2. Get treasury state
  const treasuryState = getTreasuryState(db);
  const treasuryUsd = treasuryState?.total_usd || 0;
  const treasuryCoins = treasuryState?.total_coins || 0;

  // 3. Verify treasury invariant
  const invariant = verifyTreasuryInvariant(db);

  // 4. Calculate drift
  let stripeDrift = null;
  let stripeDriftAlert = false;

  if (stripeBalance != null) {
    stripeDrift = Math.round((stripeBalance - ledgerTotals.expectedTreasury) * 100) / 100;
    stripeDriftAlert = Math.abs(stripeDrift) >= DRIFT_THRESHOLD;
  }

  const treasuryDrift = Math.round((treasuryUsd - ledgerTotals.expectedTreasury) * 100) / 100;
  const treasuryDriftAlert = Math.abs(treasuryDrift) >= DRIFT_THRESHOLD;

  const coinDrift = Math.round((treasuryCoins - ledgerTotals.circulatingCoins) * 100) / 100;
  const coinDriftAlert = Math.abs(coinDrift) >= DRIFT_THRESHOLD;

  const anyAlert = stripeDriftAlert || treasuryDriftAlert || coinDriftAlert || !invariant.invariantHolds;

  // 5. Record reconciliation
  const reconciliationId = uid("rec");
  const details = {
    ledger: ledgerTotals,
    treasury: { usd: treasuryUsd, coins: treasuryCoins },
    stripe: stripeBalance != null ? { balance: stripeBalance, drift: stripeDrift } : null,
    drifts: { treasury: treasuryDrift, coins: coinDrift, stripe: stripeDrift },
    invariant: invariant.invariantHolds,
    alerts: { stripe: stripeDriftAlert, treasury: treasuryDriftAlert, coins: coinDriftAlert },
  };

  try {
    db.prepare(`
      INSERT INTO treasury_reconciliation_log
        (id, ledger_total, stripe_total, drift, alert_triggered, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      reconciliationId,
      ledgerTotals.expectedTreasury,
      stripeBalance ?? null,
      stripeDrift ?? treasuryDrift,
      anyAlert ? 1 : 0,
      JSON.stringify(details),
      now,
    );

    // Update treasury drift tracking
    if (treasuryState) {
      db.prepare(`
        UPDATE treasury SET drift_amount = ?, drift_alert = ?, last_reconciled = ?, updated_at = ?
        WHERE id = 'treasury_main'
      `).run(treasuryDrift, anyAlert ? 1 : 0, now, now);
    }

    // Record treasury event if drift detected
    if (anyAlert) {
      db.prepare(`
        INSERT INTO treasury_events (id, event_type, amount, usd_before, usd_after, coins_before, coins_after, ref_id, metadata_json, created_at)
        VALUES (?, 'DRIFT_ALERT', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uid("tev"),
        Math.abs(stripeDrift ?? treasuryDrift),
        treasuryUsd, treasuryUsd,
        treasuryCoins, treasuryCoins,
        reconciliationId,
        JSON.stringify({ alerts: details.alerts, drifts: details.drifts }),
        now,
      );
    }
  } catch (err) {
    console.error("[Treasury Reconciliation] Failed to record:", err.message);
  }

  // 6. Trigger alert if needed
  if (anyAlert) {
    const alertMessage = buildAlertMessage(details);
    console.error(`[TREASURY ALERT] ${alertMessage}`);

    if (alertCallback) {
      try { alertCallback(alertMessage, details); } catch (_e) { logger.debug('treasury-reconciliation', 'non-critical', { error: _e?.message }); }
    }

    economyAudit(db, {
      action: "treasury_reconciliation_alert",
      userId: "system",
      details: { reconciliationId, alerts: details.alerts, drifts: details.drifts },
    });
  }

  economyAudit(db, {
    action: "treasury_reconciliation_complete",
    userId: "system",
    details: { reconciliationId, anyAlert, ...ledgerTotals },
  });

  return {
    ok: true,
    reconciliationId,
    alert: anyAlert,
    reconciliation: {
      ledger: ledgerTotals,
      treasury: { usd: treasuryUsd, coins: treasuryCoins },
      stripeBalance: stripeBalance ?? "not_provided",
      drifts: {
        treasury: treasuryDrift,
        coins: coinDrift,
        stripe: stripeDrift,
      },
      invariantHolds: invariant.invariantHolds,
      alerts: {
        stripe: stripeDriftAlert,
        treasury: treasuryDriftAlert,
        coins: coinDriftAlert,
        invariant: !invariant.invariantHolds,
      },
      timestamp: now,
    },
  };
}

/**
 * Calculate expected treasury balance from ledger entries.
 */
function calculateLedgerTotals(db) {
  // Total minted (coins entering the system)
  const totalMinted = db.prepare(`
    SELECT COALESCE(SUM(net), 0) as total FROM economy_ledger
    WHERE type = 'TOKEN_PURCHASE' AND status = 'complete'
  `).get()?.total || 0;

  // Total withdrawn (coins leaving the system)
  const totalWithdrawn = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM economy_ledger
    WHERE type = 'WITHDRAWAL' AND status = 'complete'
  `).get()?.total || 0;

  // Platform fees collected
  const totalFees = db.prepare(`
    SELECT COALESCE(SUM(net), 0) as total FROM economy_ledger
    WHERE type = 'FEE' AND to_user_id = ? AND status = 'complete'
  `).get(PLATFORM_ACCOUNT_ID)?.total || 0;

  // Circulating coins (all non-platform, non-withdrawn balance)
  const totalCredits = db.prepare(`
    SELECT COALESCE(SUM(CAST(ROUND(net * 100) AS INTEGER)), 0) as total_cents
    FROM economy_ledger WHERE to_user_id IS NOT NULL AND status = 'complete' AND ${CREDIT_ROW_PREDICATE}
  `).get()?.total_cents || 0;

  const totalDebits = db.prepare(`
    SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0) as total_cents
    FROM economy_ledger WHERE from_user_id IS NOT NULL AND status = 'complete'
  `).get()?.total_cents || 0;

  const circulatingCoins = (totalCredits - totalDebits) / 100;

  // Pending withdrawals
  const pendingWithdrawals = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM economy_withdrawals
    WHERE status IN ('pending', 'approved', 'processing')
  `).get()?.total || 0;

  // Expected treasury: minted - withdrawn
  const expectedTreasury = Math.round((totalMinted - totalWithdrawn) * 100) / 100;

  // Transaction count
  const txCount = db.prepare("SELECT COUNT(*) as c FROM economy_ledger WHERE status = 'complete'").get()?.c || 0;

  return {
    totalMinted: Math.round(totalMinted * 100) / 100,
    totalWithdrawn: Math.round(totalWithdrawn * 100) / 100,
    totalFees: Math.round(totalFees * 100) / 100,
    circulatingCoins: Math.round(circulatingCoins * 100) / 100,
    pendingWithdrawals: Math.round(pendingWithdrawals * 100) / 100,
    expectedTreasury,
    transactionCount: txCount,
  };
}

/**
 * Build a human-readable alert message.
 */
function buildAlertMessage(details) {
  const parts = [];
  if (details.alerts.stripe) {
    parts.push(`Stripe drift: $${details.drifts.stripe}`);
  }
  if (details.alerts.treasury) {
    parts.push(`Treasury drift: $${details.drifts.treasury}`);
  }
  if (details.alerts.coins) {
    parts.push(`Coin supply drift: ${details.drifts.coins}`);
  }
  if (!details.invariant) {
    parts.push("TREASURY INVARIANT VIOLATED — coins exceed USD");
  }
  return parts.join(" | ");
}

/**
 * Get reconciliation history.
 */
export function getReconciliationHistory(db, { limit = 30, offset = 0 } = {}) {
  const items = db.prepare(`
    SELECT * FROM treasury_reconciliation_log ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);

  const total = db.prepare(
    "SELECT COUNT(*) as c FROM treasury_reconciliation_log"
  ).get()?.c || 0;

  const alertCount = db.prepare(
    "SELECT COUNT(*) as c FROM treasury_reconciliation_log WHERE alert_triggered = 1"
  ).get()?.c || 0;

  return {
    items: items.map(i => ({
      ...i,
      details: safeJsonParse(i.details_json),
    })),
    total,
    alertCount,
    limit,
    offset,
  };
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch (err) { console.debug('[treasury-reconciliation] JSON parse failed', err?.message); return {}; }
}

export { DRIFT_THRESHOLD };
