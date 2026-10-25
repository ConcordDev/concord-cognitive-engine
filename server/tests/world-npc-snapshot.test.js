// Live NPCs on world:snapshot — same rows as GET /api/worlds/:id/npcs.
//
//   cd server && node --test tests/world-npc-snapshot.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { listNpcsForGatewaySnapshot, listResidentsForGateway } from "../lib/world-npc-snapshot.js";

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

describe("listResidentsForGateway", () => {
  function residentsDb() {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE world_npcs (
        id TEXT PRIMARY KEY, world_id TEXT, faction TEXT, job_type TEXT,
        current_activity TEXT, state TEXT, narrative_context TEXT, is_dead INTEGER DEFAULT 0
      );
    `);
    const add = db.prepare(`INSERT INTO world_npcs VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    add.run("pn_b", "concordia-hub", "iron_wardens", "guard", "patrolling",
      JSON.stringify({ name: "Vesta Harrow" }),
      JSON.stringify({ backstory: "Sworn to the gates. ".repeat(30), secret: "Sold the gate code" }), 0);
    add.run("pn_a", "concordia-hub", null, "generic", "resting", JSON.stringify({ name: "Idle Name" }), null, 0);
    add.run("pn_c", "concordia-hub", null, "merchant", "trading", JSON.stringify({}), null, 0);
    add.run("pn_d", "concordia-hub", null, "clerk", "crafting", JSON.stringify({ name: "Gone Clerk" }), null, 1);
    add.run("pn_e", "crime", null, "clerk", "crafting", JSON.stringify({ name: "Elsewhere" }), null, 0);
    return db;
  }

  it("returns only this world's living, named people, workers before generic", () => {
    const people = listResidentsForGateway(residentsDb(), "concordia-hub");
    assert.deepEqual(people.map((p) => p.name), ["Vesta Harrow", "Idle Name"]);
    assert.equal(people[0].job, "guard");
    assert.equal(people[0].activity, "patrolling");
    assert.equal(people[0].faction, "iron_wardens");
  });

  it("sends a trimmed public backstory and never the secret", () => {
    const [vesta] = listResidentsForGateway(residentsDb(), "concordia-hub");
    assert.ok(vesta.backstory.startsWith("Sworn to the gates."));
    assert.ok(vesta.backstory.length <= 280);
    assert.doesNotMatch(JSON.stringify(vesta), /gate code|secret/i);
  });

  it("is an honest empty list without a db or world", () => {
    assert.deepEqual(listResidentsForGateway(null, "concordia-hub"), []);
    assert.deepEqual(listResidentsForGateway(residentsDb(), ""), []);
  });
});
