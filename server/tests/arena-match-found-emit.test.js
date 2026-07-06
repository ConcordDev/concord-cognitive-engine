/**
 * Pinning test for a dead-event-listener + realtime-emit-signature finding
 * (verification-audit campaign): server/routes/arena.js#createMatch emitted
 * 'arena:match:found' with the userId folded into the payload instead of the
 * realtimeEmit(event, payload, {userId}) options object. Since realtimeEmit
 * only room-scopes delivery to `user:<id>` when it receives userId via that
 * 3rd argument, the emit fell through to a global io.emit() broadcast — and
 * even so, no frontend code subscribed to the event at all, so the player
 * who was already waiting in queue never learned their match had formed.
 *
 * Run: node --test server/tests/arena-match-found-emit.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import createArenaRouter from "../routes/arena.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      sparks INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE sparks_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT,
      world_id TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE wagers (
      id TEXT PRIMARY KEY,
      proposer_id TEXT,
      opponent_id TEXT,
      amount INTEGER,
      currency TEXT,
      duel_type TEXT,
      status TEXT,
      escrow_locked INTEGER,
      world_id TEXT,
      proposed_at INTEGER,
      accepted_at INTEGER,
      resolved_at INTEGER,
      winner_id TEXT,
      expires_at INTEGER
    );
    CREATE TABLE player_ratings (
      user_id TEXT PRIMARY KEY,
      rating INTEGER NOT NULL DEFAULT 1200,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      win_streak INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER
    );
    CREATE TABLE arena_queue (
      user_id TEXT PRIMARY KEY,
      rating INTEGER NOT NULL DEFAULT 1200,
      queued_at INTEGER NOT NULL DEFAULT (unixepoch()),
      socket_id TEXT
    );
  `);
  db.prepare("INSERT INTO users (id, sparks) VALUES (?, 100), (?, 100)").run("waiting-user", "joining-user");
  return db;
}

function buildApp(db, emitted) {
  const requireAuth = (req, _res, next) => next();
  const realtimeEmit = (event, payload, options) => emitted.push({ event, payload, options });
  return { router: createArenaRouter({ requireAuth, db, realtimeEmit }), emitted };
}

describe("arena.js — 'arena:match:found' is emitted to both participants with correct room-scoping args", () => {
  let db;

  before(() => { db = freshDb(); });

  it("passes userId via the 3rd realtimeEmit options argument, not folded into payload", async () => {
    const emitted = [];
    const { router } = buildApp(db, emitted);

    // Simulate: waiting-user joins the queue first (no match yet).
    const layerFor = (method, path) => {
      const layer = router.stack.find(
        (l) => l.route && l.route.path === path && l.route.methods[method],
      );
      assert.ok(layer, `route ${method.toUpperCase()} ${path} must exist`);
      return layer.route.stack[layer.route.stack.length - 1].handle;
    };

    const queuePost = layerFor("post", "/queue");

    let waitingRes = null;
    await queuePost(
      { user: { id: "waiting-user" }, body: {} },
      { json: (b) => { waitingRes = b; }, status() { return this; } },
    );
    assert.equal(waitingRes.status, "queued");
    assert.equal(emitted.length, 0, "no match yet — no emit expected");

    // Second player joins — Elo-matches immediately, creating the match.
    let joiningRes = null;
    await queuePost(
      { user: { id: "joining-user" }, body: {} },
      { json: (b) => { joiningRes = b; }, status() { return this; } },
    );
    assert.equal(joiningRes.status, "matched");

    assert.equal(emitted.length, 2, "one emit per participant");
    for (const e of emitted) {
      assert.equal(e.event, "arena:match:found");
      // The real bug: userId must arrive via the options arg (3rd param),
      // which is what realtimeEmit's { userId = "" } destructure — and its
      // io.to(`user:${userId}`) room-scoping — actually reads.
      assert.ok(e.options && typeof e.options.userId === "string" && e.options.userId.length > 0,
        "userId must be passed as the 3rd realtimeEmit argument (options), not only inside payload");
      assert.equal(e.payload.userId, undefined,
        "userId should not be duplicated inside the payload now that it's a real room-scoping option");
      assert.equal(typeof e.payload.matchId, "string");
      assert.equal(typeof e.payload.opponentId, "string");
    }

    // Each participant is scoped to their OWN user room, not each other's.
    const scopedUserIds = emitted.map((e) => e.options.userId).sort();
    assert.deepEqual(scopedUserIds, ["joining-user", "waiting-user"]);
  });
});
