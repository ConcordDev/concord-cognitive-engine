// sticky-session — optional Redis map for multi-instance affinity observability.
//
// Inert unless CONCORD_STICKY_REDIS=1 AND Redis is connected. Does not change
// routing (nginx sticky / ip_hash does). Safe on single-process Mac self-host.
//
// See docs/REDIS_STICKY_SESSIONS.md.

import os from "node:os";

const ENABLED = process.env.CONCORD_STICKY_REDIS === "1";
const TTL_SEC = Math.max(60, Number(process.env.CONCORD_STICKY_TTL_SEC) || 86400);

function nodeId() {
  if (process.env.CONCORD_NODE_ID) return process.env.CONCORD_NODE_ID;
  const port = process.env.PORT || "5050";
  const inst = process.env.NODE_APP_INSTANCE ?? "0";
  return `${os.hostname()}:${port}:i${inst}`;
}

/**
 * Record which node last touched a chat/auth session id.
 * @param {{ redisClient?: import('redis').RedisClientType | null, prefix?: string }} deps
 * @param {string} sessionId
 */
export async function touchStickySession(deps, sessionId) {
  if (!ENABLED || !sessionId || !deps?.redisClient) return { ok: false, skipped: true };
  const prefix = deps.prefix || process.env.REDIS_PREFIX || "concord:";
  const key = `${prefix}sticky:${sessionId}`;
  try {
    await deps.redisClient.setEx(key, TTL_SEC, nodeId());
    return { ok: true, key, nodeId: nodeId() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function stickyConfig() {
  return { enabled: ENABLED, ttlSec: TTL_SEC, nodeId: nodeId() };
}
