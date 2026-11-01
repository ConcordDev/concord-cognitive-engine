// #1938 syncIo named three slow SQLite calls at boot. Pins their fixes:
//  - migration 494 adds idx_dtus_content_hash + idx_dtus_type_world and the two
//    queries plan onto them (a full scan was 1.5-2 s on the live table);
//  - NPCAgent._executeAction no longer does a per-action UPDATE; the activity is
//    queued and written by NPCSimulator._flushPendingPersists in its one transaction.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { up } from "../migrations/494_dtus_hot_lookup_indexes.js";
import { NPCAgent, NPCSimulator } from "../lib/npc-simulator.js";

const plan = (db, sql, ...args) =>
  db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail).join(" | ");

describe("migration 494: dtus hot-lookup indexes", () => {
  it("creates both indexes and the slow queries plan onto them", async () => {
    const db = new Database(":memory:");
    await runMigrations(db);
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='dtus'").all().map((r) => r.name);
    assert.ok(names.includes("idx_dtus_content_hash"));
    assert.ok(names.includes("idx_dtus_type_world"));
    assert.match(plan(db, "SELECT id FROM dtus WHERE content_hash = ? LIMIT 1", "h"), /USING (COVERING )?INDEX idx_dtus_content_hash/);
    assert.match(
      plan(db, "SELECT * FROM dtus WHERE type = 'concordia_creation' AND world_id = ? LIMIT 5", "w"),
      /USING INDEX idx_dtus_type_world \(type=\? AND world_id=\?\)/,
    );
  });

  it("is idempotent and tolerates a DB without the columns", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE dtus (id TEXT PRIMARY KEY)");
    assert.doesNotThrow(() => up(db)); // no content_hash/type/world_id: skipped
    db.exec("ALTER TABLE dtus ADD COLUMN content_hash TEXT");
    up(db); up(db);
    assert.equal(db.prepare("SELECT count(*) c FROM sqlite_master WHERE name='idx_dtus_content_hash'").get().c, 1);
  });
});

function npcDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE world_npcs (
    id TEXT PRIMARY KEY, world_id TEXT, npc_type TEXT, archetype TEXT, faction TEXT,
    level INTEGER DEFAULT 1, xp INTEGER NOT NULL DEFAULT 0, is_conscious INTEGER DEFAULT 0, is_immortal INTEGER DEFAULT 0,
    current_location TEXT, spawn_location TEXT, state TEXT, wealth_sparks REAL DEFAULT 0, last_tick_at INTEGER,
    current_activity TEXT)`);
  db.prepare("INSERT INTO world_npcs (id, world_id, npc_type, archetype, current_location, state) VALUES ('n1','w','generic','generic','{}','{}')").run();
  return db;
}
const agentFor = (db) => new NPCAgent(db.prepare("SELECT * FROM world_npcs WHERE id='n1'").get(), "w", db, async () => ({ handle: { generate: async () => "" } }));
const activityOf = (db) => db.prepare("SELECT current_activity a FROM world_npcs WHERE id='n1'").get().a;

describe("NPC activity write is batched", () => {
  it("_executeAction queues the activity instead of writing it", async () => {
    const db = npcDb();
    const agent = agentFor(db);
    await agent._executeAction({ action: "rest" });
    assert.equal(activityOf(db), null, "no synchronous per-action UPDATE");
    assert.equal(agent._pendingActivity, "resting");
  });

  it("the world-tick flush writes it once, inside the batched transaction", async () => {
    const db = npcDb();
    const agent = agentFor(db);
    await agent._executeAction({ action: "gather_resource", target: null });
    agent._persistState();
    const sim = Object.create(NPCSimulator.prototype);
    sim._db = db; sim.worldId = "w"; sim._agents = [agent];
    sim._flushPendingPersists();
    assert.equal(activityOf(db), "gathering");
    assert.equal(agent._pendingActivity, null);
  });

  it("a DB without current_activity still flushes the rest of the row", async () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, npc_type TEXT, archetype TEXT, faction TEXT,
      level INTEGER DEFAULT 1, xp INTEGER NOT NULL DEFAULT 0, is_conscious INTEGER DEFAULT 0, is_immortal INTEGER DEFAULT 0,
      current_location TEXT, spawn_location TEXT, state TEXT, wealth_sparks REAL DEFAULT 0, last_tick_at INTEGER)`);
    db.prepare("INSERT INTO world_npcs (id, world_id, npc_type, archetype, current_location, state) VALUES ('n1','w','generic','generic','{}','{}')").run();
    const agent = agentFor(db);
    await agent._executeAction({ action: "rest" });
    agent._persistState();
    const sim = Object.create(NPCSimulator.prototype);
    sim._db = db; sim.worldId = "w"; sim._agents = [agent];
    sim._flushPendingPersists();
    assert.ok(db.prepare("SELECT last_tick_at t FROM world_npcs WHERE id='n1'").get().t != null);
  });
});
