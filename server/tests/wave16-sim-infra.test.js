// Sim health, hub counts, and the mobile dashboard used to answer with a
// fixed population and a story about a tower that was never stored.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createWorldRoutes from "../routes/world.js";
import { _resetSimInfraMemory } from "../lib/sim-infra.js";

describe("world sim infra reads stored counts", () => {
  let db;
  let server;
  let url;

  before(async () => {
    _resetSimInfraMemory();
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE worlds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        population INTEGER NOT NULL DEFAULT 0,
        total_visits INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE world_buildings (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        name TEXT
      );
      CREATE TABLE dtus (
        id TEXT PRIMARY KEY,
        title TEXT,
        type TEXT,
        creator_id TEXT,
        created_at TEXT
      );
      CREATE TABLE dtu_citations (
        dtu_id TEXT PRIMARY KEY,
        citation_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE economy_ledger (
        id TEXT PRIMARY KEY,
        to_user_id TEXT,
        type TEXT,
        status TEXT,
        net REAL
      );
    `);
    db.prepare(`INSERT INTO worlds (id, name, population, total_visits) VALUES ('world-1', 'Pier', 4, 9)`).run();
    db.prepare(`INSERT INTO world_buildings (id, world_id, name) VALUES ('b1', 'world-1', 'Boathouse'), ('b2', 'world-1', 'Shed')`).run();
    db.prepare(`
      INSERT INTO dtus (id, title, type, creator_id, created_at)
      VALUES ('dtu-pier', 'Pier Beam Catalog', 'building', 'user-a', datetime('now')),
             ('dtu-old', 'Old Note', 'note', 'user-a', '2000-01-01 00:00:00'),
             ('mat_usera_wood_1_0', 'Wood', 'material', 'user-a', '2000-01-01 00:00:00')
    `).run();
    db.prepare(`INSERT INTO dtu_citations (dtu_id, citation_count) VALUES ('dtu-pier', 3)`).run();
    db.prepare(`
      INSERT INTO economy_ledger (id, to_user_id, type, status, net)
      VALUES ('led-1', 'user-a', 'ROYALTY_PAYOUT', 'complete', 1.5)
    `).run();

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const id = req.headers["x-user-id"];
      if (id) req.user = { id: String(id) };
      next();
    });
    app.use("/api/world", createWorldRoutes({ db }));
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        url = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    db?.close();
    _resetSimInfraMemory();
  });

  async function call(path, { user, method = "GET", body } = {}) {
    const headers = {};
    if (user) headers["x-user-id"] = user;
    if (body) headers["content-type"] = "application/json";
    const res = await fetch(`${url}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  }

  it("reports this process and stored counts, not a fake fleet", async () => {
    const health = await call("/api/world/sim/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.services.length, 1);
    assert.equal(health.body.services[0].name, "world-routes");
    assert.equal(health.body.services[0].latencyMs, null);
    assert.equal(typeof health.body.services[0].uptimeSec, "number");
    assert.equal(JSON.stringify(health.body).includes("99.97"), false);

    const metrics = await call("/api/world/sim/metrics");
    assert.equal(metrics.status, 200);
    assert.equal(metrics.body.metrics.worldCount, 1);
    assert.equal(metrics.body.metrics.buildingCount, 2);
    assert.equal(metrics.body.metrics.dtusCreated24h, 1);
    const nowS = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO dtus (id, title, creator_id, created_at)
      VALUES ('dtu-unix-new', 'Unix New', 'user-a', ?),
             ('dtu-unix-old', 'Unix Old', 'user-a', ?)
    `).run(nowS, nowS - 10 * 24 * 3600);
    const withUnix = await call("/api/world/sim/metrics");
    assert.equal(withUnix.body.metrics.dtusCreated24h, 2);
    db.prepare(`
      INSERT INTO dtus (id, title, creator_id, created_at, type)
      VALUES ('mat_usera_wood_2_0', 'Wood', 'user-a', ?, 'material')
    `).run(nowS);
    const withStarter = await call("/api/world/sim/metrics");
    assert.equal(withStarter.body.metrics.dtusCreated24h, 2);
    db.prepare(`DELETE FROM dtus WHERE id IN ('dtu-unix-new', 'dtu-unix-old', 'mat_usera_wood_2_0')`).run();
    // 13-digit unix MILLISECOND values: "now" counts, 10 days ago does not.
    // Without the ms→s division these compare as far in the future and both count.
    db.prepare(`
      INSERT INTO dtus (id, title, creator_id, created_at)
      VALUES ('dtu-ms-new', 'Ms New', 'user-a', ?),
             ('dtu-ms-old', 'Ms Old', 'user-a', ?)
    `).run(Date.now(), Date.now() - 10 * 24 * 3600 * 1000);
    // Baseline here is 1 (dtu-pier); only the ms "now" row adds to it.
    const withMs = await call("/api/world/sim/metrics");
    assert.equal(withMs.body.metrics.dtusCreated24h, 2);
    db.prepare(`DELETE FROM dtus WHERE id IN ('dtu-ms-new', 'dtu-ms-old')`).run();
    assert.equal(metrics.body.unavailable.activePlayers, "not_recorded");
    assert.equal(metrics.body.unavailable.cacheHitRate, "no_cache_stats");
    assert.equal(metrics.body.metrics.activePlayers, undefined);
    assert.equal(JSON.stringify(metrics.body).includes("1847"), false);

    const bus = await call("/api/world/sim/eventbus/status");
    assert.equal(bus.status, 501);
    assert.equal(bus.body.reason, "no_event_bus");
    assert.equal(bus.body.channels, undefined);

    const jobs = await call("/api/world/sim/jobs/queue-status");
    assert.equal(jobs.status, 501);
    assert.equal(jobs.body.reason, "no_job_queue");

    const cache = await call("/api/world/sim/cache/status");
    assert.equal(cache.status, 200);
    assert.equal(cache.body.provider, null);
    assert.equal(cache.body.hitRate, null);
    assert.equal(typeof cache.body.processHeapUsedMB, "number");
    assert.equal(JSON.stringify(cache.body).includes("84200"), false);
  });

  it("reads the hub, citations, and an empty timeline from stored rows", async () => {
    const hub = await call("/api/world/sim/concordia");
    assert.equal(hub.status, 200);
    assert.equal(hub.body.concordia.worldCount, 1);
    assert.equal(hub.body.concordia.population, 4);
    assert.equal(hub.body.concordia.totalVisits, 9);
    assert.equal(hub.body.concordia.buildingCount, 2);
    assert.equal(hub.body.concordia.districts, null);
    assert.equal(hub.body.concordia.activeUsers, null);
    assert.equal(JSON.stringify(hub.body).includes("8200"), false);

    const board = await call("/api/world/sim/leaderboards/exchange");
    assert.equal(board.status, 200);
    assert.equal(board.body.scope, "global");
    assert.equal(board.body.mostCitedCreator[0].userId, "user-a");
    assert.equal(board.body.mostCitedCreator[0].score, 3);
    assert.equal(board.body.mostCitedCreator[0].displayName, null);
    assert.equal(board.body.highestHabitability, null);
    assert.equal(JSON.stringify(board.body).includes("@engineer_jane"), false);

    const timeline = await call("/api/world/sim/timeline/exchange");
    assert.equal(timeline.status, 200);
    assert.deepEqual(timeline.body.snapshots, []);
    assert.equal(timeline.body.reason, "no_snapshot_store");

    const scene = await call("/api/world/sim/scene/exchange");
    assert.equal(scene.status, 200);
    assert.equal(scene.body.scene.terrain, null);
    assert.equal(scene.body.scene.weather, null);
    assert.equal(scene.body.scene.timeOfDay, null);
    assert.deepEqual(scene.body.scene.buildings, []);

    const stress = await call("/api/world/sim/stress-test", { method: "POST", body: { districtId: "exchange", magnitude: 7 } });
    assert.equal(stress.status, 501);
    assert.equal(stress.body.reason, "no_structural_model");
    assert.equal(JSON.stringify(stress.body).includes("bldg-001"), false);
  });

  it("keeps the mobile dashboard and notification profile on the caller", async () => {
    const stranger = await call("/api/world/sim/mobile/dashboard/user-a");
    assert.equal(stranger.status, 403);

    const dash = await call("/api/world/sim/mobile/dashboard/user-a", { user: "user-a" });
    assert.equal(dash.status, 200);
    assert.equal(dash.body.dashboard.quickStats.dtuCount, 2);
    assert.equal(dash.body.dashboard.quickStats.citationCount, 3);
    assert.equal(dash.body.dashboard.quickStats.royalties, 1.5);
    assert.equal(dash.body.dashboard.quickStats.friendsOnline, null);
    assert.equal(dash.body.dashboard.remoteViewAvailable, false);
    assert.deepEqual(dash.body.dashboard.overnightChanges, []);
    const blob = JSON.stringify(dash.body);
    assert.equal(blob.includes("riverside"), false);
    assert.equal(blob.includes("2.35"), false);

    const action = await call("/api/world/sim/mobile/quick-action", {
      method: "POST",
      user: "user-a",
      body: { action: "check-builds" },
    });
    // This fixture's world_buildings has no owner column, so builds cannot be
    // attributed to a user: honest 501 naming the action.
    assert.equal(action.status, 501);
    assert.equal(action.body.reason, "buildings_not_attributed");
    assert.equal(action.body.action, "check-builds");
    assert.equal(action.body.executed, undefined);

    const chat = await call("/api/world/sim/mobile/quick-action", {
      method: "POST",
      user: "user-a",
      body: { action: "quick-chat" },
    });
    assert.equal(chat.status, 501);
    assert.equal(chat.body.reason, "action_not_wired");
    assert.equal(chat.body.action, "quick-chat");

    const plugins = await call("/api/world/sim/plugins/catalog");
    assert.equal(plugins.status, 200);
    assert.deepEqual(plugins.body.plugins, []);
    assert.equal(plugins.body.unavailable.databaseRows, "no_plugin_gallery_table");

    const empty = await call("/api/world/sim/smart-notifications/user-a", { user: "user-a" });
    assert.equal(empty.status, 501);
    assert.equal(empty.body.reason, "no_saved_profile");

    const saved = await call("/api/world/sim/smart-notifications/user-a", {
      method: "POST",
      user: "user-a",
      body: { quietHoursStart: "22:00", quietHoursEnd: "08:00", batchingEnabled: true, batchInterval: 300000 },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.profile.quietHoursStart, "22:00");
    assert.equal(saved.body.profile.durable, false);

    const again = await call("/api/world/sim/smart-notifications/user-a", { user: "user-a" });
    assert.equal(again.body.profile.quietHoursStart, "22:00");

    const learned = await call("/api/world/sim/smart-notifications/user-a/learn", {
      method: "POST",
      user: "user-a",
      body: { type: "citation", action: "dismissed", timeToAction: 1200 },
    });
    assert.equal(learned.status, 200);
    assert.equal(learned.body.durable, false);
    assert.equal(learned.body.signal.action, "dismissed");

    const other = await call("/api/world/sim/smart-notifications/user-a", { user: "user-b" });
    assert.equal(other.status, 403);
  });
});
