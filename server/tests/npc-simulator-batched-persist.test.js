// NPCAgent#_persistState + NPCSimulator#_flushPendingPersists — batched
// world-tick state persistence.
//
// Real production finding, 2026-08-23: a live CPU profile on the deploy pod
// (taken while investigating an event-loop-lag bug that was intermittently
// 503-ing login/register) showed lib/npc-simulator.js's per-tick work as
// ~38% of all CPU time in a 2-minute sample, with each NPCAgent committing
// its own `_persistState()` write as a SEPARATE, immediate better-sqlite3
// call — real per-statement overhead (WAL frame write + lock acquisition)
// paid once per agent per tick instead of once per world-tick.
//
// The fix: _persistState() now QUEUES the computed write instead of
// executing it; NPCSimulator flushes every agent's queued write in ONE
// transaction at the very end of tick() (_flushPendingPersists). These
// tests pin the new two-phase contract directly — compute-then-queue,
// deferred-until-flush, batched-not-per-agent — without needing the full
// NPCSimulator.tick() machinery (brain selection, world seeding, etc.),
// matching tests/npc-combat-los.test.js's established in-memory-DB pattern
// for this file.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { NPCAgent, NPCSimulator } from "../lib/npc-simulator.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id               TEXT PRIMARY KEY,
      world_id         TEXT,
      npc_type         TEXT,
      archetype        TEXT,
      faction          TEXT,
      level            INTEGER DEFAULT 1,
      is_conscious     INTEGER DEFAULT 0,
      is_immortal      INTEGER DEFAULT 0,
      current_location TEXT,
      spawn_location   TEXT,
      state            TEXT,
      wealth_sparks    REAL DEFAULT 0,
      last_tick_at     INTEGER
    );
  `);
  return db;
}

function seedNpc(db, id, worldId, opts = {}) {
  db.prepare(
    `INSERT INTO world_npcs (id, world_id, npc_type, archetype, current_location, state)
     VALUES (?, ?, 'generic', 'generic', ?, ?)`,
  ).run(id, worldId, JSON.stringify(opts.location || { x: 0, y: 0, z: 0 }), JSON.stringify(opts.state || {}));
  return db.prepare("SELECT * FROM world_npcs WHERE id = ?").get(id);
}

function makeAgent(db, worldId, id, opts = {}) {
  const row = seedNpc(db, id, worldId, opts);
  return new NPCAgent(row, worldId, db, async () => ({ handle: { generate: async () => "" } }));
}

describe("NPCAgent#_persistState — queues, does not write immediately", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("does NOT touch the DB row when called directly", () => {
    const agent = makeAgent(db, "w1", "npc-1", { location: { x: 1, y: 0, z: 1 } });
    agent.needs = { hunger: 0.5 };
    agent.location = { x: 99, y: 0, z: 99 };

    agent._persistState();

    const row = db.prepare("SELECT current_location, last_tick_at FROM world_npcs WHERE id = ?").get("npc-1");
    assert.equal(row.current_location, JSON.stringify({ x: 1, y: 0, z: 1 }), "DB row must be unchanged — write is queued, not immediate");
    assert.equal(row.last_tick_at, null);
  });

  it("computes and queues the correct pending write on the instance", () => {
    const agent = makeAgent(db, "w1", "npc-1");
    agent.needs = { hunger: 0.42 };
    agent.goals = [{ directive: "eat" }];
    agent.currentActivity = "gathering";
    agent.location = { x: 5, y: 0, z: 7 };

    agent._persistState();

    assert.ok(agent._pendingPersist, "must set _pendingPersist");
    const state = JSON.parse(agent._pendingPersist.stateJson);
    assert.deepEqual(state.needs, { hunger: 0.42 });
    assert.deepEqual(state.goals, [{ directive: "eat" }]);
    assert.equal(state.currentActivity, "gathering");
    assert.deepEqual(JSON.parse(agent._pendingPersist.locationJson), { x: 5, y: 0, z: 7 });
  });

  it("a second _persistState() call overwrites the pending write (last-write-wins pre-flush, matches prior per-call semantics)", () => {
    const agent = makeAgent(db, "w1", "npc-1");
    agent.needs = { hunger: 0.1 };
    agent._persistState();
    agent.needs = { hunger: 0.9 };
    agent._persistState();

    const state = JSON.parse(agent._pendingPersist.stateJson);
    assert.deepEqual(state.needs, { hunger: 0.9 });
  });
});

describe("NPCSimulator#_flushPendingPersists — batches queued writes into one transaction", () => {
  let db, sim;
  beforeEach(() => {
    db = setupDb();
    sim = new NPCSimulator("w1", db, async () => ({ handle: { generate: async () => "" } }));
  });

  it("writes every agent with a pending persist, in one transaction, and clears the flag", () => {
    const a1 = makeAgent(db, "w1", "npc-1", { location: { x: 0, y: 0, z: 0 } });
    const a2 = makeAgent(db, "w1", "npc-2", { location: { x: 0, y: 0, z: 0 } });
    sim._agents = [a1, a2];

    a1.needs = { hunger: 0.3 };
    a1.location = { x: 10, y: 0, z: 20 };
    a1._persistState();

    a2.needs = { hunger: 0.7 };
    a2.location = { x: 30, y: 0, z: 40 };
    a2._persistState();

    sim._flushPendingPersists();

    const row1 = db.prepare("SELECT state, current_location, last_tick_at FROM world_npcs WHERE id = ?").get("npc-1");
    const row2 = db.prepare("SELECT state, current_location, last_tick_at FROM world_npcs WHERE id = ?").get("npc-2");
    assert.deepEqual(JSON.parse(row1.state).needs, { hunger: 0.3 });
    assert.deepEqual(JSON.parse(row1.current_location), { x: 10, y: 0, z: 20 });
    assert.ok(row1.last_tick_at, "last_tick_at must be stamped");
    assert.deepEqual(JSON.parse(row2.state).needs, { hunger: 0.7 });
    assert.deepEqual(JSON.parse(row2.current_location), { x: 30, y: 0, z: 40 });

    assert.equal(a1._pendingPersist, null, "pending flag must clear after flush");
    assert.equal(a2._pendingPersist, null);
  });

  it("applies queued wealth income in the SAME flush as state/location (folded together, 2026-08-23 follow-up)", () => {
    const a1 = makeAgent(db, "w1", "npc-1");
    db.prepare("UPDATE world_npcs SET wealth_sparks = 10 WHERE id = 'npc-1'").run();
    a1._pendingWealthIncome = 4.0; // e.g. wealthIncomeFor('blacksmith')
    a1._persistState();

    sim._agents = [a1];
    sim._flushPendingPersists();

    const row = db.prepare("SELECT wealth_sparks FROM world_npcs WHERE id = 'npc-1'").get();
    assert.equal(row.wealth_sparks, 14.0, "10 (existing) + 4.0 (queued income)");
    assert.equal(a1._pendingWealthIncome, 0, "must reset to 0 after flush, not stay stale for the next tick");
  });

  it("an agent with a pending persist but zero queued wealth (e.g. a conscious emergent via tickConscious) does not change wealth_sparks", () => {
    const a1 = makeAgent(db, "w1", "npc-1");
    db.prepare("UPDATE world_npcs SET wealth_sparks = 7 WHERE id = 'npc-1'").run();
    // a1._pendingWealthIncome stays at its constructor default (0) — no
    // accumulateWealth-equivalent call this tick, matching tickConscious()'s
    // real code path, which never queues wealth income.
    a1._persistState();
    sim._agents = [a1];
    sim._flushPendingPersists();

    const row = db.prepare("SELECT wealth_sparks FROM world_npcs WHERE id = 'npc-1'").get();
    assert.equal(row.wealth_sparks, 7, "unchanged — a zero-income flush must not perturb existing wealth");
  });

  it("skips agents with no pending persist — a tick where an agent never called _persistState() leaves its row untouched", () => {
    const a1 = makeAgent(db, "w1", "npc-1", { location: { x: 1, y: 0, z: 1 } });
    const a2 = makeAgent(db, "w1", "npc-2", { location: { x: 2, y: 0, z: 2 } });
    sim._agents = [a1, a2];

    a1.location = { x: 99, y: 0, z: 99 };
    a1._persistState(); // only a1 queues a write

    sim._flushPendingPersists();

    const row2 = db.prepare("SELECT current_location, last_tick_at FROM world_npcs WHERE id = ?").get("npc-2");
    assert.equal(row2.current_location, JSON.stringify({ x: 2, y: 0, z: 2 }), "untouched agent's row must be unaffected");
    assert.equal(row2.last_tick_at, null, "untouched agent must not get a last_tick_at stamp");
  });

  it("is a safe no-op when nothing is pending (never throws, never opens an empty transaction)", () => {
    const a1 = makeAgent(db, "w1", "npc-1");
    sim._agents = [a1];
    assert.doesNotThrow(() => sim._flushPendingPersists());
  });

  it("mutation check: a broken flush (bad SQL) is caught and non-fatal, matching this file's try/catch convention", () => {
    const a1 = makeAgent(db, "w1", "npc-1");
    a1._persistState();
    sim._agents = [a1];
    sim._db = { prepare: () => { throw new Error("simulated DB failure"); }, transaction: (fn) => fn };
    assert.doesNotThrow(() => sim._flushPendingPersists());
  });
});

// 2026-10-22: live, 0 of 15,219 per-minute NPC row writes changed state or
// location — only wealth moved. Unchanged state/location is no longer
// re-sent; wealth + last_tick_at are still written every tick.
describe("_persistState skips unchanged state/location (2026-10-22)", () => {
  it("first persist after load writes the full row, then unchanged ticks write wealth only", () => {
    const db = setupDb();
    const sim = new NPCSimulator("w1", db, async () => ({ handle: { generate: async () => "" } }));
    const a = makeAgent(db, "w1", "n1", { state: { name: "Ann" }, location: { x: 1, y: 0, z: 2 } });
    sim._agents = [a];
    const writes = [];
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql) => { const st = origPrepare(sql); if (/^UPDATE world_npcs/.test(sql)) { const run = st.run.bind(st); return { run: (...args) => { writes.push(/state = \?/.test(sql) ? "full" : "wealth"); return run(...args); } }; } return st; };

    a._pendingWealthIncome = 2; a._persistState(); sim._flushPendingPersists();
    a._pendingWealthIncome = 3; a._persistState(); sim._flushPendingPersists();
    a.location = { x: 5, y: 0, z: 2 };
    a._pendingWealthIncome = 1; a._persistState(); sim._flushPendingPersists();
    db.prepare = origPrepare;

    assert.deepEqual(writes, ["full", "wealth", "full"]);
    const row = db.prepare("SELECT state, current_location, wealth_sparks, last_tick_at FROM world_npcs WHERE id = 'n1'").get();
    assert.equal(row.wealth_sparks, 6, "every tick's income landed");
    assert.deepEqual(JSON.parse(row.current_location), { x: 5, y: 0, z: 2 });
    assert.equal(JSON.parse(row.state).name, "Ann");
    assert.ok(row.last_tick_at > 0);
  });

  it("a failed flush does not advance the baseline, so the change is retried", () => {
    const db = setupDb();
    const sim = new NPCSimulator("w1", db, async () => ({ handle: { generate: async () => "" } }));
    const a = makeAgent(db, "w1", "n2", { state: { name: "Bo" } });
    sim._agents = [a];
    const tx = db.transaction.bind(db);
    db.transaction = () => () => { throw new Error("disk full"); };
    a._persistState(); sim._flushPendingPersists();
    db.transaction = tx;
    assert.equal(a._persistedStateJson, null);
    a._persistState();
    assert.notEqual(a._pendingPersist.stateJson, null, "change is still pending a full write");
  });
});
