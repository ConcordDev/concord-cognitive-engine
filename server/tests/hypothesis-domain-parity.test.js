// Contract tests for server/domains/hypothesis.js — the statistical test
// battery, dataset import, assumption checks, multiple-comparison correction,
// hypothesis pre-registration registry, and APA report export.
//
// Statistics are checked against known reference values, not just `ok`.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHypothesisActions from "../domains/hypothesis.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

// The /api/lens/run path passes the same object as both artifact.data and params.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`hypothesis.${name}`);
  if (!fn) throw new Error(`hypothesis.${name} not registered`);
  return fn(ctx, { id: null, data: input, meta: {} }, input);
}

before(() => { registerHypothesisActions(register); });

// Each test gets a fresh per-user state bucket.
let uidCounter = 0;
let ctx;
beforeEach(() => { ctx = { userId: `user_${++uidCounter}` }; });

const approx = (a, b, tol = 0.01) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b} (±${tol})`);

// ===========================================================================
// t-test
// ===========================================================================
describe("hypothesis.tTest", () => {
  it("two-sample Welch t-test computes correct statistic", () => {
    const r = call("tTest", ctx, {
      sample1: [5, 6, 7, 8, 9],
      sample2: [1, 2, 3, 4, 5],
      kind: "welch",
    });
    assert.equal(r.ok, true);
    approx(r.result.tStatistic, 4.0, 0.001);
    assert.equal(r.result.reject, true);
    assert.ok(r.result.pValue < 0.05);
    assert.equal(r.result.testType, "welch");
  });

  it("one-sample t-test against a population mean", () => {
    const r = call("tTest", ctx, {
      sample1: [1, 2, 3, 4, 5],
      kind: "one-sample",
      populationMean: 0,
    });
    assert.equal(r.ok, true);
    approx(r.result.tStatistic, 4.2426, 0.001);
    assert.equal(r.result.degreesOfFreedom, 4);
  });

  it("paired t-test requires equal-length samples", () => {
    const r = call("tTest", ctx, { sample1: [1, 2, 3], sample2: [1, 2], kind: "paired" });
    assert.equal(r.ok, false);
  });

  it("rejects samples that are too small", () => {
    const r = call("tTest", ctx, { sample1: [1] });
    assert.equal(r.ok, false);
  });
});

// ===========================================================================
// ANOVA
// ===========================================================================
describe("hypothesis.anova", () => {
  it("one-way ANOVA computes F and eta-squared", () => {
    const r = call("anova", ctx, {
      groups: [
        { values: [1, 2, 3] },
        { values: [4, 5, 6] },
        { values: [7, 8, 9] },
      ],
    });
    assert.equal(r.ok, true);
    approx(r.result.fStatistic, 27, 0.01);
    assert.equal(r.result.reject, true);
    approx(r.result.etaSquared, 0.9, 0.01);
    assert.equal(r.result.degreesOfFreedom.between, 2);
    assert.equal(r.result.degreesOfFreedom.within, 6);
  });

  it("rejects fewer than two groups", () => {
    assert.equal(call("anova", ctx, { groups: [{ values: [1, 2, 3] }] }).ok, false);
  });
});

// ===========================================================================
// Chi-square
// ===========================================================================
describe("hypothesis.chiSquare", () => {
  it("test of independence on a 2x2 contingency table", () => {
    const r = call("chiSquare", ctx, { table: [[10, 20], [20, 10]] });
    assert.equal(r.ok, true);
    approx(r.result.chiSquare, 6.6667, 0.01);
    assert.equal(r.result.degreesOfFreedom, 1);
    assert.ok(r.result.pValue < 0.05);
    assert.equal(r.result.testType, "independence");
  });

  it("goodness-of-fit returns chi-square 0 for a perfect uniform fit", () => {
    const r = call("chiSquare", ctx, { observed: [25, 25, 25, 25] });
    assert.equal(r.ok, true);
    approx(r.result.chiSquare, 0, 0.001);
    assert.equal(r.result.reject, false);
  });

  it("rejects a malformed contingency table", () => {
    assert.equal(call("chiSquare", ctx, { table: [[1, 2], [3]] }).ok, false);
  });
});

// ===========================================================================
// Correlation
// ===========================================================================
describe("hypothesis.correlation", () => {
  it("perfect positive correlation yields r=1 and a significant p-value", () => {
    const r = call("correlation", ctx, {
      x: [1, 2, 3, 4, 5, 6],
      y: [2, 4, 6, 8, 10, 12],
    });
    assert.equal(r.ok, true);
    approx(r.result.pearson, 1, 0.0001);
    approx(r.result.spearman, 1, 0.0001);
    assert.equal(r.result.reject, true);
    assert.equal(r.result.direction, "positive");
  });

  it("computes a negative correlation direction", () => {
    const r = call("correlation", ctx, {
      x: [1, 2, 3, 4, 5],
      y: [10, 8, 6, 4, 2],
    });
    approx(r.result.pearson, -1, 0.0001);
    assert.equal(r.result.direction, "negative");
  });

  it("rejects mismatched-length arrays", () => {
    assert.equal(call("correlation", ctx, { x: [1, 2, 3], y: [1, 2] }).ok, false);
  });
});

// ===========================================================================
// Regression
// ===========================================================================
describe("hypothesis.regression", () => {
  it("OLS recovers the underlying slope and intercept", () => {
    const r = call("regression", ctx, {
      x: [1, 2, 3, 4, 5],
      y: [3, 5, 7, 9, 11], // y = 2x + 1 exactly
    });
    assert.equal(r.ok, true);
    approx(r.result.slope, 2, 0.001);
    approx(r.result.intercept, 1, 0.001);
    approx(r.result.rSquared, 1, 0.0001);
    assert.equal(r.result.significant, true);
  });

  it("rejects x with zero variance", () => {
    assert.equal(call("regression", ctx, { x: [3, 3, 3], y: [1, 2, 3] }).ok, false);
  });
});

// ===========================================================================
// Assumption checks
// ===========================================================================
describe("hypothesis.assumptionCheck", () => {
  it("runs normality and homoscedasticity diagnostics", () => {
    const r = call("assumptionCheck", ctx, {
      sample: [4.1, 5.2, 4.8, 6.0, 5.5, 4.9, 5.1, 5.8, 4.4, 5.6],
      groups: [
        { values: [4, 5, 6, 5, 4] },
        { values: [8, 9, 7, 8, 9] },
      ],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.checks.length >= 3);
    assert.ok(r.result.checks.some((c) => c.test === "normality"));
    assert.ok(r.result.checks.some((c) => c.test === "homoscedasticity"));
    assert.equal(typeof r.result.allPassed, "boolean");
  });

  it("requires sample or groups data", () => {
    assert.equal(call("assumptionCheck", ctx, {}).ok, false);
  });
});

// ===========================================================================
// Multiple-comparison correction
// ===========================================================================
describe("hypothesis.multipleComparison", () => {
  it("applies Bonferroni, Holm and FDR adjustment", () => {
    const r = call("multipleComparison", ctx, {
      pValues: [0.001, 0.01, 0.04, 0.5],
      alpha: 0.05,
    });
    assert.equal(r.ok, true);
    approx(r.result.summary.bonferroniThreshold, 0.0125, 0.0001);
    // Bonferroni: 0.001*4=0.004 < .05, 0.01*4=0.04 < .05, 0.04*4=0.16 not.
    assert.equal(r.result.tests[0].bonferroniReject, true);
    assert.equal(r.result.tests[2].bonferroniReject, false);
    // FDR is less conservative than Bonferroni.
    assert.ok(r.result.summary.fdrSignificant >= r.result.summary.bonferroniSignificant);
  });

  it("rejects out-of-range p-values", () => {
    assert.equal(call("multipleComparison", ctx, { pValues: [0.5, 1.5] }).ok, false);
  });
});

// ===========================================================================
// Dataset import + run-on-dataset
// ===========================================================================
describe("hypothesis dataset lifecycle", () => {
  it("imports CSV, infers column types, lists, runs a test, and deletes", () => {
    const imp = call("datasetImport", ctx, {
      name: "trial1",
      csv: "x,y\n1,2\n2,4\n3,6\n4,8\n5,10",
    });
    assert.equal(imp.ok, true);
    assert.equal(imp.result.columnCount, 2);
    assert.equal(imp.result.rowCount, 5);
    assert.equal(imp.result.columns[0].type, "numeric");

    const list = call("datasetList", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);

    const got = call("datasetGet", ctx, { id: imp.result.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.columns[0].values.length, 5);

    const run = call("runTestOnDataset", ctx, {
      datasetId: imp.result.id,
      test: "correlation",
      columns: ["x", "y"],
    });
    // runTestOnDataset returns the inner handler's { ok, result } envelope.
    assert.equal(run.ok, true);
    approx(run.result.pearson, 1, 0.0001);

    const del = call("datasetDelete", ctx, { id: imp.result.id });
    assert.equal(del.ok, true);
    assert.equal(call("datasetList", ctx, {}).result.count, 0);
  });

  it("infers categorical columns and runs ANOVA grouped by a column", () => {
    const imp = call("datasetImport", ctx, {
      name: "grouped",
      csv: "group,score\nA,1\nA,2\nA,3\nB,4\nB,5\nB,6\nC,7\nC,8\nC,9",
    });
    assert.equal(imp.ok, true);
    const groupCol = imp.result.columns.find((c) => c.name === "group");
    assert.equal(groupCol.type, "categorical");

    const run = call("runTestOnDataset", ctx, {
      datasetId: imp.result.id,
      test: "anova",
      groupColumn: "group",
      valueColumn: "score",
    });
    assert.equal(run.ok, true);
    approx(run.result.fStatistic, 27, 0.01);
  });

  it("rejects import with no csv", () => {
    assert.equal(call("datasetImport", ctx, { name: "x" }).ok, false);
  });
});

// ===========================================================================
// Pre-registration registry
// ===========================================================================
describe("hypothesis pre-registration registry", () => {
  it("registers, lists, records outcome, and deletes a hypothesis", () => {
    const pre = call("preregister", ctx, {
      statement: "Treatment increases recovery",
      predictedDirection: "greater",
      test: "tTest",
      alpha: 0.05,
      plannedSampleSize: 60,
    });
    assert.equal(pre.ok, true);
    assert.equal(pre.result.status, "registered");

    let list = call("registryList", ctx, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.counts.registered, 1);

    // Outcome matching the predicted direction => confirmed.
    const out = call("recordOutcome", ctx, {
      id: pre.result.id,
      reject: true,
      pValue: 0.01,
      observedDirection: "greater",
      effectSize: 0.6,
    });
    assert.equal(out.ok, true);
    assert.equal(out.result.outcome.verdict, "confirmed");
    assert.equal(out.result.outcome.predictionConfirmed, true);

    list = call("registryList", ctx, {});
    assert.equal(list.result.counts.confirmed, 1);

    const del = call("registryDelete", ctx, { id: pre.result.id });
    assert.equal(del.ok, true);
    assert.equal(call("registryList", ctx, {}).result.count, 0);
  });

  it("marks a non-rejected outcome as refuted", () => {
    const pre = call("preregister", ctx, { statement: "Effect exists" });
    const out = call("recordOutcome", ctx, { id: pre.result.id, reject: false, pValue: 0.4 });
    assert.equal(out.result.outcome.verdict, "refuted");
  });

  it("marks a wrong-direction outcome as inconclusive", () => {
    const pre = call("preregister", ctx, {
      statement: "A beats B",
      predictedDirection: "greater",
    });
    const out = call("recordOutcome", ctx, {
      id: pre.result.id,
      reject: true,
      pValue: 0.02,
      observedDirection: "less",
    });
    assert.equal(out.result.outcome.verdict, "inconclusive");
  });

  it("requires a statement", () => {
    assert.equal(call("preregister", ctx, {}).ok, false);
  });
});

// ===========================================================================
// APA report export + analysis history
// ===========================================================================
describe("hypothesis.apaReport + analysisHistory", () => {
  it("generates an APA-formatted t-test report", () => {
    const t = call("tTest", ctx, { sample1: [5, 6, 7, 8, 9], sample2: [1, 2, 3, 4, 5] });
    const rep = call("apaReport", ctx, { kind: "tTest", result: t.result });
    assert.equal(rep.ok, true);
    assert.match(rep.result.apa, /t\(/);
    assert.match(rep.result.apa, /p [=<]/);
  });

  it("generates an APA report from a stored analysis id", () => {
    call("anova", ctx, {
      groups: [{ values: [1, 2, 3] }, { values: [4, 5, 6] }],
    });
    const hist = call("analysisHistory", ctx, {});
    assert.equal(hist.ok, true);
    assert.ok(hist.result.count >= 1);
    const rep = call("apaReport", ctx, { analysisId: hist.result.items[0].id });
    assert.equal(rep.ok, true);
    assert.match(rep.result.apa, /F\(/);
  });

  it("requires kind+result or analysisId", () => {
    assert.equal(call("apaReport", ctx, {}).ok, false);
  });
});

// ===========================================================================
// Pre-existing tests still pass (regression guard)
// ===========================================================================
describe("hypothesis pre-existing macros", () => {
  it("zTest still computes a one-sample z-statistic", () => {
    const r = call("zTest", ctx, {
      sample: { mean: 105, stdDev: 15, n: 30 },
      populationMean: 100,
    });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.zStatistic, "number");
  });

  it("abTest still analyses a conversion experiment", () => {
    const r = call("abTest", ctx, {
      control: { visitors: 1000, conversions: 100 },
      variant: { visitors: 1000, conversions: 130 },
    });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.significant, "boolean");
  });

  it("powerAnalysis still solves for sample size", () => {
    const r = call("powerAnalysis", ctx, { solve: "sampleSize", effectSize: 0.5, power: 0.8 });
    assert.equal(r.ok, true);
    assert.ok(r.result.requiredN > 0);
  });

  it("bayesianInference still does a Beta-Binomial update", () => {
    const r = call("bayesianInference", ctx, {
      prior: { distribution: "beta", alpha: 1, beta: 1 },
      observations: { successes: 8, trials: 10 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.posterior.distribution, "Beta");
  });
});
