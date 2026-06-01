// Concord Link L3 — Realm Overview: faction graph + stances + recent moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { buildRealmOverview } from "../lib/realm-overview.js";

function db0() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE faction_strategy_state (faction_id TEXT PRIMARY KEY, stance TEXT, target_id TEXT, phase INTEGER, next_move_at INTEGER, momentum REAL, last_move_id TEXT);
    CREATE TABLE faction_relations (faction_a TEXT, faction_b TEXT, score REAL, kind TEXT, PRIMARY KEY(faction_a, faction_b));
    CREATE TABLE faction_strategy_log (faction_id TEXT, move TEXT, target_id TEXT, at INTEGER);
  `);
  db.prepare("INSERT INTO faction_strategy_state VALUES ('ashen','war','iron',2,0,-0.7,'m1')").run();
  db.prepare("INSERT INTO faction_strategy_state VALUES ('iron','expand','ashen',1,0,0.3,'m2')").run();
  db.prepare("INSERT INTO faction_strategy_state VALUES ('verdant','consolidate',NULL,0,0,0.05,NULL)").run();
  db.prepare("INSERT INTO faction_relations VALUES ('ashen','iron',-0.9,'war')").run();
  db.prepare("INSERT INTO faction_relations VALUES ('iron','verdant',0.6,'alliance')").run();
  db.prepare("INSERT INTO faction_relations VALUES ('ashen','verdant',0.0,'neutral')").run();
  db.prepare("INSERT INTO faction_strategy_log VALUES ('ashen','DECLARE_WAR','iron',100)").run();
  db.prepare("INSERT INTO faction_strategy_log VALUES ('iron','RAID','ashen',105)").run();
  return db;
}

test("overview returns the political graph: stances, non-neutral relations, recent moves", () => {
  const o = buildRealmOverview(db0());
  assert.equal(o.ok, true);
  assert.equal(o.factions.length, 3);
  assert.equal(o.factions[0].factionId, "ashen", "highest |momentum| first");
  assert.equal(o.relations.length, 2, "neutral relations excluded from the global view");
  assert.ok(o.relations.find((r) => r.kind === "war"));
  assert.equal(o.recentMoves[0].move, "RAID", "most recent first (by timestamp)");
});

test("factionId focuses one faction's neighbourhood", () => {
  const o = buildRealmOverview(db0(), { factionId: "verdant" });
  assert.ok(o.factions.every((f) => f.factionId === "verdant" || f.target === "verdant"));
  assert.ok(o.relations.every((r) => r.a === "verdant" || r.b === "verdant"));
  assert.ok(o.recentMoves.every((m) => m.factionId === "verdant"));
});

test("graceful on missing tables", () => {
  const o = buildRealmOverview(new Database(":memory:"));
  assert.equal(o.ok, true);
  assert.deepEqual(o.factions, []);
  assert.equal(buildRealmOverview(null).ok, false);
});
