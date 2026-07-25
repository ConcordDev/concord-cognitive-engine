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
import path from "path";
import { fileURLToPath } from "url";
import logger from "../logger.js";
import { getRealCpuCount } from "../lib/cgroup-cpu.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GPU/CPU pinning audit — getRealCpuCount() reads the cgroup-restricted core
// count, not the raw os.cpus().length a shared/cgroup-limited host (e.g. a
// RunPod pod, where nproc/os.cpus() reports the HOST's real core count, not
// the pod's slice — see scripts/runpod-cognition.sh's own comment on this)
// lies about. Uncapped-by-a-tight-ceiling here (only Math.min(..., 8)) meant
// a lying host could size this pool well past what a small, CPU-constrained
// deploy (e.g. CONCORD_WORLD_CORE_COUNT=2 on a 9-vCPU box) actually has
// available for the backend process at all.
const HEARTBEAT_POOL_SIZE = Math.max(
  1,
  Math.min(
    Number(process.env.CONCORD_HEARTBEAT_POOL_SIZE) || (getRealCpuCount() - 2),
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
    // Stability audit (2026-07-20) — without an explicit resourceLimits, a
    // worker_thread inherits the SAME --max-old-space-size ceiling as the
    // main thread (they share the process-wide V8 flag unless overridden
    // per-worker). With CONCORD_HEARTBEAT_POOL_SIZE workers all running
    // light, bounded per-module tick work off a readonly DB handle, a leak
    // or runaway allocation in a single heartbeat module could otherwise
    // grow that one worker toward the SAME ceiling as the entire main
    // thread — on a real memory-constrained box (see ecosystem.config.cjs's
    // bare-metal RAM budget comment) that's real headroom one misbehaving
    // module shouldn't be able to claim. 512MB is generous for this pool's
    // actual workload; override via CONCORD_HEARTBEAT_WORKER_HEAP_MB.
    resourceLimits: {
      maxOldGenerationSizeMb: Number(process.env.CONCORD_HEARTBEAT_WORKER_HEAP_MB) || 512,
    },
  });
  // Test hygiene: unref under NODE_ENV=test so the pool doesn't keep the
  // node:test process alive after a suite finishes (see macro-pool.js). Prod
  // untouched.
  if (String(process.env.NODE_ENV).toLowerCase() === "test") w.unref();
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

/**
 * Test-only: shut down every pooled worker and AWAIT actual thread exit —
 * see the matching function in workers/macro-pool.js for why this exists
 * (`node --test` waits for worker threads to genuinely terminate, not just
 * be `.unref()`'d, before considering a test file complete). `_poolReady` is
 * cleared first so `_handleWorkerExit`'s respawn (gated on `_poolReady`)
 * can't race a fresh worker into existence during teardown.
 */
export async function terminateAllForTest() {
  _poolReady = false;
  const toKill = workers.splice(0, workers.length).filter(Boolean);
  await Promise.all(toKill.map((w) => new Promise((resolve) => {
    // Root-caused via direct diagnostic (2026-07-25): the worker genuinely
    // calls `_db.close()` + `process.exit(0)` within ~1-3ms of receiving the
    // shutdown postMessage — worker-side teardown is NOT the slow part. The
    // hang is entirely main-thread-side and specific to running under
    // `node --test`: workers are spawned `.unref()`'d (see _spawnWorker) so
    // a live pool never keeps a test-file process alive, and the fallback
    // timer below used to be `.unref()`'d too. With NOTHING left ref'd, the
    // event loop can decide it has "nothing to do" and let the process wind
    // down WITHOUT ever delivering the worker's buffered "exit" event back
    // to this listener — leaving the surrounding Promise permanently
    // pending until `--test-force-exit` yanks the process, which node:test
    // correctly reports as "Promise resolution is still pending but the
    // event loop has already resolved" (confirmed via a minimal repro: the
    // identical sequence resolves in ~6ms as a plain script, only hangs
    // under `node --test`). Since this function's entire purpose is to
    // BLOCK until the worker is genuinely gone, re-ref the worker for this
    // teardown-only wait so the loop stays alive long enough to observe the
    // real exit, and make the fallback timer ref'd + a hard resolve path
    // (not just a `.terminate()` call relying on yet another "exit" event)
    // so this can never hang indefinitely even if "exit" is somehow lost.
    w.ref();
    let fallback;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      resolve();
    };
    w.once("exit", finish);
    try { w.postMessage({ type: "shutdown" }); } catch { finish(); }
    fallback = setTimeout(() => {
      try { w.terminate(); } catch { /* already dead */ }
      finish();
    }, 2000);
  })));
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
    } else if (eff.kind === "db-exec" && db && eff.sql) {
      // Multi-statement DDL/DML queued via the transparent write-queueing
      // shim's `.exec()` intercept (heartbeat-executor.js) — rare in handler
      // code, but supported for completeness since .prepare().run() alone
      // doesn't cover it.
      try {
        db.exec(eff.sql);
      } catch (err) {
        logger.warn("heartbeat-pool", "db_exec_replay_failed", {
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
