// economy/reconciliation.js
// Reconciliation engine — scans for purchases in inconsistent states,
// re-runs idempotent settlement/fulfillment steps, and logs corrective actions.
// Never edits history; always creates counter-entries (REVERSAL, ADJUSTMENT, MAKE_GOOD).

import { findPurchasesByStatus, transitionPurchase, getPurchase } from "./purchases.js";
import { checkRefIdProcessed, generateTxId, recordTransactionBatch } from "./ledger.js";
import { economyAudit } from "./audit.js";
import logger from '../logger.js';

/**
 * Run a full reconciliation sweep. Designed to be called by cron or admin endpoint.
 *
 * Checks:
 *   1. CREATED purchases older than N minutes → mark FAILED if no payment
 *   2. PAID purchases not SETTLED → re-attempt idempotent settlement
 *   3. SETTLED purchases not FULFILLED → re-attempt fulfillment transition
 *   4. Ledger entries with no matching purchase record → flag as orphans
 *   5. Purchases with settlement_batch_id but ledger has no matching entries → flag mismatch
 *
 * @param {object} db — better-sqlite3 instance
 * @param {object} [opts]
 * @param {number} [opts.staleCreatedMinutes=30] — age threshold for stale CREATED
 * @param {number} [opts.stalePaidMinutes=15] — age threshold for stuck PAID
 * @param {number} [opts.staleSettledMinutes=15] — age threshold for stuck SETTLED
 * @param {boolean} [opts.dryRun=false] — if true, don't make changes, only report
 * @returns {{ ok: boolean, actions: object[], errors: object[], summary: object }}
 */
export function runReconciliation(db, {
  staleCreatedMinutes = 30,
  stalePaidMinutes = 15,
  staleSettledMinutes = 15,
  dryRun = false,
} = {}) {
  const actions = [];
  const errors = [];

  // 1. Stale CREATED → FAILED (abandoned carts)
  try {
    const staleCreated = findPurchasesByStatus(db, "CREATED", {
      olderThanMinutes: staleCreatedMinutes,
      limit: 200,
    });

    for (const purchase of staleCreated) {
      if (dryRun) {
        actions.push({ type: "would_expire", purchaseId: purchase.purchase_id, age: "stale_created" });
        continue;
      }

      const result = transitionPurchase(db, purchase.purchase_id, "FAILED", {
        reason: "reconciliation: stale CREATED purchase expired",
        actor: "reconciliation_engine",
        errorMessage: `Expired after ${staleCreatedMinutes} minutes in CREATED state`,
      });

      if (result.ok) {
        actions.push({ type: "expired_stale_created", purchaseId: purchase.purchase_id });
      } else {
        errors.push({ type: "expire_failed", purchaseId: purchase.purchase_id, error: result.error });
      }
    }
  } catch (err) {
    errors.push({ type: "stale_created_scan_error", error: err.message });
  }

  // 2. Stuck PAID → re-attempt settlement
  try {
    const stuckPaid = findPurchasesByStatus(db, "PAID", {
      olderThanMinutes: stalePaidMinutes,
      limit: 100,
    });

    for (const purchase of stuckPaid) {
      if (dryRun) {
        actions.push({ type: "would_retry_settlement", purchaseId: purchase.purchase_id, age: "stuck_paid" });
        continue;
      }

      const settled = attemptSettlement(db, purchase);
      if (settled.ok) {
        actions.push({ type: "retried_settlement", purchaseId: purchase.purchase_id, result: "settled" });
      } else if (settled.already) {
        actions.push({ type: "settlement_already_done", purchaseId: purchase.purchase_id });
      } else {
        errors.push({ type: "retry_settlement_failed", purchaseId: purchase.purchase_id, error: settled.error });
      }
    }
  } catch (err) {
    errors.push({ type: "stuck_paid_scan_error", error: err.message });
  }

  // 3. Stuck SETTLED → transition to FULFILLED
  try {
    const stuckSettled = findPurchasesByStatus(db, "SETTLED", {
      olderThanMinutes: staleSettledMinutes,
      limit: 100,
    });

    for (const purchase of stuckSettled) {
      if (dryRun) {
        actions.push({ type: "would_fulfill", purchaseId: purchase.purchase_id, age: "stuck_settled" });
        continue;
      }

      // Check if entitlement (license) already exists — if so, just transition
      const result = transitionPurchase(db, purchase.purchase_id, "FULFILLED", {
        reason: "reconciliation: SETTLED purchase auto-fulfilled",
        actor: "reconciliation_engine",
      });

      if (result.ok) {
        actions.push({ type: "auto_fulfilled", purchaseId: purchase.purchase_id });
      } else {
        errors.push({ type: "auto_fulfill_failed", purchaseId: purchase.purchase_id, error: result.error });
      }
    }
  } catch (err) {
    errors.push({ type: "stuck_settled_scan_error", error: err.message });
  }

  // 4. Orphan detection — ledger entries tagged as MARKETPLACE_PURCHASE with no matching purchase record
  try {
    const orphans = detectOrphanLedgerEntries(db);
    for (const orphan of orphans) {
      actions.push({ type: "orphan_ledger_entry", txId: orphan.id, refId: orphan.ref_id, amount: orphan.amount });
    }
  } catch (err) {
    errors.push({ type: "orphan_scan_error", error: err.message });
  }

  // 5. Settlement mismatch — purchases with settlement_batch_id but no ledger entries
  try {
    const mismatches = detectSettlementMismatches(db);
    for (const m of mismatches) {
      actions.push({ type: "settlement_mismatch", purchaseId: m.purchase_id, batchId: m.settlement_batch_id });
    }
  } catch (err) {
    errors.push({ type: "mismatch_scan_error", error: err.message });
  }

  // Audit the reconciliation run
  try {
    economyAudit(db, {
      action: "reconciliation_run",
      userId: "system",
      details: {
        dryRun,
        actionsCount: actions.length,
        errorsCount: errors.length,
        actions: actions.slice(0, 50), // cap logged details
      },
    });
  } catch (_e) { logger.debug('reconciliation', 'non-critical', { error: _e?.message }); }

  return {
    ok: errors.length === 0,
    actions,
    errors,
    summary: {
      totalActions: actions.length,
      totalErrors: errors.length,
      dryRun,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Attempt to settle a purchase that's stuck in PAID state.
 * Uses the ref_id to check if ledger entries already exist (idempotent).
 */
function attemptSettlement(db, purchase) {
  const refId = purchase.ref_id || `purchase:${purchase.purchase_id}`;

  // Check if settlement already happened in the ledger
  const existing = checkRefIdProcessed(db, refId);
  if (existing.exists) {
    // Ledger entries exist — just transition the state machine
    const result = transitionPurchase(db, purchase.purchase_id, "SETTLED", {
      reason: "reconciliation: ledger entries found, syncing state",
      actor: "reconciliation_engine",
    });
    return result.ok ? { ok: true, already: true } : { ok: false, error: result.error };
  }

  // No ledger entries — this is unusual for a PAID purchase.
  // Don't re-create settlement without the original context (prices, royalties).
  // Mark as needing manual review by transitioning to FAILED.
  const result = transitionPurchase(db, purchase.purchase_id, "FAILED", {
    reason: "reconciliation: PAID but no ledger entries found — needs manual review",
    actor: "reconciliation_engine",
    errorMessage: "No settlement ledger entries found for PAID purchase",
  });

  return result.ok
    ? { ok: false, error: "no_ledger_entries_flagged_for_review" }
    : { ok: false, error: result.error };
}

/**
 * Detect ledger entries for marketplace purchases that have no corresponding purchase record.
 */
function detectOrphanLedgerEntries(db) {
  try {
    return db.prepare(`
      SELECT el.id, el.ref_id, el.amount, el.type, el.created_at
      FROM economy_ledger el
      WHERE el.type = 'MARKETPLACE_PURCHASE'
        AND el.ref_id IS NOT NULL
        AND el.ref_id LIKE 'purchase:%'
        AND NOT EXISTS (
          SELECT 1 FROM purchases p WHERE p.ref_id = el.ref_id
        )
      GROUP BY el.ref_id
      ORDER BY el.created_at DESC
      LIMIT 100
    `).all();
  } catch {
    // purchases table may not exist yet
    return [];
  }
}

/**
 * Detect purchases that claim to be settled but have no matching ledger entries.
 */
function detectSettlementMismatches(db) {
  try {
    return db.prepare(`
      SELECT p.purchase_id, p.settlement_batch_id, p.status, p.amount
      FROM purchases p
      WHERE p.settlement_batch_id IS NOT NULL
        AND p.status IN ('SETTLED', 'FULFILLED')
        AND NOT EXISTS (
          SELECT 1 FROM economy_ledger el
          WHERE el.ref_id = p.ref_id AND el.status = 'complete'
        )
      LIMIT 100
    `).all();
  } catch {
    return [];
  }
}

/**
 * Execute a corrective transaction. Never edits history — creates counter-entries.
 *
 * Correction types:
 *   - REVERSAL: undo an entire settlement (swap from/to on all entries)
 *   - ADJUSTMENT: add/remove tokens to fix an incorrect amount
 *   - MAKE_GOOD: credit a user for a failed/disputed purchase
 *
 * @param {object} db
 * @param {object} opts
 * @param {'REVERSAL'|'ADJUSTMENT'|'MAKE_GOOD'} opts.correctionType
 * @param {string} opts.purchaseId — the purchase to correct
 * @param {string} opts.reason
 * @param {string} opts.actor — who initiated the correction
 * @param {number} [opts.adjustmentAmount] — for ADJUSTMENT type
 * @param {string} [opts.adjustmentUserId] — for ADJUSTMENT: who gets credited/debited
 * @returns {{ ok: boolean, entries?: object[], error?: string }}
 */
export function executeCorrection(db, {
  correctionType,
  purchaseId,
  reason,
  actor,
  adjustmentAmount,
  adjustmentUserId,
}) {
  const purchase = getPurchase(db, purchaseId);
  if (!purchase) return { ok: false, error: "purchase_not_found" };

  const correctionRefId = `correction:${correctionType.toLowerCase()}:${purchaseId}:${Date.now()}`;
  const batchId = generateTxId();

  // Check if this exact correction was already done
  const existing = checkRefIdProcessed(db, correctionRefId);
  if (existing.exists) return { ok: true, idempotent: true, entries: existing.entries };

  if (correctionType === "REVERSAL") {
    return executeReversalCorrection(db, purchase, { correctionRefId, batchId, reason, actor });
  }

  if (correctionType === "ADJUSTMENT") {
    if (!adjustmentAmount || !adjustmentUserId) {
      return { ok: false, error: "adjustment_requires_amount_and_user" };
    }
    return executeAdjustmentCorrection(db, purchase, {
      correctionRefId, batchId, reason, actor, adjustmentAmount, adjustmentUserId,
    });
  }

  if (correctionType === "MAKE_GOOD") {
    return executeMakeGoodCorrection(db, purchase, { correctionRefId, batchId, reason, actor });
  }

  return { ok: false, error: "unknown_correction_type" };
}

/**
 * Reverse an entire purchase settlement. Creates counter-entries for all original entries.
 */
function executeReversalCorrection(db, purchase, { correctionRefId, batchId, reason, actor }) {
  const refId = purchase.ref_id || `purchase:${purchase.purchase_id}`;
  const originalEntries = checkRefIdProcessed(db, refId);

  if (!originalEntries.exists || !originalEntries.entries?.length) {
    return { ok: false, error: "no_ledger_entries_to_reverse" };
  }

  // Build reversal entries — fetch full originals to get from/to
  const originals = db.prepare(
    "SELECT * FROM economy_ledger WHERE ref_id = ? AND status = 'complete'"
  ).all(refId);

  const reversalEntries = originals.map(orig => ({
    id: generateTxId(),
    type: "REVERSAL",
    from: orig.to_user_id,
    to: orig.from_user_id,
    amount: orig.net,
    fee: 0,
    net: orig.net,
    status: "complete",
    refId: correctionRefId,
    metadata: {
      batchId,
      role: "reversal",
      originalTxId: orig.id,
      originalType: orig.type,
      purchaseId: purchase.purchase_id,
      reason,
      correctionType: "REVERSAL",
    },
  }));

  const doReversal = db.transaction(() => {
    const dupe = checkRefIdProcessed(db, correctionRefId);
    if (dupe.exists) return { idempotent: true, entries: dupe.entries };

    const results = recordTransactionBatch(db, reversalEntries);

    // Mark originals as reversed — single batched UPDATE (was N+1).
    const origIds = originals.map(o => o.id);
    if (origIds.length > 0) {
      const placeholders = origIds.map(() => "?").join(",");
      db.prepare(
        `UPDATE economy_ledger SET status = 'reversed' WHERE id IN (${placeholders})`,
      ).run(...origIds);
    }

    return results;
  });

  try {
    const results = doReversal();
    if (results.idempotent) return { ok: true, idempotent: true, entries: results.entries };

    // Transition purchase to REFUNDED
    transitionPurchase(db, purchase.purchase_id, "REFUNDED", {
      reason: `REVERSAL: ${reason}`,
      actor,
      metadata: { correctionRefId, batchId },
    });

    economyAudit(db, {
      action: "correction_reversal",
      userId: actor,
      amount: purchase.amount,
      txId: batchId,
      details: { purchaseId: purchase.purchase_id, reason, entriesReversed: originals.length },
    });

    return { ok: true, batchId, entries: results, correctionType: "REVERSAL" };
  } catch (err) {
    if (err.message?.includes("UNIQUE constraint")) {
      return { ok: true, idempotent: true };
    }
    console.error("[economy] reversal_failed:", err.message);
    return { ok: false, error: "reversal_failed" };
  }
}

/**
 * Create an adjustment entry to fix an incorrect amount on a purchase.
 */
function executeAdjustmentCorrection(db, purchase, { correctionRefId, batchId, reason, actor, adjustmentAmount, adjustmentUserId }) {
  const isCredit = adjustmentAmount > 0;
  const absAmount = Math.abs(adjustmentAmount);

  const entry = {
    id: generateTxId(),
    type: "ADJUSTMENT",
    from: isCredit ? null : adjustmentUserId,
    to: isCredit ? adjustmentUserId : null,
    amount: absAmount,
    fee: 0,
    net: absAmount,
    status: "complete",
    refId: correctionRefId,
    metadata: {
      batchId,
      role: "adjustment",
      purchaseId: purchase.purchase_id,
      reason,
      correctionType: "ADJUSTMENT",
      direction: isCredit ? "credit" : "debit",
    },
  };

  const doAdjustment = db.transaction(() => {
    const dupe = checkRefIdProcessed(db, correctionRefId);
    if (dupe.exists) return { idempotent: true, entries: dupe.entries };
    return recordTransactionBatch(db, [entry]);
  });

  try {
    const results = doAdjustment();
    if (results.idempotent) return { ok: true, idempotent: true, entries: results.entries };

    economyAudit(db, {
      action: "correction_adjustment",
      userId: actor,
      amount: adjustmentAmount,
      txId: batchId,
      details: { purchaseId: purchase.purchase_id, adjustmentUserId, reason },
    });

    return { ok: true, batchId, entries: results, correctionType: "ADJUSTMENT" };
  } catch (err) {
    if (err.message?.includes("UNIQUE constraint")) {
      return { ok: true, idempotent: true };
    }
    console.error("[economy] adjustment_failed:", err.message);
    return { ok: false, error: "adjustment_failed" };
  }
}

/**
 * Credit the buyer for a failed/disputed purchase (make-good).
 * Credits the original purchase amount back to the buyer.
 */
function executeMakeGoodCorrection(db, purchase, { correctionRefId, batchId, reason, actor }) {
  const entry = {
    id: generateTxId(),
    type: "MAKE_GOOD",
    from: null,
    to: purchase.buyer_id,
    amount: purchase.amount,
    fee: 0,
    net: purchase.amount,
    status: "complete",
    refId: correctionRefId,
    metadata: {
      batchId,
      role: "make_good",
      purchaseId: purchase.purchase_id,
      reason,
      correctionType: "MAKE_GOOD",
    },
  };

  const doMakeGood = db.transaction(() => {
    const dupe = checkRefIdProcessed(db, correctionRefId);
    if (dupe.exists) return { idempotent: true, entries: dupe.entries };
    return recordTransactionBatch(db, [entry]);
  });

  try {
    const results = doMakeGood();
    if (results.idempotent) return { ok: true, idempotent: true, entries: results.entries };

    // Transition purchase to REFUNDED if currently in a disputable state
    const disputableStates = ["FULFILLED", "DISPUTED", "CHARGEBACK"];
    if (disputableStates.includes(purchase.status)) {
      transitionPurchase(db, purchase.purchase_id, "REFUNDED", {
        reason: `MAKE_GOOD: ${reason}`,
        actor,
        metadata: { correctionRefId, batchId },
      });
    }

    economyAudit(db, {
      action: "correction_make_good",
      userId: actor,
      amount: purchase.amount,
      txId: batchId,
      details: { purchaseId: purchase.purchase_id, buyerId: purchase.buyer_id, reason },
    });

    return { ok: true, batchId, entries: results, correctionType: "MAKE_GOOD" };
  } catch (err) {
    if (err.message?.includes("UNIQUE constraint")) {
      return { ok: true, idempotent: true };
    }
    console.error("[economy] make_good_failed:", err.message);
    return { ok: false, error: "make_good_failed" };
  }
}

/**
 * Get a full receipt/breakdown for a purchase.
 * Combines purchase record, ledger entries, and status history.
 */
export function getPurchaseReceipt(db, purchaseId) {
  const purchase = getPurchase(db, purchaseId);
  if (!purchase) return { ok: false, error: "purchase_not_found" };

  const refId = purchase.ref_id || `purchase:${purchaseId}`;

  // Get all ledger entries for this purchase
  let ledgerEntries = [];
  try {
    ledgerEntries = db.prepare(
      "SELECT * FROM economy_ledger WHERE ref_id = ? ORDER BY created_at ASC"
    ).all(refId);
  } catch (_e) { logger.debug('reconciliation', 'ref_id column may not exist', { error: _e?.message }); }

  // Get correction entries
  let corrections = [];
  try {
    corrections = db.prepare(
      "SELECT * FROM economy_ledger WHERE ref_id LIKE ? ORDER BY created_at ASC"
    ).all(`correction:%:${purchaseId}:%`);
  } catch (_e) { logger.debug('reconciliation', 'ignore', { error: _e?.message }); }

  // Get status history
  let history = [];
  try {
    history = db.prepare(
      "SELECT * FROM purchase_status_history WHERE purchase_id = ? ORDER BY created_at ASC"
    ).all(purchaseId);
  } catch (_e) { logger.debug('reconciliation', 'table may not exist', { error: _e?.message }); }

  // Build breakdown
  const breakdown = {
    grossAmount: purchase.amount,
    marketplaceFee: purchase.marketplace_fee || 0,
    totalRoyalties: purchase.total_royalties || 0,
    sellerNet: purchase.seller_net || 0,
    royaltyDetails: purchase.royaltyDetails || [],
  };

  return {
    ok: true,
    purchase: {
      purchaseId: purchase.purchase_id,
      status: purchase.status,
      buyerId: purchase.buyer_id,
      sellerId: purchase.seller_id,
      listingId: purchase.listing_id,
      listingType: purchase.listing_type,
      licenseType: purchase.license_type,
      amount: purchase.amount,
      licenseId: purchase.license_id,
      createdAt: purchase.created_at,
      updatedAt: purchase.updated_at,
    },
    breakdown,
    ledgerEntries: ledgerEntries.map(e => ({
      id: e.id,
      type: e.type,
      from: e.from_user_id,
      to: e.to_user_id,
      amount: e.amount,
      fee: e.fee,
      net: e.net,
      status: e.status,
      createdAt: e.created_at,
    })),
    corrections: corrections.map(e => ({
      id: e.id,
      type: e.type,
      from: e.from_user_id,
      to: e.to_user_id,
      amount: e.amount,
      status: e.status,
      createdAt: e.created_at,
    })),
    history: history.map(h => ({
      fromStatus: h.from_status,
      toStatus: h.to_status,
      reason: h.reason,
      actor: h.actor,
      createdAt: h.created_at,
    })),
  };
}

/**
 * Get a summary of purchases in each state (for admin dashboard).
 */
export function getReconciliationSummary(db) {
  try {
    const stateCounts = db.prepare(`
      SELECT status, COUNT(*) as count, COALESCE(SUM(amount), 0) as total_amount
      FROM purchases
      GROUP BY status
      ORDER BY status
    `).all();

    const recentFailures = db.prepare(`
      SELECT purchase_id, buyer_id, seller_id, amount, error_message, retry_count, updated_at
      FROM purchases
      WHERE status = 'FAILED'
      ORDER BY updated_at DESC
      LIMIT 20
    `).all();

    const stuckPurchases = db.prepare(`
      SELECT purchase_id, status, amount, updated_at
      FROM purchases
      WHERE status IN ('CREATED', 'PAYMENT_PENDING', 'PAID', 'SETTLED')
        AND updated_at < datetime('now', '-15 minutes')
      ORDER BY updated_at ASC
      LIMIT 50
    `).all();

    return {
      ok: true,
      stateCounts: stateCounts.reduce((acc, r) => {
        acc[r.status] = { count: r.count, totalAmount: Math.round(r.total_amount * 100) / 100 };
        return acc;
      }, {}),
      recentFailures,
      stuckPurchases,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[economy] summary_failed:", err.message);
    return { ok: false, error: "summary_failed" };
  }
}
