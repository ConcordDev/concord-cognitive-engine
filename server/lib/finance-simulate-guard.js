// Honest gate for finance.simulate. A missing price history used to return
// mean/worst/best of 100, which the client rendered as a simulation.

/** Optional count. Omitted uses fallback. A present non-finite value is refused. */
export function pickCount(value, fallback, min, max) {
  if (value == null || value === "") return { n: fallback };
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return { error: true };
  return { n: Math.min(max, Math.max(min, Math.trunc(n))) };
}

/** No distribution exists. Do not invent a price. */
export function unavailableTradeSimulation(currentPrice) {
  const price = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : null;
  return {
    ok: false,
    error: "unavailable",
    reason: "insufficient_trade_history",
    field: "trades",
    message: "Need at least two positive trade prices. No price was invented.",
    currentPrice: price,
  };
}
