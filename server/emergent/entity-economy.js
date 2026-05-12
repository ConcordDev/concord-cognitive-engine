/**
 * Inter-Entity Economy — Resource Trading & Specialization
 *
 * A civilisation simulation layer where entities trade internal
 * compute/attention credits, specialise in domains, and develop
 * economic relationships with each other.
 *
 * Resources are NOT real money — they represent internal
 * compute/attention allocations:
 *   COMPUTE      — processing allocation credits
 *   ATTENTION    — priority queue position credits
 *   INSIGHT      — knowledge contribution credits (DTU-driven)
 *   MENTORSHIP   — teaching time credits
 *   REVIEW       — critique/review service credits
 *
 * Income streams:
 *   DTU promotion          → +5 insight
 *   Session participation  → +2 compute
 *   Accepted critique      → +3 review
 *   Teaching (eval > 0.7)  → +4 mentorship
 *   Research contribution  → +3 insight
 *   Base income            → +1 compute / 10 ticks  (UBI)
 *
 * Economic guardrails:
 *   Inflation check  — >20 % supply growth in 1000 ticks → 5 % tax
 *   Deflation check  — >20 % supply drop → UBI boost (+5 compute)
 *   Wealth cap       — >15 % of total supply → progressive redistribution
 *   First-trade bonus — +10 % on first trade between any pair
 *
 * All state in module-level Maps.  Silent failure.  No new deps.
 * Export named functions.
 */

import crypto from "crypto";
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid(prefix = "txn") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

// ── Constants ────────────────────────────────────────────────────────────────

export const RESOURCE_TYPES = Object.freeze({
  COMPUTE:    "compute",
  ATTENTION:  "attention",
  INSIGHT:    "insight",
  MENTORSHIP: "mentorship",
  REVIEW:     "review",
});

const ALL_RESOURCES = Object.freeze(Object.values(RESOURCE_TYPES));

const STARTING_BALANCES = Object.freeze({
  compute:    100,
  attention:   50,
  insight:      0,
  mentorship:   0,
  review:       0,
});

const TRADE_MIN       = 1;
const TRADE_MAX       = 50;
const TRADE_EXPIRY    = 50;       // ticks
const FIRST_TRADE_BONUS = 0.10;   // 10 % bonus

const INFLATION_WINDOW   = 1000;  // ticks
const INFLATION_THRESHOLD = 0.20; // 20 % growth
const INFLATION_TAX_RATE  = 0.05; // 5 % proportional tax
const DEFLATION_THRESHOLD = 0.20; // 20 % drop
const DEFLATION_UBI_BOOST = 5;    // +5 compute to all

const WEALTH_CAP_RATIO = 0.15;    // 15 % of total supply

const SPECIALIZATION_BONUS    = 1.5;   // 1.5× in-domain
const SPECIALIZATION_PENALTY  = 0.7;   // 0.7× out-of-domain
const SPECIALIZATION_GROWTH   = 0.01;  // +0.01 per relevant DTU
const SPECIALIZATION_RESET_TO = 0.3;   // level after switching

const PRICE_HISTORY_CAP = 100;
const TRADE_HISTORY_CAP = 200;

// ── In-Memory State ──────────────────────────────────────────────────────────

/** entityId -> account */
const _accounts = new LruMap();

/** tradeId -> trade */
const _trades = new LruMap();

/** "entityA::entityB" (sorted) -> true — tracks unique trade pairs */
const _tradePairs = new LruMap();

/** resourceType -> market data */
const _markets = new LruMap();

/** Snapshot of total supply at a past tick for inflation/deflation checks */
const _supplySnapshots = new LruMap();   // resourceType -> { tick, totalSupply }

/** Global tick counter — incremented by runEconomicCycle */
let _tick = 0;

/** Global metrics */
const _metrics = {
  totalTrades: 0,
  completedTrades: 0,
  rejectedTrades: 0,
  cancelledTrades: 0,
  expiredTrades: 0,
  totalEarned: 0,
  totalSpent: 0,
  inflationEvents: 0,
  deflationEvents: 0,
  redistributionEvents: 0,
  cyclesRun: 0,
};

// ── Market Initialisation ────────────────────────────────────────────────────

function ensureMarket(resourceType) {
  if (_markets.has(resourceType)) return _markets.get(resourceType);
  const m = {
    resourceType,
    supply: 0,
    demand: 0,
    exchangeRates: {},
    avgTradeVolume: 0,
    priceHistory: [],
    tradeCount: 0,
    lastUpdated: nowISO(),
  };
  _markets.set(resourceType, m);
  return m;
}

(function initMarkets() {
  for (const r of ALL_RESOURCES) ensureMarket(r);
})();

// ── Zeroed Balance Factories ─────────────────────────────────────────────────

function zeroBalances() {
  const b = {};
  for (const r of ALL_RESOURCES) b[r] = 0;
  return b;
}

function startingBalances() {
  return { ...STARTING_BALANCES };
}

// ── Account Management ───────────────────────────────────────────────────────

/**
 * Create a new entity account with starting balances.
 * Idempotent — returns existing account if already present.
 */
export function initAccount(entityId) {
  try {
    if (!entityId) return { ok: false, error: "entityId required" };
    if (_accounts.has(entityId)) return { ok: true, account: _accounts.get(entityId), existing: true };

    const account = {
      entityId,
      balances:           startingBalances(),
      earned:             zeroBalances(),
      spent:              zeroBalances(),
      specialization:     null,
      specializationLevel: 0.0,
      tradeHistory:       [],
      creditRating:       0.5,
      lastActivity:       nowISO(),
    };

    _accounts.set(entityId, account);

    // Update global supply
    for (const r of ALL_RESOURCES) {
      const m = ensureMarket(r);
      m.supply += account.balances[r];
    }

    return { ok: true, account, existing: false };
  } catch (_) {
    return { ok: false, error: "initAccount failed" };
  }
}

/**
 * Get account state.
 */
export function getAccount(entityId) {
  try {
    if (!entityId) return { ok: false, error: "entityId required" };
    const acct = _accounts.get(entityId);
    if (!acct) return { ok: false, error: "account_not_found" };
    return { ok: true, account: { ...acct, balances: { ...acct.balances } } };
  } catch (_) {
    return { ok: false, error: "getAccount failed" };
  }
}

/**
 * List all accounts.
 */
export function listAccounts() {
  try {
    const out = [];
    for (const acct of _accounts.values()) {
      out.push({ ...acct, balances: { ...acct.balances } });
    }
    return { ok: true, accounts: out, count: out.length };
  } catch (_) {
    return { ok: false, error: "listAccounts failed" };
  }
}

// ── Earn / Spend ─────────────────────────────────────────────────────────────

/**
 * Credit an entity with resources.
 *
 * Applies specialisation multiplier when relevant:
 *   - 1.5× if earning insight in specialised domain
 *   - 0.7× if earning insight outside specialised domain
 *
 * @param {string} entityId
 * @param {string} type       - resource type
 * @param {number} amount     - base amount (before specialisation modifier)
 * @param {string} reason     - human-readable reason
 * @param {object} [opts]     - { domain } for specialisation checks
 */
export function earnResource(entityId, type, amount, reason, opts = {}) {
  try {
    if (!entityId || !type || amount == null) {
      return { ok: false, error: "entityId, type, and amount required" };
    }
    if (!ALL_RESOURCES.includes(type)) {
      return { ok: false, error: `unknown resource type: ${type}` };
    }

    const acct = _accounts.get(entityId);
    if (!acct) return { ok: false, error: "account_not_found" };

    let finalAmount = Math.max(0, Number(amount) || 0);

    // Apply specialisation modifier for insight earnings
    if (type === RESOURCE_TYPES.INSIGHT && acct.specialization) {
      if (opts.domain && opts.domain === acct.specialization) {
        finalAmount = Math.round(finalAmount * SPECIALIZATION_BONUS * 100) / 100;
      } else if (opts.domain && opts.domain !== acct.specialization) {
        finalAmount = Math.round(finalAmount * SPECIALIZATION_PENALTY * 100) / 100;
      }
    }

    acct.balances[type] += finalAmount;
    acct.earned[type]   += finalAmount;
    acct.lastActivity    = nowISO();

    // Update global supply
    const m = ensureMarket(type);
    m.supply += finalAmount;

    _metrics.totalEarned += finalAmount;

    return {
      ok: true,
      entityId,
      type,
      baseAmount: Number(amount),
      finalAmount,
      reason,
      balance: acct.balances[type],
    };
  } catch (_) {
    return { ok: false, error: "earnResource failed" };
  }
}

/**
 * Debit resources from an entity.
 *
 * @param {string} entityId
 * @param {string} type
 * @param {number} amount
 * @param {string} reason
 */
export function spendResource(entityId, type, amount, reason) {
  try {
    if (!entityId || !type || amount == null) {
      return { ok: false, error: "entityId, type, and amount required" };
    }
    if (!ALL_RESOURCES.includes(type)) {
      return { ok: false, error: `unknown resource type: ${type}` };
    }

    const acct = _accounts.get(entityId);
    if (!acct) return { ok: false, error: "account_not_found" };

    const debit = Math.max(0, Number(amount) || 0);
    if (acct.balances[type] < debit) {
      return { ok: false, error: "insufficient_balance", available: acct.balances[type], requested: debit };
    }

    acct.balances[type] -= debit;
    acct.spent[type]    += debit;
    acct.lastActivity    = nowISO();

    // Update global supply
    const m = ensureMarket(type);
    m.supply = Math.max(0, m.supply - debit);

    _metrics.totalSpent += debit;

    return {
      ok: true,
      entityId,
      type,
      amount: debit,
      reason,
      balance: acct.balances[type],
    };
  } catch (_) {
    return { ok: false, error: "spendResource failed" };
  }
}

// ── Trade Pair Tracking ──────────────────────────────────────────────────────

function pairKey(a, b) {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function isFirstTrade(entityA, entityB) {
  return !_tradePairs.has(pairKey(entityA, entityB));
}

function recordTradePair(entityA, entityB) {
  _tradePairs.set(pairKey(entityA, entityB), true);
}

// ── Trade System ─────────────────────────────────────────────────────────────

/**
 * Propose a trade between two entities.
 *
 * @param {string} proposerId
 * @param {string} counterpartyId
 * @param {{ type: string, amount: number }} offering
 * @param {{ type: string, amount: number }} requesting
 */
export function proposeTrade(proposerId, counterpartyId, offering, requesting) {
  try {
    if (!proposerId || !counterpartyId || !offering || !requesting) {
      return { ok: false, error: "proposerId, counterpartyId, offering, requesting required" };
    }
    if (proposerId === counterpartyId) {
      return { ok: false, error: "cannot trade with self" };
    }
    if (!ALL_RESOURCES.includes(offering.type)) {
      return { ok: false, error: `unknown offering type: ${offering.type}` };
    }
    if (!ALL_RESOURCES.includes(requesting.type)) {
      return { ok: false, error: `unknown requesting type: ${requesting.type}` };
    }

    const offerAmt  = Math.floor(Number(offering.amount) || 0);
    const reqAmt    = Math.floor(Number(requesting.amount) || 0);

    if (offerAmt < TRADE_MIN || offerAmt > TRADE_MAX) {
      return { ok: false, error: `offering amount must be ${TRADE_MIN}-${TRADE_MAX}` };
    }
    if (reqAmt < TRADE_MIN || reqAmt > TRADE_MAX) {
      return { ok: false, error: `requesting amount must be ${TRADE_MIN}-${TRADE_MAX}` };
    }

    const proposer = _accounts.get(proposerId);
    if (!proposer) return { ok: false, error: "proposer_account_not_found" };

    const counterparty = _accounts.get(counterpartyId);
    if (!counterparty) return { ok: false, error: "counterparty_account_not_found" };

    // Proposer must have sufficient balance for offering
    if (proposer.balances[offering.type] < offerAmt) {
      return { ok: false, error: "proposer_insufficient_balance", available: proposer.balances[offering.type] };
    }

    const tradeId = uid("trd");
    const trade = {
      tradeId,
      proposer:     proposerId,
      counterparty: counterpartyId,
      status:       "proposed",
      offering:     { type: offering.type, amount: offerAmt },
      requesting:   { type: requesting.type, amount: reqAmt },
      expiresAt:    _tick + TRADE_EXPIRY,
      proposedAt:   nowISO(),
      completedAt:  null,
    };

    _trades.set(tradeId, trade);

    // Update demand in market
    const reqMarket = ensureMarket(requesting.type);
    reqMarket.demand += reqAmt;

    _metrics.totalTrades++;

    return { ok: true, trade: { ...trade } };
  } catch (_) {
    return { ok: false, error: "proposeTrade failed" };
  }
}

/**
 * Accept a trade.  Resources transfer atomically.
 * Only the counterparty may accept.
 */
export function acceptTrade(tradeId, entityId) {
  try {
    if (!tradeId || !entityId) return { ok: false, error: "tradeId and entityId required" };

    const trade = _trades.get(tradeId);
    if (!trade) return { ok: false, error: "trade_not_found" };
    if (trade.status !== "proposed") return { ok: false, error: `trade status is ${trade.status}, not proposed` };
    if (trade.counterparty !== entityId) return { ok: false, error: "only counterparty can accept" };
    if (_tick > trade.expiresAt) {
      trade.status = "expired";
      _metrics.expiredTrades++;
      return { ok: false, error: "trade_expired" };
    }

    const proposer     = _accounts.get(trade.proposer);
    const counterparty = _accounts.get(trade.counterparty);
    if (!proposer || !counterparty) return { ok: false, error: "account_not_found" };

    // Verify both sides can fulfil
    if (proposer.balances[trade.offering.type] < trade.offering.amount) {
      trade.status = "cancelled";
      return { ok: false, error: "proposer_insufficient_balance" };
    }
    if (counterparty.balances[trade.requesting.type] < trade.requesting.amount) {
      return { ok: false, error: "counterparty_insufficient_balance" };
    }

    // Determine first-trade bonus
    const firstTrade = isFirstTrade(trade.proposer, trade.counterparty);
    const bonusMul   = firstTrade ? (1 + FIRST_TRADE_BONUS) : 1;

    // Atomic transfer — proposer sends offering, receives requesting
    proposer.balances[trade.offering.type]       -= trade.offering.amount;
    counterparty.balances[trade.offering.type]    += Math.round(trade.offering.amount * bonusMul * 100) / 100;

    counterparty.balances[trade.requesting.type]  -= trade.requesting.amount;
    proposer.balances[trade.requesting.type]       += Math.round(trade.requesting.amount * bonusMul * 100) / 100;

    // Record in spent/earned
    proposer.spent[trade.offering.type]        += trade.offering.amount;
    proposer.earned[trade.requesting.type]     += Math.round(trade.requesting.amount * bonusMul * 100) / 100;
    counterparty.spent[trade.requesting.type]  += trade.requesting.amount;
    counterparty.earned[trade.offering.type]   += Math.round(trade.offering.amount * bonusMul * 100) / 100;

    trade.status      = "completed";
    trade.completedAt = nowISO();
    trade.firstTradeBonus = firstTrade;

    // Update credit ratings — completing trades improves rating
    proposer.creditRating     = clamp01(proposer.creditRating + 0.02);
    counterparty.creditRating = clamp01(counterparty.creditRating + 0.02);

    proposer.lastActivity     = nowISO();
    counterparty.lastActivity = nowISO();

    // Track trade pair
    recordTradePair(trade.proposer, trade.counterparty);

    // Append to trade histories (capped)
    const entry = {
      tradeId,
      at: trade.completedAt,
      offering: trade.offering,
      requesting: trade.requesting,
      firstTradeBonus: firstTrade,
    };
    proposer.tradeHistory.push(entry);
    if (proposer.tradeHistory.length > TRADE_HISTORY_CAP) {
      proposer.tradeHistory = proposer.tradeHistory.slice(-TRADE_HISTORY_CAP);
    }
    counterparty.tradeHistory.push(entry);
    if (counterparty.tradeHistory.length > TRADE_HISTORY_CAP) {
      counterparty.tradeHistory = counterparty.tradeHistory.slice(-TRADE_HISTORY_CAP);
    }

    // Update market data — demand decreases, record price ratio
    const reqMarket = ensureMarket(trade.requesting.type);
    reqMarket.demand = Math.max(0, reqMarket.demand - trade.requesting.amount);
    reqMarket.tradeCount++;

    // Record exchange rate in price history
    if (trade.offering.type !== trade.requesting.type) {
      const ratio = trade.offering.amount / trade.requesting.amount;
      const rateKey = `${trade.offering.type}_to_${trade.requesting.type}`;
      reqMarket.priceHistory.push({ rateKey, ratio, at: trade.completedAt });
      if (reqMarket.priceHistory.length > PRICE_HISTORY_CAP) {
        reqMarket.priceHistory = reqMarket.priceHistory.slice(-PRICE_HISTORY_CAP);
      }

      const offMarket = ensureMarket(trade.offering.type);
      const inverseRatio = trade.requesting.amount / trade.offering.amount;
      const inverseKey = `${trade.requesting.type}_to_${trade.offering.type}`;
      offMarket.priceHistory.push({ rateKey: inverseKey, ratio: inverseRatio, at: trade.completedAt });
      if (offMarket.priceHistory.length > PRICE_HISTORY_CAP) {
        offMarket.priceHistory = offMarket.priceHistory.slice(-PRICE_HISTORY_CAP);
      }
    }

    _metrics.completedTrades++;

    return { ok: true, trade: { ...trade }, firstTradeBonus: firstTrade };
  } catch (_) {
    return { ok: false, error: "acceptTrade failed" };
  }
}

/**
 * Reject a trade.  Only the counterparty may reject.
 */
export function rejectTrade(tradeId, entityId) {
  try {
    if (!tradeId || !entityId) return { ok: false, error: "tradeId and entityId required" };

    const trade = _trades.get(tradeId);
    if (!trade) return { ok: false, error: "trade_not_found" };
    if (trade.status !== "proposed") return { ok: false, error: `trade status is ${trade.status}` };
    if (trade.counterparty !== entityId) return { ok: false, error: "only counterparty can reject" };

    trade.status = "rejected";

    // Release demand
    const reqMarket = ensureMarket(trade.requesting.type);
    reqMarket.demand = Math.max(0, reqMarket.demand - trade.requesting.amount);

    // Slight credit rating penalty for rejector — very minor
    const counterparty = _accounts.get(entityId);
    if (counterparty) {
      counterparty.creditRating = clamp01(counterparty.creditRating - 0.005);
    }

    _metrics.rejectedTrades++;

    return { ok: true, trade: { ...trade } };
  } catch (_) {
    return { ok: false, error: "rejectTrade failed" };
  }
}

/**
 * Cancel a trade.  Only the proposer may cancel.
 */
export function cancelTrade(tradeId, entityId) {
  try {
    if (!tradeId || !entityId) return { ok: false, error: "tradeId and entityId required" };

    const trade = _trades.get(tradeId);
    if (!trade) return { ok: false, error: "trade_not_found" };
    if (trade.status !== "proposed") return { ok: false, error: `trade status is ${trade.status}` };
    if (trade.proposer !== entityId) return { ok: false, error: "only proposer can cancel" };

    trade.status = "cancelled";

    // Release demand
    const reqMarket = ensureMarket(trade.requesting.type);
    reqMarket.demand = Math.max(0, reqMarket.demand - trade.requesting.amount);

    _metrics.cancelledTrades++;

    return { ok: true, trade: { ...trade } };
  } catch (_) {
    return { ok: false, error: "cancelTrade failed" };
  }
}

/**
 * Get trade details.
 */
export function getTrade(tradeId) {
  try {
    if (!tradeId) return { ok: false, error: "tradeId required" };
    const trade = _trades.get(tradeId);
    if (!trade) return { ok: false, error: "trade_not_found" };
    return { ok: true, trade: { ...trade } };
  } catch (_) {
    return { ok: false, error: "getTrade failed" };
  }
}

/**
 * List trades with optional filters.
 *
 * @param {object} [filters]
 * @param {string} [filters.status]   - filter by status
 * @param {string} [filters.entityId] - filter by proposer OR counterparty
 * @param {number} [filters.limit]    - max results (default 100)
 */
export function listTrades(filters = {}) {
  try {
    const limit = Math.min(Number(filters.limit) || 100, 500);
    const out = [];

    for (const trade of _trades.values()) {
      if (filters.status && trade.status !== filters.status) continue;
      if (filters.entityId && trade.proposer !== filters.entityId && trade.counterparty !== filters.entityId) continue;
      out.push({ ...trade });
      if (out.length >= limit) break;
    }

    return { ok: true, trades: out, count: out.length };
  } catch (_) {
    return { ok: false, error: "listTrades failed" };
  }
}

// ── Specialization ───────────────────────────────────────────────────────────

/**
 * Declare or switch specialisation for an entity.
 *
 * - First declaration: level starts at 0.0
 * - Switch to different domain: level resets to 0.3
 * - Same domain again: no-op
 *
 * @param {string} entityId
 * @param {string} domain
 */
export function specialize(entityId, domain) {
  try {
    if (!entityId || !domain) return { ok: false, error: "entityId and domain required" };

    const acct = _accounts.get(entityId);
    if (!acct) return { ok: false, error: "account_not_found" };

    if (acct.specialization === domain) {
      return { ok: true, entityId, domain, level: acct.specializationLevel, changed: false };
    }

    const previousDomain = acct.specialization;
    const switching = previousDomain !== null;

    acct.specialization      = domain;
    acct.specializationLevel = switching ? SPECIALIZATION_RESET_TO : 0.0;
    acct.lastActivity        = nowISO();

    return {
      ok: true,
      entityId,
      domain,
      level: acct.specializationLevel,
      changed: true,
      previousDomain,
      switched: switching,
    };
  } catch (_) {
    return { ok: false, error: "specialize failed" };
  }
}

/**
 * Get specialisation info for an entity.
 */
export function getSpecialization(entityId) {
  try {
    if (!entityId) return { ok: false, error: "entityId required" };

    const acct = _accounts.get(entityId);
    if (!acct) return { ok: false, error: "account_not_found" };

    return {
      ok: true,
      entityId,
      specialization: acct.specialization,
      level: acct.specializationLevel,
      bonusMultiplier: acct.specialization ? SPECIALIZATION_BONUS : 1,
      penaltyMultiplier: acct.specialization ? SPECIALIZATION_PENALTY : 1,
    };
  } catch (_) {
    return { ok: false, error: "getSpecialization failed" };
  }
}

/**
 * Deepen specialisation by a small increment.
 * Called externally when an entity creates a relevant DTU.
 */
export function deepenSpecialization(entityId, domain) {
  try {
    const acct = _accounts.get(entityId);
    if (!acct) return { ok: false, error: "account_not_found" };
    if (acct.specialization !== domain) return { ok: false, error: "domain_mismatch" };

    acct.specializationLevel = clamp01(acct.specializationLevel + SPECIALIZATION_GROWTH);
    acct.lastActivity = nowISO();

    return { ok: true, entityId, domain, level: acct.specializationLevel };
  } catch (_) {
    return { ok: false, error: "deepenSpecialization failed" };
  }
}

// ── Market Rates ─────────────────────────────────────────────────────────────

/**
 * Compute exchange rates from recent trade data.
 * Rates emerge from actual trade patterns — not fixed.
 */
function computeExchangeRates() {
  try {
    const ratios = {};   // "a_to_b" -> [ratio, ratio, ...]

    for (const market of _markets.values()) {
      for (const entry of market.priceHistory) {
        if (!ratios[entry.rateKey]) ratios[entry.rateKey] = [];
        ratios[entry.rateKey].push(entry.ratio);
      }
    }

    // Compute average exchange rates from recent trade ratios
    const rates = {};
    for (const [key, values] of Object.entries(ratios)) {
      if (values.length === 0) continue;
      // Use last 20 trades as recent window
      const recent = values.slice(-20);
      const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
      rates[key] = Math.round(avg * 1000) / 1000;
    }

    // Write back to markets
    for (const market of _markets.values()) {
      market.exchangeRates = {};
      for (const [key, val] of Object.entries(rates)) {
        if (key.startsWith(`${market.resourceType}_to_`)) {
          market.exchangeRates[key] = val;
        }
      }
    }

    return rates;
  } catch (_) {
    return {};
  }
}

/**
 * Compute average trade volume per resource.
 */
function computeAvgVolumes() {
  try {
    for (const market of _markets.values()) {
      if (market.tradeCount === 0) {
        market.avgTradeVolume = 0;
        continue;
      }
      // Sum amounts from recent price history entries
      let totalVolume = 0;
      for (const entry of market.priceHistory) {
        totalVolume += entry.ratio;
      }
      market.avgTradeVolume = market.priceHistory.length > 0
        ? Math.round((totalVolume / market.priceHistory.length) * 100) / 100
        : 0;
      market.lastUpdated = nowISO();
    }
  } catch (_) {
    // silent
  }
}

/**
 * Get current exchange rates and market data.
 */
export function getMarketRates() {
  try {
    computeExchangeRates();
    computeAvgVolumes();

    const out = {};
    for (const [rType, market] of _markets.entries()) {
      out[rType] = {
        supply: market.supply,
        demand: market.demand,
        exchangeRates: { ...market.exchangeRates },
        avgTradeVolume: market.avgTradeVolume,
        priceHistory: market.priceHistory.slice(-20),
      };
    }

    return { ok: true, markets: out };
  } catch (_) {
    return { ok: false, error: "getMarketRates failed" };
  }
}

// ── Economic Cycle ───────────────────────────────────────────────────────────

/**
 * Recalculate total supply for each resource across all accounts.
 */
function computeTotalSupply() {
  const totals = zeroBalances();
  for (const acct of _accounts.values()) {
    for (const r of ALL_RESOURCES) {
      totals[r] += acct.balances[r];
    }
  }
  return totals;
}

/**
 * Expire stale proposed trades.
 */
function expireOldTrades() {
  let expired = 0;
  for (const trade of _trades.values()) {
    if (trade.status === "proposed" && _tick > trade.expiresAt) {
      trade.status = "expired";
      // Release demand
      const reqMarket = ensureMarket(trade.requesting.type);
      reqMarket.demand = Math.max(0, reqMarket.demand - trade.requesting.amount);
      expired++;
    }
  }
  _metrics.expiredTrades += expired;
  return expired;
}

/**
 * Inflation check: if total supply of a resource grew > 20 % since last
 * snapshot (within INFLATION_WINDOW ticks), apply 5 % proportional tax.
 */
function inflationCheck(currentSupply) {
  let taxEvents = 0;

  for (const r of ALL_RESOURCES) {
    const snap = _supplySnapshots.get(r);
    if (!snap || (_tick - snap.tick) < INFLATION_WINDOW) continue;

    const growth = snap.totalSupply > 0
      ? (currentSupply[r] - snap.totalSupply) / snap.totalSupply
      : 0;

    if (growth > INFLATION_THRESHOLD) {
      // Apply proportional tax
      for (const acct of _accounts.values()) {
        const tax = Math.floor(acct.balances[r] * INFLATION_TAX_RATE * 100) / 100;
        if (tax > 0) {
          acct.balances[r] = Math.max(0, acct.balances[r] - tax);
        }
      }
      taxEvents++;
      _metrics.inflationEvents++;
    }

    // Update snapshot
    _supplySnapshots.set(r, { tick: _tick, totalSupply: currentSupply[r] });
  }

  return taxEvents;
}

/**
 * Deflation check: if total supply of a resource dropped > 20 % since last
 * snapshot, distribute UBI boost of +5 compute to all entities.
 */
function deflationCheck(currentSupply) {
  let boostEvents = 0;

  for (const r of ALL_RESOURCES) {
    const snap = _supplySnapshots.get(r);
    if (!snap || (_tick - snap.tick) < INFLATION_WINDOW) continue;

    const drop = snap.totalSupply > 0
      ? (snap.totalSupply - currentSupply[r]) / snap.totalSupply
      : 0;

    if (drop > DEFLATION_THRESHOLD) {
      // Distribute UBI boost: +5 compute to all
      for (const acct of _accounts.values()) {
        acct.balances[RESOURCE_TYPES.COMPUTE] += DEFLATION_UBI_BOOST;
        acct.earned[RESOURCE_TYPES.COMPUTE]   += DEFLATION_UBI_BOOST;
      }
      const m = ensureMarket(RESOURCE_TYPES.COMPUTE);
      m.supply += DEFLATION_UBI_BOOST * _accounts.size;
      boostEvents++;
      _metrics.deflationEvents++;
    }
  }

  return boostEvents;
}

/**
 * Wealth concentration check: if any entity holds > 15 % of total supply
 * of any resource, redistribute the excess proportionally.
 */
function wealthConcentrationCheck(currentSupply) {
  let redistributions = 0;

  for (const r of ALL_RESOURCES) {
    if (currentSupply[r] <= 0) continue;
    const cap = currentSupply[r] * WEALTH_CAP_RATIO;

    for (const acct of _accounts.values()) {
      if (acct.balances[r] > cap) {
        const excess = acct.balances[r] - cap;
        acct.balances[r] = cap;

        // Distribute excess evenly to all OTHER accounts
        const others = [];
        for (const other of _accounts.values()) {
          if (other.entityId !== acct.entityId) others.push(other);
        }

        if (others.length > 0) {
          const share = Math.floor((excess / others.length) * 100) / 100;
          for (const other of others) {
            other.balances[r] += share;
            other.earned[r]   += share;
          }
        }

        redistributions++;
        _metrics.redistributionEvents++;
      }
    }
  }

  return redistributions;
}

/**
 * Universal Basic Income: +1 compute per 10 ticks.
 */
function distributeUBI() {
  if (_tick % 10 !== 0) return 0;

  let distributed = 0;
  for (const acct of _accounts.values()) {
    acct.balances[RESOURCE_TYPES.COMPUTE] += 1;
    acct.earned[RESOURCE_TYPES.COMPUTE]   += 1;
    distributed++;
  }

  const m = ensureMarket(RESOURCE_TYPES.COMPUTE);
  m.supply += distributed;

  return distributed;
}

/**
 * Take a snapshot of current supply for future inflation/deflation comparison.
 */
function snapshotSupply(currentSupply) {
  for (const r of ALL_RESOURCES) {
    if (!_supplySnapshots.has(r)) {
      _supplySnapshots.set(r, { tick: _tick, totalSupply: currentSupply[r] });
    }
  }
}

/**
 * Run one full economic cycle — inflation/deflation checks,
 * wealth concentration, UBI, trade expiry, rate computation.
 *
 * Call this once per tick from the main loop.
 */
export function runEconomicCycle() {
  try {
    _tick++;

    const currentSupply = computeTotalSupply();

    // Snapshot on first run
    snapshotSupply(currentSupply);

    // Update market supply values
    for (const r of ALL_RESOURCES) {
      const m = ensureMarket(r);
      m.supply = currentSupply[r];
    }

    const expired          = expireOldTrades();
    const inflationTax     = inflationCheck(currentSupply);
    const deflationBoost   = deflationCheck(currentSupply);
    const redistributions  = wealthConcentrationCheck(computeTotalSupply());
    const ubiDistributed   = distributeUBI();

    // Recompute exchange rates
    computeExchangeRates();
    computeAvgVolumes();

    _metrics.cyclesRun++;

    return {
      ok: true,
      tick: _tick,
      expired,
      inflationTax,
      deflationBoost,
      redistributions,
      ubiDistributed,
      accountCount: _accounts.size,
      openTrades: [..._trades.values()].filter(t => t.status === "proposed").length,
    };
  } catch (_) {
    return { ok: false, error: "runEconomicCycle failed" };
  }
}

// ── Wealth Distribution ──────────────────────────────────────────────────────

/**
 * Compute Gini coefficient and distribution stats.
 *
 * Gini = 0 means perfect equality, 1 means perfect inequality.
 */
export function getWealthDistribution() {
  try {
    const n = _accounts.size;
    if (n === 0) {
      return {
        ok: true,
        gini: 0,
        totalWealth: 0,
        avgWealth: 0,
        medianWealth: 0,
        distribution: [],
        accountCount: 0,
      };
    }

    // Compute total wealth per entity (sum of all resource balances)
    const wealths = [];
    for (const acct of _accounts.values()) {
      let total = 0;
      for (const r of ALL_RESOURCES) {
        total += acct.balances[r];
      }
      wealths.push({ entityId: acct.entityId, wealth: total });
    }

    wealths.sort((a, b) => a.wealth - b.wealth);

    const totalWealth = wealths.reduce((s, w) => s + w.wealth, 0);
    const avgWealth   = totalWealth / n;
    const medianWealth = n % 2 === 0
      ? (wealths[Math.floor(n / 2) - 1].wealth + wealths[Math.floor(n / 2)].wealth) / 2
      : wealths[Math.floor(n / 2)].wealth;

    // Gini coefficient
    let sumDiffs = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        sumDiffs += Math.abs(wealths[i].wealth - wealths[j].wealth);
      }
    }
    const gini = totalWealth > 0
      ? Math.round((sumDiffs / (2 * n * totalWealth)) * 1000) / 1000
      : 0;

    // Per-resource distribution
    const perResource = {};
    for (const r of ALL_RESOURCES) {
      const vals = [];
      for (const acct of _accounts.values()) vals.push(acct.balances[r]);
      vals.sort((a, b) => a - b);
      const total = vals.reduce((s, v) => s + v, 0);
      perResource[r] = {
        total,
        avg: n > 0 ? Math.round((total / n) * 100) / 100 : 0,
        min: vals[0] || 0,
        max: vals[vals.length - 1] || 0,
        median: n % 2 === 0
          ? (vals[Math.floor(n / 2) - 1] + vals[Math.floor(n / 2)]) / 2
          : vals[Math.floor(n / 2)],
      };
    }

    return {
      ok: true,
      gini,
      totalWealth: Math.round(totalWealth * 100) / 100,
      avgWealth: Math.round(avgWealth * 100) / 100,
      medianWealth: Math.round(medianWealth * 100) / 100,
      distribution: wealths,
      perResource,
      accountCount: n,
    };
  } catch (_) {
    return { ok: false, error: "getWealthDistribution failed" };
  }
}

// ── Economy Metrics ──────────────────────────────────────────────────────────

/**
 * Global economy stats.
 */
export function getEconomyMetrics() {
  try {
    const currentSupply = computeTotalSupply();
    const openTrades    = [..._trades.values()].filter(t => t.status === "proposed").length;

    // Count unique trade pairs
    const uniquePairs = _tradePairs.size;

    // Specialisation breakdown
    const specBreakdown = {};
    let specialised = 0;
    for (const acct of _accounts.values()) {
      if (acct.specialization) {
        specialised++;
        specBreakdown[acct.specialization] = (specBreakdown[acct.specialization] || 0) + 1;
      }
    }

    // Average credit rating
    let totalRating = 0;
    for (const acct of _accounts.values()) totalRating += acct.creditRating;
    const avgCreditRating = _accounts.size > 0
      ? Math.round((totalRating / _accounts.size) * 1000) / 1000
      : 0;

    return {
      ok: true,
      tick: _tick,
      accounts: _accounts.size,
      totalSupply: currentSupply,
      openTrades,
      uniqueTradePairs: uniquePairs,
      specialised,
      specializationBreakdown: specBreakdown,
      avgCreditRating,
      metrics: { ..._metrics },
    };
  } catch (_) {
    return { ok: false, error: "getEconomyMetrics failed" };
  }
}
