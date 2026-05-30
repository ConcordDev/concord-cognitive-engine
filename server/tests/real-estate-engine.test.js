// Contract test for the real-estate-engine Phase II Wave 26 substrate.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  listForSale, delist, listActiveListings,
  purchaseBuilding, listOwnedBuildings,
  createRentalAgreement, dissolveRental, listMyRentals,
  tickRentals,
} from "../lib/real-estate-engine.js";
import registerRealEstateMacros from "../domains/real-estate.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`real_estate.${name}`);
  assert.ok(fn, `real_estate.${name} not registered`);
  return fn(ctx, input);
}

let db;
before(() => { registerRealEstateMacros(register); });

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_buildings (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      building_type TEXT,
      owner_type TEXT NOT NULL DEFAULT 'realm',
      owner_id TEXT,
      x REAL NOT NULL DEFAULT 0,
      z REAL NOT NULL DEFAULT 0,
      health_pct REAL NOT NULL DEFAULT 100,
      deed_dtu_id TEXT,
      monthly_rent_cents INTEGER NOT NULL DEFAULT 0,
      for_sale_price_cents INTEGER NOT NULL DEFAULT 0,
      listed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE property_listings (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL,
      seller_user_id TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      listed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      delisted_at INTEGER,
      sold_at INTEGER,
      sold_to_user_id TEXT,
      sold_price_cents INTEGER
    );
    CREATE TABLE rental_agreements (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL,
      landlord_user_id TEXT NOT NULL,
      tenant_kind TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      rent_cents INTEGER NOT NULL,
      period_days INTEGER NOT NULL DEFAULT 30,
      started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      next_due_at INTEGER NOT NULL,
      dissolved_at INTEGER,
      last_paid_at INTEGER
    );
  `);
  // Seed an alice-owned building + a realm-owned building
  db.prepare(`
    INSERT INTO world_buildings (id, world_id, building_type, owner_type, owner_id)
    VALUES ('b1', 'w1', 'tavern', 'player', 'alice')
  `).run();
  db.prepare(`
    INSERT INTO world_buildings (id, world_id, building_type, owner_type, owner_id)
    VALUES ('b2', 'w1', 'tavern', 'realm', 'realm1')
  `).run();
});

const ctxAlice = () => ({ actor: { userId: "alice" }, userId: "alice", db });
const ctxBob   = () => ({ actor: { userId: "bob"   }, userId: "bob",   db });

const walletLog = [];
function makeWallet() {
  walletLog.length = 0;
  return {
    debit: (userId, amount, label) => { walletLog.push({ kind: "debit", userId, amount, label }); return { ok: true }; },
    credit: (userId, amount, label) => { walletLog.push({ kind: "credit", userId, amount, label }); return { ok: true }; },
  };
}

describe("real-estate-engine library", () => {
  it("listForSale rejects non-owner", () => {
    const r = listForSale(db, { buildingId: "b1", sellerUserId: "bob", priceCents: 1000 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner");
  });

  it("listForSale owner happy path + replaces prior listing", () => {
    const r1 = listForSale(db, { buildingId: "b1", sellerUserId: "alice", priceCents: 1000 });
    assert.equal(r1.ok, true);
    const r2 = listForSale(db, { buildingId: "b1", sellerUserId: "alice", priceCents: 1500 });
    assert.equal(r2.ok, true);
    const prior = db.prepare("SELECT * FROM property_listings WHERE id = ?").get(r1.listingId);
    assert.ok(prior.delisted_at);
  });

  it("delist by seller closes the active listing", () => {
    const r = listForSale(db, { buildingId: "b1", sellerUserId: "alice", priceCents: 1000 });
    const d = delist(db, r.listingId, "alice");
    assert.equal(d.ok, true);
    const list = listActiveListings(db);
    assert.equal(list.length, 0);
  });

  it("delist rejects non-seller", () => {
    const r = listForSale(db, { buildingId: "b1", sellerUserId: "alice", priceCents: 1000 });
    const d = delist(db, r.listingId, "bob");
    assert.equal(d.ok, false);
    assert.equal(d.reason, "not_seller");
  });

  it("purchaseBuilding transfers ownership + closes listing + uses wallet", () => {
    const wallet = makeWallet();
    const list = listForSale(db, { buildingId: "b1", sellerUserId: "alice", priceCents: 5000 });
    const p = purchaseBuilding(db, { buyerUserId: "bob", listingId: list.listingId }, wallet);
    assert.equal(p.ok, true);
    assert.equal(p.pricePaid, 5000);
    const updated = db.prepare("SELECT owner_type AS owner_kind, owner_id FROM world_buildings WHERE id = 'b1'").get();
    assert.equal(updated.owner_id, "bob");
    assert.equal(updated.owner_kind, "player");
    // Wallet log: bob debited 5000, alice credited 5000
    assert.equal(walletLog.length, 2);
    assert.equal(walletLog[0].userId, "bob");
    assert.equal(walletLog[1].userId, "alice");
  });

  it("purchaseBuilding rejects self-purchase", () => {
    const list = listForSale(db, { buildingId: "b1", sellerUserId: "alice", priceCents: 5000 });
    const r = purchaseBuilding(db, { buyerUserId: "alice", listingId: list.listingId }, makeWallet());
    assert.equal(r.ok, false);
    assert.equal(r.reason, "cannot_buy_own_listing");
  });

  it("listOwnedBuildings returns only player-owned", () => {
    const own = listOwnedBuildings(db, "alice");
    assert.equal(own.length, 1);
    assert.equal(own[0].id, "b1");
  });

  it("createRentalAgreement + dissolveRental + listMyRentals", () => {
    const r = createRentalAgreement(db, {
      buildingId: "b1", landlordUserId: "alice",
      tenantKind: "npc", tenantId: "npc1", rentCents: 200, periodDays: 7,
    });
    assert.equal(r.ok, true);
    const mine = listMyRentals(db, "alice", "landlord");
    assert.equal(mine.length, 1);
    const d = dissolveRental(db, r.agreementId, "alice");
    assert.equal(d.ok, true);
  });

  it("createRentalAgreement rejects non-landlord", () => {
    const r = createRentalAgreement(db, {
      buildingId: "b1", landlordUserId: "bob",
      tenantKind: "npc", tenantId: "npc1", rentCents: 200,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_landlord");
  });

  it("tickRentals collects due payments + advances next_due_at", () => {
    const wallet = makeWallet();
    const r = createRentalAgreement(db, {
      buildingId: "b1", landlordUserId: "alice",
      tenantKind: "player", tenantId: "bob", rentCents: 500, periodDays: 7,
    });
    // Backdate next_due_at by 1 day
    db.prepare("UPDATE rental_agreements SET next_due_at = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000) - 86400, r.agreementId);
    const tick = tickRentals(db, wallet);
    assert.equal(tick.collected, 1);
    assert.equal(walletLog.length, 2);
    assert.equal(walletLog[0].kind, "debit");
    assert.equal(walletLog[0].userId, "bob");
    assert.equal(walletLog[1].kind, "credit");
    assert.equal(walletLog[1].userId, "alice");
    const after = db.prepare("SELECT * FROM rental_agreements WHERE id = ?").get(r.agreementId);
    assert.ok(after.next_due_at > Math.floor(Date.now() / 1000));
  });

  it("tickRentals skips a tenant whose debit fails", () => {
    const wallet = {
      debit: () => ({ ok: false, reason: "insufficient_funds" }),
      credit: () => ({ ok: true }),
    };
    const r = createRentalAgreement(db, {
      buildingId: "b1", landlordUserId: "alice",
      tenantKind: "player", tenantId: "bob", rentCents: 500, periodDays: 7,
    });
    db.prepare("UPDATE rental_agreements SET next_due_at = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000) - 86400, r.agreementId);
    const tick = tickRentals(db, wallet);
    assert.equal(tick.collected, 0);
    assert.equal(tick.failed, 1);
  });
});

describe("real-estate domain macros", () => {
  it("end-to-end: list_for_sale → active_listings → purchase → owned", async () => {
    const list = await call("list_for_sale", ctxAlice(), { buildingId: "b1", priceCents: 8000 });
    assert.equal(list.ok, true);
    const active = await call("active_listings", ctxAlice(), {});
    assert.equal(active.listings.length, 1);
    const purch = await call("purchase", ctxBob(), { listingId: list.listingId });
    assert.equal(purch.ok, true);
    const owned = await call("owned", ctxBob());
    assert.equal(owned.buildings[0].id, "b1");
  });

  it("rejects no_user / no_db on protected ops", async () => {
    const r1 = await call("list_for_sale", { actor: { userId: null }, userId: null, db }, { buildingId: "b1", priceCents: 1 });
    assert.equal(r1.ok, false);
    const r2 = await call("list_for_sale", { actor: { userId: "x" }, userId: "x" }, { buildingId: "b1", priceCents: 1 });
    assert.equal(r2.ok, false);
  });
});
