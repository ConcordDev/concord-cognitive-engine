/**
 * Tier-2 contract tests for Concordia Phase 12 — aging + dynasty.
 *
 * Pins (aging):
 *   - setBirth seeds an aging row with deterministic lifespan from sha1(npc_id)
 *   - getAge returns ageDays + ageYears computed from current day
 *   - advanceAging returns NPCs whose expected_death ≤ current day
 *   - per-archetype lifespan bands (scholar 60-80, warrior 40-60, etc.)
 *
 * Pins (dynasty):
 *   - foundDynasty idempotent on founder
 *   - acceptHeir transitions current_head + bumps generations + attrites renown
 *   - bumpRenown clamps [0, 1000]
 *   - listHeirTakeoverLog returns ordered history
 *
 * Run: node --test tests/aging-dynasty.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  setBirth,
  getAge,
  advanceAging,
  AGING_CONSTANTS,
} from "../lib/aging-engine.js";
import {
  foundDynasty,
  getDynastyForUser,
  getDynasty,
  acceptHeir,
  bumpRenown,
  listHeirTakeoverLog,
  DYNASTY_CONSTANTS,
} from "../lib/player-dynasty.js";
import { up as up181 } from "../migrations/181_aging_dynasty.js";

function setupDb() {
  const db = new Database(":memory:");
  up181(db);
  return db;
}

describe("Phase 12 / aging — setBirth + getAge", () => {
  it("setBirth seeds a row", () => {
    const db = setupDb();
    const r = setBirth(db, "npc_1", "scholar", 0);
    assert.equal(r.ok, true);
    assert.equal(r.birthDay, 0);
    assert.ok(r.expected_death_day > 0);
  });

  it("getAge computes from current day", () => {
    const db = setupDb();
    setBirth(db, "npc_1", "scholar", 0);
    const age = getAge(db, "npc_1", 42 * 30); // 30 years later
    assert.equal(age.ageDays, 42 * 30);
    assert.equal(Math.round(age.ageYears), 30);
  });

  it("upserts on npc_id", () => {
    const db = setupDb();
    setBirth(db, "npc_1", "scholar", 0);
    setBirth(db, "npc_1", "warrior", 100);
    const age = getAge(db, "npc_1", 100);
    assert.equal(age.archetype, "warrior");
    assert.equal(age.birth_concordia_day, 100);
  });

  it("returns null for unknown npc", () => {
    const db = setupDb();
    assert.equal(getAge(db, "ghost", 0), null);
  });
});

describe("Phase 12 / aging — lifespan bands", () => {
  it("scholar in [60, 80] years", () => {
    const db = setupDb();
    setBirth(db, "scholar_1", "scholar", 0);
    const a = getAge(db, "scholar_1", 0);
    const lifespanYears = a.expected_death_concordia_day / AGING_CONSTANTS.DAYS_PER_YEAR;
    assert.ok(lifespanYears >= 60 && lifespanYears <= 80, `scholar lifespan ${lifespanYears} out of [60, 80]`);
  });

  it("warrior in [40, 60] years", () => {
    const db = setupDb();
    setBirth(db, "warrior_1", "warrior", 0);
    const a = getAge(db, "warrior_1", 0);
    const lifespanYears = a.expected_death_concordia_day / AGING_CONSTANTS.DAYS_PER_YEAR;
    assert.ok(lifespanYears >= 40 && lifespanYears <= 60, `warrior lifespan ${lifespanYears} out of [40, 60]`);
  });

  it("mystic in [70, 90] years", () => {
    const db = setupDb();
    setBirth(db, "mystic_1", "mystic", 0);
    const a = getAge(db, "mystic_1", 0);
    const lifespanYears = a.expected_death_concordia_day / AGING_CONSTANTS.DAYS_PER_YEAR;
    assert.ok(lifespanYears >= 70 && lifespanYears <= 90, `mystic lifespan ${lifespanYears} out of [70, 90]`);
  });

  it("unknown archetype falls back to [50, 70]", () => {
    const db = setupDb();
    setBirth(db, "unknown_1", "alien", 0);
    const a = getAge(db, "unknown_1", 0);
    const lifespanYears = a.expected_death_concordia_day / AGING_CONSTANTS.DAYS_PER_YEAR;
    assert.ok(lifespanYears >= 50 && lifespanYears <= 70, `unknown lifespan ${lifespanYears} out of [50, 70]`);
  });

  it("setBirth is deterministic per npc_id", () => {
    const db = setupDb();
    setBirth(db, "npc_x", "warrior", 0);
    const first = getAge(db, "npc_x", 0).expected_death_concordia_day;
    setBirth(db, "npc_x", "warrior", 0);
    const second = getAge(db, "npc_x", 0).expected_death_concordia_day;
    assert.equal(first, second);
  });
});

describe("Phase 12 / aging — advanceAging", () => {
  it("returns NPCs past expected death", () => {
    const db = setupDb();
    db.prepare(`INSERT INTO npc_ages (npc_id, birth_concordia_day, expected_death_concordia_day) VALUES ('old', 0, 500)`).run();
    db.prepare(`INSERT INTO npc_ages (npc_id, birth_concordia_day, expected_death_concordia_day) VALUES ('young', 0, 5000)`).run();
    const r = advanceAging(db, 1000);
    const ids = r.dueForDeath.map((x) => x.npcId);
    assert.ok(ids.includes("old"));
    assert.ok(!ids.includes("young"));
  });
});

describe("Phase 12 / dynasty — foundDynasty + getDynasty", () => {
  it("found is idempotent on founder", () => {
    const db = setupDb();
    const r1 = foundDynasty(db, "u_alice", "House Alpha");
    const r2 = foundDynasty(db, "u_alice", "House Different");
    assert.equal(r1.action, "founded");
    assert.equal(r2.action, "exists");
    assert.equal(r1.dynastyId, r2.dynastyId);
  });

  it("getDynastyForUser returns the dynasty", () => {
    const db = setupDb();
    foundDynasty(db, "u_alice", "House Alpha");
    const d = getDynastyForUser(db, "u_alice");
    assert.equal(d.house_name, "House Alpha");
    assert.equal(d.current_head_user_id, "u_alice");
    assert.equal(d.generations, 1);
  });
});

describe("Phase 12 / dynasty — acceptHeir", () => {
  it("transitions current_head and bumps generations", () => {
    const db = setupDb();
    const r = foundDynasty(db, "u_alice", "House Alpha");
    bumpRenown(db, r.dynastyId, 100);
    const heir = acceptHeir(db, r.dynastyId, "u_bob", { cause: "duel" });
    assert.equal(heir.action, "heir_accepted");
    assert.equal(heir.generation, 2);
    // Renown attrites by 0.7 → 70
    assert.equal(heir.newRenown, Math.floor(100 * DYNASTY_CONSTANTS.RENOWN_INHERITANCE_FACTOR));
    const updated = getDynasty(db, r.dynastyId);
    assert.equal(updated.current_head_user_id, "u_bob");
    assert.equal(updated.renown, 70);
  });

  it("rejects heir same as current head", () => {
    const db = setupDb();
    const r = foundDynasty(db, "u_alice", "House Alpha");
    const x = acceptHeir(db, r.dynastyId, "u_alice");
    assert.equal(x.ok, false);
    assert.equal(x.reason, "heir_is_current_head");
  });

  it("rejects missing dynasty", () => {
    const db = setupDb();
    const x = acceptHeir(db, "ghost_dyn", "u_bob");
    assert.equal(x.ok, false);
    assert.equal(x.reason, "dynasty_not_found");
  });
});

describe("Phase 12 / dynasty — bumpRenown + log", () => {
  it("bumpRenown clamps to [0, 1000]", () => {
    const db = setupDb();
    const r = foundDynasty(db, "u_alice", "House Alpha");
    bumpRenown(db, r.dynastyId, 9999);
    assert.equal(getDynasty(db, r.dynastyId).renown, 1000);
    bumpRenown(db, r.dynastyId, -9999);
    assert.equal(getDynasty(db, r.dynastyId).renown, 0);
  });

  it("listHeirTakeoverLog has takeover row", () => {
    const db = setupDb();
    const r = foundDynasty(db, "u_alice", "House Alpha");
    acceptHeir(db, r.dynastyId, "u_bob");
    const log = listHeirTakeoverLog(db, r.dynastyId);
    assert.equal(log.length, 1);
    assert.equal(log[0].predecessor_user_id, "u_alice");
    assert.equal(log[0].heir_user_id, "u_bob");
  });
});
