/**
 * F1 — GET list/detail wire payloads never echo raw user uuids; ruler +
 * resident display names come from lookupUserIdentity.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import { up as up105 } from "../migrations/105_kingdoms.js";
import { foundKingdom, opaqueUserRef } from "../lib/kingdom.js";
import createKingdomsRouter from "../routes/kingdoms.js";

const RULER_UUID = "6f4308d5-039c-45ac-bd9c-254d0c498b0d";
const CITIZEN_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT,
      display_name TEXT
    );
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, owner_id TEXT, owner_type TEXT, type TEXT,
      tags_json TEXT, skill_level REAL DEFAULT 0
    );
  `);
  db.prepare(
    `INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)`,
  ).run(RULER_UUID, "qa_sweep_c", "Ada Ruler");
  db.prepare(
    `INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)`,
  ).run(CITIZEN_UUID, "citizen_x", "Citizen X");
  up105(db);
  return db;
}

function makeApp(db, userId = RULER_UUID) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, role: "member" };
    next();
  });
  app.use(
    "/api/kingdoms",
    createKingdomsRouter({
      db,
      // kingdoms router mounts requireAuth as middleware (not a factory).
      requireAuth: (_req, _res, next) => next(),
      state: null,
      realtimeEmit: null,
    }),
  );
  return app;
}

async function get(app, path) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, json: await res.json() };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

function assertNoRawUuid(value, label) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  assert.ok(!s.includes(RULER_UUID), `${label} must not contain ruler uuid`);
  assert.ok(!s.includes(CITIZEN_UUID), `${label} must not contain citizen uuid`);
  assert.ok(!s.includes(RULER_UUID.slice(0, 12)), `${label} must not contain uuid prefix`);
}

describe("kingdoms F1 identity wire", () => {
  let db;
  let kingdomId;
  beforeEach(() => {
    db = setupDb();
    const r = foundKingdom(db, {
      rulerId: RULER_UUID,
      regionPolygon: [[0, 0], [10, 0], [10, 10], [0, 10]],
      name: "Wire Realm",
    });
    assert.equal(r.ok, true);
    kingdomId = r.kingdomId;
    db.prepare(
      `INSERT INTO kingdom_residents (kingdom_id, user_id, role) VALUES (?, ?, 'citizen')`,
    ).run(kingdomId, CITIZEN_UUID);
  });

  it("list payload has opaque ruler_id + display name, no raw uuid", async () => {
    const app = makeApp(db);
    const { status, json } = await get(app, "/api/kingdoms");
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.kingdoms.length, 1);
    const k = json.kingdoms[0];
    assert.equal(k.ruler_display_name, "Ada Ruler");
    assert.equal(k.ruler_id, opaqueUserRef(RULER_UUID));
    assert.equal(k.ruler_user_id, undefined);
    assertNoRawUuid(json, "list");
  });

  it("detail + residents show display names, no raw uuid", async () => {
    const app = makeApp(db);
    const { status, json } = await get(app, `/api/kingdoms/${kingdomId}`);
    assert.equal(status, 200);
    assert.equal(json.kingdom.ruler_display_name, "Ada Ruler");
    assert.equal(json.kingdom.ruler_id, opaqueUserRef(RULER_UUID));
    assert.equal(json.kingdom.ruler_user_id, undefined);
    const rulerRow = json.residents.find((r) => r.role === "ruler");
    const citizenRow = json.residents.find((r) => r.role === "citizen");
    assert.equal(rulerRow.display_name, "Ada Ruler");
    assert.equal(citizenRow.display_name, "Citizen X");
    assert.equal(rulerRow.user_id, undefined);
    assert.equal(citizenRow.user_id, undefined);
    assert.equal(rulerRow.id, opaqueUserRef(RULER_UUID));
    assertNoRawUuid(json, "detail");
  });
});
