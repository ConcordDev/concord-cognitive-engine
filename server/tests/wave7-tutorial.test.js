// server/tests/wave7-tutorial.test.js
//
// Wave 7 / T3.2 — second-cycle tutorial progress derivation.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  deriveSecondCycleProgress,
  recordUiOpen,
  SECOND_CYCLE_STEPS,
} from "../lib/tutorial-second-cycle.js";

let db;

before(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE user_ui_opens (
      user_id TEXT NOT NULL, ui_key TEXT NOT NULL,
      first_opened_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, ui_key)
    );
    CREATE TABLE player_creature_discoveries (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL,
      kind TEXT NOT NULL, species_ref TEXT NOT NULL,
      first_seen_at INTEGER DEFAULT (unixepoch()),
      last_seen_at  INTEGER DEFAULT (unixepoch()),
      sightings INTEGER DEFAULT 1, meta_json TEXT,
      UNIQUE(user_id, world_id, kind, species_ref)
    );
    CREATE TABLE land_claims (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL,
      world_id TEXT NOT NULL,
      anchor_x REAL, anchor_z REAL, radius_m REAL,
      status TEXT DEFAULT 'active'
    );
  `);
});

after(() => { db?.close(); });

describe("Wave 7 — second-cycle tutorial", () => {
  it("fresh user has zero progress", () => {
    const p = deriveSecondCycleProgress(db, "user_fresh");
    assert.equal(p.completeCount, 0);
    assert.equal(p.totalCount, SECOND_CYCLE_STEPS.length);
    assert.equal(p.complete, false);
    assert.equal(p.currentStep, SECOND_CYCLE_STEPS[0].key);
  });

  it("opening character sheet advances the first step", () => {
    recordUiOpen(db, "user_a", "character_sheet");
    const p = deriveSecondCycleProgress(db, "user_a");
    const cs = p.steps.find((s) => s.key === "open_character_sheet");
    assert.equal(cs.complete, true);
    assert.equal(p.completeCount, 1);
  });

  it("recordUiOpen is idempotent", () => {
    recordUiOpen(db, "user_a", "character_sheet");  // double-record
    const n = db.prepare(`SELECT COUNT(*) AS n FROM user_ui_opens WHERE user_id = 'user_a' AND ui_key = 'character_sheet'`).get().n;
    assert.equal(n, 1);
  });

  it("opening all UI flags + discovering + taming + claiming completes the cycle", () => {
    const uid = "user_full";
    recordUiOpen(db, uid, "character_sheet");
    recordUiOpen(db, uid, "favorites_wheel");
    recordUiOpen(db, uid, "perk_constellation");
    db.prepare(`INSERT INTO player_creature_discoveries (id, user_id, world_id, kind, species_ref)
      VALUES ('d1', ?, 'concordia', 'hybrid', 'hybrid_a')`).run(uid);
    db.prepare(`INSERT INTO player_creature_discoveries (id, user_id, world_id, kind, species_ref)
      VALUES ('d2', ?, 'concordia', 'tamed', 'comp_a')`).run(uid);
    db.prepare(`INSERT INTO land_claims (id, owner_user_id, world_id, anchor_x, anchor_z, radius_m)
      VALUES ('lc1', ?, 'concordia', 0, 0, 20)`).run(uid);

    const p = deriveSecondCycleProgress(db, uid);
    assert.equal(p.complete, true);
    assert.equal(p.completeCount, p.totalCount);
    assert.equal(p.currentStep, null);
  });
});
