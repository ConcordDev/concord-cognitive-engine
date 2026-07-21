// server/lib/world-shard-manager.js
//
// Phase I — Worker-thread-per-active-world (revises Phase F).
//
// On-demand activation: a world only gets a worker when at least one
// user enters it. After 10 minutes idle, the worker tears down. ~200MB
// per active world vs ~1.5GB for child_process.fork.
//
// Each worker owns the per-world heartbeat loops (scope: 'world'). The
// parent runs scope: 'global' modules and Socket.IO fan-out. realtimeEmit
// stays main-thread-only — workers post `EMIT` messages back to the
// parent.
//
// Activation:  CONCORD_SHARD_WORLDS=true
// Default OFF: every heartbeat module runs in-process on the parent.

import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PARENT_TO_CHILD, CHILD_TO_PARENT, shardingEnabled } from "./world-shard-protocol.js";
import { getRealCpuCount } from "./cgroup-cpu.js";
import logger from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHARD_ENTRY = path.join(__dirname, "..", "workers", "world-shard.js");

const SHARD_BACKOFF_BASE_MS = Number(process.env.CONCORD_SHARD_BACKOFF_MS) || 2_000;
const SHARD_MAX_BACKOFF_MS  = Number(process.env.CONCORD_SHARD_MAX_BACKOFF_MS) || 60_000;
const SHARD_RESTARTS_PER_MIN = Number(process.env.CONCORD_SHARD_MAX_RESTARTS_PER_MIN) || 5;
const SHARD_IDLE_TEARDOWN_MS = Number(process.env.CONCORD_SHARD_IDLE_TEARDOWN_MS) || 10 * 60 * 1000;
const SHARD_IDLE_CHECK_MS    = Number(process.env.CONCORD_SHARD_IDLE_CHECK_MS) || 60_000;
const SHARD_READY_TIMEOUT_MS = Number(process.env.CONCORD_SHARD_READY_TIMEOUT_MS) || 8_000;
// GPU/CPU pinning audit (2026-07-20) — this manager had NO ceiling on
// concurrent shards: every world with an active user gets its own worker
// thread (~200MB each per this file's own header), uncoordinated with the
// macro pool / heartbeat pool, which independently size themselves off
// core count. On the real bare-metal deploy target (.env.runpod: a 9-vCPU
// RunPod pod, CONCORD_WORLD_CORE_COUNT=2 reserved for the backend process —
// world-sim + shards — with the rest split across 5 Ollama instances +
// frontend), unbounded shard growth risks real thread-scheduling contention
// regardless of memory headroom. First preference: CONCORD_WORLD_CORE_COUNT
// when the deploy has explicitly declared its reserved core budget (the
// same env var pin-processes.sh/runpod-cognition.sh already use) — a shard
// count meaningfully past that reserved band contends with itself, not with
// Ollama or the frontend. Falls back to a core-scaled heuristic off the
// REAL cgroup-restricted core count (getRealCpuCount(), not the host's
// raw/lying os.cpus().length — see lib/cgroup-cpu.js) when
// CONCORD_WORLD_CORE_COUNT isn't set. Tune via CONCORD_MAX_ACTIVE_SHARDS
// once real per-shard memory/CPU cost is observed in production.
const SHARD_MAX_ACTIVE = Number(process.env.CONCORD_MAX_ACTIVE_SHARDS)
  || (Number(process.env.CONCORD_WORLD_CORE_COUNT) > 0 ? Number(process.env.CONCORD_WORLD_CORE_COUNT) * 2 : null)
  || Math.max(4, getRealCpuCount() * 2);

/** @typedef {{
 *   worldId: string,
 *   worker: import('node:worker_threads').Worker | null,
 *   startedAt: number,
 *   restartCount: number,
 *   recentRestarts: number[],
 *   lastTickAt: number,
 *   lastTickCount: number,
 *   lastActivityAt: number,
 *   userCount: number,
 *   status: 'spawning' | 'ready' | 'catching-up' | 'crashed' | 'idle' | 'draining',
 *   readyPromise: Promise<void> | null,
 *   readyResolve: ((v?: void) => void) | null,
 *   readyReject: ((err: Error) => void) | null,
 * }} ShardEntry */

/** @type {Map<string, ShardEntry>} */
const _shards = new Map();
let _config = null;
let _idleSweepHandle = null;

/**
 * Initialise the manager. Idempotent. With Phase I sharding enabled, no
 * workers are pre-spawned — they're created on demand by `ensureWorldActive`.
 * The idle sweep is what tears them down.
 */
export async function initWorldShards(opts) {
  if (!shardingEnabled()) {
    logger.info("world-shard-manager", "sharding_disabled");
    return { ok: true, enabled: false, shards: [] };
  }
  _config = {
    dbPath: opts.dbPath,
    realtimeEmit: opts.realtimeEmit,
    db: opts.db,
  };

  if (_idleSweepHandle) clearInterval(_idleSweepHandle);
  _idleSweepHandle = setInterval(() => { try { _idleSweep(); } catch { /* sweep best-effort */ } }, SHARD_IDLE_CHECK_MS);
  if (_idleSweepHandle.unref) _idleSweepHandle.unref();

  logger.info("world-shard-manager", "sharding_enabled_on_demand", {
    idleTeardownMs: SHARD_IDLE_TEARDOWN_MS,
    readyTimeoutMs: SHARD_READY_TIMEOUT_MS,
  });
  return { ok: true, enabled: true, shards: [] };
}

/**
 * Ensure a world has an active worker. Spawns one if not running. Returns
 * `{ ok, status, firstTickEtaMs?, error? }`. Resolves when the worker has
 * posted READY (or the spawn fails / times out).
 */
export async function ensureWorldActive(worldId) {
  if (!shardingEnabled()) return { ok: false, status: "sharding_disabled" };
  if (!worldId) return { ok: false, status: "no_world_id" };

  let entry = _shards.get(worldId);
  if (entry && entry.worker && entry.status === "ready") {
    entry.lastActivityAt = Date.now();
    return { ok: true, status: "active", firstTickEtaMs: 0 };
  }
  if (entry && entry.readyPromise) {
    // Spawn already in progress.
    try {
      await entry.readyPromise;
      return { ok: true, status: "active", firstTickEtaMs: 0 };
    } catch (err) {
      return { ok: false, status: "spawn_failed", error: err?.message };
    }
  }

  // GPU/CPU pinning audit — cap concurrent shards (see SHARD_MAX_ACTIVE
  // above). Only relevant for a genuinely NEW world (entry undefined at
  // this point — the two branches above already handled an existing one).
  if (!entry && _shards.size >= SHARD_MAX_ACTIVE) {
    const evicted = _evictLruIdleShard();
    if (!evicted) {
      logger.warn("world-shard-manager", "at_capacity_no_evictable", {
        worldId, activeShards: _shards.size, maxActive: SHARD_MAX_ACTIVE,
      });
      return { ok: false, status: "at_capacity" };
    }
  }

  entry = _spawnShard(worldId);
  const t0 = Date.now();
  try {
    await Promise.race([
      entry.readyPromise,
      new Promise((_resolve, reject) => { setTimeout(() => reject(new Error("ready_timeout")), SHARD_READY_TIMEOUT_MS); }),
    ]);
    return { ok: true, status: "active", firstTickEtaMs: Date.now() - t0 };
  } catch (err) {
    entry.status = "crashed";
    return { ok: false, status: "spawn_failed", error: err?.message };
  }
}

/** Mark a world as having user activity (presence join, tick request, route hit). */
export function recordWorldActivity(worldId) {
  const entry = _shards.get(worldId);
  if (entry) entry.lastActivityAt = Date.now();
}

/** Increment / decrement the user count for a world (Socket.IO join/leave). */
export function markWorldUserCount(worldId, delta) {
  if (!worldId) return;
  const entry = _shards.get(worldId);
  if (!entry) return;
  entry.userCount = Math.max(0, (entry.userCount || 0) + delta);
  entry.lastActivityAt = Date.now();
}

/**
 * GPU/CPU pinning audit — evict the least-recently-active shard with zero
 * current users to make room for a new one when at SHARD_MAX_ACTIVE
 * capacity. Never evicts a shard with userCount > 0 (an occupied world
 * getting torn down out from under its players would be a correctness
 * regression, not just a perf tradeoff) or one that's mid-spawn/draining.
 * Returns true if a shard was evicted, false if none was evictable (every
 * active shard genuinely has users — the caller then fails the new
 * world's activation with 'at_capacity' rather than spawn past the cap).
 */
function _evictLruIdleShard() {
  let victim = null;
  for (const entry of _shards.values()) {
    if (entry.status !== "ready" || entry.userCount > 0) continue;
    if (!victim || entry.lastActivityAt < victim.lastActivityAt) victim = entry;
  }
  if (!victim) return false;
  victim.status = "draining";
  try {
    victim.worker?.postMessage({ type: PARENT_TO_CHILD.SHUTDOWN });
  } catch { /* worker may already be gone */ }
  setTimeout(() => {
    if (victim.worker) {
      try { victim.worker.terminate(); } catch { /* already gone */ }
    }
  }, 5_000);
  logger.info("world-shard-manager", "evicted_lru_idle_shard", {
    worldId: victim.worldId, idleForMs: Date.now() - victim.lastActivityAt,
  });
  return true;
}

function _spawnShard(worldId) {
  let entry = _shards.get(worldId);
  if (!entry) {
    entry = {
      worldId,
      worker: null,
      startedAt: Date.now(),
      restartCount: 0,
      recentRestarts: [],
      lastTickAt: 0,
      lastTickCount: 0,
      lastActivityAt: Date.now(),
      userCount: 0,
      status: "spawning",
      readyPromise: null,
      readyResolve: null,
      readyReject: null,
    };
    _shards.set(worldId, entry);
  }

  entry.status = "spawning";
  entry.startedAt = Date.now();
  entry.readyPromise = new Promise((resolve, reject) => {
    entry.readyResolve = resolve;
    entry.readyReject = reject;
  });

  let worker;
  try {
    worker = new Worker(SHARD_ENTRY, {
      workerData: { worldId, dbPath: _config?.dbPath ?? null },
      env: { ...process.env, CONCORD_NO_LISTEN: "true", CONCORD_SHARD_CHILD: "true" },
      // Stability audit (2026-07-20) — without an explicit resourceLimits, a
      // world shard inherits the FULL main-thread --max-old-space-size
      // ceiling. A shard hosts an entire active world's per-world sim
      // (scope:'world' heartbeat modules), genuinely more state than a
      // single macro or heartbeat tick, so it gets the largest per-worker
      // allowance — but still a real, finite cap rather than none, since
      // SHARD_MAX_ACTIVE bounds the COUNT of concurrent shards, not what
      // any single one can individually grow to. Override via
      // CONCORD_SHARD_WORKER_HEAP_MB.
      resourceLimits: {
        maxOldGenerationSizeMb: Number(process.env.CONCORD_SHARD_WORKER_HEAP_MB) || 2048,
      },
    });
  } catch (err) {
    logger.warn("world-shard-manager", "worker_construct_failed", { worldId, error: err?.message });
    entry.status = "crashed";
    entry.readyReject?.(err);
    return entry;
  }

  entry.worker = worker;
  worker.on("message", (msg) => _handleWorkerMessage(worldId, msg));
  worker.on("error", (err) => _handleWorkerError(worldId, err));
  worker.on("exit", (code) => _handleWorkerExit(worldId, code));

  // Send INIT immediately. The worker-thread version uses parentPort, but
  // postMessage is symmetric: parent → worker via worker.postMessage.
  try {
    worker.postMessage({
      type: PARENT_TO_CHILD.INIT,
      worldId,
      dbPath: _config?.dbPath ?? null,
    });
  } catch (err) {
    logger.warn("world-shard-manager", "init_postmessage_failed", { worldId, error: err?.message });
    entry.readyReject?.(err);
  }
  return entry;
}

function _handleWorkerMessage(worldId, msg) {
  if (!msg || typeof msg !== "object") return;
  const entry = _shards.get(worldId);
  if (!entry) return;
  if (msg.type === CHILD_TO_PARENT.READY) {
    entry.status = "ready";
    entry.readyResolve?.();
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
      _config?.realtimeEmit?.(msg.event, { ...msg.payload, worldId });
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

function _handleWorkerError(worldId, err) {
  logger.warn("world-shard-manager", "worker_error", { worldId, error: err?.message });
  const entry = _shards.get(worldId);
  if (entry) {
    entry.status = "crashed";
    entry.readyReject?.(err);
  }
}

function _handleWorkerExit(worldId, code) {
  const entry = _shards.get(worldId);
  if (!entry) return;
  entry.worker = null;

  // Clean idle teardown: status was 'draining' — don't restart.
  if (entry.status === "draining") {
    _shards.delete(worldId);
    logger.info("world-shard-manager", "worker_idle_torn_down", { worldId });
    return;
  }

  entry.status = "crashed";
  logger.warn("world-shard-manager", "worker_exit", { worldId, code });

  const now = Date.now();
  entry.recentRestarts = entry.recentRestarts.filter(t => now - t < 60_000);
  if (entry.recentRestarts.length >= SHARD_RESTARTS_PER_MIN) {
    logger.warn("world-shard-manager", "restart_rate_exceeded", { worldId, recentRestarts: entry.recentRestarts.length });
    setTimeout(() => { entry.recentRestarts = []; }, SHARD_MAX_BACKOFF_MS);
    return;
  }

  // Don't auto-respawn an idle world. The next `ensureWorldActive` call will.
  if (entry.userCount === 0 && (now - entry.lastActivityAt) > SHARD_IDLE_TEARDOWN_MS) {
    _shards.delete(worldId);
    return;
  }

  const backoff = Math.min(SHARD_MAX_BACKOFF_MS, SHARD_BACKOFF_BASE_MS * Math.pow(2, entry.restartCount));
  entry.restartCount += 1;
  entry.recentRestarts.push(now);
  setTimeout(() => { _spawnShard(worldId); }, backoff);
}

function _idleSweep() {
  const now = Date.now();
  for (const entry of _shards.values()) {
    if (!entry.worker) continue;
    if (entry.userCount > 0) continue;
    if (entry.status === "draining") continue;
    if ((now - entry.lastActivityAt) > SHARD_IDLE_TEARDOWN_MS) {
      entry.status = "draining";
      try {
        entry.worker.postMessage({ type: PARENT_TO_CHILD.SHUTDOWN });
      } catch { /* worker may already be gone */ }
      // Also force-terminate after 5s in case the worker doesn't honour SHUTDOWN.
      setTimeout(() => {
        if (entry.worker) {
          try { entry.worker.terminate(); } catch { /* already gone */ }
        }
      }, 5_000);
    }
  }
}

/**
 * Broadcast a tick to every currently-active shard. Idle / crashed shards
 * are skipped — they get no ticks until a user re-enters them.
 */
export function broadcastTick({ tickCount, reason = "interval", settings = {}, activeOnly = true } = {}) {
  if (!shardingEnabled()) return { ok: false, reason: "sharding_disabled" };
  let fanout = 0;
  for (const entry of _shards.values()) {
    if (!entry.worker) continue;
    if (entry.status === "crashed" || entry.status === "draining") continue;
    if (activeOnly && entry.status !== "ready" && entry.status !== "catching-up") continue;
    try {
      entry.worker.postMessage({ type: PARENT_TO_CHILD.TICK, tickCount, reason, settings });
      fanout++;
    } catch (err) {
      logger.warn("world-shard-manager", "tick_send_failed", { worldId: entry.worldId, error: err?.message });
    }
  }
  return { ok: true, fanout, totalShards: _shards.size };
}

/** Return health snapshot for /api/admin/world-shards + /api/worlds/:worldId/health. */
export function getShardHealth(worldId = null) {
  if (worldId) {
    const entry = _shards.get(worldId);
    if (!entry) return { worldId, status: "no-shard", sharded: shardingEnabled() };
    return {
      worldId,
      status: entry.status,
      pid: entry.worker?.threadId ?? null,
      startedAt: entry.startedAt,
      lastTickAt: entry.lastTickAt,
      lastTickCount: entry.lastTickCount,
      lastActivityAt: entry.lastActivityAt,
      userCount: entry.userCount,
      restartCount: entry.restartCount,
      sharded: true,
    };
  }
  const out = [];
  for (const entry of _shards.values()) {
    out.push({
      worldId: entry.worldId,
      status: entry.status,
      pid: entry.worker?.threadId ?? null,
      startedAt: entry.startedAt,
      lastTickAt: entry.lastTickAt,
      lastTickCount: entry.lastTickCount,
      lastActivityAt: entry.lastActivityAt,
      userCount: entry.userCount,
      restartCount: entry.restartCount,
    });
  }
  return out;
}

/** Manually restart a shard (admin action). */
export function restartShard(worldId) {
  const entry = _shards.get(worldId);
  if (!entry) return { ok: false, error: "no_shard" };
  try { entry.worker?.terminate(); } catch { /* already gone */ }
  return { ok: true };
}

/** Gracefully shutdown all shards (called during server shutdown). */
export function shutdownShards() {
  if (_idleSweepHandle) { clearInterval(_idleSweepHandle); _idleSweepHandle = null; }
  for (const entry of _shards.values()) {
    entry.status = "draining";
    try { entry.worker?.postMessage({ type: PARENT_TO_CHILD.SHUTDOWN }); } catch { /* already gone */ }
  }
}

/** Test-only — reset state between specs. */
export function _resetShardManagerForTests() {
  for (const entry of _shards.values()) {
    try { entry.worker?.terminate(); } catch { /* already gone */ }
  }
  _shards.clear();
  if (_idleSweepHandle) { clearInterval(_idleSweepHandle); _idleSweepHandle = null; }
  _config = null;
}
