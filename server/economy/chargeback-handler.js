// economy/chargeback-handler.js
// Handles Stripe charge.dispute.created events (chargebacks).
//
// Policy: platform reserves cover chargebacks; cascade recipients keep their
// distributions. The reserve is the canonical __TREASURY__ pool, funded by
// the 80/10/10 fee split (see fee-split.js) and debited via treasury.js.

import { economyAudit } from "./audit.js";
import { payChargeback } from "./treasury.js";

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Flag a chargeback for manual review by writing an audit entry.
 * Called when the reserve is insufficient to automatically cover the dispute.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ chargebackAmountCents: number, stripeDisputeId: string, paymentIntentId: string, requestId?: string, ip?: string }} opts
 */
export function flagChargebackForManualReview(db, {
  chargebackAmountCents,
  stripeDisputeId,
  paymentIntentId,
  requestId,
  ip,
}) {
  economyAudit(db, {
    action: "chargeback_manual_review_required",
    details: {
      chargebackAmountCents,
      stripeDisputeId,
      paymentIntentId,
      flaggedAt: nowISO(),
      reason: "insufficient_chargeback_reserve",
    },
    requestId,
    ip,
  });
}

/**
 * Handle a Stripe chargeback dispute.
 *
 * Steps:
 *   1. Look up the purchase by payment_intent_id.
 *   2. Attempt to pay the chargeback from the reserve.
 *   3. If reserve is insufficient, flag for manual review.
 *   4. If reserve sufficient, mark purchase as charged_back.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{
 *   chargebackAmountCents: number,
 *   stripeDisputeId: string,
 *   paymentIntentId: string,
 *   requestId?: string,
 *   ip?: string
 * }} opts
 * @returns {{ ok: boolean, action: 'no_purchase_found'|'covered_by_reserve'|'flagged_for_manual_review' }}
 */
export async function handleChargeback(db, {
  chargebackAmountCents,
  stripeDisputeId,
  paymentIntentId,
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

  // 2. Attempt to pay from reserve
  // chargebackAmountCents is already in cents (Stripe amounts are cents).
  // payChargeback expects the amount in Concord Coins (dollars), so divide by 100.
  const reserveResult = payChargeback(db, {
    chargebackAmount: chargebackAmountCents / 100,
    sourceTxId: stripeDisputeId,
    requestId,
    ip,
  });

  if (!reserveResult.ok) {
    // 3. Insufficient reserve — flag for manual review
    flagChargebackForManualReview(db, {
      chargebackAmountCents,
      stripeDisputeId,
      paymentIntentId,
      requestId,
      ip,
    });
    return { ok: true, action: "flagged_for_manual_review" };
  }

  // 4. Reserve covered — mark purchase as charged_back
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
      resolvedAt: nowISO(),
    },
    requestId,
    ip,
  });

  return { ok: true, action: "covered_by_reserve" };
}
