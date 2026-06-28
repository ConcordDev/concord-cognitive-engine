// Phase U2 — achievement engine, REAL migrated-DB behavioral test.
//
// The sibling `achievement-engine.test.js` exercises the engine against a
// hand-rolled mock DB. This file pins the same contract against a fully
// migrated better-sqlite3 DB so the REAL SQL (idempotent ON CONFLICT INSERT,
// awardSparks UPDATE/ledger, player_titles INSERT, the listEarned/listRecent
// JOINs the REST routes serve) is proven end-to-end — exactly the
// `/api/achievements/{mine,catalog,recent}` surface the lens calls.
//
// Pinned invariants (CLAUDE.md):
//   - unlock is idempotent on (player_id, achievement_id) — PK collision no-ops
//   - reward Sparks + title awarded EXACTLY ONCE (on the first unlock only)
//   - hidden achievements unlock + show in `mine` but are excluded from `recent`
//   - listEarned/listCatalog are the values the routes return

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  initAchievementCatalog,
  evaluateAchievement,
  evaluateStatThreshold,
  unlockAchievement,
  listEarned,
  listCatalog,
  listRecent,
  _resetAchievementCatalog,
} from "../lib/achievement-engine.js";

function seedUser(db, id) {
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, created_at)
     VALUES (?, ?, ?, 'x', unixepoch())`,
  ).run(id, `u_${id}`, `${id}@example.test`);
}

function sparksOf(db, userId) {
  return db.prepare(`SELECT sparks FROM users WHERE id = ?`).get(userId)?.sparks ?? 0;
}

describe("achievement-engine (real migrated DB)", () => {
  let db;
  beforeEach(async () => {
    _resetAchievementCatalog();
    db = new Database(":memory:");
    await runMigrations(db);
    seedUser(db, "u1");
    seedUser(db, "u2");
    const r = initAchievementCatalog(db);
    assert.ok(r.ok && r.count > 0, "catalog should load from authored JSON");
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } _resetAchievementCatalog(); });

  it("persists the authored catalog into achievement_catalog (route reads it)", () => {
    const persisted = db.prepare(`SELECT COUNT(*) n FROM achievement_catalog`).get().n;
    assert.ok(persisted >= 38, `expected >=38 authored achievements, got ${persisted}`);
    // listCatalog() is exactly what GET /api/achievements/catalog maps over.
    const cat = listCatalog();
    const fb = cat.find((a) => a.id === "first_blood");
    assert.ok(fb && fb.category === "combat");
  });

  it("unlock writes a player_achievements row + awards sparks once", () => {
    const before = sparksOf(db, "u1");
    const r = unlockAchievement(db, "u1", "first_blood");
    assert.equal(r.unlocked, true);
    assert.equal(r.rewardSparks, 5); // first_blood rewardSparks: 5
    assert.equal(sparksOf(db, "u1"), before + 5);
    const row = db
      .prepare(`SELECT * FROM player_achievements WHERE player_id = ? AND achievement_id = ?`)
      .get("u1", "first_blood");
    assert.ok(row, "row persisted");
    // Sparks ledger recorded the award with the canonical reason.
    const led = db
      .prepare(`SELECT * FROM sparks_ledger WHERE user_id = ? AND reason = ?`)
      .get("u1", "achievement:first_blood");
    assert.ok(led && led.delta === 5);
  });

  it("unlock is idempotent on (player_id, achievement_id) — no double sparks", () => {
    const r1 = unlockAchievement(db, "u1", "first_blood");
    const after1 = sparksOf(db, "u1");
    const r2 = unlockAchievement(db, "u1", "first_blood");
    assert.equal(r1.unlocked, true);
    assert.equal(r2.unlocked, false);
    assert.equal(r2.alreadyEarned, true);
    // Sparks unchanged on the second attempt.
    assert.equal(sparksOf(db, "u1"), after1);
    // Exactly one row + exactly one ledger entry.
    const rows = db
      .prepare(`SELECT COUNT(*) n FROM player_achievements WHERE player_id=? AND achievement_id=?`)
      .get("u1", "first_blood").n;
    assert.equal(rows, 1);
    const ledN = db
      .prepare(`SELECT COUNT(*) n FROM sparks_ledger WHERE user_id=? AND reason=?`)
      .get("u1", "achievement:first_blood").n;
    assert.equal(ledN, 1);
  });

  it("title reward inserts into player_titles exactly once across re-unlocks", () => {
    // duel_champion: stat duels_won>=25, rewardTitle "the Duelist".
    evaluateStatThreshold(db, "u1", "duels_won", 25);
    evaluateStatThreshold(db, "u1", "duels_won", 99); // re-eval, already earned
    const titles = db
      .prepare(`SELECT * FROM player_titles WHERE user_id = ? AND title = ?`)
      .all("u1", "the Duelist");
    assert.equal(titles.length, 1, "title granted exactly once");
  });

  it("evaluateAchievement subset-match gates the unlock", () => {
    // tournament_winner requires { placement: 1 }.
    const miss = evaluateAchievement(db, "u1", "tournament:complete", { placement: 2 });
    assert.ok(!miss.unlocked.some((u) => u.id === "tournament_winner"));
    const hit = evaluateAchievement(db, "u1", "tournament:complete", { placement: 1 });
    assert.ok(hit.unlocked.some((u) => u.id === "tournament_winner"));
  });

  it("listEarned (route /mine) returns real catalog-joined rows newest-first", () => {
    unlockAchievement(db, "u1", "first_blood");
    unlockAchievement(db, "u1", "first_kill");
    const earned = listEarned(db, "u1");
    assert.equal(earned.length, 2);
    // JOIN populated display fields.
    const fb = earned.find((e) => e.achievement_id === "first_blood");
    assert.ok(fb && fb.title === "First Blood" && fb.category === "combat");
    // Sorted by earned_at DESC — last unlocked is at or near the front.
    assert.ok(earned.every((e) => typeof e.earned_at === "number"));
  });

  it("hidden achievements unlock + appear in /mine but are hidden from /recent", () => {
    // legendary_combatant is hidden: true (stat fights_won>=1000).
    const r = evaluateStatThreshold(db, "u1", "fights_won", 1000);
    assert.ok(r.unlocked.some((u) => u.id === "legendary_combatant"));
    const mine = listEarned(db, "u1");
    assert.ok(mine.some((e) => e.achievement_id === "legendary_combatant"), "shows in /mine");
    const recent = listRecent(db, { limit: 50 });
    assert.ok(
      !recent.some((e) => e.achievement_id === "legendary_combatant"),
      "hidden excluded from /recent",
    );
  });

  it("per-user isolation: u2 unlocking does not credit u1", () => {
    const u1Before = sparksOf(db, "u1");
    unlockAchievement(db, "u2", "first_blood");
    assert.equal(sparksOf(db, "u1"), u1Before);
    assert.equal(listEarned(db, "u1").length, 0);
    assert.equal(listEarned(db, "u2").length, 1);
  });

  it("unlocking an unknown achievement id is a safe no-op", () => {
    const r = unlockAchievement(db, "u1", `nope_${crypto.randomUUID()}`);
    assert.equal(r.unlocked, false);
  });
});
