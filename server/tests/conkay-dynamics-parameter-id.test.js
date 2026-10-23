// server/tests/conkay-dynamics-parameter-id.test.js
//
// Closed-form acceptance tests for dynamics.parameter-id (linear LSQ
// identification of pendulum-link inertial parameters).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parameterId } from "../lib/conkay/physics/solvers/dynamics-parameter-id.js";
import { listSolvers } from "../lib/conkay/physics/registry.js";

const G = 9.80665;

/** Synthetic closed-form τ for the planar pendulum. */
function truth(m, a, Izz, q, qddot) {
  return (-m * G * a) * Math.cos(q) + (Izz + m * a * a) * qddot;
}

describe("dynamics.parameter-id — solver registration", () => {
  it("is registered in the solver registry", () => {
    const solvers = listSolvers();
    const s = solvers.find((x) => x.id === "dynamics.parameter-id");
    assert.ok(s, "dynamics.parameter-id should be registered");
    assert.equal(s.version, "1.0.0");
    assert.equal(s.fidelity, 1);
    assert.ok(Array.isArray(s.domains) && s.domains.includes("robotics"));
    assert.equal(s.method, "dynamics.lsq-parameter-identification");
  });
});

describe("dynamics.parameter-id — exact recovery on synthetic data", () => {
  // known parameters used across the tests
  const m = 2.0;
  const a = 0.35;
  const Izz = 0.05;
  const p1Truth = -m * G * a;
  const p2Truth = Izz + m * a * a;

  // Eight (q, qdot, qddot) triples giving fully informative regressors.
  const qCases = [
    [0.10, 0.00,  0.20],
    [0.40, 0.05, -0.10],
    [0.85, 0.20,  0.30],
    [1.20, 0.00,  0.05],
    [1.55, 0.10, -0.25],
    [-0.30, 0.0,  0.15],
    [-1.05, 0.0,  0.40],
    [2.00, 0.0, -0.20],
  ];

  it("recovers p1 and p2 to floating-point accuracy (no noise)", () => {
    const samples = qCases.map(([q, qdot, qddot]) => ({
      q, qdot, qddot, tau: truth(m, a, Izz, q, qddot),
    }));
    const r = parameterId({ samples });
    assert.equal(r.status, "ok");
    assert.equal(r.identifiable, true);
    assert.equal(r.numSamples, samples.length);
    assert.equal(r.dof, samples.length - 2);
    assert.deepEqual(r.designMatrixShape, [samples.length, 2]);

    const p1 = r.parameters.p1;
    const p2 = r.parameters.p2;
    assert.ok(Math.abs(p1 - p1Truth) < 1e-9, `p1 mismatch: ${p1} vs ${p1Truth}`);
    assert.ok(Math.abs(p2 - p2Truth) < 1e-9, `p2 mismatch: ${p2} vs ${p2Truth}`);
    assert.ok(r.rmsResidual < 1e-9, `rmsResidual should be < 1e-9, got ${r.rmsResidual}`);
    // All numerics must be finite.
    assert.ok(Number.isFinite(p1));
    assert.ok(Number.isFinite(p2));
    assert.ok(Number.isFinite(r.conditionNumber));
    assert.ok(Number.isFinite(r.residualNorm));
    assert.ok(Number.isFinite(r.rmsResidual));
    for (const v of r.residual) assert.ok(Number.isFinite(v));
  });

  it("recoveredCombinations.mTimesA matches m·a to floating-point accuracy", () => {
    const samples = qCases.map(([q, qdot, qddot]) => ({
      q, qdot, qddot, tau: truth(m, a, Izz, q, qddot),
    }));
    const r = parameterId({ samples });
    assert.equal(r.status, "ok");
    assert.ok(Math.abs(r.recoveredCombinations.mTimesA - m * a) < 1e-9,
      `mTimesA mismatch: ${r.recoveredCombinations.mTimesA} vs ${m * a}`);
    // iEff should be (Izz + m·a²) exactly.
    assert.ok(Math.abs(r.recoveredCombinations.iEff - p2Truth) < 1e-9);
    // Identifiability note must explain the limitation.
    assert.ok(typeof r.identifiability === "string" && r.identifiability.length > 0);
  });

  it("recovers m·a within 5 percent under deterministic ±1% noise on τ", () => {
    // Deterministic pseudo-noise: sin(k) · 0.01 · τ_clean. Bounded at 1 %
    // in magnitude and seedable; no Math.random.
    const samples = qCases.map(([q, qdot, qddot], k) => {
      const clean = truth(m, a, Izz, q, qddot);
      const noise = Math.sin(k + 1.234) * 0.01 * clean;
      return { q, qdot, qddot, tau: clean + noise };
    });
    const r = parameterId({ samples });
    // We don't ask for floating-point recovery, only that m·a is within 5 %
    // of truth.
    const truthMA = m * a;
    const relErr = Math.abs(r.recoveredCombinations.mTimesA - truthMA) / truthMA;
    assert.ok(relErr < 0.05, `mTimesA relative error ${relErr} >= 0.05 (got ${r.recoveredCombinations.mTimesA} vs truth ${truthMA})`);
    // identifiability still holds with a mildly degenerate-but-informative
    // design matrix.
    assert.equal(r.identifiable, true);
  });
});

describe("dynamics.parameter-id — invalid inputs", () => {
  it("empty samples returns not_computed", () => {
    const r = parameterId({ samples: [] });
    assert.equal(r.status, "not_computed");
    assert.equal(r.reason, "samples required");
    assert.equal(r.numSamples, 0);
    assert.equal(r.dof, 0);
    assert.deepEqual(r.designMatrixShape, [0, 2]);
  });

  it("missing samples field returns not_computed", () => {
    const r = parameterId({});
    assert.equal(r.status, "not_computed");
    assert.equal(r.reason, "samples required");
  });

  it("sample missing tau returns not_computed with badIndex set", () => {
    const samples = [
      { q: 0.1, qdot: 0, qddot: 0.2, tau: 0.1 },
      { q: 0.2, qdot: 0, qddot: -0.1 },          // tau missing
      { q: 0.3, qdot: 0, qddot: 0.4, tau: 0.2 },
    ];
    const r = parameterId({ samples });
    assert.equal(r.status, "not_computed");
    assert.ok(/sample at index 1/.test(r.reason));
    assert.equal(r.badIndex, 1);
  });

  it("sample with non-finite qddot returns not_computed with badIndex set", () => {
    const samples = [
      { q: 0.1, qdot: 0, qddot: 0.2, tau: 0.1 },
      { q: 0.2, qdot: 0, qddot: NaN, tau: 0.05 },
    ];
    const r = parameterId({ samples });
    assert.equal(r.status, "not_computed");
    assert.equal(r.badIndex, 1);
  });
});

describe("dynamics.parameter-id — identifiability and conditioning", () => {
  it("constant q (degenerate cos column) is flagged as ill-conditioned or non-identifiable", () => {
    // Same q for every sample ⇒ cos(q) is identical for every row. We
    // pick q = π/2 so cos(q) = 0 exactly, which zeroes the entire cos(q)
    // column of Y (a = 0, b = 0). Combined with varying qddot (so the
    // qddot column has non-zero variance) this produces a genuinely
    // rank-deficient design: λ_min ≈ 0 (or non-positive), so κ → ∞.
    const samples = [
      { q: Math.PI / 2, qdot: 0.0, qddot:  0.1, tau:  0.4 },
      { q: Math.PI / 2, qdot: 0.0, qddot: -0.1, tau: -0.5 },
      { q: Math.PI / 2, qdot: 0.0, qddot:  0.2, tau:  0.7 },
      { q: Math.PI / 2, qdot: 0.0, qddot:  0.0, tau:  0.0 },
      { q: Math.PI / 2, qdot: 0.0, qddot:  0.3, tau:  1.0 },
    ];
    const r = parameterId({ samples });
    // Either not identifiable, or the reported condition number is huge.
    const ill = r.identifiable === false || r.conditionNumber > 1e6;
    assert.ok(ill, `expected identifiable=false or conditionNumber>1e6, got identifiable=${r.identifiable}, κ=${r.conditionNumber}`);
    if (r.identifiable === false) {
      assert.equal(r.status, "warn");
      assert.ok(r.reason && r.reason.length > 0);
    }
    // All numerics still finite.
    assert.ok(Number.isFinite(r.conditionNumber));
    assert.ok(Number.isFinite(r.rmsResidual));
  });

  it("n=1 (fewer than 2 parameters) is non-identifiable and dof ≤ 0", () => {
    const samples = [{ q: 0.1, qdot: 0, qddot: 0.4, tau: 0.5 }];
    const r = parameterId({ samples });
    assert.equal(r.status, "warn");
    assert.equal(r.identifiable, false);
    assert.equal(r.numSamples, 1);
    assert.ok(r.dof <= 0, `dof should be ≤ 0 for n=1, got ${r.dof}`);
    assert.ok(Number.isFinite(r.conditionNumber));
  });

  it("two distinct q with non-zero qddot identifies both parameters", () => {
    // Minimal well-conditioned dataset: two samples with differing q AND
    // differing qddot, so the regressor has full rank.
    const samples = [
      { q: 0.0, qdot: 0, qddot: 0.0, tau: -2.0 * G * 0.35 * Math.cos(0.0) }, // τ = p1 cos(0) + p2·0
      { q: 1.0, qdot: 0, qddot: 0.5, tau: -2.0 * G * 0.35 * Math.cos(1.0) + (0.05 + 2 * 0.35 * 0.35) * 0.5 },
    ];
    const r = parameterId({ samples });
    // With exactly 2 samples the system is just-determined, dof = 0,
    // residual should be (approximately) zero.
    assert.equal(r.identifiable, true);
    assert.equal(r.dof, 0);
    assert.equal(r.status, "ok");
    assert.ok(Math.abs(r.parameters.p1 - (-2.0 * G * 0.35)) < 1e-9);
    assert.ok(Math.abs(r.parameters.p2 - (0.05 + 2 * 0.35 * 0.35)) < 1e-9);
    assert.ok(r.rmsResidual < 1e-9, `rmsResidual should be ~0, got ${r.rmsResidual}`);
  });
});
