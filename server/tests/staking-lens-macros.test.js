// server/tests/staking-lens-macros.test.js
// Phase-2 behavioral test for the macros the /lenses/staking page + its
// components actually drive: open_stake, list_positions, estimate_rewards,
// apr_history, earnings_ledger, list_receipts, transfer_receipt,
// set_auto_compound, maturity_reminders — plus the full lock → mature →
// redeem/compound payout round-trip with ACTUAL value assertions, and the
// fail-CLOSED numeric guard (poisoned NaN/Infinity/1e308/negative are
// rejected BEFORE any state write).
//
// Lightweight + hermetic: local register harness, no server boot, no DB, no
// network/LLM. Staking persists in globalThis._concordSTATE Maps, so a fresh
// {} per test isolates users. Time-travel is done by mutating a position's
// lockedAt/unlocksAt to simulate maturity without waiting.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
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

beforeEach(() => {
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "lens_user_a" }, userId: "lens_user_a" };
const ctxB = { actor: { userId: "lens_user_b" }, userId: "lens_user_b" };

// Reach into in-memory state to backdate a position to maturity.
function matureFirstPosition(userId) {
  const pos = globalThis._concordSTATE.stakingPositions.get(userId)[0];
  const span = pos.unlocksAt - pos.lockedAt;
  pos.lockedAt -= span; // shift the whole lock window into the past
  pos.unlocksAt -= span;
  return pos;
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
    const open = call("open_stake", ctxA, {
      poolId: "core",
      principalCc: 250,
      months: 6,
      autoCompound: true,
      liquidReceipt: true,
    });
    assert.equal(open.ok, true);
    assert.equal(open.result.position.principalCc, 250);
    assert.equal(open.result.position.stakeMonths, 6);
    assert.equal(open.result.position.autoCompound, true);
    assert.ok(open.result.receiptTokenId, "liquid receipt minted");

    const list = call("list_positions", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.totalPrincipalCc, 250);
    assert.equal(list.result.positions[0].id, open.result.position.id);

    // ReceiptTokens component drives list_receipts.
    const rec = call("list_receipts", ctxA, {});
    assert.equal(rec.ok, true);
    assert.equal(rec.result.count, 1);
    assert.equal(rec.result.liveFaceValueCc, 250);
  });
});

describe("staking lens — full lock → mature → redeem pays out the REAL amount", () => {
  it("redeem returns principal + a positive, math-checked accrued yield", () => {
    const open = call("open_stake", ctxA, { poolId: "core", principalCc: 1000, months: 12 });
    assert.equal(open.ok, true);
    const stakeId = open.result.position.id;
    const pos = matureFirstPosition(ctxA.userId);

    // Independently compute the expected full-term yield: principal * rate.
    const rate = pos.yieldRateBps / 10000;
    const expectedYield = Math.round(1000 * rate * 100) / 100;

    const redeem = call("redeem_stake", ctxA, { stakeId });
    assert.equal(redeem.ok, true);
    assert.equal(redeem.result.principalCc, 1000);
    assert.ok(redeem.result.accruedYieldCc > 0, "yield accrued");
    // Full-term elapsed → accrued ≈ principal * rate (clamped at unlocksAt).
    assert.ok(
      Math.abs(redeem.result.accruedYieldCc - expectedYield) < 0.5,
      `accrued ${redeem.result.accruedYieldCc} ≈ expected ${expectedYield}`,
    );
    assert.equal(
      redeem.result.totalReturnCc,
      Math.round((1000 + redeem.result.accruedYieldCc) * 100) / 100,
    );

    // Position is now redeemed, not double-redeemable.
    const again = call("redeem_stake", ctxA, { stakeId });
    assert.equal(again.ok, false);
    assert.equal(again.error, "not_active");

    // Earnings ledger (EarningsLedger component) shows the realized yield.
    const led = call("earnings_ledger", ctxA, { limit: 50 });
    assert.equal(led.ok, true);
    assert.ok(led.result.totalYieldEarnedCc > 0);
    assert.ok(led.result.timeline.length >= 1);
  });
});

describe("staking lens — early_unstake applies the real prorated penalty", () => {
  it("returns less than principal and forfeits yield", () => {
    const open = call("open_stake", ctxA, { poolId: "growth", principalCc: 1000, months: 12 });
    const r = call("early_unstake", ctxA, { stakeId: open.result.position.id });
    assert.equal(r.ok, true);
    // growth pool earlyPenaltyPct = 0.45, nearly-full remaining → big penalty.
    assert.ok(r.result.totalPenaltyCc > 0);
    assert.ok(r.result.returnedCc < 1000);
    assert.equal(r.result.returnedCc, Math.round((1000 - r.result.principalPenaltyCc) * 100) / 100);
  });
});

describe("staking lens — set_auto_compound (StakePositions) toggles + persists", () => {
  it("toggle survives a re-list", () => {
    const open = call("open_stake", ctxA, { poolId: "core", principalCc: 100, months: 6 });
    const id = open.result.position.id;
    assert.equal(call("set_auto_compound", ctxA, { stakeId: id, enabled: true }).result.autoCompound, true);
    const list = call("list_positions", ctxA, {});
    assert.equal(list.result.positions[0].autoCompound, true);
    assert.equal(call("set_auto_compound", ctxA, { stakeId: id, enabled: false }).result.autoCompound, false);
  });
});

describe("staking lens — transfer_receipt (ReceiptTokens) moves it cross-user", () => {
  it("face value transfers and source is emptied", () => {
    const open = call("open_stake", ctxA, {
      poolId: "core",
      principalCc: 500,
      months: 6,
      liquidReceipt: true,
    });
    const xfer = call("transfer_receipt", ctxA, {
      receiptId: open.result.receiptTokenId,
      toUserId: ctxB.userId,
    });
    assert.equal(xfer.ok, true);
    assert.equal(xfer.result.faceValueCc, 500);
    assert.equal(call("list_receipts", ctxA, {}).result.count, 0);
    assert.equal(call("list_receipts", ctxB, {}).result.count, 1);
  });
});

describe("staking lens — estimate_rewards (RewardsEstimator) computes real numbers", () => {
  it("compound term beats simple term for the same inputs", () => {
    const r = call("estimate_rewards", ctxA, { poolId: "core", principalCc: 1000, months: 12 });
    assert.equal(r.ok, true);
    assert.equal(r.result.monthly.length, 12);
    assert.ok(r.result.compoundTermCc >= r.result.termCc);
    assert.ok(r.result.aprPct > 0);
  });
});

describe("staking lens — apr_history (AprHistoryChart) returns a real series", () => {
  it("includes at least today's sample with a positive current APR", () => {
    const r = call("apr_history", ctxA, { poolId: "core", months: 12 });
    assert.equal(r.ok, true);
    assert.ok(r.result.points >= 1);
    assert.ok(r.result.currentAprPct > 0);
  });
});

describe("staking lens — maturity_reminders (MaturityReminders) buckets correctly", () => {
  it("a fresh long lock shows as upcoming, a matured one shows as matured", () => {
    call("open_stake", ctxA, { poolId: "core", principalCc: 100, months: 2 });
    const reminders = call("maturity_reminders", ctxA, { windowDays: 90 });
    assert.equal(reminders.ok, true);
    assert.equal(reminders.result.upcomingCount, 1);
    assert.equal(reminders.result.maturedCount, 0);

    matureFirstPosition(ctxA.userId);
    const after = call("maturity_reminders", ctxA, { windowDays: 90 });
    assert.equal(after.result.maturedCount, 1);
  });
});

describe("staking lens — fail-CLOSED numeric guard (defect fix)", () => {
  it("open_stake rejects poisoned principal BEFORE any state write", () => {
    for (const bad of [Infinity, -Infinity, NaN, 1e308, 1e12]) {
      const r = call("open_stake", ctxA, { poolId: "core", principalCc: bad, months: 6 });
      assert.equal(r.ok, false, `principalCc=${bad} must be rejected`);
      assert.equal(r.error, "invalid_principalCc", `principalCc=${bad}`);
    }
    // No position was ever written.
    assert.equal(call("list_positions", ctxA, {}).result.count, 0);
  });

  it("open_stake rejects poisoned months", () => {
    for (const bad of [Infinity, NaN, 1e308]) {
      const r = call("open_stake", ctxA, { poolId: "core", principalCc: 100, months: bad });
      assert.equal(r.ok, false, `months=${bad} must be rejected`);
      assert.equal(r.error, "invalid_months", `months=${bad}`);
    }
    assert.equal(call("list_positions", ctxA, {}).result.count, 0);
  });

  it("estimate_rewards rejects poisoned numerics too (no Infinity projections)", () => {
    const r = call("estimate_rewards", ctxA, { poolId: "core", principalCc: Infinity, months: 6 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_principalCc");
  });

  it("clean inputs still pass after the guard", () => {
    const r = call("open_stake", ctxA, { poolId: "core", principalCc: 100, months: 6 });
    assert.equal(r.ok, true);
  });
});

describe("staking lens — no-actor write guard", () => {
  it("user-scoped macros reject a missing actor", () => {
    for (const m of ["open_stake", "list_positions", "list_receipts", "earnings_ledger"]) {
      assert.equal(call(m, {}, {}).ok, false, `${m} should reject missing actor`);
    }
  });
});
