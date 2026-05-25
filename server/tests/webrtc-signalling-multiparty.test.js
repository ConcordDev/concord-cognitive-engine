// server/tests/webrtc-signalling-multiparty.test.js
//
// Contract test for the WebRTC signalling layer used by the in-lens
// telehealth call. Verifies that:
//   1. webrtc:join replies with a peer-list of currently-present peers
//      so the joiner can initiate offers to everyone already there.
//   2. webrtc:peer-joined fires on existing peers when a new one arrives.
//   3. offer/answer/ice are routed to the explicit `target` peer (not
//      broadcast) so multi-party calls don't cross-talk.
//   4. webrtc:peer-left fires on disconnect.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { attachWebRTCSignalling } from "../lib/webrtc-signalling.js";

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
      join(room) {
        ensureRoom(room).add(id);
        sock.rooms.add(room);
      },
      leave(room) {
        rooms.get(room)?.delete(id);
        sock.rooms.delete(room);
      },
      to(room) {
        return {
          emit(event, payload) { broadcasts.push({ from: id, room, event, payload }); },
        };
      },
      emit(event, payload) { directEmits.push({ to: id, event, payload }); },
      _trigger(event, payload) {
        const list = handlers.get(event) || [];
        for (const fn of list) fn(payload);
      },
      _disconnect() { sock._trigger("disconnect"); },
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
          // io.to(socketId).emit → direct emit to that socket
          if (sockets.has(target)) directEmits.push({ to: target, event, payload });
          // io.to(roomName).emit → broadcast (here we treat both the same shape)
          else broadcasts.push({ from: "server", room: target, event, payload });
        },
      };
    },
    _connect(id) {
      const s = makeSocket(id);
      io.connectionHandler?.(s);
      return s;
    },
    _broadcasts: broadcasts,
    _directEmits: directEmits,
  };
  return io;
}

describe("WebRTC signalling — multi-party relay", () => {
  let io, alice, bob, carol;

  before(() => {
    io = makeIoMock();
    attachWebRTCSignalling(io);
    alice = io._connect("alice");
    bob = io._connect("bob");
    carol = io._connect("carol");
  });

  it("first joiner sees empty peer-list, subsequent see prior peers", () => {
    io._directEmits.length = 0;
    io._broadcasts.length = 0;
    alice._trigger("webrtc:join", { visitId: "V1" });
    let peerList = io._directEmits.find(e => e.to === "alice" && e.event === "webrtc:peer-list");
    assert.ok(peerList);
    assert.deepEqual(peerList.payload.peers, []);

    io._directEmits.length = 0;
    io._broadcasts.length = 0;
    bob._trigger("webrtc:join", { visitId: "V1" });
    peerList = io._directEmits.find(e => e.to === "bob" && e.event === "webrtc:peer-list");
    assert.ok(peerList);
    assert.deepEqual(peerList.payload.peers, ["alice"]);
    // Alice should see a peer-joined.
    const joined = io._broadcasts.find(b => b.event === "webrtc:peer-joined");
    assert.ok(joined);
    assert.equal(joined.payload.peerId, "bob");

    io._directEmits.length = 0;
    io._broadcasts.length = 0;
    carol._trigger("webrtc:join", { visitId: "V1" });
    peerList = io._directEmits.find(e => e.to === "carol" && e.event === "webrtc:peer-list");
    assert.deepEqual(new Set(peerList.payload.peers), new Set(["alice", "bob"]));
  });

  it("offer/answer/ice with explicit target routes only to that peer", () => {
    io._directEmits.length = 0;
    io._broadcasts.length = 0;
    alice._trigger("webrtc:offer", { visitId: "V1", sdp: { type: "offer", sdp: "..." }, target: "bob" });
    const direct = io._directEmits.filter(e => e.event === "webrtc:offer");
    assert.equal(direct.length, 1);
    assert.equal(direct[0].to, "bob");
    assert.equal(direct[0].payload.fromPeerId, "alice");
    // Should NOT have broadcast to the room.
    assert.equal(io._broadcasts.filter(b => b.event === "webrtc:offer").length, 0,
      "targeted offer does not broadcast to the room");
  });

  it("offer/answer/ice without target broadcasts to the room (1:1 fallback)", () => {
    io._directEmits.length = 0;
    io._broadcasts.length = 0;
    alice._trigger("webrtc:ice", { visitId: "V1", candidate: { foo: "bar" } });
    const bc = io._broadcasts.find(b => b.event === "webrtc:ice");
    assert.ok(bc);
    assert.equal(bc.room, "webrtc:V1");
    assert.equal(bc.payload.fromPeerId, "alice");
  });

  it("webrtc:leave broadcasts peer-left to the room", () => {
    io._directEmits.length = 0;
    io._broadcasts.length = 0;
    bob._trigger("webrtc:leave", { visitId: "V1" });
    const left = io._broadcasts.find(b => b.event === "webrtc:peer-left") ||
                 io._directEmits.find(b => b.event === "webrtc:peer-left");
    assert.ok(left);
    assert.equal(left.payload.peerId, "bob");
  });

  it("disconnect broadcasts peer-left to every webrtc:* room", () => {
    io._broadcasts.length = 0;
    carol._disconnect();
    const left = io._broadcasts.find(b => b.event === "webrtc:peer-left");
    assert.ok(left);
    assert.equal(left.payload.peerId, "carol");
  });

  it("ignores events without visitId", () => {
    assert.doesNotThrow(() => {
      alice._trigger("webrtc:join", {});
      alice._trigger("webrtc:offer", { sdp: {} });
      alice._trigger("webrtc:leave", {});
    });
  });
});
