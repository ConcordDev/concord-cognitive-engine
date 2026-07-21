/**
 * Macro Worker Pool — Offloads CPU-intensive macro execution to worker threads.
 *
 * Architecture:
 *   User Request → Express Route → isHeavy(domain)?
 *                                    ├─ No  → run on main thread (fast path)
 *                                    └─ Yes → dispatch to worker pool (async)
 *                                              ├─ Worker 1
 *                                              ├─ Worker 2
 *                                              └─ Worker N
 *                                              Result → respond to user
 *
 * Workers receive serialized STATE snapshots and return results.
 * All STATE mutations happen on the main thread after result merge.
 */

import { Worker } from "node:worker_threads";
import path from "path";
import { fileURLToPath } from "url";
import logger from '../logger.js';
import { getRealCpuCount } from "../lib/cgroup-cpu.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GPU/CPU pinning audit — getRealCpuCount() reads the cgroup-restricted core
// count (matching scripts/pin-processes.sh's own detection), not the raw
// os.cpus().length a shared/cgroup-limited host lies about. The Math.min(2, ...)
// cap already bounded the practical damage of the old lie, but a correct
// signal is still the right default to compute from.
const POOL_SIZE = Math.min(2, Math.max(1, getRealCpuCount() - 1)); // Cap at 2 to limit RSS

// Stability audit (2026-07-20) — without an explicit resourceLimits, a
// worker_thread inherits the FULL main-thread --max-old-space-size ceiling
// (they share the process-wide V8 flag unless overridden per-worker). Macro
// execution can be heavier than a heartbeat tick (CAS engine, FEA solver,
// etc.), so this gets a larger allowance than the heartbeat pool's 512MB.
// Override via CONCORD_MACRO_WORKER_HEAP_MB.
const MACRO_WORKER_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: Number(process.env.CONCORD_MACRO_WORKER_HEAP_MB) || 1024,
};

// Heavy macro domains — these get offloaded to workers
const HEAVY_DOMAINS = new Set([
  "system",      // autogen, dream, evolution, synthesize
  "emergent",    // entity operations, lattice, sessions
  "ingest",      // knowledge ingestion
  "context",     // query processing with working sets
  "hypothesis",  // hypothesis generation
  "meta",        // meta-derivation
  "hlr",         // higher-level reasoning
  "hlm",         // higher-level memory
  "creative",    // creative generation
  "search",      // semantic search
]);

// Explicit lightweight overrides within heavy domains
const LIGHT_OVERRIDES = new Set([
  "system.status",
  "system.getStatus",
  "emergent.list",
  "emergent.get",
  "emergent.status",
  "emergent.schema",
  "emergent.patterns",
  "emergent.reputation",
]);

const workers = [];
const queue = [];
let _stateSnapshot = null;
let _poolReady = false;
const _metrics = {
  dispatched: 0,
  completed: 0,
  errors: 0,
  queueHighWater: 0,
  avgLatencyMs: 0,
  _latencySum: 0,
};

/**
 * Initialize the worker pool.
 * @param {string} statePath - Not used directly; workers get snapshots via postMessage.
 */
export function initPool() {
  for (let i = 0; i < POOL_SIZE; i++) {
    const workerPath = path.join(__dirname, "macro-executor.js");
    const w = new Worker(workerPath, {
      workerData: { workerId: i },
      resourceLimits: MACRO_WORKER_RESOURCE_LIMITS,
    });
    // Test hygiene: unref pooled workers under NODE_ENV=test so they don't keep
    // the node:test process alive after a suite finishes (they still process
    // dispatched tasks while the loop is alive). Lets the runner exit WITHOUT
    // --test-force-exit, which was masking this handle. Production untouched.
    if (String(process.env.NODE_ENV).toLowerCase() === "test") w.unref();
    w._id = i;
    w._busy = false;
    w._task = null;
    w._startTime = 0;

    w.on("message", (msg) => handleWorkerMessage(w, msg));
    w.on("error", (err) => handleWorkerError(w, err));
    w.on("exit", (code) => handleWorkerExit(w, code));

    workers.push(w);
  }
  _poolReady = true;
}

/**
 * Check if a macro domain/name combination should be offloaded to workers.
 */
export function isHeavy(domain, name) {
  if (LIGHT_OVERRIDES.has(`${domain}.${name}`)) return false;
  return HEAVY_DOMAINS.has(domain);
}

/**
 * Dispatch a macro execution to the worker pool.
 * Returns a Promise that resolves with the macro result.
 */
export function dispatch(domain, name, input, actorInfo) {
  return new Promise((resolve, reject) => {
    const task = { domain, name, input, actorInfo, resolve, reject, queuedAt: Date.now() };
    _metrics.dispatched++;

    const freeWorker = workers.find(w => !w._busy);
    if (freeWorker) {
      runOnWorker(freeWorker, task);
    } else {
      queue.push(task);
      if (queue.length > _metrics.queueHighWater) {
        _metrics.queueHighWater = queue.length;
      }
    }
  });
}

/**
 * Send a STATE snapshot to all workers for read operations.
 * Called periodically from main thread and after DTU commits.
 */
export function syncState(snapshot) {
  _stateSnapshot = snapshot;
  for (const w of workers) {
    try {
      w.postMessage({ type: "state-sync", state: snapshot });
    } catch (_e) { logger.debug('macro-pool', 'worker may be dead, will restart', { error: _e?.message }); }
  }
}

/**
 * Get pool statistics.
 */
export function getPoolStats() {
  return {
    poolSize: POOL_SIZE,
    ready: _poolReady,
    busy: workers.filter(w => w._busy).length,
    idle: workers.filter(w => !w._busy).length,
    queueLength: queue.length,
    metrics: {
      dispatched: _metrics.dispatched,
      completed: _metrics.completed,
      errors: _metrics.errors,
      queueHighWater: _metrics.queueHighWater,
      avgLatencyMs: _metrics.completed > 0
        ? Math.round(_metrics._latencySum / _metrics.completed)
        : 0,
    },
  };
}

/**
 * Gracefully shut down all workers.
 */
export function shutdownPool() {
  _poolReady = false;
  for (const w of workers) {
    try { w.postMessage({ type: "shutdown" }); } catch (_e) { logger.debug('macro-pool', 'silent', { error: _e?.message }); }
  }
  // Reject any queued tasks
  for (const task of queue) {
    task.reject(new Error("pool_shutdown"));
  }
  queue.length = 0;
}

/**
 * Test-only: shut down every pooled worker and AWAIT actual thread exit.
 *
 * `node --test` waits for worker threads to genuinely terminate before
 * considering a test file complete — a `.unref()`'d worker is enough for a
 * plain script to exit cleanly, but not enough for `node --test`'s own
 * file-completion tracking (confirmed via minimal repro, 2026-07-06: an
 * unref'd Worker with a message listener alone reproduces the clean-exit-
 * canary hang). `shutdownPool()` above asks workers to exit via postMessage
 * but never waits for the resulting exit, so callers can't know the threads
 * are actually gone.
 *
 * This uses the SAME graceful postMessage("shutdown") path (the worker calls
 * `process.exit(0)` itself — see macro-executor.js) rather than
 * `worker.terminate()`, because terminate() reports exit code 1, and
 * `handleWorkerExit` respawns on any non-zero code — calling terminate()
 * directly would race a fresh, untracked replacement worker into existence
 * right as this function tries to clear the pool.
 */
export async function terminateAllForTest() {
  _poolReady = false;
  const toKill = workers.splice(0, workers.length);
  await Promise.all(toKill.map((w) => new Promise((resolve) => {
    const done = () => resolve();
    w.once("exit", done);
    try { w.postMessage({ type: "shutdown" }); } catch { done(); }
    // Fallback: if the worker doesn't self-exit promptly (e.g. it's mid-task
    // and the message is queued behind other work), force it after a short
    // grace period rather than hanging the test teardown itself.
    setTimeout(() => { w.terminate().catch(() => {}); }, 2000).unref();
  })));
  for (const task of queue) {
    try { task.reject(new Error("pool_shutdown")); } catch { /* listener may be gone */ }
  }
  queue.length = 0;
}

// ── Internal ──────────────────────────────────────────────────────────────────

const WORKER_TIMEOUT_MS = 30_000; // Kill workers that hang beyond 30s

function runOnWorker(worker, task) {
  worker._busy = true;
  worker._task = task;
  worker._startTime = Date.now();
  // Set a hard timeout: if worker doesn't respond, terminate and respawn
  worker._timeoutTimer = setTimeout(() => {
    if (worker._busy && worker._task === task) {
      console.error(`[macro-pool] Worker ${worker._id} timed out on ${task.domain}.${task.name} after ${WORKER_TIMEOUT_MS}ms, terminating`);
      _metrics.errors++;
      task.reject(new Error(`worker_timeout: ${task.domain}.${task.name} exceeded ${WORKER_TIMEOUT_MS}ms`));
      worker._task = null;
      worker._busy = false;
      // Terminate triggers handleWorkerExit which respawns
      try { worker.terminate(); } catch (_e) { /* already dead */ }
    }
  }, WORKER_TIMEOUT_MS);
  worker.postMessage({
    type: "exec",
    domain: task.domain,
    name: task.name,
    input: task.input,
    actorInfo: task.actorInfo,
  });
}

function handleWorkerMessage(worker, msg) {
  if (msg.type === "ready") return;

  if (msg.type === "exec-result") {
    // Clear the timeout timer — worker responded in time
    if (worker._timeoutTimer) { clearTimeout(worker._timeoutTimer); worker._timeoutTimer = null; }
    const task = worker._task;
    const latency = Date.now() - worker._startTime;
    worker._busy = false;
    worker._task = null;

    _metrics.completed++;
    _metrics._latencySum += latency;

    if (msg.error) {
      _metrics.errors++;
      task?.reject(new Error(msg.error));
    } else {
      task?.resolve(msg.result);
    }

    // Process next queued task
    if (queue.length > 0) {
      runOnWorker(worker, queue.shift());
    }
  }
}

function handleWorkerError(worker, err) {
  console.error(`[macro-pool] Worker ${worker._id} error:`, err.message);
  _metrics.errors++;

  // Reject current task
  if (worker._task) {
    worker._task.reject(new Error(`worker_error: ${err.message}`));
    worker._task = null;
  }
  worker._busy = false;

  // Process next queued task if worker is still alive
  if (queue.length > 0) {
    runOnWorker(worker, queue.shift());
  }
}

function handleWorkerExit(worker, code) {
  worker._busy = false;
  if (code !== 0) {
    console.error(`[macro-pool] Worker ${worker._id} exited with code ${code}, restarting...`);
    // Replace the dead worker
    const idx = workers.indexOf(worker);
    if (idx >= 0) {
      const workerPath = path.join(__dirname, "macro-executor.js");
      const newWorker = new Worker(workerPath, {
        workerData: { workerId: worker._id },
        resourceLimits: MACRO_WORKER_RESOURCE_LIMITS,
      });
      if (String(process.env.NODE_ENV).toLowerCase() === "test") newWorker.unref();
      newWorker._id = worker._id;
      newWorker._busy = false;
      newWorker._task = null;
      newWorker._startTime = 0;
      newWorker.on("message", (msg) => handleWorkerMessage(newWorker, msg));
      newWorker.on("error", (err) => handleWorkerError(newWorker, err));
      newWorker.on("exit", (exitCode) => handleWorkerExit(newWorker, exitCode));
      workers[idx] = newWorker;
    }
  }
}
