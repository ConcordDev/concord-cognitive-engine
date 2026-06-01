// NPC purpose — every NPC gets a faction/world + home + workplace (matched to
// their job) OR an explicit roamer purpose. Reconcile pass is idempotent.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  buildSettlement, assignPurpose, assignPurposesForWorld,
  pickJobType, isRoamer, buildingTypeForRoom,
} from "../lib/npc/purpose.js";

function db0() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, faction TEXT,
      criminal_rep REAL DEFAULT 0, is_dead INTEGER DEFAULT 0,
      home_building_id TEXT, job_type TEXT, job_location_id TEXT, job_room_id TEXT
    );
    CREATE TABLE world_buildings (
      id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT, name TEXT,
      x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
      owner_type TEXT DEFAULT 'world', owner_id TEXT, is_seed INTEGER DEFAULT 0,
      state TEXT DEFAULT 'standing', npc_occupant TEXT
    );
    CREATE TABLE building_rooms (
      id TEXT PRIMARY KEY, building_id TEXT, world_id TEXT, room_type TEXT,
      name TEXT, width REAL, depth REAL, height REAL, x_offset REAL, z_offset REAL,
      floor INTEGER, capacity INTEGER, owner_id TEXT, is_public INTEGER DEFAULT 1, furniture TEXT
    );
    CREATE TABLE npc_jobs (
      id TEXT PRIMARY KEY, npc_id TEXT UNIQUE, world_id TEXT, job_type TEXT,
      work_building_id TEXT, work_room_id TEXT, employer_id TEXT, wage_per_tick INTEGER,
      schedule TEXT, current_task TEXT
    );
    CREATE TABLE realms (id TEXT PRIMARY KEY, name TEXT, world_id TEXT, faction_id TEXT, ruler_kind TEXT, ruler_id TEXT);
    CREATE TABLE realm_citizens (npc_id TEXT, kingdom_id TEXT, loyalty INTEGER DEFAULT 50, PRIMARY KEY (npc_id, kingdom_id));
  `);
  return db;
}
const addNpc = (db, id, archetype, faction = "pinewood") =>
  db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, faction) VALUES (?, 'w1', ?, ?)`).run(id, archetype, faction);

test("taxonomy: archetype → job, roamer detection, room→building provider", () => {
  assert.equal(pickJobType("blacksmith"), "blacksmith");
  assert.equal(pickJobType("innkeeper"), "innkeeper");
  assert.equal(pickJobType("clerk"), "clerk");
  assert.equal(pickJobType("builder"), "builder");
  assert.equal(pickJobType("nobody-archetype"), "generic");
  assert.equal(isRoamer("explorer"), true);
  assert.equal(isRoamer("blacksmith"), false);
  assert.equal(buildingTypeForRoom("forge"), "forge");
  assert.equal(buildingTypeForRoom("office"), "city_hall");
  assert.equal(buildingTypeForRoom("construction_site"), "construction_yard");
});

test("buildSettlement places workplaces for resident jobs + homes, idempotent", () => {
  const db = db0();
  addNpc(db, "smith", "blacksmith");
  addNpc(db, "keep", "innkeeper");
  addNpc(db, "clerk1", "clerk");
  addNpc(db, "build1", "builder");
  const r1 = buildSettlement(db, "w1");
  assert.equal(r1.ok, true);
  const types = db.prepare(`SELECT DISTINCT building_type FROM world_buildings WHERE world_id='w1'`).all().map((x) => x.building_type);
  assert.ok(types.includes("forge"), "forge for the blacksmith");
  assert.ok(types.includes("inn"), "inn for the innkeeper");
  assert.ok(types.includes("city_hall"), "city hall for the clerk");
  assert.ok(types.includes("construction_yard"), "yard for the builder");
  assert.ok(types.includes("house"), "homes placed");
  // forge building got its rooms seeded (so assignJob can match the forge room).
  const forge = db.prepare(`SELECT id FROM world_buildings WHERE world_id='w1' AND building_type='forge'`).get();
  const forgeRoom = db.prepare(`SELECT room_type FROM building_rooms WHERE building_id=?`).all(forge.id).map((x) => x.room_type);
  assert.ok(forgeRoom.includes("forge"));
  // Idempotent: a second pass places nothing new.
  const before = db.prepare(`SELECT COUNT(*) c FROM world_buildings`).get().c;
  buildSettlement(db, "w1");
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM world_buildings`).get().c, before, "no duplicate buildings");
});

test("assignPurpose: a blacksmith gets a forge workplace + occupant + home + citizenship", () => {
  const db = db0();
  db.prepare(`INSERT INTO realms (id, name, world_id, faction_id, ruler_kind) VALUES ('r1','Pinewood','w1','pinewood','npc')`).run();
  addNpc(db, "smith", "blacksmith", "pinewood");
  buildSettlement(db, "w1");
  const r = assignPurpose(db, "smith", "w1");
  assert.equal(r.ok, true);
  assert.equal(r.purpose, "work");
  assert.equal(r.jobType, "blacksmith");
  assert.ok(r.workplace, "got a workplace building");
  // It's a forge.
  const wb = db.prepare(`SELECT building_type, npc_occupant FROM world_buildings WHERE id = ?`).get(r.workplace);
  assert.equal(wb.building_type, "forge");
  assert.equal(wb.npc_occupant, "smith", "workplace marks the occupant");
  // Home + npc_jobs + citizenship.
  assert.ok(db.prepare(`SELECT home_building_id FROM world_npcs WHERE id='smith'`).get().home_building_id, "has a home");
  assert.equal(db.prepare(`SELECT job_type FROM npc_jobs WHERE npc_id='smith'`).get().job_type, "blacksmith");
  assert.ok(db.prepare(`SELECT 1 FROM realm_citizens WHERE npc_id='smith' AND kingdom_id='r1'`).get(), "registered as realm citizen");
});

test("a roamer (explorer) gets a roam purpose + home, no workplace", () => {
  const db = db0();
  addNpc(db, "rover", "explorer");
  buildSettlement(db, "w1");
  const r = assignPurpose(db, "rover", "w1");
  assert.equal(r.purpose, "roam");
  assert.equal(r.workplace, null);
  assert.equal(db.prepare(`SELECT job_type FROM npc_jobs WHERE npc_id='rover'`).get().job_type, "roamer");
  assert.ok(db.prepare(`SELECT home_building_id FROM world_npcs WHERE id='rover'`).get().home_building_id, "roamer still has a home to return to");
});

test("assignPurposesForWorld is the cold-start guarantee: everyone gets a purpose, idempotent", () => {
  const db = db0();
  addNpc(db, "smith", "blacksmith");
  addNpc(db, "keep", "innkeeper");
  addNpc(db, "rover", "explorer");
  addNpc(db, "build1", "builder");
  const r = assignPurposesForWorld(db, "w1");
  assert.equal(r.ok, true);
  assert.equal(r.assigned, 4);
  // Every non-creature NPC now has a job row (work or roam).
  const without = db.prepare(`SELECT COUNT(*) c FROM world_npcs n WHERE NOT EXISTS (SELECT 1 FROM npc_jobs j WHERE j.npc_id = n.id)`).get().c;
  assert.equal(without, 0, "no purposeless NPC remains");
  // Re-run: idempotent (no new buildings, only un-jobbed NPCs scanned → 0).
  const bCount = db.prepare(`SELECT COUNT(*) c FROM world_buildings`).get().c;
  const r2 = assignPurposesForWorld(db, "w1");
  assert.equal(r2.assigned, 0, "no new assignments on a settled world");
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM world_buildings`).get().c, bCount, "no duplicate buildings");
});

test("disabled kill-switch is a no-op", () => {
  const prev = process.env.CONCORD_NPC_PURPOSE;
  process.env.CONCORD_NPC_PURPOSE = "0";
  try {
    const db = db0();
    addNpc(db, "smith", "blacksmith");
    assert.equal(assignPurpose(db, "smith", "w1").ok, false);
    assert.equal(assignPurposesForWorld(db, "w1").ok, false);
  } finally {
    if (prev === undefined) delete process.env.CONCORD_NPC_PURPOSE;
    else process.env.CONCORD_NPC_PURPOSE = prev;
  }
});
