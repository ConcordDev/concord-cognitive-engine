// server/domains/markets.js
//
// Derivatives + global-markets companion to the equity-focused `market` lens.
// Per research dispatched 2026-05-16: options chains with greeks, futures
// continuous contracts, FX major pairs, simulated L2 depth, alerts/scanner.
// Per-user state, BSM-derived greeks, CME-symbol-native futures.

// ──────────────────────────────────────────────────────────────
// Black-Scholes pure JS (Abramowitz & Stegun rational approx).
// ──────────────────────────────────────────────────────────────

function normCdf(x) {
  // Abramowitz & Stegun 26.2.17 — ~7-digit accuracy
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804 * Math.exp(-x * x / 2);
  const p =
    d * t *
    (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

function bsm({ S, K, r, sigma, T, q = 0 }) {
  // S = spot, K = strike, r = risk-free, sigma = vol, T = years, q = dividend yield
  if (S <= 0 || K <= 0 || T <= 0 || sigma <= 0) {
    return { call: 0, put: 0, d1: 0, d2: 0, callDelta: 0, putDelta: 0, gamma: 0, vega: 0, callTheta: 0, putTheta: 0, callRho: 0, putRho: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + sigma * sigma / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const Nd1 = normCdf(d1);
  const Nd2 = normCdf(d2);
  const Nmd1 = normCdf(-d1);
  const Nmd2 = normCdf(-d2);
  const pdf = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-d1 * d1 / 2);
  const eqT = Math.exp(-q * T);
  const erT = Math.exp(-r * T);
  return {
    call: S * eqT * Nd1 - K * erT * Nd2,
    put:  K * erT * Nmd2 - S * eqT * Nmd1,
    d1, d2,
    callDelta:  eqT * Nd1,
    putDelta:   eqT * (Nd1 - 1),
    gamma:      (eqT * pdf) / (S * sigma * sqrtT),
    vega:       S * eqT * pdf * sqrtT * 0.01,        // per 1% IV move
    callTheta: -((S * eqT * pdf * sigma) / (2 * sqrtT) + r * K * erT * Nd2 - q * S * eqT * Nd1) / 365,
    putTheta:  -((S * eqT * pdf * sigma) / (2 * sqrtT) - r * K * erT * Nmd2 + q * S * eqT * Nmd1) / 365,
    callRho:    (K * T * erT * Nd2) * 0.01,           // per 1% rate move
    putRho:    -(K * T * erT * Nmd2) * 0.01,
  };
}

function round(n, dp = 4) {
  const m = Math.pow(10, dp);
  return Math.round(n * m) / m;
}

// ──────────────────────────────────────────────────────────────
// CME futures symbol table.
// ──────────────────────────────────────────────────────────────

const CME_CONTRACTS = {
  ES: { name: "E-mini S&P 500",     tickSize: 0.25,  tickValue: 12.50,  multiplier: 50,    initialMargin: 13_200,  cycle: "HMUZ" },
  NQ: { name: "E-mini Nasdaq-100",  tickSize: 0.25,  tickValue: 5.00,   multiplier: 20,    initialMargin: 19_800,  cycle: "HMUZ" },
  YM: { name: "E-mini Dow Jones",   tickSize: 1,     tickValue: 5.00,   multiplier: 5,     initialMargin: 9_900,   cycle: "HMUZ" },
  RTY:{ name: "E-mini Russell 2000",tickSize: 0.10,  tickValue: 5.00,   multiplier: 50,    initialMargin: 6_600,   cycle: "HMUZ" },
  CL: { name: "Crude Oil",          tickSize: 0.01,  tickValue: 10.00,  multiplier: 1000,  initialMargin: 6_490,   cycle: "monthly" },
  GC: { name: "Gold",               tickSize: 0.10,  tickValue: 10.00,  multiplier: 100,   initialMargin: 13_750,  cycle: "GJMQVZ" },
  SI: { name: "Silver",             tickSize: 0.005, tickValue: 25.00,  multiplier: 5000,  initialMargin: 19_800,  cycle: "HKNUZ" },
  ZN: { name: "10-Year T-Note",     tickSize: 0.0156,tickValue: 15.625, multiplier: 100_000,initialMargin:1_650,   cycle: "HMUZ" },
  ZB: { name: "30-Year T-Bond",     tickSize: 0.0313,tickValue: 31.25,  multiplier: 100_000,initialMargin:5_500,   cycle: "HMUZ" },
};

const FX_MAJORS = [
  { pair: "EURUSD", pip: 0.0001, name: "Euro / US Dollar" },
  { pair: "GBPUSD", pip: 0.0001, name: "British Pound / US Dollar" },
  { pair: "USDJPY", pip: 0.01,   name: "US Dollar / Japanese Yen" },
  { pair: "USDCHF", pip: 0.0001, name: "US Dollar / Swiss Franc" },
  { pair: "USDCAD", pip: 0.0001, name: "US Dollar / Canadian Dollar" },
  { pair: "AUDUSD", pip: 0.0001, name: "Australian Dollar / US Dollar" },
  { pair: "NZDUSD", pip: 0.0001, name: "New Zealand Dollar / US Dollar" },
];

// Sample mid-price seed (in a real deployment these would be live).
const FX_SAMPLE_MID = {
  EURUSD: 1.0875, GBPUSD: 1.2640, USDJPY: 149.85, USDCHF: 0.8825,
  USDCAD: 1.3580, AUDUSD: 0.6620, NZDUSD: 0.6105,
};

// ──────────────────────────────────────────────────────────────
// Registration
// ──────────────────────────────────────────────────────────────

export default function registerMarketsActions(registerLensAction) {
  // ── State (per-user alerts cache) ──

  function getMarketsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.marketsLens) {
      STATE.marketsLens = {
        alerts: new Map(), // userId -> Array<alert>
      };
    }
    return STATE.marketsLens;
  }
  function saveMarketsState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function marketsActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextMarketsId(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function nowIsoMkt() { return new Date().toISOString(); }

  // ── Options chain (BSM-derived greeks) ──

  registerLensAction("markets", "options-chain", (_ctx, _artifact, params = {}) => {
    const symbol = String(params.symbol || "SPY").toUpperCase();
    const spot = Number(params.spot) || 450;
    const iv = Number(params.iv) || 0.18;
    const r = Number(params.r) || 0.05;
    const daysToExpiry = Number(params.daysToExpiry) || 30;
    if (spot <= 0) return { ok: false, error: "spot must be > 0" };
    if (iv <= 0 || iv > 5) return { ok: false, error: "iv must be 0..5 (decimal, e.g. 0.18 for 18%)" };
    if (daysToExpiry <= 0) return { ok: false, error: "daysToExpiry must be > 0" };
    const T = daysToExpiry / 365;
    const strikeStep = Math.max(1, Math.round(spot * 0.025));
    const strikes = [];
    for (let s = spot - strikeStep * 5; s <= spot + strikeStep * 5; s += strikeStep) {
      strikes.push(Math.round(s));
    }
    const chain = strikes.map((K) => {
      const g = bsm({ S: spot, K, r, sigma: iv, T });
      return {
        strike: K,
        call: {
          mark: round(g.call, 2),
          delta: round(g.callDelta, 4),
          theta: round(g.callTheta, 4),
          rho: round(g.callRho, 4),
        },
        put: {
          mark: round(g.put, 2),
          delta: round(g.putDelta, 4),
          theta: round(g.putTheta, 4),
          rho: round(g.putRho, 4),
        },
        gamma: round(g.gamma, 5),
        vega: round(g.vega, 4),
      };
    });
    return {
      ok: true,
      result: {
        symbol, spot, iv, daysToExpiry, r,
        chain,
        notes: "Greeks derived from Black-Scholes. IV input is required (use realized vol if no live IV).",
      },
    };
  });

  // ── Futures board (CME contracts with simulated bid/ask) ──

  function frontMonth(_now = new Date()) {
    // Simplified: pick next quarter for HMUZ cycle. Real impl needs full calendar.
    const codes = ["H", "M", "U", "Z"]; // Mar/Jun/Sep/Dec
    const month = new Date().getMonth();
    if (month < 3) return codes[0];
    if (month < 6) return codes[1];
    if (month < 9) return codes[2];
    return codes[3];
  }

  registerLensAction("markets", "futures-board", (_ctx, _artifact, params = {}) => {
    const filterSymbol = params.symbol ? String(params.symbol).toUpperCase() : null;
    const yearCode = String(new Date().getFullYear() % 10);
    const monthCode = frontMonth();
    const contracts = Object.entries(CME_CONTRACTS)
      .filter(([sym]) => !filterSymbol || sym === filterSymbol)
      .map(([sym, spec]) => {
        // Synthesize a plausible last + change from sym hash
        const seed = Array.from(sym).reduce((a, c) => a + c.charCodeAt(0), 0);
        const lastPrice = sym === "CL" ? 75 + (seed % 20)
          : sym === "GC" ? 2300 + (seed % 50)
          : sym === "SI" ? 28 + (seed % 5)
          : sym === "ES" ? 5800 + (seed % 100)
          : sym === "NQ" ? 20_500 + (seed % 200)
          : sym === "YM" ? 43_200 + (seed % 300)
          : sym === "RTY" ? 2350 + (seed % 25)
          : sym === "ZN" ? 110 + (seed % 5)
          : 120 + (seed % 10);
        const change = ((seed % 20) - 10) * spec.tickSize * 2;
        return {
          symbol: sym,
          frontContract: `${sym}${monthCode}${yearCode}`,
          name: spec.name,
          last: round(lastPrice, 2),
          change: round(change, 2),
          changePercent: round((change / lastPrice) * 100, 2),
          tickSize: spec.tickSize,
          tickValue: spec.tickValue,
          multiplier: spec.multiplier,
          initialMargin: spec.initialMargin,
          cycle: spec.cycle,
        };
      });
    return { ok: true, result: { contracts, count: contracts.length, source: "simulated" } };
  });

  // ── Forex pairs grid ──

  registerLensAction("markets", "forex-quotes", (_ctx, _artifact, params = {}) => {
    const pairs = Array.isArray(params.pairs) && params.pairs.length > 0
      ? params.pairs.map((p) => String(p).toUpperCase())
      : FX_MAJORS.map((m) => m.pair);
    const result = pairs
      .map((p) => {
        const meta = FX_MAJORS.find((m) => m.pair === p);
        if (!meta) return null;
        const mid = FX_SAMPLE_MID[p];
        if (!mid) return null;
        const spread = meta.pip * 0.5;
        const bid = mid - spread / 2;
        const ask = mid + spread / 2;
        // Pip value per standard lot (100,000 units)
        const pipValue = p.endsWith("USD") ? meta.pip * 100_000 : Math.round(meta.pip * 100_000 / mid * 100) / 100;
        return {
          pair: p,
          name: meta.name,
          bid: round(bid, p.includes("JPY") ? 3 : 5),
          ask: round(ask, p.includes("JPY") ? 3 : 5),
          spread: round(spread, p.includes("JPY") ? 3 : 5),
          spreadPips: 0.5,
          pipValue,
        };
      })
      .filter(Boolean);
    return { ok: true, result: { quotes: result, count: result.length, source: "sample" } };
  });

  // ── Depth of book (simulated L2 from heuristic) ──

  registerLensAction("markets", "depth-of-book", (_ctx, _artifact, params = {}) => {
    const symbol = String(params.symbol || "SPY").toUpperCase();
    const last = Number(params.last) || 450;
    const tickSize = Number(params.tickSize) || 0.01;
    const levels = Math.max(5, Math.min(20, Number(params.levels) || 10));
    if (last <= 0) return { ok: false, error: "last must be > 0" };
    const seed = Array.from(symbol).reduce((a, c) => a + c.charCodeAt(0), 0);
    function vol(level) {
      // Gaussian-decay volume around the inside quote
      const base = 100 + (seed % 50);
      return Math.round(base * Math.exp(-level * level * 0.15) * (0.7 + ((seed >> level) & 0xff) / 0xff * 0.6));
    }
    const bids = [];
    const asks = [];
    for (let i = 1; i <= levels; i++) {
      bids.push({ price: round(last - tickSize * i, 4), size: vol(i) });
      asks.push({ price: round(last + tickSize * i, 4), size: vol(i) });
    }
    return {
      ok: true,
      result: {
        symbol,
        last,
        bids,
        asks,
        spread: round(asks[0].price - bids[0].price, 4),
        kind: "simulated",
        notes: "Synthesized from public OHLCV-style heuristic; NOT real Level 2 data.",
      },
    };
  });

  // ── Alerts (per-user) ──

  registerLensAction("markets", "alerts-list", (ctx, _artifact, _params = {}) => {
    const s = getMarketsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = marketsActor(ctx);
    const arr = s.alerts.get(userId) || [];
    return { ok: true, result: { alerts: arr } };
  });

  registerLensAction("markets", "alert-create", (ctx, _artifact, params = {}) => {
    const s = getMarketsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = marketsActor(ctx);
    const symbol = String(params.symbol || "").toUpperCase().trim();
    if (!symbol) return { ok: false, error: "symbol required" };
    const condition = String(params.condition || "");
    if (!["price_above", "price_below", "iv_above", "iv_below"].includes(condition)) {
      return { ok: false, error: "condition must be price_above | price_below | iv_above | iv_below" };
    }
    const threshold = Number(params.threshold);
    if (!Number.isFinite(threshold)) return { ok: false, error: "threshold must be a number" };
    const alert = {
      id: nextMarketsId("alert"),
      symbol, condition, threshold,
      status: "active",
      createdAt: nowIsoMkt(),
    };
    if (!s.alerts.has(userId)) s.alerts.set(userId, []);
    s.alerts.get(userId).push(alert);
    saveMarketsState();
    return { ok: true, result: { alert } };
  });

  registerLensAction("markets", "alert-cancel", (ctx, _artifact, params = {}) => {
    const s = getMarketsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = marketsActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const arr = s.alerts.get(userId) || [];
    const a = arr.find((x) => x.id === id);
    if (!a) return { ok: false, error: "not found" };
    a.status = "cancelled";
    a.cancelledAt = nowIsoMkt();
    saveMarketsState();
    return { ok: true, result: { alert: a } };
  });
}
