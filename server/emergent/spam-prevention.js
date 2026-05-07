/**
 * Concord — General Spam Prevention System
 *
 * Extends beyond Atlas-specific anti-gaming to cover all user-generated content:
 * social posts, lens artifacts, DMs, comments, forum posts, media uploads.
 *
 * Provides:
 *   - Per-user rate limiting by content type
 *   - Burst detection (many actions in short window)
 *   - Repetitive content detection (same text posted multiple times)
 *   - New account restrictions (reduced limits for first 24 hours)
 *   - Account reputation scoring
 */

import logger from "../logger.js";

// ── Configuration ────────────────────────────────────────────────────────

const SPAM_CONFIG = {
  // Per-user hourly limits by action type
  HOURLY_LIMITS: {
    "social_post":     30,   // social feed posts per hour
    "lens_artifact":   20,   // lens artifact creations per hour
    "dm_message":      60,   // direct messages per hour
    "comment":         40,   // comments per hour
    "forum_post":      15,   // forum posts per hour
    "media_upload":    10,   // media uploads per hour
    "report":          5,    // abuse reports per hour (prevent report spam)
  },

  // Stricter limits for accounts < 24 hours old
  NEW_ACCOUNT_MULTIPLIER: 0.3,  // 30% of normal limits
  NEW_ACCOUNT_WINDOW_MS: 24 * 60 * 60 * 1000, // 24 hours

  // Burst detection: max actions in a short window
  BURST_WINDOW_MS: 60_000,  // 1 minute
  BURST_MAX: 10,             // max actions of any type in 1 minute

  // Repetitive content: same text hash within window
  REPEAT_WINDOW_MS: 3600_000, // 1 hour
  MAX_IDENTICAL_POSTS: 3,     // max identical content posts per hour

  // Reputation thresholds
  REPUTATION_BLOCK_THRESHOLD: -10,
};

// ── State ────────────────────────────────────────────────────────────────

const _rateBuckets = new Map();   // `${userId}:${action}` → { count, windowStart }
const _burstBuckets = new Map();  // userId → { count, windowStart }
const _contentHashes = new Map(); // `${userId}:${hash}` → { count, windowStart }
const _reputation = new Map();    // userId → number (starts at 0)

const HOUR_MS = 3_600_000;

// Periodic cleanup every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of _rateBuckets) {
    if (now - bucket.windowStart > HOUR_MS * 2) _rateBuckets.delete(key);
  }
  for (const [key, bucket] of _burstBuckets) {
    if (now - bucket.windowStart > SPAM_CONFIG.BURST_WINDOW_MS * 2) _burstBuckets.delete(key);
  }
  for (const [key, entry] of _contentHashes) {
    if (now - entry.windowStart > SPAM_CONFIG.REPEAT_WINDOW_MS * 2) _contentHashes.delete(key);
  }
}, 600_000);

// ── Core Functions ───────────────────────────────────────────────────────

/**
 * Simple string hash for content deduplication.
 */
function quickHash(text) {
  let h = 0;
  const str = (text || "").toLowerCase().trim();
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

/**
 * Check if an action is allowed for a user.
 * Returns { allowed, reason, retryAfterMs }
 *
 * @param {string} userId
 * @param {string} action - One of the HOURLY_LIMITS keys
 * @param {object} [opts]
 * @param {string} [opts.content] - Text content for duplicate detection
 * @param {string} [opts.accountCreatedAt] - ISO date of account creation
 */
export function checkSpamLimit(userId, action, opts = {}) {
  if (!userId) return { allowed: true };

  const now = Date.now();

  // ── Reputation check ──────────────────────────────────────────────
  const rep = _reputation.get(userId) || 0;
  if (rep <= SPAM_CONFIG.REPUTATION_BLOCK_THRESHOLD) {
    return {
      allowed: false,
      reason: "Account flagged for spam. Contact support.",
      code: "REPUTATION_BLOCKED",
    };
  }

  // ── Burst detection ───────────────────────────────────────────────
  let burst = _burstBuckets.get(userId);
  if (!burst || now - burst.windowStart > SPAM_CONFIG.BURST_WINDOW_MS) {
    burst = { count: 0, windowStart: now };
    _burstBuckets.set(userId, burst);
  }
  burst.count++;
  if (burst.count > SPAM_CONFIG.BURST_MAX) {
    adjustReputation(userId, -1);
    return {
      allowed: false,
      reason: "Slow down — too many actions in a short time.",
      code: "BURST_LIMIT",
      retryAfterMs: SPAM_CONFIG.BURST_WINDOW_MS - (now - burst.windowStart),
    };
  }

  // ── Per-action hourly rate limit ──────────────────────────────────
  let baseLimit = SPAM_CONFIG.HOURLY_LIMITS[action];
  if (!baseLimit) baseLimit = 60; // default fallback

  // Reduce limits for new accounts
  if (opts.accountCreatedAt) {
    const accountAge = now - new Date(opts.accountCreatedAt).getTime();
    if (accountAge < SPAM_CONFIG.NEW_ACCOUNT_WINDOW_MS) {
      baseLimit = Math.max(3, Math.floor(baseLimit * SPAM_CONFIG.NEW_ACCOUNT_MULTIPLIER));
    }
  }

  const rateKey = `${userId}:${action}`;
  let bucket = _rateBuckets.get(rateKey);
  if (!bucket || now - bucket.windowStart > HOUR_MS) {
    bucket = { count: 0, windowStart: now };
    _rateBuckets.set(rateKey, bucket);
  }
  bucket.count++;
  if (bucket.count > baseLimit) {
    adjustReputation(userId, -1);
    return {
      allowed: false,
      reason: `Rate limit exceeded for ${action.replace(/_/g, " ")}. Max ${baseLimit}/hour.`,
      code: "RATE_LIMIT",
      retryAfterMs: HOUR_MS - (now - bucket.windowStart),
    };
  }

  // ── Repetitive content detection ──────────────────────────────────
  if (opts.content && opts.content.length > 5) {
    const hash = quickHash(opts.content);
    const hashKey = `${userId}:${hash}`;
    let entry = _contentHashes.get(hashKey);
    if (!entry || now - entry.windowStart > SPAM_CONFIG.REPEAT_WINDOW_MS) {
      entry = { count: 0, windowStart: now };
      _contentHashes.set(hashKey, entry);
    }
    entry.count++;
    if (entry.count > SPAM_CONFIG.MAX_IDENTICAL_POSTS) {
      adjustReputation(userId, -2);
      return {
        allowed: false,
        reason: "Duplicate content detected. Please don't post the same thing repeatedly.",
        code: "DUPLICATE_CONTENT",
      };
    }
  }

  return { allowed: true };
}

/**
 * Adjust a user's reputation score.
 * Negative = spam-like behavior. Positive = good behavior.
 */
export function adjustReputation(userId, delta) {
  const current = _reputation.get(userId) || 0;
  const newRep = Math.max(-100, Math.min(100, current + delta));
  _reputation.set(userId, newRep);
  if (newRep <= SPAM_CONFIG.REPUTATION_BLOCK_THRESHOLD) {
    logger.warn("spam-prevention", `User ${userId} blocked — reputation ${newRep}`);
  }
}

/**
 * Get spam prevention metrics for admin dashboard.
 */
export function getSpamMetrics() {
  return {
    activeBuckets: _rateBuckets.size,
    burstBuckets: _burstBuckets.size,
    contentHashes: _contentHashes.size,
    trackedUsers: _reputation.size,
    blockedUsers: [..._reputation.entries()]
      .filter(([, rep]) => rep <= SPAM_CONFIG.REPUTATION_BLOCK_THRESHOLD)
      .map(([id, rep]) => ({ userId: id, reputation: rep })),
    config: SPAM_CONFIG,
  };
}

/**
 * Express middleware factory for spam prevention.
 * Attaches to write endpoints to check spam limits before processing.
 *
 * @param {string} action - The action type (e.g., "social_post")
 * @param {function} [getContent] - Optional function to extract content text from req
 */
export function spamGuard(action, getContent) {
  return (req, res, next) => {
    const userId = req.user?.id;
    if (!userId) return next(); // unauthenticated requests handled by auth middleware

    const opts = {
      accountCreatedAt: req.user?.createdAt,
    };

    if (getContent) {
      try { opts.content = getContent(req); } catch (err) { console.warn('[spam-prevention] failed to extract content from request', { err: err.message }); }
    }

    const result = checkSpamLimit(userId, action, opts);
    if (!result.allowed) {
      return res.status(429).json({
        ok: false,
        error: result.reason,
        code: result.code,
        retryAfterMs: result.retryAfterMs,
      });
    }

    next();
  };
}
