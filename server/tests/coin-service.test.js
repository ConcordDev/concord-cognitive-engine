// tests/coin-service.test.js
// Comprehensive test suite for economy/coin-service.js
//
// Covers: mintCoins, burnCoins, getTreasuryState, verifyTreasuryInvariant,
//         getTreasuryEvents — all exported functions, all error paths,
//         boundary values, concurrent operations, and treasury invariants.
//
// Run: node --test tests/coin-service.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  mintCoins,
  burnCoins,
  getTreasuryState,
  verifyTreasuryInvariant,
  getTreasuryEvents,
} from "../economy/coin-service.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a fresh in-memory DB with all tables required by coin-service.
 */
function createTestDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    -- Treasury singleton
    CREATE TABLE IF NOT EXISTS treasury (
      id          TEXT PRIMARY KEY,
      total_usd   REAL NOT NULL DEFAULT 0,
      total_coins REAL NOT NULL DEFAULT 0,
      updated_at  TEXT
    );

    -- Treasury events log
    CREATE TABLE IF NOT EXISTS treasury_events (
      id              TEXT PRIMARY KEY,
      event_type      TEXT NOT NULL,
      amount          REAL NOT NULL,
      usd_before      REAL,
      usd_after       REAL,
      coins_before    REAL,
      coins_after     REAL,
      ref_id          TEXT,
      metadata_json   TEXT DEFAULT '{}',
      created_at      TEXT NOT NULL
    );

    -- Economy ledger (needed by verifyTreasuryInvariant)
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
      ref_id        TEXT,
      CHECK(from_user_id IS NOT NULL OR to_user_id IS NOT NULL)
    );

    -- Audit log (used by audit.js, called transitively)
    CREATE TABLE IF NOT EXISTS audit_log (
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

    -- Seed treasury
    INSERT INTO treasury (id, total_usd, total_coins, updated_at)
    VALUES ('treasury_main', 0, 0, datetime('now'));
  `);

  return db;
}

/**
 * Seed treasury with a known state.
 */
function seedTreasury(db, usd, coins) {
  db.prepare("UPDATE treasury SET total_usd = ?, total_coins = ? WHERE id = 'treasury_main'")
    .run(usd, coins);
}

/**
 * Insert a ledger row directly (bypasses normal flow, useful for invariant tests).
 */
function insertLedgerRow(db, { id, type, from, to, amount, fee, net, status }) {
  db.prepare(`
    INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, type, from || null, to || null, amount, fee ?? 0, net ?? amount, status ?? "complete");
}

// ── Test suites ──────────────────────────────────────────────────────────────

let db;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  if (db && db.open) db.close();
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. getTreasuryState
// ═══════════════════════════════════════════════════════════════════════════════

describe("getTreasuryState", () => {
  it("returns treasury row when initialized", () => {
    const state = getTreasuryState(db);
    assert.ok(state, "Expected treasury state to be returned");
    assert.equal(state.id, "treasury_main");
    assert.equal(state.total_usd, 0);
    assert.equal(state.total_coins, 0);
  });

  it("returns null when treasury table is empty", () => {
    db.prepare("DELETE FROM treasury").run();
    const state = getTreasuryState(db);
    assert.equal(state, null);
  });

  it("reflects updated values after manual seed", () => {
    seedTreasury(db, 1000, 800);
    const state = getTreasuryState(db);
    assert.equal(state.total_usd, 1000);
    assert.equal(state.total_coins, 800);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. mintCoins
// ═══════════════════════════════════════════════════════════════════════════════

describe("mintCoins", () => {
  // ── Validation errors ──────────────────────────────────────────────────────

  describe("input validation", () => {
    it("rejects zero amount", () => {
      const result = mintCoins(db, { amount: 0, userId: "user_1" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "invalid_mint_amount");
    });

    it("rejects negative amount", () => {
      const result = mintCoins(db, { amount: -50, userId: "user_1" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "invalid_mint_amount");
    });

    it("rejects undefined amount", () => {
      const result = mintCoins(db, { amount: undefined, userId: "user_1" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "invalid_mint_amount");
    });

    it("rejects null amount", () => {
      const result = mintCoins(db, { amount: null, userId: "user_1" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "invalid_mint_amount");
    });

    it("rejects NaN amount (falsy)", () => {
      const result = mintCoins(db, { amount: NaN, userId: "user_1" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "invalid_mint_amount");
    });

    it("rejects missing userId", () => {
      const result = mintCoins(db, { amount: 100, userId: undefined });
      assert.equal(result.ok, false);
      assert.equal(result.error, "missing_user_id");
    });

    it("rejects empty string userId", () => {
      const result = mintCoins(db, { amount: 100, userId: "" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "missing_user_id");
    });

    it("rejects null userId", () => {
      const result = mintCoins(db, { amount: 100, userId: null });
      assert.equal(result.ok, false);
      assert.equal(result.error, "missing_user_id");
    });
  });

  // ── Successful minting ────────────────────────────────────────────────────

  describe("successful mint", () => {
    it("mints coins and updates treasury", () => {
      const result = mintCoins(db, { amount: 100, userId: "user_1" });
      assert.equal(result.ok, true);
      assert.equal(result.amount, 100);
      assert.equal(result.userId, "user_1");

      // Treasury state
      assert.equal(result.treasury.usdBefore, 0);
      assert.equal(result.treasury.usdAfter, 100);
      assert.equal(result.treasury.coinsBefore, 0);
      assert.equal(result.treasury.coinsAfter, 100);

      // Verify DB persisted
      const state = getTreasuryState(db);
      assert.equal(state.total_usd, 100);
      assert.equal(state.total_coins, 100);
    });

    it("creates a MINT treasury event", () => {
      mintCoins(db, { amount: 250, userId: "user_2" });
      const events = getTreasuryEvents(db);
      assert.equal(events.length, 1);
      assert.equal(events[0].event_type, "MINT");
      assert.equal(events[0].amount, 250);
      assert.equal(events[0].usd_before, 0);
      assert.equal(events[0].usd_after, 250);
    });

    it("accumulates multiple mints correctly", () => {
      mintCoins(db, { amount: 100, userId: "user_1" });
      mintCoins(db, { amount: 200, userId: "user_2" });
      mintCoins(db, { amount: 50, userId: "user_1" });

      const state = getTreasuryState(db);
      assert.equal(state.total_usd, 350);
      assert.equal(state.total_coins, 350);

      const events = getTreasuryEvents(db);
      assert.equal(events.length, 3);
    });

    it("handles fractional amounts with correct rounding", () => {
      mintCoins(db, { amount: 33.33, userId: "user_1" });
      mintCoins(db, { amount: 66.67, userId: "user_2" });

      const state = getTreasuryState(db);
      assert.equal(state.total_usd, 100);
      assert.equal(state.total_coins, 100);
    });

    it("handles very small amounts (0.01 — one cent)", () => {
      const result = mintCoins(db, { amount: 0.01, userId: "user_1" });
      assert.equal(result.ok, true);
      assert.equal(result.treasury.usdAfter, 0.01);
      assert.equal(result.treasury.coinsAfter, 0.01);
    });

    it("handles large amounts without overflow", () => {
      const largeAmount = 999_999_999.99;
      const result = mintCoins(db, { amount: largeAmount, userId: "user_1" });
      assert.equal(result.ok, true);
      assert.equal(result.treasury.usdAfter, largeAmount);
      assert.equal(result.treasury.coinsAfter, largeAmount);
    });

    it("stores refId in event when provided", () => {
      mintCoins(db, { amount: 50, userId: "user_1", refId: "stripe_pi_abc123" });
      const events = getTreasuryEvents(db);
      assert.equal(events[0].ref_id, "stripe_pi_abc123");
    });

    it("stores null refId when not provided", () => {
      mintCoins(db, { amount: 50, userId: "user_1" });
      const events = getTreasuryEvents(db);
      assert.equal(events[0].ref_id, null);
    });

    it("stores userId in event metadata", () => {
      mintCoins(db, { amount: 50, userId: "user_abc" });
      const events = getTreasuryEvents(db);
      const metadata = JSON.parse(events[0].metadata_json);
      assert.equal(metadata.userId, "user_abc");
    });

    it("event id has tev_ prefix", () => {
      mintCoins(db, { amount: 100, userId: "user_1" });
      const events = getTreasuryEvents(db);
      assert.ok(events[0].id.startsWith("tev_"), `Expected tev_ prefix, got: ${events[0].id}`);
    });
  });

  // ── Transaction error (treasury not initialized) ──────────────────────────

  describe("treasury not initialized", () => {
    it("returns mint_failed when treasury row is missing", () => {
      db.prepare("DELETE FROM treasury").run();
      const result = mintCoins(db, { amount: 100, userId: "user_1" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "mint_failed");
    });
  });

  // ── Floating point precision ──────────────────────────────────────────────

  describe("floating point precision", () => {
    it("rounds to 2 decimal places to avoid floating point drift", () => {
      // 0.1 + 0.2 in IEEE 754 is 0.30000000000000004
      mintCoins(db, { amount: 0.1, userId: "user_1" });
      mintCoins(db, { amount: 0.2, userId: "user_1" });

      const state = getTreasuryState(db);
      assert.equal(state.total_usd, 0.3);
      assert.equal(state.total_coins, 0.3);
    });

    it("handles repeated small additions correctly", () => {
      for (let i = 0; i < 10; i++) {
        mintCoins(db, { amount: 0.01, userId: "user_1" });
      }
      const state = getTreasuryState(db);
      assert.equal(state.total_usd, 0.1);
      assert.equal(state.total_coins, 0.1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. burnCoins
// ═══════════════════════════════════════════════════════════════════════════════

describe("burnCoins", () => {
  // ── Validation errors ──────────────────────────────────────────────────────

  describe("input validation", () => {
    it("rejects zero amount", () => {
      const result = burnCoins(db, { amount: 0, userId: "user_1" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "invalid_burn_amount");
    });

    it("rejects negative amount", () => {
      const result = burnCoins(db, { amount: -10, userId: "user_1" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "invalid_burn_amount");
    });

    it("rejects undefined amount", () => {
      const result = burnCoins(db, { amount: undefined, userId: "user_1" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "invalid_burn_amount");
    });

    it("rejects null amount", () => {
      const result = burnCoins(db, { amount: null, userId: "user_1" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "invalid_burn_amount");
    });

    it("rejects NaN amount", () => {
      const result = burnCoins(db, { amount: NaN, userId: "user_1" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "invalid_burn_amount");
    });

    it("rejects missing userId", () => {
      const result = burnCoins(db, { amount: 100, userId: undefined });
      assert.equal(result.ok, false);
      assert.equal(result.error, "missing_user_id");
    });

    it("rejects empty string userId", () => {
      const result = burnCoins(db, { amount: 100, userId: "" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "missing_user_id");
    });

    it("rejects null userId", () => {
      const result = burnCoins(db, { amount: 100, userId: null });
      assert.equal(result.ok, false);
      assert.equal(result.error, "missing_user_id");
    });
  });

  // ── Successful burning ────────────────────────────────────────────────────

  describe("successful burn", () => {
    it("burns coins and decreases treasury", () => {
      seedTreasury(db, 500, 500);
      const result = burnCoins(db, { amount: 200, userId: "user_1" });

      assert.equal(result.ok, true);
      assert.equal(result.amount, 200);
      assert.equal(result.userId, "user_1");
      assert.equal(result.treasury.usdBefore, 500);
      assert.equal(result.treasury.usdAfter, 300);
      assert.equal(result.treasury.coinsBefore, 500);
      assert.equal(result.treasury.coinsAfter, 300);
    });

    it("persists treasury state after burn", () => {
      seedTreasury(db, 1000, 1000);
      burnCoins(db, { amount: 400, userId: "user_1" });

      const state = getTreasuryState(db);
      assert.equal(state.total_usd, 600);
      assert.equal(state.total_coins, 600);
    });

    it("creates a BURN treasury event", () => {
      seedTreasury(db, 100, 100);
      burnCoins(db, { amount: 30, userId: "user_1" });

      const events = getTreasuryEvents(db);
      assert.equal(events.length, 1);
      assert.equal(events[0].event_type, "BURN");
      assert.equal(events[0].amount, 30);
    });

    it("burns all coins (exact full burn)", () => {
      seedTreasury(db, 100, 100);
      const result = burnCoins(db, { amount: 100, userId: "user_1" });

      assert.equal(result.ok, true);
      assert.equal(result.treasury.usdAfter, 0);
      assert.equal(result.treasury.coinsAfter, 0);
    });

    it("handles fractional burn amounts", () => {
      seedTreasury(db, 100.50, 100.50);
      const result = burnCoins(db, { amount: 33.33, userId: "user_1" });

      assert.equal(result.ok, true);
      assert.equal(result.treasury.usdAfter, 67.17);
      assert.equal(result.treasury.coinsAfter, 67.17);
    });

    it("handles very small burn (0.01 — one cent)", () => {
      seedTreasury(db, 1, 1);
      const result = burnCoins(db, { amount: 0.01, userId: "user_1" });
      assert.equal(result.ok, true);
      assert.equal(result.treasury.coinsAfter, 0.99);
    });

    it("stores refId in event when provided", () => {
      seedTreasury(db, 100, 100);
      burnCoins(db, { amount: 10, userId: "user_1", refId: "wd_ref_xyz" });
      const events = getTreasuryEvents(db);
      assert.equal(events[0].ref_id, "wd_ref_xyz");
    });

    it("stores userId in event metadata", () => {
      seedTreasury(db, 100, 100);
      burnCoins(db, { amount: 10, userId: "user_xyz" });
      const events = getTreasuryEvents(db);
      const metadata = JSON.parse(events[0].metadata_json);
      assert.equal(metadata.userId, "user_xyz");
    });

    it("event id has tev_ prefix", () => {
      seedTreasury(db, 100, 100);
      burnCoins(db, { amount: 10, userId: "user_1" });
      const events = getTreasuryEvents(db);
      assert.ok(events[0].id.startsWith("tev_"));
    });
  });

  // ── Insufficient treasury balance ─────────────────────────────────────────

  describe("insufficient treasury balance", () => {
    it("returns treasury_insufficient when coins < requested burn", () => {
      seedTreasury(db, 50, 50);
      const result = burnCoins(db, { amount: 100, userId: "user_1" });

      assert.equal(result.ok, false);
      assert.equal(result.error, "treasury_insufficient");
      assert.equal(result.available, 50);
      assert.equal(result.requested, 100);
    });

    it("does not modify treasury when burn fails", () => {
      seedTreasury(db, 50, 50);
      burnCoins(db, { amount: 100, userId: "user_1" });

      const state = getTreasuryState(db);
      assert.equal(state.total_usd, 50);
      assert.equal(state.total_coins, 50);
    });

    it("does not create event when burn fails due to insufficient balance", () => {
      seedTreasury(db, 10, 10);
      burnCoins(db, { amount: 20, userId: "user_1" });
      const events = getTreasuryEvents(db);
      assert.equal(events.length, 0);
    });

    it("returns treasury_insufficient when treasury is at zero", () => {
      // Treasury defaults to 0
      const result = burnCoins(db, { amount: 1, userId: "user_1" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "treasury_insufficient");
      assert.equal(result.available, 0);
      assert.equal(result.requested, 1);
    });
  });

  // ── Treasury not initialized ──────────────────────────────────────────────

  describe("treasury not initialized", () => {
    it("returns burn_failed when treasury row is missing", () => {
      db.prepare("DELETE FROM treasury").run();
      const result = burnCoins(db, { amount: 10, userId: "user_1" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "burn_failed");
    });
  });

  // ── Treasury invariant violation ──────────────────────────────────────────

  describe("treasury invariant protection", () => {
    it("prevents coinsAfter from going negative (invariant_violation path)", () => {
      // Manually set coins to 0 but USD higher —
      // then burn more coins than available to trigger invariant check
      seedTreasury(db, 100, 5);
      const result = burnCoins(db, { amount: 10, userId: "user_1" });
      // coins_before (5) < amount (10), so treasury_insufficient fires first
      assert.equal(result.ok, false);
      assert.equal(result.error, "treasury_insufficient");
    });
  });

  // ── Floating-point rounding in burns ──────────────────────────────────────

  describe("floating point precision in burns", () => {
    it("rounds to 2 decimal places to avoid drift", () => {
      seedTreasury(db, 100, 100);
      burnCoins(db, { amount: 0.1, userId: "user_1" });
      burnCoins(db, { amount: 0.2, userId: "user_1" });

      const state = getTreasuryState(db);
      assert.equal(state.total_usd, 99.7);
      assert.equal(state.total_coins, 99.7);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Mint + Burn combined scenarios
// ═══════════════════════════════════════════════════════════════════════════════

describe("mintCoins + burnCoins combined", () => {
  it("mint then burn to zero leaves treasury empty", () => {
    mintCoins(db, { amount: 500, userId: "user_1" });
    const result = burnCoins(db, { amount: 500, userId: "user_1" });

    assert.equal(result.ok, true);
    const state = getTreasuryState(db);
    assert.equal(state.total_usd, 0);
    assert.equal(state.total_coins, 0);
  });

  it("mint, partial burn, mint more — treasury accumulates correctly", () => {
    mintCoins(db, { amount: 100, userId: "user_1" });
    burnCoins(db, { amount: 30, userId: "user_1" });
    mintCoins(db, { amount: 50, userId: "user_2" });

    const state = getTreasuryState(db);
    assert.equal(state.total_usd, 120);
    assert.equal(state.total_coins, 120);
  });

  it("events are recorded in order for interleaved operations", () => {
    mintCoins(db, { amount: 100, userId: "user_1" });
    burnCoins(db, { amount: 20, userId: "user_1" });
    mintCoins(db, { amount: 50, userId: "user_2" });

    const events = getTreasuryEvents(db);
    assert.equal(events.length, 3);
    // Events come back DESC by created_at; the amounts should total correctly
    const types = events.map(e => e.event_type);
    assert.ok(types.includes("MINT"));
    assert.ok(types.includes("BURN"));
  });

  it("burn after failed mint leaves treasury unchanged", () => {
    mintCoins(db, { amount: 100, userId: "user_1" });
    // Invalid mint
    mintCoins(db, { amount: -5, userId: "user_1" });

    const state = getTreasuryState(db);
    assert.equal(state.total_usd, 100);
    assert.equal(state.total_coins, 100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. verifyTreasuryInvariant
// ═══════════════════════════════════════════════════════════════════════════════

describe("verifyTreasuryInvariant", () => {
  it("returns error when treasury is not initialized", () => {
    db.prepare("DELETE FROM treasury").run();
    const result = verifyTreasuryInvariant(db);
    assert.equal(result.ok, false);
    assert.equal(result.error, "treasury_not_initialized");
  });

  it("holds when treasury has zero state and no ledger entries", () => {
    const result = verifyTreasuryInvariant(db);
    assert.equal(result.ok, true);
    assert.equal(result.invariantHolds, true);
    assert.equal(result.treasury.totalUsd, 0);
    assert.equal(result.treasury.totalCoins, 0);
    assert.equal(result.checks.coinsLteUsd, true);
    assert.equal(result.checks.usdCoversCirculation, true);
  });

  it("holds when coins equal USD (1:1 peg)", () => {
    seedTreasury(db, 1000, 1000);
    const result = verifyTreasuryInvariant(db);
    assert.equal(result.invariantHolds, true);
    assert.equal(result.checks.coinsLteUsd, true);
  });

  it("holds when coins are less than USD", () => {
    seedTreasury(db, 1000, 800);
    const result = verifyTreasuryInvariant(db);
    assert.equal(result.invariantHolds, true);
    assert.equal(result.checks.coinsLteUsd, true);
  });

  it("fails when coins exceed USD (invariant violation)", () => {
    seedTreasury(db, 100, 200);
    const result = verifyTreasuryInvariant(db);
    assert.equal(result.invariantHolds, false);
    assert.equal(result.checks.coinsLteUsd, false);
  });

  it("reports circulation data from ledger", () => {
    seedTreasury(db, 500, 500);

    // Add a credit entry
    insertLedgerRow(db, {
      id: "txn_credit_1", type: "TOKEN_PURCHASE", to: "user_1",
      amount: 100, fee: 0, net: 100, status: "complete",
    });
    // Add a debit entry
    insertLedgerRow(db, {
      id: "txn_debit_1", type: "TRANSFER", from: "user_1", to: "user_2",
      amount: 30, fee: 0, net: 30, status: "complete",
    });

    const result = verifyTreasuryInvariant(db);
    assert.equal(result.ok, true);
    assert.ok(result.circulation !== undefined);
    assert.ok(typeof result.circulation.totalCredits === "number");
    assert.ok(typeof result.circulation.totalDebits === "number");
    assert.ok(typeof result.circulation.circulatingCoins === "number");
  });

  it("fails when USD does not cover circulating coins", () => {
    // Set treasury to low USD but high coins
    seedTreasury(db, 10, 10);

    // Add large credit entry that exceeds treasury USD
    insertLedgerRow(db, {
      id: "txn_c2", type: "TOKEN_PURCHASE", to: "user_1",
      amount: 500, fee: 0, net: 500, status: "complete",
    });

    const result = verifyTreasuryInvariant(db);
    assert.equal(result.invariantHolds, false);
    assert.equal(result.checks.usdCoversCirculation, false);
  });

  it("ignores non-complete ledger entries when computing circulation", () => {
    seedTreasury(db, 500, 500);

    // Complete credit
    insertLedgerRow(db, {
      id: "txn_ok", type: "TOKEN_PURCHASE", to: "user_1",
      amount: 100, fee: 0, net: 100, status: "complete",
    });
    // Reversed credit — should be ignored
    insertLedgerRow(db, {
      id: "txn_rev", type: "TOKEN_PURCHASE", to: "user_1",
      amount: 9999, fee: 0, net: 9999, status: "reversed",
    });

    const result = verifyTreasuryInvariant(db);
    assert.equal(result.ok, true);
    assert.equal(result.invariantHolds, true);
  });

  it("returns detailed structure with all expected fields", () => {
    seedTreasury(db, 100, 100);
    const result = verifyTreasuryInvariant(db);

    // Verify top-level keys
    assert.ok("ok" in result);
    assert.ok("invariantHolds" in result);
    assert.ok("treasury" in result);
    assert.ok("circulation" in result);
    assert.ok("checks" in result);

    // Verify nested keys
    assert.ok("totalUsd" in result.treasury);
    assert.ok("totalCoins" in result.treasury);
    assert.ok("totalCredits" in result.circulation);
    assert.ok("totalDebits" in result.circulation);
    assert.ok("circulatingCoins" in result.circulation);
    assert.ok("coinsLteUsd" in result.checks);
    assert.ok("usdCoversCirculation" in result.checks);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. getTreasuryEvents
// ═══════════════════════════════════════════════════════════════════════════════

describe("getTreasuryEvents", () => {
  it("returns empty array when no events exist", () => {
    const events = getTreasuryEvents(db);
    assert.ok(Array.isArray(events));
    assert.equal(events.length, 0);
  });

  it("returns all events sorted by created_at DESC", () => {
    mintCoins(db, { amount: 100, userId: "user_1" });
    mintCoins(db, { amount: 200, userId: "user_2" });
    seedTreasury(db, 300, 300); // ensure sufficient for burn
    burnCoins(db, { amount: 50, userId: "user_1" });

    const events = getTreasuryEvents(db);
    assert.equal(events.length, 3);
    // DESC order: most recent first
    for (let i = 0; i < events.length - 1; i++) {
      assert.ok(events[i].created_at >= events[i + 1].created_at);
    }
  });

  it("filters by type = MINT", () => {
    mintCoins(db, { amount: 100, userId: "user_1" });
    seedTreasury(db, 200, 200);
    burnCoins(db, { amount: 50, userId: "user_1" });

    const mintEvents = getTreasuryEvents(db, { type: "MINT" });
    assert.equal(mintEvents.length, 1);
    assert.equal(mintEvents[0].event_type, "MINT");
  });

  it("filters by type = BURN", () => {
    mintCoins(db, { amount: 100, userId: "user_1" });
    seedTreasury(db, 200, 200);
    burnCoins(db, { amount: 50, userId: "user_1" });

    const burnEvents = getTreasuryEvents(db, { type: "BURN" });
    assert.equal(burnEvents.length, 1);
    assert.equal(burnEvents[0].event_type, "BURN");
  });

  it("returns empty for non-existent type filter", () => {
    mintCoins(db, { amount: 100, userId: "user_1" });
    const events = getTreasuryEvents(db, { type: "NONEXISTENT" });
    assert.equal(events.length, 0);
  });

  it("respects limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      mintCoins(db, { amount: 10, userId: "user_1" });
    }

    const events = getTreasuryEvents(db, { limit: 3 });
    assert.equal(events.length, 3);
  });

  it("respects offset parameter", () => {
    for (let i = 0; i < 5; i++) {
      mintCoins(db, { amount: (i + 1) * 10, userId: "user_1" });
    }

    const allEvents = getTreasuryEvents(db);
    const offsetEvents = getTreasuryEvents(db, { offset: 2 });

    assert.equal(allEvents.length, 5);
    assert.equal(offsetEvents.length, 3);
    assert.equal(offsetEvents[0].id, allEvents[2].id);
  });

  it("respects combined limit and offset", () => {
    for (let i = 0; i < 10; i++) {
      mintCoins(db, { amount: 10, userId: "user_1" });
    }

    const page = getTreasuryEvents(db, { limit: 3, offset: 2 });
    assert.equal(page.length, 3);
  });

  it("defaults to limit=50 offset=0 when no options given", () => {
    // Just verifying the function works with no second argument
    const events = getTreasuryEvents(db);
    assert.ok(Array.isArray(events));
  });

  it("returns events with all expected columns", () => {
    mintCoins(db, { amount: 100, userId: "user_1", refId: "ref_123" });
    const events = getTreasuryEvents(db);
    const event = events[0];

    assert.ok(event.id);
    assert.ok(event.event_type);
    assert.ok(typeof event.amount === "number");
    assert.ok(typeof event.usd_before === "number");
    assert.ok(typeof event.usd_after === "number");
    assert.ok(typeof event.coins_before === "number");
    assert.ok(typeof event.coins_after === "number");
    assert.ok(event.created_at);
    assert.ok(event.metadata_json);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Sequential operations simulating concurrency-like patterns
// ═══════════════════════════════════════════════════════════════════════════════

describe("sequential operations (concurrency safety)", () => {
  it("rapid sequential mints maintain consistency", () => {
    const mintCount = 100;
    const mintAmount = 1.11;

    for (let i = 0; i < mintCount; i++) {
      const result = mintCoins(db, { amount: mintAmount, userId: `user_${i}` });
      assert.equal(result.ok, true);
    }

    const state = getTreasuryState(db);
    const expected = Math.round(mintCount * mintAmount * 100) / 100;
    assert.equal(state.total_usd, expected);
    assert.equal(state.total_coins, expected);

    const events = getTreasuryEvents(db, { limit: 200 });
    assert.equal(events.length, mintCount);
  });

  it("rapid sequential burns respect treasury limits", () => {
    seedTreasury(db, 10, 10);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < 20; i++) {
      const result = burnCoins(db, { amount: 1, userId: `user_${i}` });
      if (result.ok) successCount++;
      else failCount++;
    }

    assert.equal(successCount, 10);
    assert.equal(failCount, 10);

    const state = getTreasuryState(db);
    assert.equal(state.total_usd, 0);
    assert.equal(state.total_coins, 0);
  });

  it("alternating mint/burn preserves invariant", () => {
    for (let i = 0; i < 50; i++) {
      mintCoins(db, { amount: 10, userId: "user_1" });
      burnCoins(db, { amount: 5, userId: "user_1" });
    }

    const state = getTreasuryState(db);
    assert.equal(state.total_usd, 250);
    assert.equal(state.total_coins, 250);
    assert.ok(state.total_coins <= state.total_usd);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Edge cases and boundary conditions
// ═══════════════════════════════════════════════════════════════════════════════

describe("edge cases", () => {
  it("mint with extra properties (requestId, ip) does not break", () => {
    const result = mintCoins(db, {
      amount: 50,
      userId: "user_1",
      refId: "ref_1",
      requestId: "req_abc",
      ip: "127.0.0.1",
    });
    assert.equal(result.ok, true);
  });

  it("burn with extra properties does not break", () => {
    seedTreasury(db, 100, 100);
    const result = burnCoins(db, {
      amount: 10,
      userId: "user_1",
      refId: "ref_wd_1",
      requestId: "req_xyz",
      ip: "192.168.1.1",
    });
    assert.equal(result.ok, true);
  });

  it("validation precedence: amount checked before userId in mintCoins", () => {
    // Both invalid — amount check comes first
    const result = mintCoins(db, { amount: 0, userId: "" });
    assert.equal(result.error, "invalid_mint_amount");
  });

  it("validation precedence: amount checked before userId in burnCoins", () => {
    const result = burnCoins(db, { amount: -1, userId: "" });
    assert.equal(result.error, "invalid_burn_amount");
  });

  it("verifyTreasuryInvariant with no ledger data shows zero circulation", () => {
    seedTreasury(db, 100, 100);
    const result = verifyTreasuryInvariant(db);
    assert.equal(result.circulation.totalCredits, 0);
    assert.equal(result.circulation.totalDebits, 0);
    assert.equal(result.circulation.circulatingCoins, 0);
  });

  it("getTreasuryEvents with limit=0 returns empty array", () => {
    mintCoins(db, { amount: 100, userId: "user_1" });
    const events = getTreasuryEvents(db, { limit: 0 });
    assert.equal(events.length, 0);
  });

  it("getTreasuryEvents with large offset returns empty array", () => {
    mintCoins(db, { amount: 100, userId: "user_1" });
    const events = getTreasuryEvents(db, { offset: 9999 });
    assert.equal(events.length, 0);
  });

  it("mint preserves 1:1 USD:coin ratio (coins always == usd in mint)", () => {
    mintCoins(db, { amount: 123.45, userId: "user_1" });
    const state = getTreasuryState(db);
    assert.equal(state.total_usd, state.total_coins);
  });

  it("burn preserves USD:coin ratio symmetry (both decrease by same amount)", () => {
    seedTreasury(db, 500, 500);
    burnCoins(db, { amount: 123.45, userId: "user_1" });
    const state = getTreasuryState(db);
    assert.equal(state.total_usd, state.total_coins);
  });

  it("multiple getTreasuryEvents calls with different type filters", () => {
    mintCoins(db, { amount: 100, userId: "user_1" });
    mintCoins(db, { amount: 200, userId: "user_1" });
    seedTreasury(db, 500, 500);
    burnCoins(db, { amount: 50, userId: "user_1" });

    const mints = getTreasuryEvents(db, { type: "MINT" });
    const burns = getTreasuryEvents(db, { type: "BURN" });
    const all = getTreasuryEvents(db);

    assert.equal(mints.length, 2);
    assert.equal(burns.length, 1);
    assert.equal(all.length, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Atomicity — partial failure does not corrupt state
// ═══════════════════════════════════════════════════════════════════════════════

describe("atomicity", () => {
  it("failed burn does not leave partial state", () => {
    seedTreasury(db, 100, 100);

    // Successful burn
    burnCoins(db, { amount: 50, userId: "user_1" });
    // Failed burn (insufficient)
    burnCoins(db, { amount: 80, userId: "user_1" });

    const state = getTreasuryState(db);
    assert.equal(state.total_usd, 50);
    assert.equal(state.total_coins, 50);

    // Only 1 event recorded (the successful one)
    const events = getTreasuryEvents(db);
    assert.equal(events.length, 1);
  });

  it("failed mint due to missing treasury does not create events", () => {
    db.prepare("DELETE FROM treasury").run();
    mintCoins(db, { amount: 100, userId: "user_1" });

    const events = getTreasuryEvents(db);
    assert.equal(events.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Return value contract verification
// ═══════════════════════════════════════════════════════════════════════════════

describe("return value contracts", () => {
  it("mintCoins success returns { ok, amount, userId, treasury }", () => {
    const result = mintCoins(db, { amount: 42, userId: "user_x" });
    assert.equal(result.ok, true);
    assert.equal(result.amount, 42);
    assert.equal(result.userId, "user_x");
    assert.ok(result.treasury);
    assert.ok("usdBefore" in result.treasury);
    assert.ok("usdAfter" in result.treasury);
    assert.ok("coinsBefore" in result.treasury);
    assert.ok("coinsAfter" in result.treasury);
  });

  it("mintCoins validation failure returns { ok, error } only", () => {
    const result = mintCoins(db, { amount: 0, userId: "user_x" });
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, "string");
    assert.equal(result.treasury, undefined);
    assert.equal(result.amount, undefined);
  });

  it("burnCoins success returns { ok, amount, userId, treasury }", () => {
    seedTreasury(db, 100, 100);
    const result = burnCoins(db, { amount: 10, userId: "user_x" });
    assert.equal(result.ok, true);
    assert.equal(result.amount, 10);
    assert.equal(result.userId, "user_x");
    assert.ok(result.treasury);
    assert.ok("usdBefore" in result.treasury);
    assert.ok("usdAfter" in result.treasury);
    assert.ok("coinsBefore" in result.treasury);
    assert.ok("coinsAfter" in result.treasury);
  });

  it("burnCoins insufficient returns { ok, error, available, requested }", () => {
    seedTreasury(db, 10, 10);
    const result = burnCoins(db, { amount: 20, userId: "user_x" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "treasury_insufficient");
    assert.equal(typeof result.available, "number");
    assert.equal(typeof result.requested, "number");
  });

  it("burnCoins validation failure returns { ok, error } only", () => {
    const result = burnCoins(db, { amount: -1, userId: "user_x" });
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, "string");
    assert.equal(result.treasury, undefined);
    assert.equal(result.available, undefined);
  });

  it("getTreasuryState returns object with id, total_usd, total_coins, updated_at", () => {
    const state = getTreasuryState(db);
    assert.ok(state);
    assert.equal(state.id, "treasury_main");
    assert.equal(typeof state.total_usd, "number");
    assert.equal(typeof state.total_coins, "number");
  });

  it("verifyTreasuryInvariant success returns full diagnostic object", () => {
    seedTreasury(db, 100, 100);
    const result = verifyTreasuryInvariant(db);
    assert.equal(result.ok, true);
    assert.equal(typeof result.invariantHolds, "boolean");
    assert.equal(typeof result.treasury.totalUsd, "number");
    assert.equal(typeof result.treasury.totalCoins, "number");
    assert.equal(typeof result.circulation.totalCredits, "number");
    assert.equal(typeof result.circulation.totalDebits, "number");
    assert.equal(typeof result.circulation.circulatingCoins, "number");
    assert.equal(typeof result.checks.coinsLteUsd, "boolean");
    assert.equal(typeof result.checks.usdCoversCirculation, "boolean");
  });

  it("getTreasuryEvents returns array of row objects", () => {
    mintCoins(db, { amount: 100, userId: "user_1" });
    const events = getTreasuryEvents(db);
    assert.ok(Array.isArray(events));
    assert.equal(events.length, 1);
    assert.equal(typeof events[0], "object");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. mintCoins idempotency — Stripe-webhook atomicity hardening
// ═══════════════════════════════════════════════════════════════════════════════
//
// The Stripe webhook path is: executePurchase (idempotent) → mintCoins →
// markEventProcessed. A crash (or Stripe at-least-once re-delivery) between the
// mint and markEventProcessed would re-enter mintCoins with the SAME refId and,
// before this hardening, mint a SECOND time — inflating the treasury above the
// ledger's credited supply. These tests pin that a repeated refId is a no-op.
describe("mintCoins idempotency (Stripe-webhook atomicity)", () => {
  it("a repeated refId does NOT double-mint the treasury", () => {
    const refId = "stripe_mint:evt_123";

    const first = mintCoins(db, { amount: 100, userId: "user_1", refId });
    assert.equal(first.ok, true);
    assert.equal(first.idempotent, false);
    assert.equal(first.treasury.coinsAfter, 100);

    // Simulate the webhook re-delivery / crash-retry: identical refId.
    const second = mintCoins(db, { amount: 100, userId: "user_1", refId });
    assert.equal(second.ok, true, "retry still reports success to the caller");
    assert.equal(second.idempotent, true, "retry is recognized as already-minted");

    // Treasury is UNCHANGED — still 100, not 200.
    const state = getTreasuryState(db);
    assert.equal(state.total_usd, 100);
    assert.equal(state.total_coins, 100);

    // And exactly ONE MINT event exists for that refId.
    const events = getTreasuryEvents(db, { type: "MINT" });
    assert.equal(events.length, 1);
    assert.equal(events[0].ref_id, refId);
  });

  it("the idempotent retry returns the ORIGINAL treasury snapshot", () => {
    const refId = "stripe_mint:evt_snap";
    seedTreasury(db, 40, 40);

    const first = mintCoins(db, { amount: 60, userId: "user_1", refId });
    assert.equal(first.treasury.usdBefore, 40);
    assert.equal(first.treasury.usdAfter, 100);

    const retry = mintCoins(db, { amount: 60, userId: "user_1", refId });
    assert.equal(retry.idempotent, true);
    // Snapshot reflects the state as of the FIRST mint, not a re-computed one.
    assert.equal(retry.treasury.usdBefore, 40);
    assert.equal(retry.treasury.usdAfter, 100);
    assert.equal(retry.treasury.coinsAfter, 100);
  });

  it("distinct refIds each mint (idempotency is per-refId, not global)", () => {
    mintCoins(db, { amount: 100, userId: "user_1", refId: "stripe_mint:evt_A" });
    mintCoins(db, { amount: 100, userId: "user_2", refId: "stripe_mint:evt_B" });

    const state = getTreasuryState(db);
    assert.equal(state.total_coins, 200);
    assert.equal(getTreasuryEvents(db, { type: "MINT" }).length, 2);
  });

  it("refId-less mints are never suppressed (legacy callers unaffected)", () => {
    mintCoins(db, { amount: 25, userId: "user_1" });
    mintCoins(db, { amount: 25, userId: "user_1" });

    const state = getTreasuryState(db);
    assert.equal(state.total_coins, 50, "two no-refId mints both apply");
    assert.equal(getTreasuryEvents(db, { type: "MINT" }).length, 2);
  });

  it("a BURN row does not block a later MINT sharing that refId", () => {
    // Idempotency is scoped to event_type = 'MINT'; a same-refId BURN
    // (a different lifecycle event) must not mask a legitimate mint.
    seedTreasury(db, 100, 100);
    burnCoins(db, { amount: 10, userId: "user_1", refId: "shared_ref" });
    const mintRes = mintCoins(db, { amount: 30, userId: "user_1", refId: "shared_ref" });

    assert.equal(mintRes.ok, true);
    assert.equal(mintRes.idempotent, false, "the MINT is not blocked by the BURN row");
    const state = getTreasuryState(db);
    assert.equal(state.total_coins, 120); // 100 - 10 + 30
  });
});
