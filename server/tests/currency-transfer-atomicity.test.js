/**
 * Pinning test for currency.js's atomicity fix (verification-audit
 * campaign, money-txn-hygiene finding).
 *
 * awardSparks/spendSparks each did an UPDATE users + INSERT sparks_ledger
 * as two unguarded sequential writes; transferSparks called spendSparks
 * then awardSparks with nothing wrapping the pair. A crash partway through
 * could destroy Sparks (debited from the sender, never credited to the
 * recipient) or leave a balance change with no matching ledger row.
 *
 * Run: node --test server/tests/currency-transfer-atomicity.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { awardSparks, spendSparks, transferSparks } from "../lib/currency.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      sparks REAL NOT NULL DEFAULT 0,
      concordia_credits REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE sparks_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      delta REAL,
      reason TEXT,
      world_id TEXT
    );
  `);
  return db;
}

function fund(db, userId, sparks) {
  db.prepare(`INSERT INTO users (id, sparks) VALUES (?, ?)`).run(userId, sparks);
}
function sparksOf(db, userId) {
  return db.prepare(`SELECT sparks FROM users WHERE id = ?`).get(userId)?.sparks ?? 0;
}
function ledgerCount(db, userId) {
  return db.prepare(`SELECT COUNT(*) AS c FROM sparks_ledger WHERE user_id = ?`).get(userId).c;
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

describe("currency.js — awardSparks/spendSparks individual atomicity", () => {
  it("awardSparks rolls back the balance UPDATE when its ledger INSERT fails", () => {
    const db = freshDb();
    fund(db, "u1", 100);
    armRunFailureAtOccurrence(db, /INSERT INTO sparks_ledger/, 1);

    assert.throws(() => awardSparks(db, "u1", 50, "test_award"));
    assert.equal(sparksOf(db, "u1"), 100, "balance UPDATE must be rolled back");
    assert.equal(ledgerCount(db, "u1"), 0);
  });

  it("spendSparks rolls back the balance UPDATE when its ledger INSERT fails", () => {
    const db = freshDb();
    fund(db, "u2", 100);
    armRunFailureAtOccurrence(db, /INSERT INTO sparks_ledger/, 1);

    assert.throws(() => spendSparks(db, "u2", 50, "test_spend"));
    assert.equal(sparksOf(db, "u2"), 100, "balance UPDATE must be rolled back");
    assert.equal(ledgerCount(db, "u2"), 0);
  });
});

describe("currency.js — transferSparks end-to-end atomicity", () => {
  it("rolls back the sender's debit when the recipient's award fails", () => {
    const db = freshDb();
    fund(db, "from1", 500);
    fund(db, "to1", 0);

    // spendSparks makes the FIRST sparks_ledger INSERT; awardSparks makes
    // the SECOND. Fail the second so the transfer aborts partway through.
    armRunFailureAtOccurrence(db, /INSERT INTO sparks_ledger/, 2);

    assert.throws(() => transferSparks(db, "from1", "to1", 100, "gift"));

    assert.equal(sparksOf(db, "from1"), 500, "sender's spend must be rolled back");
    assert.equal(sparksOf(db, "to1"), 0, "recipient must not receive a partial transfer");
    assert.equal(ledgerCount(db, "from1"), 0, "no orphan debit ledger row");
    assert.equal(ledgerCount(db, "to1"), 0, "no orphan credit ledger row");
  });

  it("control: full transfer succeeds with correct balances and 2 ledger rows", () => {
    const db = freshDb();
    fund(db, "from2", 500);
    fund(db, "to2", 0);

    transferSparks(db, "from2", "to2", 100, "gift");

    assert.equal(sparksOf(db, "from2"), 400);
    assert.equal(sparksOf(db, "to2"), 100);
    assert.equal(ledgerCount(db, "from2"), 1);
    assert.equal(ledgerCount(db, "to2"), 1);
  });

  it("insufficient balance throws before any write happens", () => {
    const db = freshDb();
    fund(db, "from3", 10);
    fund(db, "to3", 0);

    assert.throws(() => transferSparks(db, "from3", "to3", 100, "gift"), /insufficient_sparks/);
    assert.equal(sparksOf(db, "from3"), 10);
    assert.equal(sparksOf(db, "to3"), 0);
  });
});
