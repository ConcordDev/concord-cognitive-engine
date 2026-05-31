// Engine N9 — economics (price as a market fixed point). Pins linear
// supply/demand equilibrium, double-auction clearing, demand elasticity, and
// the scarcity→price multiplier (the marketplace/scarcity pricing reads these).
//
// Run: node --test tests/economics-market.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  linearEquilibrium, clearingPrice, priceElasticityOfDemand, scarcityPriceMultiplier, marketClears,
} from "../lib/economics/market.js";

describe("linear equilibrium", () => {
  it("clears where supply meets demand", () => {
    // Qs = 2P, Qd = 100 − 3P → P* = 20, Q* = 40
    const eq = linearEquilibrium({ supply: { a: 0, b: 2 }, demand: { a: 100, b: 3 } });
    assert.equal(eq.price, 20);
    assert.equal(eq.quantity, 40);
  });

  it("returns null when no positive equilibrium exists", () => {
    // demand intercept below supply intercept → negative price
    assert.equal(linearEquilibrium({ supply: { a: 100, b: 1 }, demand: { a: 10, b: 1 } }), null);
    assert.equal(marketClears({ supply: { a: 100, b: 1 }, demand: { a: 10, b: 1 } }), false);
  });
});

describe("double-auction clearing", () => {
  it("matches high bids to low asks and prices at the marginal midpoint", () => {
    const r = clearingPrice(
      [{ price: 10, qty: 5 }, { price: 8, qty: 5 }],
      [{ price: 6, qty: 4 }, { price: 9, qty: 4 }],
    );
    // bid10×4 vs ask6, then bid10×1 vs ask9 (10≥9). bid8 vs ask9 → 8<9 stop. volume 5.
    assert.equal(r.volume, 5);
    assert.equal(r.clearingPrice, (10 + 9) / 2); // marginal matched pair
  });

  it("no trade when the best bid is below the best ask", () => {
    const r = clearingPrice([{ price: 5, qty: 10 }], [{ price: 9, qty: 10 }]);
    assert.equal(r.volume, 0);
    assert.equal(r.clearingPrice, null);
  });
});

describe("elasticity + scarcity", () => {
  it("point elasticity of a linear demand", () => {
    // Qd = 100 − 3P at P=20 → Q=40 → ε = −(3·20)/40 = −1.5 (elastic)
    assert.equal(priceElasticityOfDemand({ a: 100, b: 3 }, 20), -1.5);
  });

  it("scarcity multiplier: glut discounts, shortage marks up, clamped", () => {
    assert.equal(scarcityPriceMultiplier(0), 1);
    assert.equal(scarcityPriceMultiplier(1), 1.5);
    assert.equal(scarcityPriceMultiplier(-0.5), 0.75);
    assert.equal(scarcityPriceMultiplier(99), 1.5);   // clamped to s=1
    assert.equal(scarcityPriceMultiplier(-99), 0.75); // clamped to s=-0.5
  });
});
