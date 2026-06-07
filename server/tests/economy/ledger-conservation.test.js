/**
 * Ledger conservation — the money-printing regression guard.
 *
 * TRANSFER and MARKETPLACE_PURCHASE are written as a two-row debit+credit pair
 * where the DEBIT row carries BOTH from_user_id and to_user_id. A naive
 * "sum net for every to_user_id row" therefore credits the recipient TWICE,
 * minting CC from nothing and breaking the 1:1 USD peg. economy/balances.js
 * #CREDIT_ROW_PREDICATE excludes those redundant debit-half rows.
 *
 * This test pins conservation: for every operation, total credits gained ==
 * total debits taken (no value created or destroyed), and per-account deltas
 * are exact. Genuine single-row both-sided types (ROYALTY_PAYOUT) still credit.
 *
 * Run: node --test server/tests/economy/ledger-conservation.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { getBalance } from "../../economy/balances.js";
import { executePurchase, executeTransfer, executeMarketplacePurchase } from "../../economy/transfer.js";
import { recordTransactionBatch } from "../../economy/ledger.js";
import { verifyTreasuryInvariant, mintCoins } from "../../economy/coin-service.js";
import { PLATFORM_ACCOUNT_ID } from "../../economy/fees.js";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE economy_ledger (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, from_user_id TEXT, to_user_id TEXT,
      amount REAL NOT NULL, fee REAL NOT NULL DEFAULT 0, net REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'complete', metadata_json TEXT DEFAULT '{}',
      request_id TEXT, ip TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), ref_id TEXT);
    CREATE TABLE treasury (
      id TEXT PRIMARY KEY, total_usd REAL NOT NULL DEFAULT 0, total_coins REAL NOT NULL DEFAULT 0,
      updated_at TEXT);
    CREATE TABLE treasury_events (
      id TEXT PRIMARY KEY, event_type TEXT, amount REAL, usd_before REAL, usd_after REAL,
      coins_before REAL, coins_after REAL, ref_id TEXT, metadata_json TEXT, created_at TEXT);
    INSERT INTO treasury (id, total_usd, total_coins, updated_at) VALUES ('treasury_main', 0, 0, datetime('now'));
  `);
  return db;
}

const r2 = (n) => Math.round(n * 100) / 100;

describe("ledger conservation (no money printing)", () => {
  let db;
  beforeEach(() => { db = createDb(); });

  it("transfer: recipient gains exactly net, not 2× net", () => {
    executePurchase(db, { userId: "alice", amount: 1000 });
    const before = { a: getBalance(db, "alice").balance, b: getBalance(db, "bob").balance, p: getBalance(db, PLATFORM_ACCOUNT_ID).balance };
    const t = executeTransfer(db, { from: "alice", to: "bob", amount: 100 });
    assert.ok(t.ok);
    const after = { a: getBalance(db, "alice").balance, b: getBalance(db, "bob").balance, p: getBalance(db, PLATFORM_ACCOUNT_ID).balance };

    assert.equal(r2(after.a - before.a), -100);        // sender −100
    assert.equal(r2(after.b - before.b), 98.54);       // recipient +net (NOT 197.08)
    assert.equal(r2(after.p - before.p), 1.46);        // platform +fee
    // Conservation: what alice lost == what bob + platform gained.
    assert.equal(r2(before.a - after.a), r2((after.b - before.b) + (after.p - before.p)));
  });

  it("marketplace sale: seller gains exactly net, not 2× net", () => {
    executePurchase(db, { userId: "buyer", amount: 1000 });
    const before = { buyer: getBalance(db, "buyer").balance, seller: getBalance(db, "seller").balance, p: getBalance(db, PLATFORM_ACCOUNT_ID).balance };
    const m = executeMarketplacePurchase(db, { buyerId: "buyer", sellerId: "seller", amount: 100, listingId: "l1" });
    assert.ok(m.ok);
    const after = { buyer: getBalance(db, "buyer").balance, seller: getBalance(db, "seller").balance, p: getBalance(db, PLATFORM_ACCOUNT_ID).balance };

    assert.equal(r2(after.buyer - before.buyer), -100);   // buyer −100
    assert.equal(r2(after.seller - before.seller), 94.54);// seller +net (NOT 189.08)
    assert.equal(r2(after.p - before.p), 5.46);           // platform +5.46% fee
    assert.equal(r2(before.buyer - after.buyer), r2((after.seller - before.seller) + (after.p - before.p)));
  });

  it("ROYALTY_PAYOUT (single both-sided row) still credits the recipient", () => {
    // from=payer, to=recipient, single row — must count as a credit.
    recordTransactionBatch(db, [{
      type: "ROYALTY_PAYOUT", from: "__PLATFORM__", to: "ancestor", amount: 25, fee: 0, net: 25, status: "complete",
    }]);
    assert.equal(getBalance(db, "ancestor").balance, 25);
    assert.equal(getBalance(db, "__PLATFORM__").balance, -25); // payer debited
  });

  it("treasury invariant holds after a transfer (circulation == minted)", () => {
    mintCoins(db, { amount: 1000, userId: "alice" }); // mint to back the purchase
    executePurchase(db, { userId: "alice", amount: 1000 });
    executeTransfer(db, { from: "alice", to: "bob", amount: 200 });
    const inv = verifyTreasuryInvariant(db);
    assert.equal(inv.ok, true);
    // Circulating coins must not exceed minted USD (would fail if double-credited).
    assert.ok(inv.treasury.totalUsd >= inv.circulation.circulatingCoins,
      `circulating ${inv.circulation.circulatingCoins} exceeds USD ${inv.treasury.totalUsd}`);
  });
});
