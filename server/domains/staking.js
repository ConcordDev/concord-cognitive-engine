// server/domains/staking.js
// Staking lens — CC staking products: pools, positions, auto-compound,
// early-unstake with penalty, earnings ledger, APR history, liquid-staking
// receipt tokens, and maturity reminders.
//
// MONEY IS REAL. Positions persist in `staking_positions` / `staking_receipts`
// (migration 371) and every principal/yield movement is a real double-entry
// row in `economy_ledger`:
//   - open_stake     : principal escrowed  user → staking_escrow   (STAKE_ESCROW)
//   - redeem_stake   : principal returned  staking_escrow → user   (STAKE_RETURN)
//                      + yield paid         __PLATFORM__ → user      (STAKE_YIELD)
//   - early_unstake  : principal-penalty   staking_escrow → user   (STAKE_RETURN)
//                      + penalty            staking_escrow → __PLATFORM__ (STAKE_PENALTY)
//   - compound_now   : yield               __PLATFORM__ → staking_escrow (STAKE_YIELD)
//
// Yield is funded from the platform fee wallet (__PLATFORM__), which accrues the
// treasury share of marketplace fees — so APR is honestly variable AND
// conservation holds: NO CC is minted. When the fee wallet cannot fully fund a
// yield, only the affordable portion is paid and the shortfall is reported —
// never fabricated. A position's escrowed principal is durably recorded, so a
// restart never strands CC in escrow with no position to redeem it.
//
// This replaces the pre-2026-07 implementation, which kept all state in
// globalThis Maps and moved NO real CC (open "locked" an undebited principal;
// redeem "returned" principal+yield that was never credited).
//
// Handlers never throw — every path is wrapped in try/catch and returns
// { ok: boolean, result?, error? }.

import { randomUUID } from "crypto";
import { getBalance } from "../economy/balances.js";
import { recordTransaction } from "../economy/ledger.js";
import { PLATFORM_ACCOUNT_ID } from "../economy/fees.js";

const DAY = 86400;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

// The account that holds escrowed principal while a position is locked. Not a
// user — a ledger account, exactly like PLATFORM_ACCOUNT_ID.
const STAKING_ESCROW_ID = "staking_escrow";

// ── Staking pools (products) ──────────────────────────────────────────────
const POOLS = [
  { id: "flex", name: "Flex Pool", risk: "low", baseBps: 60, perMonth: 8, capBps: 400, minStake: 10, earlyPenaltyPct: 0.10, description: "Conservative pool. Lower yield, smallest early-exit penalty." },
  { id: "core", name: "Core Pool", risk: "medium", baseBps: 100, perMonth: 20, capBps: 1200, minStake: 25, earlyPenaltyPct: 0.25, description: "Balanced pool. The classic lock-earn-redeem product." },
  { id: "growth", name: "Growth Pool", risk: "high", baseBps: 160, perMonth: 32, capBps: 2000, minStake: 100, earlyPenaltyPct: 0.45, description: "Aggressive pool. Highest yield, steepest early-exit penalty." },
];

function poolById(id) {
  return POOLS.find((p) => p.id === id) || null;
}

function aprBpsFor(pool, months) {
  return Math.min(pool.capBps, pool.baseBps + months * pool.perMonth);
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function uid(prefix) {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

// APR history is sampled lazily in-memory — one point per pool per day it is
// queried. Cosmetic (drives the variable-rate chart); not money, not restart-
// critical, so it stays in process memory by design.
function aprState() {
  const g = globalThis;
  if (!g._concordSTATE) g._concordSTATE = {};
  const S = g._concordSTATE;
  if (!S.stakingAprHistory) S.stakingAprHistory = new Map();
  return S.stakingAprHistory;
}

function recordAprSample(poolId, bps, now) {
  const hist = aprState();
  if (!hist.has(poolId)) hist.set(poolId, []);
  const series = hist.get(poolId);
  const dayKey = Math.floor(now / DAY);
  const last = series[series.length - 1];
  if (last && Math.floor(last.t / DAY) === dayKey) {
    last.bps = bps;
  } else {
    series.push({ t: now, bps });
    if (series.length > 365) series.shift();
  }
}

// Fail-CLOSED numeric guard. Rejects poisoned NaN/Infinity/1e308/negative
// BEFORE any state write. Returns the offending key name, or null when clean.
function badNumericField(params, keys) {
  for (const k of keys) {
    if (params[k] === undefined || params[k] === null || params[k] === "") continue;
    const n = Number(params[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) return k;
  }
  return null;
}

// Accrued yield is computed live from elapsed time — always fresh without a
// heartbeat. APR is per-second prorated, capped at the lock end.
function accruedYieldRow(row, now) {
  const elapsed = Math.max(0, Math.min(now, row.unlocks_at) - row.locked_at);
  const rate = row.yield_rate_bps / 10000;
  return round2(row.principal_cc * rate * (elapsed / YEAR));
}

// ── DB helpers ────────────────────────────────────────────────────────────
function hasStakingTables(db) {
  try {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='staking_positions'").get();
  } catch { return false; }
}

// Move CC as a single double-entry ledger row. type is NEVER 'TRANSFER'/
// 'MARKETPLACE_PURCHASE' (those use the two-row pattern excluded by
// CREDIT_ROW_PREDICATE); a plain both-sided row credits `to` and debits `from`
// by `amount`, conserving. fee=0 always here.
function moveCC(db, { type, from, to, amount, refId, meta }) {
  recordTransaction(db, {
    type, from, to, amount, net: amount, fee: 0, status: "complete",
    refId, metadata: meta || {},
  });
}

function publicPositionRow(row, now) {
  const accrued = row.status === "active" ? accruedYieldRow(row, now) : row.final_yield_cc;
  return {
    id: row.id,
    poolId: row.pool_id,
    poolName: row.pool_name,
    principalCc: row.principal_cc,
    stakeMonths: row.stake_months,
    lockedAt: row.locked_at,
    unlocksAt: row.unlocks_at,
    yieldRateBps: row.yield_rate_bps,
    accruedYieldCc: accrued,
    autoCompound: !!row.auto_compound,
    status: row.status,
    receiptTokenId: row.receipt_token_id || null,
    compoundCount: row.compound_count || 0,
    unlocked: now >= row.unlocks_at,
  };
}

export default function registerStakingActions(registerLensAction) {
  // ── list_pools ──────────────────────────────────────────────────────────
  registerLensAction("staking", "list_pools", (ctx, artifact, params = {}) => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const previewMonths = Math.max(1, Math.min(60, Math.floor(Number(params.months) || 12)));
      const pools = POOLS.map((p) => {
        const bps = aprBpsFor(p, previewMonths);
        recordAprSample(p.id, bps, now);
        return {
          id: p.id, name: p.name, risk: p.risk, description: p.description,
          minStake: p.minStake, baseAprPct: round2(p.baseBps / 100), capAprPct: round2(p.capBps / 100),
          earlyPenaltyPct: p.earlyPenaltyPct, previewMonths, previewAprPct: round2(bps / 100), perMonthBps: p.perMonth,
        };
      });
      return { ok: true, result: { pools, count: pools.length } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Staking pools / products at low/medium/high risk-reward tiers." });

  // ── estimate_rewards ──────────────────────────────────────────────────────
  registerLensAction("staking", "estimate_rewards", (ctx, artifact, params = {}) => {
    try {
      const bad = badNumericField(params, ["principalCc", "months"]);
      if (bad) return { ok: false, error: `invalid_${bad}` };
      const poolId = String(params.poolId || "core");
      const pool = poolById(poolId);
      if (!pool) return { ok: false, error: "unknown_pool" };
      const principal = Math.max(0, Math.floor(Number(params.principalCc) || 0));
      const months = Math.max(1, Math.min(60, Math.floor(Number(params.months) || 12)));
      if (principal < pool.minStake) return { ok: false, error: `min_stake_${pool.minStake}_cc` };
      const bps = aprBpsFor(pool, months);
      const aprPct = bps / 100;
      const rate = bps / 10000;
      const monthlyCc = round2(principal * rate / 12);
      const annualCc = round2(principal * rate);
      const termCc = round2(principal * rate * (months / 12));
      let bal = principal;
      for (let i = 0; i < months; i++) bal += bal * (rate / 12);
      const compoundTermCc = round2(bal - principal);
      const monthly = [];
      let simple = principal;
      let comp = principal;
      for (let i = 1; i <= months; i++) {
        simple += principal * (rate / 12);
        comp += comp * (rate / 12);
        monthly.push({ month: i, simpleBalanceCc: round2(simple), compoundBalanceCc: round2(comp) });
      }
      return {
        ok: true,
        result: {
          poolId, poolName: pool.name, principalCc: principal, months,
          aprPct: round2(aprPct), aprBps: bps, monthlyCc, annualCc, termCc, compoundTermCc,
          compoundBonusCc: round2(compoundTermCc - termCc), monthly,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Annual/monthly estimated-rewards breakdown, simple vs auto-compound." });

  // ── open_stake — escrow REAL CC from the user's wallet ────────────────────
  registerLensAction("staking", "open_stake", (ctx, artifact, params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      if (!hasStakingTables(db)) return { ok: false, error: "staking_unavailable" };
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const bad = badNumericField(params, ["principalCc", "months"]);
      if (bad) return { ok: false, error: `invalid_${bad}` };
      const poolId = String(params.poolId || "core");
      const pool = poolById(poolId);
      if (!pool) return { ok: false, error: "unknown_pool" };
      const principal = Math.floor(Number(params.principalCc) || 0);
      const rawMonths = Math.floor(Number(params.months) || 0);
      if (!rawMonths) return { ok: false, error: "missing_months" };
      const months = Math.max(1, Math.min(60, rawMonths));
      if (principal < pool.minStake) return { ok: false, error: `min_stake_${pool.minStake}_cc` };

      // Real balance gate — you cannot stake CC you do not hold.
      const bal = getBalance(db, userId).balance;
      if (bal < principal) {
        return { ok: false, error: "insufficient_balance", result: { balance: round2(bal), required: principal } };
      }

      const autoCompound = !!params.autoCompound;
      const liquidReceipt = !!params.liquidReceipt;
      const now = Math.floor(Date.now() / 1000);
      const bps = aprBpsFor(pool, months);
      recordAprSample(pool.id, bps, now);
      const posId = uid("stk");
      const unlocksAt = now + months * MONTH;
      let receiptTokenId = null;

      const tx = db.transaction(() => {
        // Re-check balance inside the tx (race guard).
        if (getBalance(db, userId).balance < principal) throw new Error("insufficient_balance");
        // Escrow the principal: user → staking_escrow. REAL debit.
        moveCC(db, {
          type: "STAKE_ESCROW", from: userId, to: STAKING_ESCROW_ID, amount: principal,
          refId: `stake_open:${posId}`, meta: { posId, poolId: pool.id, role: "principal_escrow" },
        });
        if (liquidReceipt) {
          receiptTokenId = uid("rcpt");
          db.prepare(`
            INSERT INTO staking_receipts (id, stake_id, user_id, symbol, face_value_cc, minted_at, unlocks_at, status, transferable)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1)
          `).run(receiptTokenId, posId, userId, `st${pool.id.toUpperCase()}`, principal, now, unlocksAt);
        }
        db.prepare(`
          INSERT INTO staking_positions
            (id, user_id, pool_id, pool_name, principal_cc, stake_months, locked_at, unlocks_at, yield_rate_bps, auto_compound, compound_count, final_yield_cc, penalty_cc, status, receipt_token_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'active', ?)
        `).run(posId, userId, pool.id, pool.name, principal, months, now, unlocksAt, bps, autoCompound ? 1 : 0, receiptTokenId);
      });
      tx();

      const row = db.prepare("SELECT * FROM staking_positions WHERE id=?").get(posId);
      return { ok: true, result: { position: publicPositionRow(row, now), receiptTokenId, walletBalanceCc: round2(getBalance(db, userId).balance) } };
    } catch (err) {
      if (String(err?.message).includes("insufficient_balance")) return { ok: false, error: "insufficient_balance" };
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Open a staking position — escrows real CC from your wallet into the pool." });

  // ── list_positions ────────────────────────────────────────────────────────
  registerLensAction("staking", "list_positions", (ctx, artifact, _params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      if (!hasStakingTables(db)) return { ok: true, result: { positions: [], count: 0, totalPrincipalCc: 0, totalAccruedYieldCc: 0 } };
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const now = Math.floor(Date.now() / 1000);
      const rows = db.prepare("SELECT * FROM staking_positions WHERE user_id=? ORDER BY locked_at DESC").all(userId);
      const positions = rows.map((r) => publicPositionRow(r, now));
      const active = positions.filter((p) => p.status === "active");
      return {
        ok: true,
        result: {
          positions, count: positions.length,
          totalPrincipalCc: round2(active.reduce((s, p) => s + p.principalCc, 0)),
          totalAccruedYieldCc: round2(active.reduce((s, p) => s + p.accruedYieldCc, 0)),
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "User's staking positions with live-computed accrued yield." });

  // ── redeem_stake — return principal + pay treasury-funded yield ────────────
  registerLensAction("staking", "redeem_stake", (ctx, artifact, params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      if (!hasStakingTables(db)) return { ok: false, error: "staking_unavailable" };
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const stakeId = String(params.stakeId || "");
      if (!stakeId) return { ok: false, error: "missing_stake_id" };
      const row = db.prepare("SELECT * FROM staking_positions WHERE id=? AND user_id=?").get(stakeId, userId);
      if (!row) return { ok: false, error: "not_found" };
      if (row.status !== "active") return { ok: false, error: "not_active" };
      const now = Math.floor(Date.now() / 1000);
      if (now < row.unlocks_at) return { ok: false, error: "still_locked", result: { unlocksAt: row.unlocks_at } };

      const yieldCc = accruedYieldRow(row, now);
      // Yield is paid from the fee-funded platform wallet — capped by its real
      // balance so nothing is minted from nothing.
      const platformBal = getBalance(db, PLATFORM_ACCOUNT_ID).balance;
      const yieldPaid = round2(Math.min(yieldCc, Math.max(0, platformBal)));

      const tx = db.transaction(() => {
        moveCC(db, { type: "STAKE_RETURN", from: STAKING_ESCROW_ID, to: userId, amount: row.principal_cc, refId: `stake_return:${row.id}`, meta: { posId: row.id, role: "principal_return" } });
        if (yieldPaid > 0) {
          moveCC(db, { type: "STAKE_YIELD", from: PLATFORM_ACCOUNT_ID, to: userId, amount: yieldPaid, refId: `stake_yield:${row.id}`, meta: { posId: row.id, role: "yield" } });
        }
        db.prepare("UPDATE staking_positions SET status='redeemed', final_yield_cc=?, redeemed_at=? WHERE id=?").run(yieldPaid, now, row.id);
        if (row.receipt_token_id) db.prepare("UPDATE staking_receipts SET status='redeemed' WHERE id=?").run(row.receipt_token_id);
      });
      tx();

      return {
        ok: true,
        result: {
          stakeId: row.id, principalCc: row.principal_cc,
          accruedYieldCc: yieldCc, yieldPaidCc: yieldPaid,
          yieldShortfallCc: round2(yieldCc - yieldPaid),
          treasuryFunded: yieldPaid >= yieldCc,
          totalReturnCc: round2(row.principal_cc + yieldPaid),
          currency: "CC", walletBalanceCc: round2(getBalance(db, userId).balance),
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Redeem a matured position — returns escrowed principal + treasury-funded yield." });

  // ── early_unstake — exit before maturity with a penalty ───────────────────
  registerLensAction("staking", "early_unstake", (ctx, artifact, params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      if (!hasStakingTables(db)) return { ok: false, error: "staking_unavailable" };
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const stakeId = String(params.stakeId || "");
      if (!stakeId) return { ok: false, error: "missing_stake_id" };
      const row = db.prepare("SELECT * FROM staking_positions WHERE id=? AND user_id=?").get(stakeId, userId);
      if (!row) return { ok: false, error: "not_found" };
      if (row.status !== "active") return { ok: false, error: "not_active" };
      const now = Math.floor(Date.now() / 1000);
      if (now >= row.unlocks_at) return { ok: false, error: "already_matured_use_redeem" };

      const pool = poolById(row.pool_id) || POOLS[1];
      // Yield accrued so far is forfeited (it is only ever paid at redeem).
      const remainFrac = (row.unlocks_at - now) / (row.unlocks_at - row.locked_at);
      const principalPenalty = round2(row.principal_cc * pool.earlyPenaltyPct * remainFrac);
      const returned = round2(row.principal_cc - principalPenalty);

      const tx = db.transaction(() => {
        moveCC(db, { type: "STAKE_RETURN", from: STAKING_ESCROW_ID, to: userId, amount: returned, refId: `stake_early:${row.id}`, meta: { posId: row.id, role: "early_principal" } });
        if (principalPenalty > 0) {
          // Penalty stays in the system: escrow → platform fee wallet.
          moveCC(db, { type: "STAKE_PENALTY", from: STAKING_ESCROW_ID, to: PLATFORM_ACCOUNT_ID, amount: principalPenalty, refId: `stake_penalty:${row.id}`, meta: { posId: row.id, role: "early_penalty" } });
        }
        db.prepare("UPDATE staking_positions SET status='early_exited', final_yield_cc=0, penalty_cc=?, exited_at=? WHERE id=?").run(principalPenalty, now, row.id);
        if (row.receipt_token_id) db.prepare("UPDATE staking_receipts SET status='redeemed' WHERE id=?").run(row.receipt_token_id);
      });
      tx();

      return {
        ok: true,
        result: {
          stakeId: row.id, principalCc: row.principal_cc, principalPenaltyCc: principalPenalty,
          yieldForfeitedCc: accruedYieldRow(row, now), totalPenaltyCc: principalPenalty,
          returnedCc: returned, currency: "CC", walletBalanceCc: round2(getBalance(db, userId).balance),
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Liquidity-with-fee: exit a locked stake early, forfeiting yield + a prorated principal slice." });

  // ── set_auto_compound ─────────────────────────────────────────────────────
  registerLensAction("staking", "set_auto_compound", (ctx, artifact, params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      if (!hasStakingTables(db)) return { ok: false, error: "staking_unavailable" };
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const stakeId = String(params.stakeId || "");
      if (!stakeId) return { ok: false, error: "missing_stake_id" };
      const row = db.prepare("SELECT * FROM staking_positions WHERE id=? AND user_id=?").get(stakeId, userId);
      if (!row) return { ok: false, error: "not_found" };
      if (row.status !== "active") return { ok: false, error: "not_active" };
      const enabled = !!params.enabled;
      db.prepare("UPDATE staking_positions SET auto_compound=? WHERE id=?").run(enabled ? 1 : 0, row.id);
      return { ok: true, result: { stakeId: row.id, autoCompound: enabled } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Enable/disable auto-compound (re-stake at maturity) for a position." });

  // ── compound_now — re-stake a matured position (principal + funded yield) ──
  registerLensAction("staking", "compound_now", (ctx, artifact, params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      if (!hasStakingTables(db)) return { ok: false, error: "staking_unavailable" };
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const stakeId = String(params.stakeId || "");
      if (!stakeId) return { ok: false, error: "missing_stake_id" };
      const row = db.prepare("SELECT * FROM staking_positions WHERE id=? AND user_id=?").get(stakeId, userId);
      if (!row) return { ok: false, error: "not_found" };
      if (row.status !== "active") return { ok: false, error: "not_active" };
      const now = Math.floor(Date.now() / 1000);
      if (now < row.unlocks_at) return { ok: false, error: "still_locked", result: { unlocksAt: row.unlocks_at } };

      const pool = poolById(row.pool_id) || POOLS[1];
      const yieldCc = accruedYieldRow(row, now);
      const platformBal = getBalance(db, PLATFORM_ACCOUNT_ID).balance;
      const yieldPaid = round2(Math.min(yieldCc, Math.max(0, platformBal)));
      // The escrow keeps the old principal and receives the funded yield, so the
      // new position's principal is exactly what the escrow now backs. round2 (not
      // floor) so escrow backing === new principal to the cent — no stranding.
      const newPrincipal = round2(row.principal_cc + yieldPaid);
      const months = row.stake_months;
      const bps = aprBpsFor(pool, months);
      recordAprSample(pool.id, bps, now);
      const nextId = uid("stk");
      const unlocksAt = now + months * MONTH;

      const tx = db.transaction(() => {
        if (yieldPaid > 0) {
          // Fund the compounded yield: platform → escrow (escrow now backs newPrincipal).
          moveCC(db, { type: "STAKE_YIELD", from: PLATFORM_ACCOUNT_ID, to: STAKING_ESCROW_ID, amount: yieldPaid, refId: `stake_compound_yield:${row.id}`, meta: { posId: row.id, role: "compound_yield" } });
        }
        db.prepare("UPDATE staking_positions SET status='redeemed', final_yield_cc=?, redeemed_at=? WHERE id=?").run(yieldPaid, now, row.id);
        if (row.receipt_token_id) db.prepare("UPDATE staking_receipts SET status='redeemed' WHERE id=?").run(row.receipt_token_id);
        db.prepare(`
          INSERT INTO staking_positions
            (id, user_id, pool_id, pool_name, principal_cc, stake_months, locked_at, unlocks_at, yield_rate_bps, auto_compound, compound_count, final_yield_cc, penalty_cc, status, receipt_token_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'active', NULL)
        `).run(nextId, userId, pool.id, pool.name, newPrincipal, months, now, unlocksAt, bps, row.auto_compound, (row.compound_count || 0) + 1);
      });
      tx();

      const next = db.prepare("SELECT * FROM staking_positions WHERE id=?").get(nextId);
      return {
        ok: true,
        result: {
          previousStakeId: row.id, newStakeId: nextId, compoundedYieldCc: yieldPaid,
          yieldShortfallCc: round2(yieldCc - yieldPaid), newPrincipalCc: newPrincipal,
          position: publicPositionRow(next, now),
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Re-stake a matured position (principal + funded yield) for another term." });

  // ── earnings_ledger — derived from persisted position lifecycle ───────────
  registerLensAction("staking", "earnings_ledger", (ctx, artifact, params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      if (!hasStakingTables(db)) return { ok: true, result: { entries: [], count: 0, totalYieldEarnedCc: 0, totalPenaltiesCc: 0, timeline: [] } };
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const limit = Math.max(1, Math.min(500, Math.floor(Number(params.limit) || 100)));
      const rows = db.prepare("SELECT * FROM staking_positions WHERE user_id=? ORDER BY locked_at DESC").all(userId);
      const entries = [];
      for (const r of rows) {
        entries.push({ id: `led_open_${r.id}`, t: r.locked_at, kind: "stake_opened", stakeId: r.id, poolId: r.pool_id, amountCc: r.principal_cc });
        if (r.status === "redeemed" && r.redeemed_at) {
          entries.push({ id: `led_red_${r.id}`, t: r.redeemed_at, kind: "stake_redeemed", stakeId: r.id, poolId: r.pool_id, amountCc: round2(r.principal_cc + r.final_yield_cc), yieldCc: r.final_yield_cc });
        }
        if (r.status === "early_exited" && r.exited_at) {
          entries.push({ id: `led_early_${r.id}`, t: r.exited_at, kind: "early_unstake", stakeId: r.id, poolId: r.pool_id, amountCc: round2(r.principal_cc - r.penalty_cc), penaltyCc: r.penalty_cc });
        }
      }
      entries.sort((a, b) => b.t - a.t);
      const limited = entries.slice(0, limit);
      const totalYield = entries.filter((e) => e.kind === "stake_redeemed").reduce((s, e) => s + (Number(e.yieldCc) || 0), 0);
      const totalPenalties = entries.filter((e) => e.kind === "early_unstake").reduce((s, e) => s + (Number(e.penaltyCc) || 0), 0);
      const yieldEvents = entries.filter((e) => e.kind === "stake_redeemed").slice().sort((a, b) => a.t - b.t);
      let cum = 0;
      const timeline = yieldEvents.map((e) => { cum += Number(e.yieldCc) || 0; return { t: e.t, yieldCc: round2(Number(e.yieldCc) || 0), cumulativeCc: round2(cum) }; });
      return { ok: true, result: { entries: limited, count: limited.length, totalYieldEarnedCc: round2(totalYield), totalPenaltiesCc: round2(totalPenalties), timeline } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Rewards / earnings history ledger with a cumulative-yield timeline." });

  // ── apr_history ───────────────────────────────────────────────────────────
  registerLensAction("staking", "apr_history", (ctx, artifact, params = {}) => {
    try {
      const poolId = String(params.poolId || "core");
      const pool = poolById(poolId);
      if (!pool) return { ok: false, error: "unknown_pool" };
      const now = Math.floor(Date.now() / 1000);
      const months = Math.max(1, Math.min(60, Math.floor(Number(params.months) || 12)));
      recordAprSample(pool.id, aprBpsFor(pool, months), now);
      const series = (aprState().get(pool.id) || []).map((s) => ({ t: s.t, aprPct: round2(s.bps / 100), aprBps: s.bps }));
      const bpsVals = series.map((s) => s.aprBps);
      return {
        ok: true,
        result: {
          poolId: pool.id, poolName: pool.name, previewMonths: months, series, points: series.length,
          currentAprPct: series.length ? series[series.length - 1].aprPct : round2(aprBpsFor(pool, months) / 100),
          minAprPct: bpsVals.length ? round2(Math.min(...bpsVals) / 100) : 0,
          maxAprPct: bpsVals.length ? round2(Math.max(...bpsVals) / 100) : 0,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "APR history series for a pool so users can judge the variable rate." });

  // ── list_receipts ─────────────────────────────────────────────────────────
  registerLensAction("staking", "list_receipts", (ctx, artifact, _params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      if (!hasStakingTables(db)) return { ok: true, result: { receipts: [], count: 0, liveFaceValueCc: 0 } };
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const now = Math.floor(Date.now() / 1000);
      const rows = db.prepare("SELECT * FROM staking_receipts WHERE user_id=? ORDER BY minted_at DESC").all(userId);
      const receipts = rows.map((r) => ({
        id: r.id, stakeId: r.stake_id, userId: r.user_id, symbol: r.symbol,
        faceValueCc: r.face_value_cc, mintedAt: r.minted_at, unlocksAt: r.unlocks_at,
        status: r.status, transferable: !!r.transferable, unlocked: now >= r.unlocks_at,
      }));
      const liveValue = receipts.filter((r) => r.status === "active").reduce((s, r) => s + r.faceValueCc, 0);
      return { ok: true, result: { receipts, count: receipts.length, liveFaceValueCc: round2(liveValue) } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Liquid-staking receipt tokens held by the user (tracking tokens; principal redeems to the staker)." });

  // ── transfer_receipt — reassign a receipt token's holder (tracking only) ───
  registerLensAction("staking", "transfer_receipt", (ctx, artifact, params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      if (!hasStakingTables(db)) return { ok: false, error: "staking_unavailable" };
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const receiptId = String(params.receiptId || "");
      const toUserId = String(params.toUserId || "");
      if (!receiptId) return { ok: false, error: "missing_receipt_id" };
      if (!toUserId) return { ok: false, error: "missing_recipient" };
      if (toUserId === userId) return { ok: false, error: "self_transfer" };
      const rcpt = db.prepare("SELECT * FROM staking_receipts WHERE id=? AND user_id=?").get(receiptId, userId);
      if (!rcpt) return { ok: false, error: "not_found" };
      if (rcpt.status !== "active") return { ok: false, error: "not_active" };
      if (!rcpt.transferable) return { ok: false, error: "not_transferable" };
      const now = Math.floor(Date.now() / 1000);
      db.prepare("UPDATE staking_receipts SET user_id=?, transferred_from=?, transferred_at=? WHERE id=?").run(toUserId, userId, now, receiptId);
      return { ok: true, result: { receiptId, toUserId, faceValueCc: rcpt.face_value_cc } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Transfer a liquid-staking receipt token to another user (holder reassignment; does not move escrowed CC)." });

  // ── maturity_reminders ────────────────────────────────────────────────────
  registerLensAction("staking", "maturity_reminders", (ctx, artifact, params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      if (!hasStakingTables(db)) return { ok: true, result: { matured: [], upcoming: [], maturedCount: 0, upcomingCount: 0, windowDays: 30 } };
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const now = Math.floor(Date.now() / 1000);
      const windowDays = Math.max(1, Math.min(365, Math.floor(Number(params.windowDays) || 30)));
      const windowEnd = now + windowDays * DAY;
      const active = db.prepare("SELECT * FROM staking_positions WHERE user_id=? AND status='active'").all(userId);
      const matured = active.filter((p) => now >= p.unlocks_at).map((p) => ({
        stakeId: p.id, poolName: p.pool_name, principalCc: p.principal_cc, accruedYieldCc: accruedYieldRow(p, now),
        unlocksAt: p.unlocks_at, autoCompound: !!p.auto_compound, state: "matured",
        message: p.auto_compound
          ? `${p.pool_name} stake matured — auto-compound is ON, ready to re-stake.`
          : `${p.pool_name} stake matured — redeem ${p.principal_cc} CC + yield now.`,
      }));
      const upcoming = active.filter((p) => now < p.unlocks_at && p.unlocks_at <= windowEnd).map((p) => {
        const daysLeft = Math.ceil((p.unlocks_at - now) / DAY);
        return { stakeId: p.id, poolName: p.pool_name, principalCc: p.principal_cc, unlocksAt: p.unlocks_at, daysUntilMaturity: daysLeft, autoCompound: !!p.auto_compound, state: "upcoming", message: `${p.pool_name} stake matures in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.` };
      }).sort((a, b) => a.daysUntilMaturity - b.daysUntilMaturity);
      return { ok: true, result: { matured, upcoming, maturedCount: matured.length, upcomingCount: upcoming.length, windowDays } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Maturity notifications — matured + upcoming-within-window staking positions." });
}
