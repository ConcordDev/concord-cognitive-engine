// server/tests/wave6-settlement.test.js
//
// Wave 6 / T3.1 — player-buildable settlements. End-to-end:
//   1. POST /claim creates a land_claims row
//   2. POST /:claimId/building writes a row to world_buildings inside the claim
//   3. Building outside the claim bounds is rejected
//   4. Non-owner without invite cannot build
//   5. Buildings listing returns rows within the claim circle

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import createSettlementRouter from "../routes/settlement.js";

let db;
let routerOwner, routerStranger;

function buildSchema(d) {
  d.exec(`
    CREATE TABLE land_claims (
      id                 TEXT    PRIMARY KEY,
      owner_user_id      TEXT    NOT NULL,
      world_id           TEXT    NOT NULL,
      anchor_x           REAL    NOT NULL,
      anchor_z           REAL    NOT NULL,
      radius_m           REAL    NOT NULL,
      bond_sparks        INTEGER NOT NULL DEFAULT 0,
      maintenance_per_day INTEGER NOT NULL DEFAULT 5,
      claimed_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      last_maintained_at INTEGER NOT NULL DEFAULT (unixepoch()),
      status             TEXT    NOT NULL DEFAULT 'active'
    );
    CREATE TABLE land_claim_invites (
      claim_id      TEXT    NOT NULL,
      user_id       TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'co_owner',
      invited_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (claim_id, user_id)
    );
    CREATE TABLE land_claim_events (
      id TEXT PRIMARY KEY, claim_id TEXT, actor_user_id TEXT,
      event_type TEXT, event_json TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE world_buildings (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL,
      building_type TEXT NOT NULL, name TEXT,
      x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
      rotation REAL DEFAULT 0, width REAL DEFAULT 10, depth REAL DEFAULT 10, height REAL DEFAULT 8,
      material TEXT DEFAULT 'stone', floors INTEGER DEFAULT 1,
      owner_type TEXT DEFAULT 'world', owner_id TEXT,
      is_seed INTEGER DEFAULT 0, state TEXT DEFAULT 'standing',
      health_pct REAL DEFAULT 1.0, npc_occupant TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE user_wallets (user_id TEXT PRIMARY KEY, sparks INTEGER DEFAULT 1000);
  `);
}

before(() => {
  db = new Database(":memory:");
  buildSchema(db);
  routerOwner = createSettlementRouter({
    db,
    requireAuth: (req, _res, next) => { req.user = { id: "U1" }; next(); },
  });
  routerStranger = createSettlementRouter({
    db,
    requireAuth: (req, _res, next) => { req.user = { id: "U2" }; next(); },
  });
});

after(() => { db?.close(); });

function invoke(router, method, path, body = {}) {
  return new Promise((resolve) => {
    let status = 200, json = null;
    const params = {};
    const m = path.match(/^\/([^/]+)\/(invite|building|buildings)$/);
    if (m) params.claimId = m[1];
    const req = {
      method, url: path, headers: {}, params, body,
      app: { locals: { io: { to: () => ({ emit: () => {} }) } } },
    };
    const res = {
      status(c) { status = c; return this; },
      json(b)   { json = b; resolve({ status, body: b }); },
    };
    router.handle(req, res, () => resolve({ status: 404, body: null }));
  });
}

describe("Wave 6 — settlement routes", () => {
  let claimId;

  it("POST /claim creates a land_claims row", async () => {
    const r = await invoke(routerOwner, "POST", "/claim", { worldId: "concordia-hub", x: 100, z: 100, radiusM: 50 });
    assert.equal(r.status, 200);
    assert.ok(r.body.ok, `claim should succeed: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.claimId);
    claimId = r.body.claimId;
    const row = db.prepare(`SELECT * FROM land_claims WHERE id = ?`).get(claimId);
    assert.equal(row.owner_user_id, "U1");
    assert.equal(row.radius_m, 50);
  });

  it("POST /:claimId/building writes a building inside the claim", async () => {
    const r = await invoke(routerOwner, "POST", `/${claimId}/building`, {
      buildingType: "house",
      x: 110, y: 0, z: 110,
      material: "wood",
      name: "Cabin",
    });
    assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.ok);
    assert.ok(r.body.buildingId);
    const b = db.prepare(`SELECT * FROM world_buildings WHERE id = ?`).get(r.body.buildingId);
    assert.equal(b.owner_id, "U1");
    assert.equal(b.building_type, "house");
    assert.equal(b.material, "wood");
  });

  it("rejects building outside the claim radius", async () => {
    const r = await invoke(routerOwner, "POST", `/${claimId}/building`, {
      buildingType: "house",
      x: 500, y: 0, z: 500,
    });
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
  });

  it("rejects unknown building type", async () => {
    const r = await invoke(routerOwner, "POST", `/${claimId}/building`, {
      buildingType: "nuclear_reactor", x: 110, z: 110,
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "unknown_building_type");
  });

  it("non-owner without invite cannot build", async () => {
    const r = await invoke(routerStranger, "POST", `/${claimId}/building`, {
      buildingType: "house", x: 110, z: 110,
    });
    assert.equal(r.status, 403);
  });

  it("GET /:claimId/buildings returns buildings within the claim circle", async () => {
    const r = await invoke(routerOwner, "GET", `/${claimId}/buildings`);
    assert.equal(r.status, 200);
    assert.ok(r.body.ok);
    assert.ok(Array.isArray(r.body.buildings));
    assert.ok(r.body.buildings.length >= 1);
  });

  it("GET /my-claims lists the caller's claims", async () => {
    const r = await invoke(routerOwner, "GET", "/my-claims");
    assert.equal(r.status, 200);
    assert.ok(r.body.ok);
    assert.ok(Array.isArray(r.body.claims));
    assert.ok(r.body.claims.length >= 1);
  });
});
