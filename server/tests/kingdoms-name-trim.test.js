/**
 * F2 — whitespace-only name -> 400, nothing listed; normal name 200.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import { up as up105 } from "../migrations/105_kingdoms.js";
import { listKingdoms } from "../lib/kingdom.js";
import createKingdomsRouter from "../routes/kingdoms.js";

const POLY = [[0, 0], [10, 0], [10, 10], [0, 10]];

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, owner_id TEXT, owner_type TEXT, type TEXT,
      tags_json TEXT, skill_level REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT, display_name TEXT
    );
  `);
  db.prepare(`INSERT INTO users (id, username, display_name) VALUES ('u1', 'u1', 'User One')`).run();
  up105(db);
  return db;
}

function makeApp(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: "u1", role: "member" };
    next();
  });
  app.use(
    "/api/kingdoms",
    createKingdomsRouter({
      db,
      requireAuth: (_req, _res, next) => next(),
      state: null,
      realtimeEmit: null,
    }),
  );
  return app;
}

async function post(app, body) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/kingdoms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe("kingdoms F2 name trim", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("whitespace-only name -> 400 and nothing listed", async () => {
    const app = makeApp(db);
    const { status, json } = await post(app, {
      name: "   ",
      worldId: "concordia-hub",
      regionPolygon: POLY,
    });
    assert.equal(status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error, "ruler_and_name_required");
    assert.equal(listKingdoms(db).length, 0);
  });

  it("normal name -> 200 and listed", async () => {
    const app = makeApp(db);
    const { status, json } = await post(app, {
      name: "  Real Realm  ",
      worldId: "concordia-hub",
      regionPolygon: POLY,
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    const list = listKingdoms(db);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "Real Realm");
  });
});
