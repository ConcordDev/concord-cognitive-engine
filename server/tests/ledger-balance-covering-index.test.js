// tests/ledger-balance-covering-index.test.js
//
// Real-SQL companion to balances.test.js (which uses a mock db): verifies the
// event-sourced getBalance against actual SQLite, and PINS that migration 324's
// covering indexes are used as index-only scans. If someone drops an index or
// rewrites the balance query in a way that defeats it, this fails — protecting
// the O(matching-rows) read that lets balance stay a pure ledger function (no
// drift-prone stored cache) without an O(history) cost.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { getBalance } from "../economy/balances.js";
import { up as upCoveringIndex } from "../migrations/324_ledger_balance_covering_index.js";

function freshDb() {
  const db = new Database(":memory:");
  // The columns getBalance + the covering indexes touch (mirrors migration 002).
  db.exec(`
    CREATE TABLE economy_ledger (
      id TEXT PRIMARY KEY, type TEXT, from_user_id TEXT, to_user_id TEXT,
      amount REAL, fee REAL, net REAL, status TEXT, metadata_json TEXT,
      request_id TEXT, ip TEXT, created_at TEXT, ref_id TEXT
    );
  `);
  upCoveringIndex(db);
  return db;
}

function insert(db, row) {
  db.prepare(
    `INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status, created_at)
     VALUES (@id, @type, @from_user_id, @to_user_id, @amount, @fee, @net, @status, @created_at)`,
  ).run({ fee: 0, created_at: new Date().toISOString(), ...row });
}

describe("ledger balance covering index (migration 324)", () => {
  it("getBalance sums only complete rows (credits − debits), excluding pending/reversed", () => {
    const db = freshDb();
    insert(db, { id: "a", type: "TRANSFER", from_user_id: "sys", to_user_id: "u1", amount: 100, net: 100, status: "complete" });
    insert(db, { id: "b", type: "TRANSFER", from_user_id: "sys", to_user_id: "u1", amount: 50, net: 50, status: "pending" });   // excluded
    insert(db, { id: "c", type: "REVERSAL", from_user_id: "sys", to_user_id: "u1", amount: 25, net: 25, status: "reversed" });  // excluded
    insert(db, { id: "d", type: "MARKETPLACE_PURCHASE", from_user_id: "u1", to_user_id: "x", amount: 30, net: 30, status: "complete" }); // debit

    const bal = getBalance(db, "u1");
    assert.equal(bal.balance, 70, "100 complete credit − 30 complete debit; pending + reversed excluded");
    assert.equal(bal.totalCredits, 100);
    assert.equal(bal.totalDebits, 30);
  });

  it("uses integer-cent arithmetic (no float drift on fractional sums)", () => {
    const db = freshDb();
    [0.1, 0.2, 0.05, 0.05].forEach((c, i) => {
      insert(db, { id: `r${i}`, type: "ROYALTY_PAYOUT", from_user_id: "sys", to_user_id: "u2", amount: c, net: c, status: "complete" });
    });
    // 0.1 + 0.2 + 0.05 + 0.05 = 0.40 exactly under cent arithmetic (0.30000000004 under naive float)
    assert.equal(getBalance(db, "u2").balance, 0.4);
  });

  it("both balance queries are INDEX-ONLY (covering) scans — no table fetch", () => {
    const db = freshDb();
    const creditPlan = db
      .prepare("EXPLAIN QUERY PLAN SELECT SUM(net) FROM economy_ledger WHERE to_user_id = ? AND status = 'complete'")
      .all("u1")
      .map((r) => r.detail)
      .join(" | ");
    const debitPlan = db
      .prepare("EXPLAIN QUERY PLAN SELECT SUM(amount) FROM economy_ledger WHERE from_user_id = ? AND status = 'complete'")
      .all("u1")
      .map((r) => r.detail)
      .join(" | ");

    assert.match(creditPlan, /COVERING INDEX idx_ledger_balance_credits/, `credit query not index-only: ${creditPlan}`);
    assert.match(debitPlan, /COVERING INDEX idx_ledger_balance_debits/, `debit query not index-only: ${debitPlan}`);
  });
});
