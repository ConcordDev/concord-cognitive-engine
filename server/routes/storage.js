/**
 * Single-Origin Storage Routes — v1.0
 */

import express from "express";
import {
  STORAGE_INVARIANT, ARTIFACT_STORAGE, DOWNLOAD_FLOW,
  STORAGE_ECONOMICS, VAULT_REFERENCE_SYSTEM, BANDWIDTH_MANAGEMENT,
  CRI_CACHE, STORAGE_CONSTANTS,
  storeInVault, getVaultEntry, incrementVaultRef, decrementVaultRef,
  cleanupUnreferencedArtifacts, getVaultStats,
  recordDownload, getUserDownloads, getArtifactDownloadCount, hasUserDownloaded,
  cacheInCRI, recordCRIServe, evictFromCRI, getCRICacheContents,
  getCRICacheStats, evictExpiredCRIEntries,
  getRegionalStats, getTopRegionalArtifacts,
  calculateStorageSavings,
} from "../economy/storage.js";
import { validateBody, vaultStoreSchema } from "../lib/validators/mutation-schemas.js";

export default function createStorageRouter({ db, requireAuth }) {
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
      invariant: STORAGE_INVARIANT,
      artifactStorage: ARTIFACT_STORAGE,
      downloadFlow: DOWNLOAD_FLOW,
      economics: STORAGE_ECONOMICS,
      referenceSystem: VAULT_REFERENCE_SYSTEM,
      bandwidth: BANDWIDTH_MANAGEMENT,
      criCache: CRI_CACHE,
      constants: STORAGE_CONSTANTS,
    });
  });

  // ── Vault ─────────────────────────────────────────────────────────
  router.post("/vault/store", validateBody(vaultStoreSchema), (req, res) => {
    try {
      const { fileBase64, mimeType } = req.body || {};
      if (!fileBase64) return res.status(400).json({ ok: false, error: "missing_file_data" });
      let fileBuffer;
      try {
        fileBuffer = Buffer.from(fileBase64, "base64");
      } catch (bufErr) {
        return res.status(400).json({ ok: false, error: "invalid_base64", detail: bufErr.message });
      }
      const result = storeInVault(db, { fileBuffer, mimeType });
      res.status(result.ok ? 201 : 400).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: "vault_store_failed" });
    }
  });

  router.get("/vault/:hash", (req, res) => {
    try {
      const { hash } = req.params;
      if (!hash || !/^[a-fA-F0-9]{16,128}$/.test(hash)) {
        return res.status(400).json({ ok: false, error: "invalid_hash_format" });
      }
      const entry = getVaultEntry(db, hash);
      if (!entry) return res.status(404).json({ ok: false, error: "not_found" });
      res.json({ ok: true, entry });
    } catch (err) {
      res.status(500).json({ ok: false, error: "vault_get_failed" });
    }
  });

  router.post("/vault/:hash/ref/increment", (req, res) => {
    try {
      const { hash } = req.params;
      if (!hash || !/^[a-fA-F0-9]{16,128}$/.test(hash)) {
        return res.status(400).json({ ok: false, error: "invalid_hash_format" });
      }
      const result = incrementVaultRef(db, hash);
      if (result && !result.ok) return res.status(400).json(result);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: "ref_increment_failed" });
    }
  });

  router.post("/vault/:hash/ref/decrement", (req, res) => {
    try {
      const { hash } = req.params;
      if (!hash || !/^[a-fA-F0-9]{16,128}$/.test(hash)) {
        return res.status(400).json({ ok: false, error: "invalid_hash_format" });
      }
      const result = decrementVaultRef(db, hash);
      if (result && !result.ok) return res.status(400).json(result);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: "ref_decrement_failed" });
    }
  });

  router.post("/vault/cleanup", (_req, res) => {
    try {
      const result = cleanupUnreferencedArtifacts(db);
      if (!result || typeof result !== "object") {
        return res.status(500).json({ ok: false, error: "cleanup_invalid_result" });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: "cleanup_failed" });
    }
  });

  router.get("/vault-stats", (_req, res) => {
    try {
      const stats = getVaultStats(db);
      res.json(stats);
    } catch (err) {
      res.status(500).json({ ok: false, error: "vault_stats_failed" });
    }
  });

  // ── Downloads ─────────────────────────────────────────────────────
  router.post("/download", (req, res) => {
    const result = recordDownload(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/downloads/user/:userId", (req, res) => {
    const { limit, offset } = req.query;
    const result = getUserDownloads(db, req.params.userId, {
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
    res.json(result);
  });

  router.get("/downloads/count/:artifactId", (req, res) => {
    const count = getArtifactDownloadCount(db, req.params.artifactId);
    res.json({ ok: true, artifactId: req.params.artifactId, downloadCount: count });
  });

  router.get("/downloads/check/:artifactId/:userId", (req, res) => {
    const downloaded = hasUserDownloaded(db, req.params.artifactId, req.params.userId);
    res.json({ ok: true, hasDownloaded: downloaded });
  });

  // ── CRI Cache ─────────────────────────────────────────────────────
  router.post("/cri/cache", (req, res) => {
    const result = cacheInCRI(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.post("/cri/serve", (req, res) => {
    const { criId, vaultHash } = req.body || {};
    recordCRIServe(db, { criId, vaultHash });
    res.json({ ok: true });
  });

  router.delete("/cri/cache", (req, res) => {
    const result = evictFromCRI(db, req.body || {});
    res.json(result);
  });

  router.get("/cri/:criId/contents", (req, res) => {
    const result = getCRICacheContents(db, req.params.criId);
    res.json(result);
  });

  router.get("/cri/:criId/stats", (req, res) => {
    const result = getCRICacheStats(db, req.params.criId);
    res.json(result);
  });

  router.post("/cri/:criId/evict-expired", (req, res) => {
    const result = evictExpiredCRIEntries(db, req.params.criId);
    res.json(result);
  });

  // ── Regional Stats ────────────────────────────────────────────────
  router.get("/regional/:artifactId", (req, res) => {
    const result = getRegionalStats(db, req.params.artifactId);
    res.json(result);
  });

  router.get("/regional/top/:regional", (req, res) => {
    const { limit } = req.query;
    const result = getTopRegionalArtifacts(db, req.params.regional, { limit: limit ? Number(limit) : 50 });
    res.json(result);
  });

  // ── Economics ─────────────────────────────────────────────────────
  router.get("/savings", (_req, res) => {
    const result = calculateStorageSavings(db);
    res.json(result);
  });

  return router;
}
