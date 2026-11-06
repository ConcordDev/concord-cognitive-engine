/**
 * Tests for the chargeback initiator levy — Gate 5 Act 3 (R3).
 *
 * Founder policy of record: the INITIATOR pays first — a levy of 25% of
 * the ORIGINAL transaction, collected from the buyer and bounded by
 * their live balance — and the __TREASURY__ pool is only the BACKSTOP
 * for the uncollected remainder (never both for the same dollars).
 * Issuer-fault disputes (reason in ISSUER_FAULT_DISPUTE_REASONS) are
 * carved out: no levy, no pool draw, manual review.
 *
 * Run: node --test server/tests/economy/chargeback-levy.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { distributeFee } from "../../economy/fee-split.js";
import { getTreasuryBalance } from "../../economy/treasury.js";
import { getBalance } from "../../economy/balances.js";
import {
  handleChargeback,
  CHARGEBACK_LEVY_RATE,
  ISSUER_FAULT_DISPUTE_REASONS,
} from "../../economy/chargeback-handler.js";

function createTestDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, category TEXT,
      action TEXT NOT NULL, user_id TEXT, ip_address TEXT, user_agent TEXT,
      request_id TEXT, path TEXT, method TEXT, status_code INTEGER, details TEXT
    );
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY, purchase_id TEXT, buyer_id TEXT, seller_id TEXT,
      listing_id TEXT, listing_type TEXT, license_type TEXT,
      amount REAL, source TEXT, status TEXT NOT NULL DEFAULT 'CREATED',
      ref_id TEXT, stripe_session_id TEXT, stripe_payment_intent_id TEXT,
      metadata_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
  return db;
}

function fundPool(db, coins, sourceTxId = "tx_fund") {
  const result = distributeFee(db, {
    feeAmount: coins / 0.8, sourceTxId, requestId: "req_fund", ip: "127.0.0.1",
  });
  assert.ok(result.ok, "distributeFee funds the pool");
  assert.strictEqual(getTreasuryBalance(db), coins);
}

function fundUser(db, userId, coins) {
  db.prepare(`
    INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status, ref_id)
    VALUES (?, 'DEPOSIT', NULL, ?, ?, 0, ?, 'complete', ?)
  `).run(`seed_${userId}`, userId, coins, coins, `seed:${userId}`);
  assert.strictEqual(getBalance(db, userId).balance, coins);
}

function addPurchase(db, { id = "pur_1", buyer = "buyer_1", amount = 200, pi = "pi_1" } = {}) {
  const now = new Date().toISOString().replace("T", " ").replace("Z", "");
  db.prepare(`
    INSERT INTO purchases
      (id, purchase_id, buyer_id, seller_id, amount, source, status,
       stripe_payment_intent_id, created_at, updated_at)
    VALUES (?, ?, ?, 'seller_1', ?, 'marketplace', 'FULFILLED', ?, ?, ?)
  `).run(id, id, buyer, amount, pi, now, now);
}

function levyRows(db, disputeId) {
  return db.prepare(
    "SELECT * FROM economy_ledger WHERE type = 'CHARGEBACK_LEVY' AND ref_id = ?"
  ).all(`chargeback-levy:${disputeId}`);
}

describe("Gate 5 Act 3 — initiator levy", () => {
  let db;
  beforeEach(() => { db = createTestDb(); });

  it("levy rate is the founder's 25% and the carve-out set is the named constant", () => {
    assert.strictEqual(CHARGEBACK_LEVY_RATE, 0.25);
    // Lane 7's answered set (Gate 5 build confirmation, 2026-11-02)
    for (const r of ["duplicate", "processing_error", "product_not_received",
                     "product_unacceptable", "credit_not_processed"]) {
      assert.ok(ISSUER_FAULT_DISPUTE_REASONS.has(r), `carve-out includes ${r}`);
    }
    assert.strictEqual(ISSUER_FAULT_DISPUTE_REASONS.size, 5);
    assert.ok(!ISSUER_FAULT_DISPUTE_REASONS.has("fraudulent"));
    assert.ok(!ISSUER_FAULT_DISPUTE_REASONS.has("subscription_canceled"));
  });

  it("levy first: buyer pays 25% of the original transaction, pool backstops the rest", async () => {
    fundPool(db, 1000);
    fundUser(db, "buyer_1", 100);
    addPurchase(db, { amount: 200 }); // levy due = 50

    const result = await handleChargeback(db, {
      chargebackAmountCents: 20000, stripeDisputeId: "dp_levy_1", paymentIntentId: "pi_1",
    });

    assert.strictEqual(result.action, "covered_by_reserve");
    assert.strictEqual(result.levyCollected, 50);
    assert.strictEqual(result.reservePaid, 150);
    // Buyer debited the levy only
    assert.strictEqual(getBalance(db, "buyer_1").balance, 50);
    // Pool: +50 levy credit, −150 payout = 900
    assert.strictEqual(getTreasuryBalance(db), 900);
    // The levy is one system-minted entry buyer → __TREASURY__
    const rows = levyRows(db, "dp_levy_1");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].from_user_id, "buyer_1");
    assert.strictEqual(rows[0].to_user_id, "__TREASURY__");
    assert.strictEqual(rows[0].amount, 50);
    // Purchase marked
    assert.strictEqual(db.prepare("SELECT status FROM purchases WHERE id='pur_1'").get().status, "charged_back");
  });

  it("unfunded buyer: levy collects 0 and the pool pays in full (pre-Act-3 behaviour)", async () => {
    fundPool(db, 1000);
    addPurchase(db, { amount: 200 });

    const result = await handleChargeback(db, {
      chargebackAmountCents: 20000, stripeDisputeId: "dp_levy_2", paymentIntentId: "pi_1",
    });

    assert.strictEqual(result.action, "covered_by_reserve");
    assert.strictEqual(result.levyCollected, 0);
    assert.strictEqual(result.reservePaid, 200);
    assert.strictEqual(getTreasuryBalance(db), 800);
    assert.strictEqual(levyRows(db, "dp_levy_2").length, 0);
  });

  it("partial balance: collection is bounded by the live balance, pool covers the shortfall", async () => {
    fundPool(db, 1000);
    fundUser(db, "buyer_1", 20); // levy due 50, only 20 collectible
    addPurchase(db, { amount: 200 });

    const result = await handleChargeback(db, {
      chargebackAmountCents: 20000, stripeDisputeId: "dp_levy_3", paymentIntentId: "pi_1",
    });

    assert.strictEqual(result.levyCollected, 20);
    assert.strictEqual(result.reservePaid, 180);
    assert.strictEqual(getBalance(db, "buyer_1").balance, 0);
  });

  it("levy can cover a small dispute entirely — pool is never touched for those dollars", async () => {
    fundPool(db, 1000);
    fundUser(db, "buyer_1", 100);
    addPurchase(db, { amount: 200 }); // levy due 50 > dispute 40

    const result = await handleChargeback(db, {
      chargebackAmountCents: 4000, stripeDisputeId: "dp_levy_4", paymentIntentId: "pi_1",
    });

    assert.strictEqual(result.action, "covered_by_levy");
    assert.strictEqual(result.levyCollected, 40); // bounded by the dispute itself
    assert.strictEqual(result.reservePaid, 0);
    // Pool only GAINED the levy credit; no CHARGEBACK payout row exists
    assert.strictEqual(getTreasuryBalance(db), 1040);
    assert.strictEqual(
      db.prepare("SELECT COUNT(*) c FROM economy_ledger WHERE type='CHARGEBACK'").get().c, 0);
  });

  it("issuer-fault carve-out: no levy, no pool draw, manual review", async () => {
    fundPool(db, 1000);
    fundUser(db, "buyer_1", 100);
    addPurchase(db, { amount: 200 });

    const result = await handleChargeback(db, {
      chargebackAmountCents: 20000, stripeDisputeId: "dp_levy_5", paymentIntentId: "pi_1",
      disputeReason: "processing_error",
    });

    assert.strictEqual(result.action, "flagged_for_manual_review");
    assert.strictEqual(result.levyCollected, 0);
    assert.strictEqual(result.reservePaid, 0);
    assert.strictEqual(getBalance(db, "buyer_1").balance, 100, "buyer untouched");
    assert.strictEqual(getTreasuryBalance(db), 1000, "pool untouched");
    assert.strictEqual(levyRows(db, "dp_levy_5").length, 0);
    const audit = db.prepare(
      "SELECT details FROM audit_log WHERE action='chargeback_manual_review_required'").get();
    assert.ok(JSON.parse(audit.details).reason === "issuer_fault_carve_out");
    assert.strictEqual(db.prepare("SELECT status FROM purchases WHERE id='pur_1'").get().status, "FULFILLED");
  });

  it("a non-carve-out reason (fraudulent) follows the normal levy path", async () => {
    fundPool(db, 1000);
    fundUser(db, "buyer_1", 100);
    addPurchase(db, { amount: 200 });

    const result = await handleChargeback(db, {
      chargebackAmountCents: 20000, stripeDisputeId: "dp_levy_6", paymentIntentId: "pi_1",
      disputeReason: "fraudulent",
    });

    assert.strictEqual(result.action, "covered_by_reserve");
    assert.strictEqual(result.levyCollected, 50);
    assert.strictEqual(result.reservePaid, 150);
  });

  it("webhook redelivery cannot collect the levy twice", async () => {
    fundPool(db, 1000);
    fundUser(db, "buyer_1", 100);
    addPurchase(db, { amount: 200 });

    const first = await handleChargeback(db, {
      chargebackAmountCents: 20000, stripeDisputeId: "dp_levy_7", paymentIntentId: "pi_1",
    });
    const second = await handleChargeback(db, {
      chargebackAmountCents: 20000, stripeDisputeId: "dp_levy_7", paymentIntentId: "pi_1",
    });

    assert.strictEqual(first.levyCollected, 50);
    assert.strictEqual(second.levyCollected, 50, "second call reads back the collected levy");
    assert.strictEqual(levyRows(db, "dp_levy_7").length, 1, "exactly one levy entry");
  });

  it("pool short for the remainder: manual review, and the collected levy stands", async () => {
    fundPool(db, 100);
    fundUser(db, "buyer_1", 20);
    addPurchase(db, { amount: 200 }); // levy 20 collected → pool 120; remainder 180 > 120

    const result = await handleChargeback(db, {
      chargebackAmountCents: 20000, stripeDisputeId: "dp_levy_8", paymentIntentId: "pi_1",
    });

    assert.strictEqual(result.action, "flagged_for_manual_review");
    assert.strictEqual(result.levyCollected, 20);
    assert.strictEqual(getBalance(db, "buyer_1").balance, 0, "levy stands");
    assert.strictEqual(getTreasuryBalance(db), 120, "pool holds the levy, paid nothing");
  });
});
