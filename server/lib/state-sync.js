/**
 * Cross-Instance State Synchronization
 *
 * Uses Redis pub/sub to synchronize state changes across Concord instances.
 * Without Redis, this module is a no-op (single-instance behavior preserved).
 */
import { publish, subscribe, isConnected, lockAcquire, lockRelease } from "./redis-adapter.js";
import { structuredLog } from "./logger.js";

const CHANNELS = {
  DTU_CHANGE: "concord:dtu:change",
  SESSION_CHANGE: "concord:session:change",
  EMERGENT_SYNC: "concord:emergent:sync",
  INVALIDATE: "concord:cache:invalidate",
};

// Instance ID for deduplication (ignore own messages)
const INSTANCE_ID = `${process.pid}-${Date.now()}`;

let _STATE = null;
let _initialized = false;

/**
 * Initialize state sync. Call after STATE and Redis are both ready.
 * @param {object} STATE - global state object
 */
export async function initStateSync(STATE) {
  _STATE = STATE;
  if (!isConnected()) {
    structuredLog("info", "state_sync_skipped", { reason: "redis not connected" });
    return;
  }

  // Subscribe to all sync channels
  await subscribe(CHANNELS.DTU_CHANGE, (msg) => _handleDTUChange(msg));
  await subscribe(CHANNELS.SESSION_CHANGE, (msg) => _handleSessionChange(msg));
  await subscribe(CHANNELS.INVALIDATE, (msg) => _handleInvalidation(msg));

  _initialized = true;
  structuredLog("info", "state_sync_initialized", { instanceId: INSTANCE_ID, channels: Object.values(CHANNELS) });
}

// ── Publishers (call from main code when state changes) ──

export async function notifyDTUChange(dtuId, action, dtu) {
  if (!_initialized) return;
  await publish(CHANNELS.DTU_CHANGE, { instanceId: INSTANCE_ID, dtuId, action, dtu, at: Date.now() });
}

export async function notifySessionChange(sessionId, action) {
  if (!_initialized) return;
  await publish(CHANNELS.SESSION_CHANGE, { instanceId: INSTANCE_ID, sessionId, action, at: Date.now() });
}

export async function notifyInvalidation(keys) {
  if (!_initialized) return;
  await publish(CHANNELS.INVALIDATE, { instanceId: INSTANCE_ID, keys, at: Date.now() });
}

// ── Emergent State Sync (leader writes, followers read) ──

const EMERGENT_SYNC_INTERVAL_MS = 30_000;
let _emergentTimer = null;

export function startEmergentSync() {
  if (!isConnected() || !_STATE) return;

  _emergentTimer = setInterval(async () => {
    try {
      // Leader election: only one instance syncs emergent state
      const gotLock = await lockAcquire("emergent-sync", EMERGENT_SYNC_INTERVAL_MS + 5000);
      if (!gotLock) return; // Another instance is leader

      // Serialize and publish emergent state
      if (_STATE.__emergent) {
        await publish(CHANNELS.EMERGENT_SYNC, {
          instanceId: INSTANCE_ID,
          emergent: {
            emergentCount: _STATE.__emergent.emergents?.size || 0,
            // Only sync metadata, not full state (too large)
            activeIds: _STATE.__emergent.emergents
              ? Array.from(_STATE.__emergent.emergents.keys()).slice(0, 100)
              : [],
          },
          at: Date.now(),
        });
      }
      await lockRelease("emergent-sync");
    } catch (e) {
      structuredLog("debug", "emergent_sync_error", { error: e?.message });
    }
  }, EMERGENT_SYNC_INTERVAL_MS);

  if (_emergentTimer.unref) _emergentTimer.unref();
}

// ── Handlers ──

function _handleDTUChange(msg) {
  if (msg.instanceId === INSTANCE_ID) return; // Ignore own messages

  try {
    const { dtuId, action, dtu } = msg;
    if (action === "create" || action === "update") {
      if (dtu && dtuId && _STATE?.dtus) {
        _STATE.dtus.set(dtuId, dtu);
        structuredLog("debug", "state_sync_dtu_applied", { dtuId, action });
      }
    } else if (action === "delete") {
      if (dtuId && _STATE?.dtus) {
        _STATE.dtus.delete(dtuId);
        structuredLog("debug", "state_sync_dtu_deleted", { dtuId });
      }
    }
  } catch (e) {
    structuredLog("debug", "state_sync_dtu_handler_error", { error: e?.message });
  }
}

function _handleSessionChange(msg) {
  if (msg.instanceId === INSTANCE_ID) return;
  // Session changes are informational — sessions are loaded from Redis on-demand
  structuredLog("debug", "state_sync_session_change", { sessionId: msg.sessionId, action: msg.action });
}

function _handleInvalidation(msg) {
  if (msg.instanceId === INSTANCE_ID) return;
  // Cache invalidation signal — clear local caches for specified keys
  structuredLog("debug", "state_sync_invalidation", { keys: msg.keys });
}

export function stopSync() {
  if (_emergentTimer) { clearInterval(_emergentTimer); _emergentTimer = null; }
}

export function getSyncStatus() {
  return {
    initialized: _initialized,
    instanceId: INSTANCE_ID,
    redisConnected: isConnected(),
    channels: Object.values(CHANNELS),
  };
}
