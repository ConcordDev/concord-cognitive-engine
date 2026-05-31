// Engine N6 — probability/stochastic (risk = P(exit the viability set)). Pins
// Bayesian updating, expected value, Markov step + stationary distribution, and
// Monte-Carlo exit probability (the stochastic tie to the viability spine).
//
// Run: node --test tests/probability-stochastic.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bayesUpdate, expectedValue, markovStep, stationaryDistribution, monteCarloExit } from "../lib/probability/stochastic.js";

// deterministic LCG for the Monte-Carlo tests
function lcg(seed) { let s = seed >>> 0; return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; }; }
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe("bayes + expectation", () => {
  it("posterior shifts toward the high-likelihood hypothesis and sums to 1", () => {
    const post = bayesUpdate({ rain: 0.5, dry: 0.5 }, { rain: 0.9, dry: 0.1 });
    assert.ok(post.rain > 0.5 && post.rain < 1);
    assert.ok(close(post.rain + post.dry, 1));
    assert.ok(post.rain > post.dry);
  });
  it("expectedValue", () => {
    assert.equal(expectedValue([10, 0], [0.3, 0.7]), 3);
  });
});

describe("markov", () => {
  it("a step redistributes mass per the transition matrix", () => {
    // 2-state: from 0 → stays .9 / goes .1; from 1 → .5/.5
    const P = [[0.9, 0.1], [0.5, 0.5]];
    const d = markovStep([1, 0], P);
    assert.ok(close(d[0], 0.9) && close(d[1], 0.1));
  });
  it("stationary distribution of a known chain", () => {
    const P = [[0.9, 0.1], [0.5, 0.5]];
    const pi = stationaryDistribution(P);
    // analytic stationary: pi0/pi1 = 0.5/0.1 = 5 → pi = [5/6, 1/6]
    assert.ok(close(pi[0], 5 / 6, 1e-3));
    assert.ok(close(pi[1], 1 / 6, 1e-3));
  });
});

describe("monte-carlo exit (risk = P(exit the set))", () => {
  it("0 exit when volatility 0 and value inside the band", () => {
    assert.equal(monteCarloExit(5, { drift: 0, volatility: 0, lo: 0, hi: 10 }), 0);
  });
  it("1 when already outside", () => {
    assert.equal(monteCarloExit(15, { volatility: 0, lo: 0, hi: 10 }), 1);
  });
  it("higher volatility → higher exit probability", () => {
    const low = monteCarloExit(5, { drift: 0, volatility: 0.5, lo: 0, hi: 10, horizon: 20, samples: 800, rng: lcg(42) });
    const high = monteCarloExit(5, { drift: 0, volatility: 3, lo: 0, hi: 10, horizon: 20, samples: 800, rng: lcg(42) });
    assert.ok(high > low);
    assert.ok(low >= 0 && high <= 1);
  });
  it("drift toward a boundary raises exit risk", () => {
    const noDrift = monteCarloExit(5, { drift: 0, volatility: 0.5, lo: 0, hi: 10, samples: 800, rng: lcg(7) });
    const drifting = monteCarloExit(5, { drift: 0.4, volatility: 0.5, lo: 0, hi: 10, samples: 800, rng: lcg(7) });
    assert.ok(drifting > noDrift);
  });
});
