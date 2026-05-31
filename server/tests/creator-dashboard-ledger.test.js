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

const credit = (db, id, toUser, net, ageHours) =>
  db.prepare(`INSERT INTO economy_ledger (id, to_user_id, amount, net, status, created_at)
              VALUES (?, ?, ?, ?, 'complete', datetime('now', ?))`)
    .run(id, toUser, net, net, `-${ageHours} hours`);
const debit = (db, id, fromUser, amount) =>
  db.prepare(`INSERT INTO economy_ledger (id, from_user_id, amount, net, status, created_at)
              VALUES (?, ?, ?, ?, 'complete', datetime('now', '-1 hours'))`)
    .run(id, fromUser, amount, amount);

describe("creator-dashboard withdrawal eligibility (double-sided ledger)", () => {
  let db;
  beforeEach(() => { db = setupDb(); });
  afterEach(() => db.close());

  it("balance = credits(to_user, net) − debits(from_user, amount)", () => {
    credit(db, "c1", "u1", 100, 72);  // 100 in, 3 days old
    debit(db, "d1", "u1", 30);        // 30 out
    credit(db, "c2", "u2", 999, 72);  // someone else's money — must not count
    const r = computeWithdrawalEligibility(db, "u1");
    assert.equal(r.ok, true);
    assert.equal(r.balance, 70);
  });

  it("only credits older than the 48h hold are eligible; fresh credits are held", () => {
    credit(db, "old", "u1", 100, 72); // eligible (3 days old)
    credit(db, "new", "u1", 50, 1);   // held (1 hour old)
    const r = computeWithdrawalEligibility(db, "u1");
    assert.equal(r.balance, 150);
    assert.equal(r.eligibleAmount, 100);     // only the aged credit
    assert.equal(r.pendingHoldAmount, 50);   // the fresh one is held
  });

  it("debits reduce the eligible bucket (no double-spend of the hold)", () => {
    credit(db, "old", "u1", 100, 72);
    debit(db, "d1", "u1", 40);
    const r = computeWithdrawalEligibility(db, "u1");
    assert.equal(r.eligibleAmount, 60); // 100 eligible − 40 debited
  });

  it("a user with no ledger rows has zero everywhere (never throws)", () => {
    const r = computeWithdrawalEligibility(db, "ghost");
    assert.equal(r.ok, true);
    assert.equal(r.balance, 0);
    assert.equal(r.eligibleAmount, 0);
  });
});
