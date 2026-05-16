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
}
