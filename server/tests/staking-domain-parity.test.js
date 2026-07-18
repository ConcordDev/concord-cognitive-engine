// Contract tests for server/domains/staking.js — CC staking products.
// Exercises every macro: pools, estimate, open/list/redeem, early-unstake,
// auto-compound, compound-now, earnings ledger, APR history, liquid-staking
// receipt tokens, and maturity reminders.
//
// MONEY IS REAL (2026-07 rewrite): positions/receipts persist in
// staking_positions/staking_receipts (migration 371) and every principal/yield
// movement is a real economy_ledger row. This harness builds a real in-memory
// DB, funds the staker's wallet (executePurchase) + the platform fee wallet
// (the yield source), and passes ctx={db,actor}.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

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

function fundPlatform(db, amount) {
  recordTransaction(db, { type: "FEE_ACCRUAL", from: null, to: PLATFORM_ACCOUNT_ID, amount, net: amount, fee: 0, status: "complete" });
}

let db;
beforeEach(() => {
  db = createDb();
  executePurchase(db, { userId: "stake_user_a", amount: 100000 }); // real wallet
  fundPlatform(db, 100000);                                        // yield source
  globalThis._concordSTATE = {};
});
afterEach(() => { try { db.close(); } catch { /* already closed */ } delete globalThis._concordSTATE; });

const ctxA = () => ({ db, actor: { userId: "stake_user_a" }, userId: "stake_user_a" });
const ctxB = () => ({ db, actor: { userId: "stake_user_b" }, userId: "stake_user_b" });

describe("staking.list_pools", () => {
  it("returns multiple risk-reward pools", () => {
    const r = call("list_pools", ctxA(), { months: 12 });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 3);
    const ids = r.result.pools.map((p) => p.id);
    assert.ok(ids.includes("flex") && ids.includes("core") && ids.includes("growth"));
    assert.ok(r.result.pools.every((p) => typeof p.previewAprPct === "number"));
  });
});

describe("staking.estimate_rewards", () => {
  it("returns annual/monthly breakdown with a compound bonus", () => {
    const r = call("estimate_rewards", ctxA(), {
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
    const r = call("estimate_rewards", ctxA(), { poolId: "growth", principalCc: 5, months: 6 });
    assert.equal(r.ok, false);
  });
});

describe("staking.open_stake + list_positions", () => {
  it("opens a position and lists it with live accrued yield", () => {
    const open = call("open_stake", ctxA(), { poolId: "core", principalCc: 200, months: 6 });
    assert.equal(open.ok, true, JSON.stringify(open));
    assert.ok(open.result.position.id);

    const list = call("list_positions", ctxA(), {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.totalPrincipalCc, 200);
  });

  it("rejects open below pool minimum", () => {
    const r = call("open_stake", ctxA(), { poolId: "growth", principalCc: 10, months: 6 });
    assert.equal(r.ok, false);
  });

  it("mints a liquid receipt when requested", () => {
    const open = call("open_stake", ctxA(), {
      poolId: "core",
      principalCc: 300,
      months: 3,
      liquidReceipt: true,
    });
    assert.equal(open.ok, true, JSON.stringify(open));
    assert.ok(open.result.receiptTokenId);
  });
});

describe("staking.redeem_stake", () => {
  it("blocks redeem while still locked", () => {
    const open = call("open_stake", ctxA(), { poolId: "core", principalCc: 100, months: 6 });
    const r = call("redeem_stake", ctxA(), { stakeId: open.result.position.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "still_locked");
  });
});

describe("staking.early_unstake", () => {
  it("exits a locked position with a penalty", () => {
    const open = call("open_stake", ctxA(), { poolId: "core", principalCc: 1000, months: 12 });
    const r = call("early_unstake", ctxA(), { stakeId: open.result.position.id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.result.totalPenaltyCc > 0);
    assert.ok(r.result.returnedCc < 1000);
  });
});

describe("staking.set_auto_compound", () => {
  it("toggles auto-compound on a position", () => {
    const open = call("open_stake", ctxA(), { poolId: "core", principalCc: 100, months: 6 });
    const r = call("set_auto_compound", ctxA(), {
      stakeId: open.result.position.id,
      enabled: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.autoCompound, true);
  });
});

describe("staking.compound_now", () => {
  it("blocks compound while still locked", () => {
    const open = call("open_stake", ctxA(), { poolId: "core", principalCc: 100, months: 6 });
    const r = call("compound_now", ctxA(), { stakeId: open.result.position.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "still_locked");
  });
});

describe("staking.earnings_ledger", () => {
  it("returns a ledger with totals and a timeline after activity", () => {
    call("open_stake", ctxA(), { poolId: "core", principalCc: 100, months: 6 });
    call("open_stake", ctxA(), { poolId: "core", principalCc: 200, months: 6 });
    const r = call("earnings_ledger", ctxA(), { limit: 50 });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 2);
    assert.ok(Array.isArray(r.result.timeline));
    assert.equal(typeof r.result.totalYieldEarnedCc, "number");
    assert.equal(typeof r.result.totalPenaltiesCc, "number");
  });
});

describe("staking.apr_history", () => {
  it("returns an APR series for a pool", () => {
    call("list_pools", ctxA(), { months: 12 });
    const r = call("apr_history", ctxA(), { poolId: "core", months: 12 });
    assert.equal(r.ok, true);
    assert.ok(r.result.points >= 1);
    assert.ok(r.result.currentAprPct > 0);
  });

  it("rejects an unknown pool", () => {
    const r = call("apr_history", ctxA(), { poolId: "nope" });
    assert.equal(r.ok, false);
  });
});

describe("staking.list_receipts + transfer_receipt", () => {
  it("lists liquid receipts and transfers one to another user", () => {
    const open = call("open_stake", ctxA(), {
      poolId: "core",
      principalCc: 500,
      months: 6,
      liquidReceipt: true,
    });
    const receiptId = open.result.receiptTokenId;
    assert.ok(receiptId);

    const list = call("list_receipts", ctxA(), {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);

    const xfer = call("transfer_receipt", ctxA(), {
      receiptId,
      toUserId: "stake_user_b",
    });
    assert.equal(xfer.ok, true);

    const after = call("list_receipts", ctxA(), {});
    assert.equal(after.result.count, 0);
    const recv = call("list_receipts", ctxB(), {});
    assert.equal(recv.result.count, 1);
  });

  it("rejects a self-transfer", () => {
    const open = call("open_stake", ctxA(), {
      poolId: "core",
      principalCc: 500,
      months: 6,
      liquidReceipt: true,
    });
    const r = call("transfer_receipt", ctxA(), {
      receiptId: open.result.receiptTokenId,
      toUserId: "stake_user_a",
    });
    assert.equal(r.ok, false);
  });
});

describe("staking.maturity_reminders", () => {
  it("returns matured + upcoming counts for the user's positions", () => {
    call("open_stake", ctxA(), { poolId: "core", principalCc: 100, months: 1 });
    const r = call("maturity_reminders", ctxA(), { windowDays: 60 });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.maturedCount, "number");
    assert.equal(typeof r.result.upcomingCount, "number");
  });
});

describe("staking — no-actor guard", () => {
  it("rejects user-scoped macros with no actor", () => {
    // A db is present (passes the no_db gate) but no actor — each user-scoped
    // handler must fail-closed with no_actor before any state write.
    for (const m of ["open_stake", "list_positions", "earnings_ledger", "maturity_reminders"]) {
      const r = call(m, { db }, {});
      assert.equal(r.ok, false, `${m} should reject missing actor`);
      assert.equal(r.error, "no_actor", `${m} error`);
    }
  });
});
