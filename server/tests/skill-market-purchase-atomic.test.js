// SB-20 / SB-21 — atomic skill purchase (CC-PRE-09).
//
// Pristine behaviour (skill-marketplace.js purchaseSkill, pre-fix): the
// debit's balance guard was never checked, so a buyer who could not pay
// still credited the seller a hardcoded 80% and received the skill; the
// ledger block swallowed its own errors; debit → credit → grant →
// sold-mark were four unguarded steps with no transaction and no
// purchase record at all.
//
// These pins drive the real purchaseSkill against a real database:
//   (a) a buyer who cannot pay is refused 402 — seller unchanged, no
//       grant, no purchase row, listing still active;
//   (b) a forced failure in the credit leg rolls the debit back;
//   (c) the split equals economy/fees.js's calculateFee output (the
//       marketplace fee + the universal fee), never the old 0.8;
//   (d) a multi-license listing stays active and sells again;
//   (e) a grant failure refunds the buyer in full, reverses the
//       seller's credit, restores the listing, marks the row refunded;
//   (f) the same idempotency key twice (concurrent) charges once and
//       returns the one receipt;
//   (g) two buyers racing one single-sale listing produce exactly one
//       receipt, one debit, one credit, one grant.
// Run: node --test server/tests/skill-market-purchase-atomic.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { listSkillForSale, purchaseSkill } from "../lib/skill-marketplace.js";
import { calculateFee } from "../economy/fees.js";
import { up as up506 } from "../migrations/506_skill_listings_license_mode.js";
import { up as up507 } from "../migrations/507_skill_purchases.js";

const WORLD = { worldId: "concordia-hub", worldName: "Hub" };
// teachSkillToPlayer consults a brain and falls back to the original
// content when it is unavailable — the test brain is always unavailable.
const noBrain = async () => ({
  handle: { generate: async () => { throw new Error("brain offline in test"); } },
});

let db;
function freshDb() {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, concordia_credits REAL NOT NULL DEFAULT 0);
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY, type TEXT, title TEXT, content TEXT, creator_id TEXT,
      world_id TEXT, lineage TEXT, skill_level REAL, total_experience REAL, created_at INTEGER
    );
    CREATE TABLE skill_listings (
      id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, skill_dtu_id TEXT NOT NULL,
      origin_world_id TEXT NOT NULL DEFAULT 'concordia-hub', price_cc REAL NOT NULL DEFAULT 0,
      description TEXT, effectiveness_ratings TEXT DEFAULT '{}',
      listed_at INTEGER NOT NULL DEFAULT (unixepoch()), status TEXT NOT NULL DEFAULT 'active'
    );
  `);
  up506(db);
  up507(db);
  db.prepare("INSERT INTO users (id, concordia_credits) VALUES ('seller', 0), ('buyer', 1000), ('buyer2', 1000), ('broke', 0)").run();
  db.prepare("INSERT INTO dtus (id, type, title, content, creator_id, world_id, lineage, skill_level, total_experience, created_at) VALUES ('skill1', 'skill', 'Focus', '{\"domain\":\"craft\"}', 'seller', 'concordia-hub', '[]', 2.0, 10, unixepoch())").run();
  return db;
}
const balance = (id) => db.prepare("SELECT concordia_credits AS c FROM users WHERE id = ?").get(id)?.c;
const listingStatus = (id) => db.prepare("SELECT status FROM skill_listings WHERE id = ?").get(id)?.status;
const purchaseRows = () => db.prepare("SELECT * FROM skill_purchases").all();
const grantedTo = (buyer) => db.prepare("SELECT * FROM dtus WHERE creator_id = ? AND id != 'skill1'").all(buyer);

beforeEach(() => { freshDb(); });

describe("SB-20: atomic settlement", () => {
  it("(a) a buyer who cannot pay is refused 402; nothing is credited, granted or recorded", async () => {
    const listing = listSkillForSale("seller", "skill1", 100, "", db);
    await assert.rejects(
      purchaseSkill("broke", listing.id, WORLD, db, noBrain),
      (e) => e.status === 402 && e.message === "insufficient_funds",
    );
    assert.equal(balance("seller"), 0);
    assert.equal(balance("broke"), 0);
    assert.equal(grantedTo("broke").length, 0);
    assert.equal(purchaseRows().length, 0);
    assert.equal(listingStatus(listing.id), "active");
  });

  it("(b) a forced failure in the credit leg rolls the debit back", async () => {
    const listing = listSkillForSale("seller", "skill1", 100, "", db);
    db.prepare("DELETE FROM users WHERE id = 'seller'").run(); // the credit has nowhere to land
    await assert.rejects(purchaseSkill("buyer", listing.id, WORLD, db, noBrain), (e) => e.status === 422);
    assert.equal(balance("buyer"), 1000, "the debit must not stand");
    assert.equal(purchaseRows().length, 0);
    assert.equal(listingStatus(listing.id), "active");
    assert.equal(grantedTo("buyer").length, 0);
  });

  it("(c) the split equals the fees.js calculation, not the old 0.8", async () => {
    const listing = listSkillForSale("seller", "skill1", 100, "", db);
    const { fee, net } = calculateFee("MARKETPLACE_PURCHASE", 100);
    assert.equal(fee, 5.46);
    const result = await purchaseSkill("buyer", listing.id, WORLD, db, noBrain);
    assert.equal(balance("buyer"), 900);
    assert.equal(balance("seller"), net);
    assert.notEqual(balance("seller"), 80);
    assert.equal(result.purchase.status, "completed");
    assert.equal(result.purchase.fee_cc, fee);
    assert.equal(result.purchase.seller_net_cc, net);
    assert.equal(result.purchase.new_skill_dtu_id, result.newSkill.id);
    assert.equal(result.newSkill.creator_id, "buyer");
    assert.equal(listingStatus(listing.id), "sold");
  });

  it("(d) a multi-license listing stays active across sales", async () => {
    const listing = listSkillForSale("seller", "skill1", 100, "", db, "multi");
    await purchaseSkill("buyer", listing.id, WORLD, db, noBrain);
    assert.equal(listingStatus(listing.id), "active");
    const second = await purchaseSkill("buyer2", listing.id, WORLD, db, noBrain);
    assert.equal(second.purchase.status, "completed");
    assert.equal(purchaseRows().length, 2);
    assert.equal(listingStatus(listing.id), "active");
  });
});

describe("SB-21: grant ordering + idempotency", () => {
  it("(e) a grant failure refunds in full and restores the listing", async () => {
    const listing = listSkillForSale("seller", "skill1", 100, "", db);
    db.prepare("DELETE FROM dtus WHERE id = 'skill1'").run(); // the grant's subject is gone
    await assert.rejects(purchaseSkill("buyer", listing.id, WORLD, db, noBrain), (e) => e.status === 404);
    assert.equal(balance("buyer"), 1000, "buyer refunded in full");
    assert.equal(balance("seller"), 0, "seller credit reversed");
    assert.equal(listingStatus(listing.id), "active");
    assert.equal(purchaseRows().length, 1);
    assert.equal(purchaseRows()[0].status, "refunded");
  });

  it("(f) the same idempotency key twice charges once and returns the one receipt", async () => {
    const listing = listSkillForSale("seller", "skill1", 100, "", db);
    const [r1, r2] = await Promise.all([
      purchaseSkill("buyer", listing.id, WORLD, db, noBrain, { idempotencyKey: "click-1" }),
      purchaseSkill("buyer", listing.id, WORLD, db, noBrain, { idempotencyKey: "click-1" }),
    ]);
    assert.equal(r1.purchase.id, r2.purchase.id);
    assert.equal(balance("buyer"), 900, "exactly one debit");
    assert.equal(purchaseRows().length, 1);
    const r3 = await purchaseSkill("buyer", listing.id, WORLD, db, noBrain, { idempotencyKey: "click-1" });
    assert.equal(r3.idempotent, true);
    assert.equal(r3.purchase.id, r1.purchase.id);
    assert.equal(balance("buyer"), 900);
    assert.equal(grantedTo("buyer").length, 1);
  });

  it("(g) two buyers racing one single-sale listing: exactly one receipt, debit, credit, grant", async () => {
    const listing = listSkillForSale("seller", "skill1", 100, "", db);
    const settled = await Promise.allSettled([
      purchaseSkill("buyer", listing.id, WORLD, db, noBrain),
      purchaseSkill("buyer2", listing.id, WORLD, db, noBrain),
    ]);
    const ok = settled.filter((s) => s.status === "fulfilled");
    const refused = settled.filter((s) => s.status === "rejected");
    assert.equal(ok.length, 1);
    assert.equal(refused.length, 1);
    assert.equal(balance("buyer") + balance("buyer2"), 1900, "exactly one debit across both buyers");
    assert.equal(purchaseRows().length, 1);
    assert.equal(grantedTo("buyer").length + grantedTo("buyer2").length, 1);
    assert.equal(listingStatus(listing.id), "sold");
  });
});

describe("migrations", () => {
  it("506 + 507 are idempotent and the idempotency key is unique where present", () => {
    up506(db); up507(db); // second run: no throw, no change
    const cols = db.prepare("PRAGMA table_info(skill_listings)").all().map((c) => c.name);
    assert.ok(cols.includes("license_mode"));
    const listing = listSkillForSale("seller", "skill1", 10, "", db);
    assert.equal(listing.license_mode, "single", "pre-existing listings default to single");
  });
});
