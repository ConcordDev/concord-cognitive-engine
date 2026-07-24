/**
 * Pinning test for the reserves.js atomicity fix (Finding 4).
 *
 * Prior to the fix, `applyBalanceDelta` performed its UPDATE
 * (reserves_balance) and INSERT (reserves_ledger) as two unwrapped
 * sequential writes, and `allocateFromFee` called it twice in a row with
 * no outer transaction. A crash between any of those writes could leave
 * the platform's own reserve balance updated with no matching ledger
 * entry, or one reserve credited while its sibling from the same fee
 * split was not.
 *
 * These tests induce a failure partway through each write path (by
 * intercepting `db.prepare` for the reserves_ledger INSERT and making a
 * targeted invocation throw) and assert the balance mutation that ran
 * BEFORE the induced failure was rolled back — i.e. they assert
 * atomicity, not merely "doesn't throw".
 *
 * Run: node --test server/tests/economy/reserves-atomicity.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { initReservesSchema, allocateFromFee, payChargeback, getReserveBalance } from "../../economy/reserves.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createTestDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  initReservesSchema(db);
  return db;
}

/**
 * Monkey-patch db.prepare so the Nth statement whose SQL matches `matchSql`
 * throws when `.run(...)` is invoked, instead of executing. Earlier/later
 * matching statements (and all non-matching statements) behave normally.
 * This lets us simulate "the write crashed right here" at a precise point
 * in a multi-statement sequence without touching reserves.js itself.
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

const LEDGER_INSERT_RE = /INSERT INTO reserves_ledger/;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("reserves.js atomicity (Finding 4)", () => {
  it("applyBalanceDelta: rolls back the balance UPDATE when the ledger INSERT fails", () => {
    const db = createTestDb();

    // Pre-fund the chargeback reserve with $500 with no failure armed.
    allocateFromFee(db, { feeAmount: 2000, sourceTxId: "tx_fund" }); // 25% of 2000 = $500
    const before = getReserveBalance(db).chargebackReserve;
    assert.strictEqual(before, 500, "sanity: reserve pre-funded to $500");

    // payChargeback makes exactly one applyBalanceDelta call — fail its
    // ledger INSERT (the write that runs AFTER the balance UPDATE) and
    // confirm the UPDATE was rolled back, not silently kept.
    armRunFailureAtOccurrence(db, LEDGER_INSERT_RE, 1);

    const result = payChargeback(db, {
      chargebackAmount: 100,
      sourceTxId: "dispute_atomic_001",
    });

    assert.strictEqual(result.ok, false, "payChargeback surfaces the induced failure");
    assert.strictEqual(result.error, "reserve_debit_failed");

    const after = getReserveBalance(db).chargebackReserve;
    assert.strictEqual(
      after,
      before,
      "balance UPDATE must be rolled back when its paired ledger INSERT throws"
    );

    // No orphan ledger row for the failed attempt either.
    const row = db.prepare(
      "SELECT COUNT(*) AS c FROM reserves_ledger WHERE source_tx_id = 'dispute_atomic_001'"
    ).get();
    assert.strictEqual(row.c, 0, "no ledger row should exist for the rolled-back attempt");
  });

  it("allocateFromFee: rolls back the chargeback allocation when the operating allocation's write fails", () => {
    const db = createTestDb();
    const before = getReserveBalance(db);

    // allocateFromFee makes two applyBalanceDelta calls in sequence
    // (chargeback, then operating), each of which does its own
    // UPDATE+INSERT pair. Let the FIRST ledger INSERT (chargeback) succeed,
    // and fail the SECOND ledger INSERT (operating) — this is exactly the
    // "one reserve credited, its sibling from the same fee split is not"
    // scenario the finding describes.
    armRunFailureAtOccurrence(db, LEDGER_INSERT_RE, 2);

    const result = allocateFromFee(db, { feeAmount: 100, sourceTxId: "tx_atomic_split" });

    assert.strictEqual(result.ok, false, "allocateFromFee surfaces the induced failure");

    const after = getReserveBalance(db);
    assert.strictEqual(
      after.chargebackReserve,
      before.chargebackReserve,
      "chargeback allocation must be rolled back when its sibling operating allocation fails"
    );
    assert.strictEqual(
      after.operatingReserve,
      before.operatingReserve,
      "operating allocation must not be partially applied"
    );

    // Neither half of the fee split should have left a ledger trace.
    const row = db.prepare(
      "SELECT COUNT(*) AS c FROM reserves_ledger WHERE source_tx_id = 'tx_atomic_split'"
    ).get();
    assert.strictEqual(row.c, 0, "no partial ledger rows survive an aborted fee split");
  });

  it("control: allocateFromFee still succeeds end-to-end with no induced failure", () => {
    const db = createTestDb();
    const result = allocateFromFee(db, { feeAmount: 100, sourceTxId: "tx_control" });
    assert.strictEqual(result.ok, true);
    const balance = getReserveBalance(db);
    assert.strictEqual(balance.chargebackReserve, 25);
    assert.strictEqual(balance.operatingReserve, 75);
  });
});

// ── initReservesSchema atomicity (money-txn-hygiene finding) ───────────────
//
// `initReservesSchema` seeds three `reserves_balance` rows (chargeback,
// operating, treasury) via three sequential `INSERT OR IGNORE` calls. Prior
// to this fix they were unwrapped: a crash between the 1st and 3rd insert
// could leave the treasury row (or any later one) missing. Reads happen to
// degrade gracefully (`readBalance`/`getReserveBalance` treat a missing row
// as 0), but a subsequent `applyBalanceDelta` UPDATE against a
// never-created row silently affects 0 rows — a real write to the
// un-seeded reserve would be lost while its paired ledger INSERT still
// lands. These tests assert the seed is genuinely all-or-nothing.
describe("reserves.js initReservesSchema atomicity", () => {
  const SEED_INSERT_RE = /INSERT OR IGNORE INTO reserves_balance/;

  /**
   * `initReservesSchema` prepares `upsertBalance` ONCE and calls `.run(...)`
   * on it three times — unlike the other functions in this file, where a
   * fresh `db.prepare(sql)` happens per write. `armRunFailureAtOccurrence`
   * counts `.prepare()` CALLS, so it can't isolate "the Nth `.run()` on this
   * one prepared statement" here (there's only ever one matching `.prepare()`
   * call). This variant instead wraps `.run` itself and counts invocations.
   */
  function armRunFailureAtRunOccurrence(db, matchSql, occurrence) {
    const origPrepare = db.prepare.bind(db);
    let count = 0;
    db.prepare = (sql) => {
      const stmt = origPrepare(sql);
      if (!matchSql.test(sql)) return stmt;
      const origRun = stmt.run.bind(stmt);
      return {
        run: (...args) => {
          count += 1;
          if (count === occurrence) throw new Error(`simulated_failure_at_run_occurrence_${occurrence}`);
          return origRun(...args);
        },
        get: (...args) => stmt.get(...args),
        all: (...args) => stmt.all(...args),
      };
    };
  }

  it("rolls back earlier seed rows when a later seed INSERT fails", () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    // Fail the 3rd of the three sequential seed inserts (treasuryReserve).
    armRunFailureAtRunOccurrence(db, SEED_INSERT_RE, 3);

    assert.throws(() => initReservesSchema(db), /simulated_failure_at_run_occurrence_3/);

    // The tables themselves ARE created (schema DDL is separate from the
    // seed transaction, and CREATE TABLE isn't rolled back by throwing
    // inside a later db.transaction() call in the same function body).
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='reserves_balance'"
    ).get();
    assert.ok(tableExists, "reserves_balance table must still exist (DDL is unaffected)");

    // But NONE of the three seed rows should have landed — all-or-nothing,
    // not "the first two succeeded, the third didn't".
    const rows = db.prepare("SELECT reserve FROM reserves_balance").all();
    assert.strictEqual(rows.length, 0, "no partial seed rows should survive a failed initReservesSchema call");
  });

  it("control: initReservesSchema seeds all three reserves with no induced failure", () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    initReservesSchema(db);

    const rows = db.prepare("SELECT reserve, balance_cents FROM reserves_balance ORDER BY reserve").all();
    assert.strictEqual(rows.length, 3, "all three reserve rows must be seeded");
    const balance = getReserveBalance(db);
    assert.strictEqual(balance.chargebackReserve, 0);
    assert.strictEqual(balance.operatingReserve, 0);
    assert.strictEqual(balance.treasuryReserve, 0);
  });

  it("is idempotent: calling it twice does not duplicate or reset existing balances", () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    initReservesSchema(db);
    allocateFromFee(db, { feeAmount: 100, sourceTxId: "tx_before_reinit" });
    const before = getReserveBalance(db);

    initReservesSchema(db); // re-run, as happens on every server boot

    const after = getReserveBalance(db);
    assert.deepStrictEqual(after, before, "re-running initReservesSchema must not reset existing balances");
    const rows = db.prepare("SELECT COUNT(*) AS c FROM reserves_balance").get();
    assert.strictEqual(rows.c, 3, "re-running must not duplicate rows");
  });
});
