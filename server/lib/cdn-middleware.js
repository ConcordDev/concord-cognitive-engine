/**
 * Concord CDN Middleware — Express middleware for CDN integration.
 *
 * Provides three middleware functions:
 *   1. cdnMiddleware    — Rewrites media URLs to CDN URLs, tracks hit/miss metrics
 *   2. cdnCacheHeaders  — Sets Cache-Control, ETag, and Vary headers
 *   3. cdnCorsHeaders   — Sets CORS headers for cross-origin media requests
 *
 * The middleware is designed to be non-destructive: if no CDN manager is
 * provided or the CDN is in 'local' mode, requests pass through unchanged
 * and are served directly from the origin vault.
 */

import { createHash } from "node:crypto";

// ── Content type to cache policy mapping ───────────────────────────────

const CACHE_POLICIES = {
  // Hashed content is immutable — cache forever
  immutable: {
    "Cache-Control": "public, max-age=31536000, immutable",
  },
  // HLS manifests change when new quality variants are added
  manifest: {
    "Cache-Control": "public, max-age=5, stale-while-revalidate=10",
  },
  // Thumbnails change rarely
  thumbnail: {
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
  },
  // Short-lived content (API responses, metadata)
  shortLived: {
    "Cache-Control": "public, max-age=60, stale-while-revalidate=30",
  },
  // Private content — never cache on shared caches
  private: {
    "Cache-Control": "private, no-store",
  },
};

/**
 * Determine the cache policy key based on the request path and content type.
 *
 * @param {import('express').Request} req
 * @returns {string} Cache policy key
 */
function resolveCachePolicy(req) {
  const path = req.path;

  // HLS manifests
  if (path.endsWith(".m3u8") || path.includes("/manifest")) {
    return "manifest";
  }

  // Thumbnails
  if (path.includes("/thumbnail")) {
    return "thumbnail";
  }

  // Stream endpoints serving actual media data (content-addressed, immutable)
  if (path.includes("/stream")) {
    return "immutable";
  }

  // Signed URLs (private access)
  if (req.query.token) {
    return "private";
  }

  return "shortLived";
}

// ── Main CDN Middleware ────────────────────────────────────────────────

/**
 * Express middleware that integrates CDN URL rewriting and hit/miss tracking.
 *
 * When a CDN manager is provided and the provider is not 'local':
 *   - Adds `res.locals.cdnUrl` with the CDN URL for the current artifact
 *   - Tracks CDN cache hits and misses via the X-Cache header from upstream
 *   - On CDN miss, the response is served from origin vault and the
 *     CDN manager records the miss for metrics
 *
 * @param {object|null} cdnManager - CDN manager from createCDNManager(), or null
 * @returns {import('express').RequestHandler}
 */
export function cdnMiddleware(cdnManager) {
  return (req, res, next) => {
    // If no CDN manager, pass through
    if (!cdnManager) {
      res.locals.cdnEnabled = false;
      return next();
    }

    const providerInfo = cdnManager.getProviderInfo();
    res.locals.cdnEnabled = providerInfo.provider !== "local";
    res.locals.cdnProvider = providerInfo.provider;

    // Extract artifact hash from URL patterns:
    //   /api/media/:hash/stream
    //   /api/media/:hash/thumbnail
    //   /api/cdn/signed-url/:hash
    const hashMatch = req.path.match(/\/([a-f0-9]{8,128})\//i)
      || req.path.match(/\/([a-f0-9]{8,128})$/i)
      || req.path.match(/\/(media-[a-f0-9-]+)\//i)
      || req.path.match(/\/(media-[a-f0-9-]+)$/i);

    if (hashMatch) {
      const artifactHash = hashMatch[1];
      res.locals.artifactHash = artifactHash;

      // Generate CDN URL for this artifact
      const quality = req.query.quality || "original";
      res.locals.cdnUrl = cdnManager.getUrl(artifactHash, { quality });

      // Check CDN cache status for metrics
      const cacheStatus = cdnManager.getCacheStatus(artifactHash);
      if (cacheStatus.cached) {
        cdnManager.recordHit();
        res.set("X-CDN-Cache", "HIT");
      } else {
        cdnManager.recordMiss();
        res.set("X-CDN-Cache", "MISS");
      }
    }

    // Add CDN provider header
    res.set("X-CDN-Provider", providerInfo.provider);

    // Track bytes served on response finish
    const originalEnd = res.end;
    res.end = function (...args) {
      if (cdnManager && res.locals.artifactHash) {
        const contentLength = parseInt(res.get("Content-Length") || "0", 10);
        if (contentLength > 0) {
          cdnManager.recordBytesServed(contentLength);
        }
      }
      return originalEnd.apply(this, args);
    };

    next();
  };
}

// ── Cache Headers Middleware ───────────────────────────────────────────

/**
 * Express middleware that sets appropriate Cache-Control, ETag, and Vary
 * headers based on content type and request path.
 *
 * @param {number} [defaultMaxAge=86400] - Default max-age in seconds (24h)
 * @returns {import('express').RequestHandler}
 */
export function cdnCacheHeaders(defaultMaxAge = 86400) {
  return (req, res, next) => {
    // Determine cache policy
    const policyKey = resolveCachePolicy(req);
    const policy = CACHE_POLICIES[policyKey];

    if (policy) {
      res.set("Cache-Control", policy["Cache-Control"]);
    } else {
      res.set("Cache-Control", `public, max-age=${defaultMaxAge}`);
    }

    // Vary header — ensure caches differentiate by these request headers
    res.set("Vary", "Accept-Encoding, Range, Origin");

    // Generate ETag from artifact hash if available
    // This allows CDN and browser caches to validate cached content
    const onSend = () => {
      // Only set ETag if not already set
      if (!res.get("ETag")) {
        const artifactHash = res.locals.artifactHash;
        if (artifactHash) {
          // Weak ETag based on artifact hash — sufficient for cache validation
          res.set("ETag", `W/"${artifactHash}"`);
        } else {
          // Generate ETag from response body hash (for non-artifact responses)
          // This is handled naturally by Express for JSON responses
        }
      }
    };

    // Hook into the response to set ETag before headers are sent
    const originalWriteHead = res.writeHead;
    res.writeHead = function (statusCode, ...rest) {
      onSend();
      return originalWriteHead.call(this, statusCode, ...rest);
    };

    // Support conditional requests (If-None-Match)
    const ifNoneMatch = req.get("If-None-Match");
    const artifactHash = req.params.id || req.params.hash;
    if (ifNoneMatch && artifactHash) {
      const expectedETag = `W/"${artifactHash}"`;
      if (ifNoneMatch === expectedETag || ifNoneMatch === `"${artifactHash}"`) {
        res.status(304).end();
        return;
      }
    }

    next();
  };
}

// ── CORS Headers Middleware ───────────────────────────────────────────

/**
 * Express middleware that sets CORS headers for cross-origin media requests.
 *
 * Media assets (audio, video, images) are frequently loaded from CDN domains
 * that differ from the application origin. These headers ensure browsers
 * allow cross-origin access to media resources.
 *
 * @returns {import('express').RequestHandler}
 */
export function cdnCorsHeaders() {
  // Allowed origins. In production we REQUIRE CONCORD_FRONTEND_URL to be set —
  // a localhost default in prod becomes an unintended CORS allow-list entry
  // and a quiet wrong-domain bug. Dev uses localhost only when NODE_ENV !== "production".
  const isProd = process.env.NODE_ENV === "production";
  const frontendUrl = process.env.CONCORD_FRONTEND_URL
    || (isProd ? null : "http://localhost:3000");
  if (isProd && !frontendUrl) {
    throw new Error("CONCORD_FRONTEND_URL must be set in production (cdn-middleware.cdnCorsHeaders)");
  }
  const allowedOrigins = new Set([
    frontendUrl,
    process.env.CONCORD_CDN_BASE_URL || "",
  ].filter(Boolean));

  return (req, res, next) => {
    const origin = req.get("Origin");

    // Allow the request origin if it matches, or use wildcard for public media
    if (origin && allowedOrigins.has(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
    } else if (isPublicMediaPath(req.path)) {
      // Public media assets can be accessed from any origin
      res.set("Access-Control-Allow-Origin", "*");
    }

    // Headers needed for media streaming
    res.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Range, Content-Type, Authorization, X-Requested-With");
    res.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges, Content-Type, X-CDN-Cache, X-CDN-Provider");
    res.set("Access-Control-Max-Age", "86400"); // Cache preflight for 24h

    // Accept range requests for streaming
    res.set("Accept-Ranges", "bytes");

    // Handle preflight
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Determine if a path serves public media content (no auth required).
 * Public media paths include streams, thumbnails, and manifests.
 *
 * @param {string} path
 * @returns {boolean}
 */
function isPublicMediaPath(path) {
  return (
    path.includes("/stream") ||
    path.includes("/thumbnail") ||
    path.endsWith(".m3u8") ||
    path.includes("/manifest")
  );
}
