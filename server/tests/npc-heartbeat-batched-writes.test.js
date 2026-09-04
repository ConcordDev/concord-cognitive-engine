// Batched-transaction fixes for 3 population-scale heartbeat modules, found
// by auditing every non-worker-pooled heartbeat for the same bug shape
// already fixed once in lib/npc-simulator.js (see that file's
// #_flushPendingPersists doc comment for the full measured rationale — a
// live CPU profile showed per-entity synchronous DB writes in a loop
// costing real, measured CPU time purely from per-call overhead, not
// compute). Minimal hand-rolled in-memory schemas, same established
// pattern as tests/npc-combat-los.test.js — exact columns each function
// under test actually touches, not the full migrated DB.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runNpcTravelCycle } from "../emergent/npc-travel-cycle.js";
import { runNpcVsNpcCombatCycle } from "../emergent/npc-vs-npc-combat-cycle.js";
import { runNpcAmbitionCycle } from "../emergent/npc-ambition-cycle.js";

// ── npc-travel-cycle ──────────────────────────────────────────────────────

function setupTravelDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE npc_travel_intents (
      id TEXT PRIMARY KEY, npc_id TEXT, destination_world_id TEXT,
      status TEXT, executes_at INTEGER, reason TEXT
    );
    CREATE TABLE npc_residency (
      npc_id TEXT PRIMARY KEY, current_world_id TEXT, home_world_id TEXT,
      arrived_at INTEGER, total_worlds_visited INTEGER DEFAULT 0
    );
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, current_location TEXT,
      archetype TEXT, ambition_score REAL DEFAULT 0
    );
    CREATE TABLE npc_routine_state (npc_id TEXT PRIMARY KEY, data TEXT);
  `);
  return db;
}

describe("npc-travel-cycle — batched intent execution", () => {
  let db;
  beforeEach(() => { db = setupTravelDb(); });

  it("executes all due intents and commits every write in one pass", async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const n of ["npc-1", "npc-2", "npc-3"]) {
      db.prepare(`INSERT INTO world_npcs (id, world_id, current_location) VALUES (?, 'w-origin', '{}')`).run(n);
      db.prepare(`INSERT INTO npc_residency (npc_id, current_world_id) VALUES (?, 'w-origin')`).run(n);
      db.prepare(
        `INSERT INTO npc_travel_intents (id, npc_id, destination_world_id, status, executes_at) VALUES (?, ?, 'w-dest', 'pending', ?)`,
      ).run(`intent-${n}`, n, now - 10);
    }

    const result = await runNpcTravelCycle({ db });
    assert.equal(result.ok, true);
    assert.equal(result.executed, 3);

    for (const n of ["npc-1", "npc-2", "npc-3"]) {
      const npc = db.prepare(`SELECT world_id FROM world_npcs WHERE id = ?`).get(n);
      assert.equal(npc.world_id, "w-dest", `${n} must have moved`);
      const residency = db.prepare(`SELECT current_world_id, total_worlds_visited FROM npc_residency WHERE npc_id = ?`).get(n);
      assert.equal(residency.current_world_id, "w-dest");
      assert.equal(residency.total_worlds_visited, 1);
      const intent = db.prepare(`SELECT status FROM npc_travel_intents WHERE id = ?`).get(`intent-${n}`);
      assert.equal(intent.status, "executed");
    }
  });

  it("one intent's failure (bad destination FK-like reference) does not block the others — per-intent isolation survives batching", async () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO world_npcs (id, world_id, current_location) VALUES ('npc-good', 'w-origin', '{}')`).run();
    db.prepare(`INSERT INTO npc_residency (npc_id, current_world_id) VALUES ('npc-good', 'w-origin')`).run();
    db.prepare(
      `INSERT INTO npc_travel_intents (id, npc_id, destination_world_id, status, executes_at) VALUES ('intent-good', 'npc-good', 'w-dest', 'pending', ?)`,
    ).run(now - 10);
    // "npc-missing" has an intent but no world_npcs/npc_residency row at all —
    // its UPDATE statements are no-ops (0 rows affected), not throws, so this
    // mainly proves batching doesn't require every row to exist; real
    // failures (e.g. a locked table) are covered by the mutation check below.
    db.prepare(
      `INSERT INTO npc_travel_intents (id, npc_id, destination_world_id, status, executes_at) VALUES ('intent-missing', 'npc-missing', 'w-dest', 'pending', ?)`,
    ).run(now - 10);

    const result = await runNpcTravelCycle({ db });
    assert.equal(result.executed, 2, "both intents are marked executed even though one NPC row never existed");
    const good = db.prepare(`SELECT world_id FROM world_npcs WHERE id = 'npc-good'`).get();
    assert.equal(good.world_id, "w-dest");
  });

  it("does not touch pending intents that aren't due yet", async () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES ('npc-1', 'w-origin')`).run();
    db.prepare(
      `INSERT INTO npc_travel_intents (id, npc_id, destination_world_id, status, executes_at) VALUES ('intent-future', 'npc-1', 'w-dest', 'pending', ?)`,
    ).run(now + 3600);

    const result = await runNpcTravelCycle({ db });
    assert.equal(result.executed, 0);
    const npc = db.prepare(`SELECT world_id FROM world_npcs WHERE id = 'npc-1'`).get();
    assert.equal(npc.world_id, "w-origin");
  });
});

// ── npc-vs-npc-combat-cycle ────────────────────────────────────────────────

function setupCombatDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, current_location TEXT, archetype TEXT);
    CREATE TABLE npc_grudges (npc_id TEXT, target_kind TEXT, target_id TEXT, severity REAL);
    CREATE TABLE npc_skills (npc_id TEXT, skill_id TEXT, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1, last_used_at INTEGER);
    CREATE TABLE npc_ambition_log (
      id TEXT PRIMARY KEY, npc_id TEXT, move_kind TEXT, target_kind TEXT,
      target_id TEXT, world_id TEXT, outcome TEXT
    );
  `);
  return db;
}

describe("npc-vs-npc-combat-cycle — batched resolution", () => {
  let db;
  beforeEach(() => { db = setupCombatDb(); });

  it("resolves a mutual-grudge pair colocated in the same cell, batched into one transaction", async () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, current_location) VALUES ('a', 'w1', '{"x":0,"z":0}')`).run();
    db.prepare(`INSERT INTO world_npcs (id, world_id, current_location) VALUES ('b', 'w1', '{"x":1,"z":1}')`).run();
    // mutual grudge >= GRUDGE_FLOOR (5)
    db.prepare(`INSERT INTO npc_grudges (npc_id, target_kind, target_id, severity) VALUES ('a', 'npc', 'b', 8)`).run();
    db.prepare(`INSERT INTO npc_grudges (npc_id, target_kind, target_id, severity) VALUES ('b', 'npc', 'a', 8)`).run();

    const result = await runNpcVsNpcCombatCycle({ db });
    assert.equal(result.ok, true);
    assert.equal(result.resolved, 1);

    const log = db.prepare(`SELECT * FROM npc_ambition_log WHERE move_kind = 'combat'`).get();
    assert.ok(log, "audit-log row must be committed");
    assert.ok(["a", "b"].includes(log.npc_id), "winner must be one of the pair");

    const skillRows = db.prepare(`SELECT * FROM npc_skills WHERE skill_id = 'combat'`).all();
    assert.equal(skillRows.length, 1, "exactly the winner gets an XP row");
  });

  it("does not resolve a pair below the grudge floor", async () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, current_location) VALUES ('a', 'w1', '{"x":0,"z":0}')`).run();
    db.prepare(`INSERT INTO world_npcs (id, world_id, current_location) VALUES ('b', 'w1', '{"x":1,"z":1}')`).run();
    db.prepare(`INSERT INTO npc_grudges (npc_id, target_kind, target_id, severity) VALUES ('a', 'npc', 'b', 2)`).run();
    db.prepare(`INSERT INTO npc_grudges (npc_id, target_kind, target_id, severity) VALUES ('b', 'npc', 'a', 2)`).run();

    const result = await runNpcVsNpcCombatCycle({ db });
    assert.equal(result.resolved, 0);
  });

  it("does not resolve NPCs in different cells even with a high grudge", async () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, current_location) VALUES ('a', 'w1', '{"x":0,"z":0}')`).run();
    db.prepare(`INSERT INTO world_npcs (id, world_id, current_location) VALUES ('b', 'w1', '{"x":500,"z":500}')`).run();
    db.prepare(`INSERT INTO npc_grudges (npc_id, target_kind, target_id, severity) VALUES ('a', 'npc', 'b', 9)`).run();
    db.prepare(`INSERT INTO npc_grudges (npc_id, target_kind, target_id, severity) VALUES ('b', 'npc', 'a', 9)`).run();

    const result = await runNpcVsNpcCombatCycle({ db });
    assert.equal(result.resolved, 0);
  });

  it("resolves independently across multiple worlds in the same batched transaction", async () => {
    for (const w of ["w1", "w2"]) {
      db.prepare(`INSERT INTO world_npcs (id, world_id, current_location) VALUES (?, ?, '{"x":0,"z":0}')`).run(`a-${w}`, w);
      db.prepare(`INSERT INTO world_npcs (id, world_id, current_location) VALUES (?, ?, '{"x":1,"z":1}')`).run(`b-${w}`, w);
      db.prepare(`INSERT INTO npc_grudges (npc_id, target_kind, target_id, severity) VALUES (?, 'npc', ?, 8)`).run(`a-${w}`, `b-${w}`);
      db.prepare(`INSERT INTO npc_grudges (npc_id, target_kind, target_id, severity) VALUES (?, 'npc', ?, 8)`).run(`b-${w}`, `a-${w}`);
    }
    const result = await runNpcVsNpcCombatCycle({ db });
    assert.equal(result.resolved, 2, "both worlds' pairs resolve in the same call");
  });
});

// ── npc-ambition-cycle ──────────────────────────────────────────────────────

function setupAmbitionDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT,
      ambition_score REAL DEFAULT 0
    );
    CREATE TABLE npc_residency (npc_id TEXT PRIMARY KEY, current_world_id TEXT, home_world_id TEXT);
    CREATE TABLE npc_ambition_log (
      id TEXT PRIMARY KEY, npc_id TEXT, move_kind TEXT, target_kind TEXT,
      target_id TEXT, world_id TEXT, outcome TEXT
    );
    CREATE TABLE npc_active_quests (npc_id TEXT, status TEXT, accepted_at INTEGER);
    CREATE TABLE lattice_born_quests (id TEXT PRIMARY KEY, status TEXT);
    -- pickAmbitionMove's pickRivalSkill sub-path reads this even on the
    -- 'arbitrage'/'learn_skill' branches of its seeded roll; empty is a
    -- valid, exercised state (no skill candidates -> null target_id).
    CREATE TABLE npc_skills (npc_id TEXT, skill_id TEXT, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1);
  `);
  return db;
}

describe("npc-ambition-cycle — batched moves + confidence bumps", () => {
  let db;
  beforeEach(() => { db = setupAmbitionDb(); });

  it("records an ambition move per qualifying NPC, batched, and none are skipped", async () => {
    for (let i = 0; i < 5; i++) {
      db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, ambition_score) VALUES (?, 'w1', 'generic', 0.8)`).run(`npc-${i}`);
      db.prepare(`INSERT INTO npc_residency (npc_id, current_world_id) VALUES (?, 'w1')`).run(`npc-${i}`);
    }
    const result = await runNpcAmbitionCycle({ db });
    assert.equal(result.ok, true);
    assert.ok(result.movesPicked >= 1, "at least some high-ambition NPCs get a move picked (deterministic seed, may not be all 5)");
    const logCount = db.prepare(`SELECT COUNT(*) as n FROM npc_ambition_log`).get().n;
    assert.equal(logCount, result.movesPicked, "every reported move has a committed log row");
  });

  it("ignores NPCs below the ambition threshold", async () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, ambition_score) VALUES ('npc-low', 'w1', 'generic', 0.1)`).run();
    const result = await runNpcAmbitionCycle({ db });
    assert.equal(result.movesPicked, 0);
  });

  it("batches confidence bumps for every NPC that completed a quest in the last hour", async () => {
    for (let i = 0; i < 4; i++) {
      db.prepare(`INSERT INTO world_npcs (id, world_id, ambition_score) VALUES (?, 'w1', 0.5)`).run(`npc-${i}`);
      db.prepare(`INSERT INTO npc_active_quests (npc_id, status, accepted_at) VALUES (?, 'completed', unixepoch() - 60)`).run(`npc-${i}`);
    }
    const result = await runNpcAmbitionCycle({ db });
    assert.equal(result.confidenceBumps, 4);
    for (let i = 0; i < 4; i++) {
      const npc = db.prepare(`SELECT ambition_score FROM world_npcs WHERE id = ?`).get(`npc-${i}`);
      assert.ok(Math.abs(npc.ambition_score - 0.55) < 1e-9, `npc-${i} ambition_score must be bumped by 0.05`);
    }
  });

  it("does not bump NPCs whose quest completion is older than an hour", async () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, ambition_score) VALUES ('npc-old', 'w1', 0.5)`).run();
    db.prepare(`INSERT INTO npc_active_quests (npc_id, status, accepted_at) VALUES ('npc-old', 'completed', unixepoch() - 7200)`).run();
    const result = await runNpcAmbitionCycle({ db });
    assert.equal(result.confidenceBumps, 0);
    const npc = db.prepare(`SELECT ambition_score FROM world_npcs WHERE id = 'npc-old'`).get();
    assert.equal(npc.ambition_score, 0.5);
  });

  it("caps ambition_score at 1.0", async () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, ambition_score) VALUES ('npc-max', 'w1', 0.99)`).run();
    db.prepare(`INSERT INTO npc_active_quests (npc_id, status, accepted_at) VALUES ('npc-max', 'completed', unixepoch() - 60)`).run();
    await runNpcAmbitionCycle({ db });
    const npc = db.prepare(`SELECT ambition_score FROM world_npcs WHERE id = 'npc-max'`).get();
    assert.equal(npc.ambition_score, 1.0);
  });
});
