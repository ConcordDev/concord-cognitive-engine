// tests/runtime/achievement-unlock-reaction.test.js
//
// Pins the fourth reactor in lib/runtime/reactions.js: achievement.unlocked
// -> a PERSISTENT notification, the same "existing toast is real-time-only"
// gap class as marketplace.purchased. Exercised against the REAL migrated
// DB + the REAL authored achievement catalog (not a mock), the same
// harness tests/achievement-engine-realdb.test.js already established —
// so this proves the reaction fires off an ACTUAL unlockAchievement() call
// with real idempotent-PK/sparks/title side effects happening alongside it,
// not a synthetic publish().
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../../migrate.js";
import { initAchievementCatalog, unlockAchievement, _resetAchievementCatalog } from "../../lib/achievement-engine.js";
import { initReactions, _resetReactions } from "../../lib/runtime/reactions.js";
import { _reset as _resetBus } from "../../lib/runtime/event-bus.js";
import { getNotifications } from "../../emergent/social-layer.js";

function seedUser(db, id) {
  db.prepare(`INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, 'x', unixepoch())`)
    .run(id, `u_${id}`, `${id}@example.test`);
}

describe("achievement.unlocked -> durable notification, off a REAL unlockAchievement() call", () => {
  let db;
  beforeEach(async () => {
    _resetAchievementCatalog();
    _resetBus();
    _resetReactions();
    delete globalThis.STATE;
    db = new Database(":memory:");
    await runMigrations(db);
    seedUser(db, "u1");
    initAchievementCatalog(db);
  });
  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
    _resetAchievementCatalog();
    _resetReactions();
    delete globalThis.STATE;
  });

  it("a real unlock produces a real persistent notification naming the achievement", () => {
    globalThis.STATE = {};
    initReactions();

    const r = unlockAchievement(db, "u1", "first_blood");
    assert.equal(r.unlocked, true, "sanity: the real unlock actually happened");

    const { notifications, total } = getNotifications(globalThis.STATE, "u1");
    assert.equal(total, 1);
    assert.equal(notifications[0].type, "achievement_unlocked");
    assert.match(notifications[0].content, /first_blood|Achievement unlocked/i);
  });

  it("mentions reward sparks/title when the achievement grants them", () => {
    globalThis.STATE = {};
    initReactions();
    const r = unlockAchievement(db, "u1", "first_blood");
    assert.equal(r.rewardSparks, 5, "sanity: first_blood really does grant 5 sparks");

    const { notifications } = getNotifications(globalThis.STATE, "u1");
    assert.match(notifications[0].content, /5 sparks/);
  });

  it("a duplicate unlock attempt (idempotent no-op) does NOT produce a second notification", () => {
    globalThis.STATE = {};
    initReactions();
    unlockAchievement(db, "u1", "first_blood");
    const r2 = unlockAchievement(db, "u1", "first_blood");
    assert.equal(r2.alreadyEarned, true, "sanity: the second call really was a no-op");

    assert.equal(getNotifications(globalThis.STATE, "u1").total, 1, "still exactly one — the reactor never fires for an already-earned achievement");
  });

  it("no STATE yet -> the real unlock still succeeds; reactor honestly no-ops", () => {
    initReactions();
    // globalThis.STATE deliberately left unset.
    const r = unlockAchievement(db, "u1", "first_blood");
    assert.equal(r.unlocked, true, "the real gameplay effect (sparks, PK row) must never depend on the reaction graph");
  });
});
