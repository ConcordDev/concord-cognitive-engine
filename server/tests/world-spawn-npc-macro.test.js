// Test for Wave 7 / E5 — the world/spawn-npc macro (the SDK NpcClient.spawn target).
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migTrace } from "../migrations/326_affect_trace_temperament.js";
import registerWorldActions from "../domains/world.js";
import { DRIVE_KINDS } from "../lib/ecosystem/drives.js";

// capture the registered handlers
function collectHandlers() {
  const map = new Map();
  registerWorldActions((domain, action, fn) => map.set(`${domain}.${action}`, fn));
  return map;
}

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, name TEXT)`);
  migTrace(db); // adds world_npcs.temperament_json
  return db;
}

test("E5 — world/spawn-npc macro", async (t) => {
  const handlers = collectHandlers();
  const spawn = handlers.get("world.spawn-npc");
  assert.ok(spawn, "the spawn-npc macro is registered on the world domain");

  await t.test("spawns a world_npcs row seeded with an individual temperament", async () => {
    const db = setupDb();
    const r = await spawn({ db }, {}, { worldId: "w", species: "deer", name: "Bramble" });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT * FROM world_npcs WHERE id = ?`).get(r.result.npcId);
    assert.ok(row, "the NPC row exists");
    assert.equal(row.world_id, "w");
    assert.equal(row.name, "Bramble");
    const temp = JSON.parse(row.temperament_json);
    assert.ok(DRIVE_KINDS.every((k) => Number.isFinite(temp[k])), "a 7-drive temperament was seeded");
  });

  await t.test("reads input from artifact.data or params; clean error with no db", async () => {
    const db = setupDb();
    const r = await spawn({ db }, { data: { worldId: "w2", species: "hawk" } }, {});
    assert.equal(r.ok, true);
    assert.equal(db.prepare(`SELECT world_id FROM world_npcs WHERE id=?`).get(r.result.npcId).world_id, "w2");
    const bad = await spawn({}, {}, {});
    assert.equal(bad.ok, false);
  });
});
