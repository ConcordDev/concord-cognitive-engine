// server/lib/world-shard-manager.js
//
// Parent-side coordinator for process-per-world sharding (Phase F).
//
// Spawns one `child_process.fork` per known active world and forwards tick
// triggers from the parent governor. Listens for `EMIT` messages from each
// child and replays them through the parent's `realtimeEmit` so Socket.IO
// fan-out stays on the main process (Socket.IO is main-thread-only).
//
// Activation:  CONCORD_SHARD_WORLDS=true
// Disabled (default): every heartbeat module runs in-process on the parent.

import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PARENT_TO_CHILD, CHILD_TO_PARENT, shardingEnabled } from "./world-shard-protocol.js";
import logger from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHARD_ENTRY = path.join(__dirname, "..", "workers", "world-shard.js");

const SHARD_BACKOFF_BASE_MS = Number(process.env.CONCORD_SHARD_BACKOFF_MS) || 2_000;
const SHARD_MAX_BACKOFF_MS = Number(process.env.CONCORD_SHARD_MAX_BACKOFF_MS) || 60_000;
const SHARD_RESTARTS_PER_MIN = Number(process.env.CONCORD_SHARD_MAX_RESTARTS_PER_MIN) || 5;

/** @type {Map<string, ShardEntry>} */
const _shards = new Map();
let _config = null;

/**
 * @typedef {Object} ShardEntry
 * @property {string} worldId
 * @property {import('node:child_process').ChildProcess|null} child
 * @property {number} startedAt
 * @property {number} restartCount
 * @property {number[]} recentRestarts
 * @property {number} lastTickAt
 * @property {number} lastTickCount
 * @property {string} status   // 'starting' | 'ready' | 'catching-up' | 'crashed'
 * @property {number} crashedUntil
 */

/**
 * Initialise the manager. Idempotent.
 * @param {object} opts
 * @param {string} opts.dbPath
 * @param {Function} opts.realtimeEmit
 * @param {Function} [opts.listWorlds] - optional async; defaults to a DB query
 *   "SELECT id FROM worlds WHERE active = 1".
 * @param {object} [opts.db] - better-sqlite3 handle for listWorlds default.
 */
export async function initWorldShards(opts) {
  if (!shardingEnabled()) {
    logger.info("world-shard-manager", "sharding_disabled");
    return { ok: true, enabled: false, shards: [] };
  }
  _config = {
    dbPath: opts.dbPath,
    realtimeEmit: opts.realtimeEmit,
    listWorlds: opts.listWorlds,
    db: opts.db,
  };

  const worldIds = await _resolveWorldList();
  for (const worldId of worldIds) {
    try { _spawnShard(worldId); } catch (err) {
      logger.warn("world-shard-manager", "spawn_failed", { worldId, error: err?.message });
    }
  }

  logger.info("world-shard-manager", "sharding_enabled", { shardCount: worldIds.length });
  return { ok: true, enabled: true, shards: worldIds };
}

async function _resolveWorldList() {
  if (typeof _config.listWorlds === "function") {
    try { return await _config.listWorlds(); } catch (err) {
      logger.warn("world-shard-manager", "list_worlds_callback_failed", { error: err?.message });
    }
  }
  if (_config.db) {
    try {
      const rows = _config.db.prepare(`
        SELECT DISTINCT id FROM worlds
        WHERE active = 1 OR id IN ('concordia-hub')
      `).all();
      return rows.map(r => r.id);
    } catch (err) {
      // Some installs don't have a worlds.active column; fall back to a curated list.
      logger.warn("world-shard-manager", "list_worlds_db_query_failed", { error: err?.message });
    }
  }
  // Fallback: the authored worlds from content/world/. Allows the shard
  // manager to come up even when the DB doesn't yet have a worlds row.
  return ["concordia-hub", "tunya", "sovereign-ruins", "crime", "cyber", "superhero", "fantasy", "lattice-crucible"];
}

function _spawnShard(worldId) {
  const child = fork(SHARD_ENTRY, [], {
    silent: false,
    env: { ...process.env, CONCORD_NO_LISTEN: "true", CONCORD_SHARD_CHILD: "true" },
  });

  /** @type {ShardEntry} */
  const entry = _shards.get(worldId) || {
    worldId,
    child: null,
    startedAt: Date.now(),
    restartCount: 0,
    recentRestarts: [],
    lastTickAt: 0,
    lastTickCount: 0,
    status: "starting",
    crashedUntil: 0,
  };
  entry.child = child;
  entry.startedAt = Date.now();
  entry.status = "starting";
  _shards.set(worldId, entry);

  child.on("message", (msg) => _handleChildMessage(worldId, msg));
  child.on("error", (err) => _handleChildError(worldId, err));
  child.on("exit", (code, signal) => _handleChildExit(worldId, code, signal));

  child.send({
    type: PARENT_TO_CHILD.INIT,
    worldId,
    dbPath: _config.dbPath,
  });
}

function _handleChildMessage(worldId, msg) {
  if (!msg || typeof msg !== "object") return;
  const entry = _shards.get(worldId);
  if (!entry) return;

  if (msg.type === CHILD_TO_PARENT.READY) {
    entry.status = "ready";
    return;
  }
  if (msg.type === CHILD_TO_PARENT.TICK_RESULT) {
    entry.lastTickAt = Date.now();
    entry.lastTickCount = msg.tickCount || entry.lastTickCount;
    entry.status = msg.ok ? "ready" : "catching-up";
    return;
  }
  if (msg.type === CHILD_TO_PARENT.EMIT) {
    try {
      _config.realtimeEmit?.(msg.event, { ...msg.payload, worldId });
    } catch (err) {
      logger.warn("world-shard-manager", "emit_replay_failed", { event: msg.event, error: err?.message });
    }
    return;
  }
  if (msg.type === CHILD_TO_PARENT.LOG) {
    const level = msg.level === "error" ? "error" : msg.level === "warn" ? "warn" : "info";
    logger[level]?.("world-shard", msg.event, { worldId, ...msg.data });
    return;
  }
  if (msg.type === CHILD_TO_PARENT.ERROR) {
    logger.warn("world-shard", "shard_error", { worldId, ...msg });
  }
}

function _handleChildError(worldId, err) {
  logger.warn("world-shard-manager", "child_error", { worldId, error: err?.message });
  const entry = _shards.get(worldId);
  if (entry) entry.status = "crashed";
}

function _handleChildExit(worldId, code, signal) {
  logger.warn("world-shard-manager", "child_exit", { worldId, code, signal });
  const entry = _shards.get(worldId);
  if (!entry) return;
  entry.status = "crashed";
  entry.child = null;

  const now = Date.now();
  entry.recentRestarts = entry.recentRestarts.filter(t => now - t < 60_000);
  if (entry.recentRestarts.length >= SHARD_RESTARTS_PER_MIN) {
    entry.crashedUntil = now + SHARD_MAX_BACKOFF_MS;
    logger.warn("world-shard-manager", "restart_rate_exceeded", { worldId, recentRestarts: entry.recentRestarts.length });
    setTimeout(() => { entry.recentRestarts = []; entry.crashedUntil = 0; _spawnShard(worldId); }, SHARD_MAX_BACKOFF_MS);
    return;
  }

  const backoff = Math.min(SHARD_MAX_BACKOFF_MS, SHARD_BACKOFF_BASE_MS * Math.pow(2, entry.restartCount));
  entry.restartCount += 1;
  entry.recentRestarts.push(now);
  setTimeout(() => { _spawnShard(worldId); }, backoff);
}

/**
 * Broadcast a tick to every healthy shard. Parent's governor calls this in
 * place of `tickAllRegistered` (for scope='world' modules) when sharding is
 * enabled.
 */
export function broadcastTick({ tickCount, reason = "interval", settings = {} } = {}) {
  if (!shardingEnabled()) return { ok: false, reason: "sharding_disabled" };
  for (const entry of _shards.values()) {
    if (!entry.child || entry.status === "crashed") continue;
    try {
      entry.child.send({ type: PARENT_TO_CHILD.TICK, tickCount, reason, settings });
    } catch (err) {
      logger.warn("world-shard-manager", "tick_send_failed", { worldId: entry.worldId, error: err?.message });
    }
  }
  return { ok: true, fanout: _shards.size };
}

/** Return health snapshot for /api/admin/world-shards + /api/worlds/:worldId/health. */
export function getShardHealth(worldId = null) {
  if (worldId) {
    const entry = _shards.get(worldId);
    if (!entry) return { worldId, status: "no-shard", sharded: shardingEnabled() };
    return {
      worldId,
      status: entry.status,
      pid: entry.child?.pid ?? null,
      startedAt: entry.startedAt,
      lastTickAt: entry.lastTickAt,
      lastTickCount: entry.lastTickCount,
      restartCount: entry.restartCount,
      sharded: true,
    };
  }
  const out = [];
  for (const entry of _shards.values()) {
    out.push({
      worldId: entry.worldId,
      status: entry.status,
      pid: entry.child?.pid ?? null,
      startedAt: entry.startedAt,
      lastTickAt: entry.lastTickAt,
      lastTickCount: entry.lastTickCount,
      restartCount: entry.restartCount,
    });
  }
  return out;
}

/** Manually restart a shard (admin action). */
export function restartShard(worldId) {
  const entry = _shards.get(worldId);
  if (!entry) return { ok: false, error: "no_shard" };
  try { entry.child?.kill("SIGTERM"); } catch { /* already dead */ }
  // _handleChildExit will respawn after backoff.
  return { ok: true };
}

/** Gracefully shutdown all shards (called during server shutdown). */
export function shutdownShards() {
  for (const entry of _shards.values()) {
    try { entry.child?.send({ type: PARENT_TO_CHILD.SHUTDOWN }); } catch { /* already gone */ }
  }
}
