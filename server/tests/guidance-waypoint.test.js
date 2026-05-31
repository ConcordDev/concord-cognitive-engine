// server/tests/guidance-waypoint.test.js
//
// Sprint 9 acceptance — diegetic waypoint resolution.
//
// The substrate has multiple guidance signal sources (real authored
// quests > forward-sim premonitions > lattice-born drift quests > none).
// This test pins the priority order + the hint text shape.

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { getActiveObjective, buildHintText } from "../lib/guidance-waypoint.js";

function setup() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE quest_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      world_id TEXT NOT NULL,
      title TEXT,
      objectives_json TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      started_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE forward_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      subject_kind TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      anticipated_prose TEXT,
      composed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 86400),
      realised_at INTEGER
    );
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      x REAL DEFAULT 0,
      z REAL DEFAULT 0
    );
    CREATE TABLE lattice_born_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drift_alert_signature TEXT,
      target_npc_id TEXT,
      world_id TEXT NOT NULL,
      realised_at INTEGER,
      composed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE procgen_regions (
      drift_alert_signature TEXT,
      anchor_x REAL,
      anchor_z REAL
    );
  `);
  return db;
}

test("active quest is the highest-priority source", () => {
  const db = setup();
  // Set up all 3 sources; quest must win.
  db.prepare(`INSERT INTO quest_state (user_id, world_id, title, objectives_json) VALUES (?,?,?,?)`)
    .run("u1", "tunya", "Find the Sealie",
      JSON.stringify([{ id: "step1", description: "Travel north", position: { x: 100, z: 200 }, complete: false }]));
  db.prepare(`INSERT INTO world_npcs (id, world_id, x, z) VALUES (?, ?, ?, ?)`).run("voss", "tunya", 50, 60);
  db.prepare(`INSERT INTO forward_predictions (user_id, subject_kind, subject_id, anticipated_prose) VALUES (?,?,?,?)`)
    .run("u1", "npc", "voss", "you feel pulled toward Voss");
  db.prepare(`INSERT INTO lattice_born_quests (drift_alert_signature, world_id) VALUES (?,?)`)
    .run("sigA", "tunya");

  const obj = getActiveObjective(db, "u1", "tunya");
  assert.equal(obj?.kind, "quest_step");
  assert.equal(obj?.questTitle, "Find the Sealie");
  assert.deepEqual(obj?.worldPos, { x: 100, z: 200 });
});

test("premonition wins when no active quest", () => {
  const db = setup();
  db.prepare(`INSERT INTO world_npcs (id, world_id, x, z) VALUES (?, ?, ?, ?)`).run("voss", "tunya", 75, 125);
  db.prepare(`INSERT INTO forward_predictions (user_id, subject_kind, subject_id, anticipated_prose) VALUES (?,?,?,?)`)
    .run("u1", "npc", "voss", "you have a feeling about Voss");

  const obj = getActiveObjective(db, "u1", "tunya");
  assert.equal(obj?.kind, "premonition");
  assert.equal(obj?.npcId, "voss");
  assert.deepEqual(obj?.worldPos, { x: 75, y: 0, z: 125 });
});

test("lattice-born quest is the third-priority fallback", () => {
  const db = setup();
  db.prepare(`INSERT INTO lattice_born_quests (drift_alert_signature, world_id) VALUES (?,?)`)
    .run("sigB", "tunya");
  db.prepare(`INSERT INTO procgen_regions (drift_alert_signature, anchor_x, anchor_z) VALUES (?,?,?)`)
    .run("sigB", 333, 444);

  const obj = getActiveObjective(db, "u1", "tunya");
  assert.equal(obj?.kind, "lattice_born");
  assert.deepEqual(obj?.worldPos, { x: 333, y: 0, z: 444 });
});

test("returns null when no signals exist", () => {
  const db = setup();
  const obj = getActiveObjective(db, "u1", "tunya");
  assert.equal(obj, null);
});

test("only matches quests for the correct user + world", () => {
  const db = setup();
  // Quest for different user in same world.
  db.prepare(`INSERT INTO quest_state (user_id, world_id, title, objectives_json) VALUES (?,?,?,?)`)
    .run("other_user", "tunya", "Other quest",
      JSON.stringify([{ id: "x", description: "x", position: { x: 1, z: 1 }, complete: false }]));
  // Quest for the right user in different world.
  db.prepare(`INSERT INTO quest_state (user_id, world_id, title, objectives_json) VALUES (?,?,?,?)`)
    .run("u1", "fantasy", "Wrong world",
      JSON.stringify([{ id: "x", description: "x", position: { x: 1, z: 1 }, complete: false }]));

  const obj = getActiveObjective(db, "u1", "tunya");
  assert.equal(obj, null);
});

test("skips quests whose only objectives are complete", () => {
  const db = setup();
  db.prepare(`INSERT INTO quest_state (user_id, world_id, title, objectives_json) VALUES (?,?,?,?)`)
    .run("u1", "tunya", "Done quest",
      JSON.stringify([{ id: "x", description: "done", complete: true }]));
  const obj = getActiveObjective(db, "u1", "tunya");
  assert.equal(obj, null, "all-complete quest should not return as active");
});

test("missing position falls through gracefully", () => {
  const db = setup();
  db.prepare(`INSERT INTO quest_state (user_id, world_id, title, objectives_json) VALUES (?,?,?,?)`)
    .run("u1", "tunya", "Vague quest",
      JSON.stringify([{ id: "x", description: "go figure it out", complete: false }]));
  const obj = getActiveObjective(db, "u1", "tunya");
  assert.equal(obj?.kind, "quest_step");
  assert.equal(obj?.worldPos, null, "should be null when objective has no position");
});

test("buildHintText produces non-empty strings for every objective kind", () => {
  assert.ok(buildHintText(null).length > 0);
  assert.ok(buildHintText({ kind: "quest_step", description: "x" }).length > 0);
  assert.ok(buildHintText({ kind: "premonition", npcId: "voss" }).length > 0);
  assert.ok(buildHintText({ kind: "lattice_born" }).length > 0);
  assert.ok(buildHintText({ kind: "unknown_kind" }).length > 0);
});

test("buildHintText mentions the npc when known", () => {
  const hint = buildHintText({ kind: "quest_step", npcId: "iyatte", description: "talk to her" });
  assert.ok(hint.includes("iyatte"));
});

test("missing db / missing userId handled gracefully", () => {
  assert.equal(getActiveObjective(null, "u1", "tunya"), null);
  assert.equal(getActiveObjective(setup(), null, "tunya"), null);
});
