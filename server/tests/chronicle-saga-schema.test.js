// GB-1538 genus piece 6 — the chronicle saga mint + list must work on
// BOTH dtus shapes. The migrated lineage carries type/data/visibility;
// the live runtime shape (dtu-store) carries content/content_type and
// no type column at all. Before this fix, mintSaga's fixed column list
// failed both its inserts on runtime-shaped tables (mint_failed) and
// my_saga's `type = 'chronicle'` select threw into a swallowed catch —
// the feature was dead at both ends on the live shape while the
// migrated-shape suite stayed green.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up286 } from "../migrations/286_chronicle.js";
import { recordEntry, mintSaga, listSagas } from "../lib/chronicle/chronicle.js";

const W = "w-saga";

function base(db) {
  up286(db);
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, is_dead INTEGER DEFAULT 0);
    CREATE TABLE movement_uprisings (movement_id TEXT PRIMARY KEY, world_id TEXT, target_kind TEXT, target_id TEXT, member_count INTEGER, strategy_log_id TEXT, world_event_id TEXT, erupted_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE movements (id TEXT PRIMARY KEY, world_id TEXT, target_id TEXT, status TEXT, updated_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE movement_members (movement_id TEXT, member_kind TEXT, member_id TEXT, left_at INTEGER, PRIMARY KEY (movement_id, member_kind, member_id));
    CREATE TABLE world_events (id TEXT PRIMARY KEY, world_id TEXT, event_type TEXT, title TEXT, created_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE claim_crops (claim_id TEXT, tile_x INTEGER, tile_y INTEGER, growth_stage INTEGER, watered_at INTEGER, PRIMARY KEY (claim_id, tile_x, tile_y));
    CREATE TABLE world_resource_nodes (id TEXT PRIMARY KEY, world_id TEXT, is_depleted INTEGER DEFAULT 0);
    CREATE TABLE npc_grudges (id TEXT PRIMARY KEY, npc_id TEXT, target_kind TEXT, target_id TEXT, severity INTEGER, resolved_at INTEGER);
  `);
  recordEntry(db, W, "uprising", { id: "m1", target_id: "voss", members: 4 });
  return db;
}

function migratedDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, type TEXT, title TEXT, creator_id TEXT, data TEXT, visibility TEXT, created_at INTEGER);`);
  return base(db);
}

function runtimeDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, creator_id TEXT, title TEXT, content TEXT, content_type TEXT, tier TEXT, created_at TEXT, embedding TEXT);`);
  return base(db);
}

describe("saga mint + list across dtus shapes (genus piece 6)", () => {
  it("migrated shape: mint writes type='chronicle' and listSagas finds it", () => {
    const db = migratedDb();
    const r = mintSaga(db, { worldId: W, userId: "u1", title: "My Saga" });
    assert.equal(r.ok, true, JSON.stringify(r));
    const sagas = listSagas(db, "u1");
    assert.equal(sagas.length, 1);
    assert.equal(sagas[0].id, r.dtuId);
    assert.equal(sagas[0].title, "My Saga");
  });

  it("runtime shape: mint succeeds (was mint_failed) and listSagas finds it via content_type", () => {
    const db = runtimeDb();
    const r = mintSaga(db, { worldId: W, userId: "u1", title: "Runtime Saga" });
    assert.equal(r.ok, true, JSON.stringify(r));
    const row = db.prepare(`SELECT content_type, creator_id FROM dtus WHERE id = ?`).get(r.dtuId);
    assert.equal(row.content_type, "chronicle");
    assert.equal(row.creator_id, "u1");
    const sagas = listSagas(db, "u1");
    assert.equal(sagas.length, 1);
    assert.equal(sagas[0].title, "Runtime Saga");
  });

  it("runtime shape: other users' sagas and non-saga DTUs are excluded", () => {
    const db = runtimeDb();
    mintSaga(db, { worldId: W, userId: "u1", title: "Mine" });
    mintSaga(db, { worldId: W, userId: "u2", title: "Theirs" });
    db.prepare(`INSERT INTO dtus (id, creator_id, title, content, content_type, created_at) VALUES ('plain1', 'u1', 'Not a saga', '{}', 'text', '2026-01-01T00:00:00.000Z')`).run();
    const sagas = listSagas(db, "u1");
    assert.equal(sagas.length, 1);
    assert.equal(sagas[0].title, "Mine");
  });

  it("a table with no kind column lists honestly empty instead of throwing", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, creator_id TEXT, title TEXT, created_at TEXT);`);
    assert.deepEqual(listSagas(db, "u1"), []);
  });
});
