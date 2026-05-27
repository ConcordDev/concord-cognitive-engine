// server/tests/wave-g-world-doors-contract.test.js
//
// Wave G6 — pins the door substrate: open/close idempotence, auto-close
// after >60s, realtime event shape, router contract.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  listForBuilding,
  listForWorld,
  getDoor,
  openDoor,
  closeDoor,
  autoCloseSweep,
} from "../lib/world-doors.js";
import createWorldDoorsRouter from "../routes/world-doors.js";

let db;

function buildSchema(d) {
  d.exec(`
    CREATE TABLE world_doors (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, building_id TEXT NOT NULL,
      hinge_x REAL NOT NULL, hinge_z REAL NOT NULL,
      normal_x REAL DEFAULT 0, normal_z REAL DEFAULT 1,
      state TEXT DEFAULT 'closed', last_opened_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);
}

function seedDoor(d, { id = "door_1", worldId = "w", buildingId = "b1" } = {}) {
  d.prepare(`
    INSERT INTO world_doors (id, world_id, building_id, hinge_x, hinge_z) VALUES (?, ?, ?, 0, 0)
  `).run(id, worldId, buildingId);
}

before(() => { db = new Database(":memory:"); buildSchema(db); });
after(() => { db?.close(); });
beforeEach(() => { db.exec(`DELETE FROM world_doors;`); });

describe("door state machine", () => {
  it("openDoor flips closed → open + stamps last_opened_at", () => {
    seedDoor(db);
    const r = openDoor(db, { doorId: "door_1" });
    assert.equal(r.ok, true);
    assert.equal(r.state, "open");
    const d = getDoor(db, "door_1");
    assert.equal(d.state, "open");
    assert.ok(d.last_opened_at);
  });

  it("openDoor on already-open door refreshes timestamp idempotently", () => {
    seedDoor(db);
    openDoor(db, { doorId: "door_1" });
    db.prepare(`UPDATE world_doors SET last_opened_at = last_opened_at - 30 WHERE id = ?`).run("door_1");
    const r = openDoor(db, { doorId: "door_1" });
    assert.equal(r.ok, true);
    assert.equal(r.refreshed, true);
  });

  it("closeDoor flips open → closed", () => {
    seedDoor(db);
    openDoor(db, { doorId: "door_1" });
    const r = closeDoor(db, { doorId: "door_1" });
    assert.equal(r.ok, true);
    assert.equal(r.state, "closed");
  });

  it("closeDoor on already-closed door is a no-op", () => {
    seedDoor(db);
    const r = closeDoor(db, { doorId: "door_1" });
    assert.equal(r.ok, true);
    assert.equal(r.alreadyClosed, true);
  });

  it("rejects unknown door", () => {
    const r = openDoor(db, { doorId: "nope" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "door_not_found");
  });
});

describe("autoCloseSweep", () => {
  it("closes doors open >60s, leaves fresh ones alone", () => {
    seedDoor(db, { id: "stale" });
    seedDoor(db, { id: "fresh" });
    db.prepare(`UPDATE world_doors SET state = 'open', last_opened_at = unixepoch() - 70 WHERE id = 'stale'`).run();
    db.prepare(`UPDATE world_doors SET state = 'open', last_opened_at = unixepoch() - 10 WHERE id = 'fresh'`).run();
    const r = autoCloseSweep(db);
    assert.equal(r.ok, true);
    assert.equal(r.closed, 1);
    assert.equal(getDoor(db, "stale").state, "closed");
    assert.equal(getDoor(db, "fresh").state, "open");
  });
});

describe("listing", () => {
  it("listForBuilding / listForWorld return rows", () => {
    seedDoor(db, { id: "d1", buildingId: "b1" });
    seedDoor(db, { id: "d2", buildingId: "b2" });
    assert.equal(listForBuilding(db, "b1").length, 1);
    assert.equal(listForWorld(db, "w").length, 2);
  });
});

describe("router contract", () => {
  let router;
  before(() => {
    router = createWorldDoorsRouter({
      db,
      requireAuth: (req, _res, next) => { req.user = { id: "U1" }; next(); },
    });
  });

  function invoke(method, path, body = {}, params = {}) {
    return new Promise((resolve) => {
      let status = 200;
      const req = {
        method, url: path, headers: {}, params, body,
        query: Object.fromEntries(new URL(`http://x${path}`).searchParams),
        app: { locals: { io: { to: () => ({ emit: () => {} }) } } },
      };
      const res = {
        status(c) { status = c; return this; },
        json(b) { resolve({ status, body: b }); },
      };
      router.handle(req, res, () => resolve({ status: 404, body: null }));
    });
  }

  it("POST /:id/open returns the new state", async () => {
    seedDoor(db, { id: "d_route" });
    const r = await invoke("POST", "/d_route/open", {}, { doorId: "d_route" });
    assert.equal(r.status, 200);
    assert.equal(r.body.state, "open");
  });

  it("POST /:id/close returns the new state", async () => {
    seedDoor(db, { id: "d_close" });
    openDoor(db, { doorId: "d_close" });
    const r = await invoke("POST", "/d_close/close", {}, { doorId: "d_close" });
    assert.equal(r.status, 200);
    assert.equal(r.body.state, "closed");
  });

  it("404 on missing door", async () => {
    const r = await invoke("POST", "/nope/open", {}, { doorId: "nope" });
    assert.equal(r.status, 404);
  });
});

describe("migration backfill (integration)", () => {
  // Verifies that migration 215 backfills one door per existing world_buildings row.
  it("creates one door per building, idempotent on repeat", async () => {
    const d = new Database(":memory:");
    d.exec(`
      CREATE TABLE world_buildings (
        id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT,
        x REAL, y REAL, z REAL, rotation REAL DEFAULT 0,
        width REAL DEFAULT 10, depth REAL DEFAULT 10, height REAL DEFAULT 8
      );
      INSERT INTO world_buildings (id, world_id, building_type, x, y, z) VALUES
        ('b_inn', 'w', 'inn', 0, 0, 0),
        ('b_smith', 'w', 'forge', 20, 0, 10);
    `);
    const { up } = await import("../migrations/215_world_doors.js");
    up(d);
    let doors = d.prepare(`SELECT * FROM world_doors`).all();
    assert.equal(doors.length, 2, "one door per building");
    // Repeat migration — should NOT duplicate.
    up(d);
    doors = d.prepare(`SELECT * FROM world_doors`).all();
    assert.equal(doors.length, 2, "idempotent");
    d.close();
  });
});
