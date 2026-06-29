// server/domains/staking.js
// Staking lens — CC staking products: pools, positions, auto-compound,
// early-unstake with penalty, earnings ledger, APR history, liquid-staking
// receipt tokens, and maturity reminders.
//
// All persistent per-user state lives in globalThis._concordSTATE Maps keyed
// by userId. Handlers never throw — every path is wrapped in try/catch and
// returns { ok: boolean, result?, error? }.
//
// Currency: CC. Yield is funded by the treasury share of marketplace fees,
// so APR is honestly variable. Pool tiers offer different risk-reward.

const DAY = 86400;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

// ── Staking pools (products) ──────────────────────────────────────────────
// baseBps  — base APR in basis points
// perMonth — additional bps per month of lock
// capBps   — APR ceiling
// minStake — minimum principal in CC
// earlyPenaltyPct — % of accrued yield + a slice of principal lost on early exit
const POOLS = [
  {
    id: "flex",
    name: "Flex Pool",
    risk: "low",
    baseBps: 60,
    perMonth: 8,
    capBps: 400,
    minStake: 10,
    earlyPenaltyPct: 0.10,
    description: "Conservative pool. Lower yield, smallest early-exit penalty.",
  },
  {
    id: "core",
    name: "Core Pool",
    risk: "medium",
    baseBps: 100,
    perMonth: 20,
    capBps: 1200,
    minStake: 25,
    earlyPenaltyPct: 0.25,
    description: "Balanced pool. The classic lock-earn-redeem product.",
  },
  {
    id: "growth",
    name: "Growth Pool",
    risk: "high",
    baseBps: 160,
    perMonth: 32,
    capBps: 2000,
    minStake: 100,
    earlyPenaltyPct: 0.45,
    description: "Aggressive pool. Highest yield, steepest early-exit penalty.",
  },
];

function poolById(id) {
  return POOLS.find((p) => p.id === id) || null;
}

function aprBpsFor(pool, months) {
  return Math.min(pool.capBps, pool.baseBps + months * pool.perMonth);
}

// ── State helpers ─────────────────────────────────────────────────────────
function st() {
  const g = globalThis;
  if (!g._concordSTATE) g._concordSTATE = {};
  const S = g._concordSTATE;
  if (!S.stakingPositions) S.stakingPositions = new Map(); // userId -> position[]
  if (!S.stakingLedger) S.stakingLedger = new Map();       // userId -> ledgerEntry[]
  if (!S.stakingReceipts) S.stakingReceipts = new Map();   // userId -> receipt[]
  if (!S.stakingAprHistory) S.stakingAprHistory = new Map(); // poolId -> {t,bps}[]
  if (!S.stakingSeq) S.stakingSeq = { n: 1 };
  return S;
}

function nextId(prefix) {
  const S = st();
  return `${prefix}_${S.stakingSeq.n++}`;
}

function userPositions(userId) {
  const S = st();
  if (!S.stakingPositions.has(userId)) S.stakingPositions.set(userId, []);
  return S.stakingPositions.get(userId);
}

function userLedger(userId) {
  const S = st();
  if (!S.stakingLedger.has(userId)) S.stakingLedger.set(userId, []);
  return S.stakingLedger.get(userId);
}

function userReceipts(userId) {
  const S = st();
  if (!S.stakingReceipts.has(userId)) S.stakingReceipts.set(userId, []);
  return S.stakingReceipts.get(userId);
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Fail-CLOSED numeric guard. Rejects poisoned NaN/Infinity/1e308/negative
// BEFORE any state write. Returns the offending key name, or null when clean.
// (Copied shape from server/domains/literary.js#badNumericField.) Without it,
// `Number(Infinity) || 0` → Infinity passes `Infinity < minStake` and an
// Infinity principal would be locked into a position.
function badNumericField(params, keys) {
  for (const k of keys) {
    if (params[k] === undefined || params[k] === null || params[k] === "") continue;
    const n = Number(params[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) return k;
  }
  return null;
}

// Accrued yield is computed live from elapsed time so positions are always
// fresh without a heartbeat. APR is per-second prorated.
function accruedYield(pos, now) {
  const elapsed = Math.max(0, Math.min(now, pos.unlocksAt) - pos.lockedAt);
  const rate = pos.yieldRateBps / 10000;
  return round2(pos.principalCc * rate * (elapsed / YEAR));
}

// APR history is sampled lazily — one point per pool per day it is queried.
function recordAprSample(poolId, bps, now) {
  const S = st();
  if (!S.stakingAprHistory.has(poolId)) S.stakingAprHistory.set(poolId, []);
  const series = S.stakingAprHistory.get(poolId);
  const dayKey = Math.floor(now / DAY);
  const last = series[series.length - 1];
  if (last && Math.floor(last.t / DAY) === dayKey) {
    last.bps = bps; // overwrite same-day sample
  } else {
    series.push({ t: now, bps });
    if (series.length > 365) series.shift();
  }
}

function logLedger(userId, entry) {
  const led = userLedger(userId);
  led.unshift({ id: nextId("led"), t: Math.floor(Date.now() / 1000), ...entry });
  if (led.length > 500) led.length = 500;
}

function publicPosition(pos, now) {
  const accrued = pos.status === "active" ? accruedYield(pos, now) : pos.finalYieldCc;
  return {
    id: pos.id,
    poolId: pos.poolId,
    poolName: pos.poolName,
    principalCc: pos.principalCc,
    stakeMonths: pos.stakeMonths,
    lockedAt: pos.lockedAt,
    unlocksAt: pos.unlocksAt,
    yieldRateBps: pos.yieldRateBps,
    accruedYieldCc: accrued,
    autoCompound: !!pos.autoCompound,
    status: pos.status,
    receiptTokenId: pos.receiptTokenId || null,
    compoundCount: pos.compoundCount || 0,
    unlocked: now >= pos.unlocksAt,
  };
}

export default function registerStakingActions(registerLensAction) {
  // ── list_pools — multiple staking products at different risk tiers ──────
  registerLensAction("staking", "list_pools", (ctx, artifact, params = {}) => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const previewMonths = Math.max(1, Math.min(60, Math.floor(Number(params.months) || 12)));
      const pools = POOLS.map((p) => {
        const bps = aprBpsFor(p, previewMonths);
        recordAprSample(p.id, bps, now);
        return {
          id: p.id,
          name: p.name,
          risk: p.risk,
          description: p.description,
          minStake: p.minStake,
          baseAprPct: round2(p.baseBps / 100),
          capAprPct: round2(p.capBps / 100),
          earlyPenaltyPct: p.earlyPenaltyPct,
          previewMonths,
          previewAprPct: round2(bps / 100),
          perMonthBps: p.perMonth,
        };
      });
      return { ok: true, result: { pools, count: pools.length } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Staking pools / products at low/medium/high risk-reward tiers." });

  // ── estimate_rewards — annual/monthly breakdown before staking ──────────
  registerLensAction("staking", "estimate_rewards", (ctx, artifact, params = {}) => {
    try {
      const bad = badNumericField(params, ["principalCc", "months"]);
      if (bad) return { ok: false, error: `invalid_${bad}` };
      const poolId = String(params.poolId || "core");
      const pool = poolById(poolId);
      if (!pool) return { ok: false, error: "unknown_pool" };
      const principal = Math.max(0, Math.floor(Number(params.principalCc) || 0));
      const months = Math.max(1, Math.min(60, Math.floor(Number(params.months) || 12)));
      if (principal < pool.minStake) {
        return { ok: false, error: `min_stake_${pool.minStake}_cc` };
      }
      const bps = aprBpsFor(pool, months);
      const aprPct = bps / 100;
      const rate = bps / 10000;
      const monthlyCc = round2(principal * rate / 12);
      const annualCc = round2(principal * rate);
      const termCc = round2(principal * rate * (months / 12));
      // Auto-compound projection: yield re-staked monthly.
      let bal = principal;
      for (let i = 0; i < months; i++) bal += bal * (rate / 12);
      const compoundTermCc = round2(bal - principal);
      const monthly = [];
      let simple = principal;
      let comp = principal;
      for (let i = 1; i <= months; i++) {
        simple += principal * (rate / 12);
        comp += comp * (rate / 12);
        monthly.push({
          month: i,
          simpleBalanceCc: round2(simple),
          compoundBalanceCc: round2(comp),
        });
      }
      return {
        ok: true,
        result: {
          poolId, poolName: pool.name, principalCc: principal, months,
          aprPct: round2(aprPct), aprBps: bps,
          monthlyCc, annualCc, termCc, compoundTermCc,
          compoundBonusCc: round2(compoundTermCc - termCc),
          monthly,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Annual/monthly estimated-rewards breakdown, simple vs auto-compound." });

  // ── open_stake — open a position in a chosen pool ───────────────────────
  registerLensAction("staking", "open_stake", (ctx, artifact, params = {}) => {
    try {
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
      if (principal < pool.minStake) {
        return { ok: false, error: `min_stake_${pool.minStake}_cc` };
      }
      const autoCompound = !!params.autoCompound;
      const liquidReceipt = !!params.liquidReceipt;
      const now = Math.floor(Date.now() / 1000);
      const bps = aprBpsFor(pool, months);
      recordAprSample(pool.id, bps, now);
      const pos = {
        id: nextId("stk"),
        userId,
        poolId: pool.id,
        poolName: pool.name,
        principalCc: principal,
        stakeMonths: months,
        lockedAt: now,
        unlocksAt: now + months * MONTH,
        yieldRateBps: bps,
        autoCompound,
        compoundCount: 0,
        finalYieldCc: 0,
        status: "active",
        receiptTokenId: null,
      };
      // Liquid-staking receipt token — usable elsewhere while locked.
      if (liquidReceipt) {
        const receipt = {
          id: nextId("rcpt"),
          stakeId: pos.id,
          userId,
          symbol: `st${pool.id.toUpperCase()}`,
          faceValueCc: principal,
          mintedAt: now,
          unlocksAt: pos.unlocksAt,
          status: "active", // active | redeemed | transferred
          transferable: true,
        };
        userReceipts(userId).push(receipt);
        pos.receiptTokenId = receipt.id;
      }
      userPositions(userId).push(pos);
      logLedger(userId, {
        kind: "stake_opened",
        stakeId: pos.id,
        poolId: pool.id,
        amountCc: principal,
        note: `Locked ${principal} CC in ${pool.name} for ${months}mo @ ${round2(bps / 100)}% APR`,
      });
      return { ok: true, result: { position: publicPosition(pos, now), receiptTokenId: pos.receiptTokenId } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Open a staking position in a pool, optionally with auto-compound + liquid receipt." });

  // ── list_positions — user's positions with live accrued yield ───────────
  registerLensAction("staking", "list_positions", (ctx, artifact, _params = {}) => {
    try {
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const now = Math.floor(Date.now() / 1000);
      const positions = userPositions(userId).map((p) => publicPosition(p, now));
      const activeAccrued = positions
        .filter((p) => p.status === "active")
        .reduce((s, p) => s + p.accruedYieldCc, 0);
      const totalPrincipal = positions
        .filter((p) => p.status === "active")
        .reduce((s, p) => s + p.principalCc, 0);
      return {
        ok: true,
        result: {
          positions,
          count: positions.length,
          totalPrincipalCc: round2(totalPrincipal),
          totalAccruedYieldCc: round2(activeAccrued),
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "User's staking positions with live-computed accrued yield." });

  // ── redeem_stake — redeem an unlocked position ──────────────────────────
  registerLensAction("staking", "redeem_stake", (ctx, artifact, params = {}) => {
    try {
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const stakeId = String(params.stakeId || "");
      if (!stakeId) return { ok: false, error: "missing_stake_id" };
      const positions = userPositions(userId);
      const pos = positions.find((p) => p.id === stakeId);
      if (!pos) return { ok: false, error: "not_found" };
      if (pos.status !== "active") return { ok: false, error: "not_active" };
      const now = Math.floor(Date.now() / 1000);
      if (now < pos.unlocksAt) {
        return { ok: false, error: "still_locked", result: { unlocksAt: pos.unlocksAt } };
      }
      const yieldCc = accruedYield(pos, now);
      pos.finalYieldCc = yieldCc;
      pos.status = "redeemed";
      pos.redeemedAt = now;
      const totalReturn = round2(pos.principalCc + yieldCc);
      // Retire the liquid receipt if one was minted.
      if (pos.receiptTokenId) {
        const rcpt = userReceipts(userId).find((r) => r.id === pos.receiptTokenId);
        if (rcpt) rcpt.status = "redeemed";
      }
      logLedger(userId, {
        kind: "stake_redeemed",
        stakeId: pos.id,
        poolId: pos.poolId,
        amountCc: totalReturn,
        yieldCc,
        note: `Redeemed ${pos.principalCc} CC + ${yieldCc} CC yield from ${pos.poolName}`,
      });
      return {
        ok: true,
        result: {
          stakeId: pos.id,
          principalCc: pos.principalCc,
          accruedYieldCc: yieldCc,
          totalReturnCc: totalReturn,
          currency: "CC",
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Redeem a matured staking position — returns principal + accrued yield." });

  // ── early_unstake — exit before maturity with a penalty ─────────────────
  registerLensAction("staking", "early_unstake", (ctx, artifact, params = {}) => {
    try {
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const stakeId = String(params.stakeId || "");
      if (!stakeId) return { ok: false, error: "missing_stake_id" };
      const positions = userPositions(userId);
      const pos = positions.find((p) => p.id === stakeId);
      if (!pos) return { ok: false, error: "not_found" };
      if (pos.status !== "active") return { ok: false, error: "not_active" };
      const now = Math.floor(Date.now() / 1000);
      if (now >= pos.unlocksAt) {
        return { ok: false, error: "already_matured_use_redeem" };
      }
      const pool = poolById(pos.poolId) || POOLS[1];
      const yieldCc = accruedYield(pos, now);
      // Penalty: all accrued yield forfeited + a slice of principal scaled
      // by how much of the lock remains.
      const remainFrac = (pos.unlocksAt - now) / (pos.unlocksAt - pos.lockedAt);
      const principalPenalty = round2(pos.principalCc * pool.earlyPenaltyPct * remainFrac);
      const yieldForfeited = yieldCc;
      const returned = round2(pos.principalCc - principalPenalty);
      pos.status = "early_exited";
      pos.finalYieldCc = 0;
      pos.exitedAt = now;
      pos.penaltyCc = round2(principalPenalty + yieldForfeited);
      if (pos.receiptTokenId) {
        const rcpt = userReceipts(userId).find((r) => r.id === pos.receiptTokenId);
        if (rcpt) rcpt.status = "redeemed";
      }
      logLedger(userId, {
        kind: "early_unstake",
        stakeId: pos.id,
        poolId: pos.poolId,
        amountCc: returned,
        penaltyCc: pos.penaltyCc,
        note: `Early exit from ${pool.name} — penalty ${pos.penaltyCc} CC`,
      });
      return {
        ok: true,
        result: {
          stakeId: pos.id,
          principalCc: pos.principalCc,
          principalPenaltyCc: principalPenalty,
          yieldForfeitedCc: round2(yieldForfeited),
          totalPenaltyCc: pos.penaltyCc,
          returnedCc: returned,
          currency: "CC",
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Liquidity-with-fee: exit a locked stake early, forfeiting yield + a prorated principal slice." });

  // ── set_auto_compound — toggle re-stake at maturity ─────────────────────
  registerLensAction("staking", "set_auto_compound", (ctx, artifact, params = {}) => {
    try {
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const stakeId = String(params.stakeId || "");
      if (!stakeId) return { ok: false, error: "missing_stake_id" };
      const pos = userPositions(userId).find((p) => p.id === stakeId);
      if (!pos) return { ok: false, error: "not_found" };
      if (pos.status !== "active") return { ok: false, error: "not_active" };
      pos.autoCompound = !!params.enabled;
      logLedger(userId, {
        kind: "auto_compound_set",
        stakeId: pos.id,
        poolId: pos.poolId,
        amountCc: 0,
        note: `Auto-compound ${pos.autoCompound ? "enabled" : "disabled"} for ${pos.poolName}`,
      });
      return { ok: true, result: { stakeId: pos.id, autoCompound: pos.autoCompound } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Enable/disable auto-compound (re-stake at maturity) for a position." });

  // ── compound_now — re-stake a matured position (auto-compound action) ────
  registerLensAction("staking", "compound_now", (ctx, artifact, params = {}) => {
    try {
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const stakeId = String(params.stakeId || "");
      if (!stakeId) return { ok: false, error: "missing_stake_id" };
      const positions = userPositions(userId);
      const pos = positions.find((p) => p.id === stakeId);
      if (!pos) return { ok: false, error: "not_found" };
      if (pos.status !== "active") return { ok: false, error: "not_active" };
      const now = Math.floor(Date.now() / 1000);
      if (now < pos.unlocksAt) {
        return { ok: false, error: "still_locked", result: { unlocksAt: pos.unlocksAt } };
      }
      const pool = poolById(pos.poolId) || POOLS[1];
      const yieldCc = accruedYield(pos, now);
      pos.finalYieldCc = yieldCc;
      pos.status = "redeemed";
      pos.redeemedAt = now;
      if (pos.receiptTokenId) {
        const oldR = userReceipts(userId).find((r) => r.id === pos.receiptTokenId);
        if (oldR) oldR.status = "redeemed";
      }
      // Re-stake principal + yield for the same term.
      const newPrincipal = Math.floor(pos.principalCc + yieldCc);
      const months = pos.stakeMonths;
      const bps = aprBpsFor(pool, months);
      recordAprSample(pool.id, bps, now);
      const next = {
        id: nextId("stk"),
        userId,
        poolId: pool.id,
        poolName: pool.name,
        principalCc: newPrincipal,
        stakeMonths: months,
        lockedAt: now,
        unlocksAt: now + months * MONTH,
        yieldRateBps: bps,
        autoCompound: pos.autoCompound,
        compoundCount: (pos.compoundCount || 0) + 1,
        finalYieldCc: 0,
        status: "active",
        receiptTokenId: null,
      };
      positions.push(next);
      logLedger(userId, {
        kind: "compounded",
        stakeId: next.id,
        prevStakeId: pos.id,
        poolId: pool.id,
        amountCc: newPrincipal,
        yieldCc,
        note: `Compounded ${yieldCc} CC yield — re-staked ${newPrincipal} CC in ${pool.name}`,
      });
      return {
        ok: true,
        result: {
          previousStakeId: pos.id,
          newStakeId: next.id,
          compoundedYieldCc: yieldCc,
          newPrincipalCc: newPrincipal,
          position: publicPosition(next, now),
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Re-stake a matured position (principal + yield) for another term." });

  // ── earnings_ledger — rewards history over time ─────────────────────────
  registerLensAction("staking", "earnings_ledger", (ctx, artifact, params = {}) => {
    try {
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const limit = Math.max(1, Math.min(500, Math.floor(Number(params.limit) || 100)));
      const led = userLedger(userId).slice(0, limit);
      const totalYield = led
        .filter((e) => e.kind === "stake_redeemed" || e.kind === "compounded")
        .reduce((s, e) => s + (Number(e.yieldCc) || 0), 0);
      const totalPenalties = led
        .filter((e) => e.kind === "early_unstake")
        .reduce((s, e) => s + (Number(e.penaltyCc) || 0), 0);
      // Cumulative-yield timeline for charting.
      const yieldEvents = userLedger(userId)
        .filter((e) => e.kind === "stake_redeemed" || e.kind === "compounded")
        .slice()
        .sort((a, b) => a.t - b.t);
      let cum = 0;
      const timeline = yieldEvents.map((e) => {
        cum += Number(e.yieldCc) || 0;
        return { t: e.t, yieldCc: round2(Number(e.yieldCc) || 0), cumulativeCc: round2(cum) };
      });
      return {
        ok: true,
        result: {
          entries: led,
          count: led.length,
          totalYieldEarnedCc: round2(totalYield),
          totalPenaltiesCc: round2(totalPenalties),
          timeline,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Rewards / earnings history ledger with a cumulative-yield timeline." });

  // ── apr_history — APR history per pool so users judge the variable rate ──
  registerLensAction("staking", "apr_history", (ctx, artifact, params = {}) => {
    try {
      const poolId = String(params.poolId || "core");
      const pool = poolById(poolId);
      if (!pool) return { ok: false, error: "unknown_pool" };
      const now = Math.floor(Date.now() / 1000);
      const months = Math.max(1, Math.min(60, Math.floor(Number(params.months) || 12)));
      // Ensure today's sample exists so a fresh user still sees a real point.
      recordAprSample(pool.id, aprBpsFor(pool, months), now);
      const S = st();
      const series = (S.stakingAprHistory.get(pool.id) || []).map((s) => ({
        t: s.t,
        aprPct: round2(s.bps / 100),
        aprBps: s.bps,
      }));
      const bpsVals = series.map((s) => s.aprBps);
      return {
        ok: true,
        result: {
          poolId: pool.id,
          poolName: pool.name,
          previewMonths: months,
          series,
          points: series.length,
          currentAprPct: series.length ? series[series.length - 1].aprPct : round2(aprBpsFor(pool, months) / 100),
          minAprPct: bpsVals.length ? round2(Math.min(...bpsVals) / 100) : 0,
          maxAprPct: bpsVals.length ? round2(Math.max(...bpsVals) / 100) : 0,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "APR history series for a pool so users can judge the variable rate." });

  // ── list_receipts — liquid-staking receipt tokens ───────────────────────
  registerLensAction("staking", "list_receipts", (ctx, artifact, _params = {}) => {
    try {
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const now = Math.floor(Date.now() / 1000);
      const receipts = userReceipts(userId).map((r) => ({
        ...r,
        unlocked: now >= r.unlocksAt,
      }));
      const liveValue = receipts
        .filter((r) => r.status === "active")
        .reduce((s, r) => s + r.faceValueCc, 0);
      return {
        ok: true,
        result: {
          receipts,
          count: receipts.length,
          liveFaceValueCc: round2(liveValue),
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Liquid-staking receipt tokens held by the user." });

  // ── transfer_receipt — use the receipt token elsewhere (transfer) ───────
  registerLensAction("staking", "transfer_receipt", (ctx, artifact, params = {}) => {
    try {
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const receiptId = String(params.receiptId || "");
      const toUserId = String(params.toUserId || "");
      if (!receiptId) return { ok: false, error: "missing_receipt_id" };
      if (!toUserId) return { ok: false, error: "missing_recipient" };
      if (toUserId === userId) return { ok: false, error: "self_transfer" };
      const fromReceipts = userReceipts(userId);
      const idx = fromReceipts.findIndex((r) => r.id === receiptId);
      if (idx < 0) return { ok: false, error: "not_found" };
      const rcpt = fromReceipts[idx];
      if (rcpt.status !== "active") return { ok: false, error: "not_active" };
      if (!rcpt.transferable) return { ok: false, error: "not_transferable" };
      fromReceipts.splice(idx, 1);
      const moved = { ...rcpt, userId: toUserId, transferredFrom: userId, transferredAt: Math.floor(Date.now() / 1000) };
      userReceipts(toUserId).push(moved);
      logLedger(userId, {
        kind: "receipt_transferred",
        receiptId: rcpt.id,
        amountCc: rcpt.faceValueCc,
        note: `Transferred receipt ${rcpt.symbol} (${rcpt.faceValueCc} CC) to ${toUserId}`,
      });
      return { ok: true, result: { receiptId: rcpt.id, toUserId, faceValueCc: rcpt.faceValueCc } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Transfer a liquid-staking receipt token to another user." });

  // ── maturity_reminders — upcoming-maturity notifications ────────────────
  registerLensAction("staking", "maturity_reminders", (ctx, artifact, params = {}) => {
    try {
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const now = Math.floor(Date.now() / 1000);
      const windowDays = Math.max(1, Math.min(365, Math.floor(Number(params.windowDays) || 30)));
      const windowEnd = now + windowDays * DAY;
      const active = userPositions(userId).filter((p) => p.status === "active");
      const matured = active
        .filter((p) => now >= p.unlocksAt)
        .map((p) => ({
          stakeId: p.id,
          poolName: p.poolName,
          principalCc: p.principalCc,
          accruedYieldCc: accruedYield(p, now),
          unlocksAt: p.unlocksAt,
          autoCompound: !!p.autoCompound,
          state: "matured",
          message: p.autoCompound
            ? `${p.poolName} stake matured — auto-compound is ON, ready to re-stake.`
            : `${p.poolName} stake matured — redeem ${p.principalCc} CC + yield now.`,
        }));
      const upcoming = active
        .filter((p) => now < p.unlocksAt && p.unlocksAt <= windowEnd)
        .map((p) => {
          const daysLeft = Math.ceil((p.unlocksAt - now) / DAY);
          return {
            stakeId: p.id,
            poolName: p.poolName,
            principalCc: p.principalCc,
            unlocksAt: p.unlocksAt,
            daysUntilMaturity: daysLeft,
            autoCompound: !!p.autoCompound,
            state: "upcoming",
            message: `${p.poolName} stake matures in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
          };
        })
        .sort((a, b) => a.daysUntilMaturity - b.daysUntilMaturity);
      return {
        ok: true,
        result: {
          matured,
          upcoming,
          maturedCount: matured.length,
          upcomingCount: upcoming.length,
          windowDays,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Maturity notifications — matured + upcoming-within-window staking positions." });
}
