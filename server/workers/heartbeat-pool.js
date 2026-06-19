// @sync-fs-ok: worker side-effect replay, off the main request/event path. Sync fs in this file is intentional and not on the user request path (audited 2026-06).
// @sql-loop-ok: bounded worker side-effect replay batch applied on the main thread, off the request path — NOT a row-level N+1.
/**
 * Heartbeat Worker Pool — runs `worker:true` heartbeat modules off the main
 * thread so a heavy tick (faction-strategy, lattice-quest, embodied-dream,
 * refusal-field-sweep, etc.) can't starve the rest of the dispatch loop.
 *
 * The shape mirrors macro-pool.js so the operator UI can render both pools
 * with the same widget. Workers receive a small serializable ctx snapshot
 * (not the live STATE/DB) and return either inline results or a queue of
 * deferred side effects that the main thread replays:
 *
 *   { type: 'tick', moduleId, ctxSnapshot }
 *   → worker imports the module, runs handler with a shim ctx that exposes
 *     `queueWrite(sql, params)` + `queueEmit(event, payload)` + a read-only
 *     better-sqlite3 handle.
 *   → worker returns { type: 'tick-result', moduleId, durationMs, ok,
 *                      error?, sideEffects: [{kind, payload}, ...] }
 *   → main thread replays writes against the live DB handle and fans
 *     emits through realtimeEmit.
 */

import { Worker } from "node:worker_threads";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HEARTBEAT_POOL_SIZE = Math.max(
  1,
  Math.min(
    Number(process.env.CONCORD_HEARTBEAT_POOL_SIZE) || (os.cpus().length - 2),
    8
  )
);

const TASK_TIMEOUT_MS = Number(process.env.CONCORD_HEARTBEAT_WORKER_TIMEOUT_MS) || 25_000;

const workers = [];
const queue = [];
let _poolReady = false;
let _mainCtxRef = null;

const _metrics = {
  dispatched: 0,
  completed: 0,
  errors: 0,
  timeouts: 0,
  queueHighWater: 0,
  avgLatencyMs: 0,
  _latencySum: 0,
};

/**
 * Initialize the heartbeat worker pool.
 * @param {object} mainCtx - { db, realtimeEmit, dbPath }
 *   `db`            — main-thread better-sqlite3 handle (used to replay writes)
 *   `realtimeEmit`  — main-thread realtime emit function (used to replay emits)
 *   `dbPath`        — DB path each worker opens read-only
 */
export function initHeartbeatPool(mainCtx = {}) {
  if (_poolReady) return;
  _mainCtxRef = mainCtx;
  for (let i = 0; i < HEARTBEAT_POOL_SIZE; i++) {
    _spawnWorker(i);
  }
  _poolReady = true;
  _updatePoolGauges();
}

function _spawnWorker(workerId) {
  const workerPath = path.join(__dirname, "heartbeat-executor.js");
  const w = new Worker(workerPath, {
    workerData: {
      workerId,
      dbPath: _mainCtxRef?.dbPath ?? null,
    },
  });
  w._id = workerId;
  w._busy = false;
  w._task = null;
  w._startTime = 0;
  w.on("message", (msg) => _handleWorkerMessage(w, msg));
  w.on("error", (err) => _handleWorkerError(w, err));
  w.on("exit", (code) => _handleWorkerExit(w, code));

  const slotIdx = workers.findIndex((x) => x && x._id === workerId);
  if (slotIdx >= 0) workers[slotIdx] = w;
  else workers.push(w);
}

/**
 * Dispatch a heartbeat module tick to a worker.
 * Resolves with `{ ok, sideEffects?, error? }`.
 */
export function exec(moduleId, ctxSnapshot) {
  if (!_poolReady) {
    return Promise.reject(new Error("heartbeat_pool_not_ready"));
  }
  return new Promise((resolve, reject) => {
    const task = { moduleId, ctxSnapshot, resolve, reject, queuedAt: Date.now() };
    _metrics.dispatched++;
    const freeWorker = workers.find((w) => !w._busy);
    if (freeWorker) {
      _runOnWorker(freeWorker, task);
    } else {
      queue.push(task);
      if (queue.length > _metrics.queueHighWater) {
        _metrics.queueHighWater = queue.length;
      }
    }
    _updatePoolGauges();
  });
}

export function getPoolStats() {
  return {
    poolSize: HEARTBEAT_POOL_SIZE,
    ready: _poolReady,
    busy: workers.filter((w) => w && w._busy).length,
    idle: workers.filter((w) => w && !w._busy).length,
    queueLength: queue.length,
    metrics: {
      dispatched: _metrics.dispatched,
      completed: _metrics.completed,
      errors: _metrics.errors,
      timeouts: _metrics.timeouts,
      queueHighWater: _metrics.queueHighWater,
      avgLatencyMs: _metrics.completed > 0
        ? Math.round(_metrics._latencySum / _metrics.completed)
        : 0,
    },
  };
}

export function shutdownPool() {
  _poolReady = false;
  for (const w of workers) {
    if (!w) continue;
    try { w.postMessage({ type: "shutdown" }); } catch { /* worker may already be dead */ }
  }
  for (const task of queue) {
    try { task.reject(new Error("pool_shutdown")); } catch { /* listener may be gone */ }
  }
  queue.length = 0;
}

// ── internals ────────────────────────────────────────────────────────────────

function _runOnWorker(worker, task) {
  worker._busy = true;
  worker._task = task;
  worker._startTime = Date.now();
  worker._timeoutTimer = setTimeout(() => {
    if (worker._busy && worker._task === task) {
      _metrics.timeouts++;
      logger.warn("heartbeat-pool", "worker_timeout", {
        workerId: worker._id,
        moduleId: task.moduleId,
        ms: TASK_TIMEOUT_MS,
      });
      task.reject(new Error(`heartbeat_worker_timeout:${task.moduleId}`));
      worker._task = null;
      worker._busy = false;
      try { worker.terminate(); } catch { /* already dead */ }
    }
  }, TASK_TIMEOUT_MS);
  worker.postMessage({
    type: "tick",
    moduleId: task.moduleId,
    ctxSnapshot: task.ctxSnapshot,
  });
  _updatePoolGauges();
}

function _handleWorkerMessage(worker, msg) {
  if (msg?.type === "ready") return;
  if (msg?.type !== "tick-result") return;

  if (worker._timeoutTimer) { clearTimeout(worker._timeoutTimer); worker._timeoutTimer = null; }
  const task = worker._task;
  const latency = Date.now() - worker._startTime;
  worker._busy = false;
  worker._task = null;

  _metrics.completed++;
  _metrics._latencySum += latency;

  try {
    _applySideEffects(msg.sideEffects || []);
  } catch (err) {
    logger.warn("heartbeat-pool", "side_effect_replay_failed", { error: err?.message });
  }

  if (msg.error) {
    _metrics.errors++;
    task?.reject(new Error(msg.error));
  } else {
    task?.resolve({ ok: !!msg.ok, sideEffects: msg.sideEffects || [] });
  }

  if (queue.length > 0) {
    _runOnWorker(worker, queue.shift());
  }
  _updatePoolGauges();
}

function _handleWorkerError(worker, err) {
  logger.warn("heartbeat-pool", "worker_error", {
    workerId: worker._id,
    error: err?.message,
  });
  _metrics.errors++;
  if (worker._task) {
    try { worker._task.reject(new Error(`heartbeat_worker_error:${err?.message}`)); } catch { /* listener gone */ }
    worker._task = null;
  }
  worker._busy = false;
  if (queue.length > 0) {
    _runOnWorker(worker, queue.shift());
  }
  _updatePoolGauges();
}

function _handleWorkerExit(worker, code) {
  worker._busy = false;
  if (code !== 0 && _poolReady) {
    logger.warn("heartbeat-pool", "worker_exited_respawning", {
      workerId: worker._id, code,
    });
    _spawnWorker(worker._id);
  }
  _updatePoolGauges();
}

function _applySideEffects(sideEffects) {
  const db = _mainCtxRef?.db;
  const realtimeEmit = _mainCtxRef?.realtimeEmit;
  for (const eff of sideEffects) {
    if (!eff || typeof eff !== "object") continue;
    if (eff.kind === "db-write" && db && eff.sql) {
      try {
        db.prepare(eff.sql).run(...(eff.params || []));
      } catch (err) {
        logger.warn("heartbeat-pool", "db_write_replay_failed", {
          sqlPrefix: String(eff.sql).slice(0, 80),
          error: err?.message,
        });
      }
    } else if (eff.kind === "realtime-emit" && typeof realtimeEmit === "function") {
      try {
        realtimeEmit(eff.event, eff.payload || {});
      } catch (err) {
        logger.warn("heartbeat-pool", "emit_replay_failed", {
          event: eff.event, error: err?.message,
        });
      }
    }
  }
}

function _updatePoolGauges() {
  try {
    const m = globalThis._concordPromMetrics;
    if (!m) return;
    m.heartbeatWorkerPoolSize?.set(HEARTBEAT_POOL_SIZE);
    m.heartbeatWorkerPoolBusy?.set(workers.filter((w) => w && w._busy).length);
    m.heartbeatWorkerPoolQueueLen?.set(queue.length);
  } catch { /* prom best-effort */ }
}
