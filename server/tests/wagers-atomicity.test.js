/**
 * Pinning test for wagers.js's atomicity fixes (verification-audit
 * campaign, money-txn-hygiene finding).
 *
 * Each of propose/accept/resolve/_cancelAndRefund does a balance mutation
 * + a wagers-table status write that previously ran as two unguarded
 * sequential statements. A crash between them could leave a proposer/
 * opponent debited with no wager row to ever resolve/refund against, or
 * (resolve) let a crash-then-retry double-pay a winner.
 *
 * Run: node --test server/tests/wagers-atomicity.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  _executeProposal,
  _executeAcceptance,
  _executeResolution,
  _cancelAndRefund,
} from "../routes/wagers.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      sparks INTEGER NOT NULL DEFAULT 0,
      concordia_credits REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE wagers (
      id TEXT PRIMARY KEY,
      proposer_id TEXT,
      opponent_id TEXT,
      amount REAL,
      currency TEXT,
      duel_type TEXT,
      status TEXT,
      escrow_locked INTEGER,
      world_id TEXT,
      proposed_at INTEGER,
      accepted_at INTEGER,
      resolved_at INTEGER,
      winner_id TEXT,
      expires_at INTEGER
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
function seedWager(db, w) {
  db.prepare(`
    INSERT INTO wagers (id, proposer_id, opponent_id, amount, currency, status, escrow_locked, proposed_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, unixepoch())
  `).run(w.id, w.proposerId, w.opponentId, w.amount, w.currency ?? "sparks", w.status ?? "pending");
}
function wagerStatus(db, id) {
  return db.prepare(`SELECT status FROM wagers WHERE id = ?`).get(id)?.status;
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

describe("wagers.js _executeProposal atomicity", () => {
  it("rolls back the escrow debit when the wager INSERT fails", () => {
    const db = freshDb();
    fund(db, "proposer1", 1000);
    armRunFailureAtOccurrence(db, /INSERT INTO wagers/, 1);

    assert.throws(() => _executeProposal(db, {
      id: "wg1", proposerId: "proposer1", opponentId: "opp1", amount: 100,
      currency: "sparks", balanceCol: "sparks", duelType: "combat", worldId: null,
      now: 1000, expiresAt: 1060,
    }));

    assert.equal(sparksOf(db, "proposer1"), 1000, "escrow debit must be rolled back");
    const count = db.prepare("SELECT COUNT(*) AS c FROM wagers").get().c;
    assert.equal(count, 0);
  });

  it("control: succeeds end-to-end", () => {
    const db = freshDb();
    fund(db, "proposer2", 1000);
    _executeProposal(db, {
      id: "wg2", proposerId: "proposer2", opponentId: "opp2", amount: 100,
      currency: "sparks", balanceCol: "sparks", duelType: "combat", worldId: null,
      now: 1000, expiresAt: 1060,
    });
    assert.equal(sparksOf(db, "proposer2"), 900);
    assert.equal(wagerStatus(db, "wg2"), "pending");
  });
});

describe("wagers.js _executeAcceptance atomicity", () => {
  it("rolls back the opponent escrow debit when the status UPDATE fails", () => {
    const db = freshDb();
    fund(db, "opp3", 1000);
    seedWager(db, { id: "wg3", proposerId: "proposer3", opponentId: "opp3", amount: 100 });
    armRunFailureAtOccurrence(db, /UPDATE wagers SET status = 'active'/, 1);

    assert.throws(() => _executeAcceptance(db, { wagerId: "wg3", userId: "opp3", balanceCol: "sparks", amount: 100, now: 2000 }));

    assert.equal(sparksOf(db, "opp3"), 1000, "opponent debit must be rolled back");
    assert.equal(wagerStatus(db, "wg3"), "pending", "wager must stay pending, not stuck half-active");
  });

  it("control: succeeds end-to-end", () => {
    const db = freshDb();
    fund(db, "opp4", 1000);
    seedWager(db, { id: "wg4", proposerId: "proposer4", opponentId: "opp4", amount: 100 });
    _executeAcceptance(db, { wagerId: "wg4", userId: "opp4", balanceCol: "sparks", amount: 100, now: 2000 });
    assert.equal(sparksOf(db, "opp4"), 900);
    assert.equal(wagerStatus(db, "wg4"), "active");
  });
});

describe("wagers.js _executeResolution atomicity", () => {
  it("rolls back the winner payout when the status UPDATE fails (prevents crash-then-retry double-pay)", () => {
    const db = freshDb();
    fund(db, "winner1", 0);
    seedWager(db, { id: "wg5", proposerId: "winner1", opponentId: "opp5", amount: 100, status: "active" });
    armRunFailureAtOccurrence(db, /UPDATE wagers SET status = 'resolved'/, 1);

    assert.throws(() => _executeResolution(db, { wagerId: "wg5", winnerId: "winner1", balanceCol: "sparks", payout: 196, now: 3000 }));

    assert.equal(sparksOf(db, "winner1"), 0, "payout must be rolled back so a retry can't double-pay");
    assert.equal(wagerStatus(db, "wg5"), "active", "wager must stay active for a real retry, not silently resolved");
  });

  it("control: succeeds end-to-end", () => {
    const db = freshDb();
    fund(db, "winner2", 0);
    seedWager(db, { id: "wg6", proposerId: "winner2", opponentId: "opp6", amount: 100, status: "active" });
    _executeResolution(db, { wagerId: "wg6", winnerId: "winner2", balanceCol: "sparks", payout: 196, now: 3000 });
    assert.equal(sparksOf(db, "winner2"), 196);
    assert.equal(wagerStatus(db, "wg6"), "resolved");
  });
});

describe("wagers.js _cancelAndRefund atomicity", () => {
  it("rolls back the refund when the status UPDATE fails", () => {
    const db = freshDb();
    fund(db, "proposer7", 900);
    seedWager(db, { id: "wg7", proposerId: "proposer7", opponentId: "opp7", amount: 100 });
    armRunFailureAtOccurrence(db, /UPDATE wagers SET status = 'cancelled'/, 1);

    assert.throws(() => _cancelAndRefund(db, { id: "wg7", proposer_id: "proposer7", amount: 100, currency: "sparks" }));

    assert.equal(sparksOf(db, "proposer7"), 900, "refund must be rolled back, not double-applied on retry");
    assert.equal(wagerStatus(db, "wg7"), "pending");
  });

  it("control: succeeds end-to-end", () => {
    const db = freshDb();
    fund(db, "proposer8", 900);
    seedWager(db, { id: "wg8", proposerId: "proposer8", opponentId: "opp8", amount: 100 });
    _cancelAndRefund(db, { id: "wg8", proposer_id: "proposer8", amount: 100, currency: "sparks" });
    assert.equal(sparksOf(db, "proposer8"), 1000);
    assert.equal(wagerStatus(db, "wg8"), "cancelled");
  });
});
