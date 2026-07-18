/**
 * Staking conservation — the "no money from nothing" guard for the staking lens.
 *
 * Before the 2026-07 rewrite, staking moved NO real CC: open_stake "locked" a
 * principal that was never debited, redeem "returned" principal+yield that was
 * never credited, and all state lived in globalThis Maps (gone on restart).
 *
 * This test pins the real-money contract:
 *  - open escrows the principal (user → staking_escrow), balance-gated;
 *  - redeem returns principal (escrow → user) + treasury-funded yield
 *    (__PLATFORM__ → user), yield capped by the platform wallet's real balance;
 *  - across every operation the SUM of all account balances is invariant
 *    (internal transfers — nothing minted);
 *  - a position survives a "restart" (in-memory state cleared) because it is
 *    persisted; escrowed principal is never stranded;
 *  - an underfunded platform pays only the affordable yield + reports the
 *    shortfall (never a fabricated payout, never a negative platform balance).
 *
 * Run: node --test server/tests/economy/staking-conservation.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { getBalance } from "../../economy/balances.js";
import { executePurchase } from "../../economy/transfer.js";
import { recordTransaction } from "../../economy/ledger.js";
import { PLATFORM_ACCOUNT_ID } from "../../economy/fees.js";
import { up as stakingUp } from "../../migrations/371_staking_positions.js";
import registerStakingActions from "../../domains/staking.js";

const ESCROW = "staking_escrow";
const r2 = (n) => Math.round(n * 100) / 100;

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

// Seed the platform (fee) wallet — the real yield source — with a credit row.
function fundPlatform(db, amount) {
  recordTransaction(db, { type: "FEE_ACCRUAL", from: null, to: PLATFORM_ACCOUNT_ID, amount, net: amount, fee: 0, status: "complete" });
}

// Sum of balances across every account that appears in the ledger. Internal
// transfers must leave this invariant.
function totalSystemCc(db, accounts) {
  return r2(accounts.reduce((s, a) => s + getBalance(db, a).balance, 0));
}

function makeStaking() {
  const actions = new Map();
  registerStakingActions((_domain, name, fn) => actions.set(name, fn));
  return (name, ctx, params = {}) => actions.get(name)(ctx, null, params);
}

describe("staking conservation (real CC, no minting)", () => {
  let db, run;
  const USER = "staker1";
  const ACCTS = [USER, ESCROW, PLATFORM_ACCOUNT_ID, "other"];

  beforeEach(() => {
    db = createDb();
    run = makeStaking();
    executePurchase(db, { userId: USER, amount: 100000 }); // give the staker a real wallet
    fundPlatform(db, 5000);                                 // fee wallet funds yield
  });
  afterEach(() => { delete globalThis._concordSTATE; });

  it("open_stake escrows the principal — user -P, escrow +P, system total invariant", () => {
    const ctx = { db, actor: { userId: USER } };
    const beforeUser = getBalance(db, USER).balance;
    const beforeEscrow = getBalance(db, ESCROW).balance;
    const totalBefore = totalSystemCc(db, ACCTS);

    const res = run("open_stake", ctx, { poolId: "core", principalCc: 1000, months: 6 });
    assert.equal(res.ok, true, JSON.stringify(res));

    assert.equal(r2(getBalance(db, USER).balance - beforeUser), -1000);   // real debit
    assert.equal(r2(getBalance(db, ESCROW).balance - beforeEscrow), 1000); // real escrow
    assert.equal(totalSystemCc(db, ACCTS), totalBefore);                   // nothing minted
  });

  it("rejects staking more CC than the wallet holds (no ledger rows written)", () => {
    const ctx = { db, actor: { userId: USER } };
    const rowsBefore = db.prepare("SELECT COUNT(*) n FROM economy_ledger").get().n;
    const res = run("open_stake", ctx, { poolId: "core", principalCc: 999999999, months: 6 });
    assert.equal(res.ok, false);
    assert.equal(res.error, "insufficient_balance");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM economy_ledger").get().n, rowsBefore);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM staking_positions").get().n, 0);
  });

  it("redeem returns principal + treasury-funded yield; user gain == escrow+platform loss", () => {
    const ctx = { db, actor: { userId: USER } };
    const open = run("open_stake", ctx, { poolId: "core", principalCc: 1000, months: 6 });
    const stakeId = open.result.position.id;
    // Mature it with real elapsed time: 6 months locked, now past unlock.
    const now = Math.floor(Date.now() / 1000);
    const lockedAt = now - 200 * 86400;
    const unlocksAt = now - 1;
    db.prepare("UPDATE staking_positions SET locked_at=?, unlocks_at=? WHERE id=?").run(lockedAt, unlocksAt, stakeId);
    const bps = db.prepare("SELECT yield_rate_bps FROM staking_positions WHERE id=?").get(stakeId).yield_rate_bps;
    const elapsed = unlocksAt - lockedAt;
    const expectedYield = r2(1000 * (bps / 10000) * (elapsed / (365 * 86400)));

    const totalBefore = totalSystemCc(db, ACCTS);
    const uBefore = getBalance(db, USER).balance;
    const pBefore = getBalance(db, PLATFORM_ACCOUNT_ID).balance;
    const eBefore = getBalance(db, ESCROW).balance;

    const res = run("redeem_stake", ctx, { stakeId });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.result.accruedYieldCc, expectedYield);
    assert.equal(res.result.yieldPaidCc, expectedYield);       // platform can afford it
    assert.equal(res.result.treasuryFunded, true);

    assert.equal(r2(getBalance(db, USER).balance - uBefore), r2(1000 + expectedYield));  // principal + yield
    assert.equal(r2(getBalance(db, PLATFORM_ACCOUNT_ID).balance - pBefore), -expectedYield); // platform funded it
    assert.equal(r2(getBalance(db, ESCROW).balance - eBefore), -1000);                    // escrow released principal
    assert.equal(totalSystemCc(db, ACCTS), totalBefore);        // yield was MOVED, not minted
  });

  it("survives a restart: position persists, escrowed principal is redeemable", () => {
    const uStart = getBalance(db, USER).balance; // real starting balance (post token-purchase fee)
    const open = run("open_stake", { db, actor: { userId: USER } }, { poolId: "core", principalCc: 1000, months: 6 });
    const stakeId = open.result.position.id;
    const now = Math.floor(Date.now() / 1000);
    db.prepare("UPDATE staking_positions SET locked_at=?, unlocks_at=? WHERE id=?").run(now - 200 * 86400, now - 1, stakeId);

    // Simulate a restart: drop ALL in-memory state + rebuild the handler set.
    delete globalThis._concordSTATE;
    const run2 = makeStaking();

    const res = run2("redeem_stake", { db, actor: { userId: USER } }, { stakeId });
    assert.equal(res.ok, true, "position must be readable from the DB after restart");
    assert.equal(res.result.principalCc, 1000);
    // The escrowed principal came back — never stranded. Final = start + yield
    // (open −1000 then redeem +1000 principal + yield), so >= start.
    assert.ok(getBalance(db, USER).balance >= uStart - 0.01, "principal returned to the wallet");
  });

  it("underfunded platform pays only affordable yield + reports the shortfall (never negative, never minted)", () => {
    const ctx = { db, actor: { userId: USER } };
    // Drain the platform wallet down to a token amount so it cannot fully fund yield.
    const pBal = getBalance(db, PLATFORM_ACCOUNT_ID).balance;
    recordTransaction(db, { type: "FEE_ACCRUAL", from: PLATFORM_ACCOUNT_ID, to: "sink", amount: pBal - 2, net: pBal - 2, fee: 0, status: "complete" });
    assert.equal(getBalance(db, PLATFORM_ACCOUNT_ID).balance, 2);

    const open = run("open_stake", ctx, { poolId: "growth", principalCc: 5000, months: 24 });
    const stakeId = open.result.position.id;
    const now = Math.floor(Date.now() / 1000);
    db.prepare("UPDATE staking_positions SET locked_at=?, unlocks_at=? WHERE id=?").run(now - 700 * 86400, now - 1, stakeId);

    const totalBefore = totalSystemCc(db, [USER, ESCROW, PLATFORM_ACCOUNT_ID, "sink", "other"]);
    const res = run("redeem_stake", ctx, { stakeId });
    assert.equal(res.ok, true);
    assert.ok(res.result.accruedYieldCc > 2, "the accrued yield exceeds what the platform can fund");
    assert.equal(res.result.yieldPaidCc, 2, "only the affordable 2 CC is paid");
    assert.ok(res.result.yieldShortfallCc > 0);
    assert.equal(res.result.treasuryFunded, false);
    assert.equal(getBalance(db, PLATFORM_ACCOUNT_ID).balance, 0, "platform funded exactly what it had — not negative");
    assert.equal(totalSystemCc(db, [USER, ESCROW, PLATFORM_ACCOUNT_ID, "sink", "other"]), totalBefore); // conserved
  });

  it("early_unstake returns principal minus penalty; penalty goes to platform, total invariant", () => {
    const ctx = { db, actor: { userId: USER } };
    const open = run("open_stake", ctx, { poolId: "core", principalCc: 1000, months: 6 });
    const stakeId = open.result.position.id;
    const totalBefore = totalSystemCc(db, ACCTS);
    const pBefore = getBalance(db, PLATFORM_ACCOUNT_ID).balance;
    const uBefore = getBalance(db, USER).balance;
    const eBefore = getBalance(db, ESCROW).balance;

    const res = run("early_unstake", ctx, { stakeId });
    assert.equal(res.ok, true, JSON.stringify(res));
    const penalty = res.result.principalPenaltyCc;
    const returned = res.result.returnedCc;
    assert.equal(r2(returned + penalty), 1000);                                  // principal fully accounted
    assert.equal(r2(getBalance(db, USER).balance - uBefore), returned);          // user got principal - penalty
    assert.equal(r2(getBalance(db, PLATFORM_ACCOUNT_ID).balance - pBefore), penalty); // penalty to platform
    assert.equal(r2(getBalance(db, ESCROW).balance - eBefore), -1000);           // escrow fully released
    assert.equal(totalSystemCc(db, ACCTS), totalBefore);                         // conserved
  });
});
