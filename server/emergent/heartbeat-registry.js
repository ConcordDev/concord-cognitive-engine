// server/emergent/heartbeat-registry.js
//
// Runtime tick-scheduling registry. Heartbeat modules register a frequency
// and handler; the governor tick iterates registered modules and fires
// the ones whose `tickCount % frequency === 0`.
//
// This is orthogonal to module-registry.js (which is auto-generated metadata
// describing the emergent module dependency graph). The runtime registry
// here lets new heartbeat modules slot in with a one-liner instead of
// editing governorTick() directly.
//
// Per the project invariant in CLAUDE.md: a module crash must never stop
// the tick. Every handler is wrapped in try/catch.
//
// Phase A — Modules are dispatched in PARALLEL by default. Modules with
// ordering dependencies opt back in via `serial: true`.
// Phase B — Each handler invocation is timed and observed into the
// `concord_heartbeat_block_ms` histogram (declared in server.js). Hung
// modules are timed out at MODULE_TIMEOUT_MS so they cannot starve
// the next tick.
// Phase C — Modules flagged `worker: true` route through the heartbeat
// worker pool instead of running inline on the main thread.
// Phase F — Modules flagged `scope: 'global'` only run on the parent
// process; default `scope: 'world'` modules run inside the world shard
// when CONCORD_SHARD_WORLDS is enabled (the shard manager owns the
// per-world dispatch).

import logger from "../logger.js";
// Phase G — per-world flavor lookup. Used by the dispatcher to skip
// modules that loops.json has disabled for the current world (only
// meaningful when ctx.worldId is set, i.e. inside a world shard).
let _isLoopEnabledForWorld = null;
let _getLoopFrequencyForWorld = null;
try {
  const wf = await import("../lib/world-flavor.js");
  _isLoopEnabledForWorld = wf.isLoopEnabledForWorld;
  _getLoopFrequencyForWorld = wf.getLoopFrequencyForWorld;
} catch { /* flavor lib optional — pre-Phase-G builds fall back to "enabled" */ }

/**
 * @typedef {Object} RegistryEntry
 * @property {string} id
 * @property {number} frequency
 * @property {Function} handler
 * @property {boolean} [neverDisable]
 * @property {boolean} [serial]      Run serially after parallel batch (ordering-sensitive).
 * @property {boolean} [worker]      Route through heartbeat worker pool.
 * @property {'global'|'world'} [scope]  Phase-F sharding scope. Default 'world'.
 */

/** @type {Map<string, RegistryEntry>} */
const REGISTRY = new Map();

function _moduleTimeoutMs() {
  // Read at call time so tests + admin overrides take effect without restart.
  const v = Number(process.env.CONCORD_HEARTBEAT_MODULE_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 30_000;
}

let _heartbeatPool = null;
/**
 * Inject the heartbeat worker pool. Called once at boot from server.js.
 * Pool must expose `exec(moduleId, ctxSnapshot) → Promise<{ok, sideEffects?}>`.
 */
export function setHeartbeatPool(pool) { _heartbeatPool = pool; }

/**
 * Register a heartbeat module.
 * @param {string} id - Stable identifier (used in logs and disable lists).
 * @param {object} opts
 * @param {number} opts.frequency - Run on every Nth tick (1 = every tick).
 * @param {(ctx: { state: object, db: object, tickCount: number, reason: string }) => Promise<void>|void} opts.handler
 * @param {boolean} [opts.neverDisable] - If true, runs even when STATE.settings.disabledHeartbeats includes id.
 * @param {boolean} [opts.serial] - If true, runs after the parallel batch in registration order.
 * @param {boolean} [opts.worker] - If true, routes through the heartbeat worker pool.
 * @param {'global'|'world'} [opts.scope] - 'global' runs on parent only, 'world' (default) inside world shards.
 */
export function registerHeartbeat(id, { frequency, handler, neverDisable = false, serial = false, worker = false, scope = "world" }) {
  if (!id || typeof id !== "string") throw new Error("registerHeartbeat: id required");
  if (!Number.isInteger(frequency) || frequency < 1) {
    throw new Error(`registerHeartbeat(${id}): frequency must be a positive integer`);
  }
  if (typeof handler !== "function") throw new Error(`registerHeartbeat(${id}): handler must be a function`);
  if (scope !== "global" && scope !== "world") {
    throw new Error(`registerHeartbeat(${id}): scope must be 'global' or 'world'`);
  }
  REGISTRY.set(id, { id, frequency, handler, neverDisable, serial, worker, scope });
}

/**
 * Iterate all registered modules and run those whose tick is due.
 * Parallel-by-default; modules flagged `serial: true` run after the parallel
 * batch in registration order. Each handler is independently try/caught and
 * timed; a hung module is timed out at MODULE_TIMEOUT_MS so it cannot starve
 * the next tick.
 *
 * @param {{ state: object, db: object, tickCount: number, reason?: string, scope?: 'global'|'world'|'all' }} ctx
 */
export async function tickAllRegistered(ctx) {
  const tickCount = Number.isInteger(ctx?.tickCount) ? ctx.tickCount : 0;
  const reason = ctx?.reason ?? "heartbeat";
  const filterScope = ctx?.scope ?? "all";
  const disabled = new Set(ctx?.state?.settings?.disabledHeartbeats ?? []);

  const parallel = [];
  const serial = [];

  const worldId = ctx?.worldId ?? null;
  for (const entry of REGISTRY.values()) {
    // Phase G — per-world frequency override (loops.json#loops.<id>.frequency).
    const effectiveFreq = (worldId && _getLoopFrequencyForWorld)
      ? (_getLoopFrequencyForWorld(worldId, entry.id) ?? entry.frequency)
      : entry.frequency;
    if (tickCount % effectiveFreq !== 0) continue;
    if (!entry.neverDisable && disabled.has(entry.id)) continue;
    if (filterScope !== "all" && entry.scope !== filterScope) continue;
    // Phase G — per-world enable flag.
    if (worldId && _isLoopEnabledForWorld && !_isLoopEnabledForWorld(worldId, entry.id)) continue;
    (entry.serial ? serial : parallel).push(entry);
  }

  const moduleCtx = { state: ctx.state, db: ctx.db, tickCount, reason };

  if (parallel.length > 0) {
    await Promise.all(parallel.map((entry) => _runOne(entry, moduleCtx)));
  }
  for (const entry of serial) {
    await _runOne(entry, moduleCtx);
  }
}

async function _runOne(entry, moduleCtx) {
  const startNs = process.hrtime.bigint();
  let timedOut = false;
  let timeoutHandle = null;
  try {
    const timeoutPromise = new Promise((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        reject(new Error(`heartbeat_module_timeout:${entry.id}`));
      }, _moduleTimeoutMs());
    });

    let workPromise;
    if (entry.worker && _heartbeatPool && typeof _heartbeatPool.exec === "function") {
      workPromise = _heartbeatPool.exec(entry.id, _snapshotForWorker(moduleCtx));
    } else {
      workPromise = Promise.resolve().then(() => entry.handler(moduleCtx));
    }

    await Promise.race([workPromise, timeoutPromise]);
  } catch (err) {
    const tag = timedOut ? "module_timeout" : "module_failed";
    try {
      logger.warn("heartbeat-registry", `${tag}:${entry.id}`, {
        tickCount: moduleCtx.tickCount,
        frequency: entry.frequency,
        worker: !!entry.worker,
        error: err?.message ?? String(err),
      });
    } catch { /* logging best-effort — tick must continue */ }
    if (timedOut) {
      try { globalThis._concordPromMetrics?.heartbeatModuleTimeout?.inc({ module: entry.id }); } catch { /* prom best-effort */ }
    } else {
      try { globalThis._concordPromMetrics?.heartbeatModuleErrors?.inc({ module: entry.id }); } catch { /* prom best-effort */ }
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    try { globalThis._concordPromMetrics?.heartbeatBlockMs?.observe({ module: entry.id }, elapsedMs); } catch { /* prom best-effort */ }
    try { _recordTiming(entry.id, elapsedMs); } catch { /* timing best-effort */ }
  }
}

// ── In-process rolling timing ring (last N samples per module) ──────────────
// Powers /api/admin/heartbeat-stats without depending on a Prometheus
// scrape. Cap per-module retention so memory stays bounded.

const TIMING_HISTORY_LIMIT = Number(process.env.CONCORD_HEARTBEAT_TIMING_HISTORY) || 60;
/** @type {Map<string, number[]>} */
const _timingHistory = new Map();
/** @type {Map<string, { lastMs: number, lastAt: number, totalRuns: number, totalErrors: number }>} */
const _timingMeta = new Map();

function _recordTiming(moduleId, ms) {
  let arr = _timingHistory.get(moduleId);
  if (!arr) { arr = []; _timingHistory.set(moduleId, arr); }
  arr.push(ms);
  if (arr.length > TIMING_HISTORY_LIMIT) arr.shift();
  let meta = _timingMeta.get(moduleId);
  if (!meta) { meta = { lastMs: 0, lastAt: 0, totalRuns: 0, totalErrors: 0 }; _timingMeta.set(moduleId, meta); }
  meta.lastMs = ms;
  meta.lastAt = Date.now();
  meta.totalRuns += 1;
}

/** Sorted-array quantile helper (q in [0,1]). */
function _quantile(sortedArr, q) {
  if (!sortedArr.length) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(q * (sortedArr.length - 1))));
  return sortedArr[idx];
}

/** Snapshot of timing history per module, with p50/p90/p99 derived. */
export function getHeartbeatTimingStats() {
  const out = [];
  for (const entry of REGISTRY.values()) {
    const samples = (_timingHistory.get(entry.id) || []).slice().sort((a, b) => a - b);
    const meta = _timingMeta.get(entry.id) || { lastMs: 0, lastAt: 0, totalRuns: 0, totalErrors: 0 };
    out.push({
      id: entry.id,
      frequency: entry.frequency,
      scope: entry.scope,
      serial: !!entry.serial,
      worker: !!entry.worker,
      sampleCount: samples.length,
      p50: _quantile(samples, 0.5),
      p90: _quantile(samples, 0.9),
      p99: _quantile(samples, 0.99),
      max: samples.length ? samples[samples.length - 1] : 0,
      lastMs: meta.lastMs,
      lastAt: meta.lastAt,
      totalRuns: meta.totalRuns,
    });
  }
  out.sort((a, b) => b.p99 - a.p99);
  return out;
}

/**
 * For worker-routed modules — main thread sends a small, serializable
 * snapshot instead of the live STATE/DB references.
 */
function _snapshotForWorker(moduleCtx) {
  const settings = moduleCtx?.state?.settings ?? {};
  return {
    tickCount: moduleCtx.tickCount,
    reason: moduleCtx.reason,
    // Forward env-derived knobs the workers might need.
    settings: {
      heartbeatMs: settings.heartbeatMs ?? 60_000,
    },
  };
}

/** Return a snapshot of registered modules — used by health/observability endpoints. */
export function listHeartbeatModules() {
  return Array.from(REGISTRY.values()).map((e) => ({
    id: e.id,
    frequency: e.frequency,
    neverDisable: !!e.neverDisable,
    serial: !!e.serial,
    worker: !!e.worker,
    scope: e.scope,
  }));
}

/** Test-only helper: clear the registry between tests. */
export function _resetHeartbeatRegistry() {
  REGISTRY.clear();
  _timingHistory.clear();
  _timingMeta.clear();
}
