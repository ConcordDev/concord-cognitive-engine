// server/tests/causal-closure.test.js
//
// Proves the causal-closure analyzer (lib/causal-closure.js) on SYNTHETIC data
// with known ground truth — the two-sided honesty check:
//
//   • CLOSED (linear):  target_{t+1}=a·x_t + tiny noise. The ceiling predictor
//     has x_t → predicts at the noise floor, residual white → "closed".
//   • INCOMPLETE:       target_{t+1}=a·x_t + c·z_t + noise, z_t an AR(1) HIDDEN
//     latent NOT in the feature set. Even the gradient-boosted ceiling can't
//     predict z from x → deterministic, awareness-coupled residual → "incomplete";
//     the saturation control (add z) closes it.
//   • NONLINEAR-CLOSED: target_{t+1}=g(x_t) with x_t AUTOCORRELATED and NO hidden
//     axis. A LINEAR predictor underfits → a deterministic residual → it would
//     FALSELY read "incomplete" (the proposal's "underfitting manufactures a fake
//     residue"). The capacity ladder (poly2/gbrt) hits the ceiling → "closed".
//
// All randomness is seeded (mulberry32). Run: node --test tests/causal-closure.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ridgeFit,
  causalClosure,
  basisCompletionCurve,
  fitCeilingPredictor,
  buildDesign,
  residualStructure,
  _internal,
} from "../lib/causal-closure.js";

const { mulberry32 } = _internal;
const A = [0.9, -0.5, 0.3];

function genClosed(n, seed) {
  const rnd = mulberry32(seed); const u = () => rnd() * 2 - 1;
  const feats = Array.from({ length: n }, () => [u(), u(), u()]);
  const rows = [];
  for (let t = 0; t < n; t++) {
    const p = t >= 1 ? feats[t - 1] : [0, 0, 0];
    const target = t >= 1 ? A[0] * p[0] + A[1] * p[1] + A[2] * p[2] + u() * 0.002 : 0;
    rows.push({ f0: feats[t][0], f1: feats[t][1], f2: feats[t][2], awarenessIndex: rnd() * 0.5, target });
  }
  return rows;
}

function genIncomplete(n, seed, c = 1.5) {
  const rnd = mulberry32(seed); const u = () => rnd() * 2 - 1;
  const z = new Array(n).fill(0);
  for (let t = 1; t < n; t++) z[t] = 0.85 * z[t - 1] + u() * 0.4;
  const feats = Array.from({ length: n }, () => [u(), u(), u()]);
  const rows = [];
  for (let t = 0; t < n; t++) {
    const p = t >= 1 ? feats[t - 1] : [0, 0, 0];
    const zPrev = t >= 1 ? z[t - 1] : 0;
    const target = t >= 1 ? A[0] * p[0] + A[1] * p[1] + A[2] * p[2] + c * zPrev + u() * 0.002 : 0;
    rows.push({
      f0: feats[t][0], f1: feats[t][1], f2: feats[t][2],
      zHidden: z[t], awarenessIndex: Math.min(1, Math.abs(z[t]) / 1.5), target,
    });
  }
  return rows;
}

// Nonlinear target of AUTOCORRELATED inputs, NO hidden axis (fully in-basis).
function genNonlinearClosed(n, seed) {
  const rnd = mulberry32(seed); const u = () => rnd() * 2 - 1;
  const X = []; let prev = [0, 0, 0];
  for (let t = 0; t < n; t++) { const cur = [0.8 * prev[0] + u() * 0.5, 0.8 * prev[1] + u() * 0.5, 0.8 * prev[2] + u() * 0.5]; X.push(cur); prev = cur; }
  const rows = [];
  for (let t = 0; t < n; t++) {
    const p = t >= 1 ? X[t - 1] : [0, 0, 0];
    const target = t >= 1 ? (p[0] * p[0] - p[1] * p[2] + 0.5 * p[0] * p[1]) + u() * 0.002 : 0;
    rows.push({ f0: X[t][0], f1: X[t][1], f2: X[t][2], awarenessIndex: rnd() * 0.5, target });
  }
  return rows;
}

const FEATS = ["f0", "f1", "f2"];

describe("causal-closure — ridge baseline recovers a known linear map", () => {
  it("fits y = 2 + 3·x1 − 1·x2 closely", () => {
    const rnd = mulberry32(7); const X = [], y = [];
    for (let i = 0; i < 200; i++) { const x1 = rnd() * 4 - 2, x2 = rnd() * 4 - 2; X.push([1, x1, x2]); y.push(2 + 3 * x1 - 1 * x2 + (rnd() - 0.5) * 1e-3); }
    const b = ridgeFit(X, y, 1e-6);
    assert.ok(Math.abs(b[0] - 2) < 0.02 && Math.abs(b[1] - 3) < 0.02 && Math.abs(b[2] + 1) < 0.02, `got ${b}`);
  });
});

describe("causal-closure — CLOSED system reads as causally closed (out-of-sample)", () => {
  const out = causalClosure(genClosed(700, 42), { featureKeys: FEATS, targetKey: "target", historyWindow: 0, predictors: ["linear"], folds: 5, seed: 99 });
  it("predicts at the noise floor (oos R² ≈ 1)", () => { assert.equal(out.ok, true); assert.ok(out.prediction.r2 > 0.99, `R²=${out.prediction.r2}`); });
  it("residual is NOT deterministic", () => { assert.equal(out.residual.structure.deterministic, false, `z=${out.residual.structure.z}`); });
  it("verdict = closed", () => { assert.equal(out.verdict, "closed"); });
});

describe("causal-closure — INCOMPLETE system (hidden AR axis) survives the ceiling", () => {
  const rows = genIncomplete(700, 7, 1.5);
  const out = causalClosure(rows, { featureKeys: FEATS, targetKey: "target", historyWindow: 0, predictors: ["linear", "poly2", "gbrt"], folds: 5, seed: 99 });

  it("a deterministic residual survives even the gradient-boosted ceiling", () => {
    assert.equal(out.ok, true);
    assert.equal(out.residual.structure.deterministic, true, `z=${out.residual.structure.z}`);
    assert.ok(out.residual.structure.z > 5, `z should be large, got ${out.residual.structure.z}`);
  });
  it("residual COUPLES to the awareness index (bridge probe)", () => {
    assert.ok(out.awarenessCoupling.absResidualVsAwareness > 0.3, `corr=${out.awarenessCoupling.absResidualVsAwareness}`);
  });
  it("verdict = incomplete, interpretation names the awareness coupling", () => {
    assert.equal(out.verdict, "incomplete");
    assert.ok(out.interpretation.includes("awareness"));
  });
  it("SATURATION CONTROL: adding the hidden axis closes the residual → closed", () => {
    const sat = causalClosure(rows, { featureKeys: [...FEATS, "zHidden"], targetKey: "target", historyWindow: 0, predictors: ["linear"], folds: 5, seed: 99 });
    assert.ok(sat.prediction.r2 > 0.99, `R²=${sat.prediction.r2}`);
    assert.equal(sat.verdict, "closed");
  });
});

describe("causal-closure — STRONGER PREDICTOR prevents a fake residue", () => {
  // Nonlinear-but-closed with autocorrelated inputs: a linear fit's residual is
  // deterministic (time-structured) → it would FALSELY read 'incomplete'. The
  // capacity ladder must hit the ceiling and read 'closed'.
  const rows = genNonlinearClosed(700, 13);

  it("a LINEAR-only predictor is fooled (deterministic residual, not closed)", () => {
    const lin = causalClosure(rows, { featureKeys: FEATS, targetKey: "target", historyWindow: 0, predictors: ["linear"], folds: 5, seed: 5 });
    assert.notEqual(lin.verdict, "closed", `linear should NOT read closed; got ${lin.verdict} R²=${lin.prediction.r2}`);
    assert.equal(lin.residual.structure.deterministic, true, "linear underfit leaves a structured (fake) residue");
  });

  it("the capacity LADDER hits the ceiling and reads CLOSED", () => {
    const lad = causalClosure(rows, { featureKeys: FEATS, targetKey: "target", historyWindow: 0, predictors: ["linear", "poly2", "gbrt"], folds: 5, seed: 5 });
    assert.ok(lad.prediction.r2 > 0.98, `ceiling R² should be high, got ${lad.prediction.r2}`);
    assert.equal(lad.verdict, "closed");
    assert.ok(lad.predictor.ceiling !== "linear-ridge", `ceiling should be a higher rung, got ${lad.predictor.ceiling}`);
  });
});

describe("causal-closure — fitCeilingPredictor reports the ladder + plateau", () => {
  it("nonlinear-closed: oos R² climbs from linear to a nonlinear rung", () => {
    const { X, y } = buildDesign(genNonlinearClosed(600, 21), FEATS, "target", 0);
    const { ceiling, ladder } = fitCeilingPredictor(X, y, { folds: 5, predictors: ["linear", "poly2", "gbrt"] });
    const lin = ladder.find((r) => r.key === "linear").r2;
    assert.ok(ceiling.r2 > lin + 0.1, `ceiling (${ceiling.r2}) should beat linear (${lin})`);
  });
});

describe("causal-closure — basisCompletionCurve asymptotes correctly", () => {
  it("closed system: curve approaches R²≈1", () => {
    const curve = basisCompletionCurve(genClosed(500, 5), { featureKeys: FEATS, targetKey: "target", historyWindow: 0, predictors: ["linear"] });
    assert.equal(curve.length, 3);
    assert.ok(curve[2].r2 > 0.99, `full-basis R²=${curve[2].r2}`);
  });
  it("incomplete system: structured floor until the hidden axis is added", () => {
    const rows = genIncomplete(500, 11, 1.5);
    const withoutZ = basisCompletionCurve(rows, { featureKeys: FEATS, targetKey: "target", historyWindow: 0, predictors: ["linear"] });
    const withZ = basisCompletionCurve(rows, { featureKeys: [...FEATS, "zHidden"], targetKey: "target", historyWindow: 0, predictors: ["linear"] });
    assert.ok(withoutZ[2].fractionUnexplained > 0.05, "without z: a real unexplained floor remains");
    assert.ok(withZ[3].r2 > 0.99, `with z: floor closes, R²=${withZ[3].r2}`);
  });
});

describe("causal-closure — residualStructure", () => {
  it("white noise → not deterministic", () => {
    const rnd = mulberry32(3); const noise = Array.from({ length: 500 }, () => rnd() - 0.5);
    assert.equal(residualStructure(noise, { seed: 21 }).deterministic, false);
  });
  it("AR(1) series → deterministic", () => {
    const rnd = mulberry32(4); const ar = new Array(500).fill(0);
    for (let t = 1; t < ar.length; t++) ar[t] = 0.8 * ar[t - 1] + (rnd() - 0.5) * 0.3;
    assert.equal(residualStructure(ar, { seed: 21 }).deterministic, true);
  });
});
