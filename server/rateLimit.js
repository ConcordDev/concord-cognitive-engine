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
  'utility.call': { max: 240, windowMs: 60000 },         // 240/min — entities need real-time interaction; deterministic, cheap
  'marketplace.submit': { max: 5, windowMs: 3600000 },   // 5/hour — governance, not hardware
  'global.pull': { max: 20, windowMs: 3600000 },         // 20/hour — stays same
  'semantic.search': { max: 100, windowMs: 60000 },      // 100/min — GPU: embedding search is near-instant
  'default': { max: 300, windowMs: 60000 },              // 300/min — GPU: room for background + user

  // Post-launch write endpoint limits (per IP). write.lens was 10/min shared
  // across EVERY lens's write action (all funnel through POST /api/lens/run,
  // the single dispatch endpoint for all 260+ lenses) — normal use blew
  // through that in seconds ("too many requests" reported site-wide). Concord
  // is mostly DETERMINISTIC: a rich lens fires many cheap macro POSTs per page
  // load + interaction, and HUDs/heartbeats poll continuously, so interactive
  // buckets are sized for burst throughput, not throttled like a scarce GPU
  // resource. Governance (marketplace.submit) + anti-spam (social/mail/upload)
  // buckets stay tight on purpose. See docs/LIVE_OPS_PUNCHLIST_2026-07-07.md A.2.
  'write.chat':         { max: 60,  windowMs: 60000 },   // POST /api/chat — 60/min
  'write.social':       { max: 20,  windowMs: 60000 },   // POST /api/social/* — 20/min (anti-spam)
  'write.lens':         { max: 300, windowMs: 60000 },   // POST /api/lens/* — 300/min (shared by EVERY lens action; deterministic burst)
  'write.dtus':         { max: 60,  windowMs: 60000 },   // POST /api/dtus — 60/min
  'write.media.upload': { max: 5,   windowMs: 60000 },   // POST /api/media/upload — 5/min
  'write.mail':         { max: 10,  windowMs: 60000 },   // POST /api/mail/send — 10/min per user (anti-spam; auth-gated, capped payload)
  'write.client-error': { max: 50,  windowMs: 60000 },   // POST /api/client-error — 50/min per IP (anon telemetry; an error storm must not self-DoS)
  'write.default':      { max: 120, windowMs: 60000 },   // All other POST/PUT/DELETE — 120/min
  'read.default':       { max: 1200, windowMs: 60000 },  // GET routes — 1200/min (20/s; many HUDs poll every 1-2s + heartbeat feeds)
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

/**
 * Paths that must NEVER be rate-limited: the realtime transport and liveness
 * probes. Socket.IO's HTTP long-polling fallback hits `/socket.io/` with a
 * stream of GET+POST requests during the handshake and while polling — if one
 * of those 429s, the client sees a transport error and drops the connection
 * ("connection lost mid-operation"). Health/liveness checks must also always
 * answer. Checked before any bucket accounting in every middleware.
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function isRateLimitExemptPath(req) {
  const p = req.path || req.url || "";
  return (
    p.startsWith("/socket.io") ||
    p === "/api/health" ||
    p === "/api/healthz" ||
    p === "/health" ||
    p === "/healthz" ||
    p === "/api/ping"
  );
}

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
    if (isRateLimitExemptPath(req)) return next();
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
  if (isRateLimitExemptPath(req)) return next();
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
  if (isRateLimitExemptPath(req)) return next();

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

export { checkRateLimit, rateLimitMiddleware, LIMITS, classifyWriteEndpoint, writeRateLimitMiddleware, readRateLimitMiddleware, isRateLimitExemptPath };
