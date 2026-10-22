import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";

import * as mig002 from "../migrations/002_economy_tables.js";
import * as mig005 from "../migrations/005_purchases_table.js";
import * as mig008 from "../migrations/008_economic_system.js";
import * as mig481 from "../migrations/481_marketplace_listing_free_price.js";
import { createListing, delistListing, getListing, purchaseListing } from "../economy/marketplace-service.js";
import { mountStudioMarketplaceRoutes, publishStudioTrack, studioTerms } from "../economy/studio-publish.js";
import { calculateFee } from "../economy/fees.js";
import { executePurchase } from "../economy/transfer.js";
import { getBalance } from "../economy/balances.js";
import { validateMimeType } from "../lib/upload-mime.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  mig002.up(db);
  mig005.up(db);
  mig008.up(db);
  db.exec("CREATE TABLE dtu_store (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
});

afterEach(() => { try { db?.close(); } catch { /* closed */ } });

function putDtu(id, ownerId, extra = {}) {
  db.prepare("INSERT INTO dtu_store (id, data) VALUES (?, ?)").run(id, JSON.stringify({
    id,
    ownerId,
    createdBy: ownerId,
    machine: { verifier: { hash: extra.hash || `sha256:${id}` } },
    artifact: extra.artifact || { type: "audio/mpeg", diskPath: extra.diskPath || "" },
  }));
}

describe("studio marketplace publish", () => {
  it("relaxes the price check and keeps an existing paid row", () => {
    const before = createListing(db, {
      sellerId: "seller", contentId: "track-paid", contentType: "music",
      title: "Paid", price: 12.5, contentData: "hash-paid", licenseType: "personal",
    });
    assert.equal(before.ok, true);
    const blocked = createListing(db, {
      sellerId: "seller", contentId: "track-free", contentType: "music",
      title: "Free", price: 0, contentData: "hash-free",
    });
    assert.equal(blocked.ok, false);
    mig481.up(db);
    const row = db.prepare("SELECT price FROM marketplace_economy_listings WHERE id = ?").get(before.listing.id);
    assert.equal(row.price, 12.5);
    const free = createListing(db, {
      sellerId: "seller", contentId: "track-free", contentType: "music",
      title: "Free", price: 0, contentData: "hash-free", licenseType: "cc-by",
      previewData: { artist: "Ada", previewArtifactId: "prev" },
    });
    assert.equal(free.ok, true, JSON.stringify(free));
    assert.equal(free.listing.price, 0);
    const loaded = getListing(db, free.listing.id);
    assert.equal(loaded.preview.artist, "Ada");
    assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_mel_hash'").get());
  });

  it("fulfills a free purchase without a ledger debit and charges the real fee on a paid one", () => {
    mig481.up(db);
    const free = createListing(db, {
      sellerId: "seller", contentId: "c-free", contentType: "music",
      title: "Free song", price: 0, contentData: "free-bytes", licenseType: "personal",
    });
    const before = getBalance(db, "buyer").balance;
    const bought = purchaseListing(db, { buyerId: "buyer", listingId: free.listing.id });
    assert.equal(bought.ok, true, JSON.stringify(bought));
    assert.equal(bought.fee, 0);
    assert.equal(bought.free, true);
    assert.equal(getBalance(db, "buyer").balance, before);
    const purchase = db.prepare("SELECT status, amount, marketplace_fee FROM purchases WHERE purchase_id = ?").get(bought.purchaseId);
    assert.equal(purchase.status, "FULFILLED");
    assert.equal(purchase.amount, 0);
    assert.equal(purchase.marketplace_fee, 0);
    const ledger = db.prepare("SELECT COUNT(*) AS c FROM economy_ledger WHERE metadata_json LIKE ?").get(`%${bought.purchaseId}%`);
    assert.equal(ledger.c, 0);

    const funded = executePurchase(db, { userId: "buyer2", amount: 100 });
    assert.equal(funded.ok, true);
    const paid = createListing(db, {
      sellerId: "seller", contentId: "c-paid", contentType: "music",
      title: "Paid song", price: 10, contentData: "paid-bytes", licenseType: "nonexclusive",
    });
    const sale = purchaseListing(db, { buyerId: "buyer2", listingId: paid.listing.id });
    assert.equal(sale.ok, true, JSON.stringify(sale));
    const expected = calculateFee("MARKETPLACE_PURCHASE", 10);
    assert.equal(sale.fee, expected.fee);
    assert.equal(sale.sellerNet, expected.net);
    const row = db.prepare("SELECT marketplace_fee, seller_net, status FROM purchases WHERE purchase_id = ?").get(sale.purchaseId);
    assert.equal(row.status, "FULFILLED");
    assert.equal(row.marketplace_fee, expected.fee);
    assert.equal(row.seller_net, expected.net);

    const gone = delistListing(db, { listingId: free.listing.id, sellerId: "seller" });
    assert.equal(gone.ok, true);
    assert.equal(getListing(db, free.listing.id).status, "delisted");
  });

  it("publishes a master the seller owns and refuses a missing or foreign file", () => {
    mig481.up(db);
    const missing = publishStudioTrack(db, {
      sellerId: "ada",
      body: { title: "Night", artist: "Ada", license: "personal", price: 0, masterArtifactId: "nope", previewArtifactId: "prev" },
    });
    assert.equal(missing.body.error, "master_not_found");

    putDtu("master-1", "other");
    putDtu("prev-1", "ada");
    const foreign = publishStudioTrack(db, {
      sellerId: "ada",
      body: { title: "Night", artist: "Ada", license: "cc-by", price: 0, masterArtifactId: "master-1", previewArtifactId: "prev-1" },
    });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.error, "not_owner");

    putDtu("master-ada", "ada", { hash: "sha256:master-ada" });
    const listed = publishStudioTrack(db, {
      sellerId: "ada",
      body: {
        title: "Night", artist: "Ada", genre: "Ambient", license: "cc-by", price: 0,
        bpm: 96, key: "D minor", masterArtifactId: "master-ada", previewArtifactId: "prev-1", tempoChanges: true,
      },
    });
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.equal(listed.body.listing.price, 0);
    assert.equal(listed.body.listing.licenseType, "cc-by");
    assert.equal(listed.body.listing.preview.bpm, 96);
    assert.equal(listed.body.listing.preview.key, "D minor");
    assert.equal(listed.body.path, `/lenses/marketplace/music/${listed.body.listing.id}`);
    assert.equal(listed.body.terms.combinedRate, studioTerms().combinedRate);
    assert.equal(listed.body.terms.combinedRate, calculateFee("MARKETPLACE_PURCHASE", 100).rate);

    const cheap = publishStudioTrack(db, {
      sellerId: "ada",
      body: { title: "X", artist: "Ada", license: "personal", price: 0.001, masterArtifactId: "master-ada", previewArtifactId: "prev-1" },
    });
    assert.equal(cheap.body.error, "invalid_price");
  });

  it("serves the preview while the listing is active and locks a paid master", async () => {
    mig481.up(db);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-mp3-"));
    const file = path.join(dir, "preview.mp3");
    fs.writeFileSync(file, Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00]));
    putDtu("master-m", "ada", { artifact: { type: "audio/wav", diskPath: file }, hash: "sha256:master-m" });
    putDtu("prev-m", "ada", { artifact: { type: "audio/mpeg", diskPath: file }, hash: "sha256:prev-m" });
    const listed = publishStudioTrack(db, {
      sellerId: "ada",
      body: { title: "Night", artist: "Ada", license: "nonexclusive", price: 3, masterArtifactId: "master-m", previewArtifactId: "prev-m" },
    });
    assert.equal(listed.status, 200, JSON.stringify(listed.body));

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = req.headers["x-user"] ? { id: req.headers["x-user"] } : null; next(); });
    mountStudioMarketplaceRoutes(app, db);
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    try {
      const terms = await (await fetch(`${base}/api/economy/marketplace/studio-terms`)).json();
      assert.equal(terms.combinedRate, calculateFee("MARKETPLACE_PURCHASE", 100).rate);
      assert.equal(terms.marketplaceFeeRate + terms.universalFeeRate, terms.combinedRate);
      const id = listed.body.listing.id;
      const preview = await fetch(`${base}/api/economy/marketplace/listings/${id}/preview`);
      assert.equal(preview.status, 200);
      assert.equal(preview.headers.get("content-type"), "audio/mpeg");
      const locked = await fetch(`${base}/api/economy/marketplace/listings/${id}/master`);
      assert.equal(locked.status, 403);
      const owner = await fetch(`${base}/api/economy/marketplace/listings/${id}/master`, { headers: { "x-user": "ada" } });
      assert.equal(owner.status, 200);
      const delisted = delistListing(db, { listingId: id, sellerId: "ada" });
      assert.equal(delisted.ok, true);
      const after = await fetch(`${base}/api/economy/marketplace/listings/${id}/preview`);
      assert.equal(after.status, 404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts an MP3 frame with or without a CRC and an ID3 header", () => {
    assert.equal(validateMimeType("audio/mpeg", Buffer.from([0xff, 0xfb, 0x90, 0x00])).ok, true);
    assert.equal(validateMimeType("audio/mpeg", Buffer.from([0xff, 0xfa, 0x90, 0x00])).ok, true);
    assert.equal(validateMimeType("audio/mpeg", Buffer.from([0x49, 0x44, 0x33, 0x03])).ok, true);
    assert.equal(validateMimeType("audio/mpeg", Buffer.from([0x00, 0x00, 0x00, 0x00])).ok, false);
  });
});
