/**
 * Tier-2 contract tests for DX Platform Phase A3 — WebSocket streaming.
 *
 * Pinned with a stub `io` shim (no real socket.io needed):
 *   - attachDxStream wires `/dx` namespace + auth gate + connection cap
 *   - subscribe.codebase joins room, unsubscribe leaves
 *   - subscribe rejects when codebaseId prefix doesn't match userId
 *   - emitDetectorEvent / emitRepairEvent / emitCodebaseEvent fan out
 *     to the matching room
 *   - per-user connection cap enforced
 *   - flag-off path returns ok:false with reason 'flag_off'
 *   - getDxStreamMetrics shape
 *
 * Run: node --test tests/dx-stream.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  attachDxStream,
  emitDetectorEvent,
  emitRepairEvent,
  emitCodebaseEvent,
  getDxStreamMetrics,
  _resetForTests,
} from "../lib/dx/dx-socket-bus.js";

// ---- minimal socket.io shim ----
function makeStubIo() {
  const namespaces = new Map();
  const ioInstance = {
    of(name) {
      if (namespaces.has(name)) return namespaces.get(name);
      const ns = makeNamespace();
      namespaces.set(name, ns);
      return ns;
    },
    _namespaces: namespaces,
  };
  return ioInstance;
}

function makeNamespace() {
  const middlewares = [];
  const sockets = new Map(); // socketId → socket
  const rooms = new Map();   // roomId → Set<socketId>
  const emitted = [];        // tape of emit() calls
  const ns = {
    use(fn) { middlewares.push(fn); },
    on(event, fn) { ns._connectionHandler = event === "connection" ? fn : ns._connectionHandler; },
    to(roomId) {
      return {
        emit(eventName, payload) {
          emitted.push({ roomId, eventName, payload });
          for (const sid of rooms.get(roomId) || []) {
            const s = sockets.get(sid);
            if (s) s._receive(eventName, payload);
          }
        },
      };
    },
    _emitted: emitted,
    _sockets: sockets,
    _rooms: rooms,
    _middlewares: middlewares,
    _connectionHandler: null,
  };
  return ns;
}

let _socketCounter = 0;
function connectStubSocket(ns, { userId, handshakeApiKey } = {}) {
  const id = `sock_${++_socketCounter}`;
  const handlers = new Map();
  const inbox = [];
  const socket = {
    id,
    data: { userId },
    handshake: { auth: { apiKey: handshakeApiKey, userId }, headers: {} },
    on(event, fn) {
      const arr = handlers.get(event) || [];
      arr.push(fn);
      handlers.set(event, arr);
    },
    emit(event, payload) { inbox.push({ event, payload }); },
    _receive(event, payload) {
      socket.emit(event, payload);
    },
    join(roomId) {
      const room = ns._rooms.get(roomId) || new Set();
      room.add(id);
      ns._rooms.set(roomId, room);
    },
    leave(roomId) {
      const room = ns._rooms.get(roomId);
      if (room) room.delete(id);
    },
    _inbox: inbox,
    _trigger(event, payload) {
      const arr = handlers.get(event) || [];
      for (const fn of arr) fn(payload);
    },
  };
  ns._sockets.set(id, socket);
  // Run middlewares; `next(err)` terminates.
  let i = 0;
  let err = null;
  function step(e) {
    if (e) { err = e; return; }
    if (i < ns._middlewares.length) {
      const fn = ns._middlewares[i++];
      fn(socket, step);
    } else if (ns._connectionHandler) {
      ns._connectionHandler(socket);
    }
  }
  step();
  return { socket, error: err };
}

let io;

beforeEach(() => {
  delete process.env.FF_DX_SOCKET;
  delete process.env.CONCORD_DX_SOCKET_CAP_PER_USER;
  _resetForTests();
  io = makeStubIo();
});

afterEach(() => { _resetForTests(); });

describe("attachDxStream", () => {
  it("returns ok:false reason 'flag_off' when FF_DX_SOCKET=0", () => {
    process.env.FF_DX_SOCKET = "0";
    const r = attachDxStream(io);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "flag_off");
  });

  it("returns ok:false reason 'no_io' when io is missing", () => {
    const r = attachDxStream(null);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_io");
  });

  it("attaches the /dx namespace exactly once", () => {
    const r1 = attachDxStream(io);
    const r2 = attachDxStream(io);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r2.reason, "already_attached");
    assert.ok(io._namespaces.has("/dx"));
  });
});

describe("auth gate + connection cap", () => {
  beforeEach(() => attachDxStream(io));

  it("rejects connection without a userId", () => {
    const ns = io._namespaces.get("/dx");
    const { error } = connectStubSocket(ns, { userId: null });
    assert.ok(error);
    assert.match(error.message, /authentication_required/);
    const m = getDxStreamMetrics();
    assert.equal(m.rejectedAuthTotal, 1);
  });

  it("accepts an authenticated socket", () => {
    const ns = io._namespaces.get("/dx");
    const { socket, error } = connectStubSocket(ns, { userId: "alice" });
    assert.equal(error, null);
    assert.ok(socket._inbox.find(m => m.event === "hello"));
    const m = getDxStreamMetrics();
    assert.equal(m.activeConnections, 1);
  });

  it("rejects beyond the per-user connection cap", () => {
    process.env.CONCORD_DX_SOCKET_CAP_PER_USER = "2";
    _resetForTests();
    io = makeStubIo();
    attachDxStream(io);
    const ns = io._namespaces.get("/dx");
    const a = connectStubSocket(ns, { userId: "bob" });
    const b = connectStubSocket(ns, { userId: "bob" });
    const c = connectStubSocket(ns, { userId: "bob" });
    assert.equal(a.error, null);
    assert.equal(b.error, null);
    assert.ok(c.error);
    assert.match(c.error.message, /connection_cap_exceeded/);
    const m = getDxStreamMetrics();
    assert.equal(m.rejectedCapTotal, 1);
  });
});

describe("subscribe / unsubscribe", () => {
  it("joins the codebase room when prefix matches userId", () => {
    attachDxStream(io);
    const ns = io._namespaces.get("/dx");
    const { socket } = connectStubSocket(ns, { userId: "alice" });
    socket._trigger("subscribe.codebase", { codebaseId: "cb_alice_abc123" });
    const room = ns._rooms.get("codebase:cb_alice_abc123");
    assert.ok(room);
    assert.ok(room.has(socket.id));
    assert.ok(socket._inbox.find(m => m.event === "subscribe.ok"));
  });

  it("rejects subscribe when prefix doesn't match", () => {
    attachDxStream(io);
    const ns = io._namespaces.get("/dx");
    const { socket } = connectStubSocket(ns, { userId: "alice" });
    socket._trigger("subscribe.codebase", { codebaseId: "cb_bob_xxx" });
    const err = socket._inbox.find(m => m.event === "subscribe.error");
    assert.ok(err);
    assert.equal(err.payload.reason, "not_owner");
    assert.equal(ns._rooms.get("codebase:cb_bob_xxx"), undefined);
  });

  it("unsubscribe leaves the room", () => {
    attachDxStream(io);
    const ns = io._namespaces.get("/dx");
    const { socket } = connectStubSocket(ns, { userId: "alice" });
    socket._trigger("subscribe.codebase", { codebaseId: "cb_alice_a" });
    socket._trigger("unsubscribe.codebase", { codebaseId: "cb_alice_a" });
    const room = ns._rooms.get("codebase:cb_alice_a");
    assert.ok(!room || !room.has(socket.id));
  });

  it("disconnect cleans up subscriptions + connections", () => {
    attachDxStream(io);
    const ns = io._namespaces.get("/dx");
    const { socket } = connectStubSocket(ns, { userId: "alice" });
    socket._trigger("subscribe.codebase", { codebaseId: "cb_alice_a" });
    socket._trigger("disconnect");
    const m = getDxStreamMetrics();
    assert.equal(m.activeConnections, 0);
    assert.equal(m.activeSubscriptions, 0);
  });
});

describe("emit fan-out", () => {
  it("emitDetectorEvent fans out to the codebase room", () => {
    attachDxStream(io);
    const ns = io._namespaces.get("/dx");
    const { socket } = connectStubSocket(ns, { userId: "alice" });
    socket._trigger("subscribe.codebase", { codebaseId: "cb_alice_room" });
    emitDetectorEvent("cb_alice_room", "finding.added", { finding: { id: "x" } });
    const finding = socket._inbox.find(m => m.event === "detector:finding.added");
    assert.ok(finding);
    assert.equal(finding.payload.codebaseId, "cb_alice_room");
    assert.equal(finding.payload.finding.id, "x");
  });

  it("emitDetectorEvent does NOT fan out to other codebases", () => {
    attachDxStream(io);
    const ns = io._namespaces.get("/dx");
    const a = connectStubSocket(ns, { userId: "alice" });
    const b = connectStubSocket(ns, { userId: "bob" });
    a.socket._trigger("subscribe.codebase", { codebaseId: "cb_alice_a" });
    b.socket._trigger("subscribe.codebase", { codebaseId: "cb_bob_b" });
    emitDetectorEvent("cb_alice_a", "finding.added", { finding: { id: "f1" } });
    assert.ok(a.socket._inbox.find(m => m.event === "detector:finding.added"));
    assert.equal(b.socket._inbox.find(m => m.event === "detector:finding.added"), undefined);
  });

  it("emitRepairEvent + emitCodebaseEvent route correctly", () => {
    attachDxStream(io);
    const ns = io._namespaces.get("/dx");
    const { socket } = connectStubSocket(ns, { userId: "alice" });
    socket._trigger("subscribe.codebase", { codebaseId: "cb_alice_x" });
    emitRepairEvent("cb_alice_x", "prophet.proposed", { repairId: "r1" });
    emitCodebaseEvent("cb_alice_x", "evo_state_changed", { weight: 0.6 });
    assert.ok(socket._inbox.find(m => m.event === "repair:prophet.proposed"));
    assert.ok(socket._inbox.find(m => m.event === "codebase:evo_state_changed"));
  });

  it("emit returns false when namespace not attached", () => {
    _resetForTests();
    assert.equal(emitDetectorEvent("cb_x", "finding.added", {}), false);
  });

  it("emit returns false when flag is off (even after attach)", () => {
    attachDxStream(io);
    process.env.FF_DX_SOCKET = "0";
    assert.equal(emitDetectorEvent("cb_x", "finding.added", {}), false);
  });
});

describe("getDxStreamMetrics", () => {
  it("returns the expected shape", () => {
    attachDxStream(io);
    const m = getDxStreamMetrics();
    for (const k of [
      "connectsTotal", "rejectedCapTotal", "rejectedAuthTotal",
      "findingsEmittedTotal", "repairsEmittedTotal",
      "activeConnections", "activeUsers", "activeSubscriptions",
      "namespaceAttached",
    ]) {
      assert.ok(k in m, `missing metric ${k}`);
    }
    assert.equal(m.namespaceAttached, true);
  });
});
