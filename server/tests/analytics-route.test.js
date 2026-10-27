/**
 * Tier-2 contract tests for the analytics aggregator
 * (/api/analytics).
 *
 * Pins the response shape and the missing-table tolerance — analytics
 * is best-effort, not load-bearing. A missing personal or world source
 * is null with a reason. A real query can still return 0. The no-user
 * envelope stays numeric zeros. Global site totals stay on the empty
 * fallback when their tables are absent.
 *
 * The route depends on a real Express app + db, so we exercise the
 * underlying helpers by directly importing them. Routes are
 * smoke-tested via a lightweight stub.
 *
 * Run: node --test tests/analytics-route.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import Database from "better-sqlite3";
import { registerAnalyticsRoutes } from "../routes/analytics.js";

function makeStubApp() {
  const handlers = new Map();
  const stub = {
    get: (path, handler) => {
      // asyncHandler-wrapped handlers are functions; the wrapper passes
      // (req, res, next). We strip that here.
      handlers.set(`GET:${path}`, handler);
    },
  };
  return { stub, handlers };
}

async function callRoute(handlers, path, req = {}) {
  const handler = handlers.get(`GET:${path}`);
  let body;
  let statusCode = 200;
  const res = {
    json: (b) => { body = b; return res; },
    status: (s) => { statusCode = s; return res; },
  };
  await handler(req, res, () => {});
  return { body, statusCode };
}

const asyncHandler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message });
  }
};

let db;

beforeEach(() => {
  db = new Database(":memory:");
});

describe("/api/analytics — missing tables tolerance", () => {
  it("returns null with a reason when the signed-in caller's source tables are missing", async () => {
    const { stub, handlers } = makeStubApp();
    registerAnalyticsRoutes(stub, { db, asyncHandler });
    const { body, statusCode } = await callRoute(handlers, "/api/analytics", { user: { id: "u1" }, query: {} });

    assert.equal(statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.personalStats.totalCitations, null);
    assert.equal(body.personalStats.totalRoyalties, null);
    assert.equal(body.personalStats.royaltyReason, "no_ledger_table");
    assert.equal(body.personalStats.buildCount, null);
    assert.equal(body.personalStats.buildReason, "no_building_table");
    assert.equal(body.personalStats.loginStreak, null);
    assert.equal(body.personalStats.loginStreakReason, "no_streak_table");
    assert.equal(body.personalStats.playtime, null);
    assert.equal(body.personalStats.playtimeReason, "no_visit_table");
    assert.equal(body.personalStats.mostUsedMaterial, null);
    assert.equal(body.personalStats.mostUsedMaterialReason, "not_recorded");
    assert.equal(body.personalStats.reputationReason, "no_reputation_table");
    assert.deepEqual(Object.keys(body.personalStats.reputationByDomain).sort(), [
      "architecture", "energy", "exploration", "governance",
      "infrastructure", "materials", "mentorship", "structural",
    ]);
    assert.ok(Object.values(body.personalStats.reputationByDomain).every((v) => v === null));
    assert.equal(body.globalStats.totalBuildings, 0);
    assert.equal(body.globalStats.totalWorlds, 0);
    assert.deepEqual(body.globalStats.trendingComponents, []);
    assert.deepEqual(body.globalStats.topCreators, []);
    assert.equal(body.worldStats, null);

    const anon = await callRoute(handlers, "/api/analytics", { query: {} });
    assert.equal(anon.body.personalStats.totalCitations, 0);
    assert.equal(anon.body.personalStats.totalRoyalties, 0);
    assert.equal(anon.body.personalStats.buildCount, 0);
    assert.equal(anon.body.personalStats.loginStreak, 0);
  });
});

describe("/api/analytics — with seeded data", () => {
  it("returns world stats when worldId param is given", async () => {
    db.exec(`
      CREATE TABLE world_buildings (
        id TEXT PRIMARY KEY, world_id TEXT, created_by TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE world_visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT, user_id TEXT,
        arrived_at TEXT DEFAULT (datetime('now')), departed_at TEXT
      );
    `);
    db.prepare("INSERT INTO world_buildings (id, world_id, created_by) VALUES (?, ?, ?)").run("b1", "w1", "u1");
    db.prepare("INSERT INTO world_buildings (id, world_id, created_by) VALUES (?, ?, ?)").run("b2", "w1", "u2");
    db.prepare("INSERT INTO world_visits (world_id, user_id, departed_at) VALUES (?, ?, NULL)").run("w1", "u1");
    db.prepare("INSERT INTO world_visits (world_id, user_id, departed_at) VALUES (?, ?, datetime('now'))").run("w1", "u3");

    const { stub, handlers } = makeStubApp();
    registerAnalyticsRoutes(stub, { db, asyncHandler });

    const { body } = await callRoute(handlers, "/api/analytics", { user: { id: "u1" }, query: { worldId: "w1" } });
    assert.equal(body.worldStats.worldId, "w1");
    assert.equal(body.worldStats.buildingCount, 2);
    assert.equal(body.worldStats.population, 1); // only u1 has departed_at IS NULL
    assert.equal(body.worldStats.visitorCount, 2);
    assert.equal(body.worldStats.timeseries.length, 7);
    // No state column: two buildings is not a measured coverage percent.
    assert.equal(body.worldStats.infraCoverage, null);
    assert.equal(body.worldStats.infraReason, "no_building_state");
    assert.equal(body.worldStats.envScore, null);
    assert.equal(body.worldStats.envReason, "no_metrics_table");
  });

  it("measures standing coverage and the stored ecosystem average", async () => {
    db.exec(`
      CREATE TABLE world_buildings (
        id TEXT PRIMARY KEY, world_id TEXT, state TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE player_world_metrics (
        user_id TEXT NOT NULL, world_id TEXT NOT NULL,
        ecosystem_score REAL NOT NULL,
        PRIMARY KEY (user_id, world_id)
      );
    `);
    db.prepare("INSERT INTO world_buildings (id, world_id, state) VALUES (?, ?, ?)").run("b1", "w1", "standing");
    db.prepare("INSERT INTO world_buildings (id, world_id, state) VALUES (?, ?, ?)").run("b2", "w1", "standing");
    db.prepare("INSERT INTO world_buildings (id, world_id, state) VALUES (?, ?, ?)").run("b3", "w1", "collapsed");
    db.prepare("INSERT INTO player_world_metrics (user_id, world_id, ecosystem_score) VALUES (?, ?, ?)").run("u1", "w1", 0.2);
    db.prepare("INSERT INTO player_world_metrics (user_id, world_id, ecosystem_score) VALUES (?, ?, ?)").run("u2", "w1", 0.8);

    const { stub, handlers } = makeStubApp();
    registerAnalyticsRoutes(stub, { db, asyncHandler });
    const { body } = await callRoute(handlers, "/api/analytics", { user: { id: "u1" }, query: { worldId: "w1" } });
    assert.equal(body.worldStats.buildingCount, 3);
    assert.equal(body.worldStats.infraCoverage, 67);
    assert.equal(body.worldStats.infraReason, null);
    assert.equal(body.worldStats.envScore, 0.5);
    assert.equal(body.worldStats.envReason, null);

    db.exec(`DELETE FROM world_buildings`);
    const empty = await callRoute(handlers, "/api/analytics", { user: { id: "u1" }, query: { worldId: "w1" } });
    assert.equal(empty.body.worldStats.infraCoverage, null);
    assert.equal(empty.body.worldStats.infraReason, "no_buildings");

    db.prepare("INSERT INTO world_buildings (id, world_id, state) VALUES (?, ?, ?)").run("b4", "w1", "collapsed");
    const fallen = await callRoute(handlers, "/api/analytics", { user: { id: "u1" }, query: { worldId: "w1" } });
    assert.equal(fallen.body.worldStats.infraCoverage, 0);
    assert.equal(fallen.body.worldStats.infraReason, null);
  });

  it("personalStats filters royalties by recipient (to_user_id)", async () => {
    db.exec(`
      CREATE TABLE economy_ledger (
        id TEXT PRIMARY KEY, type TEXT, from_user_id TEXT, to_user_id TEXT,
        amount REAL, fee REAL DEFAULT 0, net REAL,
        status TEXT, metadata_json TEXT, created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    db.prepare(`INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, net, status)
      VALUES (?, 'citation_royalty', 'buyer', 'u-target', 10, 7, 'complete')`).run("e1");
    db.prepare(`INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, net, status)
      VALUES (?, 'citation_royalty', 'buyer', 'u-target', 3, 2.5, 'complete')`).run("e2");
    db.prepare(`INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, net, status)
      VALUES (?, 'citation_royalty', 'buyer', 'u-other', 99, 50, 'complete')`).run("e3");

    const { stub, handlers } = makeStubApp();
    registerAnalyticsRoutes(stub, { db, asyncHandler });

    const { body } = await callRoute(handlers, "/api/analytics", { user: { id: "u-target" }, query: {} });
    assert.equal(body.personalStats.totalCitations, 2);
    assert.equal(body.personalStats.totalRoyalties, 9.5);
  });

  it("globalStats aggregates trending + top creators", async () => {
    db.exec(`
      CREATE TABLE economy_ledger (
        id TEXT PRIMARY KEY, type TEXT, from_user_id TEXT, to_user_id TEXT,
        amount REAL, fee REAL DEFAULT 0, net REAL,
        status TEXT, metadata_json TEXT, created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE dtus (
        id TEXT PRIMARY KEY, data TEXT, creator_id TEXT
      );
    `);
    db.prepare("INSERT INTO dtus (id, data, creator_id) VALUES (?, ?, ?)").run("d1", '{"human_summary":"Beam A"}', "c1");
    db.prepare("INSERT INTO dtus (id, data, creator_id) VALUES (?, ?, ?)").run("d2", '{"human_summary":"Plate B"}', "c2");
    for (let i = 0; i < 5; i++) {
      db.prepare(`INSERT INTO economy_ledger (id, type, to_user_id, amount, net, status, metadata_json)
        VALUES (?, 'citation_royalty', 'c1', 1, 0.7, 'complete', ?)`)
        .run(`x${i}`, JSON.stringify({ dtuId: "d1" }));
    }
    for (let i = 0; i < 3; i++) {
      db.prepare(`INSERT INTO economy_ledger (id, type, to_user_id, amount, net, status, metadata_json)
        VALUES (?, 'citation_royalty', 'c2', 1, 0.7, 'complete', ?)`)
        .run(`y${i}`, JSON.stringify({ dtuId: "d2" }));
    }

    const { stub, handlers } = makeStubApp();
    registerAnalyticsRoutes(stub, { db, asyncHandler });
    const { body } = await callRoute(handlers, "/api/analytics", { user: { id: "anon" }, query: {} });

    assert.equal(body.globalStats.totalCitations, 8);
    assert.equal(body.globalStats.trendingComponents[0].name, "Beam A");
    assert.equal(body.globalStats.trendingComponents[0].citationsThisWeek, 5);
    assert.equal(body.globalStats.topCreators[0].userId, "c1");
    assert.equal(body.globalStats.topCreators[0].rank, 1);
    assert.equal(body.globalStats.topCreators[1].userId, "c2");
    assert.equal(body.globalStats.topCreators[1].rank, 2);
  });
});
