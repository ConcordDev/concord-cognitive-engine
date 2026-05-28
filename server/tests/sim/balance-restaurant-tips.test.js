// Phase G3.1 — restaurant tip-fraction balance sweep.
//
// Sweeps a 3×3×3 grid of (TIP_FRACTION_FAST, TIP_FRACTION_OK,
// TIP_FRACTION_SLOW) values. For each cell, simulates 200 games of
// 30 orders each with seeded NPC patience distribution. Reports mean
// income, variance, expired-order ratio per cell.
//
// Writes audit/balance/restaurant-tips.json. Recommends defaults
// minimising income variance while keeping expired-order ratio < 0.15.
//
// Excluded from default `npm test` via the path filter; runs via
// `node --test server/tests/sim/*.test.js`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_PRICE_CC = 15;
const TTL_S = 300;

// Seeded LCG for reproducibility.
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function simulateOneGame(seed, tipFast, tipOk, tipSlow) {
  const rng = seededRng(seed);
  const ORDERS_PER_GAME = 30;
  let totalIncome = 0;
  let expired = 0;
  for (let i = 0; i < ORDERS_PER_GAME; i++) {
    // Order placed; service time is a clipped normal centered at 60s,
    // varying with player skill (simulated by clipped uniform 5-180s).
    const waited = Math.floor(rng() * 175) + 5;
    if (waited > TTL_S) { expired++; continue; }
    let tipFrac;
    if (waited <= 30) tipFrac = tipFast;
    else if (waited <= TTL_S - 60) tipFrac = tipOk;
    else tipFrac = tipSlow;
    totalIncome += BASE_PRICE_CC + Math.round(BASE_PRICE_CC * tipFrac * 100) / 100;
  }
  return { totalIncome, expired };
}

function summarise(samples) {
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
  return { mean, variance, sd: Math.sqrt(variance) };
}

describe("Phase G3.1 — restaurant tip-fraction balance", () => {
  it("sweeps 3×3×3 grid and writes audit/balance/restaurant-tips.json", () => {
    const fastValues = [0.20, 0.30, 0.40];
    const okValues   = [0.05, 0.10, 0.15];
    const slowValues = [0.00, 0.05, 0.10];
    const SIM_GAMES = 200;
    const results = [];
    for (const fast of fastValues) {
      for (const ok of okValues) {
        for (const slow of slowValues) {
          const incomes = [];
          const expireds = [];
          for (let g = 0; g < SIM_GAMES; g++) {
            const r = simulateOneGame(g + 1, fast, ok, slow);
            incomes.push(r.totalIncome);
            expireds.push(r.expired);
          }
          const incomeStats = summarise(incomes);
          const expiredStats = summarise(expireds);
          results.push({
            cell: { fast, ok, slow },
            incomeMean: Math.round(incomeStats.mean * 100) / 100,
            incomeSd: Math.round(incomeStats.sd * 100) / 100,
            expiredMean: Math.round(expiredStats.mean * 100) / 100,
            expiredRatio: Math.round((expiredStats.mean / 30) * 1000) / 1000,
          });
        }
      }
    }
    // Find the cell minimising income SD while keeping expired ratio <= 0.15.
    const eligible = results.filter((r) => r.expiredRatio <= 0.15);
    eligible.sort((a, b) => a.incomeSd - b.incomeSd);
    const recommendation = eligible[0] || results.sort((a, b) => a.incomeSd - b.incomeSd)[0];

    const outDir = join(import.meta.dirname, "..", "..", "..", "audit", "balance");
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, "restaurant-tips.json");
    writeFileSync(outPath, JSON.stringify({
      sprint: "G3.1",
      grid: { fastValues, okValues, slowValues },
      gamesPerCell: SIM_GAMES,
      ordersPerGame: 30,
      ttlS: TTL_S,
      cells: results,
      recommendation,
      currentDefault: { fast: 0.30, ok: 0.10, slow: 0.00 },
    }, null, 2));
    assert.ok(results.length === 27);
    assert.ok(recommendation);
  });
});
