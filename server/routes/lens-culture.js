/**
 * Lens & Culture API Routes — v1.3
 */

import express from "express";
import "../lib/lens-culture-constants.js"; // wiring: constants are sourced via economy/lens-culture.js below
import {
  // Constants
  MUSIC_LENS, MUSIC_PROTECTION, ONE_TAP_PURCHASE, ARTIFACT_EXPORT,
  ARTISTRY_SCOPE, ARTIST_STRATEGY,
  CULTURE_LENS, CULTURE_GATING, CULTURE_HEARTBEAT, CULTURE_RESTRICTIONS,
  GREAT_MERGE, POST_MERGE_RULES,
  SOVEREIGN_BIOMONITOR, GRIEF_PROTOCOL,
  LENS_PROTECTION_SYSTEM, LENS_DTU_BRIDGE, LENS_VALIDATOR,
  SYSTEM_LENS_DECLARATIONS,
  ART_LENS, VIDEO_LENS, CODE_LENS,
  LENS_CONSTANTS,
  // Functions
  postCultureDTU, getCultureDTU, browseCulture,
  resonateCulture, reflectOnCulture, getReflections,
  setLensProtection, getLensProtection, checkProtectionAllows,
  oneTapPurchase, exportArtifact, getExportHistory,
  recordBiomonitorReading, getLatestBiomonitorReading, getBiomonitorHistory,
  initGriefProtocol, activateGriefProtocol, getGriefProtocolStatus, transitionGriefPhase,
  initGreatMerge, getGreatMergeStatus, advanceMergePhase,
  registerLens, getLens, listLenses, registerSystemLenses,
} from "../economy/lens-culture.js";

export default function createLensCultureRouter({ db, requireAuth }) {
  const router = express.Router();

  // Auth for writes: POST/PUT/DELETE/PATCH require authentication
  const authForWrites = (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    if (typeof requireAuth === "function") return requireAuth()(req, res, next);
    return next();
  };
  router.use(authForWrites);

  // ── Config ────────────────────────────────────────────────────────
  router.get("/config", (_req, res) => {
    res.json({
      ok: true,
      lenses: {
        music: MUSIC_LENS,
        art: ART_LENS,
        video: VIDEO_LENS,
        code: CODE_LENS,
        culture: CULTURE_LENS,
      },
      protection: {
        music: MUSIC_PROTECTION,
        system: LENS_PROTECTION_SYSTEM,
      },
      artistry: ARTISTRY_SCOPE,
      artistStrategy: ARTIST_STRATEGY,
      export: ARTIFACT_EXPORT,
      oneTapPurchase: ONE_TAP_PURCHASE,
      cultureGating: CULTURE_GATING,
      cultureHeartbeat: CULTURE_HEARTBEAT,
      cultureRestrictions: CULTURE_RESTRICTIONS,
      greatMerge: GREAT_MERGE,
      postMergeRules: POST_MERGE_RULES,
      biomonitor: SOVEREIGN_BIOMONITOR,
      griefProtocol: GRIEF_PROTOCOL,
      dtuBridge: LENS_DTU_BRIDGE,
      lensValidator: LENS_VALIDATOR,
      systemLensDeclarations: SYSTEM_LENS_DECLARATIONS,
      constants: LENS_CONSTANTS,
    });
  });

  // ── Culture DTUs ──────────────────────────────────────────────────
  router.post("/culture", (req, res) => {
    const result = postCultureDTU(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/culture/:id", (req, res) => {
    const viewerId = req.query.viewerId;
    const dtu = getCultureDTU(db, req.params.id, { viewerId });
    if (!dtu) return res.status(404).json({ ok: false, error: "not_found" });
    if (dtu.restricted) return res.status(403).json({ ok: false, ...dtu });
    res.json({ ok: true, cultureDTU: dtu });
  });

  router.get("/culture", (req, res) => {
    const { cultureTier, regional, national, viewerId, sort, limit, offset } = req.query;
    const result = browseCulture(db, {
      cultureTier, regional, national, viewerId, sort,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ── Resonance & Reflections ───────────────────────────────────────
  // SECURITY: userId is derived from the authenticated session only.
  // Previously we trusted req.body.userId, which let any caller act as any
  // user by forging the field in the request body.
  router.post("/culture/:id/resonate", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "Authentication required" });
    const result = resonateCulture(db, { userId, dtuId: req.params.id });
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post("/culture/:id/reflect", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "Authentication required" });
    const result = reflectOnCulture(db, {
      userId,
      dtuId: req.params.id,
      body: req.body.body,
      media: req.body.media,
    });
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/culture/:id/reflections", (req, res) => {
    const result = getReflections(db, req.params.id, {
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    res.json(result);
  });

  // ── Lens Protection ───────────────────────────────────────────────
  router.post("/protection", (req, res) => {
    const result = setLensProtection(db, req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/protection/:artifactId/:lensId", (req, res) => {
    const protection = getLensProtection(db, req.params.artifactId, req.params.lensId);
    res.json({ ok: true, ...protection });
  });

  router.post("/protection/check", (req, res) => {
    const result = checkProtectionAllows(db, req.body || {});
    res.json({ ok: true, ...result });
  });

  // ── One-Tap Purchase ──────────────────────────────────────────────
  router.post("/purchase", (req, res) => {
    const result = oneTapPurchase(db, req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ── Artifact Export ───────────────────────────────────────────────
  router.post("/export", (req, res) => {
    const result = exportArtifact(db, req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/exports", (req, res) => {
    const { userId, artifactId, limit, offset } = req.query;
    const result = getExportHistory(db, {
      userId, artifactId,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
    res.json(result);
  });

  // ── Biomonitor ────────────────────────────────────────────────────
  router.post("/biomonitor", (req, res) => {
    const result = recordBiomonitorReading(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/biomonitor/latest", (_req, res) => {
    const reading = getLatestBiomonitorReading(db);
    if (!reading) return res.json({ ok: true, reading: null });
    res.json({ ok: true, reading });
  });

  router.get("/biomonitor/history", (req, res) => {
    const result = getBiomonitorHistory(db, {
      limit: req.query.limit ? Number(req.query.limit) : 100,
      alertLevel: req.query.alertLevel,
    });
    res.json(result);
  });

  // ── Grief Protocol ────────────────────────────────────────────────
  router.post("/grief/init", (_req, res) => {
    const result = initGriefProtocol(db);
    res.json(result);
  });

  router.post("/grief/activate", (req, res) => {
    const result = activateGriefProtocol(db, req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/grief/status", (_req, res) => {
    const result = getGriefProtocolStatus(db);
    res.json(result);
  });

  router.post("/grief/transition", (req, res) => {
    const result = transitionGriefPhase(db, req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ── Great Merge ───────────────────────────────────────────────────
  router.post("/merge/init", (req, res) => {
    const result = initGreatMerge(db, req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/merge/status", (_req, res) => {
    const result = getGreatMergeStatus(db);
    res.json(result);
  });

  router.post("/merge/advance", (req, res) => {
    const result = advanceMergePhase(db, req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ── Lens Registry ────────────────────────────────────────────────
  router.post("/lenses/register", (req, res) => {
    const result = registerLens(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.post("/lenses/register-system", (_req, res) => {
    const result = registerSystemLenses(db);
    res.json(result);
  });

  router.get("/lenses", (req, res) => {
    const isSystem = req.query.isSystem !== undefined ? req.query.isSystem === "true" : undefined;
    const result = listLenses(db, { isSystem });
    res.json(result);
  });

  router.get("/lenses/:name", (req, res) => {
    const lens = getLens(db, req.params.name);
    if (!lens) return res.status(404).json({ ok: false, error: "lens_not_found" });
    res.json({ ok: true, lens });
  });

  return router;
}
