// INC-100d — npc-vs-npc-combat-cycle blocked the event loop ~0.5-0.6 s every
// ~2 min. heartbeats[] on event_loop_burst_lag (INC-100c) named it in every
// ~480-550 ms burst window on 2026-10-19; a prod DB clone reproduced 590 ms
// per run: 37,718 colocated pairs x two prepare()+get() grudge reads, while
// only 876 grudge rows exist. The fix preloads the grudge graph once per
// cycle and drops occupants with no grudge before pairing. These tests pin
// (1) behaviour parity and (2) that the statement count no longer scales
// with colocated pairs.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runNpcVsNpcCombatCycle } from "../emergent/npc-vs-npc-combat-cycle.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, current_location TEXT, archetype TEXT);
    CREATE TABLE npc_grudges (npc_id TEXT, target_kind TEXT, target_id TEXT, severity REAL);
    CREATE TABLE npc_skills (npc_id TEXT, skill_id TEXT, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1, last_used_at INTEGER);
    CREATE TABLE npc_ambition_log (id TEXT PRIMARY KEY, npc_id TEXT, move_kind TEXT, target_kind TEXT, target_id TEXT, world_id TEXT, outcome TEXT);
  `);
  return db;
}
const npc = (db, id, w, x, z) =>
  db.prepare(`INSERT INTO world_npcs (id, world_id, current_location) VALUES (?, ?, ?)`).run(id, w, JSON.stringify({ x, z }));
const grudge = (db, a, b, s, kind = "npc") =>
  db.prepare(`INSERT INTO npc_grudges (npc_id, target_kind, target_id, severity) VALUES (?, ?, ?, ?)`).run(a, kind, b, s);

function countingDb(db) {
  let prepares = 0;
  const orig = db.prepare.bind(db);
  db.prepare = (sql) => { prepares++; return orig(sql); };
  return { db, count: () => prepares };
}

describe("INC-100d npc-vs-npc-combat grudge preload", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("resolves only mutual, colocated, >= floor NPC grudges", async () => {
    npc(db, "a", "w1", 0, 0); npc(db, "b", "w1", 10, 10);   // same cell, mutual 8/6 -> fight (grudge 6)
    npc(db, "c", "w1", 1, 1); npc(db, "d", "w1", 2, 2);     // same cell, one-sided -> no fight
    npc(db, "e", "w1", 3, 3); npc(db, "f", "w1", 4, 4);     // same cell, mutual 4 -> below floor
    npc(db, "g", "w1", 0, 0); npc(db, "h", "w1", 500, 500); // mutual 9 but different cells
    npc(db, "i", "w2", 0, 0); npc(db, "j", "w2", 0, 0);     // player/faction grudges ignored
    grudge(db, "a", "b", 8); grudge(db, "b", "a", 6);
    grudge(db, "c", "d", 9);
    grudge(db, "e", "f", 4); grudge(db, "f", "e", 4);
    grudge(db, "g", "h", 9); grudge(db, "h", "g", 9);
    grudge(db, "i", "j", 9, "player"); grudge(db, "j", "i", 9, "faction");

    const r = await runNpcVsNpcCombatCycle({ db });
    assert.deepEqual(r, { ok: true, resolved: 1 });
    const logs = db.prepare(`SELECT npc_id, target_id, world_id, outcome FROM npc_ambition_log`).all();
    assert.equal(logs.length, 1);
    assert.deepEqual(new Set([logs[0].npc_id, logs[0].target_id]), new Set(["a", "b"]));
    // damage = floor(20 + grudge*4 + |powerA-powerB|*1.5) with grudge = min(8,6) = 6, equal power 1
    assert.equal(logs[0].outcome, "damage=44");
  });

  it("higher-level NPC wins", async () => {
    npc(db, "a", "w1", 0, 0); npc(db, "b", "w1", 0, 0);
    grudge(db, "a", "b", 7); grudge(db, "b", "a", 7);
    db.prepare(`INSERT INTO npc_skills (npc_id, skill_id, level) VALUES ('b', 'sword', 5)`).run();
    await runNpcVsNpcCombatCycle({ db });
    assert.equal(db.prepare(`SELECT npc_id FROM npc_ambition_log`).get().npc_id, "b");
  });

  it("statement count does not scale with colocated pairs (no grudges among a 300-NPC crowd)", async () => {
    for (let k = 0; k < 300; k++) npc(db, `n${k}`, "w1", 1, 1); // 44,850 colocated pairs
    npc(db, "x", "w1", 1, 1); npc(db, "y", "w1", 1, 1);
    grudge(db, "x", "y", 6); grudge(db, "y", "x", 6);
    const c = countingDb(db);
    const t = performance.now();
    const r = await runNpcVsNpcCombatCycle({ db: c.db });
    const ms = performance.now() - t;
    assert.equal(r.resolved, 1);
    assert.ok(c.count() < 25, `expected a constant number of prepare() calls, got ${c.count()}`);
    assert.ok(ms < 250, `cycle took ${ms.toFixed(0)} ms`);
  });

  it("no grudge table / no grudges -> honest zero, no throw", async () => {
    npc(db, "a", "w1", 0, 0); npc(db, "b", "w1", 0, 0);
    assert.deepEqual(await runNpcVsNpcCombatCycle({ db }), { ok: true, resolved: 0 });
    db.exec(`DROP TABLE npc_grudges`);
    assert.deepEqual(await runNpcVsNpcCombatCycle({ db }), { ok: true, resolved: 0 });
  });
});
