/**
 * Concord CDN Routes — Admin and public API for CDN management.
 *
 * Provides:
 *   GET  /api/cdn/status            — CDN health and provider info (admin)
 *   POST /api/cdn/purge             — Purge specific artifact from CDN (admin)
 *   POST /api/cdn/purge-all         — Purge all cached content (admin)
 *   GET  /api/cdn/signed-url/:hash  — Get signed URL for artifact (authenticated)
 *   GET  /api/cdn/stream-token/:hash — Get streaming token (authenticated)
 *   GET  /api/cdn/stats             — CDN bandwidth/cache stats (admin)
 *
 * Follows the same pattern as other Concord route files:
 *   export default function createCDNRouter({ cdnManager, urlSigner, STATE }) { ... }
 */

import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { ValidationError, AuthorizationError } from "../lib/errors.js";
import { canAccessMediaDTU } from "../lib/media-dtu.js";

/**
 * Create the CDN routes router.
 *
 * @param {object} deps
 * @param {object} deps.cdnManager  — CDN manager from createCDNManager()
 * @param {object} deps.urlSigner   — URL signer from createURLSigner()
 * @param {object} [deps.STATE]     — Global application state (for media DTU lookups)
 * @returns {Router}
 */
export default function createCDNRouter({ cdnManager, urlSigner, STATE }) {
  const router = Router();

  // CDN may be unconfigured (mounted with cdnManager: null) — every handler
  // below dereferences cdnManager, so without this a single request crashes on a
  // null deref and the error falls through to the chat catch-all (playtest #R8).
  // Fail cleanly with 503 instead.
  if (!cdnManager) {
    router.use((_req, res) => res.status(503).json({ ok: false, error: "cdn_not_configured" }));
    return router;
  }

  // ── Helper: check admin role ──────────────────────────────────────

  function requireAdmin(req) {
    // In production, this would check req.user.role === 'admin'.
    // For now, allow if user is present or in development mode.
    const isAdmin = req.user?.role === "admin"
      || req.user?.isAdmin === true
      || process.env.NODE_ENV !== "production";

    if (!isAdmin) {
      throw new AuthorizationError("Admin access required for CDN management");
    }
  }

  // ── Helper: check authenticated ───────────────────────────────────

  function requireAuth(req) {
    const userId = req.user?.id;
    if (!userId) {
      throw new AuthorizationError("Authentication required");
    }
    return userId;
  }

  // ── GET /status — CDN health and provider info (admin) ────────────

  router.get("/status", asyncHandler(async (req, res) => {
    requireAdmin(req);

    const [health, providerInfo, stats] = await Promise.all([
      cdnManager.healthCheck(),
      cdnManager.getProviderInfo(),
      cdnManager.getStats(),
    ]);

    res.json({
      ok: true,
      health,
      provider: providerInfo,
      stats,
    });
  }));

  // ── GET /info — Public CDN info for frontend media URL resolution ────
  router.get("/info", asyncHandler(async (_req, res) => {
    const providerInfo = await cdnManager.getProviderInfo().catch(() => ({}));
    res.json({
      ok: true,
      cdn: {
        provider: providerInfo?.provider || "local",
        configured: providerInfo?.configured || false,
        baseUrl: providerInfo?.baseUrl || null,
      },
    });
  }));

  // ── POST /purge — Purge specific artifact from CDN (admin) ────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/purge", asyncHandler(async (req, res) => {
    requireAdmin(req);

    const { artifactHash, prefix } = req.body;

    if (!artifactHash && !prefix) {
      throw new ValidationError("artifactHash or prefix is required");
    }

    let result;
    if (artifactHash) {
      result = await cdnManager.purge(artifactHash);
    } else {
      result = await cdnManager.purgeByPrefix(prefix);
    }

    res.json(result);
  }));

  // ── POST /purge-all — Purge all cached content (admin) ────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/purge-all", asyncHandler(async (req, res) => {
    requireAdmin(req);

    // Purge by empty prefix matches everything
    const result = await cdnManager.purgeByPrefix("");

    res.json({
      ok: true,
      purgedAll: true,
      ...result,
    });
  }));

  // ── GET /signed-url/:hash — Get signed URL (authenticated) ───────

  router.get("/signed-url/:hash", asyncHandler(async (req, res) => {
    const userId = requireAuth(req);
    const { hash } = req.params;

    if (!hash) {
      throw new ValidationError("Artifact hash is required");
    }

    // Check if the artifact exists in the media store. Delegate to the
    // shared canAccessMediaDTU helper so CDN, direct-stream, and feed
    // paths can't drift out of sync on privacy rules.
    if (STATE && STATE._media) {
      const mediaDTU = STATE._media.mediaDTUs.get(hash);
      if (mediaDTU) {
        const access = canAccessMediaDTU(STATE, mediaDTU, userId);
        if (!access.allowed) {
          throw new AuthorizationError(access.reason || "You do not have access to this content");
        }
      }
    }

    // Determine expiry from query or default to 24h
    const expiresIn = req.query.expires
      ? parseInt(req.query.expires, 10)
      : 86400;

    // Get the CDN URL for the artifact
    const cdnUrl = cdnManager.getUrl(hash);

    // Sign the URL
    const signed = urlSigner.sign(cdnUrl, expiresIn);

    res.json({
      ok: true,
      artifactHash: hash,
      signedUrl: signed.signedUrl,
      expiresAt: signed.expiresAt,
    });
  }));

  // ── GET /stream-token/:hash — Get streaming token (authenticated) ─

  router.get("/stream-token/:hash", asyncHandler(async (req, res) => {
    const userId = requireAuth(req);
    const { hash } = req.params;

    if (!hash) {
      throw new ValidationError("Artifact hash is required");
    }

    // Verify access rights (same as signed URL)
    if (STATE && STATE._media) {
      const mediaDTU = STATE._media.mediaDTUs.get(hash);
      if (mediaDTU) {
        const access = canAccessMediaDTU(STATE, mediaDTU, userId);
        if (!access.allowed) {
          throw new AuthorizationError(access.reason || "You do not have access to this content");
        }
      }
    }

    // Duration from query or default to 4h
    const duration = req.query.duration
      ? parseInt(req.query.duration, 10)
      : 14400;

    const tokenResult = urlSigner.generateStreamToken(hash, userId, duration);

    res.json({
      ok: true,
      artifactHash: hash,
      token: tokenResult.token,
      expiresAt: tokenResult.expiresAt,
    });
  }));

  // ── GET /stats — CDN bandwidth/cache stats (admin) ────────────────

  router.get("/stats", asyncHandler(async (req, res) => {
    requireAdmin(req);

    const stats = cdnManager.getStats();
    const providerInfo = cdnManager.getProviderInfo();

    res.json({
      ok: true,
      provider: providerInfo.provider,
      ...stats,
    });
  }));

  // ── GET /cache-status/:hash — Cache status for an artifact ────────

  router.get("/cache-status/:hash", asyncHandler(async (req, res) => {
    const { hash } = req.params;

    if (!hash) {
      throw new ValidationError("Artifact hash is required");
    }

    const status = cdnManager.getCacheStatus(hash);

    res.json({
      ok: true,
      ...status,
    });
  }));

  // ── POST /push — Push artifact to CDN origin (admin) ──────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/push", asyncHandler(async (req, res) => {
    requireAdmin(req);

    const { artifactHash, contentType } = req.body;

    if (!artifactHash) {
      throw new ValidationError("artifactHash is required");
    }

    // In production, this would read the artifact from the vault.
    // Here we push a placeholder to register it in the CDN.
    const buffer = Buffer.alloc(0);
    const result = await cdnManager.pushToOrigin(
      artifactHash,
      buffer,
      contentType || "application/octet-stream"
    );

    res.json(result);
  }));

  // ── GET /verify-token — Verify a signed URL or stream token ───────

  router.get("/verify-token", asyncHandler(async (req, res) => {
    const { url: signedUrl, token } = req.query;

    if (!signedUrl && !token) {
      throw new ValidationError("Provide either url (signed URL) or token (stream token) to verify");
    }

    let result;
    if (signedUrl) {
      result = urlSigner.verify(signedUrl);
    } else {
      result = urlSigner.verifyStreamToken(token);
    }

    res.json(result);
  }));

  // ── GET /info — Public CDN configuration info ─────────────────────

  router.get("/info", (_req, res) => {
    const providerInfo = cdnManager.getProviderInfo();
    const signerInfo = urlSigner.getInfo();

    res.json({
      ok: true,
      cdn: {
        provider: providerInfo.provider,
        description: providerInfo.description,
        configured: providerInfo.configured,
        baseUrl: providerInfo.baseUrl || null,
      },
      signer: {
        algorithm: signerInfo.algorithm,
        defaultExpiry: signerInfo.defaultExpiry,
        maxExpiry: signerInfo.maxExpiry,
      },
    });
  });

  return router;
}
