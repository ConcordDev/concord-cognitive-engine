/**
 * Tier-3 authoring round-trip e2e:
 *   create recipe → publish to marketplace → second user buys → derivative
 *   work cites the recipe → royalty cascades back to original author.
 *
 * Walks the full creator-economy narrative against the real
 * `economy_ledger` + `royalty_lineage` + `royalty_payouts` schema, using
 * the actual production functions (`registerCitation`,
 * `distributeRoyalties`, `calculateGenerationalRate`). This is the
 * "your creations earn forever" promise as a contract test — if any
 * piece of the chain regresses, this test fails.
 *
 * Scope: economy substrate only. We do not exercise the full
 * /api/marketplace/purchaseWithRoyalties HTTP path here (that requires
 * the full server stack); the per-route purchase test in
 * `marketplace-purchase-with-royalties.test.js` covers that surface.
 *
 * Run: node --test tests/e2e/authoring-round-trip.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig002 from "../../migrations/002_economy_tables.js";
import * as mig008 from "../../migrations/008_economic_system.js";
import * as mig032 from "../../migrations/032_consent_layer.js";
import {
  registerCitation,
  distributeRoyalties,
  getAncestorChain,
  calculateGenerationalRate,
} from "../../economy/royalty-cascade.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  mig002.up(db);
  mig008.up(db);
  mig032.up(db);
});

afterEach(() => { try { db?.close(); } catch (_) { /* intentional */ } });

// Public DTU stand-in for the citation gate. The recipe is "scope=public,
// allow_citation=true" by virtue of being listed on the marketplace.
const PUBLIC = { visibility: "public" };

function ledgerRows(filter = "") {
  const where = filter ? `WHERE ${filter}` : "";
  return db.prepare(`SELECT * FROM economy_ledger ${where}`).all();
}

function lineageCount() {
  return db.prepare(`SELECT COUNT(*) AS n FROM royalty_lineage`).get().n;
}

describe("Authoring round-trip: create → publish → buy → derive → royalty", () => {

  it("a single derivative pays the original author at gen-1 rate", () => {
    // Author "aria" creates fighting style recipe "stance_cold".
    // Author "vex" buys it, creates a derivative "dome_buckler" by citing it.
    // When vex sells dome_buckler for 100 CC, aria collects gen-1 royalty.

    // Step 1: Vex's derivative cites Aria's stance.
    const cite = registerCitation(db, {
      childId: "dome_buckler",
      parentId: "stance_cold",
      creatorId: "vex",
      parentCreatorId: "aria",
      parentDtu: PUBLIC,
    });
    assert.equal(cite.ok, true);
    assert.equal(lineageCount(), 1);

    // Step 2: Someone buys vex's derivative for 100 CC.
    const out = distributeRoyalties(db, {
      contentId: "dome_buckler",
      transactionAmount: 100,
      sourceTxId: "tx_buy_dome_1",
      sellerId: "vex",
      buyerId: "buyer_1",
    });
    assert.equal(out.ok, true);
    assert.equal(out.payouts.length, 1);

    // gen-1 rate = 0.21 / 2 = 0.105 → 100 * 0.105 = 10.50 CC.
    assert.equal(out.payouts[0].recipientId, "aria");
    assert.equal(out.payouts[0].generation, 1);
    assert.equal(out.payouts[0].rate, calculateGenerationalRate(1));
    assert.equal(out.payouts[0].amount, 10.5);

    // Ledger row exists, type ROYALTY_PAYOUT, status complete.
    const ledger = ledgerRows(`type='ROYALTY_PAYOUT' AND to_user_id='aria'`);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].amount, 10.5);
    assert.equal(ledger[0].status, "complete");
  });

  it("a 3-deep chain (gen 1 → gen 2 → gen 3) pays each ancestor at the halving rate", () => {
    // aria → vex (gen 1) → mira (gen 2) → kai (gen 3 sells)
    registerCitation(db, {
      childId: "vex_style", parentId: "aria_style",
      creatorId: "vex", parentCreatorId: "aria",
      parentDtu: PUBLIC,
    });
    registerCitation(db, {
      childId: "mira_style", parentId: "vex_style",
      creatorId: "mira", parentCreatorId: "vex",
      parentDtu: PUBLIC,
    });
    registerCitation(db, {
      childId: "kai_style", parentId: "mira_style",
      creatorId: "kai", parentCreatorId: "mira",
      parentDtu: PUBLIC,
    });

    // Buyer buys kai's style for 1000 CC.
    const out = distributeRoyalties(db, {
      contentId: "kai_style",
      transactionAmount: 1000,
      sourceTxId: "tx_buy_kai_1",
      sellerId: "kai",
      buyerId: "buyer_x",
    });
    assert.equal(out.ok, true);
    assert.equal(out.payouts.length, 3, "all three ancestors paid");

    // Closest ancestor first.
    const byCreator = Object.fromEntries(out.payouts.map((p) => [p.recipientId, p]));
    assert.equal(byCreator.mira.generation, 1);
    assert.equal(byCreator.vex.generation,  2);
    assert.equal(byCreator.aria.generation, 3);

    // Halving sequence: 1000 * (0.105, 0.0525, 0.02625) = (105, 52.5, 26.25) — under cap.
    assert.equal(byCreator.mira.amount, 105);
    assert.equal(byCreator.vex.amount,  52.5);
    assert.equal(byCreator.aria.amount, 26.25);

    const total = out.payouts.reduce((s, p) => s + p.amount, 0);
    assert.ok(total < 300 + 0.01, "total under 30% cap");

    // All three ledger rows landed.
    const rows = ledgerRows(`type='ROYALTY_PAYOUT'`);
    assert.equal(rows.length, 3);
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    assert.equal(sum, 105 + 52.5 + 26.25);
  });

  it("royalties never reach zero — at gen 50 the floor (0.05%) still pays", () => {
    // Build the lineage chain manually so we don't actually create 50 DTUs;
    // royalty_lineage allows arbitrary generation distance per row.
    db.prepare(`
      INSERT INTO royalty_lineage (id, child_id, parent_id, generation, creator_id, parent_creator, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("lin_far", "very_descended", "primordial", 50, "current", "ancient",
           new Date().toISOString().replace("T", " ").replace("Z", ""));

    const r = calculateGenerationalRate(50);
    assert.equal(r, 0.0005, "floor is 0.05%");

    const out = distributeRoyalties(db, {
      contentId: "very_descended",
      transactionAmount: 1000,
      sourceTxId: "tx_far_1",
      sellerId: "current",
      buyerId: "buyer_far",
    });
    assert.equal(out.ok, true);
    assert.equal(out.payouts.length, 1);
    assert.equal(out.payouts[0].recipientId, "ancient");
    assert.equal(out.payouts[0].rate, 0.0005);
    assert.equal(out.payouts[0].amount, 0.5);  // 1000 * 0.0005
  });

  it("a derivative with NO ancestors yields zero royalties (the seller keeps everything)", () => {
    // Author "solo" makes an entirely original style that cites nothing.
    // No royalty cascade should fire — they pocket the whole sale.
    const out = distributeRoyalties(db, {
      contentId: "solo_style",
      transactionAmount: 100,
      sourceTxId: "tx_solo_1",
      sellerId: "solo",
      buyerId: "buyer_y",
    });
    assert.equal(out.ok, true);
    assert.equal(out.payouts.length, 0);
    assert.equal(out.totalRoyalties, 0);
    assert.equal(ledgerRows(`type='ROYALTY_PAYOUT'`).length, 0);
  });

  it("two simultaneous purchases of the same derivative each cascade royalties (no double-pay)", () => {
    // aria's stance is widely cited; vex's derivative is bought twice.
    registerCitation(db, {
      childId: "vex_style", parentId: "aria_style",
      creatorId: "vex", parentCreatorId: "aria",
      parentDtu: PUBLIC,
    });

    const r1 = distributeRoyalties(db, {
      contentId: "vex_style", transactionAmount: 100,
      sourceTxId: "tx_buy_1", sellerId: "vex", buyerId: "buyer_a",
    });
    const r2 = distributeRoyalties(db, {
      contentId: "vex_style", transactionAmount: 100,
      sourceTxId: "tx_buy_2", sellerId: "vex", buyerId: "buyer_b",
    });

    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r1.payouts[0].amount, 10.5);
    assert.equal(r2.payouts[0].amount, 10.5);

    // Aria collects 10.5 + 10.5 = 21 CC across the two sales.
    const ariaRows = ledgerRows(`type='ROYALTY_PAYOUT' AND to_user_id='aria'`);
    assert.equal(ariaRows.length, 2);
    const ariaTotal = ariaRows.reduce((s, r) => s + r.amount, 0);
    assert.equal(ariaTotal, 21);
  });

  it("idempotency: replaying the same purchase doesn't double-pay royalties", () => {
    registerCitation(db, {
      childId: "vex_style", parentId: "aria_style",
      creatorId: "vex", parentCreatorId: "aria",
      parentDtu: PUBLIC,
    });

    const r1 = distributeRoyalties(db, {
      contentId: "vex_style", transactionAmount: 100,
      sourceTxId: "tx_dup", sellerId: "vex", buyerId: "buyer_a",
    });
    assert.equal(r1.ok, true);
    const after1 = ledgerRows(`type='ROYALTY_PAYOUT'`).length;

    // Replay with the same sourceTxId — should be a no-op.
    const r2 = distributeRoyalties(db, {
      contentId: "vex_style", transactionAmount: 100,
      sourceTxId: "tx_dup", sellerId: "vex", buyerId: "buyer_a",
    });
    assert.equal(r2.ok, true);

    const after2 = ledgerRows(`type='ROYALTY_PAYOUT'`).length;
    assert.equal(after1, after2, "idempotent — no second payout row");
  });

  it("non-public parent without consent path blocks the citation entirely", () => {
    // The recipe substrate's scope='personal' default + the consent gate
    // together mean an unpublished parent cannot be cited at all.
    const cite = registerCitation(db, {
      childId: "vex_style", parentId: "aria_personal_style",
      creatorId: "vex", parentCreatorId: "aria",
      parentDtu: { ownerId: "aria", visibility: "private" },
    });
    assert.equal(cite.ok, false);
    assert.equal(cite.error, "citation_consent_not_granted");
    assert.equal(lineageCount(), 0);

    // Distribute royalties on the orphan child — no ancestors, no payout.
    const out = distributeRoyalties(db, {
      contentId: "vex_style", transactionAmount: 100,
      sourceTxId: "tx_orphan_1", sellerId: "vex", buyerId: "buyer_o",
    });
    assert.equal(out.ok, true);
    assert.equal(out.payouts.length, 0);
  });

  it("ancestor chain is queryable end-to-end (the substrate dashboard's downstream view)", () => {
    // Build aria → vex → mira; query getAncestorChain for mira.
    registerCitation(db, {
      childId: "vex_style", parentId: "aria_style",
      creatorId: "vex", parentCreatorId: "aria",
      parentDtu: PUBLIC,
    });
    registerCitation(db, {
      childId: "mira_style", parentId: "vex_style",
      creatorId: "mira", parentCreatorId: "vex",
      parentDtu: PUBLIC,
    });

    const chain = getAncestorChain(db, "mira_style");
    const ids = chain.map((c) => c.contentId).sort();
    assert.deepEqual(ids, ["aria_style", "vex_style"]);

    const aria = chain.find((c) => c.creatorId === "aria");
    assert.equal(aria.generation, 2);
    assert.equal(aria.rate, calculateGenerationalRate(2));
  });

});
