/**
 * Per-User Rate Limiting for Concord Cognitive Engine
 *
 * Endpoint-specific rate limits that prevent abuse without impacting normal usage.
 * Uses in-memory maps with automatic cleanup of stale entries.
 */

const rateLimits = new Map(); // key → { count, windowStart }
const MAX_RATE_LIMIT_ENTRIES = 50000;

const LIMITS = {
  'conscious.chat': { max: 30, windowMs: 60000 },       // 30/min — GPU: conversational speed
  'utility.call': { max: 60, windowMs: 60000 },          // 60/min — GPU: entities need real-time interaction
  'marketplace.submit': { max: 5, windowMs: 3600000 },   // 5/hour — governance, not hardware
  'global.pull': { max: 20, windowMs: 3600000 },         // 20/hour — stays same
  'semantic.search': { max: 100, windowMs: 60000 },      // 100/min — GPU: embedding search is near-instant
  'default': { max: 120, windowMs: 60000 },              // 120/min — GPU: room for background + user

  // Pre-launch write endpoint limits (per IP)
  'write.chat':         { max: 30, windowMs: 60000 },    // POST /api/chat — 30/min
  'write.social':       { max: 10, windowMs: 60000 },    // POST /api/social/* — 10/min
  'write.lens':         { max: 10, windowMs: 60000 },    // POST /api/lens/* — 10/min
  'write.dtus':         { max: 20, windowMs: 60000 },    // POST /api/dtus — 20/min
  'write.media.upload': { max: 5,  windowMs: 60000 },    // POST /api/media/upload — 5/min
  'write.mail':         { max: 10, windowMs: 60000 },    // POST /api/mail/send — 10/min per user (anti-spam; auth-gated, capped payload)
  'write.client-error': { max: 50, windowMs: 60000 },    // POST /api/client-error — 50/min per IP (anon telemetry; an error storm must not self-DoS)
  'write.default':      { max: 20, windowMs: 60000 },    // All other POST/PUT/DELETE — 20/min
  'read.default':       { max: 120, windowMs: 60000 },   // GET routes (open, rate limited) — 120/min
};

/**
 * Check if a user has exceeded the rate limit for an endpoint.
 * @param {string} userId - User ID or IP address
 * @param {string} endpoint - Endpoint category name
 * @returns {{ allowed: boolean, remaining: number, retryAfter?: number }}
 */
// Integration/smoke/e2e jobs fire many parallel unauth requests from one
// CI runner IP and burn through per-IP buckets in seconds, getting 429s
// instead of the asserted 401s from the auth middleware. The integration
// test workflow sets CONCORD_RATE_LIMIT_BYPASS=1 to relax the HTTP
// middlewares for the duration of those jobs only. Unit tests of the
// middleware itself (rate-limit.test.js) don't set the var, so the
// middleware logic is still exercised. Production never sets the var.
const _RATE_LIMIT_BYPASS = process.env.CONCORD_RATE_LIMIT_BYPASS === "1";

function checkRateLimit(userId, endpoint) {
  const limit = LIMITS[endpoint] || LIMITS.default;
  const key = `${userId}:${endpoint}`;

  if (!rateLimits.has(key)) {
    rateLimits.set(key, { count: 1, windowStart: Date.now() });
    return { allowed: true, remaining: limit.max - 1 };
  }

  const entry = rateLimits.get(key);

  // Window expired — reset
  if (Date.now() - entry.windowStart > limit.windowMs) {
    rateLimits.set(key, { count: 1, windowStart: Date.now() });
    return { allowed: true, remaining: limit.max - 1 };
  }

  // Within window
  entry.count++;
  const remaining = limit.max - entry.count;

  if (remaining < 0) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((entry.windowStart + limit.windowMs - Date.now()) / 1000),
    };
  }

  return { allowed: true, remaining };
}

/**
 * Express middleware factory for rate limiting.
 * @param {string} endpoint - Endpoint category name
 * @returns {import('express').RequestHandler}
 */
function rateLimitMiddleware(endpoint) {
  return (req, res, next) => {
    if (_RATE_LIMIT_BYPASS) return next();
    const userId = req.user?.id || req.user?.userId || req.ip;
    const result = checkRateLimit(userId, endpoint);

    res.setHeader('X-RateLimit-Remaining', result.remaining);

    if (!result.allowed) {
      res.setHeader('Retry-After', result.retryAfter);
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: result.retryAfter,
        endpoint,
      });
    }

    next();
  };
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now - entry.windowStart > 3600000) rateLimits.delete(key);
  }
  // Hard cap: evict oldest entries if still over limit
  if (rateLimits.size > MAX_RATE_LIMIT_ENTRIES) {
    const it = rateLimits.keys();
    for (let i = 0, n = rateLimits.size - MAX_RATE_LIMIT_ENTRIES; i < n; i++) {
      rateLimits.delete(it.next().value);
    }
  }
}, 300000).unref();

/**
 * Classify an incoming request to the appropriate write rate-limit bucket.
 * Returns the LIMITS key for the request, or null if no write limiting applies.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function classifyWriteEndpoint(req) {
  const method = req.method.toUpperCase();
  if (method !== "POST" && method !== "PUT" && method !== "DELETE" && method !== "PATCH") {
    return null; // Only limit mutating methods
  }

  const p = req.path;
  if (p.startsWith("/api/chat"))          return "write.chat";
  if (p.startsWith("/api/social"))        return "write.social";
  if (p.startsWith("/api/lens"))          return "write.lens";
  if (p.startsWith("/api/dtus") || p.startsWith("/api/dtu")) return "write.dtus";
  if (p.startsWith("/api/media/upload"))  return "write.media.upload";
  return "write.default";
}

/**
 * Express middleware: apply per-route write rate limits based on request path.
 * Designed for pre-launch: open write endpoints get per-IP rate limiting.
 */
function writeRateLimitMiddleware(req, res, next) {
  if (_RATE_LIMIT_BYPASS) return next();
  const bucket = classifyWriteEndpoint(req);
  if (!bucket) return next(); // GETs pass through

  const key = req.user?.id || req.ip;
  const result = checkRateLimit(key, bucket);

  res.setHeader("X-RateLimit-Remaining", result.remaining);
  res.setHeader("X-RateLimit-Bucket", bucket);

  if (!result.allowed) {
    res.setHeader("Retry-After", result.retryAfter);
    return res.status(429).json({
      ok: false,
      error: "Rate limit exceeded",
      retryAfter: result.retryAfter,
      bucket,
    });
  }

  next();
}

/**
 * Express middleware: rate limit open GET routes.
 */
function readRateLimitMiddleware(req, res, next) {
  if (_RATE_LIMIT_BYPASS) return next();
  if (req.method !== "GET") return next();

  const key = req.user?.id || req.ip;
  const result = checkRateLimit(key, "read.default");

  res.setHeader("X-RateLimit-Remaining", result.remaining);

  if (!result.allowed) {
    res.setHeader("Retry-After", result.retryAfter);
    return res.status(429).json({
      ok: false,
      error: "Rate limit exceeded",
      retryAfter: result.retryAfter,
    });
  }

  next();
}

export { checkRateLimit, rateLimitMiddleware, LIMITS, classifyWriteEndpoint, writeRateLimitMiddleware, readRateLimitMiddleware };
