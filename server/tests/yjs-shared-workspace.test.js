// server/tests/yjs-shared-workspace.test.js
//
// MU2 (V1.1 R6 multi-user collaboration) — Shared Workspace Room. Proves
// the claim made in yjs-realtime.js's new 'workspace:room' scope comment:
// the EXISTING attachYjsSync relay (built for Y.Text documents) is
// schema-agnostic and needs zero new server code to converge a `Y.Array`
// of DTU references across two real clients. Only the doc/awareness
// SHAPE is new (a plain-object list instead of collaborative text) — the
// wire protocol, relay, and persistence are the exact same code path
// server/tests/yjs-awareness.test.js already exercises for Y.Text/Awareness.
//
// Modeled on that file's fake Socket.IO harness (io.on('connection',...),
// socket.on/emit/to(room).emit) and its "drive real Y.Doc/Awareness
// objects, mock only the transport" style.

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { Awareness as RawAwareness, encodeAwarenessUpdate, applyAwarenessUpdate } from "y-protocols/awareness";
import {
  KNOWN_SCOPES,
  getDoc,
  disposeDoc,
  encodeStateAsUpdate,
  attachYjsSync,
} from "../lib/yjs-realtime.js";

const _liveAwareness = [];
function Awareness(doc) {
  const a = new RawAwareness(doc);
  _liveAwareness.push(a);
  return a;
}
after(() => {
  for (const a of _liveAwareness) { try { a.destroy(); } catch (_) { /* ignore */ } }
  disposeDoc(KNOWN_SCOPES.SHARED_WORKSPACE, "shared-workspace-unit-doc");
});

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

describe("yjs-realtime — 'workspace:room' scope, Y.Array of DTU refs", () => {
  const scope = KNOWN_SCOPES.SHARED_WORKSPACE;
  const docId = "shared-workspace-unit-doc";

  beforeEach(() => { disposeDoc(scope, docId); });

  it("KNOWN_SCOPES exposes the new scope string (per the documented naming convention)", () => {
    assert.equal(scope, "workspace:room");
  });

  it("a real client's Y.Array push relays through the generic yjs:update path and lands on the server's authoritative doc — no shape-specific server code involved", () => {
    const io = makeFakeIO();
    attachYjsSync(io);
    const alice = makeFakeSocket("alice", io);
    const bob = makeFakeSocket("bob", io);
    io._connect(alice);
    io._connect(bob);

    // Alice's local doc, exactly as the browser useYjsDoc() hook builds one.
    const aliceDoc = new Y.Doc();
    const refs = aliceDoc.getArray("dtuRefs");
    aliceDoc.on("update", (update) => {
      alice.trigger("yjs:update", { scope, docId, update: b64(update) });
    });

    const dtuRef = {
      id: "dtu-shared-1", title: "Q3 Forecast", kind: "regular", domain: "finance",
      addedBy: "user_alice", addedByName: "Alice", addedAt: Date.now(),
    };
    refs.push([dtuRef]);

    // The server's authoritative doc for this (scope, docId) now really
    // contains the pushed entry — reconstructed from the SAME
    // yjs:update relay path Y.Text updates use, not a bespoke handler.
    const serverArr = getDoc(scope, docId).getArray("dtuRefs");
    assert.equal(serverArr.length, 1);
    assert.deepEqual(serverArr.toArray()[0], dtuRef);

    // The relay excluded Alice's own socket (broadcast via alice.to(room),
    // matching the existing "excluding sender" contract).
    const relayed = io._roomBroadcasts.find((b) => b.from === "alice" && b.event === "yjs:update");
    assert.ok(relayed, "alice's push relayed to the room");

    // A second real client (Bob) applies the relayed bytes to HIS OWN
    // local doc and converges to the identical array — proving this is
    // real multi-client CRDT convergence, not a server-side echo.
    const bobDoc = new Y.Doc();
    Y.applyUpdate(bobDoc, fromB64(relayed.payload.update));
    assert.deepEqual(bobDoc.getArray("dtuRefs").toArray(), [dtuRef]);
  });

  it("a late joiner's yjs:sync-request bootstraps the full current Y.Array state (add-then-delete converges honestly)", () => {
    const io = makeFakeIO();
    attachYjsSync(io);
    const alice = makeFakeSocket("alice", io);
    io._connect(alice);

    const aliceDoc = new Y.Doc();
    const refs = aliceDoc.getArray("dtuRefs");
    aliceDoc.on("update", (update) => {
      alice.trigger("yjs:update", { scope, docId, update: b64(update) });
    });

    const refA = { id: "dtu-a", title: "A", kind: "regular", addedBy: "u1", addedByName: "U1", addedAt: 1 };
    const refB = { id: "dtu-b", title: "B", kind: "regular", addedBy: "u1", addedByName: "U1", addedAt: 2 };
    refs.push([refA, refB]);
    refs.delete(0, 1); // remove refA — a real CRDT delete, not a re-render trick

    // Confirm server's authoritative doc only has B before the late joiner arrives.
    assert.deepEqual(getDoc(scope, docId).getArray("dtuRefs").toArray(), [refB]);

    const bob = makeFakeSocket("bob", io);
    io._connect(bob);
    bob.trigger("yjs:sync-request", { scope, docId });
    const reply = bob._direct.find((d) => d.event === "yjs:sync-state");
    assert.ok(reply, "server replies with yjs:sync-state");

    const bobDoc = new Y.Doc();
    Y.applyUpdate(bobDoc, fromB64(reply.payload.update));
    assert.deepEqual(bobDoc.getArray("dtuRefs").toArray(), [refB], "late joiner converges to the current (post-delete) state, honestly");
  });

  it("presence (Awareness) for a shared workspace room works unmodified under the new scope", () => {
    const io = makeFakeIO();
    attachYjsSync(io);
    const alice = makeFakeSocket("alice", io);
    const bob = makeFakeSocket("bob", io);
    io._connect(alice);
    io._connect(bob);

    const aliceDoc = new Y.Doc();
    const aliceAwareness = new Awareness(aliceDoc);
    const alicePresence = { userId: "user_alice", displayName: "Alice", color: "#38bdf8", cursor: null, lastSeen: Date.now() };
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

  it("encodeStateAsUpdate for an untouched room returns a valid, empty-array snapshot (honest empty room, not an error)", () => {
    const snapshot = encodeStateAsUpdate(scope, "brand-new-empty-room");
    const doc = new Y.Doc();
    Y.applyUpdate(doc, snapshot);
    assert.deepEqual(doc.getArray("dtuRefs").toArray(), []);
    disposeDoc(scope, "brand-new-empty-room");
  });
});
