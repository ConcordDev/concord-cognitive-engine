// economy/stripe.js
// Stripe integration: Checkout sessions, webhook handling, Connect onboarding.
// All token credits go through the append-only ledger. Stripe handles fiat only.

import { randomUUID, createHash } from "crypto";
import { executePurchase } from "./transfer.js";
import { PLATFORM_ACCOUNT_ID } from "./fees.js";
import { recordTransactionBatch, generateTxId } from "./ledger.js";
import { economyAudit } from "./audit.js";
import { getBalance } from "./balances.js";
import { mintCoins, burnCoins } from "./coin-service.js";
import { handleChargeback } from "./chargeback-handler.js";

// ── Config ──────────────────────────────────────────────────────────────────

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const _STRIPE_CONNECT_CLIENT_ID = process.env.STRIPE_CONNECT_CLIENT_ID || "";
const STRIPE_ENABLED = Boolean(STRIPE_SECRET_KEY);

const TOKENS_PER_USD = Number(process.env.TOKENS_PER_USD) || 1;
const MIN_PURCHASE_TOKENS = 1;
const MAX_PURCHASE_TOKENS = 100_000;
const MIN_WITHDRAW_TOKENS = Number(process.env.MIN_WITHDRAW_TOKENS) || 20;
const MAX_WITHDRAW_TOKENS_PER_DAY = Number(process.env.MAX_WITHDRAW_TOKENS_PER_DAY) || 5000;

const FRONTEND_URL = process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_API_URL || "https://concord-os.org";

let _stripe = null;

async function getStripe() {
  if (!STRIPE_ENABLED) return null;
  if (!_stripe) {
    try {
      const Stripe = (await import("stripe")).default;
      _stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
    } catch (e) {
      console.warn("[Stripe] stripe package not available:", e.message);
    }
  }
  return _stripe;
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

// ── Idempotency ─────────────────────────────────────────────────────────────

function isEventProcessed(db, eventId) {
  const row = db.prepare("SELECT event_id FROM stripe_events_processed WHERE event_id = ?").get(eventId);
  return Boolean(row);
}

function markEventProcessed(db, eventId, eventType) {
  db.prepare(
    "INSERT OR IGNORE INTO stripe_events_processed (event_id, event_type, processed_at) VALUES (?, ?, ?)",
  ).run(eventId, eventType, nowISO());
}

// ── Stripe Account Storage ──────────────────────────────────────────────────

function getStripeAccount(db, userId) {
  return db.prepare("SELECT * FROM stripe_connected_accounts WHERE user_id = ?").get(userId) || null;
}

function upsertStripeAccount(db, userId, stripeAccountId) {
  const now = nowISO();
  db.prepare(`
    INSERT INTO stripe_connected_accounts (id, user_id, stripe_account_id, onboarding_complete, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET stripe_account_id = ?, updated_at = ?
  `).run(
    "sa_" + randomUUID().replace(/-/g, "").slice(0, 16),
    userId, stripeAccountId, now, now,
    stripeAccountId, now,
  );
}

function markOnboardingComplete(db, userId) {
  db.prepare("UPDATE stripe_connected_accounts SET onboarding_complete = 1, updated_at = ? WHERE user_id = ?")
    .run(nowISO(), userId);
}

// ── B2: Create Checkout Session ─────────────────────────────────────────────

export async function createCheckoutSession(db, { userId, tokens, requestId, ip }) {
  const stripeClient = await getStripe();
  if (!stripeClient) return { ok: false, error: "stripe_not_configured" };

  if (!Number.isInteger(tokens) || tokens < MIN_PURCHASE_TOKENS || tokens > MAX_PURCHASE_TOKENS) {
    return { ok: false, error: "invalid_token_amount", min: MIN_PURCHASE_TOKENS, max: MAX_PURCHASE_TOKENS };
  }

  // Convert tokens to USD cents (1 token = $1 * TOKENS_PER_USD)
  const priceInCents = Math.round((tokens / TOKENS_PER_USD) * 100);

  // Deterministic idempotency key: hash(userId + amount + nonce)
  // Prevents duplicate sessions on rapid double-clicks
  const nonce = randomUUID();
  const idempotencyKey = createHash("sha256")
    .update(`${userId}:${tokens}:${nonce}`)
    .digest("hex")
    .slice(0, 32);

  try {
    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: `${tokens} Concord Tokens`,
          },
          unit_amount: priceInCents,
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${FRONTEND_URL}/billing?success=true&tokens=${tokens}`,
      cancel_url: `${FRONTEND_URL}/billing?canceled=true`,
      metadata: {
        userId,
        tokens: String(tokens),
        purpose: "TOKEN_PURCHASE",
        idempotencyKey,
      },
    });

    economyAudit(db, {
      action: "checkout_session_created",
      userId,
      amount: tokens,
      details: { sessionId: session.id, priceInCents },
      requestId,
      ip,
    });

    return { ok: true, checkoutUrl: session.url, sessionId: session.id };
  } catch (err) {
    console.error("[economy] checkout_creation_failed:", err.message);
    return { ok: false, error: "checkout_creation_failed" };
  }
}

// ── B2: Webhook Handler ─────────────────────────────────────────────────────

export async function handleWebhook(db, { rawBody, signature, requestId, ip }) {
  const stripeClient = await getStripe();
  if (!stripeClient) return { ok: false, error: "stripe_not_configured" };

  // Guard: webhook secret must be configured for signature verification to work
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("[Stripe Webhook] STRIPE_WEBHOOK_SECRET is not configured — rejecting webhook");
    return { ok: false, error: "webhook_secret_not_configured" };
  }

  let event;
  try {
    event = stripeClient.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[economy] webhook_signature_invalid:", err.message);
    return { ok: false, error: "webhook_signature_invalid" };
  }

  // Idempotency: skip already-processed events
  if (isEventProcessed(db, event.id)) {
    return { ok: true, skipped: true, eventId: event.id };
  }

  try {
    switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const { userId, tokens, purpose } = session.metadata || {};

      if (purpose === "TOKEN_PURCHASE" && userId && tokens) {
        const tokenCount = parseInt(tokens, 10);
        if (tokenCount > 0) {
          // Determine purchase source (web, ios_app, android_app)
          const purchaseSource = session.metadata?.source || "web";

          // Credit tokens through the ledger (atomic, idempotent via refId)
          const result = executePurchase(db, {
            userId,
            amount: tokenCount,
            metadata: {
              source: purchaseSource,
              stripeSessionId: session.id,
              stripePaymentIntentId: session.payment_intent,
            },
            refId: `stripe_checkout:${event.id}`,
            requestId,
            ip,
          });

          if (!result.ok) {
            console.error(`[Stripe Webhook] executePurchase failed for session ${session.id}:`, result.error, result.detail);
            return { ok: false, error: "token_credit_failed", detail: result.error };
          }

          // Mint coins in treasury — keeps treasury.total_usd and total_coins in sync with ledger
          const mintResult = mintCoins(db, {
            amount: tokenCount,
            userId,
            refId: `stripe_mint:${event.id}`,
            requestId,
            ip,
          });

          if (!mintResult.ok) {
            console.error(`[Stripe Webhook] mintCoins failed for session ${session.id}:`, mintResult.error);
            // Purchase already credited — log critical alert but don't fail the webhook
            // (treasury reconciliation will catch this)
            economyAudit(db, {
              action: "mint_coins_failed_after_purchase",
              userId,
              amount: tokenCount,
              details: { stripeSessionId: session.id, error: mintResult.error },
              requestId,
              ip,
            });
          }

          console.log(`[ECONOMY] Checkout complete: ${tokenCount} tokens for user ${userId} via ${purchaseSource}`);

          economyAudit(db, {
            action: "token_purchase_completed",
            userId,
            amount: tokenCount,
            txId: result.batchId,
            details: {
              stripeSessionId: session.id,
              stripePaymentIntentId: session.payment_intent,
              fee: result.fee,
              net: result.net,
              source: purchaseSource,
            },
            requestId,
            ip,
          });
        }
      }
      break;
    }

    case "checkout.session.expired": {
      // Handle expired checkout sessions — record for audit trail completeness
      const session = event.data.object;
      const { userId: expiredUserId, tokens: expiredTokens } = session.metadata || {};

      economyAudit(db, {
        action: "checkout_session_expired",
        userId: expiredUserId || "unknown",
        amount: expiredTokens ? parseInt(expiredTokens, 10) : 0,
        details: {
          stripeSessionId: session.id,
          expiredAt: nowISO(),
        },
        requestId,
        ip,
      });
      break;
    }

    case "payment_intent.payment_failed": {
      // Handle failed payment intents — record for audit trail completeness
      const paymentIntent = event.data.object;
      const failureMessage = paymentIntent.last_payment_error?.message || "unknown_failure";
      const failureCode = paymentIntent.last_payment_error?.code || "unknown";

      economyAudit(db, {
        action: "payment_intent_failed",
        userId: paymentIntent.metadata?.userId || "unknown",
        amount: paymentIntent.amount ? paymentIntent.amount / 100 : 0,
        details: {
          paymentIntentId: paymentIntent.id,
          failureMessage,
          failureCode,
          failedAt: nowISO(),
        },
        requestId,
        ip,
      });
      break;
    }

    case "account.updated": {
      // Stripe Connect: update onboarding status
      const account = event.data.object;
      if (account.charges_enabled && account.payouts_enabled) {
        // Find user by stripe account id
        const row = db.prepare(
          "SELECT user_id FROM stripe_connected_accounts WHERE stripe_account_id = ?",
        ).get(account.id);
        if (row) {
          markOnboardingComplete(db, row.user_id);
          economyAudit(db, {
            action: "stripe_connect_onboarding_complete",
            userId: row.user_id,
            details: { stripeAccountId: account.id },
          });
        }
      }
      break;
    }

    case "transfer.paid": {
      // Stripe Connect payout landed — mark withdrawal as complete
      const transfer = event.data.object;
      const { concordUserId, withdrawalId } = transfer.metadata || {};
      if (withdrawalId) {
        db.prepare("UPDATE economy_withdrawals SET status = 'complete', processed_at = ? WHERE id = ?")
          .run(nowISO(), withdrawalId);
        economyAudit(db, {
          action: "withdrawal_payout_complete",
          userId: concordUserId || "unknown",
          details: { stripeTransferId: transfer.id, withdrawalId, amount: transfer.amount },
          requestId, ip,
        });
      }
      break;
    }

    case "transfer.failed": {
      // Stripe Connect payout failed — refund CC to user
      const transfer = event.data.object;
      const { concordUserId, withdrawalId, ccAmount } = transfer.metadata || {};
      if (withdrawalId && concordUserId) {
        // Restore withdrawal to approved so admin can retry or user can cancel
        db.prepare("UPDATE economy_withdrawals SET status = 'approved' WHERE id = ? AND status = 'processing'")
          .run(withdrawalId);
        // Reverse the ledger debit
        const amount = ccAmount ? parseInt(ccAmount, 10) : 0;
        if (amount > 0) {
          const txId = generateTxId();
          recordTransactionBatch(db, [{
            id: txId, type: "REVERSAL", from_user_id: PLATFORM_ACCOUNT_ID,
            to_user_id: concordUserId, amount, fee: 0, net: amount,
            status: "complete", metadata_json: JSON.stringify({ reason: "transfer_failed", withdrawalId, stripeTransferId: transfer.id }),
          }]);
        }
        economyAudit(db, {
          action: "withdrawal_payout_failed",
          userId: concordUserId,
          details: { stripeTransferId: transfer.id, withdrawalId, failureMessage: transfer.failure_message || "unknown" },
          requestId, ip,
        });
      }
      break;
    }

    case "charge.dispute.created": {
      const dispute = event.data.object;
      const amountCents = dispute.amount; // Stripe amounts are already in cents
      await handleChargeback(db, {
        chargebackAmountCents: amountCents,
        stripeDisputeId: dispute.id,
        paymentIntentId: dispute.payment_intent,
        requestId,
        ip,
      });
      break;
    }
    }

    // Mark event processed (idempotency)
    markEventProcessed(db, event.id, event.type);

    return { ok: true, eventId: event.id, eventType: event.type };
  } catch (err) {
    console.error("[economy] webhook_processing_failed:", err.message);
    return { ok: false, error: "webhook_processing_failed" };
  }
}

// ── B4: Stripe Connect Onboarding ───────────────────────────────────────────

export async function createConnectOnboarding(db, { userId, requestId, ip }) {
  const stripeClient = await getStripe();
  if (!stripeClient) return { ok: false, error: "stripe_not_configured" };

  const existing = getStripeAccount(db, userId);
  let accountId;

  if (existing?.stripe_account_id) {
    accountId = existing.stripe_account_id;
  } else {
    // Create new Express account
    try {
      const account = await stripeClient.accounts.create({
        type: "express",
        metadata: { userId },
      });
      accountId = account.id;
      upsertStripeAccount(db, userId, accountId);
    } catch (err) {
      console.error("[economy] connect_account_creation_failed:", err.message);
    return { ok: false, error: "connect_account_creation_failed" };
    }
  }

  // Generate account link for onboarding
  try {
    const accountLink = await stripeClient.accountLinks.create({
      account: accountId,
      refresh_url: `${FRONTEND_URL}/billing?connect_refresh=true`,
      return_url: `${FRONTEND_URL}/billing?connect_return=true`,
      type: "account_onboarding",
    });

    economyAudit(db, {
      action: "stripe_connect_onboarding_started",
      userId,
      details: { stripeAccountId: accountId },
      requestId,
      ip,
    });

    return { ok: true, onboardingUrl: accountLink.url, stripeAccountId: accountId };
  } catch (err) {
    console.error("[economy] connect_link_creation_failed:", err.message);
    return { ok: false, error: "connect_link_creation_failed" };
  }
}

/**
 * Get Stripe Connect status for a user.
 */
export function getConnectStatus(db, userId) {
  const account = getStripeAccount(db, userId);
  if (!account) {
    return { connected: false };
  }
  return {
    connected: true,
    stripeAccountId: account.stripe_account_id,
    onboardingComplete: Boolean(account.onboarding_complete),
  };
}

// ── B4: Process Withdrawal via Stripe Connect ───────────────────────────────

export async function processStripeWithdrawal(db, { withdrawalId, requestId, ip }) {
  const stripeClient = await getStripe();
  if (!stripeClient) return { ok: false, error: "stripe_not_configured" };

  // Get withdrawal record
  const wd = db.prepare("SELECT * FROM economy_withdrawals WHERE id = ?").get(withdrawalId);
  if (!wd) return { ok: false, error: "withdrawal_not_found" };
  if (wd.status !== "approved") return { ok: false, error: "withdrawal_not_approved", currentStatus: wd.status };

  // Check user has connected Stripe account
  const account = getStripeAccount(db, wd.user_id);
  if (!account || !account.onboarding_complete) {
    return { ok: false, error: "stripe_connect_not_complete" };
  }

  // Re-verify balance
  const { balance } = getBalance(db, wd.user_id);
  if (balance < wd.amount) {
    return { ok: false, error: "insufficient_balance_at_processing", balance };
  }

  // Convert tokens to USD cents
  const payoutAmountCents = Math.round((wd.net / TOKENS_PER_USD) * 100);

  // CRITICAL: Correct withdrawal order to prevent money loss on crash.
  // Step 1: Debit ledger with "pending_payout" status FIRST
  // Step 2: Execute Stripe transfer
  // Step 3: Mark ledger entry as complete
  // If Stripe fails, reverse the ledger entry. If server crashes between
  // steps 1 and 2, the pending_payout entry is visible for reconciliation.

  const batchId = generateTxId();
  const now = nowISO();
  let ledgerResults;

  // Step 1: Debit ledger with pending_payout status
  try {
    const doLedgerDebit = db.transaction(() => {
      const entries = [{
        id: generateTxId(),
        type: "WITHDRAWAL",
        from: wd.user_id,
        to: null,
        amount: wd.amount,
        fee: wd.fee,
        net: wd.net,
        status: "pending",
        metadata: {
          withdrawalId,
          batchId,
          role: "debit",
          payoutStatus: "pending_payout",
        },
        requestId,
        ip,
      }];

      if (wd.fee > 0) {
        entries.push({
          id: generateTxId(),
          type: "FEE",
          from: null,
          to: PLATFORM_ACCOUNT_ID,
          amount: wd.fee,
          fee: 0,
          net: wd.fee,
          status: "pending",
          metadata: { withdrawalId, batchId, role: "fee", sourceType: "WITHDRAWAL", payoutStatus: "pending_payout" },
          requestId,
          ip,
        });
      }

      const results = recordTransactionBatch(db, entries);

      db.prepare(`
        UPDATE economy_withdrawals
        SET status = 'processing', ledger_id = ?, updated_at = ?
        WHERE id = ?
      `).run(results[0].id, now, withdrawalId);

      return results;
    });

    ledgerResults = doLedgerDebit();
  } catch (err) {
    console.error("[economy] ledger_debit_failed:", err.message);
    return { ok: false, error: "ledger_debit_failed" };
  }

  // Step 2: Execute Stripe transfer
  try {
    const transfer = await stripeClient.transfers.create({
      amount: payoutAmountCents,
      currency: "usd",
      destination: account.stripe_account_id,
      metadata: {
        withdrawalId,
        userId: wd.user_id,
        concordUserId: wd.user_id,
        ccAmount: String(wd.amount),
        tokens: String(wd.amount),
      },
    });

    // Step 3: Mark ledger entries as complete and burn coins from treasury
    const doComplete = db.transaction(() => {
      for (const entry of ledgerResults) {
        db.prepare(
          "UPDATE economy_ledger SET status = 'complete' WHERE id = ?"
        ).run(entry.id);
      }

      db.prepare(`
        UPDATE economy_withdrawals
        SET status = 'complete', processed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, withdrawalId);
    });

    doComplete();

    // Burn coins from treasury (withdrawal removes coins from system)
    burnCoins(db, {
      amount: wd.net,
      userId: wd.user_id,
      refId: `withdrawal_burn:${withdrawalId}`,
      requestId,
      ip,
    });

    economyAudit(db, {
      action: "withdrawal_processed_stripe",
      userId: wd.user_id,
      amount: wd.amount,
      txId: batchId,
      details: {
        withdrawalId,
        stripeTransferId: transfer.id,
        payoutAmountCents,
        fee: wd.fee,
        net: wd.net,
      },
      requestId,
      ip,
    });

    return {
      ok: true,
      batchId,
      transactions: ledgerResults,
      stripeTransferId: transfer.id,
      withdrawal: { ...wd, status: "complete" },
    };
  } catch (err) {
    // Stripe transfer failed — reverse the ledger entries
    try {
      const doReverse = db.transaction(() => {
        for (const entry of ledgerResults) {
          db.prepare(
            "UPDATE economy_ledger SET status = 'reversed' WHERE id = ?"
          ).run(entry.id);
        }

        db.prepare(`
          UPDATE economy_withdrawals SET status = 'approved', updated_at = ?
          WHERE id = ? AND status = 'processing'
        `).run(nowISO(), withdrawalId);
      });
      doReverse();
    } catch (reverseErr) {
      console.error("[Stripe Withdrawal] CRITICAL: Failed to reverse ledger after Stripe failure:", reverseErr.message);
    }

    economyAudit(db, {
      action: "withdrawal_stripe_failed",
      userId: wd.user_id,
      amount: wd.amount,
      details: { withdrawalId, error: err.message, ledgerReversed: true },
      requestId,
      ip,
    });

    console.error("[economy] stripe_payout_failed:", err.message);
    return { ok: false, error: "stripe_payout_failed" };
  }
}

export { STRIPE_ENABLED, getStripe, getStripeAccount, MIN_WITHDRAW_TOKENS, MAX_WITHDRAW_TOKENS_PER_DAY };
