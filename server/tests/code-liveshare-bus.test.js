// server/tests/code-liveshare-bus.test.js
//
// Contract test for the Live Share shared-debug + shared-terminal bus.
// Exercises the pub-sub relay by feeding a stubbed io+socket adapter the
// same shape Socket.IO produces, then asserting (a) the server tracks
// breakpoint state for late-joiners, and (b) every relay event has the
// `fromPeerId` stamp so receivers can filter their own echoes.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { attachLiveShareBus, stats, disposeSession } from "../lib/code-liveshare-bus.js";

// Minimal Socket.IO mock: tracks per-room listeners and replay events
// so we can simulate (A) socket emits client-side; (B) server broadcasts.
function makeIoMock() {
  const sockets = new Map(); // socketId → socket
  const roomBroadcasts = []; // record of socket.to(room).emit(...)
  const directEmits = [];    // record of socket.emit(...) back to self

  function makeSocket(id) {
    const handlers = new Map();
    const sock = {
      id,
      on(event, fn) {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event).push(fn);
      },
      // socket.to(room).emit(event, payload)
      to(room) {
        return {
          emit(event, payload) { roomBroadcasts.push({ from: id, room, event, payload }); },
        };
      },
      // socket.emit(event, payload) — replied to this socket only
      emit(event, payload) { directEmits.push({ to: id, event, payload }); },
      // Test driver: simulate a client sending event with payload.
      _trigger(event, payload) {
        const list = handlers.get(event) || [];
        for (const fn of list) fn(payload);
      },
    };
    sockets.set(id, sock);
    return sock;
  }

  const io = {
    connectionHandler: null,
    on(event, fn) { if (event === "connection") io.connectionHandler = fn; },
    // Test driver: simulate a new client connecting.
    _connect(id) {
      const s = makeSocket(id);
      io.connectionHandler?.(s);
      return s;
    },
    _broadcasts: roomBroadcasts,
    _directEmits: directEmits,
    _sockets: sockets,
  };
  return io;
}

describe("Live Share debug/terminal bus", () => {
  let io;
  let alice, bob;

  before(() => {
    io = makeIoMock();
    attachLiveShareBus(io);
    alice = io._connect("alice-socket");
    bob = io._connect("bob-socket");
  });

  after(() => {
    disposeSession("SESSION-A");
  });

  it("relays breakpoint-set to the room with fromPeerId stamp", () => {
    io._broadcasts.length = 0;
    alice._trigger("liveshare:debug:breakpoint-set", { code: "SESSION-A", path: "src/app.ts", line: 42 });
    const bc = io._broadcasts.find(b => b.event === "liveshare:debug:breakpoint-set");
    assert.ok(bc, "broadcast emitted");
    assert.equal(bc.from, "alice-socket");
    assert.equal(bc.room, "code:liveshare:SESSION-A");
    assert.equal(bc.payload.path, "src/app.ts");
    assert.equal(bc.payload.line, 42);
    assert.equal(bc.payload.fromPeerId, "alice-socket", "fromPeerId stamp present");
  });

  it("tracks breakpoint state across multiple set/clear events", () => {
    alice._trigger("liveshare:debug:breakpoint-set", { code: "SESSION-A", path: "src/main.ts", line: 7 });
    alice._trigger("liveshare:debug:breakpoint-set", { code: "SESSION-A", path: "src/main.ts", line: 12 });
    let s = stats();
    assert.equal(s["SESSION-A"].breakpoints, 3, "3 unique breakpoints accumulated (42 + 7 + 12)");
    alice._trigger("liveshare:debug:breakpoint-cleared", { code: "SESSION-A", path: "src/main.ts", line: 7 });
    s = stats();
    assert.equal(s["SESSION-A"].breakpoints, 2, "cleared breakpoint drops the count");
  });

  it("replays state to late-joiners via state-request → state-snapshot", () => {
    io._directEmits.length = 0;
    bob._trigger("liveshare:debug:state-request", { code: "SESSION-A" });
    const snap = io._directEmits.find(e => e.event === "liveshare:debug:state-snapshot");
    assert.ok(snap, "snapshot emitted directly to requester");
    assert.equal(snap.to, "bob-socket");
    assert.equal(snap.payload.breakpoints.length, 2);
    // Order doesn't matter, but each entry must have path+line.
    for (const b of snap.payload.breakpoints) {
      assert.equal(typeof b.path, "string");
      assert.equal(typeof b.line, "number");
    }
  });

  it("relays current-line with peerId so receivers know who is paused", () => {
    io._broadcasts.length = 0;
    alice._trigger("liveshare:debug:current-line", { code: "SESSION-A", path: "src/app.ts", line: 42 });
    const bc = io._broadcasts.find(b => b.event === "liveshare:debug:current-line");
    assert.ok(bc);
    assert.equal(bc.payload.fromPeerId, "alice-socket");
    const s = stats();
    assert.deepEqual(s["SESSION-A"].currentLine, { path: "src/app.ts", line: 42, peerId: "alice-socket" });
  });

  it("relays terminal:input + terminal:output with fromPeerId stamp", () => {
    io._broadcasts.length = 0;
    alice._trigger("liveshare:terminal:input", { code: "SESSION-A", terminalId: "t-1", data: "ls\n" });
    bob._trigger("liveshare:terminal:output", { code: "SESSION-A", terminalId: "t-1", data: "file1.txt\n" });
    const inEvt = io._broadcasts.find(b => b.event === "liveshare:terminal:input");
    const outEvt = io._broadcasts.find(b => b.event === "liveshare:terminal:output");
    assert.ok(inEvt && outEvt);
    assert.equal(inEvt.payload.fromPeerId, "alice-socket");
    assert.equal(outEvt.payload.fromPeerId, "bob-socket");
    assert.equal(inEvt.payload.data, "ls\n");
    assert.equal(outEvt.payload.data, "file1.txt\n");
  });

  it("ignores malformed events without throwing", () => {
    assert.doesNotThrow(() => {
      alice._trigger("liveshare:debug:breakpoint-set", { code: "SESSION-A" });          // missing path/line
      alice._trigger("liveshare:debug:breakpoint-set", { code: "SESSION-A", path: "x" }); // missing line
      alice._trigger("liveshare:terminal:input", { code: "SESSION-A", terminalId: "t" }); // missing data
      alice._trigger("liveshare:terminal:input", {});                                     // empty
    });
  });
});
