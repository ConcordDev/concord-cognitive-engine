// Phase AF — combat frame data tests.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  getSkillFrameData,
  getFrameDataForSkillId,
  getFrameDataBatch,
  withProfileOverride,
} from "../lib/combat-frame-data.js";

function freshDb() {
  // Mirror the live dtus columns the lookup reads: `type` + `data` (migration
  // 087), `skill_level` (migration 043), `body_json` (001, legacy fallback).
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      type TEXT,
      title TEXT,
      body_json TEXT,
      data TEXT,
      skill_level REAL DEFAULT 1.0
    );
  `);
  return db;
}

describe("Phase AF — combat frame data", () => {
  it("returns sword/bow/staff shape with parry windows ordered sensibly", () => {
    const sword = getSkillFrameData({ id: "s", kind: "sword", level: 1 });
    const bow = getSkillFrameData({ id: "b", kind: "bow", level: 1 });
    const staff = getSkillFrameData({ id: "st", kind: "staff", level: 1 });

    assert.ok(sword.parry_window_ms > 0, "sword has parry");
    assert.equal(bow.parry_window_ms, 0, "bow does not parry");
    assert.equal(staff.parry_window_ms, 0, "staff does not parry");
    assert.ok(sword.startup_ms < staff.startup_ms, "sword starts faster than staff");
  });

  it("parry window is bounded (positive, under 500ms — playable)", () => {
    const d = getSkillFrameData({ id: "d", kind: "dagger", level: 1 });
    assert.ok(d.parry_window_ms > 0);
    assert.ok(d.parry_window_ms < 500, "parry window should be tight enough to require timing");
  });

  it("at least one combo followup is preserved when provided", () => {
    const d = getSkillFrameData({
      id: "d", kind: "sword", level: 1,
      combo_followups: [{ id: "thrust", name: "Riposte" }, { id: "kick", name: "Kick" }],
    });
    assert.equal(d.combo_followups.length, 2);
    assert.equal(d.combo_followups[0].skillId, "thrust");
  });

  it("level scaling tightens startup + recovery (caps at 30% faster)", () => {
    const lo = getSkillFrameData({ id: "x", kind: "sword", level: 1 });
    const hi = getSkillFrameData({ id: "x", kind: "sword", level: 100 });
    assert.ok(hi.startup_ms < lo.startup_ms);
    // 30% floor: shouldn't drop below 0.7× base 200 = 140.
    assert.ok(hi.startup_ms >= 140);
  });

  it("getFrameDataForSkillId reads from dtus table (data column, body_json fallback)", () => {
    const db = freshDb();
    // Primary path: skill-progression writers store metadata in `data`.
    db.prepare(`INSERT INTO dtus (id, type, title, data) VALUES (?, ?, ?, ?)`)
      .run("sk-1", "skill", "Iron Slash",
        JSON.stringify({ kind: "sword", level: 10, max_damage: 25 }));
    const d = getFrameDataForSkillId(db, "sk-1");
    assert.equal(d.skillId, "sk-1");
    assert.equal(d.name, "Iron Slash");
    assert.equal(d.kind, "sword");
    assert.equal(d.level, 10);
    // Legacy path: metadata only in body_json still resolves.
    db.prepare(`INSERT INTO dtus (id, type, title, body_json) VALUES (?, ?, ?, ?)`)
      .run("sk-legacy", "skill", "Old Cut", JSON.stringify({ kind: "dagger", level: 3 }));
    const legacy = getFrameDataForSkillId(db, "sk-legacy");
    assert.equal(legacy.kind, "dagger");
    assert.equal(legacy.level, 3);
  });

  it("skill_level column drives level when metadata has none", () => {
    const db = freshDb();
    db.prepare(`INSERT INTO dtus (id, type, title, data, skill_level) VALUES (?, ?, ?, ?, ?)`)
      .run("sk-lv", "skill", "Trained Strike", JSON.stringify({ kind: "sword" }), 12.7);
    const d = getFrameDataForSkillId(db, "sk-lv");
    assert.equal(d.level, 12);   // floor(12.7)
  });

  it("built-in weapon kind resolves without a DTU row; unknown id is null", () => {
    const db = freshDb();
    const sword = getFrameDataForSkillId(db, "sword");
    assert.equal(sword.kind, "sword");
    assert.equal(sword.name, "Sword");
    assert.equal(getFrameDataForSkillId(db, "not-a-skill"), null);
  });

  it("batch lookup filters out missing", () => {
    const db = freshDb();
    db.prepare(`INSERT INTO dtus (id, type, title, data) VALUES (?, ?, ?, ?)`)
      .run("sk-1", "skill", "Slash", JSON.stringify({ kind: "sword", level: 1 }));
    const arr = getFrameDataBatch(db, ["sk-1", "missing", "sk-1"]);
    assert.equal(arr.length, 2);
  });

  it("profile override replaces parry/dodge windows", () => {
    const base = getSkillFrameData({ id: "x", kind: "sword", level: 1 });
    const sifu = withProfileOverride(base, "sifu_brawler");
    assert.notEqual(sifu.parry_window_ms, base.parry_window_ms);
    assert.equal(sifu.profile, "sifu_brawler");
  });
});
