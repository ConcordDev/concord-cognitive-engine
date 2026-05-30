/**
 * Living Society — Phase 5: the Movement/Cell primitive (KEYSTONE).
 *
 *   - a grievance cluster vs one authority SEEDS a movement led by the angriest;
 *   - recruitment grows members + raises visibility (growth↔exposure tension);
 *   - cross-tier (player) + cross-world membership works (N=2 cross-world);
 *   - counter-intel exposure suppresses a too-visible movement;
 *   - reaching the threshold flips status to acting;
 *   - seeding is idempotent + a movement can't recruit its own target.
 *
 * Run: node --test tests/movements.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up284 } from "../migrations/284_movements.js";
import {
  seedMovementFromGrievance, recruit, tickMovement, exposeMovement,
  listMovements, getMovement, memberCount, MOVEMENT_CONSTANTS,
} from "../lib/movements.js";

const W = "w1";
function mkDb() {
  const db = new Database(":memory:");
  up284(db);
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, is_dead INTEGER DEFAULT 0);
    CREATE TABLE npc_grudges (
      id TEXT PRIMARY KEY, npc_id TEXT, target_kind TEXT, target_id TEXT, narrative TEXT,
      severity INTEGER DEFAULT 5, event_at INTEGER DEFAULT (unixepoch()), resolved_at INTEGER
    );
  `);
  return db;
}
let _g = 0;
function grudge(db, npcId, targetId, severity, targetKind = "faction") {
  db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES (?, ?) ON CONFLICT DO NOTHING`).run(npcId, W);
  db.prepare(`INSERT INTO npc_grudges (id, npc_id, target_kind, target_id, narrative, severity) VALUES (?, ?, ?, ?, 'x', ?)`)
    .run(`g${_g++}`, npcId, targetKind, targetId, severity);
}

describe("Phase 5 — seeding from grievance", () => {
  it("clusters shared grudges vs one authority into a movement led by the angriest", () => {
    const db = mkDb();
    grudge(db, "npc_a", "house_voss", 5);
    grudge(db, "npc_b", "house_voss", 4);
    grudge(db, "npc_c", "house_voss", 3); // total 12 >= seed threshold
    const r = seedMovementFromGrievance(db, W);
    assert.equal(r.seeded.length, 1);
    const m = getMovement(db, r.seeded[0]);
    assert.equal(m.target_id, "house_voss");
    assert.equal(m.founded_by_id, "npc_a", "angriest holder founds it");
    assert.equal(m.members, 1, "founder is the first member");
    assert.equal(m.status, "recruiting");
  });

  it("does NOT seed below the severity threshold + is idempotent", () => {
    const db = mkDb();
    grudge(db, "npc_a", "minor_lord", 2);
    assert.equal(seedMovementFromGrievance(db, W).seeded.length, 0);
    grudge(db, "npc_a", "minor_lord", 5); // now 7 >= 6
    assert.equal(seedMovementFromGrievance(db, W).seeded.length, 1);
    assert.equal(seedMovementFromGrievance(db, W).seeded.length, 0, "re-seed is idempotent");
    assert.equal(listMovements(db, W).length, 1);
  });
});

describe("Phase 5 — recruitment + tension", () => {
  it("recruitment grows members + raises visibility", () => {
    const db = mkDb();
    grudge(db, "f", "voss", 8);
    const mid = seedMovementFromGrievance(db, W).seeded[0];
    const v0 = getMovement(db, mid).visibility_level;
    const r = recruit(db, mid, "npc", "ally1");
    assert.equal(r.ok, true);
    assert.equal(r.members, 2);
    assert.ok(r.visibility > v0, "recruiting raised visibility");
  });

  it("supports cross-tier (player) + cross-world membership (N=2 cross-world)", () => {
    const db = mkDb();
    grudge(db, "shopkeeper", "syndicate", 8);
    const mid = seedMovementFromGrievance(db, W).seeded[0];
    const r = recruit(db, mid, "player", "user_42", { candidateWorldId: "fantasy", role: "soldier" });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT member_world_id FROM movement_members WHERE movement_id=? AND member_id='user_42'`).get(mid);
    assert.equal(row.member_world_id, "fantasy");
    assert.equal(memberCount(db, mid), 2, "a 2-person cross-world coalition is a valid movement");
  });

  it("cannot recruit its own target", () => {
    const db = mkDb();
    grudge(db, "f", "tyrant", 8, "npc");
    const mid = seedMovementFromGrievance(db, W).seeded[0];
    const r = recruit(db, mid, "npc", "tyrant");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "cannot_recruit_target");
  });

  it("counter-intel exposure suppresses a too-visible movement", () => {
    const db = mkDb();
    grudge(db, "f", "voss", 8);
    const mid = seedMovementFromGrievance(db, W).seeded[0];
    const r = exposeMovement(db, mid, { amount: MOVEMENT_CONSTANTS.SUPPRESS_VISIBILITY + 5 });
    assert.equal(r.suppressed, true);
    assert.equal(getMovement(db, mid).status, "suppressed");
    // a suppressed movement can't recruit
    assert.equal(recruit(db, mid, "npc", "x").ok, false);
  });
});

describe("Phase 5 — threshold → acting", () => {
  it("reaching the action threshold flips status to acting", () => {
    const db = mkDb();
    grudge(db, "f", "voss", 8);
    const mid = seedMovementFromGrievance(db, W).seeded[0];
    // threshold default 3; recruit up to it
    recruit(db, mid, "npc", "a");
    recruit(db, mid, "npc", "b"); // now 3 members incl founder
    let t = tickMovement(db, mid);
    assert.equal(t.status, "organized");
    t = tickMovement(db, mid);
    assert.equal(t.status, "acting");
    assert.equal(t.acted, true);
  });
});
