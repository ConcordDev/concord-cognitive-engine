/**
 * Pinning test for treasury-reconciliation.js's atomicity fix
 * (verification-audit campaign, money-txn-hygiene finding).
 *
 * `runTreasuryReconciliation` writes a reconciliation-log row, updates the
 * `treasury` drift-tracking columns, and (when drift is detected) inserts a
 * DRIFT_ALERT `treasury_events` row. Prior to the fix these were three
 * unguarded sequential writes — a crash between them could leave a
 * reconciliation-log row claiming `alert_triggered=1` with no matching
 * treasury_events row, or a stale `treasury.drift_alert` relative to what
 * the log actually recorded.
 *
 * Run: node --test server/tests/economy/treasury-reconciliation-atomicity.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runTreasuryReconciliation } from "../../economy/treasury-reconciliation.js";

function createTestDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE treasury (
      id              TEXT PRIMARY KEY,
      total_usd       REAL NOT NULL DEFAULT 0,
      total_coins     REAL NOT NULL DEFAULT 0,
      last_reconciled TEXT,
      drift_amount    REAL DEFAULT 0,
      drift_alert     INTEGER DEFAULT 0,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO treasury (id, total_usd, total_coins, updated_at)
    VALUES ('treasury_main', 800, 800, datetime('now'));

    CREATE TABLE treasury_events (
      id            TEXT PRIMARY KEY,
      event_type    TEXT NOT NULL,
      amount        REAL NOT NULL,
      usd_before    REAL NOT NULL,
      usd_after     REAL NOT NULL,
      coins_before  REAL NOT NULL,
      coins_after   REAL NOT NULL,
      ref_id        TEXT,
      metadata_json TEXT DEFAULT '{}',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE economy_ledger (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      from_user_id  TEXT,
      to_user_id    TEXT,
      amount        REAL NOT NULL,
      fee           REAL NOT NULL DEFAULT 0,
      net           REAL NOT NULL,
      status        TEXT NOT NULL DEFAULT 'complete',
      metadata_json TEXT DEFAULT '{}',
      request_id    TEXT,
      ip            TEXT,
      ref_id        TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE economy_withdrawals (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      amount        REAL NOT NULL,
      fee           REAL NOT NULL DEFAULT 0,
      net           REAL NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE treasury_reconciliation_log (
      id                TEXT PRIMARY KEY,
      ledger_total      REAL NOT NULL,
      stripe_total      REAL,
      drift             REAL NOT NULL DEFAULT 0,
      alert_triggered   INTEGER NOT NULL DEFAULT 0,
      details_json      TEXT DEFAULT '{}',
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE audit_log (
      id          TEXT PRIMARY KEY,
      timestamp   TEXT,
      category    TEXT,
      action      TEXT,
      user_id     TEXT,
      ip_address  TEXT,
      user_agent  TEXT,
      request_id  TEXT,
      path        TEXT,
      method      TEXT,
      status_code TEXT,
      details     TEXT
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

describe("treasury-reconciliation.js atomicity", () => {
  let consoleErr;
  const swallow = () => { consoleErr = console.error; console.error = () => {}; };
  const restore = () => { console.error = consoleErr; };

  it("rolls back the reconciliation-log INSERT and treasury UPDATE when the DRIFT_ALERT insert fails", () => {
    swallow();
    try {
      const db = createTestDb();
      // Force a large drift so anyAlert = true (stripeBalance far from treasury).
      armRunFailureAtOccurrence(db, /INSERT INTO treasury_events/, 1);

      const before = db.prepare("SELECT * FROM treasury WHERE id = 'treasury_main'").get();

      const result = runTreasuryReconciliation(db, { stripeBalance: 5000 });
      assert.equal(result.alert, true, "sanity: a large stripe/treasury mismatch must trigger anyAlert");

      const logCount = db.prepare("SELECT COUNT(*) AS c FROM treasury_reconciliation_log").get().c;
      assert.equal(logCount, 0, "the reconciliation-log INSERT must be rolled back when the DRIFT_ALERT insert fails");

      const after = db.prepare("SELECT * FROM treasury WHERE id = 'treasury_main'").get();
      assert.equal(after.drift_amount, before.drift_amount, "the treasury drift-tracking UPDATE must be rolled back too");
      assert.equal(after.updated_at, before.updated_at);

      const eventCount = db.prepare("SELECT COUNT(*) AS c FROM treasury_events").get().c;
      assert.equal(eventCount, 0);
    } finally { restore(); }
  });

  it("control: all three writes land together with no induced failure", () => {
    swallow();
    try {
      const db = createTestDb();
      const result = runTreasuryReconciliation(db, { stripeBalance: 5000 });
      assert.equal(result.alert, true);

      const logRow = db.prepare("SELECT * FROM treasury_reconciliation_log").get();
      assert.ok(logRow);
      assert.equal(logRow.alert_triggered, 1);

      const treasuryRow = db.prepare("SELECT * FROM treasury WHERE id = 'treasury_main'").get();
      assert.equal(treasuryRow.drift_alert, 1);

      const eventRow = db.prepare("SELECT * FROM treasury_events WHERE event_type = 'DRIFT_ALERT'").get();
      assert.ok(eventRow, "DRIFT_ALERT event must exist alongside the log row");
    } finally { restore(); }
  });

  it("no-alert reconciliation still writes exactly one log row (no transaction regression)", () => {
    swallow();
    try {
      const db = createTestDb();
      // Zero ledger entries means calculateLedgerTotals' expectedTreasury is
      // 0 — match treasury/stripe to 0 too so nothing drifts past threshold.
      db.prepare("UPDATE treasury SET total_usd = 0, total_coins = 0 WHERE id = 'treasury_main'").run();
      const result = runTreasuryReconciliation(db, { stripeBalance: 0 });
      assert.equal(result.alert, false);
      const logCount = db.prepare("SELECT COUNT(*) AS c FROM treasury_reconciliation_log").get().c;
      assert.equal(logCount, 1);
      const eventCount = db.prepare("SELECT COUNT(*) AS c FROM treasury_events").get().c;
      assert.equal(eventCount, 0, "no DRIFT_ALERT event when there's no alert");
    } finally { restore(); }
  });
});
