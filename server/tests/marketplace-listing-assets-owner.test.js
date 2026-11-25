/**
 * server/tests/marketplace-listing-assets-owner.test.js
 *
 * CB-1258 (the CB-1199 W5b hole): POST /api/marketplace/listings/:id/assets
 * in server/durable.js checked only that the listing and the artifact
 * exist — any caller, signed in or not, could attach any artifact to any
 * listing, and the insert + event log ran under the listing owner's id.
 *
 * The gate: the caller is read from the authenticated session (req.user
 * via log-access's actorFromReq), never from the request body. Signed-out
 * -> 401; only the listing's owner or an admin-class role (isLogAdmin:
 * owner/admin/founder/sovereign) may attach -> everyone else 403 with
 * nothing written; a missing listing still 404s. The desk's discretionary
 * leg is included: the listing owner attaching SOMEONE ELSE'S artifact
 * also 403s (rows with no recorded owner stay attachable, the
 * distribution route's precedent; admins exempt).
 *
 * Harness mirrors artifacts-durable-read.test.js / the buyer-authz test:
 * node:test, a real express app on an ephemeral port, a real
 * better-sqlite3 db with the migration-001 DDL, and an x-test-user
 * header middleware standing in for the session layer.
 *
 * Run: node --test server/tests/marketplace-listing-assets-owner.test.js
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

async function attach(listingId, { user, role, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (user) headers["x-test-user"] = user;
  if (role) headers["x-test-role"] = role;
  const res = await fetch(`${baseUrl}/api/marketplace/listings/${listingId}/assets`, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function assetRows(listingId) {
  return db.prepare("SELECT artifact_id FROM marketplace_listing_assets WHERE listing_id = ? ORDER BY artifact_id").all(listingId);
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-assets-owner-"));
  process.env.DATA_DIR = tmpDir;
  db = new Database(path.join(tmpDir, "test.db"));
  // Migration-001 durable DDL (server/migrations/001_core_tables.js),
  // FK clauses omitted as in artifacts-durable-read.test.js.
  db.exec(`
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT,
      type TEXT NOT NULL DEFAULT 'file',
      title TEXT NOT NULL DEFAULT 'Untitled',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      visibility TEXT NOT NULL DEFAULT 'private',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
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
  db.prepare("INSERT INTO marketplace_listings (id, owner_user_id, title, created_at, updated_at) VALUES ('lst_1', ?, 'Owner listing', ?, ?)")
    .run(OWNER, now, now);
  db.prepare("INSERT INTO artifacts (id, owner_user_id, title, created_at, updated_at) VALUES ('art_own', ?, 'Owner artifact', ?, ?)")
    .run(OWNER, now, now);
  db.prepare("INSERT INTO artifacts (id, owner_user_id, title, created_at, updated_at) VALUES ('art_other', ?, 'Other artifact', ?, ?)")
    .run(OTHER, now, now);
  db.prepare("INSERT INTO artifacts (id, owner_user_id, title, created_at, updated_at) VALUES ('art_own2', ?, 'Owner second artifact', ?, ?)")
    .run(OWNER, now, now);

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

describe("POST /api/marketplace/listings/:id/assets — owner/admin only (CB-1258)", () => {
  it("the owner attaches their own artifact: 200 and the row is written", async () => {
    const r = await attach("lst_1", { user: OWNER, body: { artifact_id: "art_own" } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.ok, true);
    assert.deepEqual(assetRows("lst_1").map((x) => x.artifact_id), ["art_own"]);
    const evt = db.prepare("SELECT actor_user_id FROM events WHERE type = 'marketplace.asset_attached'").get();
    assert.equal(evt.actor_user_id, OWNER, "the attach is logged under the caller");
  });

  it("a non-owner gets 403 and no row is written", async () => {
    const r = await attach("lst_1", { user: OTHER, body: { artifact_id: "art_other" } });
    assert.equal(r.status, 403, JSON.stringify(r.json));
    assert.deepEqual(assetRows("lst_1").map((x) => x.artifact_id), ["art_own"], "nothing new was written");
  });

  it("a signed-out caller gets 401 and no row is written", async () => {
    const r = await attach("lst_1", { body: { artifact_id: "art_other" } });
    assert.equal(r.status, 401, JSON.stringify(r.json));
    assert.deepEqual(assetRows("lst_1").map((x) => x.artifact_id), ["art_own"]);
  });

  it("an admin-class caller who is not the owner passes: 200 and the row is written", async () => {
    const r = await attach("lst_1", { user: ADMIN, role: "admin", body: { artifact_id: "art_own2" } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(assetRows("lst_1").some((x) => x.artifact_id === "art_own2"));
  });

  it("a missing listing still gets 404", async () => {
    const r = await attach("lst_missing", { user: OWNER, body: { artifact_id: "art_own" } });
    assert.equal(r.status, 404, JSON.stringify(r.json));
  });

  it("the listing owner attaching someone else's artifact gets 403 (discretionary artifact leg)", async () => {
    const r = await attach("lst_1", { user: OWNER, body: { artifact_id: "art_other" } });
    assert.equal(r.status, 403, JSON.stringify(r.json));
    assert.ok(!assetRows("lst_1").some((x) => x.artifact_id === "art_other"));
  });

  it("identity in the request body never counts: a non-owner spoofing owner_user_id still gets 403", async () => {
    const r = await attach("lst_1", { user: OTHER, body: { artifact_id: "art_other", owner_user_id: OWNER, user_id: OWNER } });
    assert.equal(r.status, 403, JSON.stringify(r.json));
    assert.ok(!assetRows("lst_1").some((x) => x.artifact_id === "art_other"));
  });
});
