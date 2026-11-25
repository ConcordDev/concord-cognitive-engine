/**
 * server/tests/marketplace-listing-publish-owner.test.js
 *
 * CB-1279 ticket B: POST /api/marketplace/listings/:id/publish in
 * server/durable.js had no ownership check at all — any caller,
 * signed in or not, could publish any listing that had an asset, and
 * the publish event was logged under the listing owner's id.
 *
 * The gate is the attach route's gate (CB-1258): the caller comes
 * from the authenticated session (log-access's actorFromReq), never
 * from the request body. Signed-out -> 401; missing listing -> 404;
 * only the listing's owner or an admin-class role (isLogAdmin) may
 * publish -> everyone else 403 with nothing written; the publish
 * event is logged under the caller.
 *
 * Harness mirrors marketplace-listing-assets-owner.test.js (CB-1258):
 * node:test, a real express app on an ephemeral port, a real
 * better-sqlite3 db with the migration-001 DDL, and an x-test-user
 * header middleware standing in for the session layer.
 *
 * Run: node --test server/tests/marketplace-listing-publish-owner.test.js
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

async function publish(listingId, { user, role } = {}) {
  const headers = { "content-type": "application/json" };
  if (user) headers["x-test-user"] = user;
  if (role) headers["x-test-role"] = role;
  const res = await fetch(`${baseUrl}/api/marketplace/listings/${listingId}/publish`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function visibility(listingId) {
  const row = db.prepare("SELECT visibility FROM marketplace_listings WHERE id = ?").get(listingId);
  return row ? row.visibility : null;
}

function publishEvents(listingId) {
  return db
    .prepare("SELECT actor_user_id FROM events WHERE type = 'marketplace.listing_published' AND payload_json LIKE ?")
    .all(`%${listingId}%`);
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-publish-owner-"));
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
    CREATE TABLE marketplace_listing_assets (
      listing_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      PRIMARY KEY (listing_id, artifact_id)
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
  const now = new Date().toISOString();
  const ins = db.prepare(
    "INSERT INTO marketplace_listings (id, owner_user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  );
  ins.run("lst_own", OWNER, "Owner listing with asset", now, now);
  ins.run("lst_noasset", OWNER, "Owner listing without asset", now, now);
  ins.run("lst_other", OTHER, "Other user listing with asset", now, now);
  db.prepare("INSERT INTO marketplace_listing_assets (listing_id, artifact_id) VALUES ('lst_own', 'art_1')").run();
  db.prepare("INSERT INTO marketplace_listing_assets (listing_id, artifact_id) VALUES ('lst_other', 'art_2')").run();

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

describe("POST /api/marketplace/listings/:id/publish — owner/admin only (CB-1279 B)", () => {
  it("the owner publishes their own listing: 200, published, event logged under the caller", async () => {
    const r = await publish("lst_own", { user: OWNER });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(visibility("lst_own"), "published");
    const evts = publishEvents("lst_own");
    assert.equal(evts.length, 1);
    assert.equal(evts[0].actor_user_id, OWNER);
  });

  it("a non-owner gets 403 and nothing is written", async () => {
    const r = await publish("lst_other", { user: OWNER });
    assert.equal(r.status, 403, JSON.stringify(r.json));
    assert.equal(visibility("lst_other"), "draft", "the listing stays a draft");
    assert.equal(publishEvents("lst_other").length, 0, "no publish event was logged");
  });

  it("a signed-out caller gets 401 and nothing is written", async () => {
    const r = await publish("lst_other", {});
    assert.equal(r.status, 401, JSON.stringify(r.json));
    assert.equal(visibility("lst_other"), "draft");
    assert.equal(publishEvents("lst_other").length, 0);
  });

  it("an admin-class caller who is not the owner passes: 200, published, event under the admin", async () => {
    const r = await publish("lst_other", { user: ADMIN, role: "admin" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(visibility("lst_other"), "published");
    const evts = publishEvents("lst_other");
    assert.equal(evts.length, 1);
    assert.equal(evts[0].actor_user_id, ADMIN, "the publish is logged under the caller, not the owner");
  });

  it("a missing listing gets 404 for a signed-in caller", async () => {
    const r = await publish("lst_missing", { user: OWNER });
    assert.equal(r.status, 404, JSON.stringify(r.json));
  });

  it("a missing listing gets 401 for a signed-out caller (the gate runs before the lookup)", async () => {
    const r = await publish("lst_missing", {});
    assert.equal(r.status, 401, JSON.stringify(r.json));
  });

  it("the asset rule is preserved: the owner publishing a listing with no assets still 400s", async () => {
    const r = await publish("lst_noasset", { user: OWNER });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(visibility("lst_noasset"), "draft");
  });
});
