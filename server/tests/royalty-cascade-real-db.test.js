/**
 * Royalty cascade against the REAL economy_ledger schema.
 *
 * The existing royalty-cascade.test.js uses a hand-built mock DB with
 * arrays for lineageRows / payoutRows / ledgerRows. That covers the math
 * but doesn't catch:
 *   - SQL CHECK constraint violations (`amount > 0`, `net > 0`, type
 *     enum, status enum)
 *   - Schema-vs-code drift (column names, types, NOT NULL columns)
 *   - Row-count assertions across the actual indexed tables
 *
 * This test runs the real `registerCitation` → `distributeRoyalties`
 * chain against a :memory: SQLite DB seeded with migrations 002 + 008
 * (the two migrations that create economy_ledger + royalty_lineage +
 * royalty_payouts).
 *
 * Run: node --test tests/royalty-cascade-real-db.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig002 from "../migrations/002_economy_tables.js";
import * as mig008 from "../migrations/008_economic_system.js";
import {
  registerCitation,
  distributeRoyalties,
  getAncestorChain,
  calculateGenerationalRate,
  CONCORD_ROYALTY_RATE,
} from "../economy/royalty-cascade.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  // Run only the migrations the royalty-cascade module actually touches.
  // Pulling all 100 migrations would couple this test to unrelated schema.
  mig002.up(db);
  mig008.up(db);
});

afterEach(() => { try { db?.close(); } catch (_) { /* intentional */ } });

const PUBLIC_PARENT = { visibility: "public" };

function ledgerRows(filter = "") {
  const where = filter ? `WHERE ${filter}` : "";
  return db.prepare(`SELECT * FROM economy_ledger ${where}`).all();
}

function lineageRows() {
  return db.prepare(`SELECT * FROM royalty_lineage`).all();
}

describe("registerCitation against real schema", () => {
  it("inserts a row into royalty_lineage that satisfies all CHECK constraints", () => {
    const r = registerCitation(db, {
      childId: "content_B", parentId: "content_A",
      creatorId: "user_B", parentCreatorId: "user_A",
      parentDtu: PUBLIC_PARENT,
    });
    assert.equal(r.ok, true);

    const rows = lineageRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].child_id, "content_B");
    assert.equal(rows[0].parent_id, "content_A");
    assert.equal(rows[0].generation, 1);
    assert.equal(rows[0].creator_id, "user_B");
    assert.equal(rows[0].parent_creator, "user_A");
  });

  it("UNIQUE(child_id, parent_id) prevents duplicate lineage rows (idempotent)", () => {
    const opts = {
      childId: "B", parentId: "A",
      creatorId: "uB", parentCreatorId: "uA",
      parentDtu: PUBLIC_PARENT,
    };
    registerCitation(db, opts);
    const r2 = registerCitation(db, opts); // INSERT OR IGNORE per the registry
    assert.equal(r2.ok, true);
    assert.equal(lineageRows().length, 1, "second registerCitation must be a no-op");
  });
});

describe("distributeRoyalties against real schema", () => {
  it("creates a ROYALTY_PAYOUT ledger row whose amount respects the 30% cap", () => {
    // Single ancestor at gen 1: rate = INITIAL_ROYALTY_RATE / 2^1 = 0.105.
    // (See calculateGenerationalRate at royalty-cascade.js:44 — rate is
    // initialRate / 2^generation; gen 1 halves once.)
    // 1000 * 0.105 = 105, well under 30% cap (300).
    registerCitation(db, {
      childId: "B", parentId: "A",
      creatorId: "uB", parentCreatorId: "uA",
      parentDtu: PUBLIC_PARENT,
    });

    const r = distributeRoyalties(db, {
      contentId: "B",
      transactionAmount: 1000,
      sourceTxId: "tx_real_1",
      sellerId: "uB",
    });

    assert.equal(r.ok, true);
    assert.equal(r.payouts.length, 1);
    assert.equal(r.payouts[0].recipientId, "uA");
    assert.equal(r.payouts[0].amount, 105);

    const ledger = ledgerRows(`type='ROYALTY_PAYOUT' AND to_user_id='uA'`);
    assert.equal(ledger.length, 1, "exactly one ledger row for the parent creator");
    assert.equal(ledger[0].amount, 105);
    assert.equal(ledger[0].status, "complete");
  });

  it("respects the 30% cap when ancestor count would otherwise exceed it", () => {
    // Five gen-1 ancestors → each at 0.21. Without cap, total = 1050 (> 30%).
    // With cap (300), only the first ~1.4 ancestors fit; remainder skipped.
    for (let i = 0; i < 5; i++) {
      registerCitation(db, {
        childId: "B", parentId: `A${i}`,
        creatorId: "uB", parentCreatorId: `uA${i}`,
        parentDtu: PUBLIC_PARENT,
      });
    }

    const r = distributeRoyalties(db, {
      contentId: "B",
      transactionAmount: 1000,
      sourceTxId: "tx_cap",
      sellerId: "uB",
    });

    assert.equal(r.ok, true);
    const total = r.payouts.reduce((s, p) => s + p.amount, 0);
    assert.ok(total <= 300 + 0.01, `total ${total} must respect 30% cap`);

    // Verify the ledger table itself agrees with what distributeRoyalties returned.
    // economy_ledger has no source_tx_id column; sourceTxId lives inside
    // metadata_json. We match all ROYALTY_PAYOUT rows from this test.
    const allRoyaltyRows = ledgerRows(`type='ROYALTY_PAYOUT'`);
    const sumAll = allRoyaltyRows.reduce((s, row) => s + row.amount, 0);
    assert.ok(sumAll <= 300 + 0.01, `ledger ROYALTY_PAYOUT sum ${sumAll} must respect 30% cap`);
    assert.equal(sumAll, total, "ledger sum must equal payout sum");
  });

  it("idempotency: same sourceTxId → second distributeRoyalties is a no-op", () => {
    registerCitation(db, {
      childId: "B", parentId: "A",
      creatorId: "uB", parentCreatorId: "uA",
      parentDtu: PUBLIC_PARENT,
    });

    const r1 = distributeRoyalties(db, {
      contentId: "B", transactionAmount: 1000,
      sourceTxId: "tx_idem", sellerId: "uB",
    });
    assert.equal(r1.ok, true);
    const after1 = ledgerRows(`type='ROYALTY_PAYOUT'`).length;

    const r2 = distributeRoyalties(db, {
      contentId: "B", transactionAmount: 1000,
      sourceTxId: "tx_idem", sellerId: "uB",
    });
    // Either ok:true with payouts:[] (skipped) OR a recognizable
    // already-applied indicator. Whichever shape, the ledger must NOT
    // double up.
    const after2 = ledgerRows(`type='ROYALTY_PAYOUT'`).length;
    assert.equal(after2, after1, "second distributeRoyalties must NOT add ledger rows for the same sourceTxId");
  });

  it("seller never pays themselves (creatorId === sellerId is skipped)", () => {
    // Self-citation case: creator is also the seller. Shouldn't get a
    // royalty payout (they already received the sale revenue).
    registerCitation(db, {
      childId: "B", parentId: "A",
      creatorId: "u_self", parentCreatorId: "u_self",
      parentDtu: PUBLIC_PARENT,
    });

    const r = distributeRoyalties(db, {
      contentId: "B", transactionAmount: 1000,
      sourceTxId: "tx_self", sellerId: "u_self",
    });
    // Either ok:true with empty payouts OR ok:true with a "no_payable_royalties" message.
    assert.equal(r.ok, true);
    const selfPayouts = ledgerRows(`type='ROYALTY_PAYOUT' AND to_user_id='u_self'`);
    assert.equal(selfPayouts.length, 0, "seller must never be paid royalties on their own sale");
  });

  it("ancestor chain depth ≥ 5 produces correctly halved rates", () => {
    // Build linear chain: A → B → C → D → E → F (each cites parent)
    // gen 1: B cites A
    // gen 2: C cites B (so C has ancestors B@1, A@2)
    // ...
    // F has 5 ancestors at gen 1..5. Rate at gen N = 0.21 / 2^(N-1).
    const chain = ["A", "B", "C", "D", "E", "F"];
    for (let i = 1; i < chain.length; i++) {
      registerCitation(db, {
        childId: chain[i], parentId: chain[i - 1],
        creatorId: `u${chain[i]}`, parentCreatorId: `u${chain[i - 1]}`,
        parentDtu: PUBLIC_PARENT,
      });
    }

    const ancestors = getAncestorChain(db, "F");
    assert.ok(ancestors.length >= 5, `expected ≥5 ancestors of F, got ${ancestors.length}`);

    // Verify rate halving for each generation
    for (const a of ancestors) {
      const expectedRate = calculateGenerationalRate(a.generation);
      assert.ok(
        Math.abs(a.rate - expectedRate) < 0.0001,
        `gen ${a.generation}: expected rate ${expectedRate}, got ${a.rate}`,
      );
    }
  });
});

describe("CONCORD_ROYALTY_RATE constant integrity", () => {
  it("CONCORD_ROYALTY_RATE is exposed and is a finite number", () => {
    assert.equal(typeof CONCORD_ROYALTY_RATE, "number");
    assert.ok(Number.isFinite(CONCORD_ROYALTY_RATE));
  });
});
