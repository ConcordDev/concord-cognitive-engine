// Live NPCs on world:snapshot — same rows as GET /api/worlds/:id/npcs.
//
//   cd server && node --test tests/world-npc-snapshot.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { listNpcsForGatewaySnapshot } from "../lib/world-npc-snapshot.js";

describe("listNpcsForGatewaySnapshot", () => {
  it("returns [] when there is no db, not fabricated citizens", () => {
    assert.deepEqual(listNpcsForGatewaySnapshot(null, "concordia-hub"), []);
    assert.deepEqual(listNpcsForGatewaySnapshot({}, "concordia-hub"), []);
  });

  it("lists live world_npcs with authored name and activity", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE world_npcs (
        id TEXT PRIMARY KEY,
        world_id TEXT,
        archetype TEXT,
        npc_type TEXT,
        faction TEXT,
        current_location TEXT,
        state TEXT,
        is_dead INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT 0
      );
      CREATE TABLE npc_routine_state (
        npc_id TEXT PRIMARY KEY,
        activity_kind TEXT
      );
    `);
    db.prepare(`
      INSERT INTO world_npcs (id, world_id, archetype, npc_type, faction, current_location, state, is_dead, created_at)
      VALUES ('vesper-1', 'concordia-hub', 'merchant', 'human', 'luminary', ?, ?, 0, 1)
    `).run(JSON.stringify({ x: 7.2, y: 0, z: 9.1 }), JSON.stringify({ name: "Vesper Kane", occupation: "Luminary" }));
    db.prepare(`INSERT INTO npc_routine_state (npc_id, activity_kind) VALUES ('vesper-1', 'work')`).run();
    const npcs = listNpcsForGatewaySnapshot(db, "concordia-hub");
    assert.equal(npcs.length, 1);
    assert.equal(npcs[0].id, "vesper-1");
    assert.equal(npcs[0].name, "Vesper Kane");
    assert.equal(npcs[0].title, "Luminary");
    assert.equal(npcs[0].activity, "work");
    assert.equal(npcs[0].x, 7.2);
    assert.equal(npcs[0].z, 9.1);
  });

  it("omits the dead", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE world_npcs (
        id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, npc_type TEXT,
        faction TEXT, current_location TEXT, state TEXT, is_dead INTEGER, created_at INTEGER
      );
    `);
    db.prepare(`INSERT INTO world_npcs VALUES ('dead-1','concordia-hub','guard','human',null,'{}','{}',1,1)`).run();
    assert.equal(listNpcsForGatewaySnapshot(db, "concordia-hub").length, 0);
  });
});
