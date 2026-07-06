/**
 * Pinning test for stripe.js's transfer.failed webhook atomicity fix
 * (verification-audit campaign, money-txn-hygiene finding).
 *
 * `_reverseFailedWithdrawal` restores the withdrawal to 'approved' AND
 * records a REVERSAL ledger entry. Prior to the fix these were two
 * unguarded sequential writes — a crash between them could leave a
 * withdrawal stuck 'processing' forever with the CC debit never reversed
 * in the ledger, or a reversal ledger row with the withdrawal never
 * restored to 'approved' (so it can't be retried/cancelled).
 *
 * Run: node --test server/tests/economy/stripe-webhook-atomicity.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { _reverseFailedWithdrawal } from "../../economy/stripe.js";

function createTestDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE economy_withdrawals (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );
    CREATE TABLE economy_ledger (
      id TEXT PRIMARY KEY,
      type TEXT,
      from_user_id TEXT,
      to_user_id TEXT,
      amount REAL,
      fee REAL,
      net REAL,
      status TEXT,
      metadata_json TEXT,
      request_id TEXT,
      ip TEXT,
      created_at TEXT,
      ref_id TEXT
    );
  `);
  return db;
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

const LEDGER_INSERT_RE = /INSERT INTO economy_ledger/;

describe("stripe.js transfer.failed atomicity", () => {
  it("rolls back the withdrawal status revert when the ledger REVERSAL insert fails", () => {
    const db = createTestDb();
    db.prepare("INSERT INTO economy_withdrawals (id, status) VALUES (?, 'processing')").run("wd_1");

    armRunFailureAtOccurrence(db, LEDGER_INSERT_RE, 1);

    assert.throws(() => {
      _reverseFailedWithdrawal(db, {
        withdrawalId: "wd_1",
        concordUserId: "user_1",
        amount: 500,
        stripeTransferId: "tr_1",
      });
    });

    const row = db.prepare("SELECT status FROM economy_withdrawals WHERE id = 'wd_1'").get();
    assert.equal(row.status, "processing", "the status UPDATE must be rolled back when the ledger INSERT throws");

    const ledgerCount = db.prepare("SELECT COUNT(*) AS c FROM economy_ledger").get().c;
    assert.equal(ledgerCount, 0, "no orphan reversal ledger row for the rolled-back attempt");
  });

  it("control: succeeds end-to-end with no induced failure", () => {
    const db = createTestDb();
    db.prepare("INSERT INTO economy_withdrawals (id, status) VALUES (?, 'processing')").run("wd_2");

    _reverseFailedWithdrawal(db, {
      withdrawalId: "wd_2",
      concordUserId: "user_2",
      amount: 250,
      stripeTransferId: "tr_2",
    });

    const row = db.prepare("SELECT status FROM economy_withdrawals WHERE id = 'wd_2'").get();
    assert.equal(row.status, "approved");

    // Also pins the from/to/metadata field-name fix (recordTransactionBatch
    // reads tx.from/tx.to/tx.metadata, not from_user_id/to_user_id/
    // metadata_json) — before that fix this row's parties landed NULL.
    const ledgerRow = db.prepare("SELECT * FROM economy_ledger WHERE type = 'REVERSAL'").get();
    assert.ok(ledgerRow, "reversal ledger row must exist");
    assert.equal(ledgerRow.amount, 250);
    assert.equal(ledgerRow.from_user_id, "__PLATFORM__", "from party must be recorded, not NULL");
    assert.equal(ledgerRow.to_user_id, "user_2", "to party must be recorded, not NULL");
    assert.match(ledgerRow.metadata_json, /transfer_failed/, "metadata must be recorded, not the empty-object fallback");
  });

  it("zero-amount reversal skips the ledger insert but still restores status", () => {
    const db = createTestDb();
    db.prepare("INSERT INTO economy_withdrawals (id, status) VALUES (?, 'processing')").run("wd_3");

    _reverseFailedWithdrawal(db, {
      withdrawalId: "wd_3",
      concordUserId: "user_3",
      amount: 0,
      stripeTransferId: "tr_3",
    });

    const row = db.prepare("SELECT status FROM economy_withdrawals WHERE id = 'wd_3'").get();
    assert.equal(row.status, "approved");
    const ledgerCount = db.prepare("SELECT COUNT(*) AS c FROM economy_ledger").get().c;
    assert.equal(ledgerCount, 0);
  });
});
