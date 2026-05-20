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
    const s = STATE.cryptoLens;
    // 2026 parity backfills — append-only.
    if (!s.holdings)          s.holdings          = new Map(); // userId -> Array<Holding lot>
    if (!s.transactions)      s.transactions      = new Map(); // userId -> Array<Tx>
    if (!s.stakingPositions)  s.stakingPositions  = new Map(); // userId -> Array<StakingPosition>
    if (!s.recurringBuys)     s.recurringBuys     = new Map(); // userId -> Array<RecurringBuy>
    if (!s.nfts)              s.nfts              = new Map(); // userId -> Array<NFT>
    if (!s.watchlist)         s.watchlist         = new Map(); // userId -> Set<symbol>
    if (!s.orders)            s.orders            = new Map(); // userId -> Array<LimitOrder>
    if (!s.valueSnapshots)    s.valueSnapshots    = new Map(); // userId -> Array<{date,totalValueUsd,totalCostUsd}>
    if (!s.wallets)           s.wallets           = new Map(); // userId -> Array<Wallet>
    if (!s.seq)               s.seq               = new Map();
    return s;
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
      // Per "everything must be real" directive: surface the network
      // error instead of returning a hardcoded FALLBACK_TOP_TOKENS list.
      return {
        ok: false,
        error: `coingecko unreachable: ${e instanceof Error ? e.message : String(e)}`,
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
   * swap-quote — Indicative spot quote from CoinGecko prices.
   *
   * Per "everything must be real" directive: priceImpactPercent and
   * gasEstimateUsd are NOT computable from spot prices alone — they
   * require an aggregator with live pool depth + the current gas
   * oracle. This macro returns those fields as `null` with a clear
   * `kind:'indicative'` flag so callers don't mistake the indicative
   * quote for an executable one.
   *
   * For an executable quote (with real depth + real gas + the actual
   * DEX route the trade will hit), use crypto.swap-route (which hits
   * the 0x aggregator API; requires ZEROX_API_KEY env).
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

    let fromPrice = 0, toPrice = 0;
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(`${fromId},${toId}`)}&vs_currencies=usd`;
      const r = await safeFetchJson(url);
      fromPrice = Number(r?.[fromId]?.usd) || 0;
      toPrice = Number(r?.[toId]?.usd) || 0;
    } catch (e) {
      return { ok: false, error: `coingecko unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (fromPrice <= 0 || toPrice <= 0) {
      return {
        ok: false,
        error: `coingecko has no usd price for ${fromPrice <= 0 ? fromId : toId} — refusing to synthesize a swap quote`,
      };
    }

    const rate = fromPrice / toPrice;
    const amountOutGross = amountIn * rate;
    const feeFraction = 0.003;
    const feeOut = amountOutGross * feeFraction;
    const amountOut = amountOutGross - feeOut;
    const minimumReceived = amountOut * (1 - slippagePercent / 100);

    return {
      ok: true,
      result: {
        amountOut: round(amountOut, 8),
        rate: round(rate, 8),
        // Indicative quote — these fields require an aggregator + gas oracle.
        // Use crypto.swap-route for real executable values.
        priceImpactPercent: null,
        gasEstimateUsd: null,
        minimumReceived: round(minimumReceived, 8),
        feeUsd: round(feeOut * toPrice, 6),
        route: [fromId.toUpperCase(), toId.toUpperCase()],
        source: "coingecko",
        kind: "indicative",
        slippagePercent,
        notes: "Indicative spot quote — assumes 0.3% LP fee. For executable quote with real depth + gas, call crypto.swap-route (0x aggregator, requires ZEROX_API_KEY).",
      },
    };
  });

  /**
   * swap-route — Real executable swap quote from the 0x aggregator.
   * Returns the actual DEX route the trade will hit (Uniswap V3,
   * SushiSwap, Curve, Balancer, etc.), real on-chain gas estimate,
   * real price impact computed against current pool depth, and the
   * raw transaction data the user's wallet can sign + broadcast.
   *
   * Per "everything must be real" directive: no simulated routing,
   * no synthesized gas. Requires ZEROX_API_KEY (free dev tier:
   * https://dashboard.0x.org/).
   *
   * params: {
   *   sellToken: ERC-20 address or symbol (ETH/WETH/USDC/...)
   *   buyToken:  ERC-20 address or symbol
   *   sellAmount: amount in base units (wei for ETH, 6dp for USDC, etc.)
   *   chainId: 1 (Ethereum mainnet, default), 137 (Polygon), 8453 (Base),
   *            42161 (Arbitrum), 10 (Optimism)
   *   taker: optional wallet address (required for /quote, omit for /price)
   *   slippageBps: optional, default 50 (= 0.5%)
   * }
   *
   * Returns:
   *   { buyAmount, sellAmount, price, guaranteedPrice, estimatedPriceImpact,
   *     gas, gasPrice, sources: [...DEXes routed through...], to, data, value, kind:'executable' }
   */
  registerLensAction("crypto", "swap-route", async (_ctx, _artifact, params = {}) => {
    const sellToken = String(params.sellToken || "");
    const buyToken = String(params.buyToken || "");
    const sellAmount = String(params.sellAmount || "");
    const chainId = Number(params.chainId) || 1;
    const slippageBps = Math.max(1, Math.min(5000, Number(params.slippageBps) || 50));
    const taker = params.taker ? String(params.taker) : null;
    if (!sellToken || !buyToken || !sellAmount) {
      return { ok: false, error: "sellToken, buyToken, sellAmount required" };
    }
    if (sellToken === buyToken) return { ok: false, error: "sellToken and buyToken must differ" };
    if (!/^\d+$/.test(sellAmount)) return { ok: false, error: "sellAmount must be base-unit integer string (wei / 6dp / etc.)" };

    if (!process.env.ZEROX_API_KEY) {
      return {
        ok: false,
        error: "0x aggregator not configured. Set ZEROX_API_KEY env (free dev tier at https://dashboard.0x.org/). Concord does not synthesize swap routes.",
      };
    }

    // 0x v2 base URLs per chain
    const chainHost = {
      1:     "api.0x.org",            // Ethereum
      137:   "polygon.api.0x.org",    // Polygon (deprecated by 0x; v2 routes via api.0x.org with chainId)
      8453:  "base.api.0x.org",
      42161: "arbitrum.api.0x.org",
      10:    "optimism.api.0x.org",
    }[chainId];
    if (!chainHost) return { ok: false, error: `unsupported chainId ${chainId}` };

    // Use v2 permit2 endpoint when taker is supplied (full signable
    // tx); else /price for an indicative aggregator quote.
    const path = taker ? "/swap/permit2/quote" : "/swap/permit2/price";
    const qs = new URLSearchParams({
      sellToken, buyToken, sellAmount,
      chainId: String(chainId),
      slippageBps: String(slippageBps),
    });
    if (taker) qs.set("taker", taker);
    const url = `https://${chainHost}${path}?${qs.toString()}`;

    try {
      const r = await fetch(url, {
        headers: {
          "0x-api-key": process.env.ZEROX_API_KEY,
          "0x-version": "v2",
        },
      });
      const data = await r.json();
      if (!r.ok) {
        return { ok: false, error: `0x ${path} ${r.status}: ${data?.reason || data?.message || "unknown"}` };
      }
      // 0x v2 response shape varies between /price and /quote; surface
      // both shapes uniformly. Fields not returned by /price (gas,
      // transaction.{to,data,value}) come back null when taker omitted.
      return {
        ok: true,
        result: {
          buyToken, sellToken, sellAmount, chainId,
          buyAmount: data.buyAmount ?? null,
          minBuyAmount: data.minBuyAmount ?? null,
          price: data.price ?? null,
          guaranteedPrice: data.guaranteedPrice ?? null,
          estimatedPriceImpact: data.estimatedPriceImpact ?? null,
          gas: data.gas ?? data.transaction?.gas ?? null,
          gasPrice: data.gasPrice ?? data.transaction?.gasPrice ?? null,
          sources: data.route?.fills?.map((f) => ({ source: f.source, proportionBps: f.proportionBps })) ?? data.sources ?? [],
          to: data.transaction?.to ?? null,
          data: data.transaction?.data ?? null,
          value: data.transaction?.value ?? null,
          allowanceTarget: data.issues?.allowance?.spender ?? data.allowanceTarget ?? null,
          source: "0x-aggregator",
          kind: taker ? "executable" : "indicative-aggregator",
          slippageBps,
        },
      };
    } catch (e) {
      return { ok: false, error: `0x unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
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
   * token-allowances — On-chain ERC-20 token approvals for a wallet.
   *
   * Per "everything must be real" directive: this no longer seeds demo
   * Uniswap/DAI allowances. Real data requires an Etherscan-class API
   * (Etherscan getTokenAllowances or Alchemy alchemy_getTokenAllowance)
   * with ETHERSCAN_API_KEY or ALCHEMY_API_KEY env. Until that wire-up,
   * returns the user's previously-revealed allowance list from STATE.
   */
  registerLensAction("crypto", "token-allowances", (ctx, _artifact, params = {}) => {
    const state = getCryptoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const walletAddress = String(params.walletAddress || "");
    if (!walletAddress) return { ok: false, error: "walletAddress required" };
    const key = `${userId}:${walletAddress}`;
    const list = state.allowances.get(key) || [];
    return {
      ok: true,
      result: {
        allowances: list,
        source: list.length === 0 ? "empty" : "wallet-revealed",
        notes: list.length === 0
          ? "No allowances revealed. Wire ETHERSCAN_API_KEY or ALCHEMY_API_KEY for on-chain allowance scanning, or POST entries via crypto.allowance-add (populated by a WalletConnect signed reveal)."
          : null,
      },
    };
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

  // ═══════════════════════════════════════════════════════════════
  //  Coinbase + Phantom 2026 parity — portfolio with FIFO cost basis,
  //  transactions log, recurring buys (DCA), staking positions, NFTs,
  //  watchlist, multi-chain summary, tax report, AI portfolio insight.
  // ═══════════════════════════════════════════════════════════════

  function aidCr(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function uidCr(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function isoCr() { return new Date().toISOString(); }
  function dayCr() { return new Date().toISOString().slice(0, 10); }
  function listCr(map, k) { if (!map.has(k)) map.set(k, []); return map.get(k); }
  function setCr(map, k) { if (!map.has(k)) map.set(k, new Set()); return map.get(k); }
  function ensureSeqCr(s, userId) {
    if (!s.seq.has(userId)) s.seq.set(userId, { lot: 1, tx: 1, rb: 1, st: 1, nft: 1 });
    const seq = s.seq.get(userId);
    for (const k of ['lot','tx','rb','st','nft']) if (!Number.isFinite(seq[k])) seq[k] = 1;
    return seq;
  }
  function saveCrypto() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) {}
    }
  }

  const CHAIN_OPTIONS = ['ethereum', 'solana', 'bitcoin', 'polygon', 'base', 'arbitrum', 'optimism', 'sui', 'avalanche'];
  const TX_KINDS = ['buy', 'sell', 'receive', 'send', 'swap', 'stake', 'unstake', 'reward', 'fee'];

  // Fetch live prices from CoinGecko. Returns { [symbolLower]: priceUsd }. No invented prices.
  async function fetchLivePrices(symbols) {
    if (!symbols || symbols.length === 0) return {};
    try {
      const ids = symbols.map(s => String(s).toLowerCase()).join(',');
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd`;
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) return {};
      const data = await r.json();
      const out = {};
      for (const [id, val] of Object.entries(data)) {
        if (val && typeof val.usd === 'number') out[id] = val.usd;
      }
      return out;
    } catch (_e) {
      return {};
    }
  }

  // ── Holdings (FIFO cost-basis lots) ───────────────────────────

  registerLensAction("crypto", "holdings-add", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const symbol = String(params.symbol || params.coingeckoId || "").trim().toLowerCase();
    const qty = Number(params.qty);
    const costBasisUsd = Number(params.costBasisUsd);
    if (!symbol || !Number.isFinite(qty) || qty <= 0) return { ok: false, error: "symbol + positive qty required" };
    if (!Number.isFinite(costBasisUsd) || costBasisUsd < 0) return { ok: false, error: "non-negative costBasisUsd required" };
    const chain = CHAIN_OPTIONS.includes(params.chain) ? params.chain : 'ethereum';
    const seq = ensureSeqCr(s, userId);
    const lot = {
      id: uidCr('lot'),
      number: `H-${String(seq.lot).padStart(5, '0')}`,
      symbol,
      ticker: String(params.ticker || symbol).toUpperCase(),
      chain,
      qty,
      qtyRemaining: qty,
      costBasisUsd,          // total cost (USD) for this lot
      unitCostUsd: qty > 0 ? costBasisUsd / qty : 0,
      acquiredAt: String(params.acquiredAt || dayCr()),
      source: String(params.source || 'manual'),
      walletId: params.walletId ? String(params.walletId) : null,
      notes: String(params.notes || ''),
    };
    seq.lot++;
    listCr(s.holdings, userId).push(lot);
    // Mirror as a transaction.
    const tx = {
      id: uidCr('tx'),
      number: `T-${String(seq.tx).padStart(6, '0')}`,
      kind: 'buy',
      symbol, ticker: lot.ticker, chain,
      qty,
      priceUsd: lot.unitCostUsd,
      totalUsd: costBasisUsd,
      at: lot.acquiredAt,
      lotId: lot.id,
      notes: lot.notes,
    };
    seq.tx++;
    listCr(s.transactions, userId).push(tx);
    saveCrypto();
    return { ok: true, result: { lot, transaction: tx } };
  });

  registerLensAction("crypto", "holdings-list", async (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const walletFilter = params.walletId ? String(params.walletId) : null;
    const lots = listCr(s.holdings, userId)
      .filter(l => l.qtyRemaining > 0)
      .filter(l => !walletFilter || l.walletId === walletFilter);
    // Aggregate by symbol so the UI can show portfolio rows.
    const bySymbol = new Map();
    for (const lot of lots) {
      const cur = bySymbol.get(lot.symbol) || { symbol: lot.symbol, ticker: lot.ticker, chains: new Set(), qty: 0, totalCost: 0, lots: [] };
      cur.chains.add(lot.chain);
      cur.qty += lot.qtyRemaining;
      cur.totalCost += lot.unitCostUsd * lot.qtyRemaining;
      cur.lots.push({ id: lot.id, qty: lot.qtyRemaining, unitCostUsd: lot.unitCostUsd, acquiredAt: lot.acquiredAt });
      bySymbol.set(lot.symbol, cur);
    }
    // Fetch live prices in one call.
    const symbols = Array.from(bySymbol.keys());
    const prices = await fetchLivePrices(symbols);
    const holdings = Array.from(bySymbol.values()).map(h => {
      const priceUsd = prices[h.symbol] || null;
      const marketValueUsd = priceUsd !== null ? Math.round(h.qty * priceUsd * 100) / 100 : null;
      const avgCostUsd = h.qty > 0 ? Math.round((h.totalCost / h.qty) * 10000) / 10000 : 0;
      const unrealizedPnlUsd = priceUsd !== null ? Math.round((marketValueUsd - h.totalCost) * 100) / 100 : null;
      const unrealizedPnlPct = priceUsd !== null && h.totalCost > 0 ? Math.round(((marketValueUsd - h.totalCost) / h.totalCost) * 10000) / 100 : null;
      return {
        symbol: h.symbol,
        ticker: h.ticker,
        chains: Array.from(h.chains),
        qty: h.qty,
        avgCostUsd,
        totalCostUsd: Math.round(h.totalCost * 100) / 100,
        priceUsd,
        marketValueUsd,
        unrealizedPnlUsd,
        unrealizedPnlPct,
        lotCount: h.lots.length,
      };
    }).sort((a, b) => (b.marketValueUsd || 0) - (a.marketValueUsd || 0));
    return { ok: true, result: { holdings, priceSource: Object.keys(prices).length > 0 ? 'coingecko' : 'unavailable' } };
  });

  // FIFO sell — closes oldest lots first; emits realized G/L on the transaction.
  registerLensAction("crypto", "holdings-sell", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const symbol = String(params.symbol || "").toLowerCase();
    const sellQty = Number(params.qty);
    const proceedsUsd = Number(params.proceedsUsd);
    if (!symbol || !Number.isFinite(sellQty) || sellQty <= 0) return { ok: false, error: "symbol + positive qty required" };
    if (!Number.isFinite(proceedsUsd) || proceedsUsd < 0) return { ok: false, error: "non-negative proceedsUsd required" };
    const lots = listCr(s.holdings, userId).filter(l => l.symbol === symbol && l.qtyRemaining > 0).sort((a, b) => a.acquiredAt.localeCompare(b.acquiredAt));
    const totalAvail = lots.reduce((sum, l) => sum + l.qtyRemaining, 0);
    if (sellQty > totalAvail + 1e-9) return { ok: false, error: `only ${totalAvail} ${symbol} available, cannot sell ${sellQty}` };
    let remainingToSell = sellQty;
    let costOfSold = 0;
    const closedLots = [];
    for (const lot of lots) {
      if (remainingToSell <= 0) break;
      const take = Math.min(lot.qtyRemaining, remainingToSell);
      costOfSold += take * lot.unitCostUsd;
      lot.qtyRemaining = Math.max(0, lot.qtyRemaining - take);
      closedLots.push({ lotId: lot.id, qty: take, unitCostUsd: lot.unitCostUsd });
      remainingToSell -= take;
    }
    const realizedPnlUsd = Math.round((proceedsUsd - costOfSold) * 100) / 100;
    const seq = ensureSeqCr(s, userId);
    const tx = {
      id: uidCr('tx'),
      number: `T-${String(seq.tx).padStart(6, '0')}`,
      kind: 'sell',
      symbol,
      ticker: lots[0]?.ticker || symbol.toUpperCase(),
      chain: lots[0]?.chain || 'ethereum',
      qty: sellQty,
      priceUsd: Math.round((proceedsUsd / sellQty) * 10000) / 10000,
      totalUsd: proceedsUsd,
      costBasisUsd: Math.round(costOfSold * 100) / 100,
      realizedPnlUsd,
      at: String(params.at || dayCr()),
      closedLots,
      notes: String(params.notes || ''),
    };
    seq.tx++;
    listCr(s.transactions, userId).push(tx);
    saveCrypto();
    return { ok: true, result: { transaction: tx, totalCostOfSold: Math.round(costOfSold * 100) / 100 } };
  });

  registerLensAction("crypto", "portfolio-summary", async (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const walletFilter = params.walletId ? String(params.walletId) : null;
    const lots = listCr(s.holdings, userId)
      .filter(l => l.qtyRemaining > 0)
      .filter(l => !walletFilter || l.walletId === walletFilter);
    const symbols = Array.from(new Set(lots.map(l => l.symbol)));
    const prices = await fetchLivePrices(symbols);
    let totalCost = 0, totalValue = 0;
    const byChain = new Map();
    for (const lot of lots) {
      const value = (prices[lot.symbol] || 0) * lot.qtyRemaining;
      totalCost += lot.unitCostUsd * lot.qtyRemaining;
      totalValue += value;
      const c = byChain.get(lot.chain) || { chain: lot.chain, valueUsd: 0, qtyLots: 0 };
      c.valueUsd += value;
      c.qtyLots += 1;
      byChain.set(lot.chain, c);
    }
    const txns = listCr(s.transactions, userId);
    const realizedYtd = txns.filter(t => t.kind === 'sell' && (t.at || '') >= `${new Date().getFullYear()}-01-01`).reduce((sum, t) => sum + (t.realizedPnlUsd || 0), 0);
    const stakingRewardsYtd = txns.filter(t => t.kind === 'reward' && (t.at || '') >= `${new Date().getFullYear()}-01-01`).reduce((sum, t) => sum + (t.totalUsd || 0), 0);
    return {
      ok: true,
      result: {
        totalValueUsd: Math.round(totalValue * 100) / 100,
        totalCostUsd: Math.round(totalCost * 100) / 100,
        unrealizedPnlUsd: Math.round((totalValue - totalCost) * 100) / 100,
        unrealizedPnlPct: totalCost > 0 ? Math.round(((totalValue - totalCost) / totalCost) * 10000) / 100 : 0,
        realizedPnlYtdUsd: Math.round(realizedYtd * 100) / 100,
        stakingRewardsYtdUsd: Math.round(stakingRewardsYtd * 100) / 100,
        lotCount: lots.length,
        symbolCount: symbols.length,
        byChain: Array.from(byChain.values()).sort((a, b) => b.valueUsd - a.valueUsd).map(c => ({ ...c, valueUsd: Math.round(c.valueUsd * 100) / 100 })),
        priceSource: Object.keys(prices).length > 0 ? 'coingecko' : 'unavailable',
      },
    };
  });

  // ── Transactions ──────────────────────────────────────────────

  registerLensAction("crypto", "transactions-list", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const kind = TX_KINDS.includes(params.kind) ? params.kind : null;
    const symbol = params.symbol ? String(params.symbol).toLowerCase() : null;
    const limit = Math.max(1, Math.min(500, Number(params.limit) || 100));
    let list = listCr(s.transactions, userId);
    if (kind) list = list.filter(t => t.kind === kind);
    if (symbol) list = list.filter(t => t.symbol === symbol);
    list = list.slice().sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, limit);
    return { ok: true, result: { transactions: list, total: list.length } };
  });

  registerLensAction("crypto", "transactions-record", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const kind = TX_KINDS.includes(params.kind) ? params.kind : null;
    if (!kind) return { ok: false, error: `kind must be one of: ${TX_KINDS.join(', ')}` };
    const symbol = String(params.symbol || '').toLowerCase();
    const qty = Number(params.qty);
    if (!symbol || !Number.isFinite(qty) || qty <= 0) return { ok: false, error: "symbol + positive qty required" };
    const seq = ensureSeqCr(s, userId);
    const totalUsd = Number(params.totalUsd) || 0;
    const tx = {
      id: uidCr('tx'),
      number: `T-${String(seq.tx).padStart(6, '0')}`,
      kind,
      symbol,
      ticker: String(params.ticker || symbol).toUpperCase(),
      chain: CHAIN_OPTIONS.includes(params.chain) ? params.chain : 'ethereum',
      qty,
      priceUsd: qty > 0 ? Math.round((totalUsd / qty) * 10000) / 10000 : 0,
      totalUsd,
      at: String(params.at || dayCr()),
      counterparty: String(params.counterparty || ''),
      txHash: String(params.txHash || ''),
      notes: String(params.notes || ''),
    };
    seq.tx++;
    listCr(s.transactions, userId).push(tx);
    saveCrypto();
    return { ok: true, result: { transaction: tx } };
  });

  // ── Recurring buys (DCA) ─────────────────────────────────────

  registerLensAction("crypto", "recurring-buys-list", (ctx, _a, _p = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { recurringBuys: listCr(s.recurringBuys, aidCr(ctx)) } };
  });

  registerLensAction("crypto", "recurring-buys-create", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const symbol = String(params.symbol || '').toLowerCase();
    const amountUsd = Number(params.amountUsd);
    const cadence = ['daily', 'weekly', 'biweekly', 'monthly'].includes(params.cadence) ? params.cadence : 'monthly';
    if (!symbol || !Number.isFinite(amountUsd) || amountUsd <= 0) return { ok: false, error: "symbol + positive amountUsd required" };
    const seq = ensureSeqCr(s, userId);
    const startAt = String(params.startAt || dayCr());
    const rb = {
      id: uidCr('rb'),
      number: `DCA-${String(seq.rb).padStart(4, '0')}`,
      symbol,
      ticker: String(params.ticker || symbol).toUpperCase(),
      chain: CHAIN_OPTIONS.includes(params.chain) ? params.chain : 'ethereum',
      amountUsd,
      cadence,
      startAt,
      nextRunAt: startAt,
      active: true,
      lastRunAt: null,
      runCount: 0,
      createdAt: isoCr(),
    };
    seq.rb++;
    listCr(s.recurringBuys, userId).push(rb);
    saveCrypto();
    return { ok: true, result: { recurringBuy: rb } };
  });

  registerLensAction("crypto", "recurring-buys-toggle", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listCr(s.recurringBuys, aidCr(ctx));
    const rb = list.find(x => x.id === String(params.id || ""));
    if (!rb) return { ok: false, error: "recurring buy not found" };
    rb.active = !rb.active;
    saveCrypto();
    return { ok: true, result: { recurringBuy: rb } };
  });

  registerLensAction("crypto", "recurring-buys-run-due", async (ctx, _a, _p = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const today = dayCr();
    const due = listCr(s.recurringBuys, userId).filter(rb => rb.active && rb.nextRunAt <= today);
    if (due.length === 0) return { ok: true, result: { ran: 0, lotsCreated: [] } };
    const symbols = Array.from(new Set(due.map(rb => rb.symbol)));
    const prices = await fetchLivePrices(symbols);
    const lotsCreated = [];
    const seq = ensureSeqCr(s, userId);
    for (const rb of due) {
      const price = prices[rb.symbol];
      if (!price || price <= 0) continue; // skip if price unavailable — never invent
      const qty = rb.amountUsd / price;
      const lot = {
        id: uidCr('lot'),
        number: `H-${String(seq.lot).padStart(5, '0')}`,
        symbol: rb.symbol,
        ticker: rb.ticker,
        chain: rb.chain,
        qty,
        qtyRemaining: qty,
        costBasisUsd: rb.amountUsd,
        unitCostUsd: price,
        acquiredAt: today,
        source: `dca:${rb.id}`,
      };
      seq.lot++;
      listCr(s.holdings, userId).push(lot);
      // Tx record
      const tx = {
        id: uidCr('tx'),
        number: `T-${String(seq.tx).padStart(6, '0')}`,
        kind: 'buy',
        symbol: rb.symbol, ticker: rb.ticker, chain: rb.chain,
        qty, priceUsd: price, totalUsd: rb.amountUsd,
        at: today, lotId: lot.id, source: `dca:${rb.id}`,
      };
      seq.tx++;
      listCr(s.transactions, userId).push(tx);
      rb.lastRunAt = today;
      rb.runCount += 1;
      const days = rb.cadence === 'daily' ? 1 : rb.cadence === 'weekly' ? 7 : rb.cadence === 'biweekly' ? 14 : 30;
      rb.nextRunAt = new Date(new Date(today).getTime() + days * 86_400_000).toISOString().slice(0, 10);
      lotsCreated.push({ lotId: lot.id, symbol: rb.symbol, qty, priceUsd: price });
    }
    saveCrypto();
    return { ok: true, result: { ran: lotsCreated.length, lotsCreated } };
  });

  // ── Staking positions ────────────────────────────────────────

  registerLensAction("crypto", "staking-positions-list", (ctx, _a, _p = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { positions: listCr(s.stakingPositions, aidCr(ctx)) } };
  });

  registerLensAction("crypto", "staking-stake", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const symbol = String(params.symbol || '').toLowerCase();
    const qty = Number(params.qty);
    const validator = String(params.validator || '').trim();
    const aprPct = Number(params.aprPct);
    if (!symbol || !Number.isFinite(qty) || qty <= 0) return { ok: false, error: "symbol + positive qty required" };
    const seq = ensureSeqCr(s, userId);
    const pos = {
      id: uidCr('st'),
      number: `S-${String(seq.st).padStart(4, '0')}`,
      symbol,
      ticker: String(params.ticker || symbol).toUpperCase(),
      chain: CHAIN_OPTIONS.includes(params.chain) ? params.chain : (symbol === 'solana' ? 'solana' : 'ethereum'),
      qty,
      validator,
      aprPct: Number.isFinite(aprPct) ? aprPct : null,
      stakedAt: String(params.stakedAt || dayCr()),
      unstakedAt: null,
      cumulativeRewardsUsd: 0,
      active: true,
    };
    seq.st++;
    listCr(s.stakingPositions, userId).push(pos);
    // Mirror as a tx
    const tx = {
      id: uidCr('tx'),
      number: `T-${String(seq.tx).padStart(6, '0')}`,
      kind: 'stake',
      symbol, ticker: pos.ticker, chain: pos.chain,
      qty, priceUsd: 0, totalUsd: 0,
      at: pos.stakedAt,
      validator,
      stakingPositionId: pos.id,
    };
    seq.tx++;
    listCr(s.transactions, userId).push(tx);
    saveCrypto();
    return { ok: true, result: { position: pos, transaction: tx } };
  });

  registerLensAction("crypto", "staking-unstake", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const pos = listCr(s.stakingPositions, userId).find(p => p.id === String(params.id || ""));
    if (!pos) return { ok: false, error: "position not found" };
    if (!pos.active) return { ok: false, error: "already unstaked" };
    pos.active = false;
    pos.unstakedAt = String(params.at || dayCr());
    const seq = ensureSeqCr(s, userId);
    const tx = {
      id: uidCr('tx'),
      number: `T-${String(seq.tx).padStart(6, '0')}`,
      kind: 'unstake',
      symbol: pos.symbol, ticker: pos.ticker, chain: pos.chain,
      qty: pos.qty, priceUsd: 0, totalUsd: 0,
      at: pos.unstakedAt,
      stakingPositionId: pos.id,
    };
    seq.tx++;
    listCr(s.transactions, userId).push(tx);
    saveCrypto();
    return { ok: true, result: { position: pos, transaction: tx } };
  });

  registerLensAction("crypto", "staking-rewards-record", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const positionId = String(params.positionId || "");
    const rewardQty = Number(params.rewardQty);
    const rewardUsd = Number(params.rewardUsd);
    if (!Number.isFinite(rewardQty) || rewardQty <= 0 || !Number.isFinite(rewardUsd) || rewardUsd < 0) return { ok: false, error: "positive rewardQty + non-negative rewardUsd required" };
    const pos = listCr(s.stakingPositions, userId).find(p => p.id === positionId);
    if (!pos) return { ok: false, error: "position not found" };
    pos.cumulativeRewardsUsd = (pos.cumulativeRewardsUsd || 0) + rewardUsd;
    const seq = ensureSeqCr(s, userId);
    const tx = {
      id: uidCr('tx'),
      number: `T-${String(seq.tx).padStart(6, '0')}`,
      kind: 'reward',
      symbol: pos.symbol, ticker: pos.ticker, chain: pos.chain,
      qty: rewardQty,
      priceUsd: Math.round((rewardUsd / rewardQty) * 10000) / 10000,
      totalUsd: rewardUsd,
      at: String(params.at || dayCr()),
      stakingPositionId: positionId,
    };
    seq.tx++;
    listCr(s.transactions, userId).push(tx);
    saveCrypto();
    return { ok: true, result: { position: pos, transaction: tx } };
  });

  // ── NFTs ──────────────────────────────────────────────────────

  registerLensAction("crypto", "nfts-list", (ctx, _a, _p = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { nfts: listCr(s.nfts, aidCr(ctx)) } };
  });

  registerLensAction("crypto", "nfts-add", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const seq = ensureSeqCr(s, userId);
    const nft = {
      id: uidCr('nft'),
      number: `N-${String(seq.nft).padStart(5, '0')}`,
      name,
      collection: String(params.collection || ""),
      chain: CHAIN_OPTIONS.includes(params.chain) ? params.chain : 'ethereum',
      contractAddress: String(params.contractAddress || ""),
      tokenId: String(params.tokenId || ""),
      imageUrl: String(params.imageUrl || ""),
      acquiredAt: String(params.acquiredAt || dayCr()),
      costBasisUsd: Number(params.costBasisUsd) || 0,
      floorPriceUsd: Number(params.floorPriceUsd) || null,
      notes: String(params.notes || ""),
    };
    seq.nft++;
    listCr(s.nfts, userId).push(nft);
    saveCrypto();
    return { ok: true, result: { nft } };
  });

  registerLensAction("crypto", "nfts-delete", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listCr(s.nfts, aidCr(ctx));
    const i = list.findIndex(n => n.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "NFT not found" };
    list.splice(i, 1);
    saveCrypto();
    return { ok: true, result: { deleted: true } };
  });

  // ── Watchlist ─────────────────────────────────────────────────

  registerLensAction("crypto", "watchlist-list", async (ctx, _a, _p = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const set = setCr(s.watchlist, userId);
    const symbols = Array.from(set);
    if (symbols.length === 0) return { ok: true, result: { watchlist: [] } };
    const prices = await fetchLivePrices(symbols);
    const watchlist = symbols.map(sym => ({
      symbol: sym,
      ticker: sym.toUpperCase(),
      priceUsd: prices[sym] ?? null,
    }));
    return { ok: true, result: { watchlist, priceSource: Object.keys(prices).length > 0 ? 'coingecko' : 'unavailable' } };
  });

  registerLensAction("crypto", "watchlist-add", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const symbol = String(params.symbol || "").toLowerCase().trim();
    if (!symbol) return { ok: false, error: "symbol required" };
    setCr(s.watchlist, aidCr(ctx)).add(symbol);
    saveCrypto();
    return { ok: true, result: { symbol, watching: true } };
  });

  registerLensAction("crypto", "watchlist-remove", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const symbol = String(params.symbol || "").toLowerCase().trim();
    setCr(s.watchlist, aidCr(ctx)).delete(symbol);
    saveCrypto();
    return { ok: true, result: { symbol, watching: false } };
  });

  // ── Tax report (calendar-year realized + staking income) ─────

  registerLensAction("crypto", "tax-report", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const year = Number(params.year) || new Date().getFullYear();
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const txs = listCr(s.transactions, userId).filter(t => (t.at || '') >= start && (t.at || '') <= end);
    const sells = txs.filter(t => t.kind === 'sell');
    const rewards = txs.filter(t => t.kind === 'reward');
    const realizedShortTerm = []; // <= 365 days
    const realizedLongTerm = []; // > 365 days
    let shortTermTotal = 0, longTermTotal = 0;
    for (const tx of sells) {
      for (const cl of tx.closedLots || []) {
        const lot = listCr(s.holdings, userId).find(l => l.id === cl.lotId);
        if (!lot) continue;
        const acq = new Date(lot.acquiredAt).getTime();
        const sold = new Date(tx.at).getTime();
        const heldDays = (sold - acq) / 86_400_000;
        const cost = cl.qty * cl.unitCostUsd;
        const proceeds = cl.qty * tx.priceUsd;
        const gain = proceeds - cost;
        const entry = {
          txId: tx.id, lotId: cl.lotId,
          symbol: tx.symbol, ticker: tx.ticker,
          qty: cl.qty,
          acquiredAt: lot.acquiredAt,
          soldAt: tx.at,
          heldDays: Math.round(heldDays),
          costUsd: Math.round(cost * 100) / 100,
          proceedsUsd: Math.round(proceeds * 100) / 100,
          gainUsd: Math.round(gain * 100) / 100,
        };
        if (heldDays > 365) { realizedLongTerm.push(entry); longTermTotal += gain; }
        else { realizedShortTerm.push(entry); shortTermTotal += gain; }
      }
    }
    const incomeFromStaking = rewards.reduce((sum, r) => sum + (r.totalUsd || 0), 0);
    return {
      ok: true,
      result: {
        year,
        realizedShortTerm,
        realizedLongTerm,
        shortTermGainUsd: Math.round(shortTermTotal * 100) / 100,
        longTermGainUsd: Math.round(longTermTotal * 100) / 100,
        totalRealizedUsd: Math.round((shortTermTotal + longTermTotal) * 100) / 100,
        stakingIncomeUsd: Math.round(incomeFromStaking * 100) / 100,
        stakingRewardEvents: rewards.length,
        form: '1099-DA + 1099-MISC (US reporting)',
      },
    };
  });

  // ── AI portfolio insight (natural-language summary) ──────────

  registerLensAction("crypto", "ai-portfolio-insight", async (ctx, _a, _p = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const lots = listCr(s.holdings, userId).filter(l => l.qtyRemaining > 0);
    if (lots.length === 0) return { ok: true, result: { insight: "(no holdings yet)", source: 'deterministic' } };
    const symbols = Array.from(new Set(lots.map(l => l.symbol)));
    const prices = await fetchLivePrices(symbols);
    const bySym = new Map();
    for (const l of lots) {
      const cur = bySym.get(l.symbol) || { symbol: l.symbol, ticker: l.ticker, qty: 0, cost: 0 };
      cur.qty += l.qtyRemaining;
      cur.cost += l.unitCostUsd * l.qtyRemaining;
      bySym.set(l.symbol, cur);
    }
    const rows = Array.from(bySym.values()).map(r => {
      const price = prices[r.symbol] || 0;
      const value = price * r.qty;
      const pnl = value - r.cost;
      const pnlPct = r.cost > 0 ? (pnl / r.cost) * 100 : 0;
      return { ...r, price, value, pnl, pnlPct };
    });
    rows.sort((a, b) => b.value - a.value);
    const totalValue = rows.reduce((s, r) => s + r.value, 0);
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const top = rows[0];
    const concentration = totalValue > 0 ? (top.value / totalValue) * 100 : 0;
    function deterministic() {
      const lines = [
        `Portfolio: $${totalValue.toFixed(2)} across ${rows.length} asset(s) on cost basis $${totalCost.toFixed(2)} (${totalCost > 0 ? (((totalValue - totalCost) / totalCost) * 100).toFixed(1) : '0'}% unrealized).`,
        `Top position: ${top.ticker} (${concentration.toFixed(0)}% of value), ${top.pnlPct >= 0 ? '+' : ''}${top.pnlPct.toFixed(1)}% PnL.`,
      ];
      if (concentration > 60) lines.push(`Heads up: >60% concentrated in ${top.ticker} — consider diversification.`);
      const losers = rows.filter(r => r.pnlPct < -20);
      if (losers.length > 0) lines.push(`${losers.length} position(s) down >20% — review thesis or tax-loss harvest candidates.`);
      return lines.join(' ');
    }
    const brain = ctx?.llm?.chat;
    if (typeof brain !== 'function') return { ok: true, result: { insight: deterministic(), source: 'deterministic', stats: { totalValueUsd: totalValue, totalCostUsd: totalCost, concentrationPct: concentration } } };
    try {
      const context = rows.slice(0, 8).map(r => `${r.ticker}: ${r.qty} @ $${(r.cost / Math.max(1, r.qty)).toFixed(2)} avg cost, now $${r.price.toFixed(2)} (${r.pnlPct >= 0 ? '+' : ''}${r.pnlPct.toFixed(1)}%)`).join('\n');
      const r = await brain({
        messages: [
          { role: 'system', content: "You are a crypto portfolio analyst. Write 2-3 short sentences. Highlight concentration risk, biggest winner/loser, and one factual observation. NOT financial advice. Use only the facts provided." },
          { role: 'user', content: `Portfolio total value: $${totalValue.toFixed(2)} / cost: $${totalCost.toFixed(2)}\n\n${context}` },
        ],
        temperature: 0.2, maxTokens: 600,
      });
      const text = String(r?.content || r?.text || '').trim() || deterministic();
      return { ok: true, result: { insight: text, source: 'brain', stats: { totalValueUsd: totalValue, totalCostUsd: totalCost, concentrationPct: concentration } } };
    } catch (_e) {
      return { ok: true, result: { insight: deterministic(), source: 'deterministic_after_brain_error', stats: { totalValueUsd: totalValue, totalCostUsd: totalCost, concentrationPct: concentration } } };
    }
  });

  // ── Wallets / accounts (Coinbase + MetaMask multi-account) ────

  const WALLET_KINDS = ['hot', 'hardware', 'exchange', 'watch'];

  registerLensAction("crypto", "wallet-list", (ctx, _a, _p = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { wallets: listCr(s.wallets, aidCr(ctx)) } };
  });

  registerLensAction("crypto", "wallet-create", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "wallet name required" };
    const wallet = {
      id: uidCr('wal'), name: name.slice(0, 80),
      kind: WALLET_KINDS.includes(params.kind) ? params.kind : 'hot',
      address: String(params.address || '').trim().slice(0, 120) || null,
      createdAt: isoCr(),
    };
    listCr(s.wallets, aidCr(ctx)).push(wallet);
    saveCrypto();
    return { ok: true, result: { wallet } };
  });

  registerLensAction("crypto", "wallet-rename", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const wallet = listCr(s.wallets, aidCr(ctx)).find(w => w.id === params.id);
    if (!wallet) return { ok: false, error: "wallet not found" };
    if (params.name != null) wallet.name = String(params.name).trim().slice(0, 80) || wallet.name;
    if (params.kind != null && WALLET_KINDS.includes(params.kind)) wallet.kind = params.kind;
    saveCrypto();
    return { ok: true, result: { wallet } };
  });

  registerLensAction("crypto", "wallet-delete", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const arr = listCr(s.wallets, userId);
    const i = arr.findIndex(w => w.id === params.id);
    if (i < 0) return { ok: false, error: "wallet not found" };
    arr.splice(i, 1);
    // Holdings keep their now-dangling walletId; they fall back to "unassigned".
    saveCrypto();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Send (transfer crypto out — FIFO-debits holdings) ─────────

  // Shared FIFO debit: closes oldest lots first. Returns null if short.
  function cryFifoDebit(s, userId, symbol, qty) {
    const lots = listCr(s.holdings, userId)
      .filter(l => l.symbol === symbol && l.qtyRemaining > 0)
      .sort((a, b) => a.acquiredAt.localeCompare(b.acquiredAt));
    const avail = lots.reduce((sum, l) => sum + l.qtyRemaining, 0);
    if (qty > avail + 1e-9) return null;
    let remaining = qty, costBasis = 0;
    const closedLots = [];
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.qtyRemaining, remaining);
      costBasis += take * lot.unitCostUsd;
      lot.qtyRemaining = Math.max(0, lot.qtyRemaining - take);
      closedLots.push({ lotId: lot.id, qty: take, unitCostUsd: lot.unitCostUsd });
      remaining -= take;
    }
    return { costBasis: Math.round(costBasis * 100) / 100, closedLots, ticker: lots[0]?.ticker, chain: lots[0]?.chain };
  }

  registerLensAction("crypto", "send", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const symbol = String(params.symbol || "").trim().toLowerCase();
    const qty = Number(params.qty);
    const toAddress = String(params.toAddress || "").trim();
    if (!symbol || !Number.isFinite(qty) || qty <= 0) return { ok: false, error: "symbol + positive qty required" };
    if (!toAddress) return { ok: false, error: "destination address required" };
    const networkFeeUsd = Math.max(0, Number(params.networkFeeUsd) || 0);
    const debit = cryFifoDebit(s, userId, symbol, qty);
    if (!debit) return { ok: false, error: `insufficient ${symbol.toUpperCase()} balance` };
    const seq = ensureSeqCr(s, userId);
    const tx = {
      id: uidCr('tx'),
      number: `T-${String(seq.tx).padStart(6, '0')}`,
      kind: 'send',
      symbol, ticker: debit.ticker || symbol.toUpperCase(),
      chain: debit.chain || 'ethereum',
      qty,
      priceUsd: null,
      totalUsd: 0,
      costBasisUsd: debit.costBasis,
      networkFeeUsd,
      toAddress,
      at: String(params.at || dayCr()),
      closedLots: debit.closedLots,
      notes: String(params.notes || ''),
    };
    seq.tx++;
    listCr(s.transactions, userId).push(tx);
    saveCrypto();
    return { ok: true, result: { transaction: tx } };
  });

  // ── Limit orders (Coinbase Advanced Trade) ────────────────────

  registerLensAction("crypto", "order-create", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const symbol = String(params.symbol || "").trim().toLowerCase();
    const side = params.side === 'sell' ? 'sell' : 'buy';
    const qty = Number(params.qty);
    const limitPriceUsd = Number(params.limitPriceUsd);
    if (!symbol || !Number.isFinite(qty) || qty <= 0) return { ok: false, error: "symbol + positive qty required" };
    if (!Number.isFinite(limitPriceUsd) || limitPriceUsd <= 0) return { ok: false, error: "positive limitPriceUsd required" };
    const order = {
      id: uidCr('ord'),
      symbol,
      ticker: String(params.ticker || symbol).toUpperCase(),
      chain: CHAIN_OPTIONS.includes(params.chain) ? params.chain : 'ethereum',
      side, qty, limitPriceUsd,
      status: 'open',
      createdAt: isoCr(),
      filledAt: null,
      note: String(params.note || ''),
    };
    listCr(s.orders, userId).push(order);
    saveCrypto();
    return { ok: true, result: { order } };
  });

  registerLensAction("crypto", "order-list", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const status = ['open', 'filled', 'cancelled'].includes(params.status) ? params.status : null;
    let list = listCr(s.orders, aidCr(ctx));
    if (status) list = list.filter(o => o.status === status);
    return { ok: true, result: { orders: list.slice().reverse(), total: list.length } };
  });

  registerLensAction("crypto", "order-cancel", (ctx, _a, params = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const order = listCr(s.orders, aidCr(ctx)).find(o => o.id === params.id);
    if (!order) return { ok: false, error: "order not found" };
    if (order.status !== 'open') return { ok: false, error: `order is already ${order.status}` };
    order.status = 'cancelled';
    order.cancelledAt = isoCr();
    saveCrypto();
    return { ok: true, result: { order } };
  });

  // Fill engine — fills open limit orders when the live price crosses.
  registerLensAction("crypto", "orders-check", async (ctx, _a, _p = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const open = listCr(s.orders, userId).filter(o => o.status === 'open');
    if (open.length === 0) return { ok: true, result: { filled: [], stillOpen: 0, priceSource: 'n/a' } };
    const prices = await fetchLivePrices(Array.from(new Set(open.map(o => o.symbol))));
    if (Object.keys(prices).length === 0) {
      return { ok: true, result: { filled: [], stillOpen: open.length, priceSource: 'unavailable' } };
    }
    const seq = ensureSeqCr(s, userId);
    const filled = [];
    for (const order of open) {
      const price = prices[order.symbol];
      if (typeof price !== 'number') continue;
      const crosses = order.side === 'buy' ? price <= order.limitPriceUsd : price >= order.limitPriceUsd;
      if (!crosses) continue;
      if (order.side === 'buy') {
        const cost = Math.round(order.qty * order.limitPriceUsd * 100) / 100;
        const lot = {
          id: uidCr('lot'), number: `H-${String(seq.lot).padStart(5, '0')}`,
          symbol: order.symbol, ticker: order.ticker, chain: order.chain,
          qty: order.qty, qtyRemaining: order.qty,
          costBasisUsd: cost, unitCostUsd: order.limitPriceUsd,
          acquiredAt: dayCr(), source: 'limit-order', notes: `Filled order ${order.id}`,
        };
        seq.lot++;
        listCr(s.holdings, userId).push(lot);
        const tx = {
          id: uidCr('tx'), number: `T-${String(seq.tx).padStart(6, '0')}`,
          kind: 'buy', symbol: order.symbol, ticker: order.ticker, chain: order.chain,
          qty: order.qty, priceUsd: order.limitPriceUsd, totalUsd: cost,
          at: dayCr(), lotId: lot.id, notes: `Limit order fill`,
        };
        seq.tx++;
        listCr(s.transactions, userId).push(tx);
      } else {
        const debit = cryFifoDebit(s, userId, order.symbol, order.qty);
        if (!debit) { order.note = 'fill skipped — insufficient balance'; continue; }
        const proceeds = Math.round(order.qty * order.limitPriceUsd * 100) / 100;
        const tx = {
          id: uidCr('tx'), number: `T-${String(seq.tx).padStart(6, '0')}`,
          kind: 'sell', symbol: order.symbol, ticker: order.ticker, chain: order.chain,
          qty: order.qty, priceUsd: order.limitPriceUsd, totalUsd: proceeds,
          costBasisUsd: debit.costBasis,
          realizedPnlUsd: Math.round((proceeds - debit.costBasis) * 100) / 100,
          at: dayCr(), closedLots: debit.closedLots, notes: `Limit order fill`,
        };
        seq.tx++;
        listCr(s.transactions, userId).push(tx);
      }
      order.status = 'filled';
      order.filledAt = isoCr();
      order.fillPriceUsd = price;
      filled.push(order);
    }
    saveCrypto();
    return {
      ok: true,
      result: {
        filled,
        filledCount: filled.length,
        stillOpen: open.length - filled.length,
        priceSource: 'coingecko',
      },
    };
  });

  // ── Portfolio value snapshots / performance ───────────────────

  registerLensAction("crypto", "portfolio-snapshot", async (ctx, _a, _p = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const lots = listCr(s.holdings, userId).filter(l => l.qtyRemaining > 0);
    const prices = await fetchLivePrices(Array.from(new Set(lots.map(l => l.symbol))));
    let totalValue = 0, totalCost = 0;
    for (const l of lots) {
      totalValue += (prices[l.symbol] || 0) * l.qtyRemaining;
      totalCost += l.unitCostUsd * l.qtyRemaining;
    }
    const snap = {
      date: dayCr(),
      totalValueUsd: Math.round(totalValue * 100) / 100,
      totalCostUsd: Math.round(totalCost * 100) / 100,
      capturedAt: isoCr(),
    };
    const series = listCr(s.valueSnapshots, userId);
    const sameDay = series.findIndex(x => x.date === snap.date);
    if (sameDay >= 0) series[sameDay] = snap; else series.push(snap);
    saveCrypto();
    return { ok: true, result: { snapshot: snap, priceSource: Object.keys(prices).length > 0 ? 'coingecko' : 'unavailable' } };
  });

  registerLensAction("crypto", "portfolio-history", (ctx, _a, _p = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const series = listCr(s.valueSnapshots, aidCr(ctx)).slice().sort((a, b) => a.date.localeCompare(b.date));
    if (series.length < 2) {
      return { ok: true, result: { series, points: series.length, message: series.length ? 'Capture more snapshots to see performance.' : 'No snapshots yet.' } };
    }
    const first = series[0], last = series[series.length - 1];
    let bestDay = null, worstDay = null;
    for (let i = 1; i < series.length; i++) {
      const delta = series[i].totalValueUsd - series[i - 1].totalValueUsd;
      if (!bestDay || delta > bestDay.delta) bestDay = { date: series[i].date, delta: Math.round(delta * 100) / 100 };
      if (!worstDay || delta < worstDay.delta) worstDay = { date: series[i].date, delta: Math.round(delta * 100) / 100 };
    }
    const change = last.totalValueUsd - first.totalValueUsd;
    return {
      ok: true,
      result: {
        series, points: series.length,
        startValueUsd: first.totalValueUsd, endValueUsd: last.totalValueUsd,
        changeUsd: Math.round(change * 100) / 100,
        changePct: first.totalValueUsd > 0 ? Math.round((change / first.totalValueUsd) * 10000) / 100 : 0,
        bestDay, worstDay,
      },
    };
  });

  // ── Market overview (CoinGecko trending / gainers / losers) ───

  registerLensAction("crypto", "market-overview", async (_ctx, _a, _p = {}) => {
    try {
      const [trendingRaw, markets, globalRaw] = await Promise.all([
        safeFetchJson('https://api.coingecko.com/api/v3/search/trending').catch(() => null),
        fetchAndShape('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h').catch(() => []),
        safeFetchJson('https://api.coingecko.com/api/v3/global').catch(() => null),
      ]);
      if (markets.length === 0 && !Array.isArray(trendingRaw?.coins)) {
        return { ok: false, error: "coingecko unreachable: market data unavailable" };
      }
      const trending = Array.isArray(trendingRaw?.coins)
        ? trendingRaw.coins.slice(0, 10).map(c => ({
          id: c.item?.id, symbol: (c.item?.symbol || '').toUpperCase(),
          name: c.item?.name, rank: c.item?.market_cap_rank || null, iconUrl: c.item?.small || null,
        }))
        : [];
      const withChange = markets.filter(m => Number.isFinite(m.change24h));
      const gainers = [...withChange].sort((a, b) => b.change24h - a.change24h).slice(0, 10);
      const losers = [...withChange].sort((a, b) => a.change24h - b.change24h).slice(0, 10);
      const g = globalRaw?.data || {};
      return {
        ok: true,
        result: {
          trending, gainers, losers,
          global: {
            totalMarketCapUsd: Number(g.total_market_cap?.usd) || null,
            totalVolume24hUsd: Number(g.total_volume?.usd) || null,
            marketCapChange24hPct: Number(g.market_cap_change_percentage_24h_usd) || null,
            btcDominancePct: Number(g.market_cap_percentage?.btc) || null,
            ethDominancePct: Number(g.market_cap_percentage?.eth) || null,
            activeCoins: Number(g.active_cryptocurrencies) || null,
          },
          source: 'coingecko',
        },
      };
    } catch (e) {
      return { ok: false, error: `coingecko unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Dashboard summary ────────────────────────────────────────

  registerLensAction("crypto", "dashboard-summary", async (ctx, _a, _p = {}) => {
    const s = getCryptoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCr(ctx);
    const lots = listCr(s.holdings, userId).filter(l => l.qtyRemaining > 0);
    const symbols = Array.from(new Set(lots.map(l => l.symbol)));
    const prices = await fetchLivePrices(symbols);
    let totalValue = 0, totalCost = 0;
    for (const l of lots) {
      totalValue += (prices[l.symbol] || 0) * l.qtyRemaining;
      totalCost += l.unitCostUsd * l.qtyRemaining;
    }
    const recurring = listCr(s.recurringBuys, userId).filter(rb => rb.active);
    const staked = listCr(s.stakingPositions, userId).filter(p => p.active);
    const watchSize = setCr(s.watchlist, userId).size;
    const nftCount = listCr(s.nfts, userId).length;
    const alerts = (s.priceAlerts || []).filter(a => a.userId === userId).length;
    return {
      ok: true,
      result: {
        totalValueUsd: Math.round(totalValue * 100) / 100,
        unrealizedPnlUsd: Math.round((totalValue - totalCost) * 100) / 100,
        unrealizedPnlPct: totalCost > 0 ? Math.round(((totalValue - totalCost) / totalCost) * 10000) / 100 : 0,
        symbolCount: symbols.length,
        lotCount: lots.length,
        activeRecurringBuys: recurring.length,
        activeStakingPositions: staked.length,
        watchlistSize: watchSize,
        nftCount,
        priceAlertCount: alerts,
        priceSource: Object.keys(prices).length > 0 ? 'coingecko' : 'unavailable',
      },
    };
  });

  registerLensAction("crypto", "feed", async (ctx, _a, _params = {}) => {
    const STATE = globalThis._concordSTATE; if (!STATE) return { ok: false, error: "STATE unavailable" };
    if (!STATE.cryptoLens) STATE.cryptoLens = {};
    if (!(STATE.cryptoLens.feedSeen instanceof Set)) STATE.cryptoLens.feedSeen = new Set();
    const seen = STATE.cryptoLens.feedSeen;
    try {
      const r = await fetch("https://api.coingecko.com/api/v3/search/trending");
      if (!r.ok) return { ok: false, error: `coingecko ${r.status}` };
      const data = await r.json();
      const coins = (data.coins || []).slice(0, 15);
      const day = new Date().toISOString().slice(0, 10);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const c of coins) {
        const it = c.item || {};
        const key = `${it.id}-${day}`;
        if (!it.id || seen.has(key)) { skipped++; continue; }
        const title = `Trending: ${it.name} (${String(it.symbol || "").toUpperCase()})`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${it.name} (${String(it.symbol || "").toUpperCase()})\nMarket-cap rank: ${it.market_cap_rank || "?"}\nTrending on CoinGecko, ${day}.`,
          tags: ["crypto", "feed", "trending", "coingecko"],
          source: "coingecko-trending-feed",
          meta: { coinId: it.id, name: it.name, symbol: it.symbol, rank: it.market_cap_rank },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); seen.add(key); }
      }
      if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* */ } }
      return { ok: true, result: { ingested, skipped, source: "coingecko-trending", dtuIds } };
    } catch (e) { return { ok: false, error: `coingecko unreachable: ${e instanceof Error ? e.message : String(e)}` }; }
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

function round(n, decimals) {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}
