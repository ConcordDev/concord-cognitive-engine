// F4 contract — royalty-cascade solvency. Pins the constitutional invariant as
// executable math: ancestors capped at 30%, seller keeps ≥ 64.54%, at any depth.

import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateCascadeSolvency, royaltySolvencyReport, MAX_ROYALTY_RATE, FEE_RATE } from "../lib/royalty-solvency.js";

test("a single direct ancestor (gen 1) takes 10.5%, seller keeps the rest", () => {
  const s = simulateCascadeSolvency({ depth: 1, transactionAmount: 100 });
  assert.equal(s.cappedPoolRate, 0.105); // 0.21 / 2^1
  assert.equal(s.capBinds, false);
  assert.equal(s.sellerKeepsRate, Math.round((1 - FEE_RATE - 0.105) * 1e6) / 1e6);
  assert.equal(s.solvent, true);
});

test("the ancestor pool never exceeds the 30% cap, even at max depth", () => {
  const deep = simulateCascadeSolvency({ depth: 50 });
  assert.ok(deep.cappedPoolRate <= MAX_ROYALTY_RATE, `pool ${deep.cappedPoolRate} exceeds cap`);
  // The geometric series 0.21·Σ2^-g converges to ~0.21 (+ floor tail) — well under 0.30,
  // so the cap should NOT bind under the default constants.
  assert.equal(deep.capBinds, false);
  assert.ok(deep.uncappedPoolRate < MAX_ROYALTY_RATE);
});

test("pool rate increases monotonically with depth then plateaus under the cap", () => {
  const d1 = simulateCascadeSolvency({ depth: 1 }).cappedPoolRate;
  const d5 = simulateCascadeSolvency({ depth: 5 }).cappedPoolRate;
  const d50 = simulateCascadeSolvency({ depth: 50 }).cappedPoolRate;
  assert.ok(d1 < d5 && d5 <= d50);
  assert.ok(d50 <= MAX_ROYALTY_RATE);
});

test("report proves always-solvent and the 64.54% seller floor", () => {
  const r = royaltySolvencyReport();
  assert.equal(r.ok, true);
  assert.equal(r.alwaysSolvent, true);
  assert.equal(r.floorSellerKeepsRate, Math.round((1 - FEE_RATE - MAX_ROYALTY_RATE) * 1e6) / 1e6);
  assert.equal(r.floorSellerKeepsRate, 0.6454);
  // worst observed seller-keeps must clear the contractual floor.
  assert.ok(r.worstSellerKeepsRate >= r.floorSellerKeepsRate);
});

test("solvency holds even if someone cranks the initial rate to a high value (cap saves the seller)", () => {
  // initialRate 1.0 would make the uncapped pool huge → the 30% cap must bind
  // and keep the seller at exactly the contractual floor (still solvent).
  const r = royaltySolvencyReport({ initialRate: 1.0 });
  assert.equal(r.capEverBinds, true);
  assert.equal(r.alwaysSolvent, true);
  assert.ok(r.worstSellerKeepsRate >= 0.6454 - 1e-6);
});

test("depth 0 (no ancestors) → seller keeps 1 − fees", () => {
  const s = simulateCascadeSolvency({ depth: 0 });
  assert.equal(s.cappedPoolRate, 0);
  assert.equal(s.sellerKeepsRate, Math.round((1 - FEE_RATE) * 1e6) / 1e6);
});
