// economy/creator-economy-routes.js
// Routes for: License tiers, commissions, global scope gates, rights enforcement.
// Mounted alongside the main economy routes in server.js.

import express from "express";
import { adminOnly } from "./guards.js";

/**
 * Register creator economy routes.
 * @param {import('express').Express} app
 * @param {import('better-sqlite3').Database} db
 * @param {object} opts
 */
export function registerCreatorEconomyRoutes(app, db, opts = {}) {
  const log = opts.structuredLog || ((level, event, data) => console[level === "error" ? "error" : "log"](`[creator-economy] ${event}`, data));

  // Lazy-load modules to avoid circular deps and let agents finish writing files
  let _licenseTiers, _commissions, _globalGates, _rights;

  async function licenseTiers() {
    if (!_licenseTiers) _licenseTiers = await import("./license-tiers.js");
    return _licenseTiers;
  }
  async function commissions() {
    if (!_commissions) _commissions = await import("./commission-service.js");
    return _commissions;
  }
  async function globalGates() {
    if (!_globalGates) _globalGates = await import("./global-gates.js");
    return _globalGates;
  }
  async function rights() {
    if (!_rights) _rights = await import("./rights-enforcement.js");
    return _rights;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LICENSE TIERS
  // ═══════════════════════════════════════════════════════════════════════════

  // Get available license tiers for a content type
  app.get("/api/economy/license-tiers/:contentType", async (req, res) => {
    try {
      const mod = await licenseTiers();
      const tiers = mod.getAvailableTiers(req.params.contentType);
      if (!tiers) return res.status(404).json({ ok: false, error: "unknown_content_type" });
      res.json({ ok: true, contentType: req.params.contentType, tiers });
    } catch (err) {
      log("error", "license_tiers_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Get default pricing for a content type
  app.get("/api/economy/license-tiers/:contentType/defaults", async (req, res) => {
    try {
      const mod = await licenseTiers();
      const pricing = mod.getDefaultPricing(req.params.contentType);
      res.json({ ok: true, pricing });
    } catch (err) {
      log("error", "default_pricing_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Validate creator pricing
  app.post("/api/economy/license-tiers/:contentType/validate", async (req, res) => {
    try {
      const mod = await licenseTiers();
      const result = mod.validatePricing(req.params.contentType, req.body.pricing);
      res.json({ ok: true, ...result });
    } catch (err) {
      log("error", "pricing_validation_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Calculate upgrade price
  app.get("/api/economy/license-tiers/:contentType/upgrade", async (req, res) => {
    try {
      const mod = await licenseTiers();
      const { currentTier, targetTier } = req.query;
      const pricing = req.query.pricing ? JSON.parse(req.query.pricing) : undefined;
      const price = mod.calculateUpgradePrice(currentTier, targetTier, req.params.contentType, pricing);
      res.json({ ok: true, upgradePrice: price });
    } catch (err) {
      log("error", "upgrade_price_calc_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Get distribution modes
  app.get("/api/economy/distribution-modes", async (_req, res) => {
    try {
      const mod = await licenseTiers();
      res.json({ ok: true, modes: mod.DISTRIBUTION_MODES });
    } catch (err) {
      log("error", "distribution_modes_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Get preview policy for a mode+content type
  app.get("/api/economy/distribution-modes/:modeId/preview/:contentType", async (req, res) => {
    try {
      const mod = await licenseTiers();
      const policy = mod.getPreviewPolicy(req.params.modeId, req.params.contentType);
      res.json({ ok: true, policy });
    } catch (err) {
      log("error", "preview_policy_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RIGHTS ENFORCEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  // Check access for a DTU
  app.get("/api/economy/rights/check/:dtuId", async (req, res) => {
    try {
      const mod = await rights();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const { type: contentType, action } = req.query;
      const result = mod.checkAccess(db, {
        userId,
        dtuId: req.params.dtuId,
        contentType: contentType || "music",
        action: action || "stream",
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      log("error", "rights_check_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Get user's licenses for a DTU
  app.get("/api/economy/rights/licenses/:dtuId", async (req, res) => {
    try {
      const mod = await rights();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const licenses = mod.getUserLicenses(db, userId, req.params.dtuId);
      const highest = mod.getHighestTier(db, userId, req.params.dtuId, req.query.type || "music");
      res.json({ ok: true, licenses, highestTier: highest });
    } catch (err) {
      log("error", "licenses_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Get all user's licenses
  app.get("/api/economy/rights/my-licenses", async (req, res) => {
    try {
      const mod = await rights();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const offset = parseInt(req.query.offset) || 0;
      const licenses = mod.getUserAllLicenses(db, userId, { limit, offset });
      res.json({ ok: true, licenses });
    } catch (err) {
      log("error", "my_licenses_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Purchase a license tier for a DTU (marketplace integration)
  app.post("/api/economy/rights/purchase", async (req, res) => {
    try {
      const mod = await rights();
      const ltMod = await licenseTiers();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const { dtuId, contentType, licenseTier } = req.body;
      if (!dtuId || !contentType || !licenseTier) {
        return res.status(400).json({ ok: false, error: "missing_fields" });
      }

      // Check if user already has this or higher tier
      const currentHighest = mod.getHighestTier(db, userId, dtuId, contentType);
      const tier = ltMod.getTier(contentType, licenseTier);
      if (!tier) return res.status(400).json({ ok: false, error: "invalid_tier" });

      // Get DTU pricing
      const dtuRow = db.prepare("SELECT data FROM dtu_store WHERE id = ?").get(dtuId);
      if (!dtuRow) return res.status(404).json({ ok: false, error: "dtu_not_found" });

      const dtu = JSON.parse(dtuRow.data);
      const pricing = dtu.meta?.pricing || {};
      const price = pricing[licenseTier] ?? tier.defaultPrice;

      // Calculate upgrade pricing if user already has a lower tier
      let finalPrice = price;
      if (currentHighest) {
        finalPrice = ltMod.calculateUpgradePrice(currentHighest, licenseTier, contentType, pricing);
        if (finalPrice <= 0) {
          return res.json({ ok: true, message: "already_licensed", tier: currentHighest });
        }
      }

      // Execute purchase via marketplace transfer system
      const { executeMarketplacePurchase } = await import("./transfer.js");
      const sellerId = dtu.creator_id || dtu.creatorId || dtu.meta?.creatorId;
      if (!sellerId) return res.status(400).json({ ok: false, error: "no_seller" });

      const txResult = executeMarketplacePurchase(db, {
        buyerId: userId,
        sellerId,
        amount: finalPrice,
        listingId: dtuId,
        contentType,
      });

      if (!txResult.ok) return res.status(400).json(txResult);

      // Grant the license
      const licResult = mod.grantLicense(db, {
        dtuId, userId, contentType, licenseTier,
        txId: txResult.transactions?.[0]?.id,
      });

      // Distribute royalties if derivative
      if (dtu.meta?.forkedFrom || dtu.meta?.parentDtuId) {
        try {
          const { distributeRoyalties } = await import("./royalty-cascade.js");
          distributeRoyalties(db, dtuId, finalPrice);
        } catch { /* royalty distribution is best-effort */ }
      }

      log("info", "license_purchased", { userId, dtuId, tier: licenseTier, price: finalPrice });
      res.json({ ok: true, license: licResult, price: finalPrice, upgrade: !!currentHighest });
    } catch (err) {
      log("error", "license_purchase_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "purchase_failed" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // COMMISSIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // Get creator's commission types
  app.get("/api/economy/commissions/types/:creatorId", async (req, res) => {
    try {
      const mod = await commissions();
      const types = mod.getCreatorCommissions(db, req.params.creatorId);
      res.json({ ok: true, types });
    } catch (err) {
      log("error", "commission_types_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Create commission type (creator)
  app.post("/api/economy/commissions/types", async (req, res) => {
    try {
      const mod = await commissions();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const result = mod.createCommissionType(db, { ...req.body, creatorId: userId });
      res.json(result);
    } catch (err) {
      log("error", "commission_type_create_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Update commission type
  app.put("/api/economy/commissions/types/:id", async (req, res) => {
    try {
      const mod = await commissions();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const result = mod.updateCommissionType(db, { ...req.body, id: req.params.id, creatorId: userId });
      res.json(result);
    } catch (err) {
      log("error", "commission_type_update_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Request a commission
  app.post("/api/economy/commissions/request", async (req, res) => {
    try {
      const mod = await commissions();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const result = mod.requestCommission(db, { ...req.body, clientId: userId });
      res.json(result);
    } catch (err) {
      log("error", "commission_request_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Respond to commission (creator: accept/decline/counter)
  app.post("/api/economy/commissions/:requestId/respond", async (req, res) => {
    try {
      const mod = await commissions();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const result = mod.respondToCommission(db, {
        requestId: req.params.requestId,
        creatorId: userId,
        ...req.body,
      });
      res.json(result);
    } catch (err) {
      log("error", "commission_respond_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Client responds to counter offer
  app.post("/api/economy/commissions/:requestId/client-respond", async (req, res) => {
    try {
      const mod = await commissions();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const result = mod.clientRespondToCounter(db, {
        requestId: req.params.requestId,
        clientId: userId,
        ...req.body,
      });
      res.json(result);
    } catch (err) {
      log("error", "commission_client_respond_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Deliver commission (creator)
  app.post("/api/economy/commissions/:requestId/deliver", async (req, res) => {
    try {
      const mod = await commissions();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const result = mod.deliverCommission(db, {
        requestId: req.params.requestId,
        creatorId: userId,
        dtuId: req.body.dtuId,
      });
      res.json(result);
    } catch (err) {
      log("error", "commission_deliver_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Approve delivery (client)
  app.post("/api/economy/commissions/:requestId/approve", async (req, res) => {
    try {
      const mod = await commissions();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const result = mod.approveDelivery(db, {
        requestId: req.params.requestId,
        clientId: userId,
      });
      res.json(result);
    } catch (err) {
      log("error", "commission_approve_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Dispute delivery (client)
  app.post("/api/economy/commissions/:requestId/dispute", async (req, res) => {
    try {
      const mod = await commissions();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const result = mod.disputeDelivery(db, {
        requestId: req.params.requestId,
        clientId: userId,
        reason: req.body.reason,
      });
      res.json(result);
    } catch (err) {
      log("error", "commission_dispute_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Resolve dispute (admin)
  app.post("/api/economy/commissions/:requestId/resolve", adminOnly, async (req, res) => {
    try {
      const mod = await commissions();
      const result = mod.resolveDispute(db, {
        requestId: req.params.requestId,
        resolution: req.body.resolution,
        resolvedBy: req.user?.id,
      });
      res.json(result);
    } catch (err) {
      log("error", "commission_resolve_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Get user's commissions (as client or creator)
  app.get("/api/economy/commissions/my/:role", async (req, res) => {
    try {
      const mod = await commissions();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const result = mod.getUserCommissions(db, userId, req.params.role);
      res.json({ ok: true, commissions: result });
    } catch (err) {
      log("error", "user_commissions_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Get commission request details
  app.get("/api/economy/commissions/:requestId", async (req, res) => {
    try {
      const mod = await commissions();
      const result = mod.getCommissionRequest(db, req.params.requestId);
      if (!result) return res.status(404).json({ ok: false, error: "not_found" });
      res.json({ ok: true, commission: result });
    } catch (err) {
      log("error", "commission_fetch_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Add message to commission thread
  app.post("/api/economy/commissions/:requestId/message", async (req, res) => {
    try {
      const mod = await commissions();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const result = mod.addCommissionMessage(db, {
        requestId: req.params.requestId,
        senderId: userId,
        content: req.body.content,
      });
      res.json(result);
    } catch (err) {
      log("error", "commission_message_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GLOBAL SCOPE GATES
  // ═══════════════════════════════════════════════════════════════════════════

  // Submit DTU for global promotion
  app.post("/api/economy/global/submit", async (req, res) => {
    try {
      const mod = await globalGates();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const result = mod.submitForGlobal(db, { dtuId: req.body.dtuId, submitterId: userId });
      res.json(result);
    } catch (err) {
      log("error", "global_submit_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Review a global submission (council member)
  app.post("/api/economy/global/review/:submissionId", async (req, res) => {
    try {
      const mod = await globalGates();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const result = mod.reviewSubmission(db, {
        submissionId: req.params.submissionId,
        reviewerId: userId,
        reviewerType: req.body.reviewerType || "council",
        action: req.body.action,
        comment: req.body.comment,
      });
      res.json(result);
    } catch (err) {
      log("error", "global_review_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Finalize a submission (check if enough reviews)
  app.post("/api/economy/global/finalize/:submissionId", async (req, res) => {
    try {
      const mod = await globalGates();
      const result = mod.finalizeSubmission(db, req.params.submissionId);
      res.json(result);
    } catch (err) {
      log("error", "global_finalize_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Challenge a global DTU
  app.post("/api/economy/global/challenge", async (req, res) => {
    try {
      const mod = await globalGates();
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const result = mod.challengeGlobalDTU(db, {
        dtuId: req.body.dtuId,
        challengerId: userId,
        evidence: req.body.evidence,
      });
      res.json(result);
    } catch (err) {
      log("error", "global_challenge_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Resolve a challenge (admin)
  app.post("/api/economy/global/challenge/:challengeId/resolve", adminOnly, async (req, res) => {
    try {
      const mod = await globalGates();
      const result = mod.resolveChallenge(db, {
        challengeId: req.params.challengeId,
        resolution: req.body.resolution,
        resolvedBy: req.user?.id,
      });
      res.json(result);
    } catch (err) {
      log("error", "global_challenge_resolve_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Global feed (recently promoted, most-cited, challenges)
  app.get("/api/economy/global/feed", async (req, res) => {
    try {
      const mod = await globalGates();
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const offset = parseInt(req.query.offset) || 0;
      const feed = mod.getGlobalFeed(db, { limit, offset });
      res.json({ ok: true, ...feed });
    } catch (err) {
      log("error", "global_feed_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Global stats
  app.get("/api/economy/global/stats", async (req, res) => {
    try {
      const mod = await globalGates();
      const stats = mod.getGlobalStats(db);
      res.json({ ok: true, ...stats });
    } catch (err) {
      log("error", "global_stats_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Run health check on a global DTU
  app.post("/api/economy/global/health-check/:dtuId", adminOnly, async (req, res) => {
    try {
      const mod = await globalGates();
      const result = mod.runHealthCheck(db, req.params.dtuId);
      res.json({ ok: true, ...result });
    } catch (err) {
      log("error", "global_health_check_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // Demote from global (admin)
  app.post("/api/economy/global/demote/:dtuId", adminOnly, async (req, res) => {
    try {
      const mod = await globalGates();
      const result = mod.demoteFromGlobal(db, { dtuId: req.params.dtuId, reason: req.body.reason });
      res.json(result);
    } catch (err) {
      log("error", "global_demote_failed", { error: err.message });
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLE INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  // Initialize all tables on route registration
  (async () => {
    try {
      const r = await rights();
      r.ensureLicenseTables(db);
    } catch (e) { log("warn", "license_tables_init_skipped", { error: e.message }); }

    try {
      const c = await commissions();
      if (c.ensureCommissionTables) c.ensureCommissionTables(db);
    } catch (e) { log("warn", "commission_tables_init_skipped", { error: e.message }); }

    try {
      const g = await globalGates();
      if (g.ensureGlobalGateTables) g.ensureGlobalGateTables(db);
    } catch (e) { log("warn", "global_gate_tables_init_skipped", { error: e.message }); }
  })();
}
