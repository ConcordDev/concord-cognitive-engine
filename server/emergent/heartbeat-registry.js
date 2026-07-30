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
// Phase A — Modules are dispatched STRICTLY SEQUENTIALLY, one at a time,
// never Promise.all/concurrently (see the doc comment on
// `tickAllRegistered()` below for why). `serial: true` modules simply run
// after the default-flagged ones, in registration order — it is not an
// opt-in to a parallel default, both groups are sequential.
// Phase B — Each handler invocation is timed and observed into the
// `concord_heartbeat_block_ms` histogram (declared in server.js). Each
// handler races against a MODULE_TIMEOUT_MS timer via `Promise.race` so a
// hung module doesn't block the dispatcher indefinitely — but this only
// bounds handlers that actually yield the event loop (i.e. `await` at
// least once). A synchronous, CPU-bound handler runs the JS stack to
// completion before anything else — including the timeout's own
// `setTimeout` callback — can execute, so for a truly synchronous hang
// this is not real preemption/cancellation, only a best-effort bound on
// handlers that cooperate by awaiting.
// Phase C — Modules flagged `worker: true` route through the heartbeat
// worker pool instead of running inline on the main thread.
// Phase F — Modules flagged `scope: 'global'` only run on the parent
// process; default `scope: 'world'` modules run inside the world shard
// when CONCORD_SHARD_WORLDS is enabled (the shard manager owns the
// per-world dispatch).
// Track C (event-loop unblocking audit) — modules flagged `lowPriority:
// true` are genuinely deferrable maintenance/enrichment work (a codebase
// self-scan, a detector sweep — not anything gameplay- or request-critical)
// that skips its due tick entirely (not queued, not delayed-then-run) when
// `isUnderPressure()` reports the event loop already under real load. This
// is never a permanent loss — the module simply runs on its next due tick
// once pressure clears, exactly the same "harmless to skip a beat" property
// every heartbeat module already has by design (CLAUDE.md: "a module crash
// must never stop the tick" — skipping under pressure is the same
// tolerance, applied proactively instead of reactively).

import logger from "../logger.js";
import { isUnderPressure } from "../lib/event-loop-pressure.js";
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
 * @property {boolean} [lowPriority]  Track C: skip this tick (not delay it) when the event loop is under pressure.
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
 * @param {boolean} [opts.lowPriority] - Track C: genuinely deferrable work (codebase scans, detector sweeps) — skips its due tick under event-loop pressure instead of running.
 */
export function registerHeartbeat(id, { frequency, handler, neverDisable = false, serial = false, worker = false, scope = "world", lowPriority = false }) {
  if (!id || typeof id !== "string") throw new Error("registerHeartbeat: id required");
  if (!Number.isInteger(frequency) || frequency < 1) {
    throw new Error(`registerHeartbeat(${id}): frequency must be a positive integer`);
  }
  if (typeof handler !== "function") throw new Error(`registerHeartbeat(${id}): handler must be a function`);
  if (scope !== "global" && scope !== "world") {
    throw new Error(`registerHeartbeat(${id}): scope must be 'global' or 'world'`);
  }
  REGISTRY.set(id, { id, frequency, handler, neverDisable, serial, worker, scope, lowPriority });
}

/**
 * Iterate all registered modules and run those whose tick is due.
 *
 * Strictly sequential — no two modules EVER execute concurrently, even when
 * their frequencies collide on the same tickCount (a real, common case: many
 * modules share frequency values like 4/5/8/20/60, so a naive concurrent
 * batch would pile several handlers' synchronous work onto the event loop at
 * the same instant, causing the request-latency spikes this was built to
 * avoid). Each due module still runs at its own configured cadence — this
 * changes CONCURRENCY, not FREQUENCY. `serial: true` modules still run after
 * the default-flagged ones, in registration order, preserving the existing
 * same-tick write-visibility guarantee (e.g. social-npc-bridge must complete
 * before npc-knowledge-bridge reads its writes) — that ordering already
 * implied sequential execution between the two groups; this just makes
 * execution sequential WITHIN each group too. Each handler is independently
 * try/caught and timed; each is raced against MODULE_TIMEOUT_MS via
 * `Promise.race` so the dispatcher can move on rather than wait forever.
 * That race can only resolve early for handlers that actually yield the
 * event loop (i.e. `await` somewhere) — a synchronous, CPU-bound handler
 * runs to completion before the timeout's own callback can fire, so this
 * is a bound on cooperative handlers, not real preemption of a genuine
 * synchronous hang.
 *
 * @param {{ state: object, db: object, tickCount: number, reason?: string, scope?: 'global'|'world'|'all' }} ctx
 */
export async function tickAllRegistered(ctx) {
  const tickCount = Number.isInteger(ctx?.tickCount) ? ctx.tickCount : 0;
  const reason = ctx?.reason ?? "heartbeat";
  const filterScope = ctx?.scope ?? "all";
  const disabled = new Set(ctx?.state?.settings?.disabledHeartbeats ?? []);

  const due = [];
  const dueSerial = [];

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
    // Track C — genuinely deferrable work backs off under real event-loop
    // pressure. Checked once per due entry (not once per tick) so a module
    // that goes lowPriority mid-session picks this up immediately, and so
    // pressure clearing between two due lowPriority entries in the same
    // tick lets the later one still run.
    if (entry.lowPriority && isUnderPressure()) {
      try { globalThis._concordPromMetrics?.heartbeatLowPrioritySkipped?.inc({ module: entry.id }); } catch { /* prom best-effort */ }
      continue;
    }
    (entry.serial ? dueSerial : due).push(entry);
  }

  const moduleCtx = { state: ctx.state, db: ctx.db, tickCount, reason };

  // One at a time, always — never Promise.all. See doc comment above.
  for (const entry of due) {
    await _runOne(entry, moduleCtx);
    await _yieldToEventLoop();
  }
  for (const entry of dueSerial) {
    await _runOne(entry, moduleCtx);
    await _yieldToEventLoop();
  }
}

/**
 * Return control to the event loop's poll/check phase between modules.
 *
 * WHY (2026-07-28, measured): `await` on a handler whose body is synchronous
 * CPU work does NOT let pending I/O run. `await` drains the MICROTASK queue,
 * but an inbound HTTP request is a MACROTASK — it can only be serviced when
 * the loop reaches the poll phase. So a chain of `await _runOne(...)` over
 * sync-bodied modules holds the loop for the WHOLE tick, and every request
 * that arrives meanwhile waits for all of them.
 *
 * Proven with a real http.Server and a real request landing mid-tick, over
 * 8 x 100ms sync "modules":
 *     without this yield:  tick 801ms, request served at +805ms (tick end)
 *     with this yield:     tick 803ms, request served at +303ms (mid-tick)
 *
 * That mattered because `lib/request-admission.js` sheds requests with an
 * immediate 503+Retry-After once event-loop lag passes 300ms. Polling one
 * trivial endpoint every 2s for 110s against a real server produced NINE shed
 * windows recurring at ~15s — governorTick's cadence. Users saw that as
 * intermittent "connection drops": the server 503ing healthy traffic once per
 * tick, purely because the tick never let the poll phase run.
 *
 * `setImmediate` (check phase) rather than `setTimeout(…, 0)`: it fires after
 * the poll phase completes, so pending I/O callbacks are serviced first, which
 * is exactly the goal. Cost is one macrotask per module per tick — negligible
 * against the modules themselves.
 *
 * SEMANTIC NOTE, stated because it is a real change: a tick is no longer
 * atomic with respect to HTTP handlers — request handlers can now interleave
 * BETWEEN modules. This does not affect module ORDERING (still strictly
 * sequential, `serial` group still last, so same-tick write-visibility between
 * e.g. social-npc-bridge and npc-knowledge-bridge is preserved), and modules
 * were never able to assume atomicity ACROSS ticks anyway — interleaving
 * between modules is the same exposure as interleaving between ticks. Kill
 * switch: CONCORD_HEARTBEAT_YIELD=0 restores the old blocking behaviour.
 */
function _yieldToEventLoop() {
  if (process.env.CONCORD_HEARTBEAT_YIELD === "0") return Promise.resolve();
  return new Promise((resolve) => { setImmediate(resolve); });
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
    try { _recordError(entry.id); } catch { /* timing best-effort */ }
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

// OP1 (Repair Cortex operator console) — `totalErrors` existed on the meta
// shape but was never incremented anywhere, so `/api/admin/heartbeat-stats`
// silently reported 0 errors for every module regardless of real failures.
// `_runOne`'s catch block (both the thrown-handler and timed-out paths) now
// calls this so the drift/health strip can show a real per-module error
// count instead of a field that always read zero.
function _recordError(moduleId) {
  let meta = _timingMeta.get(moduleId);
  if (!meta) { meta = { lastMs: 0, lastAt: 0, totalRuns: 0, totalErrors: 0 }; _timingMeta.set(moduleId, meta); }
  meta.totalErrors += 1;
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
      totalErrors: meta.totalErrors || 0,
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
    lowPriority: !!e.lowPriority,
  }));
}

/**
 * Manually invoke a single registered module immediately, out-of-band from
 * the governor tick clock. Backs the Heartbeat Monitor lens's admin-only
 * "trigger" control (`tick.heartbeatControl`, op: 'trigger') — without this,
 * clicking "trigger" only recorded operator intent and never actually ran
 * anything, a fabricated-success gap. Reuses `_runOne` so a manual trigger
 * gets the same timeout / try-catch / metrics handling as a normal tick;
 * it can never throw or hang the caller.
 * @param {string} id - Registered module id.
 * @param {{ state: object, db: object, reason?: string }} ctx
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function runHeartbeatModuleNow(id, { state, db, reason = "manual-trigger" } = {}) {
  const entry = REGISTRY.get(id);
  if (!entry) return { ok: false, error: `unknown_heartbeat_module:${id}` };
  await _runOne(entry, { state, db, tickCount: -1, reason });
  return { ok: true };
}

/** Test-only helper: clear the registry between tests. */
export function _resetHeartbeatRegistry() {
  REGISTRY.clear();
  _timingHistory.clear();
  _timingMeta.clear();
}
