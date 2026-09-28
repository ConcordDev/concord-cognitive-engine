// tests/runtime/quest-reward-reaction.test.js
//
// Pins the eighth reactor in lib/runtime/reactions.js: quest.reward_granted
// -> a durable summary notification, off a REAL grantQuestRewards() call
// (real transaction, real wallet credit, real inventory insert, real
// (user_id, quest_id) idempotency guard) — same gap class as the other
// waves: the existing "system:notice" toast is real-time-only.
//
// No prior test file existed for lib/quest-rewards.js, so this creates its
// own minimal real-schema DB rather than reusing a sibling harness — the
// module's own REWARD_LOG_TABLE DDL (CREATE TABLE IF NOT EXISTS) plus a
// minimal users/player_inventory, matching exactly the columns
// grantQuestRewards actually writes to.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { grantQuestRewards } from "../../lib/quest-rewards.js";
import { initReactions, _resetReactions } from "../../lib/runtime/reactions.js";
import { _reset as _resetBus } from "../../lib/runtime/event-bus.js";
import { getNotifications } from "../../emergent/social-layer.js";

function freshDb() {
  const db = new Database(":memory:");
  // Mirrors lib/quest-rewards.js's own REWARD_LOG_TABLE DDL exactly — see
  // that file's module-level `_initialized` guard, which only runs its
  // own CREATE TABLE once per PROCESS, not per DB instance, so a test's
  // own fresh :memory: db needs the table created directly here.
  db.exec(`
    CREATE TABLE IF NOT EXISTS quest_reward_grants (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, quest_id TEXT NOT NULL,
      granted_at INTEGER NOT NULL DEFAULT (unixepoch()), gold REAL NOT NULL DEFAULT 0,
      sparks INTEGER NOT NULL DEFAULT 0, skill_xp_json TEXT NOT NULL DEFAULT '{}',
      items_json TEXT NOT NULL DEFAULT '[]', UNIQUE(user_id, quest_id)
    );
    CREATE TABLE users (id TEXT PRIMARY KEY, concordia_credits REAL DEFAULT 0, sparks INTEGER DEFAULT 0);
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY, user_id TEXT, item_type TEXT, item_id TEXT,
      item_name TEXT, quantity INTEGER, quality TEXT, acquired_at INTEGER
    );
  `);
  db.prepare(`INSERT INTO users (id) VALUES ('u1')`).run();
  return db;
}

let db;
beforeEach(() => {
  db = freshDb();
  _resetBus();
  _resetReactions();
  delete globalThis.STATE;
});
afterEach(() => {
  _resetReactions();
  delete globalThis.STATE;
});

describe("quest.reward_granted -> durable notification, off a REAL grantQuestRewards() call", () => {
  it("a real reward grant produces a notification naming what was granted", () => {
    globalThis.STATE = {};
    initReactions();

    const r = grantQuestRewards(db, "u1", "quest_1", { gold: 50, sparks: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.granted.gold, 50, "sanity: real reward math, unrelated to this reactor");

    const { notifications, total } = getNotifications(globalThis.STATE, "u1");
    assert.equal(total, 1);
    assert.equal(notifications[0].type, "quest_reward");
    assert.match(notifications[0].content, /50 CC/);
    assert.match(notifications[0].content, /10 sparks/);
  });

  it("an empty reward table grants nothing and notifies nothing", () => {
    globalThis.STATE = {};
    initReactions();
    const r = grantQuestRewards(db, "u1", "quest_empty", {});
    assert.equal(r.ok, true);
    assert.equal(getNotifications(globalThis.STATE, "u1").total, 0);
  });

  it("a repeat grant for the same (user, quest) — the real idempotency guard — does not double-notify", () => {
    globalThis.STATE = {};
    initReactions();
    grantQuestRewards(db, "u1", "quest_1", { gold: 50 });
    const r2 = grantQuestRewards(db, "u1", "quest_1", { gold: 50 });
    assert.equal(r2.alreadyGranted, true, "sanity: the real (user_id, quest_id) UNIQUE guard fired");
    assert.equal(getNotifications(globalThis.STATE, "u1").total, 1, "still exactly one — no second notification for a no-op repeat");
  });

  it("no STATE yet -> the real grant still succeeds; reactor honestly no-ops", () => {
    initReactions();
    const r = grantQuestRewards(db, "u1", "quest_1", { gold: 50 });
    assert.equal(r.ok, true, "the real gold/sparks/inventory grant must never depend on the reaction graph");
  });
});
