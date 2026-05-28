// Phase CC5 — time loop tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  startLoop, endLoop, recordMemory, getMemories, getActiveLoop,
  DEFAULT_LOOP_DURATION_S,
} from "../lib/time-loop.js";
import { up as upLoops } from "../migrations/255_time_loops.js";

function freshDb() { const db = new Database(":memory:"); upLoops(db); return db; }

describe("Phase CC5 — time loops", () => {
  let db;
  beforeEach(() => { db = freshDb(); delete process.env.CONCORD_TIME_LOOPS; });

  it("startLoop creates loop 1 + alreadyActive prevents double-start", () => {
    const a = startLoop(db, "u1", { worldId: "lattice-crucible-loop" });
    assert.equal(a.ok, true);
    assert.equal(a.loopNumber, 1);
    const b = startLoop(db, "u1", { worldId: "lattice-crucible-loop" });
    assert.equal(b.alreadyActive, true);
  });

  it("env disable rejects start", () => {
    process.env.CONCORD_TIME_LOOPS = "0";
    const r = startLoop(db, "u1", { worldId: "lattice-crucible-loop" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "disabled");
  });

  it("endLoop + startLoop advances loop_number + restores snapshots", () => {
    const a = startLoop(db, "u1", { worldId: "w1" });
    endLoop(db, a.sessionId, {
      reason: "death",
      inventorySnapshot: { wood: 5 },
      positionSnapshot: { x: 10, y: 20 },
    });
    const b = startLoop(db, "u1", { worldId: "w1" });
    assert.equal(b.loopNumber, 2);
    assert.deepEqual(b.restoredInventory, { wood: 5 });
    assert.deepEqual(b.restoredPosition, { x: 10, y: 20 });
  });

  it("endLoop with invalid reason rejected", () => {
    const a = startLoop(db, "u1", { worldId: "w1" });
    const r = endLoop(db, a.sessionId, { reason: "explode" });
    assert.equal(r.ok, false);
  });

  it("endLoop idempotent (re-end rejected)", () => {
    const a = startLoop(db, "u1", { worldId: "w1" });
    endLoop(db, a.sessionId, { reason: "timeout" });
    const r = endLoop(db, a.sessionId, { reason: "death" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "already_ended");
  });

  it("memories survive across loops", () => {
    startLoop(db, "u1", { worldId: "w1" });
    recordMemory(db, "u1", {
      worldId: "w1",
      summary: "The lighthouse keeper knows the truth.",
      firstLoopNumber: 1,
    });
    // End + start a new loop — memory should still be there.
    const active = getActiveLoop(db, "u1", "w1");
    endLoop(db, active.id, { reason: "timeout" });
    startLoop(db, "u1", { worldId: "w1" });
    const mems = getMemories(db, "u1", "w1");
    assert.equal(mems.length, 1);
    assert.ok(mems[0].summary.includes("lighthouse"));
  });

  it("multi-world isolation: w1 loop doesn't affect w2", () => {
    startLoop(db, "u1", { worldId: "w1" });
    const r = startLoop(db, "u1", { worldId: "w2" });
    assert.equal(r.ok, true);
    assert.equal(r.alreadyActive, false);
  });

  it("getActiveLoop returns null after end", () => {
    const a = startLoop(db, "u1", { worldId: "w1" });
    assert.ok(getActiveLoop(db, "u1", "w1"));
    endLoop(db, a.sessionId, { reason: "timeout" });
    assert.equal(getActiveLoop(db, "u1", "w1"), null);
  });
});
