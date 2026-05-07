/**
 * Redis Adapter — Optional Infrastructure (ADR 005)
 *
 * Three-tier storage strategy: in-memory Map (primary) → Redis (optional) → SQLite (persistent).
 * When REDIS_URL is not set, all methods are no-ops (local-only mode).
 */
import { structuredLog } from "./logger.js";

const REDIS_URL = process.env.REDIS_URL || null;
let _client = null;
let _connected = false;
let _subscriber = null;
const _subscriptions = new Map(); // channel -> Set<callback>

/**
 * Initialize Redis connection. Call once at startup.
 * Returns immediately if REDIS_URL is not set.
 */
export async function initRedis() {
  if (!REDIS_URL) {
    structuredLog("info", "redis_skipped", { reason: "REDIS_URL not set, local-only mode" });
    return { connected: false, mode: "local" };
  }

  try {
    // Dynamic import so ioredis is optional
    const { default: Redis } = await import("ioredis");

    _client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        // Exponential backoff: 100ms, 200ms, 400ms, 800ms... max 30s
        const delay = Math.min(times * 100 * Math.pow(2, times - 1), 30000);
        return delay;
      },
      lazyConnect: true,
      enableReadyCheck: true,
    });

    _client.on("connect", () => {
      _connected = true;
      structuredLog("info", "redis_connected", { url: REDIS_URL.replace(/\/\/.*@/, "//***@") });
    });
    _client.on("error", (err) => {
      structuredLog("warn", "redis_error", { error: err?.message });
    });
    _client.on("close", () => {
      _connected = false;
      structuredLog("info", "redis_disconnected", {});
    });

    await _client.connect();

    // Create subscriber connection for pub/sub
    _subscriber = _client.duplicate();
    await _subscriber.connect();
    _subscriber.on("message", (channel, message) => {
      const cbs = _subscriptions.get(channel);
      if (cbs) {
        let parsed;
        try { parsed = JSON.parse(message); } catch { parsed = message; }
        for (const cb of cbs) {
          try { cb(parsed); } catch (e) { structuredLog("warn", "redis_sub_callback_error", { channel, error: e?.message }); }
        }
      }
    });

    return { connected: true, mode: "redis" };
  } catch (e) {
    structuredLog("warn", "redis_init_failed", { error: e?.message, reason: "ioredis may not be installed" });
    return { connected: false, mode: "local", error: e?.message };
  }
}

/** Check if Redis is connected */
export function isConnected() { return _connected && _client !== null; }

// ── Session operations ──

export async function sessionGet(sessionId) {
  if (!_connected) return null;
  try {
    const raw = await _client.get(`concord:session:${sessionId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    structuredLog("debug", "redis_session_get_error", { sessionId, error: e?.message });
    return null;
  }
}

export async function sessionSet(sessionId, data, ttlSeconds = 86400) {
  if (!_connected) return false;
  try {
    await _client.set(`concord:session:${sessionId}`, JSON.stringify(data), "EX", ttlSeconds);
    return true;
  } catch (e) {
    structuredLog("debug", "redis_session_set_error", { sessionId, error: e?.message });
    return false;
  }
}

export async function sessionDelete(sessionId) {
  if (!_connected) return false;
  try {
    await _client.del(`concord:session:${sessionId}`);
    return true;
  } catch { return false; }
}

// ── Token revocation ──

export async function revokeToken(tokenHash) {
  if (!_connected) return false;
  try {
    await _client.sadd("concord:revoked_tokens", tokenHash);
    await _client.expire("concord:revoked_tokens", 86400 * 7); // 7 day TTL
    return true;
  } catch { return false; }
}

export async function isTokenRevoked(tokenHash) {
  if (!_connected) return false; // Can't check, assume not revoked
  try {
    return await _client.sismember("concord:revoked_tokens", tokenHash) === 1;
  } catch { return false; }
}

// ── Pub/Sub ──

export async function publish(channel, data) {
  if (!_connected) return false;
  try {
    await _client.publish(channel, JSON.stringify(data));
    return true;
  } catch { return false; }
}

export async function subscribe(channel, callback) {
  if (!_subscriber || !_connected) return false;
  if (!_subscriptions.has(channel)) {
    _subscriptions.set(channel, new Set());
    await _subscriber.subscribe(channel);
  }
  _subscriptions.get(channel).add(callback);
  return true;
}

// ── Distributed Lock ──

export async function lockAcquire(lockName, ttlMs = 30000) {
  if (!_connected) return true; // No Redis = always get lock (single instance)
  try {
    const key = `concord:lock:${lockName}`;
    const result = await _client.set(key, process.pid.toString(), "PX", ttlMs, "NX");
    return result === "OK";
  } catch { return true; } // Fail-open: allow operation if Redis errors
}

export async function lockRelease(lockName) {
  if (!_connected) return true;
  try {
    await _client.del(`concord:lock:${lockName}`);
    return true;
  } catch { return true; }
}

// ── Cleanup ──

export async function disconnect() {
  try {
    if (_subscriber) { await _subscriber.quit(); _subscriber = null; }
    if (_client) { await _client.quit(); _client = null; }
    _connected = false;
  } catch { /* already closed */ }
}

export function getStatus() {
  return {
    connected: _connected,
    mode: _connected ? "redis" : "local",
    url: REDIS_URL ? REDIS_URL.replace(/\/\/.*@/, "//***@") : null,
    subscriptions: Array.from(_subscriptions.keys()),
  };
}
