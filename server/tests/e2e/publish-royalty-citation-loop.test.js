/**
 * Tier-3 flagship E2E loop (R8/CL3, loop 5): "Publish → royalty/citation."
 *
 * Walks the real marketplace-listing path (server/economy/marketplace-
 * service.js — NOT a reimplementation of it, and NOT the hand-seeded ledger
 * rows authoring-round-trip.test.js uses for the economy-substrate-only
 * scope it deliberately declares): a derivative work is CREATED (citing its
 * parent via the real `registerCitation`), LISTED for sale
 * (`createListing`), and PURCHASED by a second, simulated buyer
 * (`purchaseListing`, which internally chains `executeMarketplacePurchase`
 * → `distributeRoyalties` — the exact same functions the real
 * `/api/marketplace/purchaseWithRoyalties` HTTP route composes).
 *
 * Every balance assertion goes through `getBalance` (economy/balances.js),
 * which applies the canonical `CREDIT_ROW_PREDICATE` — summing raw
 * `to_user_id` rows naively would double-count the TRANSFER/
 * MARKETPLACE_PURCHASE two-row debit-half pattern and mint CC from nothing
 * (see CLAUDE.md's ledger-credit-summing invariant). This test proves
 * conservation end-to-end: what the buyer loses equals exactly what the
 * seller + platform + royalty-earning ancestor gain, combined.
 *
 * Real :memory: SQLite + the actual migrations this flow touches (same
 * precedent as tests/royalty-cascade-real-db.test.js and
 * tests/dtu-props.test.js) — no hand-rolled mock schema.
 *
 * Run: node --test tests/e2e/publish-royalty-citation-loop.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig002 from "../../migrations/002_economy_tables.js";
import * as mig005 from "../../migrations/005_purchases_table.js";
import * as mig008 from "../../migrations/008_economic_system.js";
import * as mig032 from "../../migrations/032_consent_layer.js";

import { registerCitation, calculateGenerationalRate } from "../../economy/royalty-cascade.js";
import { executePurchase } from "../../economy/transfer.js";
import { createListing, purchaseListing } from "../../economy/marketplace-service.js";
import { getBalance, CREDIT_ROW_PREDICATE } from "../../economy/balances.js";
import { PLATFORM_ACCOUNT_ID } from "../../economy/fees.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  mig002.up(db);
  mig005.up(db);
  mig008.up(db);
  mig032.up(db);
});

afterEach(() => { try { db?.close(); } catch { /* intentional */ } });

const r2 = (n) => Math.round(n * 100) / 100;
const PUBLIC = { visibility: "public" };

describe("Publish → royalty/citation E2E loop", () => {
  it("aria's work is cited by vex's derivative, vex lists it, a real buyer purchases it, and the royalty cascade pays aria the exact gen-1 rate — ledger conserves", () => {
    // ── 1. Create: vex's derivative cites aria's original work ───────────
    const cite = registerCitation(db, {
      childId: "dome_buckler_v2",
      parentId: "stance_cold_v1",
      creatorId: "vex",
      parentCreatorId: "aria",
      parentDtu: PUBLIC,
    });
    assert.equal(cite.ok, true, "citation must register against the real royalty_lineage table");

    // ── 2. Publish: vex lists the derivative for sale ─────────────────────
    const listing = createListing(db, {
      sellerId: "vex",
      contentId: "dome_buckler_v2",
      contentType: "dtu",
      title: "Dome Buckler v2",
      description: "A defensive stance derived from Aria's Cold Stance",
      price: 200,
      contentData: "dome_buckler_v2::real content payload for hashing",
      royaltyChain: ["stance_cold_v1"], // non-empty -> purchaseListing runs distributeRoyalties
    });
    assert.equal(listing.ok, true, `listing must be created: ${JSON.stringify(listing)}`);
    assert.equal(listing.listing.status, "active");
    assert.equal(listing.listing.price, 200);

    // ── 3. Fund a real second (simulated) buyer with real CC ──────────────
    const funded = executePurchase(db, { userId: "buyer_1", amount: 1000 });
    assert.equal(funded.ok, true);

    const before = {
      buyer: getBalance(db, "buyer_1").balance,
      vex: getBalance(db, "vex").balance,
      aria: getBalance(db, "aria").balance,
      platform: getBalance(db, PLATFORM_ACCOUNT_ID).balance,
    };

    // ── 4. Purchase: buyer_1 buys vex's listing ────────────────────────────
    const purchase = purchaseListing(db, { buyerId: "buyer_1", listingId: listing.listing.id });
    assert.equal(purchase.ok, true, `purchase must succeed: ${JSON.stringify(purchase)}`);
    assert.equal(purchase.royalties.total, r2(200 * calculateGenerationalRate(1)),
      "gen-1 royalty on a 200 CC sale = 200 * (0.21/2) = 21.00 CC");
    assert.equal(purchase.royalties.payouts.length, 1);
    assert.equal(purchase.royalties.payouts[0].recipientId, "aria");

    const after = {
      buyer: getBalance(db, "buyer_1").balance,
      vex: getBalance(db, "vex").balance,
      aria: getBalance(db, "aria").balance,
      platform: getBalance(db, PLATFORM_ACCOUNT_ID).balance,
    };

    // Buyer paid exactly the listing price — no more, no less.
    assert.equal(r2(after.buyer - before.buyer), -200);

    // Aria (the cited ancestor, who never listed anything herself) earned
    // exactly the gen-1 royalty — proving the citation registered at step 1
    // actually drives real money at purchase time, not just a lineage record.
    assert.equal(r2(after.aria - before.aria), 21.00);

    // Marketplace fee is 5.46% of price (CLAUDE.md's constitutional fee
    // constants: TOKEN_PURCHASE_FEE 1.46% + MARKETPLACE_FEE 4%) = 10.92 CC.
    const marketplaceFee = r2(200 * 0.0546);
    assert.equal(r2(after.platform - before.platform), marketplaceFee);

    // Vex (the seller) gets what's left: price - fee - royalty.
    const vexNet = r2(200 - marketplaceFee - 21.00);
    assert.equal(r2(after.vex - before.vex), vexNet);

    // ── Conservation: exactly what the buyer lost is exactly what
    // everyone else combined gained. No CC minted, none destroyed. ────────
    const buyerLoss = r2(before.buyer - after.buyer);
    const everyoneElseGain = r2(
      (after.vex - before.vex) + (after.aria - before.aria) + (after.platform - before.platform)
    );
    assert.equal(buyerLoss, everyoneElseGain,
      `ledger must conserve: buyer lost ${buyerLoss}, everyone else gained ${everyoneElseGain}`);

    // ── Independently prove CREDIT_ROW_PREDICATE is load-bearing here:
    // a naive "sum every to_user_id row" WOULD double-count vex's credit
    // (the two-row MARKETPLACE_PURCHASE debit-half also names vex as
    // to_user_id). Demonstrate the naive sum actually overcounts, so this
    // test would have caught the money-printing bug CLAUDE.md documents. ──
    const naiveVexCredits = db.prepare(
      `SELECT COALESCE(SUM(net), 0) AS total FROM economy_ledger WHERE to_user_id = 'vex' AND status = 'complete'`
    ).get().total;
    const honestVexCredits = db.prepare(
      `SELECT COALESCE(SUM(net), 0) AS total FROM economy_ledger WHERE to_user_id = 'vex' AND status = 'complete' AND ${CREDIT_ROW_PREDICATE}`
    ).get().total;
    assert.ok(naiveVexCredits > honestVexCredits,
      "the naive (un-predicated) sum must overcount vs the CREDIT_ROW_PREDICATE-filtered sum — proving the predicate is doing real, necessary work in this exact flow");
    // CREDIT_ROW_PREDICATE fixes double-counted CREDITS only — it is not
    // itself a net-balance computation (getBalance separately subtracts the
    // debit side, which is where the ROYALTY_PAYOUT's from_user_id='vex' row
    // reduces vex's real balance to 168.08, asserted above). The honest
    // credit-only sum is exactly the marketplace-purchase net BEFORE the
    // royalty debit: price minus the 5.46% platform fee.
    assert.equal(r2(honestVexCredits), purchase.sellerNet);
    assert.equal(r2(honestVexCredits), 189.08);
  });

  it("a derivative with a non-consenting (private) parent cannot even be created as a citation — the marketplace never sees a royalty-evading listing", () => {
    const cite = registerCitation(db, {
      childId: "shadow_copy",
      parentId: "aria_private_notes",
      creatorId: "vex",
      parentCreatorId: "aria",
      parentDtu: { ownerId: "aria", visibility: "private" },
    });
    assert.equal(cite.ok, false);
    assert.equal(cite.error, "citation_consent_not_granted");

    // vex can still list ORIGINAL (non-derivative) work honestly — an empty
    // royaltyChain means purchaseListing correctly pays no royalties, not a
    // fabricated cascade.
    const listing = createListing(db, {
      sellerId: "vex", contentId: "shadow_copy", contentType: "dtu",
      title: "Original Work (no citation)", price: 50,
      contentData: "original::payload", royaltyChain: [],
    });
    assert.equal(listing.ok, true);

    executePurchase(db, { userId: "buyer_2", amount: 500 });
    const purchase = purchaseListing(db, { buyerId: "buyer_2", listingId: listing.listing.id });
    assert.equal(purchase.ok, true);
    assert.equal(purchase.royalties.total, 0, "no citation was ever registered — nothing to pay out");
    assert.equal(purchase.royalties.payouts.length, 0);
  });

  it("duplicate content is rejected honestly at listing time — no phantom second listing to double-sell", () => {
    const first = createListing(db, {
      sellerId: "vex", contentId: "content_a", contentType: "dtu",
      title: "First listing", price: 10, contentData: "identical-bytes",
    });
    assert.equal(first.ok, true);

    const dup = createListing(db, {
      sellerId: "mira", contentId: "content_b", contentType: "dtu",
      title: "Suspicious re-list", price: 10, contentData: "identical-bytes",
    });
    assert.equal(dup.ok, false);
    assert.equal(dup.error, "duplicate_content");
    assert.equal(dup.existingListing.sellerId, "vex");
  });

  it("cannot buy your own listing — self-dealing is rejected before any ledger row is written", () => {
    const listing = createListing(db, {
      sellerId: "vex", contentId: "self_deal", contentType: "dtu",
      title: "Self deal test", price: 30, contentData: "self-deal-payload",
    });
    assert.equal(listing.ok, true);

    const before = getBalance(db, "vex").balance;
    const purchase = purchaseListing(db, { buyerId: "vex", listingId: listing.listing.id });
    assert.equal(purchase.ok, false);
    assert.equal(purchase.error, "cannot_buy_own_listing");
    assert.equal(getBalance(db, "vex").balance, before, "no phantom ledger movement on a rejected self-purchase");
  });
});
