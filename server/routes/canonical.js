/**
 * Canonical DTU Architecture API Routes
 *
 * Unified API surface for:
 * - Canonical deduplication (register, lookup, stats)
 * - Integrity verification (verify, chain verify, reports)
 * - Usage rights management (assign, check, transfer, revoke)
 * - Compression pipeline (compress, stats)
 *
 * Route prefix: /api/canonical
 */

import { asyncHandler } from "../lib/async-handler.js";

/**
 * Lazy per-request delegate for a subsystem that is created after these
 * routes register (initExtensions → app.locals.*). Reads resolve() on every
 * access; when the subsystem is absent the access throws an error whose
 * code is "<name>_unavailable", which `route()` below turns into a clean
 * 503 instead of a TypeError. `available` reports presence without throwing.
 *
 * @param {string} name - e.g. "canonical_store"
 * @param {() => object|null|undefined} resolve
 */
export function lazyDelegate(name, resolve) {
  return new Proxy({}, {
    get(_t, prop) {
      const sys = resolve();
      if (prop === "available") return !!sys;
      if (!sys) throw Object.assign(new Error(`${name}_unavailable`), { code: `${name}_unavailable` });
      const v = sys[prop];
      return typeof v === "function" ? v.bind(sys) : v;
    },
  });
}

// asyncHandler + structured 503 for a missing subsystem.
function route(fn) {
  return asyncHandler(async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      if (typeof err?.code === "string" && err.code.endsWith("_unavailable")) {
        return res.status(503).json({ ok: false, error: err.code });
      }
      throw err;
    }
  });
}

/**
 * Register canonical DTU routes on the Express app.
 *
 * @param {import("express").Application} app - Express app
 * @param {object} deps - Dependencies
 * @param {object} deps.canonicalStore - Canonical registry store
 * @param {object} deps.integritySystem - Integrity verification system
 * @param {object} deps.compressionPipeline - Compression pipeline
 * @param {object} deps.rightsManager - Rights management system
 * @param {object} deps.STATE - Application state (contains dtus Map)
 */
export default function registerCanonicalRoutes(app, deps) {
  const {
    canonicalStore,
    integritySystem,
    compressionPipeline,
    rightsManager,
    STATE,
  } = deps;

  // ── Canonical Deduplication ─────────────────────────────────────────

  /**
   * GET /api/canonical/stats
   * Deduplication and compression statistics.
   */
  app.get("/api/canonical/stats", route(async (req, res) => {
    const dedupStats = canonicalStore.getStats();
    const integrityStats = integritySystem.getStats();
    const compressionStats = compressionPipeline.getPipelineStats();

    res.json({
      ok: true,
      dedup: dedupStats,
      integrity: integrityStats,
      compression: compressionStats,
    });
  }));

  /**
   * POST /api/canonical/register
   * Register content and get the canonical DTU ID.
   * If the content already exists, returns the existing canonical.
   *
   * Body: { content: string|object, dtuId?: string, contentType?: string }
   */
  app.post("/api/canonical/register", route(async (req, res) => {
    const { content, dtuId, contentType } = req.body || {};

    if (content === undefined || content === null) {
      return res.status(400).json({ ok: false, error: "Missing content" });
    }

    // Register in canonical store
    const result = canonicalStore.register(content, {
      dtuId,
      contentSize: Buffer.byteLength(
        typeof content === "object" ? JSON.stringify(content) : String(content),
        "utf8"
      ),
    });

    // If new, compress and record compression stats
    if (result.isNew && compressionPipeline && compressionPipeline.available !== false) {
      const contentStr = typeof content === "object" ? JSON.stringify(content) : String(content);
      const compressed = compressionPipeline.compress(contentStr, contentType || "application/json");
      canonicalStore.updateCompression(result.contentHash, compressed.compressedSize);

      result.compression = {
        algorithm: compressed.algorithmName,
        originalSize: compressed.originalSize,
        compressedSize: compressed.compressedSize,
        ratio: compressed.ratio,
      };
    }

    res.json({
      ok: true,
      isNew: result.isNew,
      contentHash: result.contentHash,
      canonicalDtuId: result.canonicalDtuId,
      referenceCount: result.referenceCount,
      compression: result.compression || null,
    });
  }));

  /**
   * GET /api/canonical/:hash
   * Look up a canonical entry by content hash.
   */
  app.get("/api/canonical/lookup/:hash", route(async (req, res) => {
    const { hash } = req.params;

    const entry = canonicalStore.lookupByHash(hash);
    if (!entry) {
      return res.status(404).json({ ok: false, error: "Content hash not found" });
    }

    res.json({ ok: true, canonical: entry });
  }));

  /**
   * GET /api/canonical/duplicates
   * Get top duplicated content entries.
   */
  app.get("/api/canonical/duplicates", route(async (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const duplicates = canonicalStore.getTopDuplicates(limit);
    res.json({ ok: true, duplicates });
  }));

  // ── Integrity Verification ─────────────────────────────────────────

  /**
   * POST /api/canonical/verify
   * Verify a DTU's integrity.
   *
   * Body: { dtuId: string }
   */
  app.post("/api/canonical/verify", route(async (req, res) => {
    const { dtuId } = req.body || {};

    if (!dtuId) {
      return res.status(400).json({ ok: false, error: "Missing dtuId" });
    }

    // Look up the DTU
    const dtu = STATE.dtus.get(dtuId);
    if (!dtu) {
      return res.status(404).json({ ok: false, error: "DTU not found" });
    }

    const result = integritySystem.verify(dtu);
    res.json(result);
  }));

  /**
   * POST /api/canonical/verify-chain
   * Verify the entire derivative chain starting from a DTU.
   *
   * Body: { dtuId: string }
   */
  app.post("/api/canonical/verify-chain", route(async (req, res) => {
    const { dtuId } = req.body || {};

    if (!dtuId) {
      return res.status(400).json({ ok: false, error: "Missing dtuId" });
    }

    const result = integritySystem.verifyChain(dtuId);
    res.json(result);
  }));

  /**
   * GET /api/canonical/integrity/:id
   * Get integrity report for a DTU.
   */
  app.get("/api/canonical/integrity/:id", route(async (req, res) => {
    const { id } = req.params;
    const report = integritySystem.getReport(id);
    res.json(report);
  }));

  /**
   * POST /api/canonical/integrity/generate
   * Generate integrity envelope for a DTU.
   *
   * Body: { dtuId: string }
   */
  app.post("/api/canonical/integrity/generate", route(async (req, res) => {
    const { dtuId } = req.body || {};

    if (!dtuId) {
      return res.status(400).json({ ok: false, error: "Missing dtuId" });
    }

    const dtu = STATE.dtus.get(dtuId);
    if (!dtu) {
      return res.status(404).json({ ok: false, error: "DTU not found" });
    }

    const result = integritySystem.generateIntegrity(dtu);
    res.json(result);
  }));

  /**
   * POST /api/canonical/integrity/batch-verify
   * Batch verify multiple DTUs.
   *
   * Body: { dtuIds: string[] }
   */
  app.post("/api/canonical/integrity/batch-verify", route(async (req, res) => {
    const { dtuIds } = req.body || {};

    if (!Array.isArray(dtuIds) || dtuIds.length === 0) {
      return res.status(400).json({ ok: false, error: "Missing or empty dtuIds array" });
    }

    // Cap batch size
    const capped = dtuIds.slice(0, 100);
    const result = integritySystem.batchVerify(capped);
    res.json(result);
  }));

  // ── Usage Rights ───────────────────────────────────────────────────

  /**
   * GET /api/canonical/:id/rights
   * Get rights for a DTU.
   */
  app.get("/api/canonical/:id/rights", route(async (req, res) => {
    const { id } = req.params;
    const report = rightsManager.getRightsReport(id);
    res.json(report);
  }));

  /**
   * PUT /api/canonical/:id/rights
   * Assign or update rights for a DTU.
   *
   * Body: { creatorId, ownerId?, derivativeAllowed?, commercialAllowed?,
   *         attributionRequired?, scope?, license?, expiration?, transferable?, maxDerivatives? }
   */
  app.put("/api/canonical/:id/rights", route(async (req, res) => {
    const { id } = req.params;
    const rights = req.body || {};

    if (!rights.creatorId) {
      return res.status(400).json({ ok: false, error: "Missing creatorId" });
    }

    const result = rightsManager.assignRights(id, rights);
    if (!result.ok) {
      return res.status(400).json(result);
    }

    res.json(result);
  }));

  /**
   * POST /api/canonical/:id/rights/check
   * Check if a user can perform an action.
   *
   * Body: { userId: string, action: string }
   */
  app.post("/api/canonical/:id/rights/check", route(async (req, res) => {
    const { id } = req.params;
    const { userId, action } = req.body || {};

    if (!userId || !action) {
      return res.status(400).json({ ok: false, error: "Missing userId or action" });
    }

    const result = rightsManager.checkPermission(id, userId, action);
    res.json({ ok: true, dtuId: id, userId, action, ...result });
  }));

  /**
   * POST /api/canonical/:id/rights/transfer
   * Transfer ownership of a DTU.
   *
   * Body: { fromUserId: string, toUserId: string }
   */
  app.post("/api/canonical/:id/rights/transfer", route(async (req, res) => {
    const { id } = req.params;
    const { fromUserId, toUserId } = req.body || {};

    if (!fromUserId || !toUserId) {
      return res.status(400).json({ ok: false, error: "Missing fromUserId or toUserId" });
    }

    const result = rightsManager.transferOwnership(id, fromUserId, toUserId);
    if (!result.ok) {
      return res.status(400).json(result);
    }

    res.json(result);
  }));

  /**
   * POST /api/canonical/:id/rights/revoke
   * Revoke a user's access.
   *
   * Body: { userId: string }
   */
  app.post("/api/canonical/:id/rights/revoke", route(async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body || {};

    if (!userId) {
      return res.status(400).json({ ok: false, error: "Missing userId" });
    }

    const result = rightsManager.revokeAccess(id, userId);
    if (!result.ok) {
      return res.status(400).json(result);
    }

    res.json(result);
  }));

  /**
   * POST /api/canonical/:id/rights/derivative
   * Grant derivative rights.
   *
   * Body: { grantedTo?: string, maxDerivatives?: number, commercialDerivatives?: boolean }
   */
  app.post("/api/canonical/:id/rights/derivative", route(async (req, res) => {
    const { id } = req.params;
    const terms = req.body || {};

    const result = rightsManager.grantDerivativeRights(id, terms);
    if (!result.ok) {
      return res.status(400).json(result);
    }

    res.json(result);
  }));

  /**
   * GET /api/canonical/:id/rights/commercial
   * Check commercial rights for a DTU.
   */
  app.get("/api/canonical/:id/rights/commercial", route(async (req, res) => {
    const { id } = req.params;
    const result = rightsManager.checkCommercialRights(id);
    res.json({ ok: true, dtuId: id, ...result });
  }));

  // ── Compression ────────────────────────────────────────────────────

  /**
   * POST /api/canonical/compress
   * Compress DTU content.
   *
   * Body: { content: string, contentType?: string }
   */
  app.post("/api/canonical/compress", route(async (req, res) => {
    const { content, contentType } = req.body || {};

    if (content === undefined || content === null) {
      return res.status(400).json({ ok: false, error: "Missing content" });
    }

    const result = compressionPipeline.compress(
      typeof content === "object" ? JSON.stringify(content) : String(content),
      contentType || "application/json"
    );

    res.json({
      ok: true,
      algorithm: result.algorithmName,
      originalSize: result.originalSize,
      compressedSize: result.compressedSize,
      ratio: result.ratio,
      savings: result.originalSize - result.compressedSize,
      savingsPercent: ((1 - result.ratio) * 100).toFixed(1) + "%",
      reason: result.reason,
      // Return base64 of compressed data for transport
      compressedBase64: result.compressed.toString("base64"),
    });
  }));

  /**
   * GET /api/canonical/compression-stats
   * Storage savings report from the compression pipeline.
   */
  app.get("/api/canonical/compression-stats", route(async (req, res) => {
    const pipelineStats = compressionPipeline.getPipelineStats();
    const dedupStats = canonicalStore.getStats();

    res.json({
      ok: true,
      pipeline: pipelineStats,
      dedup: {
        totalCanonicals: dedupStats.totalCanonicals,
        totalReferences: dedupStats.totalReferences,
        duplicatesPrevented: dedupStats.duplicatesPrevented,
        storageSaved: dedupStats.storageSaved,
      },
      combined: {
        totalOriginalBytes: pipelineStats.totalOriginalBytes + dedupStats.storageSaved,
        totalStoredBytes: pipelineStats.totalCompressedBytes,
        overallSavingsPercent: pipelineStats.totalOriginalBytes > 0
          ? (((pipelineStats.totalOriginalBytes + dedupStats.storageSaved - pipelineStats.totalCompressedBytes)
              / (pipelineStats.totalOriginalBytes + dedupStats.storageSaved)) * 100).toFixed(1) + "%"
          : "0.0%",
      },
    });
  }));

  /**
   * GET /api/canonical/licenses
   * List available license types.
   */
  app.get("/api/canonical/licenses", route(async (req, res) => {
    res.json({
      ok: true,
      licenses: rightsManager.LICENSE_TYPES,
    });
  }));
}
