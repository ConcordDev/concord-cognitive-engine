// POST /api/world/sim/mobile/quick-action answers read-only actions from the
// caller's own stored rows. In-memory SQLite only.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createWorldRoutes from "../routes/world.js";

describe("mobile quick-action", () => {
  let db;
  let server;
  let url;

  before(async () => {
    globalThis._concordSTATE = {};
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE world_buildings (
        id TEXT PRIMARY KEY, world_id TEXT NOT NULL, name TEXT,
        building_type TEXT, owner_type TEXT, owner_id TEXT, state TEXT, health_pct REAL
      );
      CREATE TABLE dtus (id TEXT PRIMARY KEY, title TEXT, type TEXT, creator_id TEXT, created_at TEXT);
      CREATE TABLE dtu_citations (dtu_id TEXT PRIMARY KEY, citation_count INTEGER NOT NULL DEFAULT 0);
    `);
    db.prepare(`INSERT INTO world_buildings VALUES
      ('b1','w1','Boathouse','dock','player','user-a','standing',1.0),
      ('b2','w1','Shed','house','player','user-a','damaged',0.5),
      ('b3','w1','Other','house','player','user-b','standing',1.0),
      ('b4','w1','Town Hall','inn','world','user-a','standing',1.0)`).run();
    db.prepare(`INSERT INTO dtus VALUES
      ('d1','Pier','building','user-a',NULL),('d2','Note','note','user-a',NULL),
      ('d3','Theirs','note','user-b',NULL),('mat_x_wood_1_0','Wood','material','user-a',NULL)`).run();
    db.prepare(`INSERT INTO dtu_citations VALUES ('d1',7),('d2',2),('d3',99),('mat_x_wood_1_0',50)`).run();

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
    if (server) await new Promise((r) => server.close(r));
    db?.close();
  });

  async function act(action, user = "user-a") {
    const headers = { "content-type": "application/json" };
    if (user) headers["x-user-id"] = user;
    const res = await fetch(`${url}/api/world/sim/mobile/quick-action`, {
      method: "POST", headers, body: JSON.stringify({ action }),
    });
    return { status: res.status, body: await res.json() };
  }

  it("check-builds lists only the caller's player-owned buildings", async () => {
    const r = await act("check-builds");
    assert.equal(r.status, 200);
    assert.equal(r.body.count, 2);
    assert.deepEqual(r.body.buildings.map((b) => b.id).sort(), ["b1", "b2"]);
  });

  it("view-citations totals the caller's DTUs only, skipping starter inventory", async () => {
    const r = await act("view-citations");
    assert.equal(r.status, 200);
    assert.equal(r.body.totalCitations, 9);
    assert.equal(r.body.dtuCount, 2);
    assert.deepEqual(r.body.topCited[0], { id: "d1", name: "Pier", citations: 7 });
  });

  it("a user with nothing gets real zeros, not another user's data", async () => {
    const r = await act("check-builds", "user-c");
    assert.equal(r.status, 200);
    assert.equal(r.body.count, 0);
    assert.deepEqual(r.body.buildings, []);
  });

  it("requires sign-in", async () => {
    const r = await act("check-builds", null);
    assert.equal(r.status, 401);
  });

  it("toggle-notifications is retired and points at companion push-prefs-set", async () => {
    const r = await act("toggle-notifications");
    assert.equal(r.status, 410);
    assert.equal(r.body.error, "retired");
    assert.equal(r.body.use, "companion.push-prefs-set");
    assert.equal(r.body.action, "toggle-notifications");
    assert.equal(JSON.stringify(r.body).includes("memory per process"), false);
  });

  it("quick-chat without text is a 400 and manage-inventory reads", async () => {
    const chat = await act("quick-chat");
    assert.equal(chat.status, 400);
    assert.equal(chat.body.error, "empty_text");
    const inv = await act("manage-inventory");
    assert.equal(inv.status, 200);
    assert.deepEqual(inv.body.items, []);
    assert.equal(Array.isArray(inv.body.slotNames), true);
  });

  it("unknown action is 400", async () => {
    const r = await act("launch-missiles");
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "unknown_action");
  });
});
