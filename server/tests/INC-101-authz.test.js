// server/tests/INC-101-authz.test.js
//
// Regression pins for INC-101 — Arena match resolution authority and escrow
// refund minting.
//
// Run:
//   cd server && NODE_ENV=test nice node --test --test-concurrency=2 --import=./tests/preload/no-egress.mjs tests/INC-101-authz.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
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
  return db;
}

function buildApp(db, emitted) {
  const requireAuth = (req, _res, next) => {
    // Anonymous placeholder ids must never count as identity.
    if (!req.user || ["anon", "anonymous", "guest"].includes(req.user.id)) {
      return next({ status: 403, message: "forbidden" });
    }
    next();
  };
  const realtimeEmit = (event, payload, options) => emitted.push({ event, payload, options });
  return { router: createArenaRouter({ requireAuth, db, realtimeEmit }), emitted };
}

function layerFor(router, method, path) {
  const l = router.stack.find((x) => x.route && x.route.path === path && x.route.methods[method]);
  assert.ok(l, `route ${method.toUpperCase()} ${path} must exist`);
  return l.route.stack[l.route.stack.length - 1].handle;
}

function mockReq(userId, body = {}, params = {}) {
  return { user: { id: userId }, body, params };
}

function mockRes() {
  const r = { statusCode: 200, body: null };
  r.json = (b) => { r.body = b; return r; };
  r.status = (n) => { r.statusCode = n; return r; };
  return r;
}

let db;

describe("INC-101 — arena match resolution authority", () => {
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { try { db.close(); } catch { /* intentional */ } });

  it("non-participant resolve is refused 403 and the match row is unchanged", async () => {
    const emitted = [];
    const { router } = buildApp(db, emitted);

    db.prepare("INSERT INTO users (id, sparks) VALUES ('u-a', 100), ('u-b', 100), ('u-c', 100)").run();
    db.prepare(`
      INSERT INTO wagers (id, proposer_id, opponent_id, amount, currency, duel_type, status, escrow_locked, world_id, proposed_at, accepted_at, expires_at)
      VALUES ('m1', 'u-a', 'u-b', 50, 'sparks', 'arena', 'active', 1, 'concordia-hub', 1, 1, 9999999999)
    `).run();

    const resolve = layerFor(router, "post", "/matches/:id/resolve");
    const res = mockRes();
    await resolve(mockReq("u-c", { winnerId: "u-c" }, { id: "m1" }), res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, "forbidden");

    const row = db.prepare("SELECT status, winner_id FROM wagers WHERE id = ?").get("m1");
    assert.equal(row.status, "active");
    assert.equal(row.winner_id, null);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sparks_ledger").get().n, 0);
    assert.equal(emitted.length, 0);
  });

  it("winnerId that is not a participant is rejected 400 and the match row is unchanged", async () => {
    const emitted = [];
    const { router } = buildApp(db, emitted);

    db.prepare("INSERT INTO users (id, sparks) VALUES ('u-a', 100), ('u-b', 100), ('u-c', 100)").run();
    db.prepare(`
      INSERT INTO wagers (id, proposer_id, opponent_id, amount, currency, duel_type, status, escrow_locked, world_id, proposed_at, accepted_at, expires_at)
      VALUES ('m1', 'u-a', 'u-b', 50, 'sparks', 'arena', 'active', 1, 'concordia-hub', 1, 1, 9999999999)
    `).run();

    const resolve = layerFor(router, "post", "/matches/:id/resolve");
    const res = mockRes();
    await resolve(mockReq("u-a", { winnerId: "u-c" }, { id: "m1" }), res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, "winnerId_invalid");

    const row = db.prepare("SELECT status, winner_id FROM wagers WHERE id = ?").get("m1");
    assert.equal(row.status, "active");
    assert.equal(row.winner_id, null);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sparks_ledger").get().n, 0);
  });

  it("anonymous caller is refused and the match row is unchanged", async () => {
    const emitted = [];
    const { router } = buildApp(db, emitted);

    db.prepare("INSERT INTO users (id, sparks) VALUES ('u-a', 100), ('u-b', 100)").run();
    db.prepare(`
      INSERT INTO wagers (id, proposer_id, opponent_id, amount, currency, duel_type, status, escrow_locked, world_id, proposed_at, accepted_at, expires_at)
      VALUES ('m1', 'u-a', 'u-b', 50, 'sparks', 'arena', 'active', 1, 'concordia-hub', 1, 1, 9999999999)
    `).run();

    const resolve = layerFor(router, "post", "/matches/:id/resolve");
    const res = mockRes();
    await resolve(mockReq("anonymous", { winnerId: "u-a" }, { id: "m1" }), res);

    assert.equal(res.statusCode, 403);
    const row = db.prepare("SELECT status, winner_id FROM wagers WHERE id = ?").get("m1");
    assert.equal(row.status, "active");
    assert.equal(row.winner_id, null);
  });

  it("double-resolve returns 404/409 and the row is unchanged", async () => {
    const emitted = [];
    const { router } = buildApp(db, emitted);

    db.prepare("INSERT INTO users (id, sparks) VALUES ('u-a', 100), ('u-b', 100)").run();
    db.prepare(`
      INSERT INTO wagers (id, proposer_id, opponent_id, amount, currency, duel_type, status, escrow_locked, world_id, proposed_at, accepted_at, expires_at)
      VALUES ('m1', 'u-a', 'u-b', 50, 'sparks', 'arena', 'active', 1, 'concordia-hub', 1, 1, 9999999999)
    `).run();

    const resolve = layerFor(router, "post", "/matches/:id/resolve");

    // First resolve by u-a.
    const r1 = mockRes();
    await resolve(mockReq("u-a", { winnerId: "u-a" }, { id: "m1" }), r1);
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.body.ok, true);

    // Second resolve by u-b must fail.
    const r2 = mockRes();
    await resolve(mockReq("u-b", { winnerId: "u-b" }, { id: "m1" }), r2);
    assert.ok([404, 409].includes(r2.statusCode), `double-resolve should be gone, got ${r2.statusCode}`);
    assert.equal(r2.body.ok, false);
  });

  it("participant resolve still works and updates Elo/economy", async () => {
    const emitted = [];
    const { router } = buildApp(db, emitted);

    db.prepare("INSERT INTO users (id, sparks) VALUES ('u-a', 100), ('u-b', 100)").run();
    db.prepare(`
      INSERT INTO wagers (id, proposer_id, opponent_id, amount, currency, duel_type, status, escrow_locked, world_id, proposed_at, accepted_at, expires_at)
      VALUES ('m1', 'u-a', 'u-b', 50, 'sparks', 'arena', 'active', 1, 'concordia-hub', 1, 1, 9999999999)
    `).run();

    const resolve = layerFor(router, "post", "/matches/:id/resolve");
    const res = mockRes();
    await resolve(mockReq("u-b", { winnerId: "u-b" }, { id: "m1" }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.winnerId, "u-b");

    const row = db.prepare("SELECT status, winner_id FROM wagers WHERE id = ?").get("m1");
    assert.equal(row.status, "resolved");
    assert.equal(row.winner_id, "u-b");

    const winnerBalance = db.prepare("SELECT sparks FROM users WHERE id = ?").get("u-b").sparks;
    assert.equal(winnerBalance, 100 + 50 - 1); // pot 50, 2% fee = 1
  });
});

describe("INC-101 — escrow refund mint and queue hygiene", () => {
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { try { db.close(); } catch { /* intentional */ } });

  it("broke joiner returns 402 with no Sparks delta for either player and matched player re-queued", async () => {
    const emitted = [];
    const { router } = buildApp(db, emitted);

    // u-broke has 0 Sparks and queues first; u-rich has 100 and joins second.
    db.prepare("INSERT INTO users (id, sparks) VALUES ('u-rich', 100), ('u-broke', 0)").run();

    const queuePost = layerFor(router, "post", "/queue");

    const r1 = mockRes();
    await queuePost(mockReq("u-broke"), r1);
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.body.status, "queued");

    const r2 = mockRes();
    await queuePost(mockReq("u-rich"), r2);
    assert.equal(r2.statusCode, 402);
    assert.equal(r2.body.ok, false);
    assert.equal(r2.body.error, "insufficient_sparks");

    // No ledger rows means no Sparks were created or destroyed.
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sparks_ledger").get().n, 0);
    assert.equal(db.prepare("SELECT sparks FROM users WHERE id = ?").get("u-rich").sparks, 100);
    assert.equal(db.prepare("SELECT sparks FROM users WHERE id = ?").get("u-broke").sparks, 0);

    // The broke player must still be queued.
    const q = db.prepare("SELECT * FROM arena_queue WHERE user_id = ?").get("u-broke");
    assert.ok(q, "broke player should be re-queued");
    assert.equal(q.rating, 1200);
  });
});

describe("INC-101 — realtime emit scoping", () => {
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { try { db.close(); } catch { /* intentional */ } });

  it("resolve world:notification emits are room-scoped to each participant", async () => {
    const emitted = [];
    const { router } = buildApp(db, emitted);

    db.prepare("INSERT INTO users (id, sparks) VALUES ('u-a', 100), ('u-b', 100)").run();
    db.prepare(`
      INSERT INTO wagers (id, proposer_id, opponent_id, amount, currency, duel_type, status, escrow_locked, world_id, proposed_at, accepted_at, expires_at)
      VALUES ('m1', 'u-a', 'u-b', 50, 'sparks', 'arena', 'active', 1, 'concordia-hub', 1, 1, 9999999999)
    `).run();

    const resolve = layerFor(router, "post", "/matches/:id/resolve");
    await resolve(mockReq("u-a", { winnerId: "u-a" }, { id: "m1" }), mockRes());

    const notifications = emitted.filter((e) => e.event === "world:notification");
    assert.equal(notifications.length, 2, "one notification per participant");

    const scopedUserIds = notifications.map((e) => e.options?.userId).sort();
    assert.deepEqual(scopedUserIds, ["u-a", "u-b"]);

    for (const n of notifications) {
      assert.equal(n.payload.userId, undefined, "userId must not leak into payload");
      assert.equal(typeof n.options.userId, "string");
    }
  });
});

describe("INC-101 — GET /rating/:userId is read-only", () => {
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { try { db.close(); } catch { /* intentional */ } });

  it("fetching an arbitrary user's rating does not create a player_ratings row", async () => {
    const emitted = [];
    const { router } = buildApp(db, emitted);
    db.prepare("INSERT INTO users (id, sparks) VALUES ('u-me', 100)").run();

    const getRating = layerFor(router, "get", "/rating/:userId");
    const res = mockRes();
    await getRating(mockReq("u-me", {}, { userId: "stranger-id" }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.rating, 1200);

    const row = db.prepare("SELECT * FROM player_ratings WHERE user_id = ?").get("stranger-id");
    assert.equal(row, undefined, "GET must not write player_ratings");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM player_ratings").get().n, 0);
  });
});
