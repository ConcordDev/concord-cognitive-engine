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

// Note: prior versions of this file held a `FX_SAMPLE_MID` table with
// hardcoded mid-prices. Per the "everything must be real" directive, that
// table has been removed — `forex-quotes` now pulls live mid+bid+ask from
// Yahoo Finance (free, server-side fetch, no key required).

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

  // ── Yahoo Finance quote helper (free, no key, server-side) ──
  //
  // Endpoint: query1.finance.yahoo.com/v7/finance/quote?symbols=ES%3DF,GC%3DF
  // Returns array of quotes with regularMarketPrice, regularMarketChange,
  // bid, ask, marketState. Real data, refreshed in real time during market hours.

  async function fetchYahooQuotes(symbols) {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`;
    const r = await globalThis.fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Concord-OS/1.0)" },
    });
    if (!r.ok) throw new Error(`yahoo finance ${r.status}`);
    const data = await r.json();
    return data?.quoteResponse?.result || [];
  }

  // Map CME continuous symbols to Yahoo Finance tickers (e.g. ES → ES=F)
  const CME_TO_YAHOO = {
    ES: "ES=F", NQ: "NQ=F", YM: "YM=F", RTY: "RTY=F",
    CL: "CL=F", GC: "GC=F", SI: "SI=F", ZN: "ZN=F", ZB: "ZB=F",
  };

  registerLensAction("markets", "futures-board", async (_ctx, _artifact, params = {}) => {
    const filterSymbol = params.symbol ? String(params.symbol).toUpperCase() : null;
    const yearCode = String(new Date().getFullYear() % 10);
    const monthCode = frontMonth();
    const cmeSymbols = Object.keys(CME_CONTRACTS).filter((sym) => !filterSymbol || sym === filterSymbol);
    const yahooSymbols = cmeSymbols.map((sym) => CME_TO_YAHOO[sym]).filter(Boolean);
    let quotes;
    try {
      quotes = await fetchYahooQuotes(yahooSymbols);
    } catch (e) {
      return { ok: false, error: `futures quote fetch failed: ${e?.message || "network"}` };
    }
    const byYahoo = new Map(quotes.map((q) => [q.symbol, q]));
    const contracts = cmeSymbols.map((sym) => {
      const spec = CME_CONTRACTS[sym];
      const ySym = CME_TO_YAHOO[sym];
      const q = byYahoo.get(ySym);
      if (!q || q.regularMarketPrice == null) return null;
      const last = q.regularMarketPrice;
      const change = q.regularMarketChange ?? 0;
      return {
        symbol: sym,
        frontContract: `${sym}${monthCode}${yearCode}`,
        name: spec.name,
        last: round(last, 4),
        change: round(change, 4),
        changePercent: round((q.regularMarketChangePercent ?? 0), 2),
        bid: q.bid != null ? round(q.bid, 4) : null,
        ask: q.ask != null ? round(q.ask, 4) : null,
        volume: q.regularMarketVolume ?? null,
        marketState: q.marketState ?? null,
        tickSize: spec.tickSize,
        tickValue: spec.tickValue,
        multiplier: spec.multiplier,
        initialMargin: spec.initialMargin,
        cycle: spec.cycle,
      };
    }).filter(Boolean);
    return { ok: true, result: { contracts, count: contracts.length, source: "yahoo-finance" } };
  });

  // ── Forex pairs grid (Yahoo Finance, real bid/ask) ──

  registerLensAction("markets", "forex-quotes", async (_ctx, _artifact, params = {}) => {
    const pairs = Array.isArray(params.pairs) && params.pairs.length > 0
      ? params.pairs.map((p) => String(p).toUpperCase())
      : FX_MAJORS.map((m) => m.pair);
    // Yahoo uses e.g. EURUSD=X
    const yahooSymbols = pairs.map((p) => `${p}=X`);
    let quotes;
    try {
      quotes = await fetchYahooQuotes(yahooSymbols);
    } catch (e) {
      return { ok: false, error: `forex quote fetch failed: ${e?.message || "network"}` };
    }
    const byYahoo = new Map(quotes.map((q) => [q.symbol, q]));
    const result = pairs.map((p) => {
      const meta = FX_MAJORS.find((m) => m.pair === p);
      if (!meta) return null;
      const q = byYahoo.get(`${p}=X`);
      if (!q || q.regularMarketPrice == null) return null;
      const mid = q.regularMarketPrice;
      // Yahoo gives bid/ask when available, otherwise fall back to mid+/- typical spread
      const hasRealBidAsk = q.bid != null && q.ask != null && q.ask > q.bid;
      const bid = hasRealBidAsk ? q.bid : mid - meta.pip * 0.5;
      const ask = hasRealBidAsk ? q.ask : mid + meta.pip * 0.5;
      const spread = ask - bid;
      const spreadPips = spread / meta.pip;
      const pipValue = p.endsWith("USD")
        ? meta.pip * 100_000
        : Math.round(meta.pip * 100_000 / mid * 100) / 100;
      return {
        pair: p,
        name: meta.name,
        mid: round(mid, p.includes("JPY") ? 3 : 5),
        bid: round(bid, p.includes("JPY") ? 3 : 5),
        ask: round(ask, p.includes("JPY") ? 3 : 5),
        spread: round(spread, p.includes("JPY") ? 3 : 5),
        spreadPips: round(spreadPips, 2),
        pipValue,
        change: round(q.regularMarketChange ?? 0, p.includes("JPY") ? 3 : 5),
        changePercent: round(q.regularMarketChangePercent ?? 0, 3),
        bidAskSource: hasRealBidAsk ? "yahoo-real" : "mid-derived",
      };
    }).filter(Boolean);
    return { ok: true, result: { quotes: result, count: result.length, source: "yahoo-finance" } };
  });

  // ── Depth of book (real best bid/ask from Yahoo — single level) ──
  //
  // Yahoo Finance returns only the inside quote (bid/ask + sizes), not
  // full L2 depth. Full L2 requires a paid feed (IEX TOPS, NASDAQ TotalView,
  // Polygon L2). This macro returns the real inside quote + documents the
  // gap honestly rather than synthesizing fake depth levels.

  registerLensAction("markets", "depth-of-book", async (_ctx, _artifact, params = {}) => {
    const symbol = String(params.symbol || "SPY").toUpperCase();
    if (!symbol) return { ok: false, error: "symbol required" };
    let quotes;
    try {
      quotes = await fetchYahooQuotes([symbol]);
    } catch (e) {
      return { ok: false, error: `depth quote fetch failed: ${e?.message || "network"}` };
    }
    const q = quotes[0];
    if (!q || q.regularMarketPrice == null) {
      return { ok: false, error: `no quote for ${symbol}` };
    }
    return {
      ok: true,
      result: {
        symbol,
        last: q.regularMarketPrice,
        // Real inside quote (single level — Yahoo doesn't expose L2)
        bids: q.bid != null
          ? [{ price: q.bid, size: q.bidSize ?? null, level: 1 }]
          : [],
        asks: q.ask != null
          ? [{ price: q.ask, size: q.askSize ?? null, level: 1 }]
          : [],
        spread: (q.bid != null && q.ask != null) ? round(q.ask - q.bid, 4) : null,
        marketState: q.marketState ?? null,
        kind: "inside-quote",
        source: "yahoo-finance",
        notes: "Real inside quote only. Full L2 depth requires a licensed feed (IEX TOPS, NASDAQ TotalView, Polygon L2).",
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

  // ── Historical OHLCV via Yahoo Finance chart endpoint ──
  //
  // Real bars for any Yahoo-listed symbol. Used by the bespoke quote-detail
  // chart pane (lightweight-charts) and the multi-symbol comparison view.
  //
  // Endpoint: query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1mo&interval=1d
  //
  // Valid ranges:    1d 5d 1mo 3mo 6mo 1y 2y 5y 10y ytd max
  // Valid intervals: 1m 2m 5m 15m 30m 60m 90m 1h 1d 5d 1wk 1mo 3mo
  //
  // (Yahoo caps intraday intervals to recent windows: 1m → 7d, 5m → 60d, etc.)
  registerLensAction("markets", "quote-history", async (_ctx, _artifact, params = {}) => {
    const symbol = String(params.symbol || "").toUpperCase();
    if (!symbol) return { ok: false, error: "symbol required" };
    const range = String(params.range || "1mo");
    if (!/^(1d|5d|1mo|3mo|6mo|1y|2y|5y|10y|ytd|max)$/.test(range)) {
      return { ok: false, error: "invalid range" };
    }
    const interval = String(params.interval || (range === "1d" || range === "5d" ? "5m" : "1d"));
    if (!/^(1m|2m|5m|15m|30m|60m|90m|1h|1d|5d|1wk|1mo|3mo)$/.test(interval)) {
      return { ok: false, error: "invalid interval" };
    }
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
      const r = await globalThis.fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Concord-OS/1.0)" },
      });
      if (r.status === 404) return { ok: false, error: `symbol not found: ${symbol}` };
      if (!r.ok) throw new Error(`yahoo finance ${r.status}`);
      const data = await r.json();
      const result = data?.chart?.result?.[0];
      if (!result) return { ok: false, error: `no chart data for ${symbol}` };
      const ts = result.timestamp || [];
      const quote = result.indicators?.quote?.[0] || {};
      const adjclose = result.indicators?.adjclose?.[0]?.adjclose || [];
      const bars = ts.map((t, i) => ({
        time: t,
        open: quote.open?.[i] ?? null,
        high: quote.high?.[i] ?? null,
        low:  quote.low?.[i] ?? null,
        close: quote.close?.[i] ?? null,
        adjClose: adjclose[i] ?? null,
        volume: quote.volume?.[i] ?? null,
      })).filter((b) => b.close != null);
      const meta = result.meta || {};
      return {
        ok: true,
        result: {
          symbol, range, interval,
          bars, count: bars.length,
          currency: meta.currency || null,
          exchangeName: meta.exchangeName || null,
          instrumentType: meta.instrumentType || null,
          previousClose: meta.chartPreviousClose ?? null,
          regularMarketPrice: meta.regularMarketPrice ?? null,
          source: "yahoo-finance-chart",
        },
      };
    } catch (e) {
      return { ok: false, error: `yahoo finance unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ════════════════════════════════════════════════════════════════
  // PREDICTION MARKETS — Polymarket / Kalshi parity layer.
  //
  // A SPARKS-only, non-extractive event-prediction substrate. Users
  // create binary YES/NO markets, take pooled positions, trade limit
  // orders, cash out before resolution, and resolve with evidence.
  // All persistent state lives in per-user-aware STATE Maps keyed off
  // globalThis._concordSTATE.predictionMarkets.
  // ════════════════════════════════════════════════════════════════

  const MARKET_CATEGORIES = [
    "politics", "economics", "sports", "crypto", "science",
    "culture", "world", "concordia", "tech", "other",
  ];

  function getPredictionState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.predictionMarkets) {
      STATE.predictionMarkets = {
        markets: new Map(),   // marketId -> market record
        positions: new Map(), // positionId -> position record
        orders: new Map(),    // orderId -> limit order record
        seq: 0,
      };
    }
    return STATE.predictionMarkets;
  }

  function pmActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function pmNow() { return Date.now(); }
  function pmId(s, prefix) { s.seq += 1; return `${prefix}_${s.seq.toString(36)}_${Date.now().toString(36)}`; }

  // Implied probability from pool balance. AMM-style: YES% = noPool / total
  // is the wrong direction — in a parimutuel pool the payout odds favour the
  // SMALLER side, so the implied probability of YES is yesPool / total.
  function impliedProbability(yesPool, noPool) {
    const total = yesPool + noPool;
    if (total <= 0) return 0.5;
    return yesPool / total;
  }

  // Parimutuel payout: a winning stake of `stake` on the winning side gets
  // back its stake plus a proportional share of the losing pool.
  function parimutuelPayout(stake, winningPool, losingPool) {
    if (winningPool <= 0) return stake;
    return stake + (stake / winningPool) * losingPool;
  }

  function summariseMarket(m) {
    const prob = impliedProbability(m.poolYes, m.poolNo);
    return {
      id: m.id,
      question: m.question,
      description: m.description,
      category: m.category,
      resolutionCriteria: m.resolutionCriteria,
      creatorId: m.creatorId,
      poolYes: round(m.poolYes, 2),
      poolNo: round(m.poolNo, 2),
      totalPool: round(m.poolYes + m.poolNo, 2),
      yesProbability: round(prob, 4),
      noProbability: round(1 - prob, 4),
      yesPercent: Math.round(prob * 100),
      noPercent: Math.round((1 - prob) * 100),
      status: m.status,
      outcome: m.outcome,
      openedAt: m.openedAt,
      closesAt: m.closesAt,
      resolvedAt: m.resolvedAt,
      tradeCount: m.priceHistory.length,
      resolution: m.resolution || null,
    };
  }

  function recordPricePoint(m) {
    m.priceHistory.push({
      t: pmNow(),
      yesProbability: round(impliedProbability(m.poolYes, m.poolNo), 4),
      poolYes: round(m.poolYes, 2),
      poolNo: round(m.poolNo, 2),
    });
    if (m.priceHistory.length > 500) m.priceHistory.splice(0, m.priceHistory.length - 500);
  }

  // ── Market creation by users ──
  registerLensAction("markets", "market-create", (ctx, _artifact, params = {}) => {
    try {
      const s = getPredictionState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pmActor(ctx);
      const question = String(params.question || "").trim();
      if (question.length < 8) return { ok: false, error: "question must be at least 8 characters" };
      if (question.length > 240) return { ok: false, error: "question too long (240 max)" };
      const resolutionCriteria = String(params.resolutionCriteria || "").trim();
      if (resolutionCriteria.length < 8) return { ok: false, error: "resolutionCriteria must be at least 8 characters" };
      const category = MARKET_CATEGORIES.includes(String(params.category)) ? String(params.category) : "other";
      const closesAt = params.closesAt != null ? Number(params.closesAt) : null;
      if (closesAt != null && (!Number.isFinite(closesAt) || closesAt <= pmNow())) {
        return { ok: false, error: "closesAt must be a future timestamp (ms)" };
      }
      // Seed liquidity so the first bet has a meaningful price. The creator
      // funds a tiny symmetric seed split YES/NO; this is real (creator-owned)
      // liquidity, not fabricated volume.
      const seed = Math.min(Math.max(Number(params.seedSparks) || 10, 2), 200);
      const id = pmId(s, "mkt");
      const m = {
        id,
        question,
        description: String(params.description || "").trim().slice(0, 1000),
        category,
        resolutionCriteria,
        creatorId: userId,
        poolYes: seed / 2,
        poolNo: seed / 2,
        seedSparks: seed,
        status: "open",
        outcome: null,
        openedAt: pmNow(),
        closesAt,
        resolvedAt: null,
        resolution: null,
        priceHistory: [],
      };
      recordPricePoint(m);
      s.markets.set(id, m);
      saveMarketsState();
      return { ok: true, result: { market: summariseMarket(m) } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Market list + categories + search + trending + closing-soon ──
  registerLensAction("markets", "market-list", (_ctx, _artifact, params = {}) => {
    try {
      const s = getPredictionState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const category = params.category ? String(params.category) : null;
      const statusFilter = params.status ? String(params.status) : null;
      const search = String(params.search || "").trim().toLowerCase();
      const sort = String(params.sort || "newest"); // newest | volume | closing | trending
      const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);
      let rows = [...s.markets.values()];
      if (category) rows = rows.filter((m) => m.category === category);
      if (statusFilter) rows = rows.filter((m) => m.status === statusFilter);
      if (search) {
        rows = rows.filter((m) =>
          m.question.toLowerCase().includes(search) ||
          (m.description || "").toLowerCase().includes(search) ||
          m.category.toLowerCase().includes(search));
      }
      const now = pmNow();
      if (sort === "volume") {
        rows.sort((a, b) => (b.poolYes + b.poolNo) - (a.poolYes + a.poolNo));
      } else if (sort === "closing") {
        rows.sort((a, b) => (a.closesAt || Infinity) - (b.closesAt || Infinity));
      } else if (sort === "trending") {
        // recent trade count weighted by total pool
        const score = (m) => {
          const recent = m.priceHistory.filter((p) => now - p.t < 3600_000).length;
          return recent * 1000 + (m.poolYes + m.poolNo);
        };
        rows.sort((a, b) => score(b) - score(a));
      } else {
        rows.sort((a, b) => b.openedAt - a.openedAt);
      }
      const markets = rows.slice(0, limit).map(summariseMarket);
      // category facet counts for the browse UI
      const facets = {};
      for (const c of MARKET_CATEGORIES) facets[c] = 0;
      for (const m of s.markets.values()) facets[m.category] = (facets[m.category] || 0) + 1;
      return {
        ok: true,
        result: {
          markets,
          count: markets.length,
          categories: MARKET_CATEGORIES,
          facets,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Single market detail with live odds ──
  registerLensAction("markets", "market-get", (_ctx, _artifact, params = {}) => {
    try {
      const s = getPredictionState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const m = s.markets.get(String(params.marketId || ""));
      if (!m) return { ok: false, error: "market not found" };
      return { ok: true, result: { market: summariseMarket(m) } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Live odds quote (implied probability + payout preview) ──
  registerLensAction("markets", "market-odds", (_ctx, _artifact, params = {}) => {
    try {
      const s = getPredictionState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const m = s.markets.get(String(params.marketId || ""));
      if (!m) return { ok: false, error: "market not found" };
      const stake = Math.max(Number(params.stake) || 10, 1);
      const prob = impliedProbability(m.poolYes, m.poolNo);
      // Payout preview if the new stake lands and that side wins.
      const yesPayout = parimutuelPayout(stake, m.poolYes + stake, m.poolNo);
      const noPayout = parimutuelPayout(stake, m.poolNo + stake, m.poolYes);
      return {
        ok: true,
        result: {
          marketId: m.id,
          yesProbability: round(prob, 4),
          noProbability: round(1 - prob, 4),
          yesPercent: Math.round(prob * 100),
          noPercent: Math.round((1 - prob) * 100),
          stake,
          yesStakePayoutIfWin: round(yesPayout, 2),
          noStakePayoutIfWin: round(noPayout, 2),
          yesMultiple: round(yesPayout / stake, 3),
          noMultiple: round(noPayout / stake, 3),
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Price-history chart per market ──
  registerLensAction("markets", "market-history", (_ctx, _artifact, params = {}) => {
    try {
      const s = getPredictionState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const m = s.markets.get(String(params.marketId || ""));
      if (!m) return { ok: false, error: "market not found" };
      const points = m.priceHistory.map((p) => ({
        t: p.t,
        iso: new Date(p.t).toISOString(),
        yesProbability: p.yesProbability,
        yesPercent: Math.round(p.yesProbability * 100),
        poolYes: p.poolYes,
        poolNo: p.poolNo,
      }));
      return {
        ok: true,
        result: { marketId: m.id, question: m.question, points, count: points.length },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Place a pooled bet (prediction-market positions) ──
  registerLensAction("markets", "position-open", (ctx, _artifact, params = {}) => {
    try {
      const s = getPredictionState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pmActor(ctx);
      const m = s.markets.get(String(params.marketId || ""));
      if (!m) return { ok: false, error: "market not found" };
      if (m.status !== "open") return { ok: false, error: `market is ${m.status}` };
      if (m.closesAt != null && pmNow() >= m.closesAt) {
        m.status = "closed";
        saveMarketsState();
        return { ok: false, error: "market has closed" };
      }
      const side = String(params.side || "").toLowerCase();
      if (side !== "yes" && side !== "no") return { ok: false, error: "side must be yes or no" };
      const stake = Number(params.stakeSparks);
      if (!Number.isFinite(stake) || stake < 1) return { ok: false, error: "stakeSparks must be >= 1" };
      if (stake > 100000) return { ok: false, error: "stake exceeds cap (100000)" };
      // entry price = implied probability of the chosen side BEFORE this stake
      const probBefore = impliedProbability(m.poolYes, m.poolNo);
      const entryPrice = side === "yes" ? probBefore : 1 - probBefore;
      if (side === "yes") m.poolYes += stake; else m.poolNo += stake;
      recordPricePoint(m);
      const id = pmId(s, "pos");
      const pos = {
        id,
        marketId: m.id,
        userId,
        side,
        stakeSparks: stake,
        entryPrice: round(entryPrice, 4),
        openedAt: pmNow(),
        status: "open", // open | cashed_out | won | lost
        payoutSparks: null,
        realizedPnl: null,
        closedAt: null,
      };
      s.positions.set(id, pos);
      saveMarketsState();
      return {
        ok: true,
        result: {
          position: pos,
          market: summariseMarket(m),
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── My positions (across all markets) ──
  registerLensAction("markets", "my-positions", (ctx, _artifact, params = {}) => {
    try {
      const s = getPredictionState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pmActor(ctx);
      const statusFilter = params.status ? String(params.status) : null;
      const rows = [...s.positions.values()].filter((p) => p.userId === userId &&
        (!statusFilter || p.status === statusFilter));
      rows.sort((a, b) => b.openedAt - a.openedAt);
      const positions = rows.map((p) => {
        const m = s.markets.get(p.marketId);
        let currentValue = null;
        if (m && p.status === "open") {
          // mark-to-market: what this stake would cash out for right now
          const winPool = p.side === "yes" ? m.poolYes : m.poolNo;
          const losePool = p.side === "yes" ? m.poolNo : m.poolYes;
          const grossIfWin = parimutuelPayout(p.stakeSparks, winPool, losePool);
          const prob = p.side === "yes"
            ? impliedProbability(m.poolYes, m.poolNo)
            : 1 - impliedProbability(m.poolYes, m.poolNo);
          currentValue = round(grossIfWin * prob, 2);
        }
        return {
          ...p,
          question: m ? m.question : null,
          marketStatus: m ? m.status : "unknown",
          currentValue,
          unrealizedPnl: currentValue != null ? round(currentValue - p.stakeSparks, 2) : null,
        };
      });
      return { ok: true, result: { positions, count: positions.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Cash out a position before resolution (secondary-market exit) ──
  registerLensAction("markets", "position-cashout", (ctx, _artifact, params = {}) => {
    try {
      const s = getPredictionState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pmActor(ctx);
      const pos = s.positions.get(String(params.positionId || ""));
      if (!pos) return { ok: false, error: "position not found" };
      if (pos.userId !== userId) return { ok: false, error: "not your position" };
      if (pos.status !== "open") return { ok: false, error: `position is ${pos.status}` };
      const m = s.markets.get(pos.marketId);
      if (!m) return { ok: false, error: "market not found" };
      if (m.status !== "open") return { ok: false, error: "can only cash out an open market" };
      // Cash-out value = expected value of the position at current odds.
      const prob = pos.side === "yes"
        ? impliedProbability(m.poolYes, m.poolNo)
        : 1 - impliedProbability(m.poolYes, m.poolNo);
      const winPool = pos.side === "yes" ? m.poolYes : m.poolNo;
      const losePool = pos.side === "yes" ? m.poolNo : m.poolYes;
      const grossIfWin = parimutuelPayout(pos.stakeSparks, winPool, losePool);
      // 2% exit fee to discourage churn — non-extractive, stays in the pool.
      const rawCashout = grossIfWin * prob;
      const exitFee = rawCashout * 0.02;
      const cashout = Math.max(0, rawCashout - exitFee);
      // withdraw the stake from the pool (the position is being closed)
      if (pos.side === "yes") m.poolYes = Math.max(0, m.poolYes - pos.stakeSparks);
      else m.poolNo = Math.max(0, m.poolNo - pos.stakeSparks);
      // exit fee stays as liquidity on the opposite side
      if (pos.side === "yes") m.poolNo += exitFee; else m.poolYes += exitFee;
      recordPricePoint(m);
      pos.status = "cashed_out";
      pos.payoutSparks = round(cashout, 2);
      pos.realizedPnl = round(cashout - pos.stakeSparks, 2);
      pos.closedAt = pmNow();
      saveMarketsState();
      return {
        ok: true,
        result: {
          position: pos,
          cashoutSparks: round(cashout, 2),
          exitFee: round(exitFee, 2),
          realizedPnl: pos.realizedPnl,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Resolve a market (creator-only) with evidence ──
  registerLensAction("markets", "market-resolve", (ctx, _artifact, params = {}) => {
    try {
      const s = getPredictionState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pmActor(ctx);
      const m = s.markets.get(String(params.marketId || ""));
      if (!m) return { ok: false, error: "market not found" };
      if (m.creatorId !== userId) return { ok: false, error: "only the market creator can resolve" };
      if (m.status === "resolved") return { ok: false, error: "market already resolved" };
      const outcome = String(params.outcome || "").toLowerCase();
      if (outcome !== "yes" && outcome !== "no") return { ok: false, error: "outcome must be yes or no" };
      const evidence = String(params.evidence || "").trim();
      if (evidence.length < 8) return { ok: false, error: "evidence (>=8 chars) required for resolution" };
      const winPool = outcome === "yes" ? m.poolYes : m.poolNo;
      const losePool = outcome === "yes" ? m.poolNo : m.poolYes;
      // settle every open position on this market
      let paid = 0;
      let winners = 0;
      let losers = 0;
      for (const pos of s.positions.values()) {
        if (pos.marketId !== m.id || pos.status !== "open") continue;
        if (pos.side === outcome) {
          const payout = parimutuelPayout(pos.stakeSparks, winPool, losePool);
          pos.status = "won";
          pos.payoutSparks = round(payout, 2);
          pos.realizedPnl = round(payout - pos.stakeSparks, 2);
          paid += payout;
          winners += 1;
        } else {
          pos.status = "lost";
          pos.payoutSparks = 0;
          pos.realizedPnl = -pos.stakeSparks;
          losers += 1;
        }
        pos.closedAt = pmNow();
      }
      // cancel any resting limit orders on this market
      let cancelledOrders = 0;
      for (const o of s.orders.values()) {
        if (o.marketId === m.id && o.status === "open") {
          o.status = "cancelled";
          o.closedAt = pmNow();
          cancelledOrders += 1;
        }
      }
      m.status = "resolved";
      m.outcome = outcome;
      m.resolvedAt = pmNow();
      m.resolution = {
        outcome,
        evidence,
        evidenceUrl: String(params.evidenceUrl || "").trim() || null,
        resolvedBy: userId,
        resolvedAt: m.resolvedAt,
      };
      recordPricePoint(m);
      saveMarketsState();
      return {
        ok: true,
        result: {
          market: summariseMarket(m),
          settlement: { winners, losers, totalPaidSparks: round(paid, 2), cancelledOrders },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Resolution / dispute view ──
  registerLensAction("markets", "market-resolution", (_ctx, _artifact, params = {}) => {
    try {
      const s = getPredictionState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const m = s.markets.get(String(params.marketId || ""));
      if (!m) return { ok: false, error: "market not found" };
      if (m.status !== "resolved") {
        return { ok: true, result: { resolved: false, status: m.status, marketId: m.id } };
      }
      const settled = [...s.positions.values()].filter((p) => p.marketId === m.id);
      return {
        ok: true,
        result: {
          resolved: true,
          marketId: m.id,
          question: m.question,
          resolutionCriteria: m.resolutionCriteria,
          resolution: m.resolution,
          finalYesProbability: round(impliedProbability(m.poolYes, m.poolNo), 4),
          settledPositions: settled.length,
          winners: settled.filter((p) => p.status === "won").length,
          losers: settled.filter((p) => p.status === "lost").length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Limit orders — match bets at chosen prices ──
  //
  // A limit order rests until the market's implied probability for the
  // chosen side reaches the limit price, then it converts to a pooled
  // position. matching happens on each order-book read and on each new
  // position (price-moving event).
  function matchRestingOrders(s, m) {
    let filled = 0;
    const prob = impliedProbability(m.poolYes, m.poolNo);
    for (const o of s.orders.values()) {
      if (o.marketId !== m.id || o.status !== "open") continue;
      const sidePrice = o.side === "yes" ? prob : 1 - prob;
      // buy order fills when the price is at or below the limit
      if (sidePrice <= o.limitPrice) {
        if (o.side === "yes") m.poolYes += o.stakeSparks; else m.poolNo += o.stakeSparks;
        const pos = {
          id: pmId(s, "pos"),
          marketId: m.id,
          userId: o.userId,
          side: o.side,
          stakeSparks: o.stakeSparks,
          entryPrice: round(sidePrice, 4),
          openedAt: pmNow(),
          status: "open",
          payoutSparks: null,
          realizedPnl: null,
          closedAt: null,
          fromOrderId: o.id,
        };
        s.positions.set(pos.id, pos);
        o.status = "filled";
        o.filledPositionId = pos.id;
        o.closedAt = pmNow();
        filled += 1;
        recordPricePoint(m);
      }
    }
    return filled;
  }

  registerLensAction("markets", "order-place", (ctx, _artifact, params = {}) => {
    try {
      const s = getPredictionState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pmActor(ctx);
      const m = s.markets.get(String(params.marketId || ""));
      if (!m) return { ok: false, error: "market not found" };
      if (m.status !== "open") return { ok: false, error: `market is ${m.status}` };
      const side = String(params.side || "").toLowerCase();
      if (side !== "yes" && side !== "no") return { ok: false, error: "side must be yes or no" };
      const limitPrice = Number(params.limitPrice);
      if (!Number.isFinite(limitPrice) || limitPrice <= 0 || limitPrice >= 1) {
        return { ok: false, error: "limitPrice must be a probability in (0,1)" };
      }
      const stake = Number(params.stakeSparks);
      if (!Number.isFinite(stake) || stake < 1) return { ok: false, error: "stakeSparks must be >= 1" };
      const id = pmId(s, "ord");
      const order = {
        id,
        marketId: m.id,
        userId,
        side,
        limitPrice: round(limitPrice, 4),
        stakeSparks: stake,
        status: "open", // open | filled | cancelled
        createdAt: pmNow(),
        filledPositionId: null,
        closedAt: null,
      };
      s.orders.set(id, order);
      // attempt an immediate fill if the market is already at/through the limit
      const filled = matchRestingOrders(s, m);
      saveMarketsState();
      return {
        ok: true,
        result: { order, immediatelyFilled: order.status === "filled", fillsThisPass: filled },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("markets", "order-cancel", (ctx, _artifact, params = {}) => {
    try {
      const s = getPredictionState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pmActor(ctx);
      const o = s.orders.get(String(params.orderId || ""));
      if (!o) return { ok: false, error: "order not found" };
      if (o.userId !== userId) return { ok: false, error: "not your order" };
      if (o.status !== "open") return { ok: false, error: `order is ${o.status}` };
      o.status = "cancelled";
      o.closedAt = pmNow();
      saveMarketsState();
      return { ok: true, result: { order: o } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Order book — resting orders for a market, grouped by side/price ──
  registerLensAction("markets", "order-book", (ctx, _artifact, params = {}) => {
    try {
      const s = getPredictionState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pmActor(ctx);
      const m = s.markets.get(String(params.marketId || ""));
      if (!m) return { ok: false, error: "market not found" };
      // run a match pass so the book reflects current price
      if (m.status === "open") matchRestingOrders(s, m);
      const resting = [...s.orders.values()].filter((o) => o.marketId === m.id && o.status === "open");
      // aggregate by side+price
      const aggregate = (sd) => {
        const map = new Map();
        for (const o of resting.filter((x) => x.side === sd)) {
          const k = o.limitPrice;
          map.set(k, (map.get(k) || 0) + o.stakeSparks);
        }
        return [...map.entries()]
          .map(([price, size]) => ({ price, size: round(size, 2) }))
          .sort((a, b) => b.price - a.price);
      };
      const myOrders = [...s.orders.values()]
        .filter((o) => o.marketId === m.id && o.userId === userId)
        .sort((a, b) => b.createdAt - a.createdAt);
      saveMarketsState();
      return {
        ok: true,
        result: {
          marketId: m.id,
          currentYesProbability: round(impliedProbability(m.poolYes, m.poolNo), 4),
          yesBids: aggregate("yes"),
          noBids: aggregate("no"),
          restingCount: resting.length,
          myOrders,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Leaderboard — top forecasters by realized P&L ──
  registerLensAction("markets", "leaderboard", (_ctx, _artifact, params = {}) => {
    try {
      const s = getPredictionState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
      const byUser = new Map();
      for (const p of s.positions.values()) {
        if (!byUser.has(p.userId)) {
          byUser.set(p.userId, {
            userId: p.userId, realizedPnl: 0, staked: 0,
            wins: 0, losses: 0, cashouts: 0, openPositions: 0, total: 0,
          });
        }
        const u = byUser.get(p.userId);
        u.total += 1;
        u.staked += p.stakeSparks;
        if (p.status === "won") { u.realizedPnl += (p.realizedPnl || 0); u.wins += 1; }
        else if (p.status === "lost") { u.realizedPnl += (p.realizedPnl || 0); u.losses += 1; }
        else if (p.status === "cashed_out") { u.realizedPnl += (p.realizedPnl || 0); u.cashouts += 1; }
        else u.openPositions += 1;
      }
      const rows = [...byUser.values()].map((u) => {
        const settled = u.wins + u.losses;
        return {
          ...u,
          realizedPnl: round(u.realizedPnl, 2),
          staked: round(u.staked, 2),
          winRate: settled > 0 ? round(u.wins / settled, 3) : null,
          roi: u.staked > 0 ? round(u.realizedPnl / u.staked, 3) : null,
        };
      });
      rows.sort((a, b) => b.realizedPnl - a.realizedPnl);
      return {
        ok: true,
        result: {
          leaderboard: rows.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r })),
          totalForecasters: rows.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
