// Phase BB2 — seasonal achievement gating tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  unlockAchievement,
  listSeasonalAchievements,
  _calendarSnapshot,
  _resetAchievementCatalog,
  initAchievementCatalog,
} from "../lib/achievement-engine.js";
import { up as upSeasonStamp } from "../migrations/236_achievement_season.js";
import { up as upFestivals } from "../migrations/235_festivals.js";

function freshDb() {
  const db = new Database(":memory:");
  // Minimal shape — only what the unlock path touches.
  db.exec(`
    CREATE TABLE player_achievements (
      player_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      earned_at INTEGER,
      PRIMARY KEY (player_id, achievement_id)
    );
    CREATE TABLE player_titles (
      id TEXT PRIMARY KEY, user_id TEXT, world_id TEXT, title TEXT, earned_at INTEGER
    );
    CREATE TABLE user_wallets (user_id TEXT PRIMARY KEY, balance REAL DEFAULT 0);
    CREATE TABLE economy_ledger (id TEXT PRIMARY KEY, user_id TEXT, kind TEXT, amount_cc REAL, ts INTEGER, ref_id TEXT);
  `);
  upSeasonStamp(db);
  upFestivals(db);
  _resetAchievementCatalog();
  initAchievementCatalog(db);
  return db;
}

describe("Phase BB2 — seasonal stamp on unlock", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("unlock stamps season_idx + year_idx from the wall clock", () => {
    const cal = _calendarSnapshot();
    const r = unlockAchievement(db, "u1", "first_blood");
    assert.equal(r.unlocked, true);
    const row = db.prepare(`SELECT season_idx, year_idx FROM player_achievements WHERE player_id = ? AND achievement_id = ?`)
      .get("u1", "first_blood");
    assert.equal(row.season_idx, cal.season_idx);
    assert.equal(row.year_idx, cal.year_idx);
  });

  it("listSeasonalAchievements filters by season + year", () => {
    unlockAchievement(db, "u1", "first_blood");
    unlockAchievement(db, "u1", "first_kill");
    const cal = _calendarSnapshot();
    const list = listSeasonalAchievements(db, "u1", { seasonIdx: cal.season_idx, yearIdx: cal.year_idx });
    assert.equal(list.length, 2);
    const other = listSeasonalAchievements(db, "u1", { seasonIdx: (cal.season_idx + 1) % 6, yearIdx: cal.year_idx });
    assert.equal(other.length, 0, "different season returns empty");
  });
});

describe("Phase BB2 — festival-only gating", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("festival-only achievement is gated when festival not active", () => {
    // No festival_active row.
    const r = unlockAchievement(db, "u1", "wintersday_celebrant");
    assert.equal(r.unlocked, false);
    assert.equal(r.reason, "festival_gated");
  });

  it("festival-only achievement unlocks when festival_active row is present", () => {
    db.prepare(`
      INSERT INTO festival_active (festival_id, world_id, year_idx, ends_at)
      VALUES ('wintersday', 'tunya', 1, unixepoch() + 3600)
    `).run();
    const r = unlockAchievement(db, "u1", "wintersday_celebrant");
    assert.equal(r.unlocked, true);
  });

  it("expired festival_active blocks unlock", () => {
    db.prepare(`
      INSERT INTO festival_active (festival_id, world_id, year_idx, ends_at)
      VALUES ('wintersday', 'tunya', 1, 1)
    `).run();
    const r = unlockAchievement(db, "u1", "wintersday_celebrant");
    assert.equal(r.unlocked, false);
    assert.equal(r.reason, "festival_gated");
  });
});

describe("Phase BB2 — back-compat", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("non-seasonal achievement still unlocks without festival_active table presence", () => {
    // No festival rows; non-festival achievement still unlocks.
    const r = unlockAchievement(db, "u1", "first_blood");
    assert.equal(r.unlocked, true);
  });

  it("PK still prevents re-earning same achievement (regardless of season change)", () => {
    const a = unlockAchievement(db, "u1", "first_blood");
    assert.equal(a.unlocked, true);
    const b = unlockAchievement(db, "u1", "first_blood");
    assert.equal(b.unlocked, false);
    assert.equal(b.alreadyEarned, true);
  });
});
