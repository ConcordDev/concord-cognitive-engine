// server/tests/depth/real-estate-rent-heartbeat-behavior.test.js
//
// Behavioral coverage for the "real-estate-rent-collection" heartbeat added
// to close the docs/WAVE4_INVENTORY.md realestate row ("`tick_rentals` has
// no heartbeat — rent never collected automatically"). This test calls the
// exported handler function DIRECTLY (`runRealEstateRentCollectionSweep`),
// never the governor tick / `tickAllRegistered` loop, per the task brief.
//
// Schema + fixture setup mirrors server/tests/real-estate-engine.test.js
// (the pre-existing contract test for this domain) so this file exercises
// the exact same table shapes tickRentals already depends on.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  createRentalAgreement,
  tickRentals,
} from "../../lib/real-estate-engine.js";
import registerRealEstateMacros, {
  runRealEstateRentCollectionSweep,
} from "../../domains/real-estate.js";
import { listHeartbeatModules, _resetHeartbeatRegistry } from "../../emergent/heartbeat-registry.js";

let db;

function makeSchema() {
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
  db.prepare(`
    INSERT INTO world_buildings (id, world_id, building_type, owner_type, owner_id)
    VALUES ('b1', 'w1', 'tavern', 'player', 'alice')
  `).run();
}

beforeEach(() => {
  makeSchema();
  delete process.env.CONCORD_REALESTATE_RENT_SWEEP;
});

describe("real-estate rent-collection heartbeat — registration", () => {
  it("self-registers 'real-estate-rent-collection' at frequency 240, scope global, as a side effect of registerRealEstateMacros", () => {
    _resetHeartbeatRegistry();
    const ACTIONS = new Map();
    registerRealEstateMacros((domain, name, fn) => ACTIONS.set(`${domain}.${name}`, fn));
    const modules = listHeartbeatModules();
    const entry = modules.find((m) => m.id === "real-estate-rent-collection");
    assert.ok(entry, "real-estate-rent-collection heartbeat was not registered");
    assert.equal(entry.frequency, 240);
    assert.equal(entry.scope, "global");
    // The macros themselves are still registered too (registration is additive).
    assert.ok(ACTIONS.has("real_estate.tick_rentals"));
  });
});

describe("real-estate rent-collection heartbeat — direct handler invocation", () => {
  it("collects due rent when called directly (handler, not the governor loop)", async () => {
    const r = createRentalAgreement(db, {
      buildingId: "b1", landlordUserId: "alice",
      tenantKind: "player", tenantId: "bob", rentCents: 500, periodDays: 7,
    });
    assert.equal(r.ok, true);
    // Backdate next_due_at into the past so it's due.
    db.prepare("UPDATE rental_agreements SET next_due_at = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000) - 86400, r.agreementId);

    const result = await runRealEstateRentCollectionSweep({ db });
    assert.equal(result.ok, true);
    assert.equal(result.collected, 1);
    assert.equal(result.failed, 0);

    const after = db.prepare("SELECT * FROM rental_agreements WHERE id = ?").get(r.agreementId);
    assert.ok(after.next_due_at > Math.floor(Date.now() / 1000), "next_due_at should have advanced");
    assert.ok(after.last_paid_at, "last_paid_at should be stamped");
  });

  it("does NOT collect rent that isn't due yet", async () => {
    const r = createRentalAgreement(db, {
      buildingId: "b1", landlordUserId: "alice",
      tenantKind: "player", tenantId: "bob", rentCents: 500, periodDays: 30,
    });
    assert.equal(r.ok, true);
    // next_due_at is ~30 days in the future by construction — leave it alone.
    const before = db.prepare("SELECT * FROM rental_agreements WHERE id = ?").get(r.agreementId);

    const result = await runRealEstateRentCollectionSweep({ db });
    assert.equal(result.ok, true);
    assert.equal(result.collected, 0);

    const after = db.prepare("SELECT * FROM rental_agreements WHERE id = ?").get(r.agreementId);
    assert.equal(after.next_due_at, before.next_due_at, "not-yet-due rent must not advance next_due_at");
    assert.equal(after.last_paid_at, null);
  });

  it("calls the REAL tickRentals engine, not a simulation — matches a direct tickRentals call bit-for-bit", async () => {
    const r = createRentalAgreement(db, {
      buildingId: "b1", landlordUserId: "alice",
      tenantKind: "npc", tenantId: "npc1", rentCents: 300, periodDays: 7,
    });
    db.prepare("UPDATE rental_agreements SET next_due_at = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000) - 10, r.agreementId);

    // Reference: call the engine directly with a no-op wallet (same default
    // the sweep falls back to when economy/wallet.js isn't resolvable).
    const reference = tickRentals(db, {});
    // Re-due it again for the sweep's own pass (tickRentals already advanced it).
    db.prepare("UPDATE rental_agreements SET next_due_at = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000) - 10, r.agreementId);
    const swept = await runRealEstateRentCollectionSweep({ db });

    assert.equal(swept.collected, reference.collected);
    assert.deepEqual(swept.details.collected[0].agreementId, reference.details.collected[0].agreementId);
  });
});

describe("real-estate rent-collection heartbeat — never throws", () => {
  it("returns an honest skip when db is missing (no throw)", async () => {
    const result = await runRealEstateRentCollectionSweep({});
    assert.equal(result.ok, true);
    assert.equal(result.skipped, "no_db");
  });

  it("returns an honest skip when called with no args at all (no throw)", async () => {
    const result = await runRealEstateRentCollectionSweep();
    assert.equal(result.ok, true);
    assert.equal(result.skipped, "no_db");
  });

  it("is genuinely wrapped in try/catch: a db whose .prepare() throws does not propagate out of the handler", async () => {
    const throwingDb = {
      prepare() {
        throw new Error("simulated malformed-state failure inside tickRentals");
      },
    };
    // If the handler's own try/catch weren't real, this would reject/throw
    // and the assert.doesNotReject below would fail.
    await assert.doesNotReject(async () => {
      const result = await runRealEstateRentCollectionSweep({ db: throwingDb });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "rent_sweep_failed");
      assert.match(result.error, /simulated malformed-state failure/);
    });
  });

  it("respects the CONCORD_REALESTATE_RENT_SWEEP=0 kill-switch without touching the db", async () => {
    process.env.CONCORD_REALESTATE_RENT_SWEEP = "0";
    const r = createRentalAgreement(db, {
      buildingId: "b1", landlordUserId: "alice",
      tenantKind: "player", tenantId: "bob", rentCents: 500, periodDays: 7,
    });
    db.prepare("UPDATE rental_agreements SET next_due_at = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000) - 86400, r.agreementId);

    const result = await runRealEstateRentCollectionSweep({ db });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, "disabled");

    const after = db.prepare("SELECT * FROM rental_agreements WHERE id = ?").get(r.agreementId);
    assert.equal(after.last_paid_at, null, "kill-switched sweep must not collect anything");
    delete process.env.CONCORD_REALESTATE_RENT_SWEEP;
  });
});
