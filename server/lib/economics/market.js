// server/lib/economics/market.js
//
// Engine N9 — economics = price as a market FIXED POINT. The codebase had
// regional scarcity + a marketplace but no principled price formation. A price
// is the fixed point where supply meets demand; an auction is a double-auction
// clearing; scarcity is a multiplier on that. Pure, deterministic, zero-dep —
// the math the regional-scarcity pricing, world-economy, and civic-bond
// secondary market read.

/**
 * Linear supply/demand equilibrium. Supply Qs = sA + sB·P (sB>0), demand
 * Qd = dA − dB·P (dB>0). The market clears where Qs = Qd:
 *   P* = (dA − sA) / (sB + dB),  Q* = sA + sB·P*.
 * Returns null if the equilibrium price or quantity is negative (no market).
 */
export function linearEquilibrium({ supply, demand } = {}) {
  const sA = Number(supply?.a) || 0, sB = Number(supply?.b) || 0;
  const dA = Number(demand?.a) || 0, dB = Number(demand?.b) || 0;
  if (sB + dB <= 0) return null;
  const price = (dA - sA) / (sB + dB);
  const quantity = sA + sB * price;
  if (price < 0 || quantity < 0) return null;
  return { price, quantity };
}

/**
 * Uniform-price double-auction clearing — the real marketplace/auction
 * primitive. bids = [{price, qty}] (max willing to pay), asks = [{price, qty}]
 * (min willing to accept). Matches highest bids against lowest asks while
 * bid ≥ ask; the uniform clearing price is the midpoint of the marginal
 * matched pair. Returns { clearingPrice, volume } (volume 0 = no trade).
 */
export function clearingPrice(bids = [], asks = []) {
  const B = bids.map((b) => ({ price: Number(b.price), qty: Math.max(0, Number(b.qty) || 0) }))
    .filter((b) => b.qty > 0).sort((a, b) => b.price - a.price);
  const A = asks.map((a) => ({ price: Number(a.price), qty: Math.max(0, Number(a.qty) || 0) }))
    .filter((a) => a.qty > 0).sort((a, b) => a.price - b.price);
  let i = 0, j = 0, volume = 0, lastBid = null, lastAsk = null;
  while (i < B.length && j < A.length && B[i].price >= A[j].price) {
    const m = Math.min(B[i].qty, A[j].qty);
    volume += m;
    lastBid = B[i].price; lastAsk = A[j].price;
    B[i].qty -= m; A[j].qty -= m;
    if (B[i].qty === 0) i++;
    if (A[j].qty === 0) j++;
  }
  if (volume === 0) return { clearingPrice: null, volume: 0 };
  return { clearingPrice: (lastBid + lastAsk) / 2, volume };
}

/**
 * Price elasticity of demand: (%ΔQ / %ΔP). Magnitude > 1 = elastic (luxury),
 * < 1 = inelastic (necessity). Point elasticity from a linear demand
 * Qd = dA − dB·P at price P: ε = −dB·P/Q.
 */
export function priceElasticityOfDemand(demand, P) {
  const dA = Number(demand?.a) || 0, dB = Number(demand?.b) || 0;
  const Q = dA - dB * P;
  if (Q <= 0) return null;
  return -(dB * P) / Q;
}

/**
 * Scarcity → price multiplier (formalizes the existing npc-economy
 * `priceModulator = 1 + s·0.5`). scarcity ∈ [−0.5, 1.0] → multiplier
 * [0.75, 1.5]. Glut (negative) discounts; shortage (positive) marks up.
 */
export function scarcityPriceMultiplier(scarcity, sensitivity = 0.5) {
  const s = Math.max(-0.5, Math.min(1.0, Number(scarcity) || 0));
  return 1 + s * sensitivity;
}

/** A market "fails to clear" when no equilibrium exists or the clearing volume is 0. */
export function marketClears({ supply, demand } = {}) {
  return linearEquilibrium({ supply, demand }) !== null;
}
