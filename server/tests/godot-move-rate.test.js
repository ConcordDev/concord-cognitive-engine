// server/tests/godot-move-rate.test.js
//
// Contract tests for the Godot-path player:move ~30Hz cadence gate
// (audit v4 proposal #2 / docs/GODOT_INTEGRATION.md throughput-tuning gap).
//
//   cd server && node --test tests/godot-move-rate.test.js
//
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  makeGodotMoveRateGate,
  GODOT_MOVE_MIN_INTERVAL_MS,
} from "../lib/godot-move-rate.js";

describe("makeGodotMoveRateGate", () => {
  it("exports the socket.io-matching 33ms default", () => {
    assert.equal(GODOT_MOVE_MIN_INTERVAL_MS, 33);
  });

  it("accepts the first move for a user", () => {
    let t = 1000;
    const gate = makeGodotMoveRateGate({ now: () => t });
    assert.equal(gate.tryAccept("u1"), true);
    assert.equal(gate.peekLast("u1"), 1000);
  });

  it("silently rejects a second move inside the 33ms window", () => {
    let t = 0;
    const gate = makeGodotMoveRateGate({ now: () => t });
    assert.equal(gate.tryAccept("u1"), true);
    t = 32; // still inside the window
    assert.equal(gate.tryAccept("u1"), false);
    // last accepted stays at the first accept
    assert.equal(gate.peekLast("u1"), 0);
  });

  it("accepts again once the 33ms window has elapsed", () => {
    let t = 0;
    const gate = makeGodotMoveRateGate({ now: () => t });
    assert.equal(gate.tryAccept("u1"), true);
    t = 33;
    assert.equal(gate.tryAccept("u1"), true);
    assert.equal(gate.peekLast("u1"), 33);
    t = 65; // 65 - 33 = 32 < 33 → still gated
    assert.equal(gate.tryAccept("u1"), false);
    t = 66; // 66 - 33 = 33 → accepted
    assert.equal(gate.tryAccept("u1"), true);
  });

  it("keeps independent windows per userId", () => {
    let t = 0;
    const gate = makeGodotMoveRateGate({ now: () => t });
    assert.equal(gate.tryAccept("alice"), true);
    t = 10;
    // alice still gated
    assert.equal(gate.tryAccept("alice"), false);
    // bob is independent
    assert.equal(gate.tryAccept("bob"), true);
    assert.equal(gate.tryAccept("bob"), false);
  });

  it("allows null/empty userId through (caller still drops unauth)", () => {
    const gate = makeGodotMoveRateGate();
    assert.equal(gate.tryAccept(null), true);
    assert.equal(gate.tryAccept(undefined), true);
    assert.equal(gate.tryAccept(""), true);
    assert.equal(gate.size(), 0);
  });

  it("clear(userId) drops one entry; clear() drops all", () => {
    let t = 0;
    const gate = makeGodotMoveRateGate({ now: () => t });
    gate.tryAccept("a");
    t = 100;
    gate.tryAccept("b");
    assert.equal(gate.size(), 2);
    gate.clear("a");
    assert.equal(gate.size(), 1);
    assert.equal(gate.peekLast("a"), 0);
    // after clear, a can accept immediately even at same t
    assert.equal(gate.tryAccept("a"), true);
    gate.clear();
    assert.equal(gate.size(), 0);
  });

  it("honors an explicit timestamp arg over the clock", () => {
    const gate = makeGodotMoveRateGate({ now: () => 999999 });
    assert.equal(gate.tryAccept("u", 100), true);
    assert.equal(gate.tryAccept("u", 120), false); // +20ms < 33
    assert.equal(gate.tryAccept("u", 133), true);  // +33ms ok
    assert.equal(gate.peekLast("u"), 133);
  });

  it("never throws on odd input", () => {
    const gate = makeGodotMoveRateGate();
    assert.doesNotThrow(() => gate.tryAccept());
    assert.doesNotThrow(() => gate.tryAccept(123));
    assert.doesNotThrow(() => gate.clear(undefined));
    assert.doesNotThrow(() => gate.peekLast("missing"));
  });
});
