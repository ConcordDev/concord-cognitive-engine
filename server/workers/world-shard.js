/**
 * world-shard.js — entry point for the worker-thread-per-world shard (Phase I).
 *
 * Each shard:
 *   - opens its own better-sqlite3 handle (writeable for per-world tables;
 *     writes to user-global tables are forwarded to the parent thread).
 *   - runs the heartbeat registry filtered to its own world_id with
 *     scope: 'world' modules.
 *   - posts EMIT messages back to the parent for Socket.IO fan-out.
 *
 * The shard registry imports the same `registerHeartbeat` modules the
 * parent uses — they only execute if the module advertises `scope: 'world'`.
 */

import { parentPort, workerData, threadId } from "node:worker_threads";
import { PARENT_TO_CHILD, CHILD_TO_PARENT } from "../lib/world-shard-protocol.js";

let _worldId = workerData?.worldId ?? null;
let _dbPath = workerData?.dbPath ?? null;
let _db = null;
let _heartbeatRegistry = null;
let _started = false;
let _tickCounter = 0;

function _log(level, event, data = {}) {
  try {
    parentPort?.postMessage({ type: CHILD_TO_PARENT.LOG, level, event, data, threadId, worldId: _worldId });
  } catch { /* parent may be gone */ }
}

async function _initShard(initMsg) {
  _worldId = initMsg?.worldId ?? _worldId;
  _dbPath  = initMsg?.dbPath  ?? _dbPath;

  try {
    const mod = await import("better-sqlite3");
    const Database = mod.default;
    _db = new Database(_dbPath);
    _db.pragma("journal_mode = WAL");
    _db.pragma("busy_timeout = 5000");
    _db.pragma("synchronous = NORMAL");
  } catch (err) {
    _log("error", "shard_db_open_failed", { error: err?.message });
    parentPort?.close?.();
    return;
  }

  try {
    _heartbeatRegistry = await import("../emergent/heartbeat-registry.js");
  } catch (err) {
    _log("error", "shard_registry_load_failed", { error: err?.message });
    parentPort?.close?.();
    return;
  }

  try {
    // Phase G — also load world-flavor inside the shard so loops.json
    // filtering applies. Side-effect of importing initialises the cache.
    const wf = await import("../lib/world-flavor.js");
    wf.initWorldFlavors();
  } catch { /* flavor optional */ }

  try {
    await _loadShardHeartbeatModules();
  } catch (err) {
    _log("warn", "shard_module_load_partial", { error: err?.message });
  }

  _started = true;
  _log("info", "shard_ready", { worldId: _worldId, threadId });
  parentPort?.postMessage({ type: CHILD_TO_PARENT.READY, worldId: _worldId, threadId });
}

/**
 * Curated list of heartbeat modules the shard runs. server.js is too heavy
 * to import (it boots an HTTP server) — we re-register the per-world ones
 * here with the same handler imports.
 */
async function _loadShardHeartbeatModules() {
  const { registerHeartbeat } = _heartbeatRegistry;

  const moduleImports = [
    ["../emergent/creature-flock-cycle.js",       "runCreatureFlockCycle",       { id: "creature-flock-cycle",     frequency: 4 }],
    ["../emergent/signal-propagation-cycle.js",   "runSignalPropagationCycle",   { id: "signal-propagation-cycle", frequency: 3, serial: true }],
    ["../emergent/faction-strategy-cycle.js",     "runFactionStrategyCycle",     { id: "faction-strategy-cycle",   frequency: 200 }],
    ["../emergent/forward-sim-cycle.js",          "runForwardSimCycle",          { id: "forward-sim-cycle",        frequency: 100 }],
    ["../emergent/embodied-dream-cycle.js",       "runEmbodiedDreamCycle",       { id: "embodied-dream-cycle",     frequency: 80 }],
    ["../emergent/npc-routine-cycle.js",          "runNpcRoutineCycle",          { id: "npc-routine-cycle",        frequency: 5 }],
    ["../emergent/season-cycle.js",               "runSeasonCycle",              { id: "season-cycle",             frequency: 480, serial: true }],
    ["../emergent/land-claims-cycle.js",          "runLandClaimsCycle",          { id: "land-claims-cycle",        frequency: 240 }],
    ["../emergent/environment-sensor.js",         "runEnvironmentSensor",        { id: "environment-sensor",       frequency: 5 }],
    ["../emergent/lattice-quest-cycle.js",        "runLatticeQuestCycle",        { id: "lattice-quest-cycle",      frequency: 180 }],
    ["../emergent/npc-economy-cycle.js",          "runNpcEconomyCycle",          { id: "npc-economy-cycle",        frequency: 8 }],
    ["../emergent/world-population-cycle.js",     "runWorldPopulationCycle",     { id: "world-population-cycle",   frequency: 60 }],
    ["../emergent/npc-perception-snapshot.js",    "runNpcPerceptionSnapshot",    { id: "npc-perception-snapshot",  frequency: 8 }],
    ["../emergent/npc-conversation-initiator.js", "runNpcConversationInitiator", { id: "npc-conversation-initiator", frequency: 8 }],
    ["../emergent/npc-scheme-cycle.js",           "runNpcSchemeCycle",           { id: "npc-scheme-cycle",         frequency: 30 }],
    ["../emergent/war-skirmish-cycle.js",         "runWarSkirmishCycle",         { id: "war-skirmish-cycle",       frequency: 2 }],
    ["../emergent/procgen-settlement-cycle.js",   "runProcgenSettlementCycle",   { id: "procgen-settlement-cycle", frequency: 240 }],
    ["../emergent/procedural-npc-spawner.js",     "runProceduralNpcSpawner",     { id: "procedural-npc-spawner",   frequency: 360 }],
  ];

  for (const [modPath, exportName, opts] of moduleImports) {
    try {
      const m = await import(modPath);
      const handler = m[exportName];
      if (typeof handler === "function") {
        registerHeartbeat(opts.id, {
          frequency: opts.frequency,
          handler,
          serial: !!opts.serial,
          scope: "world",
        });
      }
    } catch (err) {
      _log("warn", "shard_module_load_failed", { module: modPath, error: err?.message });
    }
  }
}

async function _runTick(tickMsg) {
  if (!_started || !_heartbeatRegistry) return;
  _tickCounter = Number(tickMsg.tickCount) || (_tickCounter + 1);
  try {
    await _heartbeatRegistry.tickAllRegistered({
      state: { settings: tickMsg.settings || {} },
      db: _db,
      tickCount: _tickCounter,
      reason: tickMsg.reason || "parent_tick",
      scope: "world",
      worldId: _worldId,  // Phase G — per-world flavor filtering inside the dispatcher
    });
    parentPort?.postMessage({
      type: CHILD_TO_PARENT.TICK_RESULT,
      worldId: _worldId,
      tickCount: _tickCounter,
      ok: true,
    });
  } catch (err) {
    parentPort?.postMessage({
      type: CHILD_TO_PARENT.TICK_RESULT,
      worldId: _worldId,
      tickCount: _tickCounter,
      ok: false,
      error: err?.message,
    });
  }
}

// Bridge: emergent modules call globalThis._concordRealtimeEmit. In a
// shard, route that to the parent thread for Socket.IO fan-out.
globalThis._concordRealtimeEmit = function shardRealtimeEmit(event, payload) {
  try {
    parentPort?.postMessage({
      type: CHILD_TO_PARENT.EMIT,
      worldId: _worldId,
      event,
      payload,
    });
  } catch { /* parent gone */ }
};

parentPort?.on("message", async (msg) => {
  if (!msg || typeof msg !== "object") return;
  try {
    if (msg.type === PARENT_TO_CHILD.INIT) {
      await _initShard(msg);
    } else if (msg.type === PARENT_TO_CHILD.TICK) {
      await _runTick(msg);
    } else if (msg.type === PARENT_TO_CHILD.SHUTDOWN) {
      try { _db?.close(); } catch { /* best-effort */ }
      parentPort?.close?.();
    }
  } catch (err) {
    _log("error", "shard_message_handler_failed", { error: err?.message });
  }
});

process.on("uncaughtException", (err) => {
  _log("error", "shard_uncaught", { error: err?.message, stack: err?.stack });
  setTimeout(() => parentPort?.close?.(), 100);
});

process.on("unhandledRejection", (reason) => {
  _log("warn", "shard_unhandled_rejection", { reason: String(reason) });
});

// Auto-init: when the worker is constructed with workerData.worldId, we
// initialise immediately so the parent doesn't have to post INIT a second
// time. The INIT message is still accepted for legacy callers.
if (_worldId && _dbPath) {
  _initShard({ worldId: _worldId, dbPath: _dbPath });
}
