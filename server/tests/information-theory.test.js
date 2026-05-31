// Engine N2 — information theory (the substrate's measure). Pins Shannon
// entropy, normalized entropy/redundancy, KL divergence, mutual information,
// and the optimal-code-length (compression ceiling) against known values.
//
// Run: node --test tests/information-theory.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shannonEntropy, entropyFromCounts, normalizedEntropy, redundancy,
  klDivergence, mutualInformation, optimalCodeLengthBits,
} from "../lib/information-theory/entropy.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe("shannon entropy", () => {
  it("fair coin = 1 bit; certain = 0; uniform-n = log2(n)", () => {
    assert.ok(close(shannonEntropy([1, 1]), 1));
    assert.ok(close(shannonEntropy([1, 0, 0]), 0));
    assert.ok(close(shannonEntropy([1, 1, 1, 1]), 2)); // log2(4)
  });

  it("entropyFromCounts matches", () => {
    assert.ok(close(entropyFromCounts({ a: 50, b: 50 }), 1));
  });

  it("normalized entropy: uniform → 1, skewed → <1, certain → 0", () => {
    assert.ok(close(normalizedEntropy([1, 1, 1, 1]), 1));
    assert.ok(normalizedEntropy([9, 1]) < 1);
    assert.equal(normalizedEntropy([1, 0, 0]), 0);
  });

  it("redundancy is the compressible fraction (1 − normalized entropy)", () => {
    assert.ok(close(redundancy([1, 1, 1, 1]), 0)); // uniform = incompressible
    assert.ok(redundancy([99, 1]) > 0.5);          // very skewed = highly compressible
  });
});

describe("divergence + mutual information", () => {
  it("KL(P‖P) = 0; KL is ∞ when P has support Q lacks", () => {
    assert.ok(close(klDivergence([1, 1], [1, 1]), 0));
    assert.equal(klDivergence([1, 1], [1, 0]), Infinity);
  });

  it("mutual information is 0 for independent X,Y", () => {
    // independent: joint = outer product → MI 0
    const joint = [[0.25, 0.25], [0.25, 0.25]];
    assert.ok(close(mutualInformation(joint), 0, 1e-9));
  });

  it("mutual information is positive when X determines Y", () => {
    // perfectly correlated diagonal → MI = 1 bit
    const joint = [[0.5, 0], [0, 0.5]];
    assert.ok(close(mutualInformation(joint), 1, 1e-9));
  });
});

describe("compression ceiling", () => {
  it("optimal code length = entropy × N", () => {
    // 4 symbols uniform, 4 items → 2 bits each → 8 bits
    assert.ok(close(optimalCodeLengthBits({ a: 1, b: 1, c: 1, d: 1 }), 8));
  });
  it("a skewed corpus compresses below the naive bound", () => {
    const skewed = optimalCodeLengthBits({ a: 100, b: 1, c: 1 });
    const uniform = optimalCodeLengthBits({ a: 34, b: 34, c: 34 });
    assert.ok(skewed < uniform); // redundancy → fewer bits
  });
});
