/**
 * Heartbeat worker — receives {type:'tick', moduleId, ctxSnapshot} from the
 * pool, runs the module handler with a shim ctx that collects DB writes
 * and realtime emits as side effects (replayed by the main thread).
 *
 * Workers open their own read-only better-sqlite3 handle so queries inside
 * the handler don't have to cross the thread boundary. better-sqlite3 is
 * synchronous, not thread-safe — each worker MUST have its own handle.
 *
 * Track A/B (event-loop unblocking audit) — write-queueing correctness fix.
 * Every currently-`worker:true` handler (faction-strategy-cycle,
 * lattice-quest-cycle, embodied-dream-cycle, forward-sim-cycle,
 * refusal-field-sweep, lattice-drift-scan, lattice-breakthrough-pass) was
 * written to call `db.prepare(sql).run(...)` directly, the normal pattern
 * used everywhere else in this codebase — NONE of them call the
 * `ctx.queueWrite`/`ctx.queueEmit` helpers this file used to define as the
 * only supported side-effect path. Since the DB handle here opens
 * `{readonly:true}`, every one of those direct `.run()` calls on an
 * INSERT/UPDATE/DELETE/REPLACE statement threw `SQLITE_READONLY` on first
 * write, was caught by this file's or the handler's own try/catch, and
 * silently discarded every state change those modules were supposed to
 * make — every tick, since the pool is genuinely wired at boot
 * (`initHeartbeatPool`/`setHeartbeatPool` in server.js). `_db` below is now
 * wrapped by `_makeQueueingDb()` so a plain `db.prepare(sql).run(params)`
 * call auto-detects a write statement and queues it as a side effect
 * instead of executing it against the readonly connection — existing
 * handler code works unmodified in both this worker context and its normal
 * main-thread context, with zero per-module changes required. `queueWrite`/
 * `queueEmit` remain available for handlers that want to opt in explicitly
 * (e.g. to queue a write whose SQL text doesn't start with a detectable
 * write keyword, such as a CTE-prefixed UPDATE). The shim itself lives in
 * ./heartbeat-write-queue.js so it can be unit-tested directly.
 */

import { parentPort, workerData } from "node:worker_threads";
import { makeQueueingDb } from "./heartbeat-write-queue.js";

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

// Bounded by design: keyed only by the fixed, hardcoded set of worker-flagged
// module IDs in idToPath below (~12 entries) — this never grows with users,
// worlds, or runtime data, so no eviction is needed.
const _moduleCache = new Map(); // @bounded-cache-ok: keyed only by the fixed ~12 hardcoded module IDs in idToPath below, never grows with users/worlds/runtime data

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
    // Track B additions (event-loop unblocking audit) — SAFE-tier candidates:
    // bounded per-row compute, no live-STATE dependency, no inline mid-loop
    // realtime emit (batched-after-loop or none at all).
    "world-migration-cycle": ["../emergent/world-migration-cycle.js", "runWorldMigrationCycle"],
    "signal-propagation-cycle": ["../emergent/signal-propagation-cycle.js", "runSignalPropagationCycle"],
    "npc-routine-cycle": ["../emergent/npc-routine-cycle.js", "runNpcRoutineCycle"],
    "npc-economy-cycle": ["../emergent/npc-economy-cycle.js", "runNpcEconomyCycle"],
    "world-population-cycle": ["../emergent/world-population-cycle.js", "runWorldPopulationCycle"],
    "literary-resonance-cycle": ["../emergent/literary-resonance-cycle.js", "runLiteraryResonanceCycle"],
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

    const realDb = await _loadDb();
    const ctx = {
      // Write-queueing shim over the real readonly handle — see the
      // Track A/B fix comment at the top of this file. A plain
      // `db.prepare(sql).run(params)` call on a detected write statement
      // queues it as a side effect instead of throwing SQLITE_READONLY;
      // reads pass straight through to the real connection.
      db: makeQueueingDb(realDb, sideEffects),
      state: { settings: ctxSnapshot.settings || {}, shadowDtus: new Map() },
      tickCount: ctxSnapshot.tickCount ?? 0,
      reason: ctxSnapshot.reason ?? "worker_tick",
      // Explicit opt-in side-effect collectors, for the rare write whose SQL
      // text the shim above can't classify (e.g. a CTE-prefixed UPDATE).
      queueWrite: (sql, params = []) => {
        sideEffects.push({ kind: "db-write", sql, params });
      },
      queueEmit: (event, payload = {}) => {
        sideEffects.push({ kind: "realtime-emit", event, payload });
      },
    };

    // Bridge the `globalThis._concordRealtimeEmit(event, payload)` convention
    // several handlers use directly (e.g. npc-routine-cycle, npc-economy-cycle)
    // instead of ctx.queueEmit — the same bridge world-shard.js already sets
    // up for its own worker realm. Without this, that convention silently
    // no-ops inside a worker (its own globalThis is a separate realm from the
    // main thread's), which is a safe-but-lossy degradation for data (writes
    // still queue correctly via the db shim above) but a real regression for
    // realtime UX (the live socket event never fires). Only one tick is ever
    // in flight per worker at a time (the pool marks a worker busy until its
    // result posts back), so scoping this per-message is safe — no risk of a
    // later tick's emits leaking into an earlier tick's sideEffects array.
    globalThis._concordRealtimeEmit = (event, payload = {}) => {
      sideEffects.push({ kind: "realtime-emit", event, payload });
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
