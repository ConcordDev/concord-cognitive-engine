// Digest and analytics used to answer with a random citation count and a
// beam that was never stored. These tests insert the row and require it back.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createWorldRoutes from "../routes/world.js";

describe("world sim digest and analytics read stored counts", () => {
  let db;
  let server;
  let url;

  before(async () => {
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
        tags_json TEXT,
        creator_id TEXT
      );
      CREATE TABLE dtu_citations (
        dtu_id TEXT PRIMARY KEY,
        citation_count INTEGER NOT NULL DEFAULT 0,
        last_cited TEXT
      );
      CREATE TABLE economy_ledger (
        id TEXT PRIMARY KEY,
        to_user_id TEXT,
        type TEXT,
        status TEXT,
        net REAL
      );
      CREATE TABLE royalty_lineage (
        id TEXT PRIMARY KEY,
        child_id TEXT,
        parent_id TEXT,
        created_at TEXT
      );
    `);
    db.prepare(`INSERT INTO worlds (id, name, population, total_visits) VALUES ('world-1', 'Pier', 4, 9)`).run();
    db.prepare(`INSERT INTO world_buildings (id, world_id, name) VALUES ('b1', 'world-1', 'Boathouse'), ('b2', 'world-1', 'Shed')`).run();
    db.prepare(`
      INSERT INTO dtus (id, title, type, tags_json, creator_id)
      VALUES ('dtu-pier', 'Pier Beam Catalog', 'building', '[]', 'user-a'),
             ('dtu-note', 'Quiet Note', 'note', '[]', 'user-a')
    `).run();
    db.prepare(`INSERT INTO dtu_citations (dtu_id, citation_count, last_cited) VALUES ('dtu-pier', 3, '2026-10-01')`).run();
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
  });

  async function call(path, user) {
    const headers = user ? { "x-user-id": user } : {};
    const res = await fetch(`${url}${path}`, { headers });
    return { status: res.status, body: await res.json() };
  }

  it("refuses another user's digest and returns stored citations", async () => {
    const stranger = await call("/api/world/sim/digest/user-a");
    assert.equal(stranger.status, 403);

    const mine = await call("/api/world/sim/digest/user-a", "user-a");
    assert.equal(mine.status, 200);
    assert.equal(mine.body.digest.citations, 3);
    assert.equal(mine.body.digest.royaltiesEarned, 1.5);
    assert.equal(mine.body.digest.topCreation.name, "Pier Beam Catalog");
    assert.equal(mine.body.digest.topCreation.citations, 3);
    assert.equal(mine.body.digest.newCitations, null);
    assert.equal(mine.body.digest.npcSummary, null);
    assert.deepEqual(mine.body.digest.worldEvents, []);
    const blob = JSON.stringify(mine.body);
    assert.equal(blob.includes("USB-A"), false);
    assert.equal(blob.includes("blacksmith"), false);
  });

  it("returns stored personal, world, and global counts", async () => {
    const personal = await call("/api/world/sim/analytics/personal/user-a", "user-a");
    assert.equal(personal.status, 200);
    assert.equal(personal.body.stats.totalCitations, 3);
    assert.equal(personal.body.stats.totalRoyalties, 1.5);
    assert.equal(personal.body.stats.mostCitedDTU.name, "Pier Beam Catalog");
    assert.equal(personal.body.stats.buildCount, 2);
    assert.equal(personal.body.stats.playtime, null);
    assert.equal(personal.body.stats.loginStreak, null);
    assert.equal(personal.body.stats.mostUsedMaterial, null);
    assert.equal(JSON.stringify(personal.body).includes("USB-A"), false);

    const other = await call("/api/world/sim/analytics/personal/user-a", "user-b");
    assert.equal(other.status, 403);

    const world = await call("/api/world/sim/analytics/world/world-1");
    assert.equal(world.status, 200);
    assert.equal(world.body.stats.population, 4);
    assert.equal(world.body.stats.buildingCount, 2);
    assert.equal(world.body.stats.visitorCount, 9);
    assert.equal(world.body.stats.timeseries, null);
    assert.equal(world.body.stats.infraCoverage, null);

    const missing = await call("/api/world/sim/analytics/world/nope");
    assert.equal(missing.status, 404);

    const global = await call("/api/world/sim/analytics/global");
    assert.equal(global.status, 200);
    assert.equal(global.body.stats.totalWorlds, 1);
    assert.equal(global.body.stats.totalBuildings, 2);
    assert.equal(global.body.stats.totalCitations, 3);
    assert.equal(global.body.stats.activeUsers, null);
    assert.equal(global.body.stats.topCreators[0].userId, "user-a");
    assert.equal(global.body.stats.topCreators[0].citations, 3);
    assert.equal(global.body.stats.topCreators[0].name, null);
    assert.equal(JSON.stringify(global.body).includes("@engineer_jane"), false);
    assert.equal(JSON.stringify(global.body).includes("45000"), false);
  });
});
