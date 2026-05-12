/**
 * Federation Hierarchy — API Routes
 *
 * Exposes the four-tier federated knowledge and economic system:
 *   - National / Regional / CRI registry CRUD
 *   - User location declaration
 *   - Entity home base management
 *   - DTU federation tagging & promotion
 *   - Marketplace local-first purchasing
 *   - Knowledge escalation stats
 *   - Federation peering
 *   - CRI heartbeat
 *
 * Additive only. Follows existing route patterns.
 */
import express from "express";
import {
  createNational, listNationals, getNational,
  createRegion, listRegions, getRegion,
  registerCRIInstance, recordCRIHeartbeat, markStaleCRIs, listCRIInstances,
  declareUserLocation, getUserLocation,
  setEntityHomeBase, getEntityHomeBase,
  tagDTULocation, promoteDTU,
  findListingsForEntity,
  getEscalationStats,
  createPeer, listPeers,
  getEconomicFlowSummary,
  // v1.1
  checkQualityGate, checkPromotionEligibility,
  recordTierContent, getContentTiers, getMultiTierRoyalties,
  awardXP, completeQuest, getUserXP, getUserQuestCompletions,
  createRaceSeason, getActiveSeason,
  getTierHeartbeat, getFederationFlowInvariant,
  updateFederationPreferences, getFederationPreferences,
  // v1.1.1
  createDedupReview, processDedupDecision, getPendingDedupReviews,
  getDedupProtocol, getIntegrityInvariants,
  updateMarketplaceFilters, getMarketplaceFilters,
  updateWealthPreferences, getWealthPreferences,
  updateLeaderboardEntry, getLeaderboard,
} from "../lib/federation.js";
import {
  FEDERATION, PEERING_POLICIES,
  FEDERATION_FLOW, TIER_HEARTBEATS, TIER_QUALITY_GATES,
  CREATIVE_TIERS, TIER_QUESTS, KNOWLEDGE_RACE, DEFAULT_FEDERATION_PREFERENCES,
  DEDUP_PROTOCOL, INTEGRITY_INVARIANTS,
  DEFAULT_MARKETPLACE_FILTERS, DEFAULT_WEALTH_PREFERENCES,
} from "../lib/federation-constants.js";
import { checkConsent } from "../lib/consent.js";

/**
 * Create the federation router.
 * @param {{ db: object }} deps - Database handle
 */
export default function createFederationRouter({ db, requireAuth }) {
  const router = express.Router();

  // ── Auth: Require authentication for all write operations ──────────
  // GET endpoints are PUBLIC for frontend data fetching.
  // POST/PUT/DELETE/PATCH require auth.
  const authForWrites = (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    if (typeof requireAuth === "function") return requireAuth()(req, res, next);
    return next();
  };
  router.use(authForWrites);

  // ── Constants / Config ────────────────────────────────────────────────

  // PUBLIC
  router.get("/config", (_req, res) => {
    res.json({
      ok: true,
      federation: FEDERATION,
      peeringPolicies: PEERING_POLICIES,
      flow: FEDERATION_FLOW,
      tierHeartbeats: TIER_HEARTBEATS,
      qualityGates: TIER_QUALITY_GATES,
      creativeTiers: CREATIVE_TIERS,
      quests: TIER_QUESTS,
      knowledgeRace: KNOWLEDGE_RACE,
      defaultPreferences: DEFAULT_FEDERATION_PREFERENCES,
    });
  });

  router.get("/flow-invariant", (_req, res) => {
    res.json({ ok: true, invariant: getFederationFlowInvariant() });
  });

  // ── Nationals ─────────────────────────────────────────────────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/nationals", (req, res) => {
    const result = createNational(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/nationals", (_req, res) => {
    res.json(listNationals(db));
  });

  router.get("/nationals/:id", (req, res) => {
    const result = getNational(db, req.params.id);
    res.status(result.ok ? 200 : 404).json(result);
  });

  // ── Regions ───────────────────────────────────────────────────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/regions", (req, res) => {
    const result = createRegion(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/regions", (req, res) => {
    res.json(listRegions(db, { nationalId: req.query.nationalId || null }));
  });

  router.get("/regions/:id", (req, res) => {
    const result = getRegion(db, req.params.id);
    res.status(result.ok ? 200 : 404).json(result);
  });

  // ── CRI Instances ─────────────────────────────────────────────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/cri", (req, res) => {
    const result = registerCRIInstance(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/cri", (req, res) => {
    res.json(listCRIInstances(db, {
      regionalId: req.query.regionalId || null,
      nationalId: req.query.nationalId || null,
      status: req.query.status || null,
    }));
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/cri/:id/heartbeat", (req, res) => {
    const result = recordCRIHeartbeat(db, req.params.id);
    res.status(result.ok ? 200 : 404).json(result);
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/cri/mark-stale", (_req, res) => {
    res.json(markStaleCRIs(db));
  });

  // ── User Location Declaration ─────────────────────────────────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/users/:userId/location", (req, res) => {
    const result = declareUserLocation(db, { userId: req.params.userId, ...req.body });
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/users/:userId/location", (req, res) => {
    const result = getUserLocation(db, req.params.userId);
    res.status(result.ok ? 200 : 404).json(result);
  });

  // ── Entity Home Base ──────────────────────────────────────────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/entities/:entityId/home-base", (req, res) => {
    const result = setEntityHomeBase(db, { entityId: req.params.entityId, ...req.body });
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/entities/:entityId/home-base", (req, res) => {
    const result = getEntityHomeBase(db, req.params.entityId);
    res.status(result.ok ? 200 : 404).json(result);
  });

  // ── DTU Location & Federation Tier ────────────────────────────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/dtus/:dtuId/location", (req, res) => {
    const result = tagDTULocation(db, { dtuId: req.params.dtuId, ...req.body });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/dtus/:dtuId/promote", (req, res) => {
    const result = promoteDTU(db, { dtuId: req.params.dtuId, ...req.body });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ── Marketplace (Federation-Aware) ────────────────────────────────────

  router.get("/marketplace/search", (req, res) => {
    const { entityId, isEmergent, contentType, minPrice, maxPrice, limit, offset } = req.query;
    const result = findListingsForEntity(db, {
      entityId,
      isEmergent: isEmergent === "true",
      query: { contentType, minPrice: minPrice ? Number(minPrice) : null, maxPrice: maxPrice ? Number(maxPrice) : null, limit: limit ? Number(limit) : 50, offset: offset ? Number(offset) : 0 },
    });
    res.json(result);
  });

  // ── Knowledge Escalation Stats ────────────────────────────────────────

  router.get("/escalation/stats", (req, res) => {
    const result = getEscalationStats(db, {
      regional: req.query.regional || null,
      national: req.query.national || null,
      hours: req.query.hours ? Number(req.query.hours) : 24,
    });
    res.json(result);
  });

  // ── Federation Peering ────────────────────────────────────────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/peers", (req, res) => {
    const result = createPeer(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/peers", (req, res) => {
    res.json(listPeers(db, {
      entityId: req.query.entityId || null,
      peerType: req.query.peerType || null,
    }));
  });

  // ── Economic Flow ─────────────────────────────────────────────────────

  router.get("/economic-flow", (req, res) => {
    const result = getEconomicFlowSummary(db, {
      hours: req.query.hours ? Number(req.query.hours) : 24,
    });
    res.json(result);
  });

  // ═════════════════════════════════════════════════════════════════════
  // v1.1 ROUTES
  // ═════════════════════════════════════════════════════════════════════

  // ── Quality Gate Check ──────────────────────────────────────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/quality-gate/check", (req, res) => {
    const result = checkQualityGate(req.body || {});
    res.json(result);
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/promotion/eligibility", (req, res) => {
    const result = checkPromotionEligibility(req.body || {});
    res.json(result);
  });

  // ── Tier Content Tracking ───────────────────────────────────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/tier-content", (req, res) => {
    const result = recordTierContent(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/tier-content/:contentId", (req, res) => {
    const result = getContentTiers(db, req.params.contentId);
    res.json(result);
  });

  // ── Multi-Tier Royalties ────────────────────────────────────────────

  router.get("/royalties/:creatorId/:contentId", (req, res) => {
    const result = getMultiTierRoyalties(db, {
      creatorId: req.params.creatorId,
      contentId: req.params.contentId,
    });
    res.json(result);
  });

  // ── XP & Quests ─────────────────────────────────────────────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/xp/award", (req, res) => {
    const result = awardXP(db, req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/xp/:userId", (req, res) => {
    const result = getUserXP(db, {
      userId: req.params.userId,
      federationTier: req.query.tier || "regional",
      regional: req.query.regional || null,
      national: req.query.national || null,
      season: req.query.season || null,
    });
    res.json(result);
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/quests/complete", (req, res) => {
    const result = completeQuest(db, req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/quests/:userId", (req, res) => {
    const result = getUserQuestCompletions(db, {
      userId: req.params.userId,
      federationTier: req.query.tier || null,
    });
    res.json(result);
  });

  // ── Knowledge Race Seasons ──────────────────────────────────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/race/seasons", (req, res) => {
    const result = createRaceSeason(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/race/seasons/active", (_req, res) => {
    const result = getActiveSeason(db);
    res.json(result);
  });

  // ── Tier Heartbeat Config ───────────────────────────────────────────

  router.get("/heartbeat/:tier", (req, res) => {
    const config = getTierHeartbeat(req.params.tier);
    if (!config) return res.status(404).json({ ok: false, error: "unknown_tier" });
    res.json({ ok: true, tier: req.params.tier, heartbeat: config });
  });

  // ── User Federation Preferences ─────────────────────────────────────

  router.get("/users/:userId/preferences", (req, res) => {
    const result = getFederationPreferences(db, req.params.userId);
    res.status(result.ok ? 200 : 404).json(result);
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.put("/users/:userId/preferences", (req, res) => {
    const result = updateFederationPreferences(db, {
      userId: req.params.userId,
      preferences: req.body || {},
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ═════════════════════════════════════════════════════════════════════
  // v1.1.1 ROUTES
  // ═════════════════════════════════════════════════════════════════════

  // ── Council Dedup ───────────────────────────────────────────────────

  router.get("/dedup/protocol", (_req, res) => {
    res.json({ ok: true, protocol: getDedupProtocol() });
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/dedup/reviews", (req, res) => {
    const result = createDedupReview(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/dedup/reviews", (req, res) => {
    res.json(getPendingDedupReviews(db, {
      targetTier: req.query.tier || null,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    }));
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/dedup/reviews/:reviewId/decide", (req, res) => {
    const result = processDedupDecision(db, {
      reviewId: req.params.reviewId,
      ...req.body,
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ── Integrity Invariants ────────────────────────────────────────────

  router.get("/integrity", (_req, res) => {
    res.json({ ok: true, invariants: getIntegrityInvariants() });
  });

  // ── Marketplace Filters ─────────────────────────────────────────────

  router.get("/users/:userId/marketplace-filters", (req, res) => {
    const result = getMarketplaceFilters(db, req.params.userId);
    res.status(result.ok ? 200 : 404).json(result);
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.put("/users/:userId/marketplace-filters", (req, res) => {
    const result = updateMarketplaceFilters(db, {
      userId: req.params.userId,
      filters: req.body || {},
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ── Wealth Preferences ──────────────────────────────────────────────

  router.get("/users/:userId/wealth-preferences", (req, res) => {
    const result = getWealthPreferences(db, req.params.userId);
    res.status(result.ok ? 200 : 404).json(result);
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.put("/users/:userId/wealth-preferences", (req, res) => {
    const result = updateWealthPreferences(db, {
      userId: req.params.userId,
      preferences: req.body || {},
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ── Leaderboards ────────────────────────────────────────────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/leaderboard/entry", (req, res) => {
    const result = updateLeaderboardEntry(db, req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/leaderboard/:scope/:scopeId/:category", (req, res) => {
    const result = getLeaderboard(db, {
      scope: req.params.scope,
      scopeId: req.params.scopeId,
      category: req.params.category,
      season: req.query.season || null,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    });

    // Consent filter: only show users who opted into profile visibility for this scope
    if (result.ok && result.entries) {
      const scope = req.params.scope;
      const consentAction = scope === "regional" ? "show_profile_regional"
        : scope === "national" ? "show_profile_national"
        : scope === "global" ? "show_profile_global" : null;

      if (consentAction) {
        result.entries = result.entries.filter(entry => {
          const consent = checkConsent(db, entry.userId, consentAction);
          return consent.consented;
        });
      }
    }

    res.json(result);
  });

  return router;
}
