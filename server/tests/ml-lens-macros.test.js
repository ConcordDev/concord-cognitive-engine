// Behavioral macro tests for the ML lens — the PHASE-2 LENS-DRIVEN GAP layer.
// These pin the EXACT field contract the live frontend surface drives, so a
// green test can never coexist with a dead-in-production calculator (the
// failure mode where a handler-ideal-shape test passes while the rendered
// component reads undefined fields — confirmed dead in welding/hvac before the
// 2026-06-28 alignment fixes).
//
// One real compute channel:
//   • MlActionPanel.tsx → callMacro(action, { artifact: { data } }) →
//     apiHelpers.lens.runDomain('ml', action, { input: { artifact: { data } } })
//     → dispatch peels the redundant { artifact: { data } } wrapper →
//     virtualArtifact.data === data, and the 3rd `params` arg === data. The
//     calculators read `artifact.data.*`, so the peel is load-bearing: without
//     it every calculator reads undefined and silently returns its empty
//     default IN PRODUCTION while a single-wrap test still passes.
//
// This file asserts, with the EXACT input each calculator sends and the EXACT
// fields its result card renders (cross-checked field-for-field against
// components/ml/MlActionPanel.tsx):
//   - modelEvaluate (classification): type / samples / accuracy / avgF1 /
//       perClass[].{class,precision,recall,f1,support} / confusionMatrix
//   - modelEvaluate (regression): type / samples / mse / rmse / mae / r2
//   - featureImportance: totalFeatures / topFeatures[] /
//       rankings[].{feature,variance,stdDev,correlation,importance}
//   - datasetProfile: rows / columns / qualityScore /
//       profile[].{field,type,nullRate,cardinality,stats?.mean}
//   - hyperparameterSuggest: modelType / suggestions{} / notes[]
//   - VALIDATION-REJECTION: empty / too-few-rows return an honest {message}
//   - DEGRADE-GRACEFUL: the calculators are stateless pure compute — they
//     compute even with STATE gone (never throw); state-backed ops fail-soft.
//   - FAIL-CLOSED on poisoned numerics (NaN / Infinity / "abc"): no NaN /
//     Infinity / null leaks into any rendered number, no crash.
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch
// (handler(ctx, virtualArtifact, params); virtualArtifact.data === params ===
// peeled input). No server boot, no network, no LLM, no DB.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMlActions from "../domains/ml.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "ml", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: rest = peel(body.input); virtualArtifact.data =
// rest AND the 3rd `params` arg = rest.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`ml.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const virtualArtifact = { id: null, domain: "ml", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// EXACTLY the wrapper MlActionPanel.callMacro builds before dispatch:
//   runDomain('ml', action, { input: { artifact: { data } } })
// → body.input === { artifact: { data } } → peel → data. Proves the double-wrap
// the component sends is correctly unwrapped end-to-end.
function callViaComponent(name, ctx, data = {}) {
  return call(name, ctx, { artifact: { data } });
}

// Walk a value tree and assert NO non-finite number leaked (NaN/Infinity that
// JSON-serializes as `null` and renders as "MSE null" / "null%").
function assertNoNonFiniteNumbers(value, path = "result") {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `non-finite number leaked at ${path}: ${value}`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoNonFiniteNumbers(v, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertNoNonFiniteNumbers(v, `${path}.${k}`);
  }
}

before(() => {
  registerMlActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "ml_a", id: "ml_a" }, userId: "ml_a" };

/* ───────── registration: every macro the lens surface drives ───────── */

describe("ml lens — registration of the driven macros", () => {
  it("registers the 4 pure calculators MlActionPanel drives + the hub/playground/tracker macros the tab panels drive", () => {
    const driven = [
      // MlActionPanel pure calculators (the analysis bench)
      "modelEvaluate", "featureImportance", "datasetProfile", "hyperparameterSuggest",
      // tab-panel macros (covered for shape; their network paths are external)
      "model-hub", "model-card", "playground-infer",
      "experiment-start", "experiment-log", "experiment-finish", "experiment-list", "experiment-delete",
      "dataset-hub", "dataset-register", "dataset-list",
      "model-compare", "automl-templates",
      "deploy-create", "deploy-list", "deploy-scale", "deploy-stop",
      "space-create", "space-list", "space-delete",
    ];
    for (const m of driven) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing ml.${m}`);
    }
  });
});

/* ───── component double-wrap is unwrapped end-to-end ───── */

describe("ml lens — component { artifact: { data } } wrapper is peeled at dispatch", () => {
  it("a modelEvaluate call sent the way MlActionPanel sends it reaches the handler's reader", () => {
    // If the redundant wrapper were NOT peeled, artifact.data would be
    // { artifact: { data } } and predictions/actuals would be undefined → the
    // handler returns its empty {message}. Drive it through the exact double-wrap
    // and assert the REAL classification result landed (the silent-dead guard).
    const r = callViaComponent("modelEvaluate", ctxA, {
      predictions: ["cat", "dog", "cat"],
      actuals: ["cat", "dog", "dog"],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.type, "classification", "predictions/actuals must reach the handler, not be undefined");
    assert.equal(r.result.samples, 3);
  });
});

/* ───── modelEvaluate — classification (EXACT eval card fields) ───── */

describe("ml lens — modelEvaluate classification renders the exact eval card fields", () => {
  it("computes accuracy / avgF1 / perClass precision-recall-f1-support + confusion matrix", () => {
    const r = callViaComponent("modelEvaluate", ctxA, {
      predictions: ["cat", "dog", "cat", "dog", "cat"],
      actuals: ["cat", "dog", "dog", "dog", "cat"],
    });
    assert.equal(r.ok, true);
    const res = r.result;
    // EXACT card fields: type · n=samples / accuracy% / avg F1 / per-class P R F1 (n)
    assert.equal(res.type, "classification");
    assert.equal(res.samples, 5);
    // 4/5 correct = 80.0%
    assert.equal(res.accuracy, 80);
    assert.ok(Number.isFinite(res.avgF1));
    assert.ok(Array.isArray(res.perClass) && res.perClass.length === 2);
    const cat = res.perClass.find((p) => p.class === "cat");
    // cat: predicted 3 times (cat,cat,cat indices 0,2,4), 2 actually cat → precision 2/3
    assert.equal(cat.precision, 66.7);
    assert.equal(cat.recall, 100); // both cats predicted cat
    assert.equal(cat.support, 2);
    assert.ok(Number.isFinite(cat.f1));
    // confusion matrix is a real {actual:{predicted:count}} map
    assert.equal(res.confusionMatrix.cat.cat, 2);
    assert.equal(res.confusionMatrix.dog.cat, 1);
    assertNoNonFiniteNumbers(res);
  });
});

/* ───── modelEvaluate — regression (EXACT eval card fields) ───── */

describe("ml lens — modelEvaluate regression renders the exact eval card fields", () => {
  it("computes mse / rmse / mae / r2 with real values", () => {
    const r = callViaComponent("modelEvaluate", ctxA, {
      predictions: [3.0, 2.5, 5.0, 4.0],
      actuals: [3.0, 2.5, 5.0, 4.0],
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.type, "regression");
    assert.equal(res.samples, 4);
    // perfect predictions → mse 0, rmse 0, mae 0, r2 1
    assert.equal(res.mse, 0);
    assert.equal(res.rmse, 0);
    assert.equal(res.mae, 0);
    assert.equal(res.r2, 1);
    assertNoNonFiniteNumbers(res);
  });

  it("computes a non-trivial r2 for imperfect predictions", () => {
    const r = callViaComponent("modelEvaluate", ctxA, {
      predictions: [3.1, 2.0, 5.5, 4.2],
      actuals: [3.0, 2.5, 5.0, 4.0],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.type, "regression");
    assert.ok(r.result.r2 > 0 && r.result.r2 < 1, `r2 in (0,1): ${r.result.r2}`);
    assert.ok(r.result.mse > 0);
    assertNoNonFiniteNumbers(r.result);
  });
});

/* ───── featureImportance — EXACT feature card fields ───── */

describe("ml lens — featureImportance renders the exact feature card fields", () => {
  it("ranks numeric features by correlation+variance importance and surfaces topFeatures", () => {
    // y perfectly tracks target → highest importance; component renders
    // r.feature + r.importance (bar width) for each ranking, and topFeatures[0].
    const r = callViaComponent("featureImportance", ctxA, {
      features: [
        { x: 1, y: 0, t: 0 },
        { x: 2, y: 10, t: 1 },
        { x: 3, y: 0, t: 0 },
        { x: 4, y: 10, t: 1 },
      ],
      target: "t",
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.targetField, "t");
    assert.ok(Array.isArray(res.rankings) && res.rankings.length === 2);
    for (const rk of res.rankings) {
      assert.equal(typeof rk.feature, "string");
      assert.ok(Number.isFinite(rk.variance));
      assert.ok(Number.isFinite(rk.stdDev));
      assert.ok(Number.isFinite(rk.correlation));
      assert.ok(Number.isFinite(rk.importance) && rk.importance >= 0 && rk.importance <= 100);
    }
    // y correlates perfectly with t → it ranks first / is the top feature
    assert.equal(res.rankings[0].feature, "y");
    assert.equal(res.topFeatures[0], "y");
    assertNoNonFiniteNumbers(res);
  });
});

/* ───── datasetProfile — EXACT EDA card fields ───── */

describe("ml lens — datasetProfile renders the exact EDA card fields", () => {
  it("profiles rows/columns/qualityScore + per-field type/nullRate/cardinality + numeric stats.mean", () => {
    const r = callViaComponent("datasetProfile", ctxA, {
      dataset: [
        { age: 20, city: "a" },
        { age: 30, city: "b" },
        { age: 40, city: "a" },
        { age: 50, city: "c" },
      ],
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.rows, 4);
    assert.equal(res.columns, 2);
    assert.ok(res.qualityScore >= 0 && res.qualityScore <= 100);
    const age = res.profile.find((p) => p.field === "age");
    assert.equal(age.type, "numeric");
    assert.equal(age.nullRate, 0);
    assert.equal(age.cardinality, 4);
    // the EDA card renders stats.mean (μ) for numeric fields
    assert.ok(age.stats && Number.isFinite(age.stats.mean));
    assert.equal(age.stats.mean, 35);
    const city = res.profile.find((p) => p.field === "city");
    assert.equal(city.type, "categorical");
    assertNoNonFiniteNumbers(res);
  });
});

/* ───── hyperparameterSuggest — EXACT hyperparam card fields ───── */

describe("ml lens — hyperparameterSuggest renders the exact hyperparam card fields", () => {
  it("emits modelType + suggestions{} + notes[] for a neural network", () => {
    const r = callViaComponent("hyperparameterSuggest", ctxA, {
      model: "neural-network",
      task: "classification",
      datasetSize: 5000,
      features: 20,
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.modelType, "neural-network");
    assert.equal(res.taskType, "classification");
    assert.equal(res.datasetSize, 5000);
    assert.equal(res.featureCount, 20);
    // the card maps over suggestions entries + renders notes
    assert.ok(res.suggestions && typeof res.suggestions === "object");
    assert.ok(res.suggestions.architecture, "NN branch emits an architecture block");
    assert.equal(res.suggestions.architecture.outputActivation, "softmax"); // classification
    assert.ok(Number.isFinite(res.suggestions.crossValidation));
    assert.ok(Array.isArray(res.notes) && res.notes.length > 0);
    assertNoNonFiniteNumbers(res);
  });

  it("emits a tree-model branch (nEstimators/maxDepth) for xgboost", () => {
    const r = callViaComponent("hyperparameterSuggest", ctxA, {
      model: "xgboost",
      task: "regression",
      datasetSize: 50000,
      features: 120,
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.suggestions.nEstimators));
    assert.ok(Number.isFinite(r.result.suggestions.maxDepth));
    assertNoNonFiniteNumbers(r.result);
  });
});

/* ───── validation-rejection ───── */

describe("ml lens — validation rejection (honest {message}, never a fabricated calc)", () => {
  it("modelEvaluate with no arrays returns a guidance message, not zeros", () => {
    const r = callViaComponent("modelEvaluate", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.message === "string");
    assert.equal(r.result.type, undefined);
    assert.equal(r.result.accuracy, undefined);
  });

  it("featureImportance with <3 rows returns a guidance message", () => {
    const r = callViaComponent("featureImportance", ctxA, { features: [{ a: 1 }, { a: 2 }], target: null });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.message === "string");
    assert.equal(r.result.rankings, undefined);
  });

  it("datasetProfile with an empty dataset returns a guidance message", () => {
    const r = callViaComponent("datasetProfile", ctxA, { dataset: [] });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.message === "string");
    assert.equal(r.result.profile, undefined);
  });
});

/* ───── degrade-graceful: stateless calculators compute with STATE gone ───── */

describe("ml lens — degrade-graceful (stateless calculators never depend on STATE)", () => {
  it("the 4 calculators compute even with STATE removed (they touch no globalThis state)", () => {
    delete globalThis._concordSTATE;
    delete globalThis._concordSaveStateDebounced;
    const e = callViaComponent("modelEvaluate", ctxA, { predictions: [1, 2, 3], actuals: [1, 2, 4] });
    assert.equal(e.ok, true);
    const f = callViaComponent("featureImportance", ctxA, {
      features: [{ x: 1, t: 0 }, { x: 2, t: 1 }, { x: 3, t: 0 }],
      target: "t",
    });
    assert.equal(f.ok, true);
    const p = callViaComponent("datasetProfile", ctxA, { dataset: [{ a: 1 }, { a: 2 }, { a: 3 }] });
    assert.equal(p.ok, true);
    const h = callViaComponent("hyperparameterSuggest", ctxA, { model: "linear", datasetSize: 100, features: 5 });
    assert.equal(h.ok, true);
  });

  it("a STATE-backed op (experiment-list) fails soft when STATE is gone, never throws", () => {
    delete globalThis._concordSTATE;
    const r = call("experiment-list", ctxA, {});
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  });
});

/* ───── fail-closed on poisoned numerics ───── */

describe("ml lens — fail-CLOSED on poisoned numerics (no NaN/Infinity/null leaks to rendered numbers)", () => {
  it("modelEvaluate regression REJECTS a non-finite prediction (no 'MSE null' card)", () => {
    const r = callViaComponent("modelEvaluate", ctxA, {
      predictions: [3.5, Infinity, 2.1],
      actuals: [3.0, 2.5, 2.0],
    });
    assert.equal(r.ok, false, "a non-finite prediction must be rejected, not leaked as null mse");
    assert.equal(typeof r.error, "string");
  });

  it("modelEvaluate regression REJECTS a NaN actual", () => {
    const r = callViaComponent("modelEvaluate", ctxA, {
      predictions: [3.5, 1.0, 2.1],
      actuals: [3.0, NaN, 2.0],
    });
    assert.equal(r.ok, false);
  });

  it("featureImportance EXCLUDES a column with non-finite cells (no NaN importance / null bar width)", () => {
    const r = callViaComponent("featureImportance", ctxA, {
      features: [
        { good: 1, bad: "Infinity", t: 0 },
        { good: 2, bad: "NaN", t: 1 },
        { good: 3, bad: 5, t: 0 },
      ],
      target: "t",
    });
    assert.equal(r.ok, true);
    // the poisoned 'bad' column is excluded; 'good' survives and is finite
    assert.ok(r.result.rankings.every((rk) => rk.feature !== "bad"));
    assertNoNonFiniteNumbers(r.result);
  });

  it("datasetProfile never emits NaN stats for a column with non-finite cells", () => {
    const r = callViaComponent("datasetProfile", ctxA, {
      dataset: [{ v: "Infinity" }, { v: 5 }, { v: "NaN" }, { v: 10 }],
    });
    assert.equal(r.ok, true);
    assertNoNonFiniteNumbers(r.result);
    const v = r.result.profile.find((p) => p.field === "v");
    // non-finite cells drop it below the 80% finite-numeric threshold → categorical, no stats
    assert.ok(!v.stats || Number.isFinite(v.stats.mean));
  });

  it("hyperparameterSuggest degrades gracefully on garbage numerics (defaults, finite suggestions)", () => {
    const r = callViaComponent("hyperparameterSuggest", ctxA, {
      model: "neural-network",
      task: "classification",
      datasetSize: "abc",
      features: "NaN",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.datasetSize, 1000); // default
    assert.equal(r.result.featureCount, 10); // default
    assertNoNonFiniteNumbers(r.result);
  });
});
