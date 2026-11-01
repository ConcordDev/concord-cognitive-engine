/**
 * Tests for the chargeback reserve policy — canonical pool (Gate 5 R1+R2).
 *
 * Since the convergence, there is ONE reserve accounting: the 80/10/10 fee
 * split (economy/fee-split.js) funds the __TREASURY__ ledger account, and
 * economy/treasury.js pays chargebacks out of that pool. The retired
 * reserves.js system (its own tables, 25%/75% allocation) is gone; the
 * funding assertions below pin the canonical split instead.
 *
 * Covers:
 *   - distributeFee: funds the pool at 80% (treasury) / 10% / 10%
 *   - payChargeback: succeeds when the pool is sufficient
 *   - payChargeback: returns error when the pool is insufficient
 *   - handleChargeback: covers chargeback from the pool
 *   - handleChargeback: flags for manual review when insufficient
 *   - getReserveHealth: reports the pool balance
 *
 * Run: node --test server/tests/economy/chargeback-policy.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { distributeFee, getFeeSplitBalances } from "../../economy/fee-split.js";
import { getTreasuryBalance, payChargeback, getReserveHealth } from "../../economy/treasury.js";
import { handleChargeback, flagChargebackForManualReview } from "../../economy/chargeback-handler.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a fresh in-memory SQLite database with all required tables.
 */
function createTestDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");

  // audit_log table (required by economyAudit inside chargeback-handler)
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id          TEXT PRIMARY KEY,
      timestamp   TEXT NOT NULL,
      category    TEXT,
      action      TEXT NOT NULL,
      user_id     TEXT,
      ip_address  TEXT,
      user_agent  TEXT,
      request_id  TEXT,
      path        TEXT,
      method      TEXT,
      status_code INTEGER,
      details     TEXT
    );
  `);

  // purchases table (required by handleChargeback)
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchases (
      id                        TEXT PRIMARY KEY,
      purchase_id               TEXT,
      buyer_id                  TEXT,
      seller_id                 TEXT,
      listing_id                TEXT,
      listing_type              TEXT,
      license_type              TEXT,
      amount                    REAL,
      source                    TEXT,
      status                    TEXT NOT NULL DEFAULT 'CREATED',
      ref_id                    TEXT,
      stripe_session_id         TEXT,
      stripe_payment_intent_id  TEXT,
      metadata_json             TEXT,
      created_at                TEXT NOT NULL,
      updated_at                TEXT NOT NULL
    );
  `);

  // economy_ledger + fee_distributions (required by distributeFee and the
  // ledger-derived treasury reads)
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

/** Fund the canonical pool with exactly `coins` via the 80/10/10 split. */
function fundPool(db, coins, sourceTxId = "tx_fund") {
  const result = distributeFee(db, {
    feeAmount: coins / 0.8,
    sourceTxId,
    requestId: "req_fund",
    ip: "127.0.0.1",
  });
  assert.ok(result.ok, "distributeFee should succeed while funding the pool");
  assert.strictEqual(getTreasuryBalance(db), coins);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("canonical fee split funds the pool", () => {
  let db;
  beforeEach(() => { db = createTestDb(); });

  it("routes exactly 80% to treasury and 10%/10% to operating/payroll", () => {
    const result = distributeFee(db, {
      feeAmount:  100,   // $100 in Concord Coins
      sourceTxId: "tx_test_001",
      requestId:  "req_001",
      ip:         "127.0.0.1",
    });

    assert.ok(result.ok, "distributeFee should return ok");
    assert.strictEqual(result.distribution.treasury,  80, "80% to treasury");
    assert.strictEqual(result.distribution.operating, 10, "10% to operating");
    assert.strictEqual(result.distribution.payroll,   10, "10% to payroll");

    const balances = getFeeSplitBalances(db);
    assert.strictEqual(balances.treasury,  80, "treasury balance = 80");
    assert.strictEqual(balances.operating, 10, "operating balance = 10");
    assert.strictEqual(balances.payroll,   10, "payroll balance = 10");
    assert.strictEqual(getTreasuryBalance(db), 80, "pool reads 80");
  });

  it("rejects a zero fee and accumulates correctly across distributions", () => {
    const zero = distributeFee(db, { feeAmount: 0, sourceTxId: "tx_zero" });
    assert.strictEqual(zero.ok, false);
    assert.strictEqual(zero.error, "invalid_fee_amount");

    distributeFee(db, { feeAmount: 50, sourceTxId: "tx_a" });
    distributeFee(db, { feeAmount: 50, sourceTxId: "tx_b" });
    assert.strictEqual(getTreasuryBalance(db), 80, "80% of 100 total fees");
  });
});

describe("payChargeback", () => {
  let db;
  beforeEach(() => {
    db = createTestDb();
    // Pre-fund the pool with $500
    fundPool(db, 500);
  });

  it("succeeds and debits the pool when funds are sufficient", () => {
    const balanceBefore = getTreasuryBalance(db);

    const result = payChargeback(db, {
      chargebackAmount: 100,
      sourceTxId:       "dispute_001",
      requestId:        "req_cb_001",
      ip:               "10.0.0.1",
    });

    assert.ok(result.ok, "payChargeback should succeed");
    assert.strictEqual(result.error, undefined, "no error on success");

    const balanceAfter = getTreasuryBalance(db);
    assert.strictEqual(balanceAfter, balanceBefore - 100, "balance reduced by chargeback amount");

    // The payout is a ledger transfer from the pool to the platform
    const row = db.prepare(
      "SELECT * FROM economy_ledger WHERE type = 'CHARGEBACK' AND ref_id = 'chargeback:dispute_001'"
    ).get();
    assert.ok(row, "a CHARGEBACK ledger entry exists");
    assert.strictEqual(row.from_user_id, "__TREASURY__");
    assert.strictEqual(row.to_user_id, "__PLATFORM__");
    assert.strictEqual(row.amount, 100);
  });

  it("returns ok:false with error when the pool is insufficient", () => {
    const result = payChargeback(db, {
      chargebackAmount: 99999,  // far more than the $500 pool
      sourceTxId:       "dispute_big",
    });

    assert.strictEqual(result.ok,    false,                  "should fail");
    assert.strictEqual(result.error, "insufficient_reserve", "error code is insufficient_reserve");

    // Balance must be unchanged
    assert.strictEqual(getTreasuryBalance(db), 500, "balance unchanged on failure");
  });

  it("treats a zero chargeback as a no-op success", () => {
    const result = payChargeback(db, { chargebackAmount: 0, sourceTxId: "dispute_zero" });
    assert.ok(result.ok);
    assert.strictEqual(getTreasuryBalance(db), 500);
  });
});

describe("getReserveHealth", () => {
  it("reports the pool balance against the seed target", () => {
    const db = createTestDb();
    fundPool(db, 500);
    payChargeback(db, { chargebackAmount: 50, sourceTxId: "dispute_h" });

    const health = getReserveHealth(db);
    assert.strictEqual(health.chargebackReserve, 450);
    assert.strictEqual(health.target6Months, 10000); // seed — spend history below it
    assert.strictEqual(health.status, "healthy");
  });
});

describe("handleChargeback", () => {
  let db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("returns no_purchase_found when payment_intent_id does not match any purchase", async () => {
    const result = await handleChargeback(db, {
      chargebackAmountCents: 5000,
      stripeDisputeId:       "dp_not_found",
      paymentIntentId:       "pi_unknown",
      requestId:             "req_001",
      ip:                    "1.2.3.4",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.action, "no_purchase_found");
  });

  it("covers chargeback from the pool and marks purchase as charged_back", async () => {
    // Pre-fund the pool ($1,000)
    fundPool(db, 1000);

    // Insert a purchase with a known payment_intent_id
    const now = new Date().toISOString().replace("T", " ").replace("Z", "");
    db.prepare(`
      INSERT INTO purchases
        (id, purchase_id, buyer_id, seller_id, amount, source, status,
         stripe_payment_intent_id, created_at, updated_at)
      VALUES ('pur_01', 'pur_01', 'user_buyer', 'user_seller', 50, 'marketplace', 'FULFILLED',
              'pi_stripe_test_001', ?, ?)
    `).run(now, now);

    const result = await handleChargeback(db, {
      chargebackAmountCents: 5000,          // $50 in cents
      stripeDisputeId:       "dp_cover_01",
      paymentIntentId:       "pi_stripe_test_001",
      requestId:             "req_cover",
      ip:                    "5.6.7.8",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.action, "covered_by_reserve");

    // Purchase status updated
    const purchase = db.prepare("SELECT status FROM purchases WHERE id = 'pur_01'").get();
    assert.strictEqual(purchase.status, "charged_back");

    // Pool reduced by $50
    assert.strictEqual(getTreasuryBalance(db), 950, "pool reduced by $50");
  });

  it("flags for manual review when the pool is insufficient", async () => {
    // Do NOT pre-fund the pool — it remains at $0

    const now = new Date().toISOString().replace("T", " ").replace("Z", "");
    db.prepare(`
      INSERT INTO purchases
        (id, purchase_id, buyer_id, seller_id, amount, source, status,
         stripe_payment_intent_id, created_at, updated_at)
      VALUES ('pur_02', 'pur_02', 'user_b', 'user_s', 200, 'marketplace', 'FULFILLED',
              'pi_stripe_test_002', ?, ?)
    `).run(now, now);

    const result = await handleChargeback(db, {
      chargebackAmountCents: 20000,         // $200 in cents — exceeds $0 pool
      stripeDisputeId:       "dp_manual_01",
      paymentIntentId:       "pi_stripe_test_002",
      requestId:             "req_manual",
      ip:                    "9.9.9.9",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.action, "flagged_for_manual_review");

    // An audit entry should have been written
    const auditRow = db.prepare(
      "SELECT action FROM audit_log WHERE action = 'chargeback_manual_review_required' LIMIT 1"
    ).get();
    assert.ok(auditRow, "audit entry should exist");
  });

  it("looks up purchase by metadata_json LIKE when stripe_payment_intent_id column is absent", async () => {
    // Create a DB without the stripe_payment_intent_id column
    const dbNoCol = new Database(":memory:");
    dbNoCol.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, category TEXT,
        action TEXT NOT NULL, user_id TEXT, ip_address TEXT, user_agent TEXT,
        request_id TEXT, path TEXT, method TEXT, status_code INTEGER, details TEXT
      );
      CREATE TABLE IF NOT EXISTS purchases (
        id TEXT PRIMARY KEY, purchase_id TEXT, buyer_id TEXT, seller_id TEXT,
        amount REAL, source TEXT, status TEXT NOT NULL DEFAULT 'CREATED',
        ref_id TEXT, stripe_session_id TEXT, metadata_json TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS economy_ledger (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, from_user_id TEXT, to_user_id TEXT,
        amount REAL NOT NULL CHECK(amount > 0), fee REAL NOT NULL DEFAULT 0 CHECK(fee >= 0),
        net REAL NOT NULL CHECK(net > 0), status TEXT NOT NULL DEFAULT 'complete',
        metadata_json TEXT DEFAULT '{}', request_id TEXT, ip TEXT, ref_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK(from_user_id IS NOT NULL OR to_user_id IS NOT NULL)
      );
      CREATE TABLE IF NOT EXISTS fee_distributions (
        id TEXT PRIMARY KEY, source_tx_id TEXT NOT NULL, total_fee REAL NOT NULL,
        reserves_amount REAL NOT NULL, operating_amount REAL NOT NULL,
        payroll_amount REAL NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // Pre-fund
    fundPool(dbNoCol, 1000);

    const now = new Date().toISOString().replace("T", " ").replace("Z", "");
    dbNoCol.prepare(`
      INSERT INTO purchases (id, purchase_id, buyer_id, seller_id, amount, source, status,
        metadata_json, created_at, updated_at)
      VALUES ('pur_nc_01', 'pur_nc_01', 'user_b', 'user_s', 30, 'marketplace', 'FULFILLED',
              '{"stripePaymentIntentId":"pi_meta_test_001"}', ?, ?)
    `).run(now, now);

    const result = await handleChargeback(dbNoCol, {
      chargebackAmountCents: 3000,
      stripeDisputeId:       "dp_meta_01",
      paymentIntentId:       "pi_meta_test_001",
      requestId:             "req_meta",
      ip:                    "2.2.2.2",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.action, "covered_by_reserve");
  });
});
