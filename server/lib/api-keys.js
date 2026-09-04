/**
 * Concord API Key Management — v1.0
 *
 * Generates, validates, revokes, and tracks usage of API keys
 * prefixed with "csk_" (Concord Secret Key). Keys are 32-byte
 * random hex strings stored in-memory with scoping, rate limits,
 * and per-call usage counters.
 *
 * Storage is an in-memory Map keyed by key ID. The raw key is
 * only returned once at creation time; subsequent lookups use
 * a SHA-256 hash for constant-time comparison.
 */

import crypto from "crypto";

// ── In-memory stores ────────────────────────────────────────────────────────
/** @type {Map<string, any>} keyId -> key metadata */
const KEY_STORE = new Map();
/** @type {Map<string, string>} sha256(rawKey) -> keyId (lookup index) */
const HASH_INDEX = new Map();

// ── Helpers ─────────────────────────────────────────────────────────────────

function nowISO() {
  return new Date().toISOString();
}

function uid(prefix = "csk") {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function hashKey(rawKey) {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

// ── Core API ────────────────────────────────────────────────────────────────

/**
 * Generate a new API key for a user.
 *
 * @param {string} userId - Owner of the key
 * @param {string[]} [scopes=[]] - Domain names the key can access (empty = all)
 * @param {object} [rateLimit] - Custom rate limit overrides
 * @param {number} [rateLimit.requestsPerMinute=60]
 * @param {number} [rateLimit.requestsPerDay=10000]
 * @returns {{ ok: boolean, key?: any, rawKey?: string, error?: string, limit?: number }}
 */
export function generateKey(userId, scopes = [], rateLimit = {}) {
  if (!userId) {
    return { ok: false, error: "missing_user_id" };
  }

  // Enforce max keys per user (same limit as billing constants: 5)
  const userKeyCount = [...KEY_STORE.values()].filter(
    (k) => k.userId === userId && !k.revoked
  ).length;
  if (userKeyCount >= 5) {
    return { ok: false, error: "max_keys_reached", limit: 5 };
  }

  const rawKey = `csk_${crypto.randomBytes(32).toString("hex")}`;
  const keyId = uid("cskid");
  const hash = hashKey(rawKey);
  const now = nowISO();

  const keyRecord = {
    id: keyId,
    userId,
    hash,
    prefix: rawKey.slice(0, 12) + "...",
    scopes: Array.isArray(scopes) ? scopes : [],
    rateLimit: {
      requestsPerMinute: rateLimit.requestsPerMinute || 60,
      requestsPerDay: rateLimit.requestsPerDay || 10000,
    },
    createdAt: now,
    lastUsed: null,
    usageCount: 0,
    revoked: false,
    revokedAt: null,
  };

  KEY_STORE.set(keyId, keyRecord);
  HASH_INDEX.set(hash, keyId);

  return {
    ok: true,
    key: { ...keyRecord, hash: undefined },
    rawKey, // only returned once at creation
  };
}

/**
 * Validate a raw API key string.
 *
 * @param {string} rawKey - The full "csk_..." key
 * @returns {{ ok: boolean, key?: any, error?: string }}
 */
export function validateKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string" || !rawKey.startsWith("csk_")) {
    return { ok: false, error: "invalid_key_format" };
  }

  const hash = hashKey(rawKey);
  const keyId = HASH_INDEX.get(hash);
  if (!keyId) {
    return { ok: false, error: "key_not_found" };
  }

  const record = KEY_STORE.get(keyId);
  if (!record) {
    return { ok: false, error: "key_not_found" };
  }

  if (record.revoked) {
    return { ok: false, error: "key_revoked" };
  }

  return {
    ok: true,
    key: { ...record, hash: undefined },
  };
}

/**
 * Revoke an API key by ID.
 *
 * @param {string} keyId - The key ID to revoke
 * @param {string} [userId] - Optional user ID for ownership verification
 * @returns {{ ok: boolean, error?: string, keyId?: string, revokedAt?: string }}
 */
export function revokeKey(keyId, userId) {
  const record = KEY_STORE.get(keyId);
  if (!record) {
    return { ok: false, error: "key_not_found" };
  }

  if (userId && record.userId !== userId) {
    return { ok: false, error: "not_owner" };
  }

  if (record.revoked) {
    return { ok: false, error: "already_revoked" };
  }

  record.revoked = true;
  record.revokedAt = nowISO();

  // Remove from hash index so it cannot be validated
  HASH_INDEX.delete(record.hash);

  return { ok: true, keyId, revokedAt: record.revokedAt };
}

/**
 * List all API keys for a user (hashes stripped).
 *
 * @param {string} userId
 * @returns {{ ok: boolean, keys?: any[], error?: string }}
 */
export function listKeys(userId) {
  if (!userId) {
    return { ok: false, error: "missing_user_id", keys: [] };
  }

  const keys = [...KEY_STORE.values()]
    .filter((k) => k.userId === userId)
    .map(({ hash, ...rest }) => rest);

  return { ok: true, keys };
}

/**
 * Track a usage event for a key (increment counter, update lastUsed).
 *
 * @param {string} keyId
 * @returns {{ ok: boolean, usageCount?: number, error?: string }}
 */
export function trackUsage(keyId) {
  const record = KEY_STORE.get(keyId);
  if (!record) {
    return { ok: false, error: "key_not_found" };
  }

  record.usageCount += 1;
  record.lastUsed = nowISO();

  return { ok: true, usageCount: record.usageCount };
}

/**
 * Get usage stats for a specific key.
 *
 * @param {string} keyId
 * @param {string} [userId] - Optional ownership check
 * @returns {{ ok: boolean, usage?: any, error?: string }}
 */
export function getKeyUsage(keyId, userId) {
  const record = KEY_STORE.get(keyId);
  if (!record) {
    return { ok: false, error: "key_not_found" };
  }

  if (userId && record.userId !== userId) {
    return { ok: false, error: "not_owner" };
  }

  return {
    ok: true,
    usage: {
      keyId: record.id,
      prefix: record.prefix,
      usageCount: record.usageCount,
      lastUsed: record.lastUsed,
      createdAt: record.createdAt,
      scopes: record.scopes,
      rateLimit: record.rateLimit,
      revoked: record.revoked,
    },
  };
}

/**
 * Update scopes and/or rate limit on an existing key.
 *
 * @param {string} keyId
 * @param {string} userId - Ownership verification
 * @param {{ scopes?: string[], rateLimit?: any }} updates
 * @returns {{ ok: boolean, key?: any, error?: string }}
 */
export function updateKey(keyId, userId, updates = {}) {
  const record = KEY_STORE.get(keyId);
  if (!record) {
    return { ok: false, error: "key_not_found" };
  }

  if (record.userId !== userId) {
    return { ok: false, error: "not_owner" };
  }

  if (record.revoked) {
    return { ok: false, error: "key_revoked" };
  }

  if (Array.isArray(updates.scopes)) {
    record.scopes = updates.scopes;
  }

  if (updates.rateLimit && typeof updates.rateLimit === "object") {
    if (updates.rateLimit.requestsPerMinute != null) {
      record.rateLimit.requestsPerMinute = updates.rateLimit.requestsPerMinute;
    }
    if (updates.rateLimit.requestsPerDay != null) {
      record.rateLimit.requestsPerDay = updates.rateLimit.requestsPerDay;
    }
  }

  return { ok: true, key: { ...record, hash: undefined } };
}

/**
 * Check whether a key's scopes allow access to a given domain/action.
 *
 * @param {any} keyRecord - The key metadata object
 * @param {string} domain - The lens domain being accessed
 * @returns {boolean}
 */
export function checkScope(keyRecord, domain) {
  // Empty scopes array means unrestricted access
  if (!keyRecord.scopes || keyRecord.scopes.length === 0) return true;
  // Wildcard
  if (keyRecord.scopes.includes("*")) return true;
  // Direct match
  return keyRecord.scopes.includes(domain);
}

// ── Persistence bridge ───────────────────────────────────────────────────────

/**
 * Load all active keys from the SQLite api_keys table into the in-memory
 * KEY_STORE / HASH_INDEX. Call this on backend boot so durable csk_ keys
 * survive pm2 restarts (the in-memory Maps are otherwise empty after a
 * restart, and `validateKey` would 401 every previously-issued token
 * even though its row is sitting in the DB).
 *
 * Idempotent: safe to call multiple times. Existing in-memory entries
 * for the same keyId are refreshed in place; HASH_INDEX stale entries
 * (where the DB row is gone or `is_active=0`) are pruned.
 *
 * @param {import("better-sqlite3").Database} db
 * @returns {{ loaded: number, skipped: number, pruned: number, error?: string }}
 */
export function loadKeysFromDb(db) {
  if (!db || typeof db.prepare !== "function") {
    return { loaded: 0, skipped: 0, pruned: 0 };
  }
  let loaded = 0;
  let skipped = 0;
  let pruned = 0;
  try {
    const rows = db
      .prepare(
        "SELECT id, user_id, name, key_hash, key_prefix, scopes, created_at, last_used_at, is_active, status FROM api_keys WHERE is_active = 1"
      )
      .all();
    const seenIds = new Set();
    for (const row of rows) {
      seenIds.add(row.id);
      if (!row.key_hash) {
        skipped++;
        continue;
      }
      let parsedScopes = [];
      try {
        parsedScopes = row.scopes ? JSON.parse(row.scopes) : [];
      } catch {
        parsedScopes = [];
      }
      const record = {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        hash: row.key_hash,
        prefix: row.key_prefix,
        scopes: Array.isArray(parsedScopes) ? parsedScopes : [],
        rateLimit: { requestsPerMinute: 60, requestsPerDay: 10000 },
        createdAt: row.created_at,
        lastUsed: row.last_used_at,
        usageCount: 0,
        revoked: row.status === "revoked" || row.is_active === 0,
        revokedAt: null,
      };
      KEY_STORE.set(row.id, record);
      HASH_INDEX.set(row.key_hash, row.id);
      loaded++;
    }
    // Prune HASH_INDEX entries for keys that no longer exist or are inactive
    for (const [hash, keyId] of HASH_INDEX.entries()) {
      if (!seenIds.has(keyId)) {
        HASH_INDEX.delete(hash);
        pruned++;
      }
    }
  } catch (err) {
    // If the table doesn't exist yet (early boot) or the schema is
    // mid-migration, return what we have so far rather than throwing.
    return { loaded, skipped, pruned, error: String(err?.message || err) };
  }
  return { loaded, skipped, pruned };
}

// ── Test helpers (not for production use) ───────────────────────────────────

/** @internal Clear all keys — for testing only */
export function _resetStore() {
  KEY_STORE.clear();
  HASH_INDEX.clear();
}

/** @internal Get store size — for testing only */
export function _storeSize() {
  return KEY_STORE.size;
}
