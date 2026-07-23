// server/tests/yjs-awareness.test.js
//
// MU1 (V1.1 R6 multi-user collaboration) — extends the real Yjs CRDT
// layer (server/lib/yjs-realtime.js) with Yjs's own Awareness protocol
// (y-protocols/awareness, already a transitive dependency of the
// existing y-websocket dependency — no new npm install) for live
// cursors + presence. Modeled on collab-crdt-snapshot.test.js's style
// (real Y.Doc/Awareness objects driven directly, plus a fake io/socket
// harness for the attachYjsSync relay).
//
// Every assertion here drives a REAL y-protocols Awareness instance
// through the real encode/apply functions — nothing about the
// awareness *payload* is mocked, only the Socket.IO transport.

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { Awareness as RawAwareness, encodeAwarenessUpdate, applyAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import {
  KNOWN_SCOPES,
  getDoc,
  disposeDoc,
  getAwareness,
  attachYjsSync,
} from "../lib/yjs-realtime.js";

// Every `Awareness` instance (including the module's own, via
// getAwareness) starts a 3s-cadence internal setInterval that only
// stops on `.destroy()`. Track every ad hoc "client-side" Awareness
// this file constructs so the process can exit cleanly instead of
// depending on `--test-force-exit`.
const _liveAwareness = [];
function Awareness(doc) {
  const a = new RawAwareness(doc);
  _liveAwareness.push(a);
  return a;
}
after(() => {
  for (const a of _liveAwareness) { try { a.destroy(); } catch (_) { /* ignore */ } }
  disposeDoc(KNOWN_SCOPES.CODE_LIVESHARE, "awareness-unit-doc");
  disposeDoc(KNOWN_SCOPES.COLLAB_DOC, "awareness-relay-doc");
});

// ── Minimal fake Socket.IO harness ──────────────────────────────────
// Just enough of the io/socket surface attachYjsSync actually calls:
// io.on('connection', cb), io.to(room).emit, socket.on/emit/to(room).emit.
function makeFakeIO() {
  const connectionHandlers = [];
  const roomBroadcasts = [];
  return {
    on(event, cb) { if (event === "connection") connectionHandlers.push(cb); },
    to(room) {
      return { emit: (event, payload) => roomBroadcasts.push({ from: "server", room, event, payload }) };
    },
    _roomBroadcasts: roomBroadcasts,
    _connect(socket) { for (const cb of connectionHandlers) cb(socket); },
  };
}

function makeFakeSocket(id, io) {
  const handlers = new Map();
  const direct = [];
  return {
    id,
    on(event, cb) { handlers.set(event, cb); },
    trigger(event, payload) { const cb = handlers.get(event); if (cb) cb(payload); },
    emit(event, payload) { direct.push({ event, payload }); },
    to(room) {
      return { emit: (event, payload) => io._roomBroadcasts.push({ from: id, room, event, payload }) };
    },
    _direct: direct,
  };
}

function b64(bytes) { return Buffer.from(bytes).toString("base64"); }
function fromB64(str) { return Buffer.from(str, "base64"); }

describe("yjs-realtime — server Awareness instance", () => {
  const scope = KNOWN_SCOPES.CODE_LIVESHARE;
  const docId = "awareness-unit-doc";

  beforeEach(() => { disposeDoc(scope, docId); });

  it("is bound to the same Y.Doc as getDoc for that (scope, docId)", () => {
    const awareness = getAwareness(scope, docId);
    assert.equal(awareness.doc, getDoc(scope, docId));
  });

  it("never appears as a phantom, field-less collaborator itself", () => {
    const awareness = getAwareness(scope, docId);
    assert.equal(awareness.getStates().size, 0, "server's own Awareness must start with zero states");
  });

  it("getAwareness is idempotent per (scope, docId)", () => {
    assert.equal(getAwareness(scope, docId), getAwareness(scope, docId));
  });
});

describe("attachYjsSync — awareness relay", () => {
  const scope = KNOWN_SCOPES.COLLAB_DOC;
  const docId = "awareness-relay-doc";

  beforeEach(() => { disposeDoc(scope, docId); });

  it("late-joiner yjs:awareness-request returns an empty-but-valid state when nobody is present", () => {
    const io = makeFakeIO();
    attachYjsSync(io);
    const bob = makeFakeSocket("bob", io);
    io._connect(bob);

    bob.trigger("yjs:awareness-request", { scope, docId });
    const reply = bob._direct.find((d) => d.event === "yjs:awareness-state");
    assert.ok(reply, "server replies with yjs:awareness-state");
    assert.equal(reply.payload.scope, scope);
    assert.equal(reply.payload.docId, docId);

    // Decoding into a fresh receiving Awareness must round-trip to
    // exactly zero OTHER real collaborators — never a fabricated one.
    // (`getStates()` always includes the receiver's own local `{}`
    // entry — that's the receiver's own presence, not a peer.)
    const receiverDoc = new Y.Doc();
    const receiverAwareness = new Awareness(receiverDoc);
    applyAwarenessUpdate(receiverAwareness, fromB64(reply.payload.update), "remote");
    const others = Array.from(receiverAwareness.getStates().keys())
      .filter((id) => id !== receiverAwareness.clientID);
    assert.equal(others.length, 0);
  });

  it("relays a real client's awareness-update to other room members and applies it server-side", () => {
    const io = makeFakeIO();
    attachYjsSync(io);
    const alice = makeFakeSocket("alice", io);
    const bob = makeFakeSocket("bob", io);
    io._connect(alice);
    io._connect(bob);

    // Alice's REAL local Yjs client, exactly like the browser-side
    // hook will use: an Awareness bound to her own Y.Doc.
    const aliceDoc = new Y.Doc();
    const aliceAwareness = new Awareness(aliceDoc);
    const alicePresence = {
      userId: "user_alice",
      displayName: "Alice",
      color: "#38bdf8",
      cursor: { path: "index.js", anchor: 12, head: 12 },
      lastSeen: Date.now(),
    };
    aliceAwareness.setLocalState(alicePresence);
    const update = encodeAwarenessUpdate(aliceAwareness, [aliceAwareness.clientID]);

    alice.trigger("yjs:awareness-update", {
      scope, docId, clientId: aliceAwareness.clientID, update: b64(update),
    });

    // Server's own Awareness for this doc now reflects Alice's real state.
    const serverAwareness = getAwareness(scope, docId);
    assert.deepEqual(serverAwareness.getStates().get(aliceAwareness.clientID), alicePresence);

    // The relay went out via alice.to(room), not io.to(room) or
    // alice.emit — she's excluded from her own broadcast, per the
    // documented "excluding sender" contract yjs:update already uses.
    const relayed = io._roomBroadcasts.find((b) => b.from === "alice" && b.event === "yjs:awareness-update");
    assert.ok(relayed, "alice's socket.to(room) broadcast happened");
    assert.equal(relayed.room, `${scope}:${docId}`);

    // Decode the exact bytes that were relayed and confirm they carry
    // Alice's real state, not a re-derived or reshaped one.
    const bobReceiverDoc = new Y.Doc();
    const bobReceiverAwareness = new Awareness(bobReceiverDoc);
    applyAwarenessUpdate(bobReceiverAwareness, fromB64(relayed.payload.update), "remote");
    assert.deepEqual(bobReceiverAwareness.getStates().get(aliceAwareness.clientID), alicePresence);
  });

  it("a late joiner's yjs:awareness-request now includes the already-announced collaborator", () => {
    const io = makeFakeIO();
    attachYjsSync(io);
    const alice = makeFakeSocket("alice", io);
    const bob = makeFakeSocket("bob", io);
    io._connect(alice);
    io._connect(bob);

    const aliceDoc = new Y.Doc();
    const aliceAwareness = new Awareness(aliceDoc);
    const alicePresence = { userId: "user_alice", displayName: "Alice", color: "#f00", cursor: null, lastSeen: Date.now() };
    aliceAwareness.setLocalState(alicePresence);
    alice.trigger("yjs:awareness-update", {
      scope, docId, clientId: aliceAwareness.clientID,
      update: b64(encodeAwarenessUpdate(aliceAwareness, [aliceAwareness.clientID])),
    });

    bob.trigger("yjs:awareness-request", { scope, docId });
    const reply = bob._direct.find((d) => d.event === "yjs:awareness-state");
    const bobDoc = new Y.Doc();
    const bobAwareness = new Awareness(bobDoc);
    applyAwarenessUpdate(bobAwareness, fromB64(reply.payload.update), "remote");
    assert.deepEqual(bobAwareness.getStates().get(aliceAwareness.clientID), alicePresence);
  });

  it("disconnect retracts the disconnecting socket's announced presence and broadcasts the removal", () => {
    const io = makeFakeIO();
    attachYjsSync(io);
    const alice = makeFakeSocket("alice", io);
    io._connect(alice);

    const aliceDoc = new Y.Doc();
    const aliceAwareness = new Awareness(aliceDoc);
    aliceAwareness.setLocalState({ userId: "user_alice", displayName: "Alice", color: "#f00", cursor: null, lastSeen: Date.now() });
    alice.trigger("yjs:awareness-update", {
      scope, docId, clientId: aliceAwareness.clientID,
      update: b64(encodeAwarenessUpdate(aliceAwareness, [aliceAwareness.clientID])),
    });

    assert.ok(getAwareness(scope, docId).getStates().has(aliceAwareness.clientID), "present before disconnect");

    alice.trigger("disconnect", undefined);

    assert.ok(!getAwareness(scope, docId).getStates().has(aliceAwareness.clientID), "removed after disconnect");

    const removal = io._roomBroadcasts.find((b) => b.from === "server" && b.event === "yjs:awareness-update");
    assert.ok(removal, "server broadcasts the removal at the io level (sender already gone)");
    const checkDoc = new Y.Doc();
    const checkAwareness = new Awareness(checkDoc);
    applyAwarenessUpdate(checkAwareness, fromB64(removal.payload.update), "remote");
    assert.ok(!checkAwareness.getStates().has(aliceAwareness.clientID), "the relayed removal update itself encodes null state");
  });

  it("never fabricates a collaborator for a malformed or missing payload", () => {
    const io = makeFakeIO();
    attachYjsSync(io);
    const alice = makeFakeSocket("alice", io);
    io._connect(alice);

    assert.doesNotThrow(() => alice.trigger("yjs:awareness-update", {}));
    assert.doesNotThrow(() => alice.trigger("yjs:awareness-update", { scope, docId, update: 12345 }));
    assert.doesNotThrow(() => alice.trigger("yjs:awareness-update", { scope, docId, update: "not-valid-base64-yjs-bytes!!" }));
    assert.equal(getAwareness(scope, docId).getStates().size, 0, "no phantom state was ever created");
  });
});
