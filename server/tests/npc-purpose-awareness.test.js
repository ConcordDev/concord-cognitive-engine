// NPC purpose — dialogue awareness: buildNPCTraits surfaces the NPC's assigned
// job + workplace (secret-safe) so dialogue is place-aware.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { buildNPCTraits } from "../lib/narrative-bridge.js";
import { addAuthoredNPC } from "../lib/content-seeder.js";

function db0() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE npc_jobs (npc_id TEXT PRIMARY KEY, job_type TEXT, work_building_id TEXT);
    CREATE TABLE world_buildings (id TEXT PRIMARY KEY, building_type TEXT, name TEXT, x REAL, y REAL, z REAL);
  `);
  return db;
}

test("a working NPC's vocation names the job + workplace building", () => {
  const db = db0();
  db.prepare(`INSERT INTO world_buildings (id, building_type, name, x, y, z) VALUES ('b1','forge','Ember Forge',0,0,0)`).run();
  db.prepare(`INSERT INTO npc_jobs (npc_id, job_type, work_building_id) VALUES ('npc_kael','blacksmith','b1')`).run();
  addAuthoredNPC({ id: "npc_kael", name: "Kael", role: "smith", faction_id: null });
  const traits = buildNPCTraits("npc_kael", db);
  assert.ok(traits.vocation, "vocation present");
  assert.equal(traits.vocation.job, "blacksmith");
  assert.match(traits.vocation.summary, /blacksmith/);
  assert.match(traits.vocation.summary, /Ember Forge/, "names the workplace building");
});

test("a roamer reads as a wandering adventurer, no workplace", () => {
  const db = db0();
  db.prepare(`INSERT INTO npc_jobs (npc_id, job_type) VALUES ('npc_rover','roamer')`).run();
  addAuthoredNPC({ id: "npc_rover", name: "Rover", role: "explorer", faction_id: null });
  const traits = buildNPCTraits("npc_rover", db);
  assert.equal(traits.vocation.job, "roamer");
  assert.equal(traits.vocation.workplace, null);
  assert.match(traits.vocation.summary, /wandering|adventurer/);
});

test("no purpose substrate → vocation is null (never throws, never leaks)", () => {
  const db = db0();
  addAuthoredNPC({ id: "npc_bare", name: "Bare", role: "resident", faction_id: null });
  const traits = buildNPCTraits("npc_bare", db);
  assert.equal(traits.vocation, null);
  // The secret-omission invariant still holds — no secret field is present.
  assert.equal("secret" in traits, false);
  assert.equal("hidden_truth" in traits, false);
});
