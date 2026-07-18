// server/tests/ml-training.test.js
//
// REAL behavioral tests for the small-scale in-process CPU trainer added to
// close WAVE4's "ml — No actual model training" gap: `server/lib/ml-trainer.js`
// (pure, no STATE dependency — tested directly here as the oracle) and its
// wiring into `server/domains/ml.js`'s `experiment-train` macro (tested
// through the same lightweight registerLensAction + stubbed-STATE harness
// used by accounting-lens-macros.test.js — no full server boot needed).
//
// Three required proofs:
//   1. CONVERGENCE — logistic regression on a tiny linearly-separable
//      fixture converges to ~1.0 accuracy with correctly-signed weights.
//   2. DETERMINISM — same seed + same data ⇒ byte-identical weights and
//      an identical loss curve, on two independent training runs.
//   3. INSUFFICIENT DATA — sparse/degenerate input returns the honest
//      `{ ok:false, reason, message }` shape, never a fabricated model.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  mulberry32,
  buildFeatureMatrix,
  standardize,
  trainValSplit,
  trainLogisticRegression,
  trainKMeans,
  MIN_TRAIN_ROWS,
} from "../lib/ml-trainer.js";
import registerMlActions from "../domains/ml.js";

// ─────────────────────────────────────────────────────────────────────────
// Part 1 — pure trainer unit tests (the trainer as its own oracle: expected
// values are hand-derived where cheap — e.g. the mulberry32 stream and the
// standardize()/split() helpers — and convergence/determinism are proven by
// running the real gradient-descent loop and asserting its documented
// invariants, per the task's "verify the formula, don't paste output" rule.)
// ─────────────────────────────────────────────────────────────────────────

describe("ml-trainer: mulberry32 determinism", () => {
  it("same seed produces an identical stream", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    assert.deepEqual(seqA, seqB);
  });
  it("different seeds diverge", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    assert.notEqual(a(), b());
  });
  it("stream stays within [0,1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const v = rng();
      assert.ok(v >= 0 && v < 1, `sample ${i} out of range: ${v}`);
    }
  });
});

describe("ml-trainer: buildFeatureMatrix", () => {
  it("detects numeric columns and drops rows with non-finite features", () => {
    const rows = [
      { x: 1, y: 2, label: "a" },
      { x: 2, y: "not-a-number", label: "b" }, // y not numeric across ALL rows -> y excluded entirely
      { x: 3, y: 4, label: "a" },
    ];
    const { featureNames, X, rows: n, droppedRows } = buildFeatureMatrix(rows, "label");
    assert.deepEqual(featureNames, ["x"]); // y excluded (not numeric in every row)
    assert.equal(n, 3);
    assert.equal(droppedRows, 0);
    assert.deepEqual(X, [[1], [2], [3]]);
  });
  it("drops rows with a missing target", () => {
    const rows = [
      { x: 1, label: "a" },
      { x: 2, label: null },
      { x: 3, label: "b" },
      { x: 4, label: "" },
    ];
    const { rows: n, droppedRows } = buildFeatureMatrix(rows, "label");
    assert.equal(n, 2);
    assert.equal(droppedRows, 2);
  });
  it("truncates beyond MAX_TRAIN_ROWS deterministically (first N)", () => {
    const rows = Array.from({ length: 5010 }, (_, i) => ({ x: i, label: i % 2 === 0 ? "a" : "b" }));
    const { rows: n, truncatedFrom, X } = buildFeatureMatrix(rows, "label");
    assert.equal(truncatedFrom, 5010);
    assert.equal(n, 5000);
    assert.equal(X[0][0], 0);
    assert.equal(X[X.length - 1][0], 4999);
  });
});

describe("ml-trainer: standardize", () => {
  it("z-scores columns to mean 0 (within float tolerance)", () => {
    const X = [[1, 10], [2, 20], [3, 30], [4, 40]];
    const { Xs, means, stds } = standardize(X);
    assert.equal(means[0], 2.5);
    assert.equal(means[1], 25);
    for (let j = 0; j < 2; j++) {
      const colMean = Xs.reduce((s, r) => s + r[j], 0) / Xs.length;
      assert.ok(Math.abs(colMean) < 1e-9, `column ${j} mean not ~0: ${colMean}`);
    }
    assert.ok(stds[0] > 0 && stds[1] > 0);
  });
  it("a constant column maps to all zeros, not division-by-zero garbage", () => {
    const X = [[5], [5], [5], [5]];
    const { Xs } = standardize(X);
    for (const row of Xs) assert.equal(row[0], 0);
  });
});

describe("ml-trainer: trainValSplit", () => {
  it("is deterministic per seed and partitions every index exactly once", () => {
    const { trainIdx, valIdx } = trainValSplit(20, 0.2, 5);
    const all = [...trainIdx, ...valIdx].sort((a, b) => a - b);
    assert.deepEqual(all, Array.from({ length: 20 }, (_, i) => i));
    const again = trainValSplit(20, 0.2, 5);
    assert.deepEqual(trainIdx, again.trainIdx);
    assert.deepEqual(valIdx, again.valIdx);
  });
});

// ── Tiny linearly-separable fixture ────────────────────────────────────
// x < 0 -> class "neg", x > 0 -> class "pos", with a second, uncorrelated
// feature (constant-ish noise) so the model has to learn to ignore it.
// 40 rows total (well above MIN_TRAIN_ROWS), symmetric so the 80/20 split
// keeps both classes on both sides regardless of shuffle seed.
function separableFixture() {
  const rows = [];
  for (let i = 1; i <= 20; i++) {
    rows.push({ x: -i, noise: (i % 3) - 1, label: "neg" });
    rows.push({ x: i, noise: (i % 3) - 1, label: "pos" });
  }
  return rows;
}

describe("ml-trainer: trainLogisticRegression — convergence", () => {
  it("converges to ~1.0 accuracy with a correctly-signed weight on the separating feature", () => {
    const rows = separableFixture();
    const { featureNames, X, yRaw } = buildFeatureMatrix(rows, "label");
    // NOTE: do not sort featureNames in place — its index order is the same
    // order as X's columns, and mutating it here would desync `xIdx` below.
    assert.deepEqual([...featureNames].sort(), ["noise", "x"]);
    const xIdx = featureNames.indexOf("x");
    const result = trainLogisticRegression({ X, y: yRaw, featureNames, epochs: 400, learningRate: 0.5, seed: 42, valFraction: 0.2 });
    assert.equal(result.ok, true);
    // classes sort lexicographically: "neg" < "pos" -> negative="neg", positive="pos"
    assert.deepEqual(result.classes, { negative: "neg", positive: "pos" });
    // higher x -> "pos" (label 1) -> weight on x must be positive (post-standardization sign is preserved)
    assert.ok(result.weights[xIdx] > 0, `expected positive weight on 'x', got ${result.weights[xIdx]}`);
    assert.ok(result.finalTrainAccuracy >= 0.95, `train accuracy too low: ${result.finalTrainAccuracy}`);
    assert.ok(result.finalValAccuracy >= 0.9, `val accuracy too low: ${result.finalValAccuracy}`);
    // Loss curve must actually descend, not just report a number: last-epoch
    // train loss strictly lower than first-epoch train loss.
    assert.ok(result.history.length === 400);
    assert.ok(result.history[result.history.length - 1].trainLoss < result.history[0].trainLoss);
    // Every logged point must be finite (no NaN/Infinity ever escaped through round()).
    for (const h of result.history) {
      assert.ok(Number.isFinite(h.trainLoss) && Number.isFinite(h.valLoss));
      assert.ok(Number.isFinite(h.trainAccuracy) && Number.isFinite(h.valAccuracy));
    }
  });
});

describe("ml-trainer: trainLogisticRegression — determinism", () => {
  it("identical seed + data yields byte-identical weights and loss curve", () => {
    const rows = separableFixture();
    const { X, yRaw, featureNames } = buildFeatureMatrix(rows, "label");
    const a = trainLogisticRegression({ X, y: yRaw, featureNames, epochs: 100, learningRate: 0.3, seed: 7 });
    const b = trainLogisticRegression({ X, y: yRaw, featureNames, epochs: 100, learningRate: 0.3, seed: 7 });
    assert.equal(a.ok, true); assert.equal(b.ok, true);
    assert.deepEqual(a.weights, b.weights);
    assert.equal(a.bias, b.bias);
    assert.deepEqual(a.history, b.history);
  });
  it("a different seed can change the train/val split and is not required to match", () => {
    const rows = separableFixture();
    const { X, yRaw, featureNames } = buildFeatureMatrix(rows, "label");
    const a = trainLogisticRegression({ X, y: yRaw, featureNames, epochs: 50, learningRate: 0.3, seed: 1 });
    const b = trainLogisticRegression({ X, y: yRaw, featureNames, epochs: 50, learningRate: 0.3, seed: 2 });
    assert.equal(a.ok, true); assert.equal(b.ok, true);
    // Not asserting inequality (they could coincidentally match) — just that
    // both independently produced valid, finite, high-accuracy models.
    assert.ok(a.finalTrainAccuracy >= 0.9);
    assert.ok(b.finalTrainAccuracy >= 0.9);
  });
});

describe("ml-trainer: trainLogisticRegression — insufficient / degenerate data (honest failure)", () => {
  it("rejects too few rows", () => {
    const rows = [
      { x: 1, label: "a" }, { x: 2, label: "b" }, { x: 3, label: "a" },
    ];
    const { X, yRaw, featureNames } = buildFeatureMatrix(rows, "label");
    const result = trainLogisticRegression({ X, y: yRaw, featureNames, epochs: 50 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "insufficient_rows");
    assert.ok(typeof result.message === "string" && result.message.length > 0);
    assert.equal(result.weights, undefined);
  });
  it("rejects a target with only one class", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ x: i, label: "only-one" }));
    const { X, yRaw, featureNames } = buildFeatureMatrix(rows, "label");
    const result = trainLogisticRegression({ X, y: yRaw, featureNames, epochs: 50 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "no_class_variation");
  });
  it("rejects a target with more than two classes (not binary)", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ x: i, label: ["a", "b", "c"][i % 3] }));
    const { X, yRaw, featureNames } = buildFeatureMatrix(rows, "label");
    const result = trainLogisticRegression({ X, y: yRaw, featureNames, epochs: 50 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_binary");
  });
  it("MIN_TRAIN_ROWS boundary is enforced exactly", () => {
    const rowsBelow = Array.from({ length: MIN_TRAIN_ROWS - 1 }, (_, i) => ({ x: i, label: i % 2 ? "a" : "b" }));
    const { X, yRaw, featureNames } = buildFeatureMatrix(rowsBelow, "label");
    const result = trainLogisticRegression({ X, y: yRaw, featureNames });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "insufficient_rows");
  });
});

describe("ml-trainer: trainKMeans", () => {
  it("clusters two well-separated blobs and is deterministic per seed", () => {
    const rows = [];
    for (let i = 0; i < 10; i++) rows.push({ x: 0 + (i % 3) * 0.01, y: 0 + (i % 2) * 0.01 });
    for (let i = 0; i < 10; i++) rows.push({ x: 100 + (i % 3) * 0.01, y: 100 + (i % 2) * 0.01 });
    const { X, featureNames } = buildFeatureMatrix(rows, null);
    const a = trainKMeans({ X, featureNames, k: 2, epochs: 25, seed: 3 });
    const b = trainKMeans({ X, featureNames, k: 2, epochs: 25, seed: 3 });
    assert.equal(a.ok, true);
    assert.deepEqual(a.centroids, b.centroids);
    // clusterSizes is computed over the TRAIN split only (not all 20 rows) —
    // both blobs are well-separated so every cluster gets a non-trivial
    // share, and the sizes must sum to exactly the train split size.
    assert.equal(a.clusterSizes.reduce((s, c) => s + c, 0), a.trainRows);
    assert.ok(a.clusterSizes.every((c) => c > 0), `expected both clusters populated: ${a.clusterSizes}`);
    // Inertia must have been computed and be finite/non-negative every epoch.
    for (const h of a.history) {
      assert.ok(Number.isFinite(h.trainLoss) && h.trainLoss >= 0);
    }
  });
  it("rejects k larger than the training split", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ x: i }));
    const { X, featureNames } = buildFeatureMatrix(rows, null);
    const result = trainKMeans({ X, featureNames, k: 9, epochs: 10, seed: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "insufficient_rows");
  });
  it("rejects too few rows outright", () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ x: i }));
    const { X, featureNames } = buildFeatureMatrix(rows, null);
    const result = trainKMeans({ X, featureNames, k: 2 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "insufficient_rows");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Part 2 — the `experiment-train` macro wired into domains/ml.js, exercised
// through the same lightweight harness accounting-lens-macros.test.js uses:
// register the domain against a fake registerLensAction, stub
// `globalThis._concordSTATE`, and call handlers directly as
// `handler(ctx, virtualArtifact, params)` — no full server boot required.
// ─────────────────────────────────────────────────────────────────────────

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "ml");
  ACTIONS.set(name, fn);
}
function call(name, ctx, params = {}, artifactData = params) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`ml.${name} not registered`);
  const artifact = { id: null, domain: "ml", type: "domain_action", data: artifactData || {}, meta: {} };
  return fn(ctx, artifact, params || {});
}

before(() => { registerMlActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("ml.experiment-train macro", () => {
  it("trains logistic regression and logs a real per-epoch curve into a new experiment", () => {
    const rows = separableFixture();
    const res = call("experiment-train", ctxA, { dataset: rows, targetField: "label", algorithm: "logistic-regression", epochs: 150, learningRate: 0.5, seed: 11 });
    assert.equal(res.ok, true);
    assert.equal(res.result.trained, true);
    assert.equal(res.result.algorithm, "logistic-regression");
    assert.ok(res.result.scale.includes("small in-process CPU"));
    assert.ok(/no gpu/i.test(res.result.scale)); // must explicitly disclaim GPU, never claim it
    assert.ok(Array.isArray(res.result.weights) && res.result.weights.length === 2);
    assert.ok(res.result.finalTrainAccuracy >= 0.9);
    const exp = res.result.experiment;
    assert.ok(exp && exp.id);
    assert.equal(exp.status, "completed");
    assert.equal(exp.metrics.length, 150);
    assert.ok(exp.tags.includes("local-trained"));
    // The logged points are the SAME shape experiment-log produces, so the
    // existing ExperimentTracker chart renders them with no frontend change.
    for (const p of exp.metrics) {
      assert.ok(Number.isFinite(p.epoch) && Number.isFinite(p.trainLoss) && Number.isFinite(p.valLoss) && Number.isFinite(p.accuracy));
    }
    // Persisted into the same per-user experiment list experiment-list reads.
    const list = call("experiment-list", ctxA);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.experiments[0].id, exp.id);
  });

  it("trains into an EXISTING experiment when experimentId is supplied", () => {
    const started = call("experiment-start", ctxA, { name: "external-import" });
    const expId = started.result.experiment.id;
    const rows = separableFixture();
    const res = call("experiment-train", ctxA, { dataset: rows, targetField: "label", experimentId: expId, epochs: 20, seed: 1 });
    assert.equal(res.ok, true);
    assert.equal(res.result.experiment.id, expId);
    assert.equal(res.result.experiment.metrics.length, 20);
  });

  it("k-means path trains and logs inertia as the loss curve", () => {
    const rows = [];
    for (let i = 0; i < 10; i++) rows.push({ a: i % 2, b: 0 });
    for (let i = 0; i < 10; i++) rows.push({ a: 50 + (i % 2), b: 50 });
    const res = call("experiment-train", ctxA, { dataset: rows, algorithm: "kmeans", k: 2, epochs: 15, seed: 9 });
    assert.equal(res.ok, true);
    assert.equal(res.result.algorithm, "kmeans");
    assert.equal(res.result.k, 2);
    assert.ok(Array.isArray(res.result.centroids) && res.result.centroids.length === 2);
    assert.equal(res.result.experiment.metrics.length > 0, true);
  });

  it("honest failure: insufficient rows never fabricates a model", () => {
    const rows = [{ x: 1, label: "a" }, { x: 2, label: "b" }];
    const res = call("experiment-train", ctxA, { dataset: rows, targetField: "label" });
    assert.equal(res.ok, true); // valid answer, not a server error — matches modelEvaluate/datasetProfile convention
    assert.equal(res.result.trained, false);
    assert.equal(res.result.reason, "insufficient_rows");
    assert.ok(typeof res.result.message === "string" && res.result.message.length > 0);
    assert.equal(res.result.weights, undefined);
    assert.equal(res.result.experiment, undefined);
    // Nothing should have been persisted to the experiment list.
    const list = call("experiment-list", ctxA);
    assert.equal(list.result.count, 0);
  });

  it("honest failure: single-class target never fabricates a model", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ x: i, label: "only" }));
    const res = call("experiment-train", ctxA, { dataset: rows, targetField: "label" });
    assert.equal(res.result.trained, false);
    assert.equal(res.result.reason, "no_class_variation");
  });

  it("honest failure: empty dataset", () => {
    const res = call("experiment-train", ctxA, { dataset: [], targetField: "label" });
    assert.equal(res.ok, true);
    assert.equal(res.result.trained, false);
  });

  it("requires targetField for logistic-regression (but not for kmeans)", () => {
    const rows = separableFixture();
    const missingTarget = call("experiment-train", ctxA, { dataset: rows, algorithm: "logistic-regression" });
    assert.equal(missingTarget.ok, false);
    const kmeansNoTarget = call("experiment-train", ctxA, { dataset: rows.map((r) => ({ x: r.x, noise: r.noise })), algorithm: "kmeans", k: 2 });
    assert.equal(kmeansNoTarget.ok, true);
  });
});
