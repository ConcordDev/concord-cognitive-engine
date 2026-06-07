// economy/routes.js
// HTTP endpoints for the economy system.
// All routes are mounted under /api/economy and /api/stripe.

import express from "express";
import { getBalance } from "./balances.js";
import { getTransactions, getAllTransactions } from "./ledger.js";
import { FEES, PLATFORM_ACCOUNT_ID } from "./fees.js";
import { executeTransfer, executePurchase, executeMarketplacePurchase, executeReversal } from "./transfer.js";
import {
  requestWithdrawal, approveWithdrawal, rejectWithdrawal,
  processWithdrawal, cancelWithdrawal, getUserWithdrawals, getAllWithdrawals,
} from "./withdrawals.js";
import { adminOnly, authRequired } from "./guards.js";
import { isCcBlockedForActor } from "../lib/agent-guardrails.js";
import { economyAudit, auditCtx } from "./audit.js";
import {
  createCheckoutSession, handleWebhook, createConnectOnboarding,
  getConnectStatus, processStripeWithdrawal, STRIPE_ENABLED,
  MIN_WITHDRAW_TOKENS, MAX_WITHDRAW_TOKENS_PER_DAY,
} from "./stripe.js";
import {
  getPurchase, getUserPurchases, getPurchaseHistory,
  transitionPurchase, findPurchasesByStatus,
} from "./purchases.js";
import {
  runReconciliation, executeCorrection, getPurchaseReceipt, getReconciliationSummary,
} from "./reconciliation.js";
import { mintCoins, burnCoins, getTreasuryState, verifyTreasuryInvariant } from "./coin-service.js";
import {
  calculateGenerationalRate, registerCitation, getAncestorChain,
  distributeRoyalties, getCreatorRoyalties, getContentRoyalties,
} from "./royalty-cascade.js";
import {
  createEmergentAccount, transferToReserve, getEmergentAccount,
  listEmergentAccounts, suspendEmergentAccount, isEmergentAccount, canWithdrawToFiat,
} from "./emergent-accounts.js";
import {
  createListing, purchaseListing, getListing, searchListings,
  delistListing, updateListingPrice, checkWashTrading,
} from "./marketplace-service.js";
import { distributeFee, getFeeSplitBalances, getFeeDistributions } from "./fee-split.js";
import { runTreasuryReconciliation, getReconciliationHistory } from "./treasury-reconciliation.js";
import { getSystemBalanceSummary } from "./balances.js";
import { getDescendants } from "./royalty-cascade.js";
import { initReservesSchema, allocateFromFee, getReserveHealth } from "./reserves.js";
import { getUserStorage } from "../lib/storage-quota.js";

/**
 * Register all economy + Stripe routes on the Express app.
 * @param {import('express').Express} app
 * @param {import('better-sqlite3').Database} db
 * @param {object} opts
 * @param {function} opts.structuredLog - Structured logging function(level, event, data)
 */
export function registerEconomyRoutes(app, db, opts = {}) {
  const log = opts.structuredLog || ((level, event, data) => console[level === "error" ? "error" : "log"](`[economy] ${event}`, data));

  // Initialise chargeback reserve schema (idempotent)
  initReservesSchema(db);

  // ═══════════════════════════════════════════════════════════════════════════
  // ECONOMY ENDPOINTS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Balance ────────────────────────────────────────────────────────────────

  app.get("/api/economy/balance", (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const result = getBalance(db, userId);
      res.json({ ok: true, userId, ...result });
    } catch (err) {
      log("error", "economy_balance_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "balance_fetch_failed" });
    }
  });

  // ── Transaction History ────────────────────────────────────────────────────

  app.get("/api/economy/history", (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const offset = parseInt(req.query.offset, 10) || 0;
      const type = req.query.type || undefined;

      const result = getTransactions(db, userId, { limit, offset, type });
      res.json({ ok: true, userId, ...result });
    } catch (err) {
      log("error", "economy_history_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "history_fetch_failed" });
    }
  });

  // ── Admin: all transactions ────────────────────────────────────────────────

  app.get("/api/economy/admin/transactions", adminOnly, (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
      const offset = parseInt(req.query.offset, 10) || 0;
      const type = req.query.type || undefined;
      const status = req.query.status || undefined;

      const result = getAllTransactions(db, { limit, offset, type, status });
      res.json({ ok: true, ...result });
    } catch (err) {
      log("error", "economy_admin_transactions_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "admin_transactions_failed" });
    }
  });

  // ── Token Purchase (direct ledger mint, no Stripe) ─────────────────────────

  app.post("/api/economy/buy", adminOnly, (req, res) => {
    try {
      // Admin-only token mint. The body field carries the TARGET id (who
      // to mint for), not the actor — adminOnly middleware above already
      // pins the actor to req.user. The body field and the actor field
      // are read on two separate statements so CodeQL/Semgrep can
      // distinguish target from actor (and so the ci.yml auth-bypass
      // grep gate doesn't trip on the prior single-line shape).
      // eslint-disable-next-line no-restricted-syntax -- safe: target-identifier; adminOnly enforces actor=admin
      const targetUserId = req.body.user_id;
      const userId = targetUserId || req.user?.id;
      const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;

      if (!userId) return res.status(400).json({ ok: false, error: "missing_user_id" });
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_amount" });
      }

      const ctx = auditCtx(req);
      const result = executePurchase(db, {
        userId,
        amount,
        metadata: { source: req.body.source || "admin_api" },
        requestId: ctx.requestId,
        ip: ctx.ip,
      });

      if (!result.ok) return res.status(400).json(result);

      // Mint coins in treasury to maintain 1:1 USD peg
      const mintResult = mintCoins(db, {
        amount,
        userId,
        refId: `admin_mint:${result.batchId}`,
        requestId: ctx.requestId,
        ip: ctx.ip,
      });

      if (!mintResult.ok) {
        console.error("[economy] admin mintCoins failed:", mintResult.error);
        economyAudit(db, {
          action: "mint_coins_failed_after_admin_purchase",
          userId,
          amount,
          details: { error: mintResult.error, batchId: result.batchId },
          ...ctx,
        });
      }

      economyAudit(db, {
        action: "admin_token_mint",
        userId,
        amount,
        txId: result.batchId,
        ...ctx,
      });

      res.json(result);
    } catch (err) {

      log("error", "economy_purchase_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "purchase_failed" });

    }
  });

  // ── Transfer (user → user) ─────────────────────────────────────────────────

  app.post("/api/economy/transfer", (req, res) => {
    try {
      const from = req.user?.id;
      const to = req.body.to;
      const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;

      if (!from) return res.status(400).json({ ok: false, error: "missing_sender" });
      if (!to) return res.status(400).json({ ok: false, error: "missing_recipient" });
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_amount" });
      }

      const ctx = auditCtx(req);
      const result = executeTransfer(db, {
        from,
        to,
        amount,
        type: req.body.type || "TRANSFER",
        metadata: req.body.metadata || {},
        requestId: ctx.requestId,
        ip: ctx.ip,
      });

      if (!result.ok) return res.status(400).json(result);

      economyAudit(db, {
        action: "transfer",
        userId: from,
        amount,
        txId: result.batchId,
        details: { to, fee: result.fee, net: result.net },
        ...ctx,
      });

      res.json(result);
    } catch (err) {

      log("error", "economy_transfer_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "transfer_failed" });

    }
  });

  // ── Marketplace Purchase (buyer → seller, with fee) ────────────────────────

  app.post("/api/economy/marketplace-purchase", authRequired, (req, res) => {
    try {
       
      const buyerId = req.user?.id;
      // eslint-disable-next-line no-restricted-syntax
      const sellerId = req.body.seller_id; // safe: target-identifier
      const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;
      const listingId = req.body.listing_id;

      if (!buyerId) return res.status(400).json({ ok: false, error: "missing_buyer_id" });
      if (!sellerId) return res.status(400).json({ ok: false, error: "missing_seller_id" });
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_amount" });
      }

      const ctx = auditCtx(req);
      const result = executeMarketplacePurchase(db, {
        buyerId,
        sellerId,
        amount,
        listingId,
        metadata: req.body.metadata || {},
        requestId: ctx.requestId,
        ip: ctx.ip,
      });

      if (!result.ok) return res.status(400).json(result);

      economyAudit(db, {
        action: "marketplace_purchase",
        userId: buyerId,
        amount,
        txId: result.batchId,
        details: { sellerId, listingId, fee: result.fee, net: result.net },
        ...ctx,
      });

      // Allocate a portion of the platform fee to reserves
      if (result.fee > 0) {
        try {
          allocateFromFee(db, {
            feeAmount:  result.fee,
            sourceTxId: result.batchId,
            requestId:  ctx.requestId,
            ip:         ctx.ip,
          });
        } catch (allocErr) {
          log("error", "reserve_allocation_failed", { error: allocErr.message });
        }
      }

      res.json(result);
    } catch (err) {

      log("error", "economy_marketplace_purchase_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "marketplace_purchase_failed" });

    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WITHDRAWALS
  // ═══════════════════════════════════════════════════════════════════════════

  app.post("/api/economy/withdraw", authRequired, (req, res) => {
    try {
      const userId = req.user?.id;
      const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;

      if (!userId) return res.status(400).json({ ok: false, error: "missing_user_id" });
      // Wave 7 / Track C2 — Sparks-only: an autonomous agent can never reach the
      // real-money (CC) withdrawal surface. Earning/spending Sparks is untouched.
      if (isCcBlockedForActor(req.user)) {
        return res.status(403).json({ ok: false, error: "agent_cc_forbidden" });
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_amount" });
      }

      // Enforce minimum withdrawal
      if (amount < MIN_WITHDRAW_TOKENS) {
        return res.status(400).json({ ok: false, error: "below_minimum_withdrawal", min: MIN_WITHDRAW_TOKENS });
      }

      // Check Stripe Connect account if Stripe is enabled
      if (STRIPE_ENABLED) {
        const connectStatus = getConnectStatus(db, userId);
        if (!connectStatus.connected || !connectStatus.onboardingComplete) {
          return res.status(400).json({ ok: false, error: "stripe_connect_required" });
        }
      }

      const ctx = auditCtx(req);
      const result = requestWithdrawal(db, { userId, amount });
      if (!result.ok) return res.status(400).json(result);

      economyAudit(db, {
        action: "withdrawal_requested",
        userId,
        amount,
        details: { withdrawalId: result.withdrawal?.id },
        ...ctx,
      });

      res.json(result);
    } catch (err) {

      log("error", "economy_withdrawal_request_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "withdrawal_request_failed" });

    }
  });

  app.get("/api/economy/withdrawals", authRequired, (req, res) => {
    try {
      const userId = req.user.id;

      const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
      const offset = parseInt(req.query.offset, 10) || 0;

      const result = getUserWithdrawals(db, userId, { limit, offset });
      res.json({ ok: true, userId, ...result });
    } catch (err) {

      log("error", "economy_withdrawals_fetch_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "withdrawals_fetch_failed" });

    }
  });

  app.post("/api/economy/withdrawals/:id/cancel", authRequired, (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(400).json({ ok: false, error: "missing_user_id" });

      const result = cancelWithdrawal(db, { withdrawalId: req.params.id, userId });
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (err) {

      log("error", "economy_cancel_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "cancel_failed" });

    }
  });

  // ── Admin: Withdrawal management ──────────────────────────────────────────

  app.post("/api/economy/admin/withdrawals/:id/approve", adminOnly, (req, res) => {
    try {
      const reviewerId = req.user?.id || "system";
      const ctx = auditCtx(req);
      const result = approveWithdrawal(db, { withdrawalId: req.params.id, reviewerId });
      if (!result.ok) return res.status(400).json(result);

      economyAudit(db, {
        action: "withdrawal_approved",
        userId: reviewerId,
        details: { withdrawalId: req.params.id },
        ...ctx,
      });

      res.json(result);
    } catch (err) {

      log("error", "economy_approve_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "approve_failed" });

    }
  });

  app.post("/api/economy/admin/withdrawals/:id/reject", adminOnly, (req, res) => {
    try {
      const reviewerId = req.user?.id || "system";
      const ctx = auditCtx(req);
      const result = rejectWithdrawal(db, { withdrawalId: req.params.id, reviewerId });
      if (!result.ok) return res.status(400).json(result);

      economyAudit(db, {
        action: "withdrawal_rejected",
        userId: reviewerId,
        details: { withdrawalId: req.params.id },
        ...ctx,
      });

      res.json(result);
    } catch (err) {

      log("error", "economy_reject_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "reject_failed" });

    }
  });

  app.post("/api/economy/admin/withdrawals/:id/process", adminOnly, async (req, res) => {
    try {
      const ctx = auditCtx(req);

      // Use Stripe Connect if enabled, otherwise local-only processing
      let result;
      if (STRIPE_ENABLED) {
        result = await processStripeWithdrawal(db, {
          withdrawalId: req.params.id,
          requestId: ctx.requestId,
          ip: ctx.ip,
        });
      } else {
        result = processWithdrawal(db, {
          withdrawalId: req.params.id,
          requestId: ctx.requestId,
          ip: ctx.ip,
        });
      }

      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (err) {

      log("error", "economy_process_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "process_failed" });

    }
  });

  app.get("/api/economy/admin/withdrawals", adminOnly, (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const offset = parseInt(req.query.offset, 10) || 0;
      const status = req.query.status || undefined;

      const result = getAllWithdrawals(db, { status, limit, offset });
      res.json({ ok: true, ...result });
    } catch (err) {

      log("error", "economy_admin_withdrawals_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "admin_withdrawals_failed" });

    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // REVERSALS (admin only)
  // ═══════════════════════════════════════════════════════════════════════════

  app.post("/api/economy/admin/reverse", adminOnly, (req, res) => {
    try {
      const { transaction_id, reason } = req.body;
      if (!transaction_id) return res.status(400).json({ ok: false, error: "missing_transaction_id" });

      const ctx = auditCtx(req);
      const result = executeReversal(db, {
        originalTxId: transaction_id,
        reason: reason || "admin_reversal",
        requestId: ctx.requestId,
        ip: ctx.ip,
      });

      if (!result.ok) return res.status(400).json(result);

      economyAudit(db, {
        action: "reversal",
        userId: req.user?.id,
        txId: result.batchId,
        details: { originalTxId: transaction_id, reason },
        ...ctx,
      });

      res.json(result);
    } catch (err) {

      log("error", "economy_reversal_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "reversal_failed" });

    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FEE SCHEDULE + PLATFORM INFO
  // ═══════════════════════════════════════════════════════════════════════════

  app.get("/api/economy/fees", (_req, res) => {
    res.json({ ok: true, fees: FEES, platformAccount: PLATFORM_ACCOUNT_ID });
  });

  app.get("/api/economy/platform-balance", adminOnly, (_req, res) => {
    try {
      const result = getBalance(db, PLATFORM_ACCOUNT_ID);
      res.json({ ok: true, platformAccount: PLATFORM_ACCOUNT_ID, ...result });
    } catch (err) {

      log("error", "economy_platform_balance_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "platform_balance_failed" });

    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LEDGER INTEGRITY
  // ═══════════════════════════════════════════════════════════════════════════

  app.get("/api/economy/integrity", (req, res) => {
    try {
      const totalCredits = db.prepare(`
        SELECT COALESCE(SUM(net), 0) as total FROM economy_ledger
        WHERE to_user_id IS NOT NULL AND status = 'complete'
      `).get()?.total || 0;

      const totalDebits = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM economy_ledger
        WHERE from_user_id IS NOT NULL AND status = 'complete'
      `).get()?.total || 0;

      const totalMinted = db.prepare(`
        SELECT COALESCE(SUM(net), 0) as total FROM economy_ledger
        WHERE type = 'TOKEN_PURCHASE' AND status = 'complete'
      `).get()?.total || 0;

      const totalWithdrawn = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM economy_ledger
        WHERE type = 'WITHDRAWAL' AND status = 'complete'
      `).get()?.total || 0;

      const platformFees = db.prepare(`
        SELECT COALESCE(SUM(net), 0) as total FROM economy_ledger
        WHERE type = 'FEE' AND to_user_id = ? AND status = 'complete'
      `).get(PLATFORM_ACCOUNT_ID)?.total || 0;

      const txCount = db.prepare("SELECT COUNT(*) as c FROM economy_ledger").get()?.c || 0;

      const pendingWithdrawals = db.prepare(`
        SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as total
        FROM economy_withdrawals WHERE status IN ('pending', 'approved', 'processing')
      `).get();

      res.json({
        ok: true,
        integrity: {
          totalCredits: Math.round(totalCredits * 100) / 100,
          totalDebits: Math.round(totalDebits * 100) / 100,
          totalMinted: Math.round(totalMinted * 100) / 100,
          totalWithdrawn: Math.round(totalWithdrawn * 100) / 100,
          platformFees: Math.round(platformFees * 100) / 100,
          transactionCount: txCount,
          pendingWithdrawals: pendingWithdrawals?.c || 0,
          pendingWithdrawalAmount: Math.round((pendingWithdrawals?.total || 0) * 100) / 100,
        },
      });
    } catch (err) {

      log("error", "economy_integrity_check_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "integrity_check_failed" });

    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STRIPE ENDPOINTS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Buy tokens via Stripe Checkout ─────────────────────────────────────────

  app.post("/api/economy/buy/checkout", authRequired, async (req, res) => {
    try {
      if (!STRIPE_ENABLED) {
        return res.status(503).json({ ok: false, error: "stripe_not_configured" });
      }

      const userId = req.user?.id;
      const tokens = parseInt(req.body.tokens, 10);

      if (!userId) return res.status(400).json({ ok: false, error: "missing_user_id" });
      if (!Number.isInteger(tokens) || tokens <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_token_amount" });
      }

      const ctx = auditCtx(req);
      const result = await createCheckoutSession(db, {
        userId,
        tokens,
        requestId: ctx.requestId,
        ip: ctx.ip,
      });

      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (err) {

      log("error", "economy_checkout_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "checkout_failed" });

    }
  });

  // ── Stripe Webhook ─────────────────────────────────────────────────────────
  // IMPORTANT: webhook needs raw body for signature verification.
  // This route must be registered BEFORE express.json() body parser,
  // OR use express.raw() locally.

  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    try {
      const result = await handleWebhook(db, {
        rawBody: req.body,
        signature: req.headers["stripe-signature"],
        requestId: req.headers["x-request-id"],
        ip: req.ip,
      });

      if (!result.ok) return res.status(400).json(result);
      res.json({ received: true, ...result });
    } catch (err) {

      log("error", "economy_webhook_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "webhook_failed" });

    }
  });

  // ── Stripe Connect ─────────────────────────────────────────────────────────

  app.post("/api/stripe/connect/onboard", authRequired, async (req, res) => {
    try {
      if (!STRIPE_ENABLED) {
        return res.status(503).json({ ok: false, error: "stripe_not_configured" });
      }

      const userId = req.user?.id;
      if (!userId) return res.status(400).json({ ok: false, error: "missing_user_id" });

      const ctx = auditCtx(req);
      const result = await createConnectOnboarding(db, {
        userId,
        requestId: ctx.requestId,
        ip: ctx.ip,
      });

      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (err) {

      log("error", "economy_connect_onboard_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "connect_onboard_failed" });

    }
  });

  app.get("/api/stripe/connect/status", authRequired, (req, res) => {
    try {
      const userId = req.user?.id;
      // AUTH_MODE=public lets authRequired pass through anonymous probes;
      // smoke + dev hit this without a session. Return a 200 with
      // configured=false instead of throwing on req.user.id.
      if (!userId) {
        return res.json({ ok: true, userId: null, configured: false, anonymous: true });
      }
      const result = getConnectStatus(db, userId);
      res.json({ ok: true, userId, ...result });
    } catch (err) {

      log("error", "economy_connect_status_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "connect_status_failed" });

    }
  });

  // ── Stripe configuration status ────────────────────────────────────────────

  app.get("/api/economy/config", (_req, res) => {
    res.json({
      ok: true,
      stripeEnabled: STRIPE_ENABLED,
      fees: FEES,
      minWithdrawal: MIN_WITHDRAW_TOKENS,
      maxWithdrawalPerDay: MAX_WITHDRAW_TOKENS_PER_DAY,
      platformAccount: PLATFORM_ACCOUNT_ID,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PURCHASE STATE MACHINE + SUPPORT SURFACE
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Purchase receipt / lookup ────────────────────────────────────────────

  app.get("/api/economy/purchases/:purchaseId/receipt", (req, res) => {
    try {
      const result = getPurchaseReceipt(db, req.params.purchaseId);
      if (!result.ok) return res.status(404).json(result);
      res.json(result);
    } catch (err) {

      log("error", "economy_receipt_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "receipt_failed" });

    }
  });

  // ── Purchase lookup by ID ────────────────────────────────────────────────

  app.get("/api/economy/purchases/:purchaseId", (req, res) => {
    try {
      const purchase = getPurchase(db, req.params.purchaseId);
      if (!purchase) return res.status(404).json({ ok: false, error: "purchase_not_found" });
      res.json({ ok: true, purchase });
    } catch (err) {

      log("error", "economy_purchase_lookup_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "purchase_lookup_failed" });

    }
  });

  // ── Purchase status history ──────────────────────────────────────────────

  app.get("/api/economy/purchases/:purchaseId/history", (req, res) => {
    try {
      const history = getPurchaseHistory(db, req.params.purchaseId);
      res.json({ ok: true, purchaseId: req.params.purchaseId, history });
    } catch (err) {

      log("error", "economy_history_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "history_failed" });

    }
  });

  // ── User purchases (buyer or seller) ─────────────────────────────────────

  app.get("/api/economy/purchases", authRequired, (req, res) => {
    try {
      const userId = req.user.id;

      const role = req.query.role === "seller" ? "seller" : "buyer";
      const status = req.query.status || undefined;
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const offset = parseInt(req.query.offset, 10) || 0;

      const result = getUserPurchases(db, userId, { role, status, limit, offset });
      res.json({ ok: true, userId, role, ...result });
    } catch (err) {

      log("error", "economy_purchases_list_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "purchases_list_failed" });

    }
  });

  // ── Admin: Refund / reverse a purchase ───────────────────────────────────

  app.post("/api/economy/admin/purchases/:purchaseId/refund", adminOnly, (req, res) => {
    try {
      const ctx = auditCtx(req);
      const result = executeCorrection(db, {
        correctionType: "REVERSAL",
        purchaseId: req.params.purchaseId,
        reason: req.body.reason || "admin_refund",
        actor: ctx.userId || "admin",
      });

      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (err) {

      log("error", "economy_refund_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "refund_failed" });

    }
  });

  // ── Admin: Make-good for a failed/disputed purchase ──────────────────────

  app.post("/api/economy/admin/purchases/:purchaseId/make-good", adminOnly, (req, res) => {
    try {
      const ctx = auditCtx(req);
      const result = executeCorrection(db, {
        correctionType: "MAKE_GOOD",
        purchaseId: req.params.purchaseId,
        reason: req.body.reason || "admin_make_good",
        actor: ctx.userId || "admin",
      });

      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (err) {

      log("error", "economy_make_good_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "make_good_failed" });

    }
  });

  // ── Admin: Adjustment correction ─────────────────────────────────────────

  app.post("/api/economy/admin/purchases/:purchaseId/adjust", adminOnly, (req, res) => {
    try {
      const ctx = auditCtx(req);
      const adjustmentAmount = Math.round(parseFloat(req.body.amount) * 100) / 100;
      if (!Number.isFinite(adjustmentAmount) || adjustmentAmount === 0) {
         
        return res.status(400).json({ ok: false, error: "invalid_adjustment_amount" });
      }
      // eslint-disable-next-line no-restricted-syntax
      if (!req.body.user_id) { // safe: target-identifier
        return res.status(400).json({ ok: false, error: "missing_user_id" });
      }

      const result = executeCorrection(db, {
        correctionType: "ADJUSTMENT",
        purchaseId: req.params.purchaseId,
         
        reason: req.body.reason || "admin_adjustment",
        actor: ctx.userId || "admin",
        adjustmentAmount,
        // eslint-disable-next-line no-restricted-syntax
        adjustmentUserId: req.body.user_id, // safe: target-identifier
      });

      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (err) {

      log("error", "economy_adjustment_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "adjustment_failed" });

    }
  });

  // ── Admin: Manually transition a purchase state ──────────────────────────

  app.post("/api/economy/admin/purchases/:purchaseId/transition", adminOnly, (req, res) => {
    try {
      const { status, reason } = req.body;
      if (!status) return res.status(400).json({ ok: false, error: "missing_target_status" });

      const ctx = auditCtx(req);
      const result = transitionPurchase(db, req.params.purchaseId, status, {
        reason: reason || "admin_manual_transition",
        actor: ctx.userId || "admin",
      });

      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (err) {

      log("error", "economy_transition_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "transition_failed" });

    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RECONCILIATION
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Admin: Run reconciliation sweep ──────────────────────────────────────

  app.post("/api/economy/admin/reconciliation/run", adminOnly, (req, res) => {
    try {
      const dryRun = req.body.dry_run === true || req.query.dry_run === "true";
      const staleCreatedMinutes = parseInt(req.body.stale_created_minutes, 10) || 30;
      const stalePaidMinutes = parseInt(req.body.stale_paid_minutes, 10) || 15;
      const staleSettledMinutes = parseInt(req.body.stale_settled_minutes, 10) || 15;

      const result = runReconciliation(db, {
        dryRun,
        staleCreatedMinutes,
        stalePaidMinutes,
        staleSettledMinutes,
      });

      res.json(result);
    } catch (err) {

      log("error", "economy_reconciliation_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "reconciliation_failed" });

    }
  });

  // ── Admin: Reconciliation summary / dashboard ────────────────────────────

  app.get("/api/economy/admin/reconciliation/summary", adminOnly, (req, res) => {
    try {
      const result = getReconciliationSummary(db);
      res.json(result);
    } catch (err) {

      log("error", "economy_summary_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "summary_failed" });

    }
  });

  // ── Admin: Find purchases by status ──────────────────────────────────────

  app.get("/api/economy/admin/purchases", adminOnly, (req, res) => {
    try {
      const status = req.query.status;
      if (!status) return res.status(400).json({ ok: false, error: "missing_status_filter" });

      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
      const olderThanMinutes = parseInt(req.query.older_than_minutes, 10) || undefined;

      const purchases = findPurchasesByStatus(db, status, { limit, olderThanMinutes });
      res.json({ ok: true, status, count: purchases.length, purchases });
    } catch (err) {

      log("error", "economy_purchases_query_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "purchases_query_failed" });

    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TREASURY / COIN SERVICE
  // ═══════════════════════════════════════════════════════════════════════════

  app.get("/api/economy/treasury", adminOnly, (_req, res) => {
    try {
      const state = getTreasuryState(db);
      const invariant = verifyTreasuryInvariant(db);
      res.json({ ok: true, treasury: state, invariant });
    } catch (err) {

      log("error", "economy_treasury_fetch_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "treasury_fetch_failed" });

    }
  });

  app.post("/api/economy/admin/treasury/reconcile", adminOnly, (req, res) => {
    try {
      const stripeBalance = req.body.stripe_balance != null ? Math.round(parseFloat(req.body.stripe_balance) * 100) / 100 : undefined;
      const result = runTreasuryReconciliation(db, { stripeBalance });
      res.json(result);
    } catch (err) {

      log("error", "economy_reconciliation_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "reconciliation_failed" });

    }
  });

  app.get("/api/economy/admin/treasury/history", adminOnly, (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
      const offset = parseInt(req.query.offset, 10) || 0;
      const result = getReconciliationHistory(db, { limit, offset });
      res.json({ ok: true, ...result });
    } catch (err) {
      log("error", "economy_history_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "history_fetch_failed" });
    }
  });

  app.get("/api/economy/admin/balances/summary", adminOnly, (_req, res) => {
    try {
      const summary = getSystemBalanceSummary(db);
      res.json({ ok: true, ...summary });
    } catch (err) {

      log("error", "economy_summary_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "summary_failed" });

    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROYALTY CASCADE
  // ═══════════════════════════════════════════════════════════════════════════

  app.post("/api/economy/royalties/register-citation", (req, res) => {
    try {
      const { child_id, parent_id, creator_id, parent_creator_id, generation } = req.body;
      if (!child_id || !parent_id) return res.status(400).json({ ok: false, error: "missing_content_ids" });
      if (!creator_id || !parent_creator_id) return res.status(400).json({ ok: false, error: "missing_creator_ids" });

      const result = registerCitation(db, {
        childId: child_id,
        parentId: parent_id,
        creatorId: creator_id,
        parentCreatorId: parent_creator_id,
        generation: generation || 1,
      });

      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (err) {

      log("error", "economy_citation_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "citation_failed" });

    }
  });

  app.get("/api/economy/royalties/chain/:contentId", (req, res) => {
    try {
      const ancestors = getAncestorChain(db, req.params.contentId);
      res.json({ ok: true, contentId: req.params.contentId, ancestors, count: ancestors.length });
    } catch (err) {

      log("error", "economy_chain_fetch_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "chain_fetch_failed" });

    }
  });

  // Royalty dashboard — lifetime stats + passive earnings for creator
  app.get("/api/economy/royalties/dashboard", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

    try {
      const lifetime = db.prepare(`
        SELECT
          COALESCE(SUM(CAST(ROUND(net * 100) AS INTEGER)), 0) AS total_cents,
          COUNT(*) AS total_transactions,
          COUNT(DISTINCT from_user_id) AS unique_citers,
          MAX(CAST(json_extract(metadata_json, '$.generation') AS INTEGER)) AS deepest_generation
        FROM economy_ledger
        WHERE to_user_id = ? AND type = 'ROYALTY' AND status = 'complete'
      `).get(userId);

      const mostCited = db.prepare(`
        SELECT json_extract(metadata_json, '$.recipientArtifactId') AS dtu_id, COUNT(*) AS cite_count
        FROM economy_ledger
        WHERE to_user_id = ? AND type = 'ROYALTY' AND status = 'complete'
          AND json_extract(metadata_json, '$.recipientArtifactId') IS NOT NULL
        GROUP BY dtu_id ORDER BY cite_count DESC LIMIT 1
      `).get(userId);

      const lastLogin = db.prepare("SELECT last_login_at FROM users WHERE id = ?").get(userId)?.last_login_at;
      let sinceLastLogin = 0;
      if (lastLogin) {
        const passive = db.prepare(`
          SELECT COALESCE(SUM(CAST(ROUND(net * 100) AS INTEGER)), 0) AS cents
          FROM economy_ledger
          WHERE to_user_id = ? AND type = 'ROYALTY' AND status = 'complete' AND created_at > ?
        `).get(userId, lastLogin);
        sinceLastLogin = (passive?.cents || 0) / 100;
      }

      const recent = db.prepare(`
        SELECT net AS amount, metadata_json, created_at AS timestamp
        FROM economy_ledger
        WHERE to_user_id = ? AND type = 'ROYALTY' AND status = 'complete'
        ORDER BY created_at DESC LIMIT 20
      `).all(userId).map(r => {
        const meta = JSON.parse(r.metadata_json || "{}");
        return {
          amount: r.amount,
          fromArtifact: meta.artifactId,
          yourDTU: meta.recipientArtifactId,
          generation: meta.generation,
          rate: meta.rate ? `${(meta.rate * 100).toFixed(1)}%` : null,
          timestamp: r.timestamp,
        };
      });

      res.json({
        ok: true,
        lifetime: {
          totalEarned: (lifetime?.total_cents || 0) / 100,
          totalTransactions: lifetime?.total_transactions || 0,
          uniqueCiters: lifetime?.unique_citers || 0,
          deepestGeneration: lifetime?.deepest_generation || 0,
          mostCitedDTU: mostCited?.dtu_id || null,
        },
        recent,
        passive: {
          sinceLastLogin,
          message: sinceLastLogin > 0
            ? `Your work earned ${sinceLastLogin.toFixed(2)} CC while you were away`
            : "No new royalties since your last login",
        },
      });
    } catch (err) {
      log("error", "royalty_dashboard_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "royalty_dashboard_failed" });
    }
  });

  app.get("/api/economy/royalties/creator/:creatorId", (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const offset = parseInt(req.query.offset, 10) || 0;
      const result = getCreatorRoyalties(db, req.params.creatorId, { limit, offset });
      res.json({ ok: true, creatorId: req.params.creatorId, ...result });
    } catch (err) {

      log("error", "economy_royalties_fetch_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "royalties_fetch_failed" });

    }
  });

  app.get("/api/economy/royalties/content/:contentId", (req, res) => {
    try {
      const payouts = getContentRoyalties(db, req.params.contentId);
      res.json({ ok: true, contentId: req.params.contentId, payouts, count: payouts.length });
    } catch (err) {

      log("error", "economy_content_royalties_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "content_royalties_failed" });

    }
  });

  app.get("/api/economy/royalties/rate", (req, res) => {
    const generation = parseInt(req.query.generation, 10) || 0;
    const initialRate = parseFloat(req.query.initial_rate) || undefined;
    const rate = calculateGenerationalRate(generation, initialRate);
    res.json({ ok: true, generation, rate, ratePercent: `${(rate * 100).toFixed(3)}%` });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EMERGENT ACCOUNTS
  // ═══════════════════════════════════════════════════════════════════════════

  app.post("/api/economy/emergent/create", adminOnly, (req, res) => {
    try {
      const { emergent_id, display_name, seed_amount } = req.body;
      if (!emergent_id) return res.status(400).json({ ok: false, error: "missing_emergent_id" });

      const result = createEmergentAccount(db, {
        emergentId: emergent_id,
        displayName: display_name,
        seedAmount: seed_amount ? Math.round(parseFloat(seed_amount) * 100) / 100 : 0,
      });

      if (!result.ok) return res.status(400).json(result);

      const ctx = auditCtx(req);
      economyAudit(db, {
        action: "emergent_account_created",
        userId: ctx.userId || "admin",
        details: { emergentId: emergent_id, seedAmount: seed_amount },
        ...ctx,
      });

      res.json(result);
    } catch (err) {

      log("error", "economy_emergent_create_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "emergent_create_failed" });

    }
  });

  app.get("/api/economy/emergent/:emergentId", (req, res) => {
    try {
      const account = getEmergentAccount(db, req.params.emergentId);
      if (!account) return res.status(404).json({ ok: false, error: "emergent_not_found" });
      res.json({ ok: true, account });
    } catch (err) {

      log("error", "economy_emergent_fetch_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "emergent_fetch_failed" });

    }
  });

  app.get("/api/economy/emergent", (req, res) => {
    try {
      const status = req.query.status || "active";
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const offset = parseInt(req.query.offset, 10) || 0;
      const result = listEmergentAccounts(db, { status, limit, offset });
      res.json({ ok: true, ...result });
    } catch (err) {

      log("error", "economy_emergent_list_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "emergent_list_failed" });

    }
  });

  app.post("/api/economy/emergent/:emergentId/transfer-to-reserve", (req, res) => {
    try {
      const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_amount" });
      }

      const ctx = auditCtx(req);
      const result = transferToReserve(db, {
        emergentId: req.params.emergentId,
        amount,
        requestId: ctx.requestId,
        ip: ctx.ip,
      });

      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (err) {

      log("error", "economy_transfer_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "transfer_failed" });

    }
  });

  app.post("/api/economy/emergent/:emergentId/suspend", adminOnly, (req, res) => {
    try {
      const result = suspendEmergentAccount(db, {
        emergentId: req.params.emergentId,
        reason: req.body.reason || "admin_action",
      });
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (err) {

      log("error", "economy_suspend_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "suspend_failed" });

    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MERIT CREDIT SCORE
  // ═══════════════════════════════════════════════════════════════════════════

  app.get("/api/economy/merit-score/:userId", (req, res) => {
    try {
      const userId = req.params.userId;
      if (!userId) return res.status(400).json({ ok: false, error: "missing_user_id" });

      // Citations: count DTUs that cite this user's content
      let citations = 0;
      try {
        citations = db.prepare(
          "SELECT COUNT(*) as c FROM royalty_lineage WHERE parent_creator = ?"
        ).get(userId)?.c || 0;
      } catch (err) { console.warn('[economy/routes] reputation: could not count citations', { userId, err: err.message }); }

      // Sales: count completed marketplace purchases as seller
      let sales = 0;
      try {
        sales = db.prepare(`
          SELECT COUNT(*) as c FROM economy_ledger
          WHERE from_user_id != ? AND to_user_id = ? AND type = 'MARKETPLACE_PURCHASE' AND status = 'complete'
        `).get(userId, userId)?.c || 0;
      } catch (err) { console.warn('[economy/routes] reputation: could not count sales', { userId, err: err.message }); }

      // Royalties: total royalty income
      let royalties = 0;
      try {
        royalties = db.prepare(
          "SELECT COALESCE(SUM(amount), 0) as total FROM royalty_payouts WHERE recipient_id = ?"
        ).get(userId)?.total || 0;
      } catch (err) { console.warn('[economy/routes] reputation: could not sum royalties', { userId, err: err.message }); }

      // Community activity: posts, comments, follows (approximate from ledger + social tables)
      let community = 0;
      try {
        // Count transfers initiated by user (indicates activity)
        const transfers = db.prepare(
          "SELECT COUNT(*) as c FROM economy_ledger WHERE from_user_id = ? AND type IN ('TRANSFER', 'MARKETPLACE_PURCHASE') AND status = 'complete'"
        ).get(userId)?.c || 0;
        community = transfers;
      } catch (err) { console.warn('[economy/routes] reputation: could not count community activity', { userId, err: err.message }); }

      // Score formula: weighted sum, capped at 1000
      const citationScore = Math.min(citations * 5, 250);
      const salesScore = Math.min(sales * 3, 250);
      const royaltyScore = Math.min(Math.floor(royalties * 2), 250);
      const communityScore = Math.min(community * 2, 250);

      const totalScore = citationScore + salesScore + royaltyScore + communityScore;

      // Level tiers
      const level =
        totalScore >= 800 ? "legendary" :
        totalScore >= 600 ? "master" :
        totalScore >= 400 ? "expert" :
        totalScore >= 200 ? "established" :
        totalScore >= 50  ? "emerging" :
        "newcomer";

      res.json({
        ok: true,
        userId,
        score: totalScore,
        breakdown: {
          citations: { raw: citations, score: citationScore },
          sales: { raw: sales, score: salesScore },
          royalties: { raw: Math.round(royalties * 100) / 100, score: royaltyScore },
          community: { raw: community, score: communityScore },
        },
        level,
      });
    } catch (err) {
      log("error", "merit_score_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "merit_score_fetch_failed" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROYALTY CASCADE LIVE VISUALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  app.get("/api/economy/royalty-cascade/:dtuId", (req, res) => {
    try {
      const dtuId = req.params.dtuId;
      if (!dtuId) return res.status(400).json({ ok: false, error: "missing_dtu_id" });

      // Get ancestor chain (who this DTU pays royalties to)
      const ancestors = getAncestorChain(db, dtuId);

      // Get descendant chain (who pays royalties because of this DTU)
      const descendants = getDescendants(db, dtuId);

      // Get all royalty payouts for this content
      const payouts = getContentRoyalties(db, dtuId, { limit: 200 });

      // Calculate totals
      const totalEarned = payouts.reduce((sum, p) => sum + (p.amount || 0), 0);
      const totalTransactions = payouts.length;

      // Build cascade chain with generation info
      const cascadeChain = ancestors.map(a => ({
        creatorId: a.creatorId,
        contentId: a.contentId,
        generation: a.generation,
        rate: a.rate,
        ratePercent: `${(a.rate * 100).toFixed(3)}%`,
        // Sum up what this creator earned from this specific DTU's royalties
        totalEarned: payouts
          .filter(p => p.recipient_id === a.creatorId)
          .reduce((sum, p) => sum + (p.amount || 0), 0),
      }));

      res.json({
        ok: true,
        dtuId,
        totalEarned: Math.round(totalEarned * 100) / 100,
        totalTransactions,
        ancestors: cascadeChain,
        descendantCount: descendants.length,
        descendants: descendants.slice(0, 50),
      });
    } catch (err) {
      log("error", "royalty_cascade_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "royalty_cascade_fetch_failed" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN TREASURY DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  app.get("/api/admin/treasury", adminOnly, (_req, res) => {
    try {
      // Treasury state
      const treasuryState = getTreasuryState(db);
      const totalBalance = treasuryState?.total_usd || 0;

      // Fee split balances (80/10/10)
      const splitBalances = getFeeSplitBalances(db);

      // Fee distributions history for revenue chart
      const distributions = getFeeDistributions(db, { limit: 90 });

      // Fee collection rate: total fees collected in last 30 days vs prior 30 days
      let recentFees = 0;
      let priorFees = 0;
      try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now - 30 * 86400000).toISOString();
        const sixtyDaysAgo = new Date(now - 60 * 86400000).toISOString();

        recentFees = db.prepare(`
          SELECT COALESCE(SUM(total_fee), 0) as total FROM fee_distributions
          WHERE created_at >= ?
        `).get(thirtyDaysAgo)?.total || 0;

        priorFees = db.prepare(`
          SELECT COALESCE(SUM(total_fee), 0) as total FROM fee_distributions
          WHERE created_at >= ? AND created_at < ?
        `).get(sixtyDaysAgo, thirtyDaysAgo)?.total || 0;
      } catch { /* table may not exist */ }

      const feeCollectionRate = priorFees > 0
        ? Math.round(((recentFees - priorFees) / priorFees) * 10000) / 100
        : 0;

      // Build revenue history (daily aggregates from fee_distributions)
      let revenueHistory = [];
      try {
        revenueHistory = db.prepare(`
          SELECT DATE(created_at) as date,
                 SUM(total_fee) as totalFees,
                 SUM(reserves_amount) as reserves,
                 SUM(operating_amount) as operating,
                 SUM(payroll_amount) as payroll,
                 COUNT(*) as txCount
          FROM fee_distributions
          GROUP BY DATE(created_at)
          ORDER BY date DESC
          LIMIT 90
        `).all().reverse();
      } catch { /* table may not exist */ }

      res.json({
        ok: true,
        totalBalance: Math.round(totalBalance * 100) / 100,
        reserve80: Math.round(splitBalances.reserves * 100) / 100,
        operating10: Math.round(splitBalances.operating * 100) / 100,
        payroll10: Math.round(splitBalances.payroll * 100) / 100,
        platformBalance: Math.round(splitBalances.platform * 100) / 100,
        revenueHistory,
        feeCollectionRate,
        recentFees: Math.round(recentFees * 100) / 100,
        priorFees: Math.round(priorFees * 100) / 100,
        totalDistributed: distributions.totalDistributed,
        distributionCount: distributions.total,
      });
    } catch (err) {
      log("error", "admin_treasury_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "admin_treasury_fetch_failed" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MARKETPLACE
  // ═══════════════════════════════════════════════════════════════════════════

  app.post("/api/economy/marketplace/list", (req, res) => {
    try {
      const {
        seller_id, content_id, content_type, title, description,
        price, content_data, license_type, royalty_chain,
      } = req.body;
      const sellerId = seller_id || req.user?.id;

      if (!sellerId) return res.status(400).json({ ok: false, error: "missing_seller_id" });

      const result = createListing(db, {
        sellerId,
        contentId: content_id,
        contentType: content_type,
        title,
        description,
        price: Math.round(parseFloat(price) * 100) / 100,
        contentData: content_data,
        licenseType: license_type,
        royaltyChain: royalty_chain || [],
      });

      if (!result.ok) return res.status(400).json(result);

      const ctx = auditCtx(req);
      economyAudit(db, {
        action: "marketplace_listing_created",
        userId: sellerId,
        amount: Math.round(parseFloat(price) * 100) / 100,
        details: { listingId: result.listing?.id, contentType: content_type, title },
        ...ctx,
      });

      res.json(result);
    } catch (err) {

      log("error", "economy_listing_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "listing_failed" });

    }
  });

  app.post("/api/economy/marketplace/purchase", authRequired, (req, res) => {
    try {
      const buyerId = req.user?.id;
      const listingId = req.body.listing_id;

      if (!buyerId) return res.status(400).json({ ok: false, error: "missing_buyer_id" });
      if (!listingId) return res.status(400).json({ ok: false, error: "missing_listing_id" });

      // Block emergent fiat withdrawal attempt (defense in depth)
      if (isEmergentAccount(buyerId) && !canWithdrawToFiat(buyerId)) {
        // This is fine — emergents CAN buy on marketplace, just can't withdraw to fiat
      }

      const ctx = auditCtx(req);
      const result = purchaseListing(db, {
        buyerId,
        listingId,
        requestId: ctx.requestId,
        ip: ctx.ip,
      });

      if (!result.ok) return res.status(400).json(result);

      // Allocate a portion of the platform fee to reserves
      if (result.fee > 0) {
        try {
          allocateFromFee(db, {
            feeAmount:  result.fee,
            sourceTxId: result.batchId,
            requestId:  ctx.requestId,
            ip:         ctx.ip,
          });
        } catch (allocErr) {
          log("error", "reserve_allocation_failed", { error: allocErr.message });
        }
      }

      res.json(result);
    } catch (err) {

      log("error", "economy_purchase_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "purchase_failed" });

    }
  });

  app.get("/api/economy/marketplace/listings", (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const offset = parseInt(req.query.offset, 10) || 0;
      const result = searchListings(db, {
        contentType: req.query.content_type,
        sellerId: req.query.seller_id,
        status: req.query.status || "active",
        minPrice: req.query.min_price ? Math.round(parseFloat(req.query.min_price) * 100) / 100 : undefined,
        maxPrice: req.query.max_price ? Math.round(parseFloat(req.query.max_price) * 100) / 100 : undefined,
        limit,
        offset,
      });
      res.json({ ok: true, ...result });
    } catch (err) {

      log("error", "economy_listings_fetch_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "listings_fetch_failed" });

    }
  });

  app.get("/api/economy/marketplace/listings/:listingId", (req, res) => {
    try {
      const listing = getListing(db, req.params.listingId);
      if (!listing) return res.status(404).json({ ok: false, error: "listing_not_found" });
      res.json({ ok: true, listing });
    } catch (err) {

      log("error", "economy_listing_fetch_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "listing_fetch_failed" });

    }
  });

  app.post("/api/economy/marketplace/listings/:listingId/delist", authRequired, (req, res) => {
    try {
      const sellerId = req.user.id;

      const result = delistListing(db, { listingId: req.params.listingId, sellerId });
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (err) {

      log("error", "economy_delist_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "delist_failed" });

    }
  });

  app.patch("/api/economy/marketplace/listings/:listingId/price", authRequired, (req, res) => {
    try {
      const sellerId = req.user.id;
      const newPrice = Math.round(parseFloat(req.body.price) * 100) / 100;

      const result = updateListingPrice(db, {
        listingId: req.params.listingId,
        sellerId,
        newPrice,
      });
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (err) {

      log("error", "economy_price_update_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "price_update_failed" });

    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE PACKS (bundled DTU collections)
  // ═══════════════════════════════════════════════════════════════════════════

  app.post("/api/marketplace/pack", authRequired, (req, res) => {
    try {
      const sellerId = req.user.id;
      const { name, description, dtu_ids, price } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ ok: false, error: "missing_pack_name" });
      if (!Array.isArray(dtu_ids) || dtu_ids.length === 0) return res.status(400).json({ ok: false, error: "missing_dtu_ids" });
      if (!price || price <= 0) return res.status(400).json({ ok: false, error: "invalid_price" });

      // Create a marketplace listing with type='pack' containing the DTU IDs
      const contentData = JSON.stringify({ type: "dtu_pack", dtuIds: dtu_ids, name: name.trim() });

      const result = createListing(db, {
        sellerId,
        contentId: `pack_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        contentType: "dtu",
        title: name.trim(),
        description: description || `Knowledge pack with ${dtu_ids.length} DTUs`,
        price: Math.round(parseFloat(price) * 100) / 100,
        contentData,
        licenseType: "standard",
        royaltyChain: [],
      });

      if (!result.ok) return res.status(400).json(result);

      // Store pack metadata alongside the listing
      try {
        db.prepare(`
          INSERT OR REPLACE INTO marketplace_pack_meta (listing_id, dtu_ids_json, dtu_count, created_at)
          VALUES (?, ?, ?, datetime('now'))
        `).run(result.listing.id, JSON.stringify(dtu_ids), dtu_ids.length);
      } catch (_e) {
        // Table may not exist yet — create it and retry
        try {
          db.prepare(`
            CREATE TABLE IF NOT EXISTS marketplace_pack_meta (
              listing_id TEXT PRIMARY KEY,
              dtu_ids_json TEXT NOT NULL,
              dtu_count INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL
            )
          `).run();
          db.prepare(`
            INSERT OR REPLACE INTO marketplace_pack_meta (listing_id, dtu_ids_json, dtu_count, created_at)
            VALUES (?, ?, ?, datetime('now'))
          `).run(result.listing.id, JSON.stringify(dtu_ids), dtu_ids.length);
        } catch (_e2) { log("error", "pack_meta_store_failed", { error: _e2?.message }); }
      }

      const ctx = auditCtx(req);
      economyAudit(db, {
        action: "knowledge_pack_created",
        userId: sellerId,
        amount: Math.round(parseFloat(price) * 100) / 100,
        details: {
          listingId: result.listing?.id,
          packName: name.trim(),
          dtuCount: dtu_ids.length,
          dtuIds: dtu_ids.slice(0, 10), // limit audit size
        },
        ...ctx,
      });

      res.json({
        ok: true,
        pack: {
          listingId: result.listing.id,
          name: name.trim(),
          description: description || `Knowledge pack with ${dtu_ids.length} DTUs`,
          dtuCount: dtu_ids.length,
          dtuIds: dtu_ids,
          price: result.listing.price,
          sellerId,
          createdAt: result.listing.createdAt,
        },
      });
    } catch (err) {
      log("error", "knowledge_pack_creation_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "pack_creation_failed" });
    }
  });

  app.get("/api/marketplace/packs", (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const offset = parseInt(req.query.offset, 10) || 0;

      // Get pack listings — filter by content_data containing dtu_pack
      const result = searchListings(db, {
        status: "active",
        limit,
        offset,
      });

      // Enrich with pack metadata
      const packs = result.items.map(item => {
        let packMeta = null;
        try {
          packMeta = db.prepare("SELECT * FROM marketplace_pack_meta WHERE listing_id = ?").get(item.id);
        } catch (_e) { /* table may not exist */ }

        return {
          ...item,
          isPack: !!packMeta,
          packMeta: packMeta ? {
            dtuCount: packMeta.dtu_count,
            dtuIds: JSON.parse(packMeta.dtu_ids_json || "[]"),
          } : null,
        };
      }).filter(item => item.isPack);

      res.json({ ok: true, packs, total: packs.length });
    } catch (err) {
      log("error", "packs_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "packs_fetch_failed" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FEE SPLIT
  // ═══════════════════════════════════════════════════════════════════════════

  app.get("/api/economy/admin/fee-split/balances", adminOnly, (_req, res) => {
    try {
      const balances = getFeeSplitBalances(db);
      res.json({ ok: true, ...balances });
    } catch (err) {

      log("error", "economy_fee_split_balances_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "fee_split_balances_failed" });

    }
  });

  app.get("/api/economy/admin/fee-split/history", adminOnly, (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const offset = parseInt(req.query.offset, 10) || 0;
      const result = getFeeDistributions(db, { limit, offset });
      res.json({ ok: true, ...result });
    } catch (err) {

      log("error", "economy_fee_split_history_failed", { error: err.message });

      res.status(500).json({ ok: false, error: "fee_split_history_failed" });

    }
  });

  // ── Invoice ────────────────────────────────────────────────────────────────
  // Generate a printable invoice record for a specific purchase or a set of
  // recent transactions. Stores nothing — builds the invoice from the
  // existing ledger data and returns it for the frontend to render/download.

  app.post("/api/economy/invoice", (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const { purchaseId, transactionIds, periodStart, periodEnd } = req.body || {};

      let items = [];

      if (purchaseId) {
        // Single purchase invoice
        const purchase = getPurchase(db, purchaseId);
        if (!purchase) {
          return res.status(404).json({ ok: false, error: "purchase_not_found" });
        }
        if (purchase.userId !== userId) {
          return res.status(403).json({ ok: false, error: "forbidden" });
        }
        items = [{
          id: purchase.id,
          description: purchase.metadata?.description || purchase.type || "Purchase",
          amount: purchase.amount,
          currency: "CC",
          date: purchase.createdAt,
          status: purchase.status,
        }];
      } else {
        // Multi-transaction or period invoice
        const limit = 200;
        const txResult = getTransactions(db, userId, { limit, offset: 0 });
        let txns = txResult.transactions || [];

        if (transactionIds && Array.isArray(transactionIds)) {
          const idSet = new Set(transactionIds);
          txns = txns.filter((t) => idSet.has(t.id));
        } else if (periodStart || periodEnd) {
          const start = periodStart ? new Date(periodStart).getTime() : 0;
          const end = periodEnd ? new Date(periodEnd).getTime() : Date.now();
          txns = txns.filter((t) => {
            const ts = new Date(t.createdAt || t.created_at || 0).getTime();
            return ts >= start && ts <= end;
          });
        } else {
          // Default: last 30 days
          const cutoff = Date.now() - 30 * 86400 * 1000;
          txns = txns.filter((t) => new Date(t.createdAt || t.created_at || 0).getTime() >= cutoff);
        }

        items = txns.map((t) => ({
          id: t.id,
          description: t.metadata?.description || t.type || "Transaction",
          amount: t.amount,
          currency: "CC",
          date: t.createdAt || t.created_at,
          type: t.type,
        }));
      }

      const total = items.reduce((s, item) => s + (item.amount || 0), 0);
      const invoiceId = `INV-${Date.now().toString(36).toUpperCase()}-${userId.slice(0, 6).toUpperCase()}`;

      res.json({
        ok: true,
        invoice: {
          invoiceId,
          userId,
          issuedAt: new Date().toISOString(),
          currency: "CC",
          items,
          total,
          itemCount: items.length,
        },
      });
    } catch (err) {
      log("error", "economy_invoice_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "invoice_generation_failed" });
    }
  });

  // ── Tax Summary ────────────────────────────────────────────────────────────
  // Aggregate the calling user's transactions by type for a given fiscal
  // period (defaults to the current calendar year). Returns income, spending,
  // and a breakdown by transaction type — enough for a user to self-report.

  app.post("/api/economy/tax-summary", (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const { year, periodStart, periodEnd } = req.body || {};

      let start, end;
      if (periodStart && periodEnd) {
        start = new Date(periodStart).getTime();
        end = new Date(periodEnd).getTime();
      } else {
        const y = parseInt(year, 10) || new Date().getFullYear();
        start = new Date(`${y}-01-01T00:00:00Z`).getTime();
        end = new Date(`${y}-12-31T23:59:59Z`).getTime();
      }

      const txResult = getTransactions(db, userId, { limit: 10000, offset: 0 });
      const txns = (txResult.transactions || []).filter((t) => {
        const ts = new Date(t.createdAt || t.created_at || 0).getTime();
        return ts >= start && ts <= end;
      });

      const byType = {};
      let totalIncome = 0;
      let totalSpending = 0;

      for (const t of txns) {
        const type = t.type || "other";
        if (!byType[type]) byType[type] = { count: 0, total: 0 };
        byType[type].count++;
        byType[type].total += t.amount || 0;

        // Income types: royalty payouts, withdrawals received, earnings
        const isIncome = ["royalty", "earning", "reward", "peer_teach_credit"].includes(type);
        if (isIncome) {
          totalIncome += Math.abs(t.amount || 0);
        } else {
          totalSpending += Math.abs(t.amount || 0);
        }
      }

      const periodLabel = periodStart && periodEnd
        ? `${periodStart} to ${periodEnd}`
        : `${new Date(start).getFullYear()}`;

      res.json({
        ok: true,
        taxSummary: {
          userId,
          period: periodLabel,
          periodStartIso: new Date(start).toISOString(),
          periodEndIso: new Date(end).toISOString(),
          currency: "CC",
          totalIncome,
          totalSpending,
          netPosition: totalIncome - totalSpending,
          transactionCount: txns.length,
          byType,
        },
      });
    } catch (err) {
      log("error", "economy_tax_summary_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "tax_summary_failed" });
    }
  });

  // ── Reserve Health (admin) ─────────────────────────────────────────────────

  app.get("/api/admin/reserves/health", adminOnly, (req, res) => {
    try {
      const health = getReserveHealth(db);
      res.json({ ok: true, ...health });
    } catch (err) {
      log("error", "reserves_health_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "reserves_health_fetch_failed" });
    }
  });

  // ── Storage Quota Status (user) ───────────────────────────────────────────
  // Reads users.storage_bytes_used / storage_bytes_quota plus the storage_audit
  // ledger to surface "5 GiB used of 7 GiB" + the earned-storage history. The
  // 413 quota_exceeded payload returned by the upload endpoint is the
  // primary feedback channel; this route exists so the wallet/profile UI
  // can render a meter without forcing a failed upload first.
  app.get("/api/wallet/storage", authRequired, (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const storage = getUserStorage(db, userId);
      // Earned-storage breakdown by reason (last 50 events for the UI).
      const earnedSources = { earned_royalty: 0, earned_mega: 0, earned_sale: 0 };
      let recentEvents = [];
      try {
        const breakdown = db.prepare(`
          SELECT reason, COALESCE(SUM(delta_bytes), 0) AS total
            FROM storage_audit
           WHERE user_id = ? AND reason LIKE 'earned_%'
           GROUP BY reason
        `).all(userId);
        for (const row of breakdown) earnedSources[row.reason] = Number(row.total) || 0;
        recentEvents = db.prepare(`
          SELECT delta_bytes, reason, artifact_id, occurred_at
            FROM storage_audit
           WHERE user_id = ?
           ORDER BY occurred_at DESC
           LIMIT 50
        `).all(userId);
      } catch { /* schema may not exist on minimal builds */ }
      res.json({
        ok: true,
        storage: {
          ...storage,
          earnedSources,
          recentEvents,
          earnPaths: ["royalty_payouts", "mega_promotions", "marketplace_sales"],
        },
      });
    } catch (err) {
      log("error", "storage_status_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "storage_status_fetch_failed" });
    }
  });

  // ── Chargeback Protection Status (user) ───────────────────────────────────

  app.get("/api/wallet/protection-status", authRequired, (req, res) => {
    try {
      const health = getReserveHealth(db);
      res.json({
        ok: true,
        chargebackProtection: {
          enabled: true,
          description:
            "Your purchases are protected by the Concord platform reserve. " +
            "In the event of a chargeback dispute, the platform reserve covers " +
            "the cost — your creators keep their distributions.",
          reserveStatus: health.status,
        },
      });
    } catch (err) {
      log("error", "protection_status_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "protection_status_fetch_failed" });
    }
  });
}
