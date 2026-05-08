/**
 * Concord Film Studios — API Routes
 *
 * Integrates with the existing creative marketplace and economy systems.
 * Extends creative_artifacts with film-specific metadata and features.
 *
 * Exposes:
 *   - Film DTU CRUD (media metadata on top of creative artifacts)
 *   - Preview system (zero-auth, first-5-min, trailer-cut, creator-selected)
 *   - Preview analytics (drop-off, conversion — owned by creator)
 *   - Component DTU decomposition (soundtrack, score, dialogue, etc.)
 *   - Series/episode structure with bundle pricing
 *   - Crew tagging and crew-created sellable DTUs
 *   - Film remix registration and lineage tracking
 *   - Discovery with public, auditable ranking weights
 *   - Watch party sessions (synchronized viewing)
 *   - Gift transfers (license gifting between users)
 *   - Creator analytics dashboard
 *   - Constants / config
 */

import express from "express";
import {
  createFilmDTU, getFilmDTU, updateFilmDTU,
  getFilmPreview, recordPreviewEvent, getPreviewAnalytics,
  createFilmComponent, listFilmComponents, updateFilmComponent,
  addCrewMember, listFilmCrew, removeCrewMember,
  createCrewDTU, listCrewDTUs,
  createSeriesBundle, getSeriesEpisodes, getSeriesBundles,
  registerFilmRemix, getFilmRemixes, getRemixLineage,
  computeDiscoveryScore, discoverFilms,
  createWatchParty, joinWatchParty, updateWatchParty,
  giftFilm, acceptGift, declineGift,
  getCreatorFilmAnalytics,
} from "../economy/film-studio.js";
import {
  FILM_DTU_TYPES, FILM_RESOLUTIONS, FILM_PREVIEW,
  FILM_REMIX_PERMISSIONS, FILM_REMIX_TYPES,
  FILM_COMPONENT_TYPES, FILM_CREW_ROLES,
  FILM_SERIES, FILM_DISCOVERY, FILM_OWNERSHIP,
  FILM_MONETIZATION, FILM_SOCIAL, FILM_ANALYTICS,
  FILM_EMERGENT, FILM_ARTISTRY_CROSSOVER, FILM_GOVERNANCE,
  FILM_ROYALTY,
} from "../lib/film-studio-constants.js";

/**
 * Create the film studio router.
 * @param {{ db: object, requireAuth?: Function }} deps
 */
export default function createFilmStudioRouter({ db, requireAuth }) {
  const router = express.Router();

  // Auth for writes: POST/PUT/DELETE/PATCH require authentication.
  // Reads (GET) are public — especially previews (no paywall before preview).
  // SECURITY: if requireAuth isn't provided, hard-fail writes instead of
  // silently passing through — the previous behavior combined with the
  // `req.user?.id` fallbacks below let unauthenticated
  // callers forge creator identity.
  const authForWrites = (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    if (typeof requireAuth === "function") return requireAuth()(req, res, next);
    return res.status(401).json({ ok: false, error: "Authentication required" });
  };
  router.use(authForWrites);

  // Helper: pull authenticated creator id, 401 if missing. Every write
  // endpoint in this router funnels through this so we never trust a
  // body-supplied creatorId.
  function requireCreatorId(req, res) {
    const creatorId = req.user?.id;
    if (!creatorId) {
      res.status(401).json({ ok: false, error: "Authentication required" });
      return null;
    }
    return creatorId;
  }

  // ─── Constants (public) ────────────────────────────────────────────

  router.get("/constants", (_req, res) => {
    res.json({
      filmTypes: FILM_DTU_TYPES,
      resolutions: FILM_RESOLUTIONS,
      preview: FILM_PREVIEW,
      remixPermissions: FILM_REMIX_PERMISSIONS,
      remixTypes: FILM_REMIX_TYPES,
      componentTypes: FILM_COMPONENT_TYPES,
      crewRoles: FILM_CREW_ROLES,
      series: FILM_SERIES,
      discovery: FILM_DISCOVERY,
      ownership: FILM_OWNERSHIP,
      monetization: FILM_MONETIZATION,
      social: FILM_SOCIAL,
      analytics: FILM_ANALYTICS,
      emergent: FILM_EMERGENT,
      artistryCrossover: FILM_ARTISTRY_CROSSOVER,
      governance: FILM_GOVERNANCE,
      royalty: FILM_ROYALTY,
    });
  });

  // ─── Film DTU CRUD ─────────────────────────────────────────────────

  router.post("/", (req, res) => {
    const result = createFilmDTU(db, {
      ...req.body,
      creatorId: req.user?.id,
    });
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/:filmDtuId", (req, res) => {
    const film = getFilmDTU(db, req.params.filmDtuId);
    if (!film) return res.status(404).json({ error: "film_not_found" });
    res.json(film);
  });

  router.patch("/:filmDtuId", (req, res) => {
    const creatorId = req.user?.id;
    const result = updateFilmDTU(db, req.params.filmDtuId, creatorId, req.body);
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ─── Preview System (NO AUTH REQUIRED) ─────────────────────────────

  router.get("/:filmDtuId/preview", (req, res) => {
    // No authentication. No paywall. Hardcoded.
    const result = getFilmPreview(db, req.params.filmDtuId);
    res.status(result.ok ? 200 : 404).json(result);
  });

  router.post("/:filmDtuId/preview/event", (req, res) => {
    // Preview events can be recorded without auth (anonymous viewers)
    const result = recordPreviewEvent(db, {
      filmDtuId: req.params.filmDtuId,
      viewerId: req.user?.id || null,
      ...req.body,
    });
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/:filmDtuId/preview/analytics", (req, res) => {
     
    // eslint-disable-next-line no-restricted-syntax
    const creatorId = req.user?.id || req.query.creatorId; // safe: public-filter
    const result = getPreviewAnalytics(db, req.params.filmDtuId, creatorId);
    res.status(result.ok ? 200 : 403).json(result);
  });

  // ─── Component DTU Decomposition ──────────────────────────────────

  router.post("/:filmDtuId/components", (req, res) => {
    const result = createFilmComponent(db, {
      filmDtuId: req.params.filmDtuId,
      creatorId: req.user?.id,
      ...req.body,
    });
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/:filmDtuId/components", (req, res) => {
    const components = listFilmComponents(db, req.params.filmDtuId);
    res.json({ components });
  });

  router.patch("/components/:componentId", (req, res) => {
    const creatorId = req.user?.id;
    const result = updateFilmComponent(db, req.params.componentId, creatorId, req.body);
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ─── Crew Contribution System ─────────────────────────────────────

  router.post("/:filmDtuId/crew", (req, res) => {
    const result = addCrewMember(db, {
      filmDtuId: req.params.filmDtuId,
      creatorId: req.user?.id,
      ...req.body,
    });
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/:filmDtuId/crew", (req, res) => {
    const crew = listFilmCrew(db, req.params.filmDtuId);
    res.json({ crew });
  });

  router.delete("/crew/:crewId", (req, res) => {
    const creatorId = req.user?.id;
    const result = removeCrewMember(db, req.params.crewId, creatorId);
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post("/:filmDtuId/crew-dtus", (req, res) => {
    const result = createCrewDTU(db, {
      filmDtuId: req.params.filmDtuId,
      ...req.body,
    });
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/:filmDtuId/crew-dtus", (req, res) => {
    const crewDTUs = listCrewDTUs(db, req.params.filmDtuId);
    res.json({ crewDTUs });
  });

  // ─── Series / Episode Structure ───────────────────────────────────

  router.post("/:seriesDtuId/bundles", (req, res) => {
    const result = createSeriesBundle(db, {
      seriesDtuId: req.params.seriesDtuId,
      creatorId: req.user?.id,
      ...req.body,
    });
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/:seriesDtuId/episodes", (req, res) => {
    const episodes = getSeriesEpisodes(db, req.params.seriesDtuId);
    res.json({ episodes });
  });

  router.get("/:seriesDtuId/bundles", (req, res) => {
    const bundles = getSeriesBundles(db, req.params.seriesDtuId);
    res.json({ bundles });
  });

  // ─── Film Remix System ────────────────────────────────────────────

  router.post("/remixes", (req, res) => {
    const result = registerFilmRemix(db, req.body);
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/:filmDtuId/remixes", (req, res) => {
    const remixes = getFilmRemixes(db, req.params.filmDtuId);
    res.json({ remixes });
  });

  router.get("/:filmDtuId/lineage", (req, res) => {
    const maxDepth = parseInt(req.query.maxDepth) || 50;
    const lineage = getRemixLineage(db, req.params.filmDtuId, maxDepth);
    res.json({ lineage });
  });

  // ─── Discovery & Ranking ──────────────────────────────────────────

  router.get("/discover", (req, res) => {
    const { genre, filmType, sortBy, limit, offset } = req.query;
    const films = discoverFilms(db, {
      genre, filmType, sortBy,
      limit: parseInt(limit) || 20,
      offset: parseInt(offset) || 0,
    });
    res.json({
      films,
      rankingWeights: FILM_DISCOVERY.rankingFactors,
      noPaidPromotion: FILM_DISCOVERY.NO_PAID_PROMOTION,
      weightsArePublic: FILM_DISCOVERY.WEIGHTS_ARE_PUBLIC,
    });
  });

  router.post("/:filmDtuId/compute-score", (req, res) => {
    const result = computeDiscoveryScore(db, req.params.filmDtuId);
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ─── Watch Party ──────────────────────────────────────────────────

  router.post("/watch-party", (req, res) => {
    const result = createWatchParty(db, {
      filmDtuId: req.body.filmDtuId,
      hostUserId: req.user?.id,
    });
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.post("/watch-party/:partyId/join", (req, res) => {
    const userId = req.user?.id;
    const result = joinWatchParty(db, req.params.partyId, userId);
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.patch("/watch-party/:partyId", (req, res) => {
    const hostUserId = req.user?.id;
    const result = updateWatchParty(db, req.params.partyId, hostUserId, req.body);
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ─── Gift Transfers ───────────────────────────────────────────────

  router.post("/gift", (req, res) => {
    const result = giftFilm(db, {
      ...req.body,
      fromUserId: req.user?.id,
    });
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.post("/gift/:giftId/accept", (req, res) => {
    const result = acceptGift(db, req.params.giftId, req.user?.id);
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post("/gift/:giftId/decline", (req, res) => {
    const result = declineGift(db, req.params.giftId, req.user?.id);
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ─── Creator Analytics ────────────────────────────────────────────

   
  router.get("/analytics/creator", (req, res) => {
    // eslint-disable-next-line no-restricted-syntax
    const creatorId = req.user?.id || req.query.creatorId; // safe: public-filter
    const result = getCreatorFilmAnalytics(db, creatorId);
    res.status(result.ok ? 200 : 400).json(result);
  });

  return router;
}
