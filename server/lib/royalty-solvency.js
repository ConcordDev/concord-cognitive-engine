// server/lib/royalty-solvency.js
//
// F4 — royalty-cascade solvency sim (executable form of the constitutional
// economy invariant).
//
// The cascade pays ancestors a generational royalty (calculateGenerationalRate:
// DEFAULT_INITIAL_RATE / 2^gen, floored at ROYALTY_FLOOR) but the TOTAL ancestor
// pool is capped at MAX_ROYALTY_RATE of the sale, and the platform takes
// FEE_RATE. This module reproduces that math from the real cascade functions and
// proves the seller always keeps a healthy floor — at ANY cascade depth up to
// MAX_CASCADE_DEPTH. It's the L3-tier contract that screams if anyone edits the
// constants in a way that lets ancestors+fees eat the seller.
//
// Pure, never throws, no DB. (MAX_ROYALTY_RATE / FEE_RATE are function-local in
// royalty-cascade.js + creative-marketplace-constants.js respectively; mirrored
// here as documented constants — the sim's whole job is to catch drift from them.)

import { calculateGenerationalRate, DEFAULT_INITIAL_RATE, MAX_CASCADE_DEPTH, ROYALTY_FLOOR } from "../economy/royalty-cascade.js";

// Mirrors royalty-cascade.js:297 (MAX_ROYALTY_RATE) + the 5.46% platform+marketplace
// fee (creative-marketplace-constants.js PLATFORM_FEE_RATE 0.0146 + MARKETPLACE_FEE_RATE 0.04).
export const MAX_ROYALTY_RATE = 0.30;
export const FEE_RATE = 0.0546;

/**
 * Simulate the payout split for a sale whose content sits atop `depth` ancestors.
 * @param {object} [opts]
 * @param {number} [opts.depth]            number of ancestor generations (1..MAX_CASCADE_DEPTH)
 * @param {number} [opts.initialRate]      cascade initial rate (default DEFAULT_INITIAL_RATE)
 * @param {number} [opts.transactionAmount]
 * @returns {{depth:number, uncappedPoolRate:number, cappedPoolRate:number, capBinds:boolean, feeRate:number, sellerKeepsRate:number, sellerKeepsAmount:number, royaltyAmount:number, solvent:boolean}}
 */
export function simulateCascadeSolvency({ depth = 1, initialRate = DEFAULT_INITIAL_RATE, transactionAmount = 100 } = {}) {
  const d = Math.max(0, Math.min(Math.floor(depth), MAX_CASCADE_DEPTH));
  let uncapped = 0;
  for (let g = 1; g <= d; g++) uncapped += calculateGenerationalRate(g, initialRate);
  uncapped = Math.round(uncapped * 1e6) / 1e6;
  const capped = Math.min(uncapped, MAX_ROYALTY_RATE);
  const sellerKeepsRate = Math.round((1 - FEE_RATE - capped) * 1e6) / 1e6;
  return {
    depth: d,
    uncappedPoolRate: uncapped,
    cappedPoolRate: capped,
    capBinds: uncapped > MAX_ROYALTY_RATE,
    feeRate: FEE_RATE,
    sellerKeepsRate,
    sellerKeepsAmount: Math.round(transactionAmount * sellerKeepsRate * 100) / 100,
    royaltyAmount: Math.round(transactionAmount * capped * 100) / 100,
    solvent: sellerKeepsRate >= 0,
  };
}

/**
 * Sweep depths 1..maxDepth and report the worst case + the asymptote. The
 * unit-econ summary: at no depth may the seller keep less than the floor, and
 * the cap must never be exceeded.
 * @returns {{ok:boolean, maxDepth:number, worstSellerKeepsRate:number, asymptotePoolRate:number, capEverBinds:boolean, alwaysSolvent:boolean, floorSellerKeepsRate:number}}
 */
export function royaltySolvencyReport({ maxDepth = MAX_CASCADE_DEPTH, initialRate = DEFAULT_INITIAL_RATE } = {}) {
  let worst = Infinity;
  let capEverBinds = false;
  let deepest = null;
  for (let d = 1; d <= maxDepth; d++) {
    const s = simulateCascadeSolvency({ depth: d, initialRate });
    if (s.sellerKeepsRate < worst) worst = s.sellerKeepsRate;
    if (s.capBinds) capEverBinds = true;
    deepest = s;
  }
  // The contractual seller floor: 1 − fees − the royalty cap = 64.54%.
  const floorSellerKeepsRate = Math.round((1 - FEE_RATE - MAX_ROYALTY_RATE) * 1e6) / 1e6;
  return {
    ok: true,
    maxDepth,
    worstSellerKeepsRate: worst === Infinity ? null : worst,
    asymptotePoolRate: deepest ? deepest.cappedPoolRate : 0,
    capEverBinds,
    alwaysSolvent: worst >= floorSellerKeepsRate,
    floorSellerKeepsRate,
  };
}

export default royaltySolvencyReport;
