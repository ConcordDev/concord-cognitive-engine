/**
 * server/tests/marketplace-listing-create-owner.test.js
 *
 * CB-1279 ticket A: POST /api/marketplace/listings in server/durable.js
 * read owner_user_id from the request body and inserted the listing
 * under it — any caller, signed in or not, could create a listing
 * owned by any user id they named.
 *
 * The fix: the owner is the session caller (log-access's actorFromReq),
 * never the body. Signed-out -> 401 with nothing written; a
 * body-supplied owner_user_id is ignored; there is no create-on-behalf
 * capability in the module, so an admin likewise owns the listing they
 * create (logged under the caller).
 *
 * Harness mirrors marketplace-listing-assets-owner.test.js (CB-1258):
 * node:test, a real express app on an ephemeral port, a real
 * better-sqlite3 db with the migration-001 DDL, and an x-test-user
 * header middleware standing in for the session layer.
 *
 * Run: node --test server/tests/marketplace-listing-create-owner.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import express from "express";

const OWNER = "owner-1";
const OTHER = "other-2";
const ADMIN = "ops-9";

let tmpDir;
let db;
let server;
let baseUrl;

function authMiddleware(req, res, next) {
  const id = req.headers["x-test-user"];
  if (id) {
    req.user = { id, role: req.headers["x-test-role"] || "member" };
  } else {
    req.user = null;
  }
  next();
}

async function create({ user, role, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (user) headers["x-test-user"] = user;
  if (role) headers["x-test-role"] = role;
  const res = await fetch(`${baseUrl}/api/marketplace/listings`, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function listingRows() {
  return db.prepare("SELECT id, owner_user_id, title FROM marketplace_listings ORDER BY title").all();
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-create-owner-"));
  process.env.DATA_DIR = tmpDir;
  db = new Database(path.join(tmpDir, "test.db"));
  // Migration-001 durable DDL (server/migrations/001_core_tables.js),
  // FK clauses omitted as in marketplace-listing-assets-owner.test.js.
  db.exec(`
    CREATE TABLE marketplace_listings (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      license_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      actor_user_id TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      request_id TEXT
    );
  `);

  const { registerDurableEndpoints } = await import("../durable.js");
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  registerDurableEndpoints(app, db);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) db.close();
  delete process.env.DATA_DIR;
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("POST /api/marketplace/listings — owner is the session caller (CB-1279 A)", () => {
  it("a signed-in caller creates a draft owned by themselves", async () => {
    const r = await create({ user: OWNER, body: { title: "Caller listing", price_cents: 500 } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.ok, true);
    const rows = listingRows().filter((x) => x.title === "Caller listing");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].owner_user_id, OWNER);
    const evt = db.prepare("SELECT actor_user_id FROM events WHERE type = 'marketplace.listing_created'").get();
    assert.equal(evt.actor_user_id, OWNER, "the create is logged under the caller");
  });

  it("a body-supplied owner_user_id is ignored: the spoof does not change the owner", async () => {
    const r = await create({ user: OWNER, body: { title: "Spoof attempt", owner_user_id: OTHER, price_cents: 100 } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const rows = listingRows().filter((x) => x.title === "Spoof attempt");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].owner_user_id, OWNER, "the row is owned by the session caller, not the body's id");
    assert.ok(!listingRows().some((x) => x.owner_user_id === OTHER), "no listing was created for the spoofed user");
  });

  it("a signed-out caller gets 401 even with an owner_user_id in the body, and no row is written", async () => {
    const beforeCount = listingRows().length;
    const r = await create({ body: { title: "Signed-out listing", owner_user_id: OTHER } });
    assert.equal(r.status, 401, JSON.stringify(r.json));
    assert.equal(listingRows().length, beforeCount, "nothing was written");
  });

  it("an admin-class caller passes, and owns the listing they create (no on-behalf create)", async () => {
    const r = await create({ user: ADMIN, role: "admin", body: { title: "Admin listing", owner_user_id: OTHER } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const rows = listingRows().filter((x) => x.title === "Admin listing");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].owner_user_id, ADMIN, "the admin's listing is owned by the admin, not the body's id");
  });

  it("title validation is preserved: a signed-in create without a title still 400s", async () => {
    const r = await create({ user: OWNER, body: { price_cents: 100 } });
    assert.equal(r.status, 400, JSON.stringify(r.json));
  });
});
