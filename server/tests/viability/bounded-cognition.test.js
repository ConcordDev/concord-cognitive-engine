// Wave 5 #32 — bounded cognition. Pins the 7±2 working-memory cap (narrowing
// under load), the attention simplex (sums to 1, uniform fallback), and bounded
// attention (keep top-cap by weight, distribute attention over the retained).
//
// Run: node --test tests/viability/bounded-cognition.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  workingMemoryCap,
  attentionSimplex,
  boundedAttention,
  WORKING_MEMORY,
} from "../../lib/viability/bounded-cognition.js";

const sum = (a) => a.reduce((x, y) => x + y, 0);

describe("workingMemoryCap", () => {
  it("is 9 when calm, 7 nominal, 5 when overwhelmed (Yerkes-Dodson narrowing)", () => {
    assert.equal(workingMemoryCap(0), 9);
    assert.equal(workingMemoryCap(0.5), 7);
    assert.equal(workingMemoryCap(1), 5);
    assert.equal(WORKING_MEMORY, 7);
  });
});

describe("attentionSimplex", () => {
  it("normalises to sum 1", () => {
    const s = attentionSimplex([1, 3]);
    assert.ok(Math.abs(sum(s) - 1) < 1e-9);
    assert.ok(Math.abs(s[1] - 0.75) < 1e-9);
  });
  it("falls back to uniform when all weights are zero", () => {
    assert.deepEqual(attentionSimplex([0, 0, 0, 0]), [0.25, 0.25, 0.25, 0.25]);
    assert.deepEqual(attentionSimplex([]), []);
  });
});

describe("boundedAttention", () => {
  it("keeps only the top-cap items by weight + distributes attention over them", () => {
    const items = [{ id: "a", w: 1 }, { id: "b", w: 9 }, { id: "c", w: 5 }, { id: "d", w: 2 }];
    const r = boundedAttention(items, { cap: 2, weightOf: (x) => x.w });
    assert.deepEqual(r.attended.map((x) => x.id), ["b", "c"]); // top 2 by weight
    assert.equal(r.dropped, 2);
    assert.ok(Math.abs(sum(r.attention) - 1) < 1e-9);
    assert.ok(r.attention[0] > r.attention[1]); // b gets more attention than c
  });
  it("narrows the retained set as load rises (cap from workingMemoryCap)", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: i, w: i }));
    const calm = boundedAttention(items, { cap: workingMemoryCap(0), weightOf: (x) => x.w });
    const stressed = boundedAttention(items, { cap: workingMemoryCap(1), weightOf: (x) => x.w });
    assert.equal(calm.attended.length, 9);
    assert.equal(stressed.attended.length, 5); // tunnel vision under stress
  });
});
