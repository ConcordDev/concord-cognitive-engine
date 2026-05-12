/**
 * DTU File Format API Routes — v1.0
 */

import express from "express";
import {
  DTU_FILE_FORMAT, DTU_BINARY_LAYOUT, DTU_OS_ACTIONS,
  DTU_VIEWER, DTU_CODEC, DTU_SMART_OPEN, DTU_SHARING,
  DTU_PLATFORM_REGISTRATION, DTU_IANA_REGISTRATION,
  DTU_FORMAT_CONSTANTS,
  determinePrimaryType, calculateLayersBitfield,
  buildHeader, parseHeader,
  encodeDTU, decodeDTU, verifyDTU,
  registerDTUExport, lookupDTUByHash, getDTUExports,
  reimportDTU, getReimports,
} from "../economy/dtu-format.js";

export default function createDTUFormatRouter({ db, requireAuth }) {
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
      fileFormat: DTU_FILE_FORMAT,
      binaryLayout: DTU_BINARY_LAYOUT,
      osActions: DTU_OS_ACTIONS,
      viewer: DTU_VIEWER,
      codec: DTU_CODEC,
      smartOpen: DTU_SMART_OPEN,
      sharing: DTU_SHARING,
      platformRegistration: DTU_PLATFORM_REGISTRATION,
      ianaRegistration: DTU_IANA_REGISTRATION,
      constants: DTU_FORMAT_CONSTANTS,
    });
  });

  // ── Encode DTU ────────────────────────────────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/encode", (req, res) => {
    const result = encodeDTU(req.body || {});
    if (!result.ok) return res.status(400).json(result);

    // Return base64-encoded buffer for transport
    res.json({
      ok: true,
      dtuBase64: result.buffer.toString("base64"),
      contentHash: result.contentHash,
      signature: result.signature,
      totalSize: result.totalSize,
      primaryType: result.primaryType,
      primaryTypeName: result.primaryTypeName,
    });
  });

  // ── Decode DTU ────────────────────────────────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/decode", (req, res) => {
    const { dtuBase64 } = req.body || {};
    if (!dtuBase64) return res.status(400).json({ ok: false, error: "missing_dtu_base64" });

    let buffer;
    try {
      buffer = Buffer.from(dtuBase64, "base64");
    } catch (_e) {
      return res.status(400).json({ ok: false, error: "Invalid base64 input" });
    }
    const result = decodeDTU(buffer);
    if (!result.ok) return res.status(400).json(result);

    // Don't send binary artifact data as JSON, just metadata about it
    const response = {
      ok: true,
      header: result.header,
      metadata: result.metadata,
      humanLayer: result.humanLayer,
      coreLayer: result.coreLayer,
      machineLayer: result.machineLayer,
      hasArtifact: !!result.artifactData,
      artifactSize: result.artifactData ? result.artifactData.length : 0,
    };
    res.json(response);
  });

  // ── Verify DTU ────────────────────────────────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/verify", (req, res) => {
    const { dtuBase64, expectedHash, expectedSignature } = req.body || {};
    if (!dtuBase64) return res.status(400).json({ ok: false, error: "missing_dtu_base64" });

    let buffer;
    try {
      buffer = Buffer.from(dtuBase64, "base64");
    } catch (_e) {
      return res.status(400).json({ ok: false, error: "Invalid base64 input" });
    }
    const result = verifyDTU(buffer, { expectedHash, expectedSignature });
    res.json(result);
  });

  // ── Parse Header Only ─────────────────────────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/header", (req, res) => {
    const { headerBase64 } = req.body || {};
    if (!headerBase64) return res.status(400).json({ ok: false, error: "missing_header_base64" });

    let buffer;
    try {
      buffer = Buffer.from(headerBase64, "base64");
    } catch (_e) {
      return res.status(400).json({ ok: false, error: "Invalid base64 input" });
    }
    const result = parseHeader(buffer);
    res.json(result);
  });

  // ── File Registry ─────────────────────────────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/registry", (req, res) => {
    const result = registerDTUExport(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/registry/hash/:hash", (req, res) => {
    const record = lookupDTUByHash(db, req.params.hash);
    if (!record) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, fileRecord: record });
  });

  router.get("/registry/dtu/:dtuId", (req, res) => {
    const result = getDTUExports(db, req.params.dtuId);
    res.json(result);
  });

  // ── Reimport ──────────────────────────────────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/reimport", (req, res) => {
    const { dtuBase64, importedBy, source } = req.body || {};
    if (!dtuBase64) return res.status(400).json({ ok: false, error: "missing_dtu_base64" });

    let buffer;
    try {
      buffer = Buffer.from(dtuBase64, "base64");
    } catch (_e) {
      return res.status(400).json({ ok: false, error: "Invalid base64 input" });
    }
    const result = reimportDTU(db, { buffer, importedBy, source });
    if (!result.ok) return res.status(400).json(result);

    // Don't send full DTU data in reimport response
    res.json({
      ok: true,
      reimport: result.reimport,
      headerInfo: result.dtu.header,
      metadata: result.dtu.metadata,
    });
  });

  router.get("/reimports", (req, res) => {
    const { importedBy, limit } = req.query;
    const result = getReimports(db, {
      importedBy,
      limit: limit ? Number(limit) : 50,
    });
    res.json(result);
  });

  return router;
}
