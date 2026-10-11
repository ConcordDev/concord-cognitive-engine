// The retired seedMarketplace() boot seed inserted five userId:"system"
// listings into the in-memory marketplace on every import. GET
// /api/marketplace/listings (frontier-part2, mounted at /api ahead of the
// later alias) served them as purchasable items with no seller, which the
// market lens rendered as "Anonymous". Fresh boot must not return those
// rows, cleanup must ignore real owners, and purchase of a missing or
// system listing must be refused.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Database from "better-sqlite3";
import createFrontierRoutesPart2, {
  purgeSeededSystemListings,
  purgeSeededSystemMarketplaceRows,
  SEEDED_SYSTEM_LISTING_TITLES,
} from "../routes/frontier-part2.js";
import { registerDurableEndpoints } from "../durable.js";

const SEED_TITLE = SEEDED_SYSTEM_LISTING_TITLES[0];

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function json(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function listingBody(userId, title, category = "validation") {
  return JSON.stringify({ userId, title, description: "real", category, price: 10 });
}

describe("GET /api/marketplace/listings — no seeded system listings", () => {
  let app;
  before(async () => {
    const expressApp = express();
    expressApp.use(express.json());
    expressApp.use("/api", createFrontierRoutesPart2({}));
    app = await listen(expressApp);
  });
  after(async () => { await app.close(); });

  it("fresh boot returns no listing with userId system", async () => {
    const { status, body } = await json(`${app.url}/api/marketplace/listings`);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.listings));
    assert.equal(body.listings.filter((l) => l.userId === "system").length, 0);
    for (const title of SEEDED_SYSTEM_LISTING_TITLES) {
      assert.equal(body.listings.some((l) => l.title === title && l.userId === "system"), false);
    }
  });

  it("keeps a real user's listing, including one that reuses a seed title", async () => {
    const created = await json(`${app.url}/api/marketplace/listings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: listingBody("alice", SEED_TITLE),
    });
    assert.equal(created.status, 201);
    const { body } = await json(`${app.url}/api/marketplace/listings`);
    const mine = body.listings.filter((l) => l.userId === "alice" && l.title === SEED_TITLE);
    assert.equal(mine.length, 1);
    assert.equal(body.listings.some((l) => l.userId === "system"), false);
  });

  it("does not list a system-owned row even if one is inserted after boot", async () => {
    const created = await json(`${app.url}/api/marketplace/listings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: listingBody("system", "Physics Sandbox Pro", "simulation"),
    });
    assert.equal(created.status, 201);
    const { body } = await json(`${app.url}/api/marketplace/listings`);
    assert.equal(body.listings.some((l) => l.userId === "system"), false);
    assert.equal(body.listings.some((l) => l.id === created.body.listing.id), false);
  });
});

describe("purchase of a system or missing listing is refused", () => {
  let app;
  before(async () => {
    const expressApp = express();
    expressApp.use(express.json());
    expressApp.use("/api", createFrontierRoutesPart2({}));
    app = await listen(expressApp);
  });
  after(async () => { await app.close(); });

  it("refuses a system listing and a nonexistent id, and still sells a real one", async () => {
    const system = await json(`${app.url}/api/marketplace/listings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: listingBody("system", "Operator scratch", "ai"),
    });
    assert.equal(system.status, 201);
    const real = await json(`${app.url}/api/marketplace/listings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: listingBody("bob", "Bob's DTU", "ai"),
    });
    assert.equal(real.status, 201);

    const refused = await json(`${app.url}/api/marketplace/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "buyer", listingId: system.body.listing.id }),
    });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.ok, false);
    assert.equal(refused.body.reason, "system_listing");

    const missing = await json(`${app.url}/api/marketplace/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "buyer", listingId: "does-not-exist" }),
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.ok, false);
    assert.equal(missing.body.reason, "listing_not_found");

    const bought = await json(`${app.url}/api/marketplace/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "buyer", listingId: real.body.listing.id }),
    });
    assert.equal(bought.status, 201);
    assert.equal(bought.body.ok, true);
    assert.equal(bought.body.order.listingId, real.body.listing.id);
  });
});

describe("durable POST /api/marketplace/listings/:id/purchase", () => {
  let app;
  let db;
  before(async () => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE marketplace_listings (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        seller_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price_cents INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        visibility TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE entitlements (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        created_at TEXT
      );
    `);
    db.prepare(
      "INSERT INTO marketplace_listings (id, owner_user_id, title, visibility, price_cents) VALUES (?, ?, ?, 'published', 100)"
    ).run("sys-1", "system", "DTU Validator Pro");
    db.prepare(
      "INSERT INTO marketplace_listings (id, owner_user_id, seller_id, title, visibility, price_cents) VALUES (?, ?, ?, ?, 'published', 100)"
    ).run("seller-sys", "alice", "system", "Not the seed");
    db.prepare(
      "INSERT INTO marketplace_listings (id, owner_user_id, title, visibility, price_cents) VALUES (?, ?, ?, 'published', 250)"
    ).run("real-1", "alice", "Alice DTU");

    const expressApp = express();
    expressApp.use(express.json());
    registerDurableEndpoints(expressApp, db);
    app = await listen(expressApp);
  });
  after(async () => {
    await app.close();
    db.close();
  });

  it("refuses a system owner and a missing id", async () => {
    const system = await json(`${app.url}/api/marketplace/listings/sys-1/purchase`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: "buyer" }),
    });
    assert.equal(system.status, 403);
    assert.equal(system.body.ok, false);
    assert.equal(system.body.reason, "system_listing");

    const realOwner = await json(`${app.url}/api/marketplace/listings/seller-sys/purchase`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: "buyer" }),
    });
    assert.equal(realOwner.status, 200);
    assert.equal(realOwner.body.ok, true);

    const missing = await json(`${app.url}/api/marketplace/listings/nope/purchase`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: "buyer" }),
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.ok, false);
    assert.equal(missing.body.reason, "listing_not_found");

    const real = await json(`${app.url}/api/marketplace/listings/real-1/purchase`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: "buyer" }),
    });
    assert.equal(real.status, 200);
    assert.equal(real.body.ok, true);
    assert.ok(real.body.entitlement_id);
  });
});

describe("seed cleanup is non-destructive and dry-run by default", () => {
  it("in-memory purge removes only system rows that match the seed titles", async () => {
    const expressApp = express();
    expressApp.use(express.json());
    expressApp.use("/api", createFrontierRoutesPart2({}));
    const app = await listen(expressApp);
    try {
      const real = await json(`${app.url}/api/marketplace/listings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: listingBody("carol", SEED_TITLE),
      });
      const seeded = await json(`${app.url}/api/marketplace/listings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: listingBody("system", SEED_TITLE),
      });
      const otherSystem = await json(`${app.url}/api/marketplace/listings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: listingBody("system", "Not from the seed"),
      });

      const preview = purgeSeededSystemListings({ apply: false });
      assert.equal(preview.applied, false);
      assert.ok(preview.removed.some((r) => r.id === seeded.body.listing.id));
      assert.equal(preview.removed.some((r) => r.id === real.body.listing.id), false);
      assert.equal(preview.removed.some((r) => r.id === otherSystem.body.listing.id), false);

      const previewAgain = purgeSeededSystemListings({ apply: false });
      assert.ok(previewAgain.removed.some((r) => r.id === seeded.body.listing.id));

      const applied = purgeSeededSystemListings({ apply: true });
      assert.equal(applied.applied, true);
      assert.ok(applied.removed.some((r) => r.id === seeded.body.listing.id));

      const again = purgeSeededSystemListings({ apply: false });
      assert.equal(again.removed.some((r) => r.id === seeded.body.listing.id), false);

      const listed = await json(`${app.url}/api/marketplace/listings`);
      assert.ok(listed.body.listings.some((l) => l.id === real.body.listing.id));
      assert.equal(listed.body.listings.some((l) => l.userId === "system"), false);

      const orderOther = await json(`${app.url}/api/marketplace/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "buyer", listingId: otherSystem.body.listing.id }),
      });
      assert.equal(orderOther.status, 403);
      assert.equal(orderOther.body.reason, "system_listing");
    } finally {
      await app.close();
    }
  });

  it("sqlite purge dry-run leaves rows, apply deletes only system seed rows", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE marketplace_listings (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT,
        seller_id TEXT,
        title TEXT NOT NULL
      );
    `);
    const insert = db.prepare(
      "INSERT INTO marketplace_listings (id, owner_user_id, seller_id, title) VALUES (?, ?, ?, ?)"
    );
    insert.run("seed", "system", null, "NPC Dialog Engine");
    insert.run("null-owner", null, "system", "Terrain Generator HD");
    insert.run("real-same-title", "dana", null, "NPC Dialog Engine");
    insert.run("real-seller-system", "erin", "system", "Real-time Sync Plus");
    insert.run("system-other", "system", null, "My actual tool");

    const preview = purgeSeededSystemMarketplaceRows(db, { apply: false });
    assert.equal(preview.applied, false);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM marketplace_listings").get().c, 5);
    const previewIds = preview.removed.map((r) => r.id).sort();
    assert.deepEqual(previewIds, ["null-owner", "seed"]);

    const applied = purgeSeededSystemMarketplaceRows(db, { apply: true });
    assert.equal(applied.applied, true);
    const left = db.prepare("SELECT id FROM marketplace_listings ORDER BY id").all().map((r) => r.id);
    assert.deepEqual(left, ["real-same-title", "real-seller-system", "system-other"]);
    db.close();
  });

  it("boot wiring deletes persisted seed rows and leaves real listings", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE marketplace_listings (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT,
        title TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO marketplace_listings (id, owner_user_id, title) VALUES (?, ?, ?)").run("seed", "system", "Physics Sandbox Pro");
    db.prepare("INSERT INTO marketplace_listings (id, owner_user_id, title) VALUES (?, ?, ?)").run("kept", "frank", "Physics Sandbox Pro");
    createFrontierRoutesPart2({ db });
    const left = db.prepare("SELECT id FROM marketplace_listings ORDER BY id").all().map((r) => r.id);
    assert.deepEqual(left, ["kept"]);
    db.close();
  });

  it("the cleanup script is dry-run unless --apply is passed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-seed-"));
    const dbPath = path.join(dir, "listings.db");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE marketplace_listings (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT,
        seller_id TEXT,
        title TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO marketplace_listings (id, owner_user_id, title) VALUES (?, ?, ?)").run("seed", "system", "DTU Validator Pro");
    db.prepare("INSERT INTO marketplace_listings (id, owner_user_id, title) VALUES (?, ?, ?)").run("kept", "gina", "DTU Validator Pro");
    db.close();

    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "../scripts/purge-seed-marketplace-listings.mjs");
    const dry = spawnSync(process.execPath, [script], {
      env: { ...process.env, DB_PATH: dbPath },
      encoding: "utf8",
    });
    assert.equal(dry.status, 0, dry.stderr);
    const dryReport = JSON.parse(dry.stdout);
    assert.equal(dryReport.apply, false);
    assert.equal(dryReport.sqlite.applied, false);
    assert.ok(dryReport.sqlite.removed.some((r) => r.id === "seed"));

    const afterDry = new Database(dbPath, { readonly: true });
    assert.equal(afterDry.prepare("SELECT COUNT(*) AS c FROM marketplace_listings").get().c, 2);
    afterDry.close();

    const applied = spawnSync(process.execPath, [script, "--apply"], {
      env: { ...process.env, DB_PATH: dbPath },
      encoding: "utf8",
    });
    assert.equal(applied.status, 0, applied.stderr);
    const after = new Database(dbPath, { readonly: true });
    const left = after.prepare("SELECT id FROM marketplace_listings").all().map((r) => r.id);
    assert.deepEqual(left, ["kept"]);
    after.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
