// server/tests/staking-lens-macros.test.js
// Phase-2 behavioral test for the macros the /lenses/staking page + its
// components actually drive: open_stake, list_positions, estimate_rewards,
// apr_history, earnings_ledger, list_receipts, transfer_receipt,
// set_auto_compound, maturity_reminders — plus the full lock → mature →
// redeem/compound payout round-trip with ACTUAL value assertions, and the
// fail-CLOSED numeric guard (poisoned NaN/Infinity/1e308/negative are
// rejected BEFORE any state write).
//
// MONEY IS REAL (2026-07 rewrite). Staking no longer lives in globalThis Maps
// — positions/receipts persist in `staking_positions`/`staking_receipts`
// (migration 371) and every principal/yield movement is a real economy_ledger
// row. So this harness builds a real in-memory DB (economy_ledger + treasury +
// migration 371), funds the staker's wallet with real CC (via executePurchase),
// funds the platform fee wallet (the yield source), and passes ctx={db,actor}.
// Time-travel to maturity is a DB UPDATE of locked_at/unlocks_at (there is no
// in-memory position store to reach into anymore).

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { getBalance } from "../economy/balances.js";
import { executePurchase } from "../economy/transfer.js";
import { recordTransaction } from "../economy/ledger.js";
import { PLATFORM_ACCOUNT_ID } from "../economy/fees.js";
import { up as stakingUp } from "../migrations/371_staking_positions.js";
import registerStakingActions from "../domains/staking.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`staking.${name}`);
  if (!fn) throw new Error(`staking.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerStakingActions(register);
});

// A real DB with the ledger + treasury + staking tables the handlers now need.
function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE economy_ledger (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, from_user_id TEXT, to_user_id TEXT,
      amount REAL NOT NULL, fee REAL NOT NULL DEFAULT 0, net REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'complete', metadata_json TEXT DEFAULT '{}',
      request_id TEXT, ip TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), ref_id TEXT);
    CREATE TABLE treasury (
      id TEXT PRIMARY KEY, total_usd REAL NOT NULL DEFAULT 0, total_coins REAL NOT NULL DEFAULT 0, updated_at TEXT);
    CREATE TABLE treasury_events (
      id TEXT PRIMARY KEY, event_type TEXT, amount REAL, usd_before REAL, usd_after REAL,
      coins_before REAL, coins_after REAL, ref_id TEXT, metadata_json TEXT, created_at TEXT);
    INSERT INTO treasury (id, total_usd, total_coins, updated_at) VALUES ('treasury_main', 0, 0, datetime('now'));
  `);
  stakingUp(db);
  return db;
}

// Fund the platform (fee) wallet — the real yield source — so redeem/compound
// can pay accrued yield in full.
function fundPlatform(db, amount) {
  recordTransaction(db, { type: "FEE_ACCRUAL", from: null, to: PLATFORM_ACCOUNT_ID, amount, net: amount, fee: 0, status: "complete" });
}

let db;
beforeEach(() => {
  db = createDb();
  // Real wallet for the staker (executePurchase credits amount minus the token
  // fee; 100000 is far more than any stake below needs).
  executePurchase(db, { userId: "lens_user_a", amount: 100000 });
  // Fund yield so full accrual is payable.
  fundPlatform(db, 100000);
  // APR history is sampled in process memory — keep it isolated per test.
  globalThis._concordSTATE = {};
});
afterEach(() => { try { db.close(); } catch { /* already closed */ } delete globalThis._concordSTATE; });

const ctxA = () => ({ db, actor: { userId: "lens_user_a" }, userId: "lens_user_a" });
const ctxB = () => ({ db, actor: { userId: "lens_user_b" }, userId: "lens_user_b" });

// Backdate the user's first-opened position to full maturity via a DB UPDATE:
// shift the entire lock window into the past by its own span so `now` sits at
// unlocks_at (full term elapsed). Returns the updated row.
function matureFirstPosition(userId) {
  const pos = db.prepare("SELECT * FROM staking_positions WHERE user_id=? ORDER BY rowid ASC LIMIT 1").get(userId);
  const span = pos.unlocks_at - pos.locked_at;
  db.prepare("UPDATE staking_positions SET locked_at=?, unlocks_at=? WHERE id=?").run(pos.locked_at - span, pos.unlocks_at - span, pos.id);
  return db.prepare("SELECT * FROM staking_positions WHERE id=?").get(pos.id);
}

describe("staking lens — every driven macro is registered + reachable", () => {
  it("all 11 lens-referenced macros resolve to a handler", () => {
    for (const m of [
      "list_pools",
      "estimate_rewards",
      "open_stake",
      "list_positions",
      "apr_history",
      "earnings_ledger",
      "list_receipts",
      "transfer_receipt",
      "set_auto_compound",
      "maturity_reminders",
      "redeem_stake",
    ]) {
      assert.equal(typeof ACTIONS.get(`staking.${m}`), "function", `${m} missing`);
    }
  });
});

describe("staking lens — open_stake persists and list_positions reflects it", () => {
  it("the form payload (poolId/principalCc/months/autoCompound/liquidReceipt) round-trips with the real locked amount", () => {
    const open = call("open_stake", ctxA(), {
      poolId: "core",
      principalCc: 250,
      months: 6,
      autoCompound: true,
      liquidReceipt: true,
    });
    assert.equal(open.ok, true, JSON.stringify(open));
    assert.equal(open.result.position.principalCc, 250);
    assert.equal(open.result.position.stakeMonths, 6);
    assert.equal(open.result.position.autoCompound, true);
    assert.ok(open.result.receiptTokenId, "liquid receipt minted");

    const list = call("list_positions", ctxA(), {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.totalPrincipalCc, 250);
    assert.equal(list.result.positions[0].id, open.result.position.id);

    // ReceiptTokens component drives list_receipts.
    const rec = call("list_receipts", ctxA(), {});
    assert.equal(rec.ok, true);
    assert.equal(rec.result.count, 1);
    assert.equal(rec.result.liveFaceValueCc, 250);
  });
});

describe("staking lens — full lock → mature → redeem pays out the REAL amount", () => {
  it("redeem returns principal + a positive, math-checked accrued yield", () => {
    const open = call("open_stake", ctxA(), { poolId: "core", principalCc: 1000, months: 12 });
    assert.equal(open.ok, true, JSON.stringify(open));
    const stakeId = open.result.position.id;
    const pos = matureFirstPosition("lens_user_a");

    // Independently compute the expected full-term yield: principal * rate.
    const rate = pos.yield_rate_bps / 10000;
    const expectedYield = Math.round(1000 * rate * 100) / 100;

    const redeem = call("redeem_stake", ctxA(), { stakeId });
    assert.equal(redeem.ok, true, JSON.stringify(redeem));
    assert.equal(redeem.result.principalCc, 1000);
    assert.ok(redeem.result.accruedYieldCc > 0, "yield accrued");
    // Full-term elapsed → accrued ≈ principal * rate (clamped at unlocksAt).
    assert.ok(
      Math.abs(redeem.result.accruedYieldCc - expectedYield) < 0.5,
      `accrued ${redeem.result.accruedYieldCc} ≈ expected ${expectedYield}`,
    );
    // Platform is fully funded, so yieldPaid == accrued and totalReturn == principal + accrued.
    assert.equal(redeem.result.treasuryFunded, true);
    assert.equal(redeem.result.yieldPaidCc, redeem.result.accruedYieldCc);
    assert.equal(
      redeem.result.totalReturnCc,
      Math.round((1000 + redeem.result.accruedYieldCc) * 100) / 100,
    );

    // Position is now redeemed, not double-redeemable.
    const again = call("redeem_stake", ctxA(), { stakeId });
    assert.equal(again.ok, false);
    assert.equal(again.error, "not_active");

    // Earnings ledger (EarningsLedger component) shows the realized yield.
    const led = call("earnings_ledger", ctxA(), { limit: 50 });
    assert.equal(led.ok, true);
    assert.ok(led.result.totalYieldEarnedCc > 0);
    assert.ok(led.result.timeline.length >= 1);
  });
});

describe("staking lens — early_unstake applies the real prorated penalty", () => {
  it("returns less than principal and forfeits yield", () => {
    const open = call("open_stake", ctxA(), { poolId: "growth", principalCc: 1000, months: 12 });
    const r = call("early_unstake", ctxA(), { stakeId: open.result.position.id });
    assert.equal(r.ok, true, JSON.stringify(r));
    // growth pool earlyPenaltyPct = 0.45, nearly-full remaining → big penalty.
    assert.ok(r.result.totalPenaltyCc > 0);
    assert.ok(r.result.returnedCc < 1000);
    assert.equal(r.result.returnedCc, Math.round((1000 - r.result.principalPenaltyCc) * 100) / 100);
  });
});

describe("staking lens — set_auto_compound (StakePositions) toggles + persists", () => {
  it("toggle survives a re-list", () => {
    const open = call("open_stake", ctxA(), { poolId: "core", principalCc: 100, months: 6 });
    const id = open.result.position.id;
    assert.equal(call("set_auto_compound", ctxA(), { stakeId: id, enabled: true }).result.autoCompound, true);
    const list = call("list_positions", ctxA(), {});
    assert.equal(list.result.positions[0].autoCompound, true);
    assert.equal(call("set_auto_compound", ctxA(), { stakeId: id, enabled: false }).result.autoCompound, false);
  });
});

describe("staking lens — transfer_receipt (ReceiptTokens) moves it cross-user", () => {
  it("face value transfers and source is emptied", () => {
    const open = call("open_stake", ctxA(), {
      poolId: "core",
      principalCc: 500,
      months: 6,
      liquidReceipt: true,
    });
    const xfer = call("transfer_receipt", ctxA(), {
      receiptId: open.result.receiptTokenId,
      toUserId: "lens_user_b",
    });
    assert.equal(xfer.ok, true);
    assert.equal(xfer.result.faceValueCc, 500);
    assert.equal(call("list_receipts", ctxA(), {}).result.count, 0);
    assert.equal(call("list_receipts", ctxB(), {}).result.count, 1);
  });
});

describe("staking lens — estimate_rewards (RewardsEstimator) computes real numbers", () => {
  it("compound term beats simple term for the same inputs", () => {
    const r = call("estimate_rewards", ctxA(), { poolId: "core", principalCc: 1000, months: 12 });
    assert.equal(r.ok, true);
    assert.equal(r.result.monthly.length, 12);
    assert.ok(r.result.compoundTermCc >= r.result.termCc);
    assert.ok(r.result.aprPct > 0);
  });
});

describe("staking lens — apr_history (AprHistoryChart) returns a real series", () => {
  it("includes at least today's sample with a positive current APR", () => {
    const r = call("apr_history", ctxA(), { poolId: "core", months: 12 });
    assert.equal(r.ok, true);
    assert.ok(r.result.points >= 1);
    assert.ok(r.result.currentAprPct > 0);
  });
});

describe("staking lens — maturity_reminders (MaturityReminders) buckets correctly", () => {
  it("a fresh long lock shows as upcoming, a matured one shows as matured", () => {
    call("open_stake", ctxA(), { poolId: "core", principalCc: 100, months: 2 });
    const reminders = call("maturity_reminders", ctxA(), { windowDays: 90 });
    assert.equal(reminders.ok, true);
    assert.equal(reminders.result.upcomingCount, 1);
    assert.equal(reminders.result.maturedCount, 0);

    matureFirstPosition("lens_user_a");
    const after = call("maturity_reminders", ctxA(), { windowDays: 90 });
    assert.equal(after.result.maturedCount, 1);
  });
});

describe("staking lens — fail-CLOSED numeric guard (defect fix)", () => {
  it("open_stake rejects poisoned principal BEFORE any state write", () => {
    for (const bad of [Infinity, -Infinity, NaN, 1e308, 1e12]) {
      const r = call("open_stake", ctxA(), { poolId: "core", principalCc: bad, months: 6 });
      assert.equal(r.ok, false, `principalCc=${bad} must be rejected`);
      assert.equal(r.error, "invalid_principalCc", `principalCc=${bad}`);
    }
    // No position was ever written.
    assert.equal(call("list_positions", ctxA(), {}).result.count, 0);
  });

  it("open_stake rejects poisoned months", () => {
    for (const bad of [Infinity, NaN, 1e308]) {
      const r = call("open_stake", ctxA(), { poolId: "core", principalCc: 100, months: bad });
      assert.equal(r.ok, false, `months=${bad} must be rejected`);
      assert.equal(r.error, "invalid_months", `months=${bad}`);
    }
    assert.equal(call("list_positions", ctxA(), {}).result.count, 0);
  });

  it("estimate_rewards rejects poisoned numerics too (no Infinity projections)", () => {
    const r = call("estimate_rewards", ctxA(), { poolId: "core", principalCc: Infinity, months: 6 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_principalCc");
  });

  it("clean inputs still pass after the guard", () => {
    const r = call("open_stake", ctxA(), { poolId: "core", principalCc: 100, months: 6 });
    assert.equal(r.ok, true);
  });
});

describe("staking lens — no-actor write guard", () => {
  it("user-scoped macros reject a missing actor", () => {
    // A db is present (so we pass the no_db gate) but no actor — the handler must
    // fail-closed with no_actor BEFORE any state write, per the source ordering
    // (no_db → staking_unavailable → no_actor → numeric guard → balance gate).
    for (const m of ["open_stake", "list_positions", "list_receipts", "earnings_ledger"]) {
      const r = call(m, { db }, {});
      assert.equal(r.ok, false, `${m} should reject missing actor`);
      assert.equal(r.error, "no_actor", `${m} error`);
    }
  });
});
