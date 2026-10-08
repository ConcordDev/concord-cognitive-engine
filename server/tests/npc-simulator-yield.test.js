// NPCSimulator world tick: no overlapping ticks, agents ticked in batches
// with event-loop yields between, persist queue flushed in slices.
//
// Production finding, 2026-10-08: a live CPU profile of the backend showed
// whole-world NPC ticks holding the event loop for 1-3s at a stretch, which
// tripped the load shedder (503 service_overloaded) for real users.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { NPCAgent, NPCSimulator, settleInBatches } from "../lib/npc-simulator.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, npc_type TEXT, archetype TEXT, faction TEXT,
      level INTEGER DEFAULT 1, is_conscious INTEGER DEFAULT 0, is_immortal INTEGER DEFAULT 0,
      current_location TEXT, spawn_location TEXT, state TEXT,
      wealth_sparks REAL DEFAULT 0, last_tick_at INTEGER
    );
  `);
  return db;
}

function makeAgents(db, n) {
  const agents = [];
  for (let i = 0; i < n; i++) {
    const id = `npc-${i}`;
    db.prepare(
      "INSERT INTO world_npcs (id, world_id, npc_type, archetype, current_location, state) VALUES (?, 'w1', 'generic', 'generic', ?, '{}')",
    ).run(id, JSON.stringify({ x: 0, y: 0, z: 0 }));
    const row = db.prepare("SELECT * FROM world_npcs WHERE id = ?").get(id);
    agents.push(new NPCAgent(row, "w1", db, async () => ({ handle: { generate: async () => "" } })));
  }
  return agents;
}

describe("settleInBatches", () => {
  it("runs every item and lets a macrotask in between batches", async () => {
    const seen = [];
    let macrotaskRanAt = -1;
    setImmediate(() => { macrotaskRanAt = seen.length; });
    await settleInBatches([...Array(10).keys()], async (i) => { seen.push(i); }, 4);
    assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.ok(macrotaskRanAt > 0 && macrotaskRanAt < 10, `macrotask ran mid-way (after ${macrotaskRanAt} items)`);
  });

  it("does not yield at all for a single batch", async () => {
    let macrotaskRan = false;
    setImmediate(() => { macrotaskRan = true; });
    await settleInBatches([1, 2, 3], async () => {}, 10);
    assert.equal(macrotaskRan, false);
  });

  it("a rejected item does not stop the rest", async () => {
    const seen = [];
    await settleInBatches([1, 2, 3, 4], async (i) => { if (i === 2) throw new Error("boom"); seen.push(i); }, 2);
    assert.deepEqual(seen, [1, 3, 4]);
  });
});

describe("NPCSimulator#tick overlap guard", () => {
  it("skips a tick while the previous one is still running", async () => {
    const sim = new NPCSimulator("w1", setupDb(), async () => null);
    let runs = 0;
    let release;
    sim._tickWorld = () => { runs += 1; return new Promise((r) => { release = r; }); };
    const first = sim.tick();
    await sim.tick();
    assert.equal(runs, 1, "second tick must not start while the first runs");
    assert.equal(sim._skippedTicks, 1);
    release();
    await first;
    const third = sim.tick();
    release();
    await third;
    assert.equal(runs, 2, "a tick after the first finished runs normally");
  });

  it("clears the guard when a tick throws", async () => {
    const sim = new NPCSimulator("w1", setupDb(), async () => null);
    let runs = 0;
    sim._tickWorld = async () => { runs += 1; throw new Error("tick failed"); };
    await assert.rejects(sim.tick());
    await assert.rejects(sim.tick());
    assert.equal(runs, 2);
  });
});

describe("NPCSimulator#_flushPendingPersists slices", () => {
  it("flushes at most maxRows and reports what is left", () => {
    const db = setupDb();
    const sim = new NPCSimulator("w1", db, async () => null);
    sim._agents = makeAgents(db, 5);
    for (const a of sim._agents) { a.location = { x: 7, y: 0, z: 7 }; a._persistState(); }

    assert.equal(sim._flushPendingPersists(2), 3);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM world_npcs WHERE last_tick_at IS NOT NULL").get().c, 2);
    assert.equal(sim._flushPendingPersists(2), 1);
    assert.equal(sim._flushPendingPersists(2), 0);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM world_npcs WHERE last_tick_at IS NOT NULL").get().c, 5);
    assert.equal(sim._flushPendingPersists(2), 0, "empty queue returns 0");
  });

  it("no argument still flushes everything in one call", () => {
    const db = setupDb();
    const sim = new NPCSimulator("w1", db, async () => null);
    sim._agents = makeAgents(db, 4);
    for (const a of sim._agents) a._persistState();
    assert.equal(sim._flushPendingPersists(), 0);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM world_npcs WHERE last_tick_at IS NOT NULL").get().c, 4);
  });

  it("drops a slice whose write fails, so the flush loop ends", () => {
    const db = setupDb();
    const sim = new NPCSimulator("w1", db, async () => null);
    sim._agents = makeAgents(db, 3);
    for (const a of sim._agents) a._persistState();
    db.exec("DROP TABLE world_npcs");
    assert.equal(sim._flushPendingPersists(2), 1);
    assert.equal(sim._flushPendingPersists(2), 0);
    assert.ok(sim._agents.every((a) => a._pendingPersist === null));
  });
});
