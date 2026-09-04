// server/lib/auth-gate/gates/idempotency.js
//
// F0.5 NEW gate — non-idempotent replay protection.
//
// Two layers:
//   1. Same TRACE_ID + same tool/args → return cached result (true idempotency)
//   2. Different TRACE_ID + same tool/args within window → DENY replay_detected
//
// Storage: in-memory Map keyed by hash. Production should back with DB,
// but in-memory is correct for single-process deploys and explicit in scope.

import { createHash } from "node:crypto";

/** @type {Map<string, {hash: string, result: any, expires_at: number}>} */
const CACHE = new Map();

const DEFAULT_WINDOW_MS = 60 * 1000;  // 1 minute default
const MAX_CACHE_SIZE = 5000;

/**
 * Compute a deterministic hash for an envelope's tool+args (canonicalized).
 */
export function hashEnvelope(envelope) {
  const canonical = JSON.stringify({
    tool: envelope.WHAT,
    args: canonicalizeArgs(envelope._internal?.args || {}),
    scope: envelope.SCOPE,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function canonicalizeArgs(args) {
  // Sort keys recursively for determinism
  if (Array.isArray(args)) return args.map(canonicalizeArgs);
  if (args && typeof args === "object") {
    const sorted = {};
    for (const k of Object.keys(args).sort()) {
      sorted[k] = canonicalizeArgs(args[k]);
    }
    return sorted;
  }
  return args;
}

/**
 * Check / record an envelope for idempotency.
 *
 * Returns:
 *   - {pass: true, cached: false, hash}        → first time seeing this
 *   - {pass: true, cached: true, result, hash} → replay with same trace_id, return cached
 *   - {pass: false, reason_code: "replay_detected", hash} → different trace_id, same hash
 */
export async function check(envelope, windowMs = DEFAULT_WINDOW_MS) {
  const hash = hashEnvelope(envelope);
  const traceId = envelope.TRACE_ID;
  const now = Date.now();

  // Cleanup expired entries (cheap O(n) every call; bounded by MAX_CACHE_SIZE)
  if (CACHE.size > MAX_CACHE_SIZE) cleanupExpired(now);

  const existing = CACHE.get(hash);
  if (existing && existing.expires_at > now) {
    // Same hash, within window
    if (existing.trace_id === traceId) {
      // True idempotent replay — return cached result
      return {
        pass: true,
        cached: true,
        result: existing.result,
        hash,
        reason_code: "idempotent_replay",
      };
    } else {
      // Different trace_id, same hash → replay attack
      return {
        pass: false,
        reason_code: "replay_detected",
        hash,
        original_trace_id: existing.trace_id,
        conflicting_trace_id: traceId,
      };
    }
  }

  // First time — register
  CACHE.set(hash, {
    trace_id: traceId,
    hash,
    result: null,
    expires_at: now + windowMs,
  });

  return { pass: true, cached: false, hash, reason_code: "first_observation" };
}

/**
 * Record the result of a successful execution, so future idempotent replays
 * can return it. Called by dispatch.js after the tool completes.
 */
export function recordResult(envelope, result) {
  const hash = hashEnvelope(envelope);
  const existing = CACHE.get(hash);
  if (existing && existing.trace_id === envelope.TRACE_ID) {
    existing.result = result;
  } else if (!existing) {
    CACHE.set(hash, {
      trace_id: envelope.TRACE_ID,
      hash,
      result,
      expires_at: Date.now() + DEFAULT_WINDOW_MS,
    });
  }
}

function cleanupExpired(now) {
  for (const [k, v] of CACHE) {
    if (v.expires_at <= now) CACHE.delete(k);
  }
}

/** Test helper — clear cache */
export function _resetCache() {
  CACHE.clear();
}