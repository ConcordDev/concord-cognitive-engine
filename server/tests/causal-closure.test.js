// server/tests/causal-closure.test.js
//
// Proves the causal-closure analyzer (lib/causal-closure.js) on SYNTHETIC data
// with known ground truth — the honesty check the proposal demands (Step 3/5:
// you must hit the basis's prediction ceiling and run a saturated-basis control
// before any residual means anything). Two ground-truth worlds:
//
//   • CLOSED: target_{t+1} = a·x_t + tiny noise. The in-basis predictor HAS x_t,
//     so it predicts at the noise floor and the residual is white → "closed".
//   • INCOMPLETE: target_{t+1} = a·x_t + c·z_t + tiny noise, where z_t is an
//     AR(1) HIDDEN latent NOT in the feature set. The residual ≈ c·z_t is
//     deterministic-structured AND coupled to an awareness index built from z →
//     "incomplete", and the saturation control closes it when z is added.
//
// Deterministic: all randomness is seeded (mulberry32). Run:
//   node --test tests/causal-closure.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ridgeFit,
  causalClosure,
  basisCompletionCurve,
  residualStructure,
  _internal,
} from "../lib/causal-closure.js";

const { mulberry32 } = _internal;

// ── synthetic generators ─────────────────────────────────────────────────────

const A = [0.9, -0.5, 0.3]; // true linear map from x_t → target_{t+1}

function genClosed(n, seed) {
  const rnd = mulberry32(seed);
  const u = () => rnd() * 2 - 1;
  const feats = Array.from({ length: n }, () => [u(), u(), u()]);
  const rows = [];
  for (let t = 0; t < n; t++) {
    const prev = t >= 1 ? feats[t - 1] : [0, 0, 0];
    const target = t >= 1 ? A[0] * prev[0] + A[1] * prev[1] + A[2] * prev[2] + (u() * 0.002) : 0;
    rows.push({ f0: feats[t][0], f1: feats[t][1], f2: feats[t][2], awarenessIndex: rnd() * 0.5, target });
  }
  return rows;
}

function genIncomplete(n, seed, c = 1.5) {
  const rnd = mulberry32(seed);
  const u = () => rnd() * 2 - 1;
  // Hidden AR(1) latent — autocorrelated, NOT exposed as a feature.
  const z = new Array(n).fill(0);
  for (let t = 1; t < n; t++) z[t] = 0.85 * z[t - 1] + u() * 0.4;
  const feats = Array.from({ length: n }, () => [u(), u(), u()]);
  const rows = [];
  for (let t = 0; t < n; t++) {
    const prev = t >= 1 ? feats[t - 1] : [0, 0, 0];
    const zPrev = t >= 1 ? z[t - 1] : 0;
    const target = t >= 1
      ? A[0] * prev[0] + A[1] * prev[1] + A[2] * prev[2] + c * zPrev + u() * 0.002
      : 0;
    rows.push({
      f0: feats[t][0], f1: feats[t][1], f2: feats[t][2],
      zHidden: z[t],                          // logged but withheld from featureKeys
      awarenessIndex: Math.min(1, Math.abs(z[t]) / 1.5), // bridge probe couples to |z|
      target,
    });
  }
  return rows;
}

// ── ridge sanity ─────────────────────────────────────────────────────────────

describe("causal-closure — ridge baseline recovers a known linear map", () => {
  it("fits y = 2 + 3·x1 − 1·x2 closely", () => {
    const rnd = mulberry32(7);
    const X = [], y = [];
    for (let i = 0; i < 200; i++) {
      const x1 = rnd() * 4 - 2, x2 = rnd() * 4 - 2;
      X.push([1, x1, x2]);
      y.push(2 + 3 * x1 - 1 * x2 + (rnd() - 0.5) * 1e-3);
    }
    const beta = ridgeFit(X, y, 1e-6);
    assert.ok(Math.abs(beta[0] - 2) < 0.02, `intercept ~2, got ${beta[0]}`);
    assert.ok(Math.abs(beta[1] - 3) < 0.02, `slope1 ~3, got ${beta[1]}`);
    assert.ok(Math.abs(beta[2] + 1) < 0.02, `slope2 ~-1, got ${beta[2]}`);
  });
});

// ── the experiment: closed system ────────────────────────────────────────────

describe("causal-closure — CLOSED system reads as causally closed", () => {
  const rows = genClosed(800, 42);
  const out = causalClosure(rows, { featureKeys: ["f0", "f1", "f2"], targetKey: "target", historyWindow: 0, seed: 99 });

  it("predicts at the noise floor (R² ≈ 1)", () => {
    assert.equal(out.ok, true);
    assert.ok(out.prediction.r2 > 0.99, `expected R²>0.99, got ${out.prediction.r2}`);
  });
  it("residual is NOT deterministic (white noise, not a missing axis)", () => {
    assert.equal(out.residual.structure.deterministic, false, `structure z=${out.residual.structure.z}`);
  });
  it("verdict = closed", () => {
    assert.equal(out.verdict, "closed");
  });
});

// ── the experiment: incomplete system (hidden axis) ──────────────────────────

describe("causal-closure — INCOMPLETE system (hidden AR axis) is detected", () => {
  const rows = genIncomplete(800, 7, 1.5);
  const FEATS = ["f0", "f1", "f2"]; // z withheld
  const out = causalClosure(rows, { featureKeys: FEATS, targetKey: "target", historyWindow: 0, seed: 99 });

  it("a deterministic residual SURVIVES the in-basis predictor", () => {
    assert.equal(out.ok, true);
    assert.equal(out.residual.structure.deterministic, true, `expected deterministic residual, z=${out.residual.structure.z}`);
    assert.ok(out.residual.structure.z > 5, `surrogate z should be large, got ${out.residual.structure.z}`);
  });
  it("the residual COUPLES to the awareness index (bridge probe)", () => {
    assert.ok(out.awarenessCoupling.absResidualVsAwareness > 0.3,
      `expected |resid|↔awareness corr > 0.3, got ${out.awarenessCoupling.absResidualVsAwareness}`);
  });
  it("verdict = incomplete, interpretation names the awareness coupling", () => {
    assert.equal(out.verdict, "incomplete");
    assert.ok(out.interpretation.includes("awareness"));
  });

  it("SATURATION CONTROL: adding the hidden axis as a feature closes the residual", () => {
    // The same data, but now z IS in the basis → the predictor should jump to
    // the noise floor and the verdict should flip to closed. This is the Step-5
    // control: a forgotten in-basis variable that closes it was never off-basis.
    const saturated = causalClosure(rows, { featureKeys: [...FEATS, "zHidden"], targetKey: "target", historyWindow: 0, seed: 99 });
    assert.ok(saturated.prediction.r2 > 0.99, `saturated R²>0.99, got ${saturated.prediction.r2}`);
    assert.equal(saturated.verdict, "closed");
  });
});

// ── basis-completion curve ────────────────────────────────────────────────────

describe("causal-closure — basisCompletionCurve asymptotes correctly", () => {
  it("closed system: curve approaches R²≈1 as axes are added", () => {
    const rows = genClosed(600, 5);
    const curve = basisCompletionCurve(rows, { featureKeys: ["f0", "f1", "f2"], targetKey: "target", historyWindow: 0 });
    assert.equal(curve.length, 3);
    assert.ok(curve[2].r2 > 0.99, `full-basis R²>0.99, got ${curve[2].r2}`);
    assert.ok(curve[2].r2 >= curve[0].r2, "monotone-ish: full basis ≥ first axis");
  });

  it("incomplete system: structured floor until the hidden axis is added", () => {
    const rows = genIncomplete(600, 11, 1.5);
    const withoutZ = basisCompletionCurve(rows, { featureKeys: ["f0", "f1", "f2"], targetKey: "target", historyWindow: 0 });
    const withZ = basisCompletionCurve(rows, { featureKeys: ["f0", "f1", "f2", "zHidden"], targetKey: "target", historyWindow: 0 });
    assert.ok(withoutZ[2].fractionUnexplained > 0.05, "without z: a real unexplained floor remains");
    assert.ok(withZ[3].r2 > 0.99, `with z: floor closes (R²>0.99), got ${withZ[3].r2}`);
  });
});

// ── residualStructure direct: white noise is not flagged ─────────────────────

describe("causal-closure — residualStructure rejects white noise", () => {
  it("iid noise → not deterministic", () => {
    const rnd = mulberry32(3);
    const noise = Array.from({ length: 500 }, () => rnd() - 0.5);
    const s = residualStructure(noise, { seed: 21 });
    assert.equal(s.deterministic, false, `white noise z=${s.z}`);
  });
  it("AR(1) series → deterministic", () => {
    const rnd = mulberry32(4);
    const ar = new Array(500).fill(0);
    for (let t = 1; t < ar.length; t++) ar[t] = 0.8 * ar[t - 1] + (rnd() - 0.5) * 0.3;
    const s = residualStructure(ar, { seed: 21 });
    assert.equal(s.deterministic, true, `AR(1) z=${s.z}`);
  });
});
