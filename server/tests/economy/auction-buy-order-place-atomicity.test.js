/**
 * Pinning test for auctions.js#placeBuyOrder's atomicity fix
 * (verification-audit campaign, money-txn-hygiene finding).
 *
 * Prior to the fix, the escrow debit (_walletDebit) ran to completion as a
 * standalone write BEFORE the auction_buy_orders INSERT, only refunded via
 * a catch if the INSERT threw SYNCHRONOUSLY. A hard crash between the debit
 * and the insert left the buyer's CC permanently escrowed with no order row
 * to ever release or refund it against.
 *
 * Uses a REAL better-sqlite3 in-memory DB (the sibling auctions.test.js's
 * hand-rolled fake DB's `transaction(fn) { return () => fn(); }` does not
 * actually roll back, so it cannot pin this).
 *
 * Run: node --test server/tests/economy/auction-buy-order-place-atomicity.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { placeBuyOrder } from "../../lib/auctions.js";
import { up as upBuyOrders } from "../../migrations/227_auction_buy_orders.js";

function freshDb() {
  const db = new Database(":memory:");
  upBuyOrders(db);
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      concordia_credits REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE reward_ledger (
      id TEXT PRIMARY KEY, user_id TEXT, kind TEXT,
      amount_cc REAL, ts INTEGER, ref_id TEXT
    );
  `);
  return db;
}

function fund(db, userId, amount) {
  db.prepare(`INSERT INTO users (id, concordia_credits) VALUES (?, ?)`).run(userId, amount);
}
function balance(db, userId) {
  return db.prepare(`SELECT concordia_credits AS b FROM users WHERE id = ?`).get(userId)?.b ?? 0;
}

function armRunFailureAtOccurrence(db, matchSql, occurrence) {
  const origPrepare = db.prepare.bind(db);
  let count = 0;
  db.prepare = (sql) => {
    const stmt = origPrepare(sql);
    if (matchSql.test(sql)) {
      count += 1;
      const thisOccurrence = count;
      if (thisOccurrence === occurrence) {
        return {
          run: () => { throw new Error(`simulated_failure_at_occurrence_${occurrence}`); },
          get: (...args) => stmt.get(...args),
          all: (...args) => stmt.all(...args),
        };
      }
    }
    return stmt;
  };
}

describe("auctions.js placeBuyOrder atomicity", () => {
  it("rolls back the escrow debit when the order INSERT fails", () => {
    const db = freshDb();
    fund(db, "buyer_1", 1000);

    armRunFailureAtOccurrence(db, /INSERT INTO auction_buy_orders/, 1);

    const result = placeBuyOrder(db, "buyer_1", {
      itemDescriptor: "sand-strider-saddle",
      unitPriceCc: 100,
      quantity: 2,
    });

    assert.equal(result.ok, false);
    assert.equal(balance(db, "buyer_1"), 1000, "escrow debit must be rolled back when the order INSERT fails");

    const orderCount = db.prepare("SELECT COUNT(*) AS c FROM auction_buy_orders").get().c;
    assert.equal(orderCount, 0, "no orphan order row");
  });

  it("rejects with insufficient_funds before ever touching the DB when balance is too low", () => {
    const db = freshDb();
    fund(db, "buyer_2", 50);

    const result = placeBuyOrder(db, "buyer_2", {
      itemDescriptor: "sand-strider-saddle",
      unitPriceCc: 100,
      quantity: 2,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, "insufficient_funds");
    assert.equal(balance(db, "buyer_2"), 50, "balance must be untouched on a rejected order");
    const orderCount = db.prepare("SELECT COUNT(*) AS c FROM auction_buy_orders").get().c;
    assert.equal(orderCount, 0);
  });

  it("control: succeeds end-to-end with correct escrow and one order row", () => {
    const db = freshDb();
    fund(db, "buyer_3", 1000);

    const result = placeBuyOrder(db, "buyer_3", {
      itemDescriptor: "sand-strider-saddle",
      unitPriceCc: 100,
      quantity: 2,
    });

    assert.equal(result.ok, true);
    assert.equal(result.escrowCc, 200);
    assert.equal(balance(db, "buyer_3"), 800);

    const order = db.prepare("SELECT * FROM auction_buy_orders WHERE id = ?").get(result.buyOrderId);
    assert.ok(order);
    assert.equal(order.total_escrow_cc, 200);
    assert.equal(order.quantity_wanted, 2);
  });
});
