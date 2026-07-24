// server/tests/mixed-nash.test.js
//
// Validates mixed-nash.js against KNOWN-CORRECT games (their equilibria are
// textbook, not derived from this code) — not self-consistency.
//
// Run without --test-force-exit (it silently truncates runs).
//   node --test server/tests/mixed-nash.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { mixedNashEquilibria } from "../lib/game-theory/mixed-nash.js";

const near = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol;

describe("mixedNashEquilibria — matching pennies (no pure equilibrium)", () => {
  // P1 wants to match, P2 wants to mismatch. Unique NE: both play (1/2, 1/2).
  const A = [
    [1, -1],
    [-1, 1],
  ];
  const B = [
    [-1, 1],
    [1, -1],
  ];

  it("finds exactly one equilibrium, fully mixed at (1/2, 1/2) for both players", () => {
    const res = mixedNashEquilibria(A, B);
    assert.equal(res.ok, true);
    assert.equal(res.equilibria.length, 1, `expected exactly 1 equilibrium, got ${res.equilibria.length}`);
    const eq = res.equilibria[0];
    assert.deepEqual(eq.support1.sort(), [0, 1]);
    assert.deepEqual(eq.support2.sort(), [0, 1]);
    assert.ok(near(eq.p[0], 0.5, 1e-6), `p[0]=${eq.p[0]}`);
    assert.ok(near(eq.p[1], 0.5, 1e-6), `p[1]=${eq.p[1]}`);
    assert.ok(near(eq.q[0], 0.5, 1e-6), `q[0]=${eq.q[0]}`);
    assert.ok(near(eq.q[1], 0.5, 1e-6), `q[1]=${eq.q[1]}`);
    assert.ok(near(eq.payoffs[0], 0, 1e-6));
    assert.ok(near(eq.payoffs[1], 0, 1e-6));
  });
});

describe("mixedNashEquilibria — prisoner's dilemma (unique pure equilibrium)", () => {
  // action 0 = cooperate, 1 = defect. T=5 > R=3 > P=1 > S=0.
  const T = 5, R = 3, P = 1, S = 0;
  const A = [
    [R, S],
    [T, P],
  ];
  const B = [
    [R, T],
    [S, P],
  ];

  it("finds exactly the pure mutual-defection equilibrium, no spurious extras", () => {
    const res = mixedNashEquilibria(A, B);
    assert.equal(res.ok, true);
    assert.equal(res.equilibria.length, 1, `expected exactly 1 equilibrium, got ${JSON.stringify(res.equilibria)}`);
    const eq = res.equilibria[0];
    assert.deepEqual(eq.support1, [1]);
    assert.deepEqual(eq.support2, [1]);
    assert.deepEqual(eq.p, [0, 1]);
    assert.deepEqual(eq.q, [0, 1]);
    assert.equal(eq.payoffs[0], P);
    assert.equal(eq.payoffs[1], P);
  });
});

describe("mixedNashEquilibria — battle of the sexes (2 pure + 1 mixed)", () => {
  // Husband (row) prefers football (0,0); wife (col) prefers opera (1,1).
  const A = [
    [2, 0],
    [0, 1],
  ];
  const B = [
    [1, 0],
    [0, 2],
  ];
  // Analytic mixed NE: husband plays football w.p. 2/3, wife plays football w.p. 1/3.

  it("finds both pure equilibria and the correct mixed equilibrium", () => {
    const res = mixedNashEquilibria(A, B);
    assert.equal(res.ok, true);
    assert.equal(res.equilibria.length, 3, `expected 3 equilibria, got ${JSON.stringify(res.equilibria)}`);

    const pure00 = res.equilibria.find((e) => e.support1.length === 1 && e.support1[0] === 0 && e.support2[0] === 0);
    const pure11 = res.equilibria.find((e) => e.support1.length === 1 && e.support1[0] === 1 && e.support2[0] === 1);
    const mixed = res.equilibria.find((e) => e.support1.length === 2);

    assert.ok(pure00, "missing pure equilibrium (football, football)");
    assert.deepEqual(pure00.payoffs, [2, 1]);

    assert.ok(pure11, "missing pure equilibrium (opera, opera)");
    assert.deepEqual(pure11.payoffs, [1, 2]);

    assert.ok(mixed, "missing the mixed equilibrium");
    assert.ok(near(mixed.p[0], 2 / 3, 1e-4), `p[0]=${mixed.p[0]} expected 2/3`);
    assert.ok(near(mixed.p[1], 1 / 3, 1e-4), `p[1]=${mixed.p[1]} expected 1/3`);
    assert.ok(near(mixed.q[0], 1 / 3, 1e-4), `q[0]=${mixed.q[0]} expected 1/3`);
    assert.ok(near(mixed.q[1], 2 / 3, 1e-4), `q[1]=${mixed.q[1]} expected 2/3`);
  });
});

describe("mixedNashEquilibria — refusal on oversized games", () => {
  it("returns support_enumeration_exhausted instead of hanging or guessing", () => {
    const n = 14;
    // A large random game — candidate count across all support sizes blows
    // past the default cap long before search would finish.
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const A = Array.from({ length: n }, () => Array.from({ length: n }, () => rand() * 10 - 5));
    const B = Array.from({ length: n }, () => Array.from({ length: n }, () => rand() * 10 - 5));

    const start = Date.now();
    const res = mixedNashEquilibria(A, B);
    const elapsedMs = Date.now() - start;

    assert.equal(res.ok, false);
    assert.equal(res.reason, "support_enumeration_exhausted");
    assert.equal(res.maxSupportSize, n);
    assert.ok(elapsedMs < 2000, `refusal should be near-instant, took ${elapsedMs}ms`);
  });

  it("respects an explicit maxSupportSize cap and refuses below the game's own size", () => {
    const A = [
      [1, -1],
      [-1, 1],
    ];
    const B = [
      [-1, 1],
      [1, -1],
    ];
    const res = mixedNashEquilibria(A, B, { maxSupportSize: 2, maxCandidates: 0 });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "support_enumeration_exhausted");
    assert.equal(res.maxSupportSize, 2);
  });
});
