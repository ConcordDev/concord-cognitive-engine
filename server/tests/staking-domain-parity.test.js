// Contract tests for server/domains/staking.js — CC staking products.
// Exercises every macro: pools, estimate, open/list/redeem, early-unstake,
// auto-compound, compound-now, earnings ledger, APR history, liquid-staking
// receipt tokens, and maturity reminders.

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
  // Fresh per-user state for each test.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "stake_user_a" }, userId: "stake_user_a" };
const ctxB = { actor: { userId: "stake_user_b" }, userId: "stake_user_b" };

describe("staking.list_pools", () => {
  it("returns multiple risk-reward pools", () => {
    const r = call("list_pools", ctxA, { months: 12 });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 3);
    const ids = r.result.pools.map((p) => p.id);
    assert.ok(ids.includes("flex") && ids.includes("core") && ids.includes("growth"));
    assert.ok(r.result.pools.every((p) => typeof p.previewAprPct === "number"));
  });
});

describe("staking.estimate_rewards", () => {
  it("returns annual/monthly breakdown with a compound bonus", () => {
    const r = call("estimate_rewards", ctxA, {
      poolId: "core",
      principalCc: 1000,
      months: 12,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.principalCc, 1000);
    assert.ok(r.result.annualCc > 0);
    assert.ok(r.result.monthly.length === 12);
    assert.ok(r.result.compoundTermCc >= r.result.termCc);
    assert.ok(r.result.compoundBonusCc >= 0);
  });

  it("rejects below-minimum principal", () => {
    const r = call("estimate_rewards", ctxA, { poolId: "growth", principalCc: 5, months: 6 });
    assert.equal(r.ok, false);
  });
});

describe("staking.open_stake + list_positions", () => {
  it("opens a position and lists it with live accrued yield", () => {
    const open = call("open_stake", ctxA, { poolId: "core", principalCc: 200, months: 6 });
    assert.equal(open.ok, true);
    assert.ok(open.result.position.id);

    const list = call("list_positions", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.totalPrincipalCc, 200);
  });

  it("rejects open below pool minimum", () => {
    const r = call("open_stake", ctxA, { poolId: "growth", principalCc: 10, months: 6 });
    assert.equal(r.ok, false);
  });

  it("mints a liquid receipt when requested", () => {
    const open = call("open_stake", ctxA, {
      poolId: "core",
      principalCc: 300,
      months: 3,
      liquidReceipt: true,
    });
    assert.equal(open.ok, true);
    assert.ok(open.result.receiptTokenId);
  });
});

describe("staking.redeem_stake", () => {
  it("blocks redeem while still locked", () => {
    const open = call("open_stake", ctxA, { poolId: "core", principalCc: 100, months: 6 });
    const r = call("redeem_stake", ctxA, { stakeId: open.result.position.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "still_locked");
  });
});

describe("staking.early_unstake", () => {
  it("exits a locked position with a penalty", () => {
    const open = call("open_stake", ctxA, { poolId: "core", principalCc: 1000, months: 12 });
    const r = call("early_unstake", ctxA, { stakeId: open.result.position.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.totalPenaltyCc > 0);
    assert.ok(r.result.returnedCc < 1000);
  });
});

describe("staking.set_auto_compound", () => {
  it("toggles auto-compound on a position", () => {
    const open = call("open_stake", ctxA, { poolId: "core", principalCc: 100, months: 6 });
    const r = call("set_auto_compound", ctxA, {
      stakeId: open.result.position.id,
      enabled: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.autoCompound, true);
  });
});

describe("staking.compound_now", () => {
  it("blocks compound while still locked", () => {
    const open = call("open_stake", ctxA, { poolId: "core", principalCc: 100, months: 6 });
    const r = call("compound_now", ctxA, { stakeId: open.result.position.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "still_locked");
  });
});

describe("staking.earnings_ledger", () => {
  it("returns a ledger with totals and a timeline after activity", () => {
    call("open_stake", ctxA, { poolId: "core", principalCc: 100, months: 6 });
    call("open_stake", ctxA, { poolId: "core", principalCc: 200, months: 6 });
    const r = call("earnings_ledger", ctxA, { limit: 50 });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 2);
    assert.ok(Array.isArray(r.result.timeline));
    assert.equal(typeof r.result.totalYieldEarnedCc, "number");
    assert.equal(typeof r.result.totalPenaltiesCc, "number");
  });
});

describe("staking.apr_history", () => {
  it("returns an APR series for a pool", () => {
    call("list_pools", ctxA, { months: 12 });
    const r = call("apr_history", ctxA, { poolId: "core", months: 12 });
    assert.equal(r.ok, true);
    assert.ok(r.result.points >= 1);
    assert.ok(r.result.currentAprPct > 0);
  });

  it("rejects an unknown pool", () => {
    const r = call("apr_history", ctxA, { poolId: "nope" });
    assert.equal(r.ok, false);
  });
});

describe("staking.list_receipts + transfer_receipt", () => {
  it("lists liquid receipts and transfers one to another user", () => {
    const open = call("open_stake", ctxA, {
      poolId: "core",
      principalCc: 500,
      months: 6,
      liquidReceipt: true,
    });
    const receiptId = open.result.receiptTokenId;
    assert.ok(receiptId);

    const list = call("list_receipts", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);

    const xfer = call("transfer_receipt", ctxA, {
      receiptId,
      toUserId: "stake_user_b",
    });
    assert.equal(xfer.ok, true);

    const after = call("list_receipts", ctxA, {});
    assert.equal(after.result.count, 0);
    const recv = call("list_receipts", ctxB, {});
    assert.equal(recv.result.count, 1);
  });

  it("rejects a self-transfer", () => {
    const open = call("open_stake", ctxA, {
      poolId: "core",
      principalCc: 500,
      months: 6,
      liquidReceipt: true,
    });
    const r = call("transfer_receipt", ctxA, {
      receiptId: open.result.receiptTokenId,
      toUserId: "stake_user_a",
    });
    assert.equal(r.ok, false);
  });
});

describe("staking.maturity_reminders", () => {
  it("returns matured + upcoming counts for the user's positions", () => {
    call("open_stake", ctxA, { poolId: "core", principalCc: 100, months: 1 });
    const r = call("maturity_reminders", ctxA, { windowDays: 60 });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.maturedCount, "number");
    assert.equal(typeof r.result.upcomingCount, "number");
  });
});

describe("staking — no-actor guard", () => {
  it("rejects user-scoped macros with no actor", () => {
    for (const m of ["open_stake", "list_positions", "earnings_ledger", "maturity_reminders"]) {
      const r = call(m, {}, {});
      assert.equal(r.ok, false, `${m} should reject missing actor`);
    }
  });
});
