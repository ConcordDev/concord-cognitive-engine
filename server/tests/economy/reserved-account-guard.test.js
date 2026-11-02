/**
 * Pinning test for the reserved-account guard (Gate 5 Act 2).
 *
 * The §6 reserves review found the ledger pool had no positive lock: any
 * caller able to reach executeTransfer with from = a platform system
 * account could debit it through the user transfer path. The guard refuses
 * reserved-account debits at executeTransfer's door. Legitimate system
 * debits never ride executeTransfer — fee-split distribution, chargeback
 * payout, and emergent reserve debits all write via recordTransactionBatch
 * directly — and __ESCROW__ releases (bounty claims, commission payouts)
 * DO ride executeTransfer by design, so the reserved set is an explicit
 * list, never a "__…__" prefix test.
 *
 * These tests pin both halves:
 *   1. Every reserved account is refused as a transfer source, before any
 *      balance check, and nothing is written.
 *   2. Everything legitimate still moves: user→user transfers, transfers
 *      TO a reserved account (the guard is debit-side only), the escrow
 *      in/out flow, and fee-split's distribution into the pool accounts.
 *   3. The reserved set cannot silently drift from the real account
 *      constants it protects.
 *
 * Run: node --test server/tests/economy/reserved-account-guard.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { executeTransfer, executePurchase } from "../../economy/transfer.js";
import { distributeFee, getFeeSplitBalances } from "../../economy/fee-split.js";
import { getBalance } from "../../economy/balances.js";
import {
  PLATFORM_ACCOUNT_ID,
  RESERVES_ACCOUNT_ID,
  OPERATING_ACCOUNT_ID,
  PAYROLL_ACCOUNT_ID,
  RESERVED_DEBIT_ACCOUNTS,
  isReservedDebitAccount,
} from "../../economy/fees.js";
import { CONCORD_SYSTEM_ID } from "../../economy/royalty-cascade.js";

function createDb() {
  const db = new Database(":memory:");
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
      details     TEXT,
      prev_hash   TEXT,
      hash        TEXT
    );
    CREATE TABLE IF NOT EXISTS purchases (
      id                        TEXT PRIMARY KEY,
      purchase_id               TEXT,
      buyer_id                  TEXT,
      seller_id                 TEXT,
      listing_id                TEXT,
      listing_type              TEXT,
      license_type              TEXT,
      amount                    REAL,
      fee                       REAL,
      seller_proceeds           REAL,
      currency                  TEXT,
      status                    TEXT,
      stripe_payment_intent_id  TEXT,
      stripe_charge_id          TEXT,
      payment_method            TEXT,
      refunded_at               TEXT,
      refund_amount             REAL,
      created_at                TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at              TEXT,
      metadata                  TEXT
    );
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
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      ref_id        TEXT
    );
    CREATE TABLE IF NOT EXISTS fee_distributions (
      id TEXT PRIMARY KEY, source_tx_id TEXT NOT NULL, total_fee REAL NOT NULL,
      reserves_amount REAL NOT NULL, operating_amount REAL NOT NULL,
      payroll_amount REAL NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS treasury (
      id TEXT PRIMARY KEY, total_usd REAL NOT NULL DEFAULT 0, total_coins REAL NOT NULL DEFAULT 0,
      updated_at TEXT);
    CREATE TABLE IF NOT EXISTS treasury_events (
      id TEXT PRIMARY KEY, event_type TEXT, amount REAL, usd_before REAL, usd_after REAL,
      coins_before REAL, coins_after REAL, ref_id TEXT, metadata_json TEXT, created_at TEXT);
    INSERT INTO treasury (id, total_usd, total_coins, updated_at) VALUES ('treasury_main', 0, 0, datetime('now'));
  `);
  return db;
}

const ledgerCount = (db) => db.prepare("SELECT COUNT(*) AS n FROM economy_ledger").get().n;

describe("reserved-account guard (Gate 5 Act 2)", () => {
  let db;
  beforeEach(() => { db = createDb(); });

  it("the reserved set is exactly the platform accounts it protects — no drift, no escrow", () => {
    // Both spellings of the pool account are listed so this pin holds on
    // either side of the Gate 5 Act 1 rename (the Set dedupes the one that
    // coincides with RESERVES_ACCOUNT_ID's current value).
    const expected = new Set([
      PLATFORM_ACCOUNT_ID,
      RESERVES_ACCOUNT_ID,
      OPERATING_ACCOUNT_ID,
      PAYROLL_ACCOUNT_ID,
      "__RESERVES__",
      "__TREASURY__",
      CONCORD_SYSTEM_ID,
    ]);
    assert.equal(RESERVED_DEBIT_ACCOUNTS.size, expected.size);
    for (const id of expected) {
      assert.ok(isReservedDebitAccount(id), `${id} must be a reserved debit account`);
    }
    for (const id of RESERVED_DEBIT_ACCOUNTS) {
      assert.ok(expected.has(id), `${id} is in the reserved set but not in the pinned expectation`);
    }
    assert.ok(!isReservedDebitAccount("__ESCROW__"), "__ESCROW__ releases ride executeTransfer by design");
    assert.ok(!isReservedDebitAccount("alice"));
    assert.ok(!isReservedDebitAccount(undefined));
  });

  it("refuses every reserved account as a transfer source, before balance checks, writing nothing", () => {
    for (const id of RESERVED_DEBIT_ACCOUNTS) {
      const before = ledgerCount(db);
      const r = executeTransfer(db, { from: id, to: "alice", amount: 10 });
      assert.equal(r.ok, false, `${id} must be refused`);
      assert.equal(r.error, "reserved_account_debit");
      assert.equal(ledgerCount(db), before, `${id}: refusal must write no ledger rows`);
    }
  });

  it("refuses even when the reserved account holds funds (the drain the guard exists to stop)", () => {
    const funded = distributeFee(db, { feeAmount: 100, sourceTxId: "seed_fee" });
    assert.equal(funded.ok, true);
    assert.ok(getBalance(db, RESERVES_ACCOUNT_ID).balance > 0);
    const r = executeTransfer(db, { from: RESERVES_ACCOUNT_ID, to: "attacker", amount: 10 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "reserved_account_debit");
    assert.equal(getBalance(db, "attacker").balance, 0);
  });

  it("user→user transfers still move", () => {
    executePurchase(db, { userId: "alice", amount: 1000 });
    const r = executeTransfer(db, { from: "alice", to: "bob", amount: 40 });
    assert.equal(r.ok, true);
    assert.ok(getBalance(db, "bob").balance > 0);
  });

  it("transfers TO a reserved account still work — the guard is debit-side only", () => {
    executePurchase(db, { userId: "alice", amount: 1000 });
    const r = executeTransfer(db, { from: "alice", to: PLATFORM_ACCOUNT_ID, amount: 25 });
    assert.equal(r.ok, true);
    assert.ok(getBalance(db, PLATFORM_ACCOUNT_ID).balance > 0);
  });

  it("the escrow flow is untouched: poster → __ESCROW__ → claimer", () => {
    executePurchase(db, { userId: "poster", amount: 1000 });
    const hold = executeTransfer(db, { from: "poster", to: "__ESCROW__", amount: 300, type: "BOUNTY_ESCROW", refId: "bounty_escrow:g1" });
    assert.equal(hold.ok, true);
    const claim = executeTransfer(db, { from: "__ESCROW__", to: "claimer", amount: 300, type: "BOUNTY_CLAIM", refId: "bounty_claim:g1:claimer" });
    assert.equal(claim.ok, true);
    assert.equal(getBalance(db, "claimer").balance, 300);
  });

  it("fee-split distribution (the pool's funding path) is unaffected", () => {
    const r = distributeFee(db, { feeAmount: 100, sourceTxId: "fee_src_1" });
    assert.equal(r.ok, true);
    const balances = getFeeSplitBalances(db);
    assert.equal(balances.reserves, 80);
    assert.equal(balances.operating, 10);
    assert.equal(balances.payroll, 10);
  });
});
