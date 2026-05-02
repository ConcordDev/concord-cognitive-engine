/**
 * Creative Artifact Marketplace — API Routes
 *
 * Federation v1.2: Creators Keep IP. Only Usage Rights Are Sold.
 *
 * Exposes:
 *   - Artifact CRUD and publishing (original + derivative)
 *   - Marketplace browsing and search
 *   - Purchasing with royalty cascade
 *   - Artist discovery (local-first)
 *   - Derivative tree traversal
 *   - Ratings and reviews
 *   - Promotion through tiers
 *   - Creative XP and quests
 *   - License management
 *   - Cascade earnings queries
 *   - Constants / config
 */

import express from "express";
import logger from "../logger.js";
import {
  publishArtifact,
  publishDerivativeArtifact,
  purchaseArtifact,
  getArtifact,
  searchArtifacts,
  discoverLocalArtists,
  browseRegionArt,
  getDerivativeTree,
  rateArtifact,
  checkArtifactPromotionEligibility,
  promoteArtifact,
  awardCreativeXP,
  completeCreativeQuest,
  getCreativeXP,
  getCreativeQuestCompletions,
  getArtifactLicenses,
  getUserLicenses,
  getArtifactCascadeEarnings,
  getCreatorCascadeEarnings,
  pauseArtifact,
  resumeArtifact,
  delistArtifact,
  updateArtifactPrice,
  ARTIFACT_TYPES,
  CREATIVE_MARKETPLACE,
  CREATIVE_FEDERATION,
  CREATIVE_QUESTS,
  CREATIVE_LEADERBOARD,
  CREATOR_RIGHTS,
  LICENSE_TYPES,
} from "../economy/creative-marketplace.js";
import { QUEST_REWARD_POLICY } from "../lib/creative-marketplace-constants.js";
import {
  MARKETPLACE_CONTENT_TYPES,
  getContentTypeInfo,
  listContentTypes,
} from "../lib/marketplace-types.js";

/**
 * Create the creative marketplace router.
 * @param {{ db: object }} deps
 */
export default function createCreativeMarketplaceRouter({ db, requireAuth, detectWashTrading }) {
  const router = express.Router();

  // Auth for writes: POST/PUT/DELETE/PATCH require authentication
  const authForWrites = (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    if (typeof requireAuth === "function") return requireAuth()(req, res, next);
    return next();
  };
  router.use(authForWrites);

  // ── Constants / Config ──────────────────────────────────────────────

  // PUBLIC
  router.get("/config", (_req, res) => {
    res.json({
      ok: true,
      creatorRights: CREATOR_RIGHTS,
      artifactTypes: ARTIFACT_TYPES,
      federation: CREATIVE_FEDERATION,
      marketplace: CREATIVE_MARKETPLACE,
      quests: CREATIVE_QUESTS,
      leaderboard: CREATIVE_LEADERBOARD,
      licenseTypes: LICENSE_TYPES,
      questRewardPolicy: QUEST_REWARD_POLICY,
    });
  });

  router.get("/creator-rights", (_req, res) => {
    res.json({ ok: true, rights: CREATOR_RIGHTS });
  });

  router.get("/artifact-types", (_req, res) => {
    res.json({ ok: true, types: ARTIFACT_TYPES });
  });

  router.get("/content-types", (_req, res) => {
    res.json({ ok: true, contentTypes: listContentTypes() });
  });

  // ── Publish Artifact ────────────────────────────────────────────────

  router.post("/artifacts", (req, res) => {
    const result = publishArtifact(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.post("/artifacts/derivative", (req, res) => {
    const result = publishDerivativeArtifact(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  // ── Get / Search Artifacts ──────────────────────────────────────────

  router.get("/artifacts/:id", (req, res) => {
    const artifact = getArtifact(db, req.params.id);
    if (!artifact) return res.status(404).json({ ok: false, error: "artifact_not_found" });
    res.json({ ok: true, artifact });
  });

  router.get("/artifacts", (req, res) => {
    const {
      type, genre, creatorId, federationTier,
      locationRegional, locationNational,
      minPrice, maxPrice, minRating,
      status, sortBy, limit, offset,
    } = req.query;

    const result = searchArtifacts(db, {
      type, genre, creatorId, federationTier,
      locationRegional, locationNational,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      minRating: minRating ? Number(minRating) : undefined,
      status, sortBy,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
    res.json(result);
  });

  // ── Purchase ────────────────────────────────────────────────────────

  router.post("/artifacts/:id/purchase", (req, res) => {
    const { buyerId } = req.body;

    // ── Wash Trading Detection (Category 1: Adversarial) ───────────────
    // Look up the artifact to get the seller/creator before purchase
    if (typeof detectWashTrading === "function" && buyerId) {
      const artifact = getArtifact(db, req.params.id);
      if (artifact?.creator_id) {
        const washResult = detectWashTrading(buyerId, artifact.creator_id, req);
        if (washResult.suspicious) {
          logger.warn("[CreativeMarketplace] Wash trade suspected", {
            buyerId,
            sellerId: artifact.creator_id,
            artifactId: req.params.id,
            reasons: washResult.reasons,
          });
        }
      }
    }

    const result = purchaseArtifact(db, {
      buyerId,
      artifactId: req.params.id,
      requestId: req.body.requestId,
      ip: req.ip,
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ── Discovery ───────────────────────────────────────────────────────

  router.get("/discover/local-artists", (req, res) => {
    const { userId, artifactType, genre, sortBy, limit } = req.query;
    const result = discoverLocalArtists(db, {
      userId,
      artifactType,
      genre,
      sortBy,
      limit: limit ? Number(limit) : 20,
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/discover/region/:regionalId", (req, res) => {
    const { artifactType, sortBy, limit } = req.query;
    const result = browseRegionArt(db, {
      regionalId: req.params.regionalId,
      artifactType,
      sortBy,
      limit: limit ? Number(limit) : 50,
    });
    res.json(result);
  });

  // ── Derivative Tree ─────────────────────────────────────────────────

  router.get("/artifacts/:id/derivatives", (req, res) => {
    const result = getDerivativeTree(db, req.params.id);
    res.status(result.ok ? 200 : 404).json(result);
  });

  // ── Ratings ─────────────────────────────────────────────────────────

  router.post("/artifacts/:id/rate", (req, res) => {
    const result = rateArtifact(db, {
      artifactId: req.params.id,
      raterId: req.body.raterId,
      rating: req.body.rating,
      review: req.body.review,
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ── Promotion ───────────────────────────────────────────────────────

  router.get("/artifacts/:id/promotion-eligibility", (req, res) => {
    const result = checkArtifactPromotionEligibility(db, req.params.id);
    res.json(result);
  });

  router.post("/artifacts/:id/promote", (req, res) => {
    // SECURITY: promotedBy comes from the authenticated session — never
    // from req.body. Previously any caller could forge the promoter.
    const promotedBy = req.user?.id;
    if (!promotedBy) return res.status(401).json({ ok: false, error: "Authentication required" });
    const result = promoteArtifact(db, { artifactId: req.params.id, promotedBy });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ── Artifact Lifecycle ──────────────────────────────────────────────
  // SECURITY: creatorId is derived from the authenticated session, never
  // from req.body. Previously, any caller could pause/resume/delist or
  // re-price someone else's artifact by forging creatorId in the body.

  router.post("/artifacts/:id/pause", (req, res) => {
    const creatorId = req.user?.id;
    if (!creatorId) return res.status(401).json({ ok: false, error: "Authentication required" });
    const result = pauseArtifact(db, { artifactId: req.params.id, creatorId });
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post("/artifacts/:id/resume", (req, res) => {
    const creatorId = req.user?.id;
    if (!creatorId) return res.status(401).json({ ok: false, error: "Authentication required" });
    const result = resumeArtifact(db, { artifactId: req.params.id, creatorId });
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post("/artifacts/:id/delist", (req, res) => {
    const creatorId = req.user?.id;
    if (!creatorId) return res.status(401).json({ ok: false, error: "Authentication required" });
    const result = delistArtifact(db, { artifactId: req.params.id, creatorId });
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.put("/artifacts/:id/price", (req, res) => {
    const creatorId = req.user?.id;
    if (!creatorId) return res.status(401).json({ ok: false, error: "Authentication required" });
    const result = updateArtifactPrice(db, {
      artifactId: req.params.id,
      creatorId,
      newPrice: req.body.newPrice,
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ── Licenses ────────────────────────────────────────────────────────

  router.get("/artifacts/:id/licenses", (req, res) => {
    const result = getArtifactLicenses(db, req.params.id);
    res.json(result);
  });

  router.get("/users/:userId/licenses", (req, res) => {
    const result = getUserLicenses(db, req.params.userId);
    res.json(result);
  });

  // ── Cascade Earnings ────────────────────────────────────────────────

  router.get("/artifacts/:id/cascade-earnings", (req, res) => {
    const result = getArtifactCascadeEarnings(db, req.params.id);
    res.json(result);
  });

  router.get("/creators/:creatorId/cascade-earnings", (req, res) => {
    const result = getCreatorCascadeEarnings(db, req.params.creatorId);
    res.json(result);
  });

  // ── Creative XP & Quests ────────────────────────────────────────────

  router.post("/xp/award", (req, res) => {
    const result = awardCreativeXP(db, req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/xp/:userId", (req, res) => {
    const result = getCreativeXP(db, {
      userId: req.params.userId,
      federationTier: req.query.tier || "regional",
      regional: req.query.regional || null,
      national: req.query.national || null,
      season: req.query.season || null,
    });
    res.json(result);
  });

  router.post("/quests/complete", (req, res) => {
    const result = completeCreativeQuest(db, req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/quests/:userId", (req, res) => {
    const result = getCreativeQuestCompletions(db, {
      userId: req.params.userId,
      federationTier: req.query.tier || null,
    });
    res.json(result);
  });

  return router;
}
