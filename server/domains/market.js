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

  // ─── Parity-sprint macros ──

  registerLensAction("market", "sector-performance", (_ctx, _artifact, params = {}) => {
    const range = ["1D", "1W", "1M", "YTD"].includes(params.range) ? params.range : "1D";
    const mult = { "1D": 1, "1W": 4, "1M": 12, "YTD": 30 }[range];
    const seed = hashStringMkt(range);
    const sectors = SAMPLE_SECTORS.map((s, i) => {
      const pct = (((seed >> i) & 31) - 15) / 15 * mult;
      const movers = (s.topSymbols || []).slice(0, 3).map((sym, j) => ({ symbol: sym, pct: ((((seed >> (i * 3 + j)) & 31) - 15) / 10 * mult) }));
      return { sector: s.name, pct, marketCap: s.cap, topMovers: movers };
    });
    return { ok: true, result: { sectors, range } };
  });

  registerLensAction("market", "quotes-batch", (_ctx, _artifact, params = {}) => {
    const symbols = Array.isArray(params.symbols) ? params.symbols.filter(s => typeof s === "string").slice(0, 50) : [];
    if (symbols.length === 0) return { ok: true, result: { quotes: [] } };
    const quotes = symbols.map(sym => {
      const seed = hashStringMkt(sym);
      const ref = SAMPLE_QUOTES.find(q => q.symbol === sym.toUpperCase());
      const basePrice = ref?.basePrice || (10 + (seed % 500));
      return {
        symbol: sym.toUpperCase(),
        name: ref?.name || `${sym.toUpperCase()} Inc.`,
        price: Math.round(basePrice * (1 + ((seed % 11) - 5) / 100) * 100) / 100,
        pctChange1d: ((seed % 21) - 10) / 5,
        pctChange1y: ((seed >> 4) % 41 - 20),
        volume: 1_000_000 + (seed % 50_000_000),
        marketCap: ref?.cap || (basePrice * 1_000_000 * (1 + (seed % 100))),
        pe: ref?.pe || (10 + (seed % 50)),
        eps: Math.round((basePrice / 25) * 100) / 100,
      };
    });
    return { ok: true, result: { quotes } };
  });
}

function hashStringMkt(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const SAMPLE_SECTORS = [
  { name: "Technology", cap: 18_000_000_000_000, topSymbols: ["AAPL", "MSFT", "NVDA", "GOOGL"] },
  { name: "Healthcare", cap: 7_500_000_000_000, topSymbols: ["UNH", "JNJ", "PFE", "LLY"] },
  { name: "Financials", cap: 6_800_000_000_000, topSymbols: ["JPM", "BAC", "WFC", "GS"] },
  { name: "Consumer Discretionary", cap: 5_500_000_000_000, topSymbols: ["AMZN", "TSLA", "HD", "NKE"] },
  { name: "Communication Services", cap: 4_800_000_000_000, topSymbols: ["META", "NFLX", "DIS", "T"] },
  { name: "Industrials", cap: 4_200_000_000_000, topSymbols: ["CAT", "BA", "HON", "UPS"] },
  { name: "Consumer Staples", cap: 3_800_000_000_000, topSymbols: ["WMT", "PG", "KO", "PEP"] },
  { name: "Energy", cap: 3_500_000_000_000, topSymbols: ["XOM", "CVX", "COP", "OXY"] },
  { name: "Utilities", cap: 1_800_000_000_000, topSymbols: ["NEE", "DUK", "SO", "AEP"] },
  { name: "Materials", cap: 1_700_000_000_000, topSymbols: ["LIN", "SHW", "APD", "ECL"] },
  { name: "Real Estate", cap: 1_500_000_000_000, topSymbols: ["AMT", "PLD", "CCI", "EQIX"] },
];

const SAMPLE_QUOTES = [
  { symbol: "AAPL", name: "Apple Inc.", basePrice: 195, cap: 3_000_000_000_000, pe: 30 },
  { symbol: "MSFT", name: "Microsoft Corporation", basePrice: 425, cap: 3_200_000_000_000, pe: 35 },
  { symbol: "GOOGL", name: "Alphabet Inc.", basePrice: 175, cap: 2_200_000_000_000, pe: 28 },
  { symbol: "AMZN", name: "Amazon.com Inc.", basePrice: 185, cap: 1_900_000_000_000, pe: 50 },
  { symbol: "NVDA", name: "NVIDIA Corporation", basePrice: 880, cap: 2_200_000_000_000, pe: 75 },
  { symbol: "TSLA", name: "Tesla Inc.", basePrice: 245, cap: 770_000_000_000, pe: 65 },
  { symbol: "META", name: "Meta Platforms Inc.", basePrice: 495, cap: 1_300_000_000_000, pe: 28 },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", basePrice: 215, cap: 620_000_000_000, pe: 12 },
  { symbol: "V", name: "Visa Inc.", basePrice: 275, cap: 560_000_000_000, pe: 30 },
  { symbol: "WMT", name: "Walmart Inc.", basePrice: 165, cap: 530_000_000_000, pe: 28 },
];
