/**
 * Contract test for the creator-dashboard withdrawal-eligibility money rewrite
 * (schema-drift repair): economy_ledger is double-sided (credits land as `net`
 * to `to_user_id`, debits as `amount` from `from_user_id`) — it has no `user_id`
 * column. The prior queries used `WHERE user_id = ?` / signed `amount`, which
 * threw `no such column: user_id`. This pins the canonical model.
 *
 * Run: node --test server/tests/creator-dashboard-ledger.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { computeWithdrawalEligibility } from "../lib/creator-dashboard.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE economy_ledger (
      id TEXT PRIMARY KEY, type TEXT, from_user_id TEXT, to_user_id TEXT,
      amount REAL, fee REAL, net REAL, status TEXT, created_at TEXT
    );
  `);
  return db;
}

// A from-NULL credit row (mint/purchase/transfer-credit). Counts toward BALANCE.
const credit = (db, id, toUser, net, ageHours, type = "TOKEN_PURCHASE") =>
  db.prepare(`INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, net, status, created_at)
              VALUES (?, ?, NULL, ?, ?, ?, 'complete', datetime('now', ?))`)
    .run(id, type, toUser, net, net, `-${ageHours} hours`);
// An EARNED credit (marketplace sale seller credit OR royalty payout). Withdrawable.
const earn = (db, id, toUser, net, ageHours, type = "ROYALTY_PAYOUT") => {
  const from = type === "ROYALTY_PAYOUT" ? "__PLATFORM__" : null;
  db.prepare(`INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, net, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'complete', datetime('now', ?))`)
    .run(id, type, from, toUser, net, net, `-${ageHours} hours`);
};
const debit = (db, id, fromUser, amount) =>
  db.prepare(`INSERT INTO economy_ledger (id, type, from_user_id, amount, net, status, created_at)
              VALUES (?, 'WITHDRAWAL', ?, ?, ?, 'complete', datetime('now', '-1 hours'))`)
    .run(id, fromUser, amount, amount);

describe("creator-dashboard withdrawal eligibility (earned-only, double-sided ledger)", () => {
  let db;
  beforeEach(() => { db = setupDb(); });
  afterEach(() => db.close());

  it("balance = credits(to_user, net) − debits(from_user, amount)", () => {
    credit(db, "c1", "u1", 100, 72);  // 100 in (purchased), 3 days old
    debit(db, "d1", "u1", 30);        // 30 out
    credit(db, "c2", "u2", 999, 72);  // someone else's money — must not count
    const r = computeWithdrawalEligibility(db, "u1");
    assert.equal(r.ok, true);
    assert.equal(r.balance, 70);
  });

  it("a two-row TRANSFER debit does NOT double-credit the recipient's balance", () => {
    // Recipient sees a debit-half row (carries to_user_id) AND a real credit row.
    db.prepare(`INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, net, status, created_at)
                VALUES ('t-deb','TRANSFER','sender','u1',100,98.54,'complete',datetime('now','-72 hours'))`).run();
    db.prepare(`INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, net, status, created_at)
                VALUES ('t-cred','TRANSFER',NULL,'u1',98.54,98.54,'complete',datetime('now','-72 hours'))`).run();
    const r = computeWithdrawalEligibility(db, "u1");
    assert.equal(r.balance, 98.54); // NOT 197.08
  });

  it("only EARNED CC (royalties / marketplace sales) is withdrawable, after 48h", () => {
    earn(db, "roy-old", "u1", 100, 72);                          // earned, settled → eligible
    earn(db, "roy-new", "u1", 50, 1);                            // earned, fresh → held
    credit(db, "buy", "u1", 500, 72, "TOKEN_PURCHASE");         // purchased → NEVER withdrawable
    const r = computeWithdrawalEligibility(db, "u1");
    assert.equal(r.balance, 650);          // total holdings
    assert.equal(r.eligibleAmount, 100);   // only the settled earned royalty
    assert.equal(r.pendingHoldAmount, 550);// fresh earned 50 + purchased 500
  });

  it("purchased-only CC has zero withdrawable eligibility", () => {
    credit(db, "buy", "u1", 1000, 72, "TOKEN_PURCHASE");
    const r = computeWithdrawalEligibility(db, "u1");
    assert.equal(r.balance, 1000);
    assert.equal(r.eligibleAmount, 0);
  });

  it("a user with no ledger rows has zero everywhere (never throws)", () => {
    const r = computeWithdrawalEligibility(db, "ghost");
    assert.equal(r.ok, true);
    assert.equal(r.balance, 0);
    assert.equal(r.eligibleAmount, 0);
  });
});
