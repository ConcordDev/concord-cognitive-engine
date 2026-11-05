// economy/chargeback-handler.js
// Handles Stripe charge.dispute.created events (chargebacks).
//
// Policy (founder synthesis, Gate 5 Act 3): the INITIATOR pays first — a
// levy of 25% of the original transaction is collected from the buyer,
// bounded by their live balance — and the reserve pool is only the
// BACKSTOP for the uncollected remainder. Never both for the same
// dollars: the pool pays (dispute − collected), never the levied part.
// Issuer-fault disputes are carved out: no levy and no pool draw; the
// dispute goes to manual review instead.
// The reserve is the canonical __TREASURY__ pool, funded by the 80/10/10
// fee split (see fee-split.js) and debited via treasury.js.

import { economyAudit } from "./audit.js";
import { payChargeback } from "./treasury.js";
import { TREASURY_ACCOUNT_ID } from "./fees.js";
import { getBalance } from "./balances.js";
import { recordTransactionBatch, generateTxId, checkRefIdProcessed } from "./ledger.js";

/** Levy rate on the original transaction (founder policy of record). */
export const CHARGEBACK_LEVY_RATE = 0.25;

/**
 * Stripe dispute reasons treated as ISSUER FAULT (the carve-out).
 * Single named constant on purpose: the set is a policy input confirmed
 * by Lane 7 (Gate 5 build confirmation); changing it is this one line.
 */
export const ISSUER_FAULT_DISPUTE_REASONS = new Set([
  "duplicate",
  "processing_error",
  "product_not_received",
  "product_unacceptable",
  "credit_not_processed",
]);

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Flag a chargeback for manual review by writing an audit entry.
 * Called when the reserve is insufficient to automatically cover the
 * dispute remainder, and for issuer-fault carve-out disputes (no levy,
 * no pool draw — a human decides).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ chargebackAmountCents: number, stripeDisputeId: string, paymentIntentId: string, requestId?: string, ip?: string, reason?: string }} opts
 */
export function flagChargebackForManualReview(db, {
  chargebackAmountCents,
  stripeDisputeId,
  paymentIntentId,
  requestId,
  ip,
  reason = "insufficient_chargeback_reserve",
}) {
  economyAudit(db, {
    action: "chargeback_manual_review_required",
    details: {
      chargebackAmountCents,
      stripeDisputeId,
      paymentIntentId,
      flaggedAt: nowISO(),
      reason,
    },
    requestId,
    ip,
  });
}

/**
 * Collect the initiator levy for a dispute: 25% of the ORIGINAL
 * transaction (purchase.amount), bounded by the buyer's live balance
 * and by the dispute amount itself, credited to the treasury pool.
 * The write is a system-minted ledger entry (never executeTransfer),
 * refId-keyed so a redelivered webhook cannot collect twice — a retry
 * reads back the amount already collected.
 *
 * @returns {number} the levy actually collected, in coins (≥ 0)
 */
function collectInitiatorLevy(db, { purchase, disputeCents, stripeDisputeId, requestId, ip }) {
  const buyerId = purchase.buyer_id;
  if (!buyerId) return 0;

  const levyRefId = `chargeback-levy:${stripeDisputeId}`;
  const prior = checkRefIdProcessed(db, levyRefId);
  if (prior.exists) {
    const row = prior.entries.find((e) => e.type === "CHARGEBACK_LEVY");
    return row ? Math.round(row.amount * 100) / 100 : 0;
  }

  const levyDueCents = Math.round(Number(purchase.amount || 0) * 100 * CHARGEBACK_LEVY_RATE);
  if (levyDueCents <= 0) return 0;

  let balanceCents = 0;
  try {
    balanceCents = Math.round((getBalance(db, buyerId)?.balance || 0) * 100);
  } catch {
    balanceCents = 0; // ledger unreadable → collect nothing; pool backstops
  }

  const collectedCents = Math.max(
    0,
    Math.min(levyDueCents, balanceCents, disputeCents),
  );
  if (collectedCents <= 0) return 0;
  const collected = collectedCents / 100;

  const doCollect = db.transaction(() => {
    recordTransactionBatch(db, [{
      id: generateTxId(),
      type: "CHARGEBACK_LEVY",
      from: buyerId,
      to: TREASURY_ACCOUNT_ID,
      amount: collected,
      fee: 0,
      net: collected,
      status: "complete",
      refId: levyRefId,
      metadata: { role: "chargeback_initiator_levy", stripeDisputeId, purchaseId: purchase.id },
      requestId,
      ip,
    }]);
  });
  doCollect();

  economyAudit(db, {
    action: "chargeback_levy_collected",
    userId: buyerId,
    details: {
      purchaseId: purchase.id,
      stripeDisputeId,
      levyRate: CHARGEBACK_LEVY_RATE,
      levyDue: levyDueCents / 100,
      levyCollected: collected,
      collectedAt: nowISO(),
    },
    requestId,
    ip,
  });

  return collected;
}

/**
 * Handle a Stripe chargeback dispute.
 *
 * Steps:
 *   1. Look up the purchase by payment_intent_id.
 *   2. Issuer-fault carve-out: flag for manual review (no levy, no pool).
 *   3. Collect the initiator levy (25% of the original transaction,
 *      bounded by the buyer's live balance) into the pool.
 *   4. The pool backstops only the remainder (dispute − levy); if it
 *      cannot, flag for manual review (the collected levy stands).
 *   5. Covered — mark purchase as charged_back.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{
 *   chargebackAmountCents: number,
 *   stripeDisputeId: string,
 *   paymentIntentId: string,
 *   disputeReason?: string,
 *   requestId?: string,
 *   ip?: string
 * }} opts
 * @returns {{ ok: boolean, action: 'no_purchase_found'|'covered_by_reserve'|'covered_by_levy'|'flagged_for_manual_review', levyCollected?: number, reservePaid?: number }}
 */
export async function handleChargeback(db, {
  chargebackAmountCents,
  stripeDisputeId,
  paymentIntentId,
  disputeReason,
  requestId,
  ip,
}) {
  // 1. Look up purchase by payment_intent_id
  //    First try stripe_payment_intent_id column (if it exists), then fall back
  //    to a LIKE search in metadata_json.
  let purchase = null;
  try {
    purchase = db.prepare(
      "SELECT * FROM purchases WHERE stripe_payment_intent_id = ? LIMIT 1"
    ).get(paymentIntentId);
  } catch {
    // Column doesn't exist — fall through to metadata_json search
  }

  if (!purchase && paymentIntentId) {
    try {
      purchase = db.prepare(
        "SELECT * FROM purchases WHERE metadata_json LIKE ? LIMIT 1"
      ).get(`%${paymentIntentId}%`);
    } catch {
      // purchases table may not exist yet in test environments; continue
    }
  }

  if (!purchase) {
    economyAudit(db, {
      action: "chargeback_no_purchase_found",
      details: {
        stripeDisputeId,
        paymentIntentId,
        chargebackAmountCents,
        resolvedAt: nowISO(),
      },
      requestId,
      ip,
    });
    return { ok: true, action: "no_purchase_found" };
  }

  // 2. Issuer-fault carve-out — no levy, no pool draw; a human decides.
  if (disputeReason && ISSUER_FAULT_DISPUTE_REASONS.has(disputeReason)) {
    flagChargebackForManualReview(db, {
      chargebackAmountCents,
      stripeDisputeId,
      paymentIntentId,
      requestId,
      ip,
      reason: "issuer_fault_carve_out",
    });
    return { ok: true, action: "flagged_for_manual_review", levyCollected: 0, reservePaid: 0 };
  }

  // 3. Initiator levy first (25% of the original transaction).
  const levyCollected = collectInitiatorLevy(db, {
    purchase,
    disputeCents: chargebackAmountCents,
    stripeDisputeId,
    requestId,
    ip,
  });

  // 4. Pool backstops only the remainder — never the levied dollars.
  // chargebackAmountCents is in cents; payChargeback expects coins.
  const disputeCoins = chargebackAmountCents / 100;
  const remainder = Math.round((disputeCoins - levyCollected) * 100) / 100;
  let reservePaid = 0;

  if (remainder > 0) {
    const reserveResult = payChargeback(db, {
      chargebackAmount: remainder,
      sourceTxId: stripeDisputeId,
      requestId,
      ip,
    });

    if (!reserveResult.ok) {
      // Insufficient reserve for the remainder — flag for manual review.
      // The collected levy stands (it was collectible); the shortfall is
      // the human's problem to resolve, as before this act.
      flagChargebackForManualReview(db, {
        chargebackAmountCents,
        stripeDisputeId,
        paymentIntentId,
        requestId,
        ip,
      });
      return { ok: true, action: "flagged_for_manual_review", levyCollected, reservePaid: 0 };
    }
    reservePaid = remainder;
  }

  // 5. Covered — mark purchase as charged_back
  try {
    db.prepare(
      "UPDATE purchases SET status = 'charged_back', updated_at = ? WHERE id = ?"
    ).run(nowISO(), purchase.id);
  } catch (err) {
    console.error("[chargeback] Failed to update purchase status:", err.message);
  }

  economyAudit(db, {
    action: "chargeback_covered_by_reserve",
    userId: purchase.buyer_id || undefined,
    details: {
      purchaseId: purchase.id,
      stripeDisputeId,
      paymentIntentId,
      chargebackAmountCents,
      levyCollected,
      reservePaid,
      resolvedAt: nowISO(),
    },
    requestId,
    ip,
  });

  return {
    ok: true,
    action: reservePaid > 0 ? "covered_by_reserve" : "covered_by_levy",
    levyCollected,
    reservePaid,
  };
}
