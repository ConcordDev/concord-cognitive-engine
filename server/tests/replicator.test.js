// server/tests/replicator.test.js
//
// Validates replicator.js against KNOWN-CORRECT population-game results
// (analytic ESS, known non-convergent orbits) — not self-consistency.
//
// Run without --test-force-exit (it silently truncates runs).
//   node --test server/tests/replicator.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { replicatorDynamics } from "../lib/game-theory/replicator.js";

describe("replicatorDynamics — Hawk-Dove ESS", () => {
  // Standard Hawk-Dove payoff matrix (rows/cols: 0=Hawk, 1=Dove).
  //   A[H][H] = (V-C)/2   A[H][D] = V
  //   A[D][H] = 0         A[D][D] = V/2
  // Known analytic ESS: fraction of Hawks x* = V/C  (requires C > V).
  const V = 1;
  const C = 4;
  const A = [
    [(V - C) / 2, V],
    [0, V / 2],
  ];
  const analyticEssHawkFraction = V / C; // = 0.25

  it("converges to the closed-form ESS mixing fraction", () => {
    const res = replicatorDynamics(A, [0.5, 0.5], { dt: 0.01, tEnd: 200 });
    assert.equal(res.converged, true, `expected convergence, finalDelta=${res.finalDelta}`);
    assert.ok(
      Math.abs(res.x[0] - analyticEssHawkFraction) < 1e-3,
      `hawk fraction ${res.x[0]} !== analytic ESS ${analyticEssHawkFraction}`
    );
    assert.ok(Math.abs(res.x[1] - (1 - analyticEssHawkFraction)) < 1e-3);
  });

  it("converges to the same ESS from a different, still-interior starting point", () => {
    const res = replicatorDynamics(A, [0.9, 0.1], { dt: 0.01, tEnd: 200 });
    assert.equal(res.converged, true);
    assert.ok(Math.abs(res.x[0] - analyticEssHawkFraction) < 1e-3, `hawk fraction ${res.x[0]}`);
  });
});

describe("replicatorDynamics — rock-paper-scissors cycles honestly", () => {
  // Classic zero-sum RPS: rows/cols 0=Rock,1=Paper,2=Scissors.
  // The interior equilibrium (1/3,1/3,1/3) is a CENTER for this exact
  // payoff structure (Hofbauer & Sigmund) — trajectories starting away from
  // it orbit forever and never settle to a fixed point.
  const A = [
    [0, -1, 1],
    [1, 0, -1],
    [-1, 1, 0],
  ];

  it("reports non-convergence rather than claiming a spurious fixed point", () => {
    const res = replicatorDynamics(A, [0.6, 0.25, 0.15], { dt: 0.01, tEnd: 60 });
    assert.equal(res.converged, false, `expected non-convergence, but converged to x=${JSON.stringify(res.x)}`);
    assert.equal(res.reason, "no_fixed_point_within_horizon");
  });
});

describe("replicatorDynamics — simplex invariance", () => {
  it("keeps population shares non-negative and summing to 1 across the whole RPS integration", () => {
    const A = [
      [0, -1, 1],
      [1, 0, -1],
      [-1, 1, 0],
    ];
    const res = replicatorDynamics(A, [0.5, 0.3, 0.2], { dt: 0.01, tEnd: 60 });
    assert.ok(res.trajectory.length > 10, "expected a meaningful number of trajectory samples");
    for (const { x, t } of res.trajectory) {
      for (const xi of x) {
        assert.ok(xi >= -1e-9, `negative population share ${xi} at t=${t}`);
      }
      const sum = x.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - 1) < 1e-6, `shares sum to ${sum} at t=${t}, expected 1`);
    }
  });

  it("keeps the simplex invariant on a converging Hawk-Dove trajectory too", () => {
    const A = [
      [-1, 1],
      [0, 0.5],
    ];
    const res = replicatorDynamics(A, [0.01, 0.99], { dt: 0.01, tEnd: 200 });
    for (const { x, t } of res.trajectory) {
      assert.ok(x[0] >= -1e-9 && x[1] >= -1e-9, `negative share at t=${t}: ${JSON.stringify(x)}`);
      assert.ok(Math.abs(x[0] + x[1] - 1) < 1e-6, `shares don't sum to 1 at t=${t}: ${JSON.stringify(x)}`);
    }
  });
});
