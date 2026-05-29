/**
 * mode-realtime — per-user/world/room emit helpers for the polling→push pass.
 * Run: node --test tests/mode-realtime.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { emitModeToUser, emitModeToWorld, emitModeToRoom } from "../lib/mode-realtime.js";

function spyIo() {
  const calls = [];
  return {
    calls,
    to(room) {
      return { emit: (event, payload) => { calls.push({ room, event, payload }); } };
    },
  };
}

describe("mode-realtime emit helpers", () => {
  it("emits to the user room with a ts stamp", () => {
    const io = spyIo();
    assert.equal(emitModeToUser(io, "u1", "horde:state", { wave: 3 }), true);
    assert.equal(io.calls.length, 1);
    assert.equal(io.calls[0].room, "user:u1");
    assert.equal(io.calls[0].event, "horde:state");
    assert.equal(io.calls[0].payload.wave, 3);
    assert.ok(typeof io.calls[0].payload.ts === "number");
  });

  it("emits to world + arbitrary rooms", () => {
    const io = spyIo();
    emitModeToWorld(io, "w1", "spectator:count", { count: 12 });
    emitModeToRoom(io, "mahjong:table:t1", "mahjong:state", { turn: 2 });
    assert.equal(io.calls[0].room, "world:w1");
    assert.equal(io.calls[1].room, "mahjong:table:t1");
  });

  it("is a no-op (no throw) with null io / missing args", () => {
    assert.equal(emitModeToUser(null, "u1", "x"), false);
    assert.equal(emitModeToUser(spyIo(), null, "x"), false);
    assert.equal(emitModeToUser(spyIo(), "u1", null), false);
    // a throwing io must not propagate
    const badIo = { to() { throw new Error("boom"); } };
    assert.equal(emitModeToUser(badIo, "u1", "x"), false);
  });
});
