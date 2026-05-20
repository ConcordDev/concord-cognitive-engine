// server/domains/market.js
// Domain actions for market analysis: trend analysis, competitor matrix, price elasticity.

export default function registerMarketActions(registerLensAction) {
  /**
   * trendAnalysis
   * Detect market trends using moving averages, MACD crossovers, and RSI signals.
   * artifact.data.prices: [{ date, open, high, low, close, volume }]
   * params.smaPeriods — array of SMA periods (default [20, 50])
   * params.rsiPeriod — RSI period (default 14)
   * params.macdFast — MACD fast EMA period (default 12)
   * params.macdSlow — MACD slow EMA period (default 26)
   * params.macdSignal — MACD signal line period (default 9)
   */
  registerLensAction("market", "trendAnalysis", (ctx, artifact, params) => {
    const prices = artifact.data?.prices || [];
    if (prices.length < 2) {
      return { ok: true, result: { message: "Insufficient price data for trend analysis.", signals: [] } };
    }

    const closes = prices.map(p => parseFloat(p.close) || 0);
    const smaPeriods = params.smaPeriods || [20, 50];
    const rsiPeriod = params.rsiPeriod || 14;
    const macdFast = params.macdFast || 12;
    const macdSlow = params.macdSlow || 26;
    const macdSignalPeriod = params.macdSignal || 9;

    // --- SMA computation ---
    function computeSMA(data, period) {
      const result = [];
      for (let i = 0; i < data.length; i++) {
        if (i < period - 1) { result.push(null); continue; }
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += data[j];
        result.push(Math.round((sum / period) * 10000) / 10000);
      }
      return result;
    }

    // --- EMA computation ---
    function computeEMA(data, period) {
      const result = [];
      const multiplier = 2 / (period + 1);
      let emaPrev = null;
      for (let i = 0; i < data.length; i++) {
        if (i < period - 1) { result.push(null); continue; }
        if (emaPrev === null) {
          let sum = 0;
          for (let j = i - period + 1; j <= i; j++) sum += data[j];
          emaPrev = sum / period;
        } else {
          emaPrev = (data[i] - emaPrev) * multiplier + emaPrev;
        }
        result.push(Math.round(emaPrev * 10000) / 10000);
      }
      return result;
    }

    // --- RSI ---
    function computeRSI(data, period) {
      const rsi = [];
      let gains = 0;
      let losses = 0;
      for (let i = 0; i < data.length; i++) {
        if (i === 0) { rsi.push(null); continue; }
        const change = data[i] - data[i - 1];
        if (i <= period) {
          if (change > 0) gains += change; else losses += Math.abs(change);
          if (i < period) { rsi.push(null); continue; }
          const avgGain = gains / period;
          const avgLoss = losses / period;
          const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
          rsi.push(Math.round((100 - 100 / (1 + rs)) * 100) / 100);
        } else {
          const prevGain = change > 0 ? change : 0;
          const prevLoss = change < 0 ? Math.abs(change) : 0;
          gains = (gains * (period - 1) + prevGain) / period;
          losses = (losses * (period - 1) + prevLoss) / period;
          const rs = losses === 0 ? 100 : gains / losses;
          rsi.push(Math.round((100 - 100 / (1 + rs)) * 100) / 100);
        }
      }
      return rsi;
    }

    const smaResults = {};
    for (const period of smaPeriods) {
      smaResults[`sma${period}`] = computeSMA(closes, period);
    }

    const emaFastLine = computeEMA(closes, macdFast);
    const emaSlowLine = computeEMA(closes, macdSlow);

    // MACD line = fast EMA - slow EMA
    const macdLine = emaFastLine.map((v, i) => {
      if (v === null || emaSlowLine[i] === null) return null;
      return Math.round((v - emaSlowLine[i]) * 10000) / 10000;
    });

    const macdValues = macdLine.filter(v => v !== null);
    const signalLine = computeEMA(macdValues, macdSignalPeriod);

    // Pad signal line to align with macdLine
    const macdStart = macdLine.findIndex(v => v !== null);
    const signalFull = new Array(macdLine.length).fill(null);
    let si = 0;
    for (let i = macdStart; i < macdLine.length; i++) {
      signalFull[i] = signalLine[si] !== undefined ? signalLine[si] : null;
      si++;
    }

    const rsiValues = computeRSI(closes, rsiPeriod);

    // --- Generate signals ---
    const signals = [];
    const lastIdx = closes.length - 1;

    // SMA crossover signals
    const sortedPeriods = [...smaPeriods].sort((a, b) => a - b);
    if (sortedPeriods.length >= 2) {
      const shortKey = `sma${sortedPeriods[0]}`;
      const longKey = `sma${sortedPeriods[1]}`;
      const shortSMA = smaResults[shortKey];
      const longSMA = smaResults[longKey];
      if (shortSMA[lastIdx] !== null && longSMA[lastIdx] !== null) {
        if (shortSMA[lastIdx] > longSMA[lastIdx] && shortSMA[lastIdx - 1] <= longSMA[lastIdx - 1]) {
          signals.push({ type: "goldenCross", indicator: "SMA", detail: `${shortKey} crossed above ${longKey}`, sentiment: "bullish" });
        } else if (shortSMA[lastIdx] < longSMA[lastIdx] && shortSMA[lastIdx - 1] >= longSMA[lastIdx - 1]) {
          signals.push({ type: "deathCross", indicator: "SMA", detail: `${shortKey} crossed below ${longKey}`, sentiment: "bearish" });
        }
      }
    }

    // MACD crossover
    if (macdLine[lastIdx] !== null && signalFull[lastIdx] !== null && lastIdx > 0) {
      if (macdLine[lastIdx] > signalFull[lastIdx] && macdLine[lastIdx - 1] <= signalFull[lastIdx - 1]) {
        signals.push({ type: "macdCrossover", indicator: "MACD", detail: "MACD crossed above signal line", sentiment: "bullish" });
      } else if (macdLine[lastIdx] < signalFull[lastIdx] && macdLine[lastIdx - 1] >= signalFull[lastIdx - 1]) {
        signals.push({ type: "macdCrossover", indicator: "MACD", detail: "MACD crossed below signal line", sentiment: "bearish" });
      }
    }

    // RSI signals
    const latestRSI = rsiValues[lastIdx];
    if (latestRSI !== null) {
      if (latestRSI >= 70) {
        signals.push({ type: "overbought", indicator: "RSI", value: latestRSI, sentiment: "bearish" });
      } else if (latestRSI <= 30) {
        signals.push({ type: "oversold", indicator: "RSI", value: latestRSI, sentiment: "bullish" });
      }
    }

    // Overall trend determination
    const bullishCount = signals.filter(s => s.sentiment === "bullish").length;
    const bearishCount = signals.filter(s => s.sentiment === "bearish").length;
    const overallTrend = bullishCount > bearishCount ? "bullish" : bearishCount > bullishCount ? "bearish" : "neutral";

    return {
      ok: true,
      result: {
        dataPoints: closes.length,
        latestClose: closes[lastIdx],
        sma: Object.fromEntries(Object.entries(smaResults).map(([k, v]) => [k, v[lastIdx]])),
        macd: { line: macdLine[lastIdx], signal: signalFull[lastIdx], histogram: macdLine[lastIdx] !== null && signalFull[lastIdx] !== null ? Math.round((macdLine[lastIdx] - signalFull[lastIdx]) * 10000) / 10000 : null },
        rsi: latestRSI,
        signals,
        overallTrend,
      },
    };
  });

  /**
   * competitorMatrix
   * Build competitive positioning matrix with feature scoring, market share, and SWOT.
   * artifact.data.competitors: [{ name, features: { featureName: score(0-10) }, revenue?, marketCap?, strengths:[], weaknesses:[], opportunities:[], threats:[] }]
   * artifact.data.featureWeights: { featureName: weight } (optional, default equal weights)
   */
  registerLensAction("market", "competitorMatrix", (ctx, artifact, params) => {
    const competitors = artifact.data?.competitors || [];
    const featureWeights = artifact.data?.featureWeights || {};

    if (competitors.length === 0) {
      return { ok: true, result: { message: "No competitors provided.", matrix: [] } };
    }

    // Collect all features across competitors
    const allFeatures = new Set();
    for (const comp of competitors) {
      if (comp.features) Object.keys(comp.features).forEach(f => allFeatures.add(f));
    }
    const featureList = [...allFeatures];

    // Assign equal weights if not provided
    const weights = {};
    const totalCustomWeight = featureList.reduce((s, f) => s + (featureWeights[f] || 0), 0);
    for (const f of featureList) {
      weights[f] = featureWeights[f] || (totalCustomWeight > 0 ? 0 : 1 / featureList.length);
    }
    const weightSum = Object.values(weights).reduce((s, w) => s + w, 0) || 1;

    // Compute weighted scores and market share estimates
    const totalRevenue = competitors.reduce((s, c) => s + (parseFloat(c.revenue) || 0), 0);

    const matrix = competitors.map(comp => {
      const featureScores = {};
      let weightedSum = 0;
      for (const f of featureList) {
        const score = comp.features?.[f] ?? 0;
        featureScores[f] = score;
        weightedSum += score * (weights[f] || 0);
      }
      const compositeScore = Math.round((weightedSum / weightSum) * 100) / 100;

      const revenue = parseFloat(comp.revenue) || 0;
      const marketShare = totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 10000) / 100 : null;

      // SWOT aggregation
      const swot = {
        strengths: comp.strengths || [],
        weaknesses: comp.weaknesses || [],
        opportunities: comp.opportunities || [],
        threats: comp.threats || [],
        swotBalance: 0,
      };
      swot.swotBalance = (swot.strengths.length + swot.opportunities.length) - (swot.weaknesses.length + swot.threats.length);

      return {
        name: comp.name,
        featureScores,
        compositeScore,
        revenue,
        marketShare,
        swot,
      };
    }).sort((a, b) => b.compositeScore - a.compositeScore);

    // Feature-level comparison: which competitor leads each feature
    const featureLeaders = {};
    for (const f of featureList) {
      let best = { name: null, score: -1 };
      for (const comp of competitors) {
        const score = comp.features?.[f] ?? 0;
        if (score > best.score) best = { name: comp.name, score };
      }
      featureLeaders[f] = best;
    }

    // Competitive gaps: for each competitor, features where they trail the leader by >= 3 points
    const competitiveGaps = matrix.map(comp => {
      const gaps = [];
      for (const f of featureList) {
        const leaderScore = featureLeaders[f].score;
        const myScore = comp.featureScores[f];
        if (leaderScore - myScore >= 3) {
          gaps.push({ feature: f, gap: leaderScore - myScore, leader: featureLeaders[f].name });
        }
      }
      return { name: comp.name, gaps };
    });

    return {
      ok: true,
      result: {
        competitorCount: competitors.length,
        features: featureList,
        weights,
        matrix,
        featureLeaders,
        competitiveGaps,
      },
    };
  });

  /**
   * priceElasticity
   * Estimate price elasticity of demand from historical price/quantity data.
   * artifact.data.observations: [{ price, quantity }]
   * params.method — "arc" | "loglog" (default "loglog")
   */
  registerLensAction("market", "priceElasticity", (ctx, artifact, params) => {
    const observations = artifact.data?.observations || [];
    const method = params.method || "loglog";

    if (observations.length < 2) {
      return { ok: true, result: { message: "Need at least 2 observations for elasticity computation.", elasticity: null } };
    }

    const prices = observations.map(o => parseFloat(o.price) || 0).filter(p => p > 0);
    const quantities = observations.map(o => parseFloat(o.quantity) || 0).filter(q => q > 0);

    if (prices.length < 2 || quantities.length < 2 || prices.length !== quantities.length) {
      return { ok: true, result: { message: "Invalid or mismatched price/quantity data.", elasticity: null } };
    }

    // --- Arc elasticity for each consecutive pair ---
    const arcElasticities = [];
    for (let i = 1; i < prices.length; i++) {
      const pctChangeQ = (quantities[i] - quantities[i - 1]) / ((quantities[i] + quantities[i - 1]) / 2);
      const pctChangeP = (prices[i] - prices[i - 1]) / ((prices[i] + prices[i - 1]) / 2);
      if (Math.abs(pctChangeP) > 1e-10) {
        arcElasticities.push(Math.round((pctChangeQ / pctChangeP) * 10000) / 10000);
      }
    }

    // --- Log-log regression: ln(Q) = a + b * ln(P) => b = elasticity ---
    const logP = prices.map(p => Math.log(p));
    const logQ = quantities.map(q => Math.log(q));
    const n = logP.length;

    const meanLogP = logP.reduce((s, v) => s + v, 0) / n;
    const meanLogQ = logQ.reduce((s, v) => s + v, 0) / n;

    let ssXY = 0;
    let ssXX = 0;
    let ssYY = 0;
    for (let i = 0; i < n; i++) {
      const dx = logP[i] - meanLogP;
      const dy = logQ[i] - meanLogQ;
      ssXY += dx * dy;
      ssXX += dx * dx;
      ssYY += dy * dy;
    }

    const slope = ssXX > 1e-10 ? ssXY / ssXX : 0;
    const intercept = meanLogQ - slope * meanLogP;
    const rSquared = ssXX > 1e-10 && ssYY > 1e-10 ? Math.pow(ssXY, 2) / (ssXX * ssYY) : 0;

    // Standard error of slope
    const residuals = logP.map((lp, i) => logQ[i] - (intercept + slope * lp));
    const sse = residuals.reduce((s, r) => s + r * r, 0);
    const mse = n > 2 ? sse / (n - 2) : 0;
    const slopeStdErr = ssXX > 1e-10 ? Math.sqrt(mse / ssXX) : 0;

    const loglogElasticity = Math.round(slope * 10000) / 10000;

    // Classify elasticity
    const absElasticity = Math.abs(method === "loglog" ? loglogElasticity : (arcElasticities.length > 0 ? arcElasticities.reduce((s, v) => s + v, 0) / arcElasticities.length : 0));
    let classification;
    if (absElasticity < 0.5) classification = "highly inelastic";
    else if (absElasticity < 1) classification = "inelastic";
    else if (Math.abs(absElasticity - 1) < 0.05) classification = "unit elastic";
    else if (absElasticity < 2) classification = "elastic";
    else classification = "highly elastic";

    return {
      ok: true,
      result: {
        method,
        observations: n,
        arcElasticities,
        averageArcElasticity: arcElasticities.length > 0 ? Math.round((arcElasticities.reduce((s, v) => s + v, 0) / arcElasticities.length) * 10000) / 10000 : null,
        loglogRegression: {
          elasticity: loglogElasticity,
          intercept: Math.round(intercept * 10000) / 10000,
          rSquared: Math.round(rSquared * 10000) / 10000,
          slopeStdErr: Math.round(slopeStdErr * 10000) / 10000,
        },
        primaryElasticity: method === "loglog" ? loglogElasticity : (arcElasticities.length > 0 ? Math.round((arcElasticities.reduce((s, v) => s + v, 0) / arcElasticities.length) * 10000) / 10000 : null),
        classification,
      },
    };
  });

  // ─── Parity-sprint macros (real Yahoo Finance feeds) ──

  // SPDR sector ETFs — the canonical real proxy for S&P 500 sector
  // performance. Each ETF tracks one of the 11 GICS sectors. Sector
  // pct change == ETF pct change for the same window; sector market
  // cap is computed from the ETF holdings' aggregate cap, which
  // Yahoo Finance returns on the ETF quote.
  const SECTOR_ETFS = [
    { sector: "Technology",             etf: "XLK", topSymbols: ["AAPL", "MSFT", "NVDA"] },
    { sector: "Healthcare",             etf: "XLV", topSymbols: ["UNH", "JNJ", "LLY"] },
    { sector: "Financials",             etf: "XLF", topSymbols: ["JPM", "BAC", "WFC"] },
    { sector: "Consumer Discretionary", etf: "XLY", topSymbols: ["AMZN", "TSLA", "HD"] },
    { sector: "Communication Services", etf: "XLC", topSymbols: ["META", "GOOGL", "NFLX"] },
    { sector: "Industrials",            etf: "XLI", topSymbols: ["CAT", "BA", "HON"] },
    { sector: "Consumer Staples",       etf: "XLP", topSymbols: ["WMT", "PG", "KO"] },
    { sector: "Energy",                 etf: "XLE", topSymbols: ["XOM", "CVX", "COP"] },
    { sector: "Utilities",              etf: "XLU", topSymbols: ["NEE", "DUK", "SO"] },
    { sector: "Materials",              etf: "XLB", topSymbols: ["LIN", "SHW", "APD"] },
    { sector: "Real Estate",            etf: "XLRE", topSymbols: ["AMT", "PLD", "CCI"] },
  ];

  // Yahoo Finance quote endpoint — free, no API key, server-side fetch.
  // Returns: { quoteResponse: { result: [{ symbol, regularMarketPrice,
  //   regularMarketChange, regularMarketChangePercent, marketCap, trailingPE,
  //   epsTrailingTwelveMonths, regularMarketVolume, longName, fiftyTwoWeekChangePercent }] } }
  async function fetchYahooQuotesMkt(symbols) {
    if (typeof globalThis.fetch !== "function") throw new Error("fetch unavailable");
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`;
    const r = await globalThis.fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Concord-OS/1.0)" },
    });
    if (!r.ok) throw new Error(`yahoo finance ${r.status}`);
    const data = await r.json();
    return data?.quoteResponse?.result || [];
  }

  // Range → Yahoo Finance field. Yahoo returns 1D pct on
  // regularMarketChangePercent; longer windows live on dedicated
  // fields (fiftyTwoWeekChangePercent etc.) or require the chart
  // endpoint. We use the quote endpoint for 1D/1W (W approximated
  // by 5-day cumulative), and pull explicit ranges for 1M/YTD.
  registerLensAction("market", "sector-performance", async (_ctx, _artifact, params = {}) => {
    const range = ["1D", "1W", "1M", "YTD"].includes(params.range) ? params.range : "1D";
    let quotes;
    try {
      quotes = await fetchYahooQuotesMkt(SECTOR_ETFS.map((s) => s.etf));
    } catch (e) {
      return { ok: false, error: `yahoo finance unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
    const byEtf = new Map(quotes.map((q) => [q.symbol, q]));
    const sectors = [];
    for (const meta of SECTOR_ETFS) {
      const q = byEtf.get(meta.etf);
      if (!q) continue;
      // 1D is direct; longer windows come from the dedicated fields. For
      // 1W/1M we use the chart-derived fiftyTwoWeekChangePercent scaled
      // down — Yahoo's quote-endpoint exposes only the snapshot pct fields,
      // not 1W/1M deltas. So:
      //   1D  = regularMarketChangePercent  (live)
      //   YTD = ytdReturn or fiftyTwoWeekChangePercent (fallback)
      // 1W/1M are not in the quote payload — return null and label "n/a"
      // rather than synthesize. UI can call quotes-batch for richer windows.
      let pct;
      if (range === "1D") pct = q.regularMarketChangePercent ?? null;
      else if (range === "YTD") pct = q.ytdReturn ?? q.fiftyTwoWeekChangePercent ?? null;
      else pct = null; // 1W / 1M not in v7/quote payload
      sectors.push({
        sector: meta.sector,
        etf: meta.etf,
        pct,
        price: q.regularMarketPrice ?? null,
        marketCap: q.marketCap ?? null,
        topSymbols: meta.topSymbols,
      });
    }
    return {
      ok: true,
      result: {
        sectors,
        range,
        source: "yahoo-finance",
        notes: range === "1W" || range === "1M"
          ? "1W/1M sector windows not available on quote endpoint; pct returned as null. Use quotes-batch on individual symbols for time-series."
          : null,
      },
    };
  });

  registerLensAction("market", "quotes-batch", async (_ctx, _artifact, params = {}) => {
    const symbols = Array.isArray(params.symbols)
      ? params.symbols.filter((s) => typeof s === "string").map((s) => s.toUpperCase()).slice(0, 50)
      : [];
    if (symbols.length === 0) return { ok: true, result: { quotes: [], source: "yahoo-finance" } };
    let raw;
    try {
      raw = await fetchYahooQuotesMkt(symbols);
    } catch (e) {
      return { ok: false, error: `yahoo finance unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
    const bySym = new Map(raw.map((q) => [q.symbol, q]));
    const quotes = symbols.map((sym) => {
      const q = bySym.get(sym);
      if (!q || q.regularMarketPrice == null) {
        return { symbol: sym, error: "no quote available" };
      }
      return {
        symbol: sym,
        name: q.longName || q.shortName || sym,
        price: q.regularMarketPrice,
        pctChange1d: q.regularMarketChangePercent ?? null,
        pctChange1y: q.fiftyTwoWeekChangePercent ?? null,
        volume: q.regularMarketVolume ?? null,
        marketCap: q.marketCap ?? null,
        pe: q.trailingPE ?? null,
        eps: q.epsTrailingTwelveMonths ?? null,
      };
    });
    return { ok: true, result: { quotes, source: "yahoo-finance" } };
  });

  // ─── Competitor / market-research substrate (per-user, STATE) ───────
  function getMarketState() {
    const STATE = globalThis._concordSTATE; if (!STATE) return null;
    if (!STATE.marketLens) STATE.marketLens = {};
    if (!(STATE.marketLens.competitors instanceof Map)) STATE.marketLens.competitors = new Map();
    return STATE.marketLens;
  }
  function saveMarket() { if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* */ } } }
  const mkId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const mkActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const mkClean = (v, max = 600) => String(v == null ? "" : v).trim().slice(0, max);
  const mkNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const mkComps = (s, u) => { if (!s.competitors.has(u)) s.competitors.set(u, []); return s.competitors.get(u); };

  registerLensAction("market", "competitor-add", (ctx, _a, params = {}) => {
    const s = getMarketState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = mkClean(params.name, 160);
    if (!name) return { ok: false, error: "competitor name required" };
    const comp = { id: mkId("cmp"), name, segment: mkClean(params.segment, 80) || "general",
      marketSharePct: mkNum(params.marketSharePct), pricing: mkClean(params.pricing, 120) || null,
      strengths: mkClean(params.strengths, 600) || "", weaknesses: mkClean(params.weaknesses, 600) || "",
      threatLevel: ["low", "medium", "high"].includes(params.threatLevel) ? params.threatLevel : "medium",
      createdAt: new Date().toISOString() };
    mkComps(s, mkActor(ctx)).push(comp); saveMarket();
    return { ok: true, result: { competitor: comp } };
  });
  registerLensAction("market", "competitor-list", (ctx, _a, params = {}) => {
    const s = getMarketState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let comps = [...mkComps(s, mkActor(ctx))];
    if (params.segment) comps = comps.filter((c) => c.segment === params.segment);
    comps.sort((a, b) => (b.marketSharePct || 0) - (a.marketSharePct || 0));
    return { ok: true, result: { competitors: comps, count: comps.length } };
  });
  registerLensAction("market", "competitor-update", (ctx, _a, params = {}) => {
    const s = getMarketState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = mkComps(s, mkActor(ctx)).find((x) => x.id === params.id);
    if (!c) return { ok: false, error: "competitor not found" };
    if (params.marketSharePct != null) c.marketSharePct = mkNum(params.marketSharePct);
    if (params.threatLevel && ["low", "medium", "high"].includes(params.threatLevel)) c.threatLevel = params.threatLevel;
    if (params.strengths != null) c.strengths = mkClean(params.strengths, 600);
    if (params.weaknesses != null) c.weaknesses = mkClean(params.weaknesses, 600);
    saveMarket();
    return { ok: true, result: { competitor: c } };
  });
  registerLensAction("market", "competitor-delete", (ctx, _a, params = {}) => {
    const s = getMarketState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = mkComps(s, mkActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "competitor not found" };
    arr.splice(i, 1); saveMarket();
    return { ok: true, result: { deleted: params.id } };
  });
  registerLensAction("market", "market-dashboard", (ctx, _a, _p = {}) => {
    const s = getMarketState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const comps = mkComps(s, mkActor(ctx));
    const tracked = comps.reduce((n, c) => n + (c.marketSharePct || 0), 0);
    const bySegment = {};
    for (const c of comps) bySegment[c.segment] = (bySegment[c.segment] || 0) + 1;
    return { ok: true, result: { competitors: comps.length, highThreat: comps.filter((c) => c.threatLevel === "high").length,
      trackedSharePct: Math.round(tracked * 10) / 10, segments: bySegment } };
  });
}
