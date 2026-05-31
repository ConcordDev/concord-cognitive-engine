// Engine N10 × time-loop — temporal causality over loop memories. Pins the
// future-memory paradox guard, causal ordering, dependency-paradox/cycle
// detection, and the additive getMemories(currentLoop) filter.
//
// Run: node --test tests/viability/loop-causality.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../../migrate.js";
import {
  carriableMemories,
  isFutureMemory,
  orderMemoriesCausal,
  validateMemoryDeps,
  memoryPrecedes,
} from "../../lib/viability/loop-causality.js";
import { recordMemory, getMemories } from "../../lib/time-loop.js";

const mem = (id, loop) => ({ id, first_loop_number: loop });

describe("future-memory paradox", () => {
  it("drops memories from loops not yet lived", () => {
    const all = [mem("a", 1), mem("b", 3), mem("c", 5)];
    assert.deepEqual(carriableMemories(all, 3).map((m) => m.id), ["a", "b"]);
    assert.equal(isFutureMemory(mem("z", 9), 4), true);
    assert.equal(isFutureMemory(mem("z", 2), 4), false);
  });

  it("orders memories by origin loop", () => {
    assert.deepEqual(orderMemoriesCausal([mem("c", 5), mem("a", 1), mem("b", 3)]).map((m) => m.id), ["a", "b", "c"]);
  });
});

describe("dependency consistency", () => {
  it("flags a dependency on a future-loop memory + reports acyclicity", () => {
    const memories = [mem("a", 1), mem("b", 2)];
    const ok = validateMemoryDeps(memories, { b: ["a"] });        // b(loop2) depends on a(loop1) — fine
    assert.equal(ok.consistent, true);
    const bad = validateMemoryDeps(memories, { a: ["b"] });       // a(loop1) depends on b(loop2) — paradox
    assert.equal(bad.consistent, false);
    assert.equal(bad.paradoxes[0].reason, "depends_on_future_loop");
  });

  it("detects a causal cycle", () => {
    const r = validateMemoryDeps([mem("a", 1), mem("b", 1)], { a: ["b"], b: ["a"] });
    assert.equal(r.cyclic, true);
    assert.equal(r.consistent, false);
  });

  it("memoryPrecedes follows the dependency chain (N10)", () => {
    assert.equal(memoryPrecedes("a", "c", { b: ["a"], c: ["b"] }), true);
    assert.equal(memoryPrecedes("c", "a", { b: ["a"], c: ["b"] }), false);
  });
});

describe("getMemories currentLoop guard (additive)", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("without currentLoop returns all retained; with it, drops future memories", () => {
    recordMemory(db, "u1", { worldId: "w", summary: "loop1 thing", firstLoopNumber: 1 });
    recordMemory(db, "u1", { worldId: "w", summary: "loop4 thing", firstLoopNumber: 4 });
    assert.equal(getMemories(db, "u1", "w").length, 2);          // off == today
    assert.equal(getMemories(db, "u1", "w", 2).length, 1);       // loop-4 memory dropped at loop 2
  });
});
