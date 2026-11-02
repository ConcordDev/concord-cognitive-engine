/**
 * Pinning test for the canonical pool's atomicity (Gate 5 R1+R2).
 *
 * Successor to reserves-atomicity.test.js (Finding 4), which pinned the
 * retired reserves.js module: its balance UPDATE + ledger INSERT pairs
 * had to land atomically, or the reserve balance and its ledger would
 * disagree. The converged design makes that class of split structurally
 * impossible — the pool balance is DERIVED from the append-only
 * economy_ledger, so there is no second balance store to drift — and
 * these tests pin the remaining atomicity obligations:
 *
 *   1. distributeFee writes its ledger batch and its fee_distributions
 *      row in ONE transaction: a failure at the last write rolls the
 *      whole distribution back (no partial fee split in the ledger).
 *   2. payChargeback's single payout entry either lands whole or not at
 *      all: an induced INSERT failure leaves the pool balance untouched
 *      and surfaces as reserve_debit_failed, never a silent half-pay.
 *   3. The pool's reads are pure: getTreasuryBalance / getReserveHealth
 *      on an empty ledger write nothing.
 *
 * Failures are induced by intercepting db.prepare for a targeted SQL
 * shape and making its .run throw, exactly as the Finding 4 suite did.
 *
 * Run: node --test server/tests/economy/treasury-atomicity.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { distributeFee } from "../../economy/fee-split.js";
import { getTreasuryBalance, payChargeback, getReserveHealth } from "../../economy/treasury.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createTestDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS economy_ledger (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      from_user_id  TEXT,
      to_user_id    TEXT,
      amount        REAL NOT NULL CHECK(amount > 0),
      fee           REAL NOT NULL DEFAULT 0 CHECK(fee >= 0),
      net           REAL NOT NULL CHECK(net > 0),
      status        TEXT NOT NULL DEFAULT 'complete',
      metadata_json TEXT DEFAULT '{}',
      request_id    TEXT,
      ip            TEXT,
      ref_id        TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK(from_user_id IS NOT NULL OR to_user_id IS NOT NULL)
    );
    CREATE TABLE IF NOT EXISTS fee_distributions (
      id TEXT PRIMARY KEY, source_tx_id TEXT NOT NULL, total_fee REAL NOT NULL,
      reserves_amount REAL NOT NULL, operating_amount REAL NOT NULL,
      payroll_amount REAL NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

/**
 * Monkey-patch db.prepare so the Nth statement whose SQL matches `matchSql`
 * throws when `.run(...)` is invoked, instead of executing. Earlier/later
 * matching statements (and all non-matching statements) behave normally.
 */
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
const DISTRIBUTIONS_INSERT_RE = /INSERT INTO fee_distributions/;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("canonical pool atomicity", () => {
  it("distributeFee: a failure at the fee_distributions write rolls back the whole split", () => {
    const db = createTestDb();
    armRunFailureAtOccurrence(db, DISTRIBUTIONS_INSERT_RE, 1);

    const result = distributeFee(db, {
      feeAmount: 100,
      sourceTxId: "tx_atomic_1",
      requestId: "req_atomic_1",
      ip: "127.0.0.1",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "fee_distribution_failed");

    const rows = db.prepare("SELECT COUNT(*) AS c FROM economy_ledger").get().c;
    assert.strictEqual(rows, 0, "no partial fee-split entries survive the rollback");
    assert.strictEqual(getTreasuryBalance(db), 0, "pool balance is still zero");
  });

  it("payChargeback: an induced INSERT failure moves nothing and reports reserve_debit_failed", () => {
    const db = createTestDb();
    const funded = distributeFee(db, { feeAmount: 625, sourceTxId: "tx_fund" });
    assert.ok(funded.ok);
    assert.strictEqual(getTreasuryBalance(db), 500);

    armRunFailureAtOccurrence(db, LEDGER_INSERT_RE, 1);
    const result = payChargeback(db, {
      chargebackAmount: 100,
      sourceTxId: "dispute_atomic",
      requestId: "req_atomic",
      ip: "10.0.0.1",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "reserve_debit_failed");
    assert.strictEqual(getTreasuryBalance(db), 500, "pool balance unchanged after the failed payout");
    const payouts = db.prepare(
      "SELECT COUNT(*) AS c FROM economy_ledger WHERE type = 'CHARGEBACK'"
    ).get().c;
    assert.strictEqual(payouts, 0, "no payout entry was recorded");
  });

  it("pool reads are pure: balance and health on an empty ledger write nothing", () => {
    const db = createTestDb();
    assert.strictEqual(getTreasuryBalance(db), 0);
    const health = getReserveHealth(db);
    assert.strictEqual(health.chargebackReserve, 0);
    assert.strictEqual(health.status, "healthy"); // no burn rate → unbounded coverage
    const rows = db.prepare("SELECT COUNT(*) AS c FROM economy_ledger").get().c;
    assert.strictEqual(rows, 0, "reads must not write");
  });
});
