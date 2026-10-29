/**
 * Tests for the Concord Coin closed-loop / utility-token withdrawal policy.
 *
 * Ground truth (server/economy/withdrawals.js):
 *   - Purchased CC (Stripe TOKEN_PURCHASE) is spend-only store credit and is
 *     NEVER withdrawable to fiat — the one-directionality that keeps deposits
 *     closed-loop and only redeems creator EARNINGS (money-transmitter
 *     risk-reducer; mirrors Roblox Earned-Robux / DevEx).
 *   - Earned CC (marketplace sale seller credit + ROYALTY_PAYOUT) IS
 *     withdrawable, after the 48h settlement hold.
 *   - Peer TRANSFER-in is NOT earned (would reopen a buy → transfer → cash-out
 *     launder hole).
 *
 * Also pins the Stripe webhook signature gate: a forged event is rejected.
 *
 * This file lives under tests/** so it runs in the CI suite (the sibling
 * server/economy/economy.test.js is outside the CI glob).
 *
 * Run: node --test server/tests/economy/withdrawal-earned-policy.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { requestWithdrawal, earnedWithdrawableBalance, WITHDRAWABLE_EARNED_TYPES } from "../../economy/withdrawals.js";
import { executePurchase, executeTransfer } from "../../economy/transfer.js";
import { PLATFORM_ACCOUNT_ID } from "../../economy/fees.js";

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
      fee           REAL NOT NULL DEFAULT 0,
      net           REAL NOT NULL CHECK(net > 0),
      status        TEXT NOT NULL DEFAULT 'complete',
      metadata_json TEXT DEFAULT '{}',
      request_id    TEXT,
      ip            TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      ref_id        TEXT
    );
    CREATE TABLE IF NOT EXISTS economy_withdrawals (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      amount        REAL NOT NULL CHECK(amount > 0),
      fee           REAL NOT NULL DEFAULT 0,
      net           REAL NOT NULL CHECK(net > 0),
      status        TEXT NOT NULL DEFAULT 'pending',
      ledger_id     TEXT,
      reviewed_by   TEXT,
      reviewed_at   TEXT,
      processed_at  TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

/**
 * Insert an EARNED credit row, backdated past the 48h hold by default.
 * Royalty rows are stamped the way the real royalty-cascade writer stamps
 * them (metadata role "royalty") — since C1, earnedWithdrawableBalance only
 * counts system-stamped royalty rows, so an unstamped seed would be a
 * fiction no production writer produces.
 */
function seedEarned(db, userId, net, { hoursAgo = 72, type = "ROYALTY_PAYOUT" } = {}) {
  const ts = new Date(Date.now() - hoursAgo * 3600 * 1000)
    .toISOString().replace("T", " ").replace("Z", "");
  const from = type === "MARKETPLACE_PURCHASE" ? null : PLATFORM_ACCOUNT_ID;
  const metadata = type === "ROYALTY_PAYOUT" ? JSON.stringify({ role: "royalty" }) : "{}";
  db.prepare(`
    INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, 'complete', ?, ?)
  `).run("txn_seed_" + Math.random().toString(36).slice(2, 14), type, from, userId, net, net, metadata, ts);
}

// ── Policy ────────────────────────────────────────────────────────────────────

describe("CC withdrawal policy — earned vs purchased", () => {
  let db;
  beforeEach(() => { db = createTestDb(); });

  it("only marketplace sales + royalties are withdrawable types", () => {
    assert.deepEqual([...WITHDRAWABLE_EARNED_TYPES].sort(), ["MARKETPLACE_PURCHASE", "ROYALTY_PAYOUT"]);
    assert.ok(!WITHDRAWABLE_EARNED_TYPES.includes("TOKEN_PURCHASE"));
    assert.ok(!WITHDRAWABLE_EARNED_TYPES.includes("TRANSFER"));
  });

  it("purchased CC (Stripe TOKEN_PURCHASE) is NOT withdrawable", () => {
    executePurchase(db, { userId: "buyer", amount: 1000 });
    const req = requestWithdrawal(db, { userId: "buyer", amount: 100 });
    assert.equal(req.ok, false);
    assert.equal(req.error, "insufficient_earned_balance");
  });

  it("earned royalty CC IS withdrawable once settled", () => {
    seedEarned(db, "creator", 300, { type: "ROYALTY_PAYOUT" });
    const req = requestWithdrawal(db, { userId: "creator", amount: 250 });
    assert.ok(req.ok, `expected ok, got ${req.error}`);
    assert.equal(req.withdrawal.status, "pending");
  });

  it("earned marketplace-sale CC IS withdrawable once settled", () => {
    seedEarned(db, "seller", 300, { type: "MARKETPLACE_PURCHASE" });
    const req = requestWithdrawal(db, { userId: "seller", amount: 100 });
    assert.ok(req.ok, `expected ok, got ${req.error}`);
  });

  it("freshly-earned CC is withheld for 48h", () => {
    seedEarned(db, "creator2", 300, { hoursAgo: 2 });
    const req = requestWithdrawal(db, { userId: "creator2", amount: 50 });
    assert.equal(req.ok, false);
    assert.equal(req.error, "insufficient_earned_balance");
  });

  it("cannot withdraw more than earned headroom even with purchased CC on top", () => {
    seedEarned(db, "mixed", 100); // 100 earned
    executePurchase(db, { userId: "mixed", amount: 1000 }); // + 1000 purchased
    // Balance is ~1100 but only 100 is earned — withdrawing 200 must fail.
    const req = requestWithdrawal(db, { userId: "mixed", amount: 200 });
    assert.equal(req.ok, false);
    assert.equal(req.error, "insufficient_earned_balance");
    // ...and 100 earned succeeds.
    const ok = requestWithdrawal(db, { userId: "mixed", amount: 100 });
    assert.ok(ok.ok, `expected earned 100 withdrawable, got ${ok.error}`);
  });

  it("peer TRANSFER-in is not withdrawable (anti-launder)", () => {
    // Simulate received transfer credit row (from another user).
    const ts = new Date(Date.now() - 72 * 3600 * 1000).toISOString().replace("T", " ").replace("Z", "");
    db.prepare(`INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status, created_at)
      VALUES ('txn_xfer1','TRANSFER','other-user','launderer',100,0,100,'complete',?)`).run(ts);
    const req = requestWithdrawal(db, { userId: "launderer", amount: 50 });
    assert.equal(req.ok, false);
    assert.equal(req.error, "insufficient_earned_balance");
  });
});

// ── C1: ledger-type seal (defense in depth on the withdrawal leg) ────────────
// The transfer route no longer accepts a caller-chosen ledger type (user
// transfers are always TRANSFER). These tests pin the second leg: even a
// ROYALTY_PAYOUT-labelled row that a peer transfer produced must never
// count as earned — only system-stamped royalty distributions do.

describe("C1 — mislabeled transfer rows never become withdrawable", () => {
  let db;
  beforeEach(() => { db = createTestDb(); });

  function backdateLedgerRow(id) {
    const ts = new Date(Date.now() - 72 * 3600 * 1000).toISOString().replace("T", " ").replace("Z", "");
    db.prepare("UPDATE economy_ledger SET created_at = ? WHERE id = ?").run(ts, id);
  }

  it("a peer transfer labelled ROYALTY_PAYOUT earns nothing (the C1 attack)", () => {
    executePurchase(db, { userId: "attacker", amount: 500 });
    // The exact pre-seal attack construction at the economy layer: a peer
    // transfer whose credit row claims the 0%-fee royalty type.
    const res = executeTransfer(db, {
      from: "attacker",
      to: "attacker-alt",
      amount: 200,
      type: "ROYALTY_PAYOUT",
    });
    assert.ok(res.ok, `transfer should execute, got ${res.error}`);
    const credit = db.prepare(
      "SELECT * FROM economy_ledger WHERE to_user_id = 'attacker-alt' AND type = 'ROYALTY_PAYOUT'",
    ).get();
    assert.ok(credit, "the mislabeled credit row exists");
    assert.equal(credit.fee, 0); // the fee-evasion half of C1, as constructed
    backdateLedgerRow(credit.id); // let the 48h hold pass

    assert.equal(earnedWithdrawableBalance(db, "attacker-alt").eligible, 0);
    const req = requestWithdrawal(db, { userId: "attacker-alt", amount: 50 });
    assert.equal(req.ok, false);
    assert.equal(req.error, "insufficient_earned_balance");
  });

  it("creative-marketplace royalty rows (from NULL, role creative_royalty_cascade) DO count", () => {
    const ts = new Date(Date.now() - 72 * 3600 * 1000).toISOString().replace("T", " ").replace("Z", "");
    db.prepare(`
      INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status, metadata_json, ref_id, created_at)
      VALUES ('txn_creative_royalty', 'ROYALTY_PAYOUT', NULL, 'creator', 120, 0, 120, 'complete', ?, 'creative_royalty:buy1:art1', ?)
    `).run(JSON.stringify({ role: "creative_royalty_cascade", generation: 0 }), ts);
    assert.equal(earnedWithdrawableBalance(db, "creator").eligible, 120);
  });

  it("royalty-cascade rows (from the seller, role royalty) DO count", () => {
    const ts = new Date(Date.now() - 72 * 3600 * 1000).toISOString().replace("T", " ").replace("Z", "");
    db.prepare(`
      INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status, metadata_json, created_at)
      VALUES ('txn_cascade_royalty', 'ROYALTY_PAYOUT', 'seller-1', 'ancestor', 80, 0, 80, 'complete', ?, ?)
    `).run(JSON.stringify({ role: "royalty", generation: 1 }), ts);
    assert.equal(earnedWithdrawableBalance(db, "ancestor").eligible, 80);
  });

  it("an unstamped ROYALTY_PAYOUT row fails closed (no system royalty stamp, no earnings)", () => {
    const ts = new Date(Date.now() - 72 * 3600 * 1000).toISOString().replace("T", " ").replace("Z", "");
    db.prepare(`
      INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status, metadata_json, created_at)
      VALUES ('txn_unstamped', 'ROYALTY_PAYOUT', ?, 'mystery', 90, 0, 90, 'complete', '{}', ?)
    `).run(PLATFORM_ACCOUNT_ID, ts);
    assert.equal(earnedWithdrawableBalance(db, "mystery").eligible, 0);
  });
});

// ── Stripe webhook signature gate ──────────────────────────────────────────────

describe("Stripe webhook signature verification", () => {
  it("rejects a forged event (bad signature)", async () => {
    // stripe.js reads its config at module load, so set env BEFORE importing.
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_signature_check";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_dummy_for_signature_check";
    const { handleWebhook } = await import("../../economy/stripe.js");

    const db = createTestDb();
    db.exec(`CREATE TABLE IF NOT EXISTS stripe_events_processed (
      event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);

    const forgedBody = Buffer.from(JSON.stringify({
      id: "evt_forged_123", type: "checkout.session.completed",
      data: { object: { metadata: { userId: "attacker", tokens: "999999", purpose: "TOKEN_PURCHASE" } } },
    }));

    const result = await handleWebhook(db, {
      rawBody: forgedBody,
      signature: "t=123,v1=deadbeefnotavalidsignature",
      requestId: "test", ip: "127.0.0.1",
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, "webhook_signature_invalid");
    // The forged purchase must NOT have credited any tokens.
    const credited = db.prepare(
      "SELECT COUNT(*) AS c FROM economy_ledger WHERE to_user_id = 'attacker'",
    ).get().c;
    assert.equal(credited, 0);
  });
});
