/**
 * Heartbeat worker — receives {type:'tick', moduleId, ctxSnapshot} from the
 * pool, runs the module handler with a shim ctx that collects DB writes
 * and realtime emits as side effects (replayed by the main thread).
 *
 * Workers open their own read-only better-sqlite3 handle so queries inside
 * the handler don't have to cross the thread boundary. better-sqlite3 is
 * synchronous, not thread-safe — each worker MUST have its own handle.
 */

import { parentPort, workerData } from "node:worker_threads";

let _db = null;
let _dbReady = false;

async function _loadDb() {
  if (_dbReady) return _db;
  _dbReady = true;
  if (!workerData?.dbPath) return null;
  try {
    const mod = await import("better-sqlite3");
    const Database = mod.default;
    _db = new Database(workerData.dbPath, { readonly: true, fileMustExist: false });
    try {
      _db.pragma("journal_mode = WAL");
      _db.pragma("busy_timeout = 5000");
    } catch { /* pragmas best-effort */ }
    return _db;
  } catch (err) {
    parentPort.postMessage({
      type: "tick-result",
      ok: false,
      error: `worker_db_open_failed:${err?.message}`,
      sideEffects: [],
    });
    return null;
  }
}

const _moduleCache = new Map();

async function _loadModule(moduleId) {
  if (_moduleCache.has(moduleId)) return _moduleCache.get(moduleId);
  // Map known worker-flagged module IDs to their source files.
  const idToPath = {
    "refusal-field-sweep": ["../lib/refusal-field.js", "runRefusalFieldSweep"],
    "faction-strategy-cycle": ["../emergent/faction-strategy-cycle.js", "runFactionStrategyCycle"],
    "lattice-quest-cycle": ["../emergent/lattice-quest-cycle.js", "runLatticeQuestCycle"],
    "embodied-dream-cycle": ["../emergent/embodied-dream-cycle.js", "runEmbodiedDreamCycle"],
    "forward-sim-cycle": ["../emergent/forward-sim-cycle.js", "runForwardSimCycle"],
    "lattice-drift-scan": ["../emergent/lattice-orchestrator.js", "runPeriodicDriftScan"],
    "lattice-breakthrough-pass": ["../emergent/lattice-orchestrator.js", "runBreakthroughResearchPass"],
  };
  const entry = idToPath[moduleId];
  if (!entry) {
    _moduleCache.set(moduleId, null);
    return null;
  }
  try {
    const mod = await import(entry[0]);
    const handler = mod[entry[1]];
    if (typeof handler !== "function") {
      _moduleCache.set(moduleId, null);
      return null;
    }
    _moduleCache.set(moduleId, handler);
    return handler;
  } catch (err) {
    parentPort.postMessage({
      type: "tick-result",
      ok: false,
      error: `worker_module_load_failed:${moduleId}:${err?.message}`,
      sideEffects: [],
    });
    _moduleCache.set(moduleId, null);
    return null;
  }
}

parentPort.on("message", async (msg) => {
  if (msg?.type === "shutdown") {
    try { _db?.close(); } catch { /* best-effort */ }
    process.exit(0);
  }
  if (msg?.type !== "tick") return;

  const moduleId = msg.moduleId;
  const ctxSnapshot = msg.ctxSnapshot || {};
  const sideEffects = [];
  const startNs = process.hrtime.bigint();

  try {
    const handler = await _loadModule(moduleId);
    if (!handler) {
      parentPort.postMessage({
        type: "tick-result",
        moduleId,
        ok: false,
        error: `worker_module_unknown:${moduleId}`,
        sideEffects,
      });
      return;
    }

    const db = await _loadDb();
    const ctx = {
      // Read-only DB handle (workers must never write to the shared DB).
      db,
      state: { settings: ctxSnapshot.settings || {}, shadowDtus: new Map() },
      tickCount: ctxSnapshot.tickCount ?? 0,
      reason: ctxSnapshot.reason ?? "worker_tick",
      // Side-effect collectors the handler can call instead of mutating
      // directly. Backward-compat: handlers that don't know about these
      // helpers just won't queue side effects — they'll silently do nothing.
      queueWrite: (sql, params = []) => {
        sideEffects.push({ kind: "db-write", sql, params });
      },
      queueEmit: (event, payload = {}) => {
        sideEffects.push({ kind: "realtime-emit", event, payload });
      },
    };

    const result = await handler(ctx);
    const ok = result == null ? true : (result.ok !== false);
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    parentPort.postMessage({
      type: "tick-result",
      moduleId,
      ok,
      durationMs,
      result: result ?? null,
      sideEffects,
    });
  } catch (err) {
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    parentPort.postMessage({
      type: "tick-result",
      moduleId,
      ok: false,
      durationMs,
      error: err?.message ?? String(err),
      sideEffects,
    });
  }
});

parentPort.postMessage({ type: "ready", workerId: workerData?.workerId ?? -1 });
