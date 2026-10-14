/**
 * Concord Dispute Resolution Routes
 *
 * Transaction dispute handling: buyer reports, seller responds,
 * admin resolves. Auto-escalation for small amounts.
 *
 * Concord facilitates. Concord does not judge.
 */

import express from "express";
import { openDispute, updateDisputeStatus, getDispute, getDisputes } from "../economy/legal-liability.js";
import { executeTransfer } from "../economy/transfer.js";

// ── Constants ────────────────────────────────────────────────────────────────

const DISPUTE_TYPES = ["not_as_described", "unauthorized_purchase", "non_delivery", "other"];
const AUTO_REFUND_THRESHOLD_CC = 10;
const SELLER_RESPONSE_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Present a dispute for clients: user-facing `dispute_type` is the filed type
 * (metadata.original_type). The legal-liability bucket stays on `legal_bucket`.
 */
function presentDispute(db, dispute, viewerId = null) {
  if (!dispute) return dispute;
  let meta = null;
  try {
    meta = db.prepare("SELECT * FROM dispute_metadata WHERE dispute_id = ?").get(dispute.id);
  } catch (_e) { /* table may not exist */ }
  const filedType = meta?.original_type || dispute.dispute_type;
  // Opaque metadata for clients — no raw buyer/seller uuids on the wire.
  const safeMeta = meta
    ? {
        amount: meta.amount,
        transaction_id: meta.transaction_id,
        original_type: meta.original_type,
        seller_response_deadline: meta.seller_response_deadline,
      }
    : null;
  const {
    reporter_id: _r,
    reported_user_id: _ru,
    ...rest
  } = dispute;
  return {
    ...rest,
    legal_bucket: dispute.dispute_type,
    dispute_type: filedType,
    metadata: safeMeta,
    isReporter: viewerId ? dispute.reporter_id === viewerId : undefined,
    isReported: viewerId ? dispute.reported_user_id === viewerId : undefined,
  };
}

/**
 * Create the dispute router.
 * @param {{ db: object, requireAuth: function, adminOnly: function }} deps
 */
export default function createDisputeRouter({ db, requireAuth, adminOnly }) {
  const router = express.Router();

  // All dispute routes require authentication
  if (typeof requireAuth === "function") {
    router.use(requireAuth());
  }

  // Fail-closed admin gate for the two admin-only routes below. Prefer the
  // injected middleware (server.js wires in economy/guards.js#adminOnly —
  // role admin/owner/founder, wildcard/economy:admin scope, or AUTH_MODE=public)
  // instead of a hand-rolled duplicate; if the caller didn't provide one,
  // deny rather than silently falling open.
  const requireAdminGate = typeof adminOnly === "function"
    ? adminOnly
    : (_req, res) => res.status(403).json({ ok: false, error: "forbidden" });

  // ── POST /create — Buyer creates a dispute ──────────────────────────────

  router.post("/create", (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const { type, evidence } = req.body || {};
      const transactionId = String(req.body?.transactionId ?? "").trim();
      const statement = String(req.body?.statement ?? "").trim();

      if (!transactionId || !type || !statement) {
        return res.status(400).json({
          ok: false,
          error: "missing_required_fields",
          required: ["transactionId", "type", "statement"],
        });
      }

      if (!DISPUTE_TYPES.includes(type)) {
        return res.status(400).json({
          ok: false,
          error: "invalid_dispute_type",
          valid: DISPUTE_TYPES,
        });
      }

      // Look up the transaction to find the seller
      const transaction = db.prepare(
        "SELECT * FROM economy_ledger WHERE id = ? OR ref_id = ? LIMIT 1"
      ).get(transactionId, transactionId);

      // Determine reported user (seller) from transaction context
      const reportedUserId = transaction?.to_user || transaction?.user_id || null;
      const amount = transaction ? Math.abs(Number(transaction.amount) || 0) : 0;

      // Map our dispute type to the legal-liability dispute types
      const disputeTypeMap = {
        not_as_described: "quality",
        unauthorized_purchase: "fraudulent_listing",
        non_delivery: "quality",
        other: "quality",
      };

      const result = openDispute(db, {
        reporterId: userId,
        disputeType: disputeTypeMap[type] || "quality",
        reportedContentId: transactionId,
        reportedUserId,
        description: statement,
        evidence: evidence ? (Array.isArray(evidence) ? evidence : [evidence]) : [],
      });

      if (!result.ok) {
        return res.status(400).json(result);
      }

      // Store additional dispute metadata
      try {
        db.prepare(`
          INSERT OR IGNORE INTO dispute_metadata (dispute_id, transaction_id, original_type, amount, buyer_id, seller_id, seller_response_deadline)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          result.disputeId,
          transactionId,
          type,
          amount,
          userId,
          reportedUserId,
          new Date(Date.now() + SELLER_RESPONSE_WINDOW_MS).toISOString(),
        );
      } catch (_e) {
        // Metadata table may not exist yet — dispute still created successfully
      }

      // Auto-escalation: if amount < threshold, schedule auto-refund
      const autoRefundEligible = amount > 0 && amount < AUTO_REFUND_THRESHOLD_CC;

      return res.status(201).json({
        ok: true,
        disputeId: result.disputeId,
        status: "open",
        type,
        transactionId,
        amount,
        autoRefundEligible,
        sellerResponseDeadline: new Date(Date.now() + SELLER_RESPONSE_WINDOW_MS).toISOString(),
        reviewTime: result.reviewTime,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "create_dispute_failed" });
    }
  });

  // ── GET /my — User's disputes (buyer or seller) ────────────────────────

  router.get("/my", (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      // Get all disputes, then filter by user involvement
      const allDisputes = getDisputes(db, { limit: 200 });
      const userDisputes = allDisputes.filter(
        (d) => d.reporter_id === userId || d.reported_user_id === userId
      );

      // Enrich with role info + filed type (not the legal bucket)
      const enriched = userDisputes.map((d) => {
        const presented = presentDispute(db, d, userId);
        return {
          ...presented,
          userRole: d.reporter_id === userId ? "buyer" : "seller",
          canRespond: d.reported_user_id === userId && d.status === "open",
        };
      });

      return res.json({ ok: true, disputes: enriched, total: enriched.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "fetch_disputes_failed" });
    }
  });

  // ── GET /queue — Admin: all open/escalated disputes ────────────────────

  router.get("/queue", requireAdminGate, (req, res) => {
    try {
      const openDisputes = getDisputes(db, { status: "open" });
      const escalated = getDisputes(db, { status: "escalated" });
      const underReview = getDisputes(db, { status: "under_review" });
      const mediation = getDisputes(db, { status: "mediation" });

      const queue = [...openDisputes, ...escalated, ...underReview, ...mediation]
        .sort((a, b) => {
          // Escalated first, then by opened_at
          if (a.status === "escalated" && b.status !== "escalated") return -1;
          if (b.status === "escalated" && a.status !== "escalated") return 1;
          return (b.opened_at || "").localeCompare(a.opened_at || "");
        });

      return res.json({ ok: true, queue, total: queue.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "fetch_queue_failed" });
    }
  });

  // ── PUT /:id/seller-respond — Seller responds to dispute ──────────────

  router.put("/:id/seller-respond", (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const dispute = getDispute(db, req.params.id);
      if (!dispute) {
        return res.status(404).json({ ok: false, error: "dispute_not_found" });
      }

      // Only the reported user (seller) can respond
      if (dispute.reported_user_id !== userId) {
        return res.status(403).json({ ok: false, error: "not_seller", message: "Only the reported party can respond" });
      }

      if (dispute.status !== "open") {
        return res.status(400).json({ ok: false, error: "invalid_status", message: "Dispute is no longer open for seller response" });
      }

      const { statement, evidence, offerRefund } = req.body || {};

      if (!statement) {
        return res.status(400).json({ ok: false, error: "missing_statement" });
      }

      // If seller offers refund, process it immediately
      if (offerRefund) {
        // Look up transaction amount for refund
        let refundAmount = 0;
        try {
          const meta = db.prepare("SELECT amount, buyer_id FROM dispute_metadata WHERE dispute_id = ?").get(req.params.id);
          if (meta) {
            refundAmount = meta.amount;
            const buyerId = meta.buyer_id;
            if (refundAmount > 0 && buyerId) {
              const refundResult = executeTransfer(db, {
                from: userId,
                to: buyerId,
                amount: refundAmount,
                type: "REFUND",
                metadata: { disputeId: req.params.id, reason: "seller_voluntary_refund" },
                refId: `refund_${req.params.id}`,
              });
              if (!refundResult.ok && !refundResult.idempotent) {
                return res.status(400).json({ ok: false, error: "refund_failed", details: refundResult.error });
              }
            }
          }
        } catch (_e) {
          // Metadata table might not exist — continue without refund
        }

        // Resolve the dispute
        const resolveResult = updateDisputeStatus(db, req.params.id, {
          status: "resolved",
          resolution: JSON.stringify({
            type: "seller_refund",
            sellerStatement: statement,
            sellerEvidence: evidence || [],
            refundAmount,
            resolvedAt: nowISO(),
          }),
        });

        return res.json({
          ok: true,
          disputeId: req.params.id,
          status: "resolved",
          resolution: "seller_refund",
          refundAmount,
          ...resolveResult,
        });
      }

      // Seller contests — escalate to review
      const updateResult = updateDisputeStatus(db, req.params.id, {
        status: "under_review",
        resolution: JSON.stringify({
          sellerStatement: statement,
          sellerEvidence: evidence || [],
          respondedAt: nowISO(),
        }),
      });

      return res.json({
        ok: true,
        disputeId: req.params.id,
        status: "under_review",
        message: "Response recorded. Dispute escalated for admin review.",
        ...updateResult,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "seller_respond_failed" });
    }
  });

  // ── PUT /:id/resolve — Admin resolves dispute ─────────────────────────

  router.put("/:id/resolve", requireAdminGate, (req, res) => {
    try {
      const dispute = getDispute(db, req.params.id);
      if (!dispute) {
        return res.status(404).json({ ok: false, error: "dispute_not_found" });
      }

      if (dispute.status === "resolved" || dispute.status === "dismissed") {
        return res.status(400).json({ ok: false, error: "already_resolved" });
      }

      const { resolution, notes, partialPercent } = req.body || {};

      if (!resolution || !["refund", "no_refund", "partial_refund"].includes(resolution)) {
        return res.status(400).json({
          ok: false,
          error: "invalid_resolution",
          valid: ["refund", "no_refund", "partial_refund"],
        });
      }

      let refundAmount = 0;

      // Process refund if applicable
      if (resolution === "refund" || resolution === "partial_refund") {
        try {
          const meta = db.prepare("SELECT amount, buyer_id, seller_id FROM dispute_metadata WHERE dispute_id = ?").get(req.params.id);
          if (meta && meta.amount > 0 && meta.buyer_id && meta.seller_id) {
            refundAmount = resolution === "partial_refund"
              ? Math.round(meta.amount * (Math.min(100, Math.max(1, partialPercent || 50)) / 100) * 100) / 100
              : meta.amount;

            const refundResult = executeTransfer(db, {
              from: meta.seller_id,
              to: meta.buyer_id,
              amount: refundAmount,
              type: "REFUND",
              metadata: {
                disputeId: req.params.id,
                reason: `admin_${resolution}`,
                adminNotes: notes,
              },
              refId: `admin_refund_${req.params.id}`,
            });

            if (!refundResult.ok && !refundResult.idempotent) {
              return res.status(400).json({ ok: false, error: "refund_failed", details: refundResult.error });
            }
          }
        } catch (_e) {
          // Metadata table might not exist
        }
      }

      const updateResult = updateDisputeStatus(db, req.params.id, {
        status: "resolved",
        resolution: JSON.stringify({
          type: resolution,
          notes: notes || null,
          partialPercent: resolution === "partial_refund" ? partialPercent : null,
          refundAmount,
          resolvedBy: req.user?.id,
          resolvedAt: nowISO(),
        }),
      });

      return res.json({
        ok: true,
        disputeId: req.params.id,
        status: "resolved",
        resolution,
        refundAmount,
        notes,
        ...updateResult,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "resolve_failed" });
    }
  });

  // ── GET /:id — Single dispute detail ──────────────────────────────────

  router.get("/:id", (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const dispute = getDispute(db, req.params.id);
      if (!dispute) {
        return res.status(404).json({ ok: false, error: "dispute_not_found" });
      }

      // Only involved parties or admins can view
      const isInvolved = dispute.reporter_id === userId || dispute.reported_user_id === userId;
      const isAdmin = req.user?.role === "admin" || req.user?.role === "owner" || req.user?.role === "founder";
      if (!isInvolved && !isAdmin) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }

      const presented = presentDispute(db, dispute, userId);
      return res.json({
        ok: true,
        dispute: {
          ...presented,
          userRole: dispute.reporter_id === userId ? "buyer" : dispute.reported_user_id === userId ? "seller" : "admin",
        },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "fetch_dispute_failed" });
    }
  });

  // ── Auto-escalation check (called on GET /my and /queue) ──────────────

  function checkAutoEscalation() {
    try {
      const openDisputes = getDisputes(db, { status: "open" });
      // @sql-loop-ok: iterates open disputes (bounded by active disputes, typically < 10)
      for (const dispute of openDisputes) {
        const openedAt = new Date(dispute.opened_at).getTime();
        const elapsed = Date.now() - openedAt;

        if (elapsed > SELLER_RESPONSE_WINDOW_MS) {
          // Check if small amount for auto-refund
          let meta = null;
          try {
            meta = db.prepare("SELECT * FROM dispute_metadata WHERE dispute_id = ?").get(dispute.id);
          } catch (_e) { /* table may not exist */ }

          if (meta && meta.amount > 0 && meta.amount < AUTO_REFUND_THRESHOLD_CC) {
            // Auto-refund small disputes
            try {
              executeTransfer(db, {
                from: meta.seller_id,
                to: meta.buyer_id,
                amount: meta.amount,
                type: "REFUND",
                metadata: { disputeId: dispute.id, reason: "auto_refund_no_seller_response" },
                refId: `auto_refund_${dispute.id}`,
              });
            } catch (_e) { /* best effort */ }

            updateDisputeStatus(db, dispute.id, {
              status: "resolved",
              resolution: JSON.stringify({
                type: "auto_refund",
                reason: "seller_no_response_48h",
                amount: meta.amount,
                resolvedAt: nowISO(),
              }),
            });
          } else {
            // Escalate larger disputes
            updateDisputeStatus(db, dispute.id, {
              status: "escalated",
              resolution: JSON.stringify({
                reason: "seller_no_response_48h",
                escalatedAt: nowISO(),
              }),
            });
          }
        }
      }
    } catch (_e) {
      // Best-effort auto-escalation
    }
  }

  // Run auto-escalation check periodically (every 15 minutes).
  // unref so unit tests that mount the router can exit cleanly.
  const escalationInterval = setInterval(checkAutoEscalation, 15 * 60 * 1000);
  if (typeof escalationInterval.unref === "function") escalationInterval.unref();

  // Also run on startup
  try { checkAutoEscalation(); } catch (_e) { /* ignore */ }

  // Cleanup on process exit
  if (typeof process !== "undefined") {
    process.on("exit", () => clearInterval(escalationInterval));
  }

  return router;
}

// The hand-rolled `adminCheckSync` that used to live here is gone: both of its
// call sites now use the injected `adminOnly` middleware (economy/guards.js),
// which server.js already passes in. It duplicated that guard's role/scope
// logic exactly, so keeping a second copy only created room for the two to
// drift apart — precisely the risk you don't want on an authorization check.
