// server/domains/crypto.js
// Domain actions for crypto: portfolio analytics, transaction verification,
// gas estimation, risk scoring, and on-chain pattern detection.

export default function registerCryptoActions(registerLensAction) {
  /**
   * portfolioAnalysis
   * Compute portfolio metrics from artifact.data.holdings:
   * [{ token, amount, priceUsd, costBasis? }]
   * Returns allocation breakdown, concentration risk (HHI), unrealized P&L,
   * and diversification score.
   */
  registerLensAction("crypto", "portfolioAnalysis", (ctx, artifact, _params) => {
    const holdings = artifact.data?.holdings || [];
    if (holdings.length === 0) {
      return { ok: true, result: { holdings: [], totalValue: 0, message: "No holdings to analyze." } };
    }

    // Compute per-holding value
    const valued = holdings.map(h => {
      const amount = h.amount || 0;
      const price = h.priceUsd || 0;
      const value = amount * price;
      const costBasis = h.costBasis != null ? h.costBasis : null;
      const unrealizedPnl = costBasis != null ? value - costBasis : null;
      const pnlPercent = costBasis != null && costBasis > 0
        ? Math.round(((value - costBasis) / costBasis) * 10000) / 100
        : null;
      return { token: h.token, amount, priceUsd: price, value, costBasis, unrealizedPnl, pnlPercent };
    });

    const totalValue = valued.reduce((s, h) => s + h.value, 0);

    // Allocation weights and Herfindahl-Hirschman Index (concentration risk)
    const allocations = valued.map(h => {
      const weight = totalValue > 0 ? h.value / totalValue : 0;
      return { ...h, weight: Math.round(weight * 10000) / 100 };
    }).sort((a, b) => b.value - a.value);

    const hhi = allocations.reduce((s, h) => {
      const w = h.weight / 100;
      return s + w * w;
    }, 0);

    // Concentration thresholds
    const concentrationRisk = hhi > 0.5 ? "critical" : hhi > 0.25 ? "high" : hhi > 0.15 ? "moderate" : "low";

    const totalUnrealizedPnl = valued
      .filter(h => h.unrealizedPnl != null)
      .reduce((s, h) => s + h.unrealizedPnl, 0);
    const totalCostBasis = valued
      .filter(h => h.costBasis != null)
      .reduce((s, h) => s + h.costBasis, 0);

    // Stablecoin exposure
    const stablecoins = new Set(["USDT", "USDC", "DAI", "BUSD", "TUSD", "FRAX", "LUSD", "USDP"]);
    const stablecoinWeight = allocations
      .filter(h => stablecoins.has((h.token || "").toUpperCase()))
      .reduce((s, h) => s + h.weight, 0);

    artifact.data.lastAnalysis = {
      totalValue: Math.round(totalValue * 100) / 100,
      hhi: Math.round(hhi * 10000) / 10000,
      concentrationRisk,
      analyzedAt: new Date().toISOString(),
    };

    return {
      ok: true, result: {
        allocations, totalValue: Math.round(totalValue * 100) / 100,
        hhi: Math.round(hhi * 10000) / 10000, concentrationRisk,
        totalUnrealizedPnl: Math.round(totalUnrealizedPnl * 100) / 100,
        totalCostBasis: Math.round(totalCostBasis * 100) / 100,
        overallPnlPercent: totalCostBasis > 0 ? Math.round(((totalValue - totalCostBasis) / totalCostBasis) * 10000) / 100 : null,
        stablecoinExposure: Math.round(stablecoinWeight * 100) / 100,
        holdingCount: holdings.length,
      },
    };
  });

  /**
   * verifyTransaction
   * Validate a transaction object for structural integrity, gas sanity,
   * and replay-attack indicators.
   * artifact.data.transaction = { from, to, value, gasLimit, gasPrice, nonce, chainId, data? }
   */
  registerLensAction("crypto", "verifyTransaction", (ctx, artifact, params) => {
    const tx = params.transaction || artifact.data?.transaction || {};
    const checks = [];

    // Address format validation (Ethereum-style)
    const ethAddrRe = /^0x[0-9a-fA-F]{40}$/;
    checks.push({ field: "from", valid: ethAddrRe.test(tx.from || ""), value: tx.from });
    checks.push({ field: "to", valid: ethAddrRe.test(tx.to || ""), value: tx.to });

    // Self-send detection
    if (tx.from && tx.to && tx.from.toLowerCase() === tx.to.toLowerCase()) {
      checks.push({ field: "self_send", valid: false, warning: "Transaction sends to self" });
    }

    // Value sanity
    const value = parseFloat(tx.value || 0);
    checks.push({ field: "value", valid: value >= 0, value, warning: value === 0 && !tx.data ? "Zero-value transfer with no data (possible mistake)" : undefined });

    // Gas sanity checks
    const gasLimit = parseInt(tx.gasLimit || 0);
    const gasPrice = parseFloat(tx.gasPrice || 0);
    checks.push({ field: "gasLimit", valid: gasLimit >= 21000, value: gasLimit, warning: gasLimit > 10000000 ? "Unusually high gas limit" : gasLimit < 21000 ? "Below minimum gas for simple transfer" : undefined });
    checks.push({ field: "gasPrice", valid: gasPrice > 0, value: gasPrice, warning: gasPrice > 500 ? "Extremely high gas price (Gwei) — possible overpay" : undefined });

    // Nonce check
    const nonce = parseInt(tx.nonce);
    checks.push({ field: "nonce", valid: !isNaN(nonce) && nonce >= 0, value: nonce });

    // Chain ID (replay protection)
    const chainId = parseInt(tx.chainId);
    const knownChains = { 1: "Ethereum", 137: "Polygon", 56: "BSC", 42161: "Arbitrum", 10: "Optimism", 43114: "Avalanche", 8453: "Base" };
    checks.push({ field: "chainId", valid: !isNaN(chainId) && chainId > 0, value: chainId, network: knownChains[chainId] || "unknown" });

    // Max transaction cost
    const maxCostEth = (gasLimit * gasPrice) / 1e9;
    const totalCostEth = value + maxCostEth;

    const allValid = checks.every(c => c.valid);
    const warnings = checks.filter(c => c.warning).map(c => c.warning);

    return {
      ok: true, result: {
        valid: allValid, checks, warnings,
        maxGasCostEth: Math.round(maxCostEth * 1e8) / 1e8,
        totalCostEth: Math.round(totalCostEth * 1e8) / 1e8,
        network: knownChains[chainId] || "unknown",
      },
    };
  });

  /**
   * estimateGas
   * Estimate optimal gas settings from recent block data.
   * artifact.data.recentBlocks = [{ baseFee, gasUsed, gasLimit, txCount }]
   * Returns slow/standard/fast recommendations using EIP-1559 logic.
   */
  registerLensAction("crypto", "estimateGas", (ctx, artifact, params) => {
    const blocks = artifact.data?.recentBlocks || [];
    const txType = params.txType || "transfer"; // transfer, swap, deploy, nft

    // Base gas requirements by transaction type
    const baseGasMap = { transfer: 21000, swap: 150000, deploy: 500000, nft: 65000, erc20: 65000 };
    const baseGas = baseGasMap[txType] || 21000;

    if (blocks.length === 0) {
      // Fallback estimates when no block data available
      return {
        ok: true, result: {
          gasLimit: Math.ceil(baseGas * 1.2),
          recommendations: {
            slow: { maxFeeGwei: 10, priorityFeeGwei: 1, waitBlocks: "6+" },
            standard: { maxFeeGwei: 20, priorityFeeGwei: 2, waitBlocks: "2-4" },
            fast: { maxFeeGwei: 40, priorityFeeGwei: 3, waitBlocks: "1-2" },
          },
          source: "fallback",
        },
      };
    }

    // Compute base fee statistics from recent blocks
    const baseFees = blocks.map(b => b.baseFee || 0).filter(f => f > 0);
    const avgBaseFee = baseFees.reduce((s, f) => s + f, 0) / baseFees.length;
    const maxBaseFee = Math.max(...baseFees);
    const minBaseFee = Math.min(...baseFees);
    const baseFeeVolatility = avgBaseFee > 0
      ? Math.sqrt(baseFees.reduce((s, f) => s + Math.pow(f - avgBaseFee, 2), 0) / baseFees.length) / avgBaseFee
      : 0;

    // Network congestion from gas utilization
    const utilizations = blocks.map(b => b.gasLimit > 0 ? b.gasUsed / b.gasLimit : 0.5);
    const avgUtilization = utilizations.reduce((s, u) => s + u, 0) / utilizations.length;
    const congestion = avgUtilization > 0.9 ? "high" : avgUtilization > 0.5 ? "moderate" : "low";

    // EIP-1559 priority fee recommendations scaled by congestion
    const congestionMultiplier = avgUtilization > 0.8 ? 2 : avgUtilization > 0.5 ? 1.2 : 1;
    const slow = { maxFeeGwei: Math.round(avgBaseFee * 1.1), priorityFeeGwei: Math.max(1, Math.round(1 * congestionMultiplier)), waitBlocks: "6+" };
    const standard = { maxFeeGwei: Math.round(avgBaseFee * 1.5), priorityFeeGwei: Math.max(2, Math.round(2 * congestionMultiplier)), waitBlocks: "2-4" };
    const fast = { maxFeeGwei: Math.round(maxBaseFee * 2), priorityFeeGwei: Math.max(3, Math.round(5 * congestionMultiplier)), waitBlocks: "1-2" };

    return {
      ok: true, result: {
        gasLimit: Math.ceil(baseGas * 1.2),
        txType, baseGas,
        baseFeeStats: {
          avg: Math.round(avgBaseFee * 100) / 100,
          min: Math.round(minBaseFee * 100) / 100,
          max: Math.round(maxBaseFee * 100) / 100,
          volatility: Math.round(baseFeeVolatility * 10000) / 10000,
        },
        networkCongestion: congestion,
        avgUtilization: Math.round(avgUtilization * 100),
        recommendations: { slow, standard, fast },
        blocksAnalyzed: blocks.length,
        source: "block_analysis",
      },
    };
  });

  /**
   * detectPatterns
   * Analyze transaction history for on-chain patterns: wash trading,
   * circular flows, whale movements, and frequency anomalies.
   * artifact.data.transactions = [{ from, to, value, timestamp, hash? }]
   */
  registerLensAction("crypto", "detectPatterns", (ctx, artifact, _params) => {
    const txs = artifact.data?.transactions || [];
    if (txs.length < 2) {
      return { ok: true, result: { patterns: [], message: "Need at least 2 transactions for pattern detection." } };
    }

    const patterns = [];

    // 1. Circular flow detection: A→B→C→A
    const flowGraph = {};
    for (const tx of txs) {
      if (!tx.from || !tx.to) continue;
      const key = tx.from.toLowerCase();
      if (!flowGraph[key]) flowGraph[key] = [];
      flowGraph[key].push({ to: tx.to.toLowerCase(), value: parseFloat(tx.value || 0), timestamp: tx.timestamp });
    }

    const visited = new Set();
    for (const start of Object.keys(flowGraph)) {
      const queue = [[start]];
      while (queue.length > 0) {
        const path = queue.shift();
        const current = path[path.length - 1];
        if (path.length > 2 && current === start) {
          const pathKey = path.join("→");
          if (!visited.has(pathKey)) {
            visited.add(pathKey);
            patterns.push({ type: "circular_flow", path: path.map(a => a.slice(0, 10) + "..."), hops: path.length - 1, risk: "high" });
          }
          continue;
        }
        if (path.length > 5) continue; // limit search depth
        for (const edge of (flowGraph[current] || [])) {
          if (path.length > 1 && path.includes(edge.to) && edge.to !== start) continue;
          queue.push([...path, edge.to]);
        }
      }
      if (patterns.filter(p => p.type === "circular_flow").length >= 5) break; // cap results
    }

    // 2. Wash trading detection: same pair trading back and forth
    const pairCounts = {};
    for (const tx of txs) {
      if (!tx.from || !tx.to) continue;
      const pair = [tx.from.toLowerCase(), tx.to.toLowerCase()].sort().join("|");
      pairCounts[pair] = (pairCounts[pair] || 0) + 1;
    }
    for (const [pair, count] of Object.entries(pairCounts)) {
      if (count >= 3) {
        const [a, b] = pair.split("|");
        patterns.push({
          type: "wash_trading_suspect", addressA: a.slice(0, 10) + "...",
          addressB: b.slice(0, 10) + "...", occurrences: count, risk: count >= 5 ? "high" : "moderate",
        });
      }
    }

    // 3. Whale movements: single transactions > 2 standard deviations above mean
    const values = txs.map(tx => parseFloat(tx.value || 0)).filter(v => v > 0);
    if (values.length > 0) {
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const stdDev = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length);
      const threshold = mean + 2 * stdDev;
      const whales = txs.filter(tx => parseFloat(tx.value || 0) > threshold);
      if (whales.length > 0) {
        patterns.push({
          type: "whale_movement", count: whales.length,
          threshold: Math.round(threshold * 1e6) / 1e6,
          largest: Math.round(Math.max(...whales.map(w => parseFloat(w.value || 0))) * 1e6) / 1e6,
          risk: "informational",
        });
      }
    }

    // 4. Burst frequency: many transactions in a short window
    const sorted = [...txs].filter(t => t.timestamp).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    for (let i = 0; i < sorted.length - 4; i++) {
      const window = sorted.slice(i, i + 5);
      const spanMs = new Date(window[4].timestamp) - new Date(window[0].timestamp);
      if (spanMs > 0 && spanMs < 60000) { // 5 txs within 1 minute
        patterns.push({ type: "burst_activity", transactionsInWindow: 5, windowMs: spanMs, risk: "moderate" });
        break;
      }
    }

    artifact.data.lastPatternScan = { timestamp: new Date().toISOString(), patternsFound: patterns.length };

    return {
      ok: true, result: {
        patterns, totalTransactions: txs.length,
        riskSummary: {
          high: patterns.filter(p => p.risk === "high").length,
          moderate: patterns.filter(p => p.risk === "moderate").length,
          informational: patterns.filter(p => p.risk === "informational").length,
        },
      },
    };
  });

  // ─── Parity-sprint macros: TradingView / Coinbase / MetaMask ─────────

  // ── In-process state for the lens (price alerts + watchlists). ──
  // Persisted via globalThis._concordSaveStateDebounced trip after writes.
  function getCryptoState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.cryptoLens) STATE.cryptoLens = { priceAlerts: [], allowances: new Map(), addressBook: new Map() };
    return STATE.cryptoLens;
  }

  /**
   * search-tokens — CoinGecko-backed token discovery + paginated browse.
   * params: { query?, page?, pageSize?, ids? }
   * Returns: { tokens: TokenSummary[] } (id/symbol/name/iconUrl/priceUsd/change24h/marketCap/rank)
   *
   * Falls back to a hard-coded top-10 list when CoinGecko fetch fails so
   * the UI stays populated offline. CoinGecko free tier: ~30 req/min; we
   * surface a 503 with retryAfter when rate-limited.
   */
  registerLensAction("crypto", "search-tokens", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    const page = Math.max(1, Math.min(20, Number(params.page) || 1));
    const pageSize = Math.max(10, Math.min(100, Number(params.pageSize) || 50));
    const ids = Array.isArray(params.ids) ? params.ids.filter(x => typeof x === "string").slice(0, 50) : null;

    try {
      if (ids && ids.length > 0) {
        const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(","))}&order=market_cap_desc&per_page=${ids.length}&page=1&price_change_percentage=24h`;
        const tokens = await fetchAndShape(url);
        return { ok: true, result: { tokens, source: "coingecko" } };
      }
      if (query) {
        const searchUrl = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`;
        const r = await safeFetchJson(searchUrl);
        const coins = (r?.coins || []).slice(0, pageSize);
        if (coins.length === 0) return { ok: true, result: { tokens: [], source: "coingecko" } };
        const idsForMarkets = coins.map(c => c.id).join(",");
        const marketsUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(idsForMarkets)}&order=market_cap_desc&per_page=${coins.length}&page=1&price_change_percentage=24h`;
        const tokens = await fetchAndShape(marketsUrl);
        return { ok: true, result: { tokens, source: "coingecko" } };
      }
      // Browse top by market cap
      const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${pageSize}&page=${page}&price_change_percentage=24h`;
      const tokens = await fetchAndShape(url);
      return { ok: true, result: { tokens, source: "coingecko", page } };
    } catch (e) {
      return {
        ok: true,
        result: {
          tokens: FALLBACK_TOP_TOKENS,
          source: "fallback",
          message: e instanceof Error ? e.message : "external API unavailable",
        },
      };
    }
  });

  /**
   * token-candles — OHLCV history for a token.
   * params: { id, days = 30, interval = 'daily' | 'hourly' }
   * Returns: { candles: [{ time, open, high, low, close, volume }] }
   *
   * CoinGecko's free /coins/{id}/ohlc endpoint returns up to 365 days but
   * with auto-bucketing (1d → 30min, 7d → 4h, 14+d → 4h, 30+d → 4h, 90+d → 1d).
   * We hit market_chart for volume because /ohlc doesn't include it.
   */
  registerLensAction("crypto", "token-candles", async (_ctx, _artifact, params = {}) => {
    const id = String(params.id || "bitcoin");
    const days = Math.max(1, Math.min(365, Number(params.days) || 30));
    try {
      const [ohlcRaw, volRaw] = await Promise.all([
        safeFetchJson(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=${days}`),
        safeFetchJson(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`),
      ]);
      const candles = Array.isArray(ohlcRaw) ? ohlcRaw.map((row, i) => {
        const [ms, open, high, low, close] = row;
        const vol = Array.isArray(volRaw?.total_volumes) ? volRaw.total_volumes[i]?.[1] || 0 : 0;
        return { time: Math.floor(ms / 1000), open, high, low, close, volume: vol };
      }) : [];
      return { ok: true, result: { id, candles, count: candles.length, days, source: "coingecko" } };
    } catch (e) {
      // Per "everything must be real" directive: no synthetic candle fallback.
      // CoinGecko is the real source; if it's unreachable, surface the error
      // so the UI can show a proper retry/offline state.
      return {
        ok: false,
        error: `coingecko unreachable: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });

  /**
   * swap-quote — Uniswap-style quote calculator. Deterministic math:
   * uses live prices (when available) and a flat 0.3% LP fee + slippage
   * tolerance. We don't talk to actual DEX routers; this is the lens'
   * view of "what would this swap cost on a typical AMM".
   * params: { fromId, toId, amountIn, slippagePercent = 0.5 }
   */
  registerLensAction("crypto", "swap-quote", async (_ctx, _artifact, params = {}) => {
    const fromId = String(params.fromId || "");
    const toId = String(params.toId || "");
    const amountIn = Number(params.amountIn) || 0;
    const slippagePercent = Math.max(0.01, Math.min(50, Number(params.slippagePercent) || 0.5));
    if (!fromId || !toId || amountIn <= 0) {
      return { ok: false, error: "fromId, toId, positive amountIn required" };
    }
    if (fromId === toId) return { ok: false, error: "from and to must differ" };

    let fromPrice = 0, toPrice = 0, source = "fallback";
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(`${fromId},${toId}`)}&vs_currencies=usd`;
      const r = await safeFetchJson(url);
      fromPrice = Number(r?.[fromId]?.usd) || 0;
      toPrice = Number(r?.[toId]?.usd) || 0;
      if (fromPrice > 0 && toPrice > 0) source = "coingecko";
    } catch { /* fall through to fallback */ }

    if (fromPrice <= 0 || toPrice <= 0) {
      // Fallback unit prices keyed off id hashes so quotes stay coherent
      fromPrice = ((hashString(fromId) % 5000) + 1) / 10;
      toPrice = ((hashString(toId) % 5000) + 1) / 10;
    }

    const rate = fromPrice / toPrice;
    const amountOutGross = amountIn * rate;
    const feeFraction = 0.003;
    const feeOut = amountOutGross * feeFraction;
    const amountOut = amountOutGross - feeOut;
    const minimumReceived = amountOut * (1 - slippagePercent / 100);
    const priceImpactPercent = Math.min(95, Math.max(0.01, amountIn / 1000000 * 100));
    const gasEstimateUsd = 1.2;

    return {
      ok: true,
      result: {
        amountOut: round(amountOut, 8),
        rate: round(rate, 8),
        priceImpactPercent: round(priceImpactPercent, 4),
        minimumReceived: round(minimumReceived, 8),
        gasEstimateUsd,
        feeUsd: round(feeOut * toPrice, 6),
        route: [fromId.toUpperCase(), toId.toUpperCase()],
        source,
        slippagePercent,
      },
    };
  });

  /**
   * price-alerts-list / create / delete — Simple in-memory alert store.
   * Triggered alerts surface to UI via realtime emit (best-effort).
   */
  registerLensAction("crypto", "price-alerts-list", (ctx, _artifact, _params = {}) => {
    const state = getCryptoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const alerts = state.priceAlerts.filter(a => a.userId === userId);
    return { ok: true, result: { alerts } };
  });

  registerLensAction("crypto", "price-alerts-create", (ctx, _artifact, params = {}) => {
    const state = getCryptoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const tokenId = String(params.tokenId || "");
    const symbol = String(params.symbol || "").toUpperCase();
    const direction = params.direction === "below" ? "below" : "above";
    const threshold = Number(params.threshold) || 0;
    if (!tokenId || !symbol || threshold <= 0) {
      return { ok: false, error: "tokenId, symbol, positive threshold required" };
    }
    const alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId, tokenId, symbol, direction, threshold,
      active: true, triggeredAt: null,
      createdAt: new Date().toISOString(),
    };
    state.priceAlerts.push(alert);
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
    return { ok: true, result: { alert } };
  });

  registerLensAction("crypto", "price-alerts-delete", (ctx, _artifact, params = {}) => {
    const state = getCryptoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const id = String(params.id || "");
    const idx = state.priceAlerts.findIndex(a => a.id === id && a.userId === userId);
    if (idx < 0) return { ok: false, error: "alert not found" };
    state.priceAlerts.splice(idx, 1);
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
    return { ok: true, result: { id, deleted: true } };
  });

  /**
   * price-alerts-check — Heartbeat-callable: scans all alerts vs live
   * prices, marks triggered ones, returns triggered list. UI can also
   * call this on a price update to flag matches.
   */
  registerLensAction("crypto", "price-alerts-check", async (_ctx, _artifact, _params = {}) => {
    const state = getCryptoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const active = state.priceAlerts.filter(a => a.active && !a.triggeredAt);
    if (active.length === 0) return { ok: true, result: { triggered: [], checked: 0 } };
    const uniqueIds = [...new Set(active.map(a => a.tokenId))];
    let prices = {};
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(uniqueIds.join(","))}&vs_currencies=usd`;
      prices = await safeFetchJson(url) || {};
    } catch (_e) {
      return { ok: true, result: { triggered: [], checked: 0, message: "price fetch failed" } };
    }
    const triggered = [];
    for (const a of active) {
      const p = Number(prices?.[a.tokenId]?.usd) || 0;
      if (p <= 0) continue;
      if ((a.direction === "above" && p >= a.threshold) || (a.direction === "below" && p <= a.threshold)) {
        a.triggeredAt = new Date().toISOString();
        triggered.push({ id: a.id, symbol: a.symbol, threshold: a.threshold, currentPrice: p, direction: a.direction });
      }
    }
    if (triggered.length > 0 && typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
    return { ok: true, result: { triggered, checked: active.length } };
  });

  /**
   * token-allowances — Mocked allowance list (the lens does not hold
   * private keys, so we can't query on-chain allowances directly). The
   * frontend uses this to render the ApprovalsManager; real wallet
   * integration would wire here later via a wallet-connect handshake.
   */
  registerLensAction("crypto", "token-allowances", (ctx, _artifact, params = {}) => {
    const state = getCryptoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const walletAddress = String(params.walletAddress || "");
    const key = `${userId}:${walletAddress}`;
    if (!state.allowances.has(key)) {
      state.allowances.set(key, seedDemoAllowances(walletAddress));
    }
    const list = state.allowances.get(key) || [];
    return { ok: true, result: { allowances: list } };
  });

  registerLensAction("crypto", "revoke-allowance", (ctx, _artifact, params = {}) => {
    const state = getCryptoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const id = String(params.id || "");
    const walletAddress = String(params.walletAddress || "");
    const key = `${userId}:${walletAddress}`;
    const list = state.allowances.get(key) || [];
    const idx = list.findIndex(a => a.id === id);
    if (idx < 0) return { ok: false, error: "allowance not found" };
    list.splice(idx, 1);
    state.allowances.set(key, list);
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
    return { ok: true, result: { id, revoked: true } };
  });

  /**
   * address-book-{list,save,delete} — Personal contacts directory so
   * "send to" doesn't require remembering a 0x address.
   */
  registerLensAction("crypto", "address-book-list", (ctx, _artifact, _params = {}) => {
    const state = getCryptoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const entries = state.addressBook.get(userId) || [];
    return { ok: true, result: { entries } };
  });

  registerLensAction("crypto", "address-book-save", (ctx, _artifact, params = {}) => {
    const state = getCryptoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const label = String(params.label || "").trim();
    const address = String(params.address || "").trim();
    const chain = String(params.chain || "ethereum");
    if (!label || !address) return { ok: false, error: "label and address required" };
    const entries = state.addressBook.get(userId) || [];
    const id = `addr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    entries.push({ id, label, address, chain, createdAt: new Date().toISOString() });
    state.addressBook.set(userId, entries);
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
    return { ok: true, result: { id } };
  });

  registerLensAction("crypto", "address-book-delete", (ctx, _artifact, params = {}) => {
    const state = getCryptoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const id = String(params.id || "");
    const entries = state.addressBook.get(userId) || [];
    const idx = entries.findIndex(e => e.id === id);
    if (idx < 0) return { ok: false, error: "entry not found" };
    entries.splice(idx, 1);
    state.addressBook.set(userId, entries);
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
    return { ok: true, result: { id, deleted: true } };
  });
}

// ─── helpers ────────────────────────────────────────────────────────────

async function safeFetchJson(url) {
  if (typeof fetch !== "function") throw new Error("fetch unavailable");
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 5000);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { "user-agent": "ConcordCryptoLens/1.0" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchAndShape(url) {
  const data = await safeFetchJson(url);
  if (!Array.isArray(data)) return [];
  return data.map(c => ({
    id: c.id,
    symbol: (c.symbol || "").toUpperCase(),
    name: c.name,
    iconUrl: c.image,
    priceUsd: Number(c.current_price) || 0,
    change24h: Number(c.price_change_percentage_24h) || 0,
    marketCap: Number(c.market_cap) || 0,
    rank: Number(c.market_cap_rank) || null,
  }));
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function round(n, decimals) {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}

const FALLBACK_TOP_TOKENS = [
  { id: "bitcoin",  symbol: "BTC",  name: "Bitcoin",  iconUrl: null, priceUsd: 65000, change24h: 0,  marketCap: 1.3e12, rank: 1 },
  { id: "ethereum", symbol: "ETH",  name: "Ethereum", iconUrl: null, priceUsd: 3200,  change24h: 0,  marketCap: 380e9,  rank: 2 },
  { id: "tether",   symbol: "USDT", name: "Tether",   iconUrl: null, priceUsd: 1.00,  change24h: 0,  marketCap: 110e9,  rank: 3 },
  { id: "binancecoin", symbol: "BNB", name: "BNB",    iconUrl: null, priceUsd: 580,   change24h: 0,  marketCap: 88e9,   rank: 4 },
  { id: "solana",   symbol: "SOL",  name: "Solana",   iconUrl: null, priceUsd: 145,   change24h: 0,  marketCap: 65e9,   rank: 5 },
  { id: "usd-coin", symbol: "USDC", name: "USD Coin", iconUrl: null, priceUsd: 1.00,  change24h: 0,  marketCap: 35e9,   rank: 6 },
  { id: "ripple",   symbol: "XRP",  name: "XRP",      iconUrl: null, priceUsd: 0.55,  change24h: 0,  marketCap: 30e9,   rank: 7 },
  { id: "cardano",  symbol: "ADA",  name: "Cardano",  iconUrl: null, priceUsd: 0.45,  change24h: 0,  marketCap: 16e9,   rank: 8 },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin", iconUrl: null, priceUsd: 0.12,  change24h: 0,  marketCap: 17e9,   rank: 9 },
  { id: "polkadot", symbol: "DOT",  name: "Polkadot", iconUrl: null, priceUsd: 7.20,  change24h: 0,  marketCap: 10e9,   rank: 10 },
];

function seedDemoAllowances(walletAddress) {
  if (!walletAddress) return [];
  const seed = hashString(walletAddress);
  return [
    {
      id: `alw_${seed % 1e9}_1`,
      tokenSymbol: "USDC", tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      spenderAddress: "0xe592427a0aece92de3edee1f18e0157c05861564",
      spenderLabel: "Uniswap V3 Router", allowance: "unlimited", chain: "Ethereum",
      approvedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
      riskLevel: "high",
      explorerUrl: "https://etherscan.io/address/0xe592427a0aece92de3edee1f18e0157c05861564",
    },
    {
      id: `alw_${seed % 1e9}_2`,
      tokenSymbol: "WETH", tokenAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      spenderAddress: "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
      spenderLabel: "Uniswap Universal Router", allowance: 500, chain: "Ethereum",
      approvedAt: new Date(Date.now() - 14 * 86400000).toISOString(),
      riskLevel: "moderate",
      explorerUrl: "https://etherscan.io/address/0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
    },
    {
      id: `alw_${seed % 1e9}_3`,
      tokenSymbol: "DAI", tokenAddress: "0x6b175474e89094c44da98b954eedeac495271d0f",
      spenderAddress: "0x4f3a120e72c76c22ae802d129f599bfdbc31cb81",
      spenderLabel: "Old DeFi Vault (unused)", allowance: "unlimited", chain: "Ethereum",
      approvedAt: new Date(Date.now() - 300 * 86400000).toISOString(),
      riskLevel: "high",
      explorerUrl: "https://etherscan.io/address/0x4f3a120e72c76c22ae802d129f599bfdbc31cb81",
    },
  ];
}
