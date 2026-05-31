// The frozen-NPC bug: job-archetype NPCs (cook/miller/miner/builder/fisher/farmer/
// logger) emitted schedule activity/location values outside the mig-130 CHECK
// enum, so persistScheduleForNpc threw → no schedule → the NPC never moved.
// These pin: normalization clamps to the enum, every job archetype now persists
// a full schedule, and canonical values pass through unchanged.
//
// Run: node --test tests/npc-schedule-normalize.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { persistScheduleForNpc, composeScheduleForNpc, normalizeActivityKind, normalizeLocationKind } from "../lib/npc-routines.js";

const VALID_ACT = new Set(["sleep", "train", "craft", "gather", "trade", "commune", "socialize", "patrol", "wander", "rest"]);
const VALID_LOC = new Set(["home", "workplace", "market", "grove", "temple", "tavern", "wilds", "plaza"]);

describe("schedule enum normalization", () => {
  it("maps job verbs to canonical activities", () => {
    assert.equal(normalizeActivityKind("cook"), "craft");
    assert.equal(normalizeActivityKind("mine"), "gather");
    assert.equal(normalizeActivityKind("farm"), "gather");
    assert.equal(normalizeActivityKind("build"), "craft");
    assert.equal(normalizeActivityKind("guard"), "patrol");
    assert.equal(normalizeActivityKind("totally-unknown"), "wander"); // safe fallback
  });
  it("maps job locations to canonical + passes canonical through", () => {
    assert.equal(normalizeLocationKind("farm"), "wilds");
    assert.equal(normalizeLocationKind("construction"), "workplace");
    assert.equal(normalizeLocationKind("dock"), "workplace");
    assert.equal(normalizeLocationKind("market"), "market"); // already valid
    assert.equal(normalizeLocationKind("???"), "workplace");  // fallback
  });
  it("every composed value normalizes INTO the CHECK enum", () => {
    for (const arch of ["cook", "miller", "miner", "builder", "fisher", "farmer", "logger", "scholar", "guard", "default"]) {
      const slots = composeScheduleForNpc({ id: "n", archetype: arch, faction: "x", current_location: '{"x":0,"z":0}' }, 7, null);
      for (const s of slots) {
        assert.ok(VALID_ACT.has(normalizeActivityKind(s.activity_kind)), `${arch}:${s.activity_kind}`);
        assert.ok(VALID_LOC.has(normalizeLocationKind(s.location_kind)), `${arch}:${s.location_kind}`);
      }
    }
  });
});

describe("persist now succeeds for the job archetypes that were frozen", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("a cook + a miller persist a full 8-block schedule (was 0 → persist_failed)", () => {
    const cook = { id: "npc_cook", archetype: "cook", faction: "x", current_location: '{"x":5,"z":5}' };
    const miller = { id: "npc_miller", archetype: "miller", faction: "x", current_location: '{"x":9,"z":9}' };
    assert.equal(persistScheduleForNpc(db, cook, 100, null), 8);
    assert.equal(persistScheduleForNpc(db, miller, 100, null), 8);
    const rows = db.prepare("SELECT COUNT(*) c FROM npc_schedules").get().c;
    assert.equal(rows, 16);
  });
});
