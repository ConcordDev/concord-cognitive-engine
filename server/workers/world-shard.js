/**
 * world-shard.js — entry point for the forked world-shard child process.
 *
 * Each shard:
 *   - opens its own better-sqlite3 handle (writeable for per-world tables;
 *     writes to user-global tables are forwarded to the parent process).
 *   - runs the heartbeat registry with `scope: 'world'` filtered to its
 *     own world_id.
 *   - posts `EMIT` messages back to the parent for Socket.IO fan-out.
 *
 * The shard registry imports the same `registerHeartbeat` modules the
 * parent uses — they only execute if the module advertises `scope: 'world'`.
 */

import { PARENT_TO_CHILD, CHILD_TO_PARENT } from "../lib/world-shard-protocol.js";

const workerId = process.pid;
let _worldId = null;
let _dbPath = null;
let _db = null;
let _heartbeatRegistry = null;
let _started = false;
let _restartCount = 0;
let _lastTickAt = 0;
let _tickCounter = 0;

function _log(level, event, data = {}) {
  try {
    process.send?.({ type: CHILD_TO_PARENT.LOG, level, event, data, pid: workerId, worldId: _worldId });
  } catch { /* parent may be gone */ }
}

async function _initShard(initMsg) {
  _worldId = initMsg.worldId;
  _dbPath = initMsg.dbPath;

  try {
    const mod = await import("better-sqlite3");
    const Database = mod.default;
    _db = new Database(_dbPath);
    _db.pragma("journal_mode = WAL");
    _db.pragma("busy_timeout = 5000");
    _db.pragma("synchronous = NORMAL");
  } catch (err) {
    _log("error", "shard_db_open_failed", { error: err?.message });
    process.exit(1);
  }

  try {
    _heartbeatRegistry = await import("../emergent/heartbeat-registry.js");
  } catch (err) {
    _log("error", "shard_registry_load_failed", { error: err?.message });
    process.exit(1);
  }

  // Import the module files so they execute their `registerHeartbeat`
  // call. We do this via the server.js import — but server.js boots
  // an HTTP server. In a shard process we don't want HTTP. So instead
  // we import a curated list of modules that are safe to load in a
  // shard context.
  try {
    await _loadShardHeartbeatModules();
  } catch (err) {
    _log("warn", "shard_module_load_partial", { error: err?.message });
    // Non-fatal — the shard can still tick the modules that did load.
  }

  _started = true;
  _log("info", "shard_ready", { worldId: _worldId, dbPath: _dbPath });
  process.send?.({ type: CHILD_TO_PARENT.READY, worldId: _worldId, pid: workerId });
}

/**
 * Curated list of heartbeat modules the shard runs. These are the
 * modules tagged `scope: 'world'` in server.js — but server.js itself
 * is too heavy to import (boots HTTP, listens, etc.). So we re-register
 * them here with the same handler imports.
 */
async function _loadShardHeartbeatModules() {
  const { registerHeartbeat } = _heartbeatRegistry;

  const moduleImports = [
    ["./../emergent/creature-flock-cycle.js", "runCreatureFlockCycle", { id: "creature-flock-cycle", frequency: 4 }],
    ["./../emergent/signal-propagation-cycle.js", "runSignalPropagationCycle", { id: "signal-propagation-cycle", frequency: 3, serial: true }],
    ["./../emergent/faction-strategy-cycle.js", "runFactionStrategyCycle", { id: "faction-strategy-cycle", frequency: 200 }],
    ["./../emergent/forward-sim-cycle.js", "runForwardSimCycle", { id: "forward-sim-cycle", frequency: 100 }],
    ["./../emergent/embodied-dream-cycle.js", "runEmbodiedDreamCycle", { id: "embodied-dream-cycle", frequency: 80 }],
    ["./../emergent/npc-routine-cycle.js", "runNpcRoutineCycle", { id: "npc-routine-cycle", frequency: 5 }],
    ["./../emergent/season-cycle.js", "runSeasonCycle", { id: "season-cycle", frequency: 480, serial: true }],
    ["./../emergent/land-claims-cycle.js", "runLandClaimsCycle", { id: "land-claims-cycle", frequency: 240 }],
    ["./../emergent/environment-sensor.js", "runEnvironmentSensor", { id: "environment-sensor", frequency: 5 }],
    ["./../emergent/lattice-quest-cycle.js", "runLatticeQuestCycle", { id: "lattice-quest-cycle", frequency: 180 }],
    ["./../emergent/npc-economy-cycle.js", "runNpcEconomyCycle", { id: "npc-economy-cycle", frequency: 8 }],
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
  _lastTickAt = Date.now();
  try {
    await _heartbeatRegistry.tickAllRegistered({
      state: { settings: tickMsg.settings || {} },
      db: _db,
      tickCount: _tickCounter,
      reason: tickMsg.reason || "parent_tick",
      scope: "world",
    });
    process.send?.({
      type: CHILD_TO_PARENT.TICK_RESULT,
      worldId: _worldId,
      tickCount: _tickCounter,
      ok: true,
    });
  } catch (err) {
    process.send?.({
      type: CHILD_TO_PARENT.TICK_RESULT,
      worldId: _worldId,
      tickCount: _tickCounter,
      ok: false,
      error: err?.message,
    });
  }
}

// Bridge: emergent modules sometimes call globalThis._concordRealtimeEmit.
// In a shard, route that to the parent so it can fan out via Socket.IO.
globalThis._concordRealtimeEmit = function shardRealtimeEmit(event, payload) {
  try {
    process.send?.({
      type: CHILD_TO_PARENT.EMIT,
      worldId: _worldId,
      event,
      payload,
    });
  } catch { /* parent gone */ }
};

process.on("message", async (msg) => {
  if (!msg || typeof msg !== "object") return;
  try {
    if (msg.type === PARENT_TO_CHILD.INIT) {
      await _initShard(msg);
    } else if (msg.type === PARENT_TO_CHILD.TICK) {
      await _runTick(msg);
    } else if (msg.type === PARENT_TO_CHILD.SHUTDOWN) {
      try { _db?.close(); } catch { /* best-effort */ }
      process.exit(0);
    }
  } catch (err) {
    _log("error", "shard_message_handler_failed", { error: err?.message });
  }
});

process.on("uncaughtException", (err) => {
  _log("error", "shard_uncaught", { error: err?.message, stack: err?.stack });
  // Exit so the parent restarts us with a clean slate.
  setTimeout(() => process.exit(1), 100);
});

process.on("unhandledRejection", (reason) => {
  _log("warn", "shard_unhandled_rejection", { reason: String(reason) });
});
