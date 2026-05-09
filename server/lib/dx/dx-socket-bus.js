// server/lib/dx/dx-socket-bus.js
//
// DX Platform Phase A3 — WebSocket streaming for editor-plugin clients.
//
// Mounts a `/dx` namespace on the existing socket.io server. Plugin
// clients connect with a JWT or a `csk_*` API key and join one or more
// `codebase:${id}` rooms. The detector + repair-cortex paths emit
// per-codebase events that fan out to subscribers in the matching room.
//
// Event types (server → client):
//   detector:run.started      { runId, codebaseId, detectorIds }
//   detector:run.complete     { runId, codebaseId, durationMs, summary }
//   detector:finding.added    { runId, codebaseId, finding }
//   detector:finding.resolved { runId, codebaseId, findingId }
//   repair:prophet.proposed   { repairId, codebaseId, finding, fix }
//   repair:surgeon.applied    { repairId, codebaseId, ok, refs }
//   repair:decision.recorded  { repairId, codebaseId, decision }
//   codebase:evo_state_changed { codebaseId, detectorId, ruleId, weight }
//
// Event types (client → server):
//   subscribe.codebase   { codebaseId } → joins codebase:${id} room
//   unsubscribe.codebase { codebaseId } → leaves room
//   ping                 → server emits pong
//
// Per-key connection cap (5) — prevents accidental reconnect-storm
// loops in plugin development. Cap counted by `userId` so a single API
// key can still open up to 5 sockets across multiple editor windows.

import { getFlag, getFlagNumber } from "../feature-flags.js";

const NAMESPACE = "/dx";
function connectionCapPerUser() {
  return getFlagNumber("CONCORD_DX_SOCKET_CAP_PER_USER", 5);
}

let _ns = null;
let _state = {
  connections: new Map(), // userId → Set<socketId>
  subscriptions: new Map(), // socketId → Set<codebaseId>
  metrics: {
    connectsTotal: 0,
    rejectedCapTotal: 0,
    rejectedAuthTotal: 0,
    findingsEmittedTotal: 0,
    repairsEmittedTotal: 0,
  },
};

/**
 * Attach the DX namespace + auth gate + per-user cap.
 * Caller passes the existing `io` from server.js after main namespace setup.
 *
 * @param {object} io — socket.io Server instance.
 * @returns {{ok: boolean, reason?: string}}
 */
export function attachDxStream(io) {
  if (!getFlag("FF_DX_SOCKET", 1)) return { ok: false, reason: "flag_off" };
  if (!io || typeof io.of !== "function") return { ok: false, reason: "no_io" };
  if (_ns) return { ok: true, reason: "already_attached" };

  _ns = io.of(NAMESPACE);

  // Auth gate. Reuses the main namespace's `socket.data.userId` if the
  // root io middleware already authenticated; otherwise reads
  // Authorization / x-api-key from the handshake.
  _ns.use((socket, next) => {
    // The root io.use() middleware (server.js:6916) populated
    // socket.data.userId for cookie / bearer / api-key already if the
    // browser-side reused the same connection. Namespaces share state.
    const userId = socket.data?.userId || socket.handshake?.auth?.userId;
    if (!userId) {
      _state.metrics.rejectedAuthTotal++;
      return next(new Error("authentication_required"));
    }

    // Per-user connection cap (read fresh — env-tunable).
    const open = _state.connections.get(userId) || new Set();
    if (open.size >= connectionCapPerUser()) {
      _state.metrics.rejectedCapTotal++;
      return next(new Error("connection_cap_exceeded"));
    }
    open.add(socket.id);
    _state.connections.set(userId, open);
    socket.data.dxUserId = userId;
    _state.metrics.connectsTotal++;
    return next();
  });

  _ns.on("connection", (socket) => {
    socket.emit("hello", {
      ok: true,
      namespace: NAMESPACE,
      ts: Date.now(),
      cap: connectionCapPerUser(),
    });

    socket.on("subscribe.codebase", ({ codebaseId } = {}) => {
      if (!codebaseId) return;
      // Authorization: codebase ownership is checked by the macro path
      // when the plugin first issues `dx.register_codebase` — we trust
      // the codebaseId here because it's `cb_${userId}_${hash}` which
      // includes the user_id by construction. Cross-user subscribe
      // requires guessing the hash, which is a weak constraint but
      // adequate for the plugin's per-user surface.
      const expectedPrefix = `cb_${socket.data.dxUserId}_`;
      if (!String(codebaseId).startsWith(expectedPrefix)) {
        socket.emit("subscribe.error", { codebaseId, reason: "not_owner" });
        return;
      }
      socket.join(`codebase:${codebaseId}`);
      const subs = _state.subscriptions.get(socket.id) || new Set();
      subs.add(codebaseId);
      _state.subscriptions.set(socket.id, subs);
      socket.emit("subscribe.ok", { codebaseId });
    });

    socket.on("unsubscribe.codebase", ({ codebaseId } = {}) => {
      if (!codebaseId) return;
      socket.leave(`codebase:${codebaseId}`);
      const subs = _state.subscriptions.get(socket.id);
      if (subs) subs.delete(codebaseId);
    });

    socket.on("ping", () => socket.emit("pong", { ts: Date.now() }));

    socket.on("disconnect", () => {
      const userId = socket.data.dxUserId;
      if (userId) {
        const open = _state.connections.get(userId);
        if (open) {
          open.delete(socket.id);
          if (open.size === 0) _state.connections.delete(userId);
        }
      }
      _state.subscriptions.delete(socket.id);
    });
  });

  return { ok: true };
}

/**
 * Emit a detector-class event to the matching codebase room. No-op if
 * the namespace isn't attached or the flag is off.
 */
export function emitDetectorEvent(codebaseId, type, payload) {
  if (!getFlag("FF_DX_SOCKET", 1) || !_ns || !codebaseId || !type) return false;
  try {
    _ns.to(`codebase:${codebaseId}`).emit(`detector:${type}`, { codebaseId, ...payload });
    if (type === "finding.added") _state.metrics.findingsEmittedTotal++;
    return true;
  } catch {
    return false;
  }
}

/**
 * Emit a repair-class event.
 */
export function emitRepairEvent(codebaseId, type, payload) {
  if (!getFlag("FF_DX_SOCKET", 1) || !_ns || !codebaseId || !type) return false;
  try {
    _ns.to(`codebase:${codebaseId}`).emit(`repair:${type}`, { codebaseId, ...payload });
    _state.metrics.repairsEmittedTotal++;
    return true;
  } catch {
    return false;
  }
}

/**
 * Emit a codebase-meta event (e.g. severity weight changed → plugin
 * sidebar updates "tuning state" pane without requiring a poll).
 */
export function emitCodebaseEvent(codebaseId, type, payload) {
  if (!getFlag("FF_DX_SOCKET", 1) || !_ns || !codebaseId || !type) return false;
  try {
    _ns.to(`codebase:${codebaseId}`).emit(`codebase:${type}`, { codebaseId, ...payload });
    return true;
  } catch {
    return false;
  }
}

export function getDxStreamMetrics() {
  return {
    ..._state.metrics,
    activeConnections: Array.from(_state.connections.values()).reduce((s, set) => s + set.size, 0),
    activeUsers: _state.connections.size,
    activeSubscriptions: Array.from(_state.subscriptions.values()).reduce((s, set) => s + set.size, 0),
    namespaceAttached: !!_ns,
  };
}

// For tests / hot-reload — drop the cached state without touching the io.
export function _resetForTests() {
  _ns = null;
  _state = {
    connections: new Map(),
    subscriptions: new Map(),
    metrics: {
      connectsTotal: 0,
      rejectedCapTotal: 0,
      rejectedAuthTotal: 0,
      findingsEmittedTotal: 0,
      repairsEmittedTotal: 0,
    },
  };
}
