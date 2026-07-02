// server/tests/healthcare-honest-telehealth.test.js
//
// POLISH_AUDIT T1.3 — telehealth honesty pin (release blocker).
//
// Ground truth this file pins (verified against the tree, 2026-07):
//   - The concord-webrtc path IS real end-to-end: server.js attaches
//     `attachWebRTCSignalling(io)` (lib/webrtc-signalling.js) to the
//     realtime socket layer, and the in-lens TelehealthVideoCall.tsx
//     client joins the room `webrtc:<visitId>` via `webrtc:join` —
//     TOKEN-FREE by design (privacy = unguessable visit id).
//   - Therefore `telehealth-create` must NEVER fabricate a joinToken
//     (nothing ever consumed one), and must only claim
//     roomProvider "concord-webrtc" / videoReady:true when the
//     realtime layer is genuinely up. Without Daily AND without
//     realtime, the appointment is still scheduled but the result
//     says so honestly (videoReady:false + note, no join descriptor).
//   - The `join` descriptor returned on the provisioned path mirrors
//     the EXACT contract the client + signalling relay use — the
//     round-trip test below drives the real signalling handlers with
//     the descriptor to prove it is accepted.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerHealthcareActions from "../domains/healthcare.js";
import { attachWebRTCSignalling } from "../lib/webrtc-signalling.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`healthcare.${name}`);
  assert.ok(fn, `healthcare.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerHealthcareActions(register); });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

let savedRealtime, savedRealtimeCaps, savedDailyKey, hadRealtime, hadRealtimeCaps, hadDailyKey;
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  hadRealtime = "_concordREALTIME" in globalThis;
  hadRealtimeCaps = "__CONCORD_REALTIME__" in globalThis;
  hadDailyKey = "DAILY_API_KEY" in process.env;
  savedRealtime = globalThis._concordREALTIME;
  savedRealtimeCaps = globalThis.__CONCORD_REALTIME__;
  savedDailyKey = process.env.DAILY_API_KEY;
  delete globalThis._concordREALTIME;
  delete globalThis.__CONCORD_REALTIME__;
  delete process.env.DAILY_API_KEY;
});
afterEach(() => {
  if (hadRealtime) globalThis._concordREALTIME = savedRealtime; else delete globalThis._concordREALTIME;
  if (hadRealtimeCaps) globalThis.__CONCORD_REALTIME__ = savedRealtimeCaps; else delete globalThis.__CONCORD_REALTIME__;
  if (hadDailyKey) process.env.DAILY_API_KEY = savedDailyKey; else delete process.env.DAILY_API_KEY;
});

function newPatient() {
  const r = call("patients-create", ctxA, { firstName: "Tess", lastName: "Honest" });
  assert.equal(r.ok, true);
  return r.result.patient;
}

// Minimal in-process Socket.IO double — same shape the existing
// webrtc-signalling-multiparty.test.js uses to drive the real handlers.
function makeIoMock() {
  const rooms = new Map();        // roomName → Set<socketId>
  const broadcasts = [];          // {from, room, event, payload}
  const directEmits = [];         // {to, event, payload}
  const sockets = new Map();

  function ensureRoom(name) {
    if (!rooms.has(name)) rooms.set(name, new Set());
    return rooms.get(name);
  }

  function makeSocket(id) {
    const handlers = new Map();
    const sock = {
      id,
      rooms: new Set([id]),
      on(event, fn) {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event).push(fn);
      },
      join(room) { ensureRoom(room).add(id); sock.rooms.add(room); },
      leave(room) { rooms.get(room)?.delete(id); sock.rooms.delete(room); },
      to(room) {
        return { emit(event, payload) { broadcasts.push({ from: id, room, event, payload }); } };
      },
      emit(event, payload) { directEmits.push({ to: id, event, payload }); },
      _trigger(event, payload) {
        for (const fn of handlers.get(event) || []) fn(payload);
      },
    };
    sockets.set(id, sock);
    return sock;
  }

  const io = {
    connectionHandler: null,
    sockets: { adapter: { rooms } },
    on(event, fn) { if (event === "connection") io.connectionHandler = fn; },
    to(target) {
      return {
        emit(event, payload) {
          if (sockets.has(target)) directEmits.push({ to: target, event, payload });
          else broadcasts.push({ from: "server", room: target, event, payload });
        },
      };
    },
    _connect(id) { const s = makeSocket(id); io.connectionHandler?.(s); return s; },
    _rooms: rooms,
    _broadcasts: broadcasts,
    _directEmits: directEmits,
  };
  return io;
}

describe("healthcare telehealth honesty — DAILY_API_KEY absent", () => {
  it("unprovisioned (no realtime layer): schedules the appointment but never fabricates a joinable room", async () => {
    const p = newPatient();
    const r = await call("telehealth-create", ctxA, { patientId: p.id, provider: "Dr. Ng" });
    assert.equal(r.ok, true);
    const visit = r.result.visit;
    // Appointment side is real …
    assert.equal(visit.status, "scheduled");
    assert.equal(visit.patientId, p.id);
    // … but the video claim is honest: nothing is provisioned.
    assert.equal(visit.videoReady, false);
    assert.equal(visit.roomProvider, "none");
    assert.equal(visit.roomUrl, null);
    assert.match(String(visit.note), /Video calling requires configuration/);
    // No fabricated credentials, no phantom join descriptor.
    assert.equal("joinToken" in visit, false);
    assert.equal("join" in visit, false);
    assert.equal(JSON.stringify(r).includes("joinToken"), false);
    // The appointment row persists.
    const list = call("telehealth-list", ctxA, { patientId: p.id });
    assert.equal(list.result.visits.length, 1);
    assert.equal(list.result.visits[0].id, visit.id);
    assert.equal(list.result.visits[0].videoReady, false);
  });

  it("unprovisioned: the clinical lifecycle still works (in_progress → completed)", async () => {
    const p = newPatient();
    const visit = (await call("telehealth-create", ctxA, { patientId: p.id })).result.visit;
    const started = call("telehealth-update-status", ctxA, { id: visit.id, status: "in_progress" });
    assert.equal(started.ok, true);
    assert.ok(started.result.visit.startedAt);
    const done = call("telehealth-update-status", ctxA, { id: visit.id, status: "completed" });
    assert.ok(done.result.visit.endedAt);
  });

  it("provisioned (realtime up): returns the real token-free join descriptor the in-lens client uses", async () => {
    globalThis._concordREALTIME = { ready: true, io: makeIoMock() };
    const p = newPatient();
    const r = await call("telehealth-create", ctxA, { patientId: p.id, provider: "Dr. Ng" });
    assert.equal(r.ok, true);
    const visit = r.result.visit;
    assert.equal(visit.status, "scheduled");
    assert.equal(visit.videoReady, true);
    assert.equal(visit.roomProvider, "concord-webrtc");
    assert.equal(visit.roomUrl, null); // no fabricated URL — the call is in-lens
    // The join descriptor is the EXACT signalling contract
    // (TelehealthVideoCall emits `webrtc:join { visitId }`; the relay
    // rooms peers under `webrtc:<visitId>`).
    assert.equal(visit.join.transport, "socket.io");
    assert.equal(visit.join.joinEvent, "webrtc:join");
    assert.equal(visit.join.visitId, visit.id);
    assert.equal(visit.join.room, `webrtc:${visit.id}`);
    assert.equal(visit.join.component, "TelehealthVideoCall");
    // Still no fabricated credential — the path is token-free by design.
    assert.equal("joinToken" in visit, false);
    // The appointment row persists on this path too.
    const list = call("telehealth-list", ctxA, { patientId: p.id });
    assert.equal(list.result.visits.length, 1);
    assert.equal(list.result.visits[0].join.room, `webrtc:${visit.id}`);
  });

  it("round-trip: the returned join descriptor is accepted by the real signalling handlers", async () => {
    const io = makeIoMock();
    attachWebRTCSignalling(io);          // the REAL relay from lib/webrtc-signalling.js
    globalThis._concordREALTIME = { ready: true, io };

    const p = newPatient();
    const visit = (await call("telehealth-create", ctxA, { patientId: p.id })).result.visit;
    assert.equal(visit.videoReady, true);

    // Provider joins first, patient second — exactly what the client
    // component does with the descriptor's joinEvent + visitId.
    const provider = io._connect("provider-sock");
    const patient = io._connect("patient-sock");
    provider._trigger(visit.join.joinEvent, { visitId: visit.join.visitId });
    patient._trigger(visit.join.joinEvent, { visitId: visit.join.visitId });

    // The signalling layer roomed both peers under the descriptor's room.
    const room = io._rooms.get(visit.join.room);
    assert.ok(room, `signalling created room ${visit.join.room}`);
    assert.ok(room.has("provider-sock") && room.has("patient-sock"));

    // The second joiner was told about the first (offer bootstrap) …
    const peerList = io._directEmits.find(e => e.to === "patient-sock" && e.event === "webrtc:peer-list");
    assert.ok(peerList);
    assert.deepEqual(peerList.payload.peers, ["provider-sock"]);
    // … and the first was notified of the second.
    const joined = io._broadcasts.find(b => b.event === "webrtc:peer-joined" && b.payload.peerId === "patient-sock");
    assert.ok(joined);

    // A targeted SDP offer relays through — the full handshake path works.
    io._directEmits.length = 0;
    patient._trigger("webrtc:offer", { visitId: visit.join.visitId, sdp: { type: "offer", sdp: "…" }, target: "provider-sock" });
    const offer = io._directEmits.find(e => e.to === "provider-sock" && e.event === "webrtc:offer");
    assert.ok(offer);
    assert.equal(offer.payload.fromPeerId, "patient-sock");
    assert.equal(offer.payload.visitId, visit.join.visitId);
  });
});
