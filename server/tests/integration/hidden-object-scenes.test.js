// Phase E3 — hidden-object scene seeding integration test.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upHidden } from "../../migrations/250_hidden_object.js";
import { listScenes, submitFind, playScene } from "../../lib/hidden-object.js";

function bootDb() {
  const db = new Database(":memory:");
  upHidden(db);
  // Stub dtus + users tables for the seeder (it tries to mint trivia
  // answer DTUs unrelated to scenes, but the seeder is async and
  // best-effort).
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtus (id TEXT PRIMARY KEY, kind TEXT, title TEXT,
      human_summary TEXT, created_at INTEGER, creator_id TEXT, scope TEXT, visibility TEXT);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES ('system');
  `);
  return db;
}

describe("Phase E3 — hidden-object scene seeding", () => {
  it("content/hidden-object-scenes.json validates and has >= 10 scenes", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const file = path.resolve(import.meta.dirname, "..", "..", "..", "content", "hidden-object-scenes.json");
    const arr = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(Array.isArray(arr), "scenes file must be an array");
    assert.ok(arr.length >= 10, `expected >= 10 scenes, got ${arr.length}`);
    for (const s of arr) {
      assert.ok(s.sceneId, "every scene needs sceneId");
      assert.ok(s.title, "every scene needs title");
      assert.ok(s.svg && s.svg.includes("<svg"), "every scene needs inline svg");
      assert.ok(Array.isArray(s.targets) && s.targets.length >= 2, "every scene needs >= 2 targets");
      for (const t of s.targets) {
        assert.ok(typeof t.x === "number" && t.x >= 0 && t.x <= 1, `target ${t.id} x must be 0..1`);
        assert.ok(typeof t.y === "number" && t.y >= 0 && t.y <= 1, `target ${t.id} y must be 0..1`);
        assert.ok(typeof t.w === "number" && t.w > 0 && t.w <= 1, `target ${t.id} w must be 0..1`);
        assert.ok(typeof t.h === "number" && t.h > 0 && t.h <= 1, `target ${t.id} h must be 0..1`);
      }
    }
  });

  it("seedContent persists authored scenes with stable ids", async () => {
    const db = bootDb();
    const { seedContent } = await import("../../lib/content-seeder.js");
    await seedContent({ db });

    const scenes = listScenes(db);
    assert.ok(scenes.length >= 10, `expected >= 10 seeded scenes, got ${scenes.length}`);

    // Stable id from authored JSON should be present, not random.
    const found = scenes.find((s) => s.id === "hub_bazaar_morning");
    assert.ok(found, "hub_bazaar_morning scene should be seeded");
    assert.ok(String(found.scene_dtu_id).startsWith("authored:"));
  });

  it("submitFind picks correct target by normalized coords", () => {
    const db = bootDb();
    // Two-target scene so a single hit doesn't auto-finish the run.
    db.exec(`INSERT INTO hidden_object_scenes (id, scene_dtu_id, host_user_id, title, target_objects_json)
             VALUES ('test_scene', 'authored:test_scene', 'system', 'Test',
               '[{"id":"target_a","label":"A","x":0.2,"y":0.3,"w":0.1,"h":0.1},
                 {"id":"target_b","label":"B","x":0.6,"y":0.6,"w":0.1,"h":0.1}]')`);
    db.exec(`INSERT INTO users (id) VALUES ('u_player')`);

    const r = playScene(db, "u_player", "test_scene");
    assert.equal(r.ok, true);

    // Click outside both bboxes — finds nothing.
    const miss = submitFind(db, r.runId, { x: 0.5, y: 0.1 });
    assert.equal(miss.ok, true);
    assert.equal(miss.found, false);

    // Click inside target_a bbox.
    const hit = submitFind(db, r.runId, { x: 0.25, y: 0.35 });
    assert.equal(hit.ok, true);
    assert.equal(hit.found, true);
    assert.equal(hit.foundId, "target_a");

    // Click inside target_b bbox — completes the run.
    const hit2 = submitFind(db, r.runId, { x: 0.65, y: 0.65 });
    assert.equal(hit2.ok, true);
    assert.equal(hit2.found, true);
    assert.equal(hit2.foundId, "target_b");
    assert.equal(hit2.complete, true);
  });
});
