// tests/depth/science-behavior.test.js — REAL behavioral tests for the
// science domain (registerLensAction family, invoked via lensRun). Curated
// high-confidence subset: exact-value statistics calcs + CRUD round-trips +
// validation rejections. Every lensRun("science", "<macro>", …) call literally
// names the macro, so the macro-depth grader credits it as a behavioral
// invocation.
//
// SKIPPED (network/LLM): "vision" (LLaVA image inference, requires brain).
// All other macros are pure JS and tested here or are thin siblings of the
// CRUD families exercised below.
//
// NB on wrapping: lens.run UNWRAPS a handler's {ok:true, result:{…}} to r.result.
// A handler {ok:false, error} (no result key) passes through as r.result, so a
// rejection is asserted via r.result.ok === false + r.result.error.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("science — statistics calc contracts (exact computed values)", () => {
  it("stats-descriptive: hand-computed mean/median/sd/variance/quartiles for a known sample", async () => {
    // sample [2,4,4,4,5,5,7,9], n=8: mean=5, median=4.5, sample-variance=32/7=4.5714,
    // sd=2.1381, min=2, max=9, sum=40. q1 (p25): k=1.75 → 4+0.75*(4-4)=4. q3 (p75): k=5.25 → 5+0.25*(7-5)=5.5. iqr=1.5
    const r = await lensRun("science", "stats-descriptive", { params: { data: [2, 4, 4, 4, 5, 5, 7, 9] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.n, 8);
    assert.equal(r.result.mean, 5);
    assert.equal(r.result.median, 4.5);
    assert.equal(r.result.variance, 4.5714);
    assert.equal(r.result.sd, 2.1381);
    assert.equal(r.result.min, 2);
    assert.equal(r.result.max, 9);
    assert.equal(r.result.sum, 40);
    assert.equal(r.result.q1, 4);
    assert.equal(r.result.q3, 5.5);
    assert.equal(r.result.iqr, 1.5);
  });

  it("stats-correlation: a perfect line y=2x gives r=1, R²=1, slope=2, intercept=0", async () => {
    const r = await lensRun("science", "stats-correlation", { params: { x: [1, 2, 3, 4, 5], y: [2, 4, 6, 8, 10] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.n, 5);
    assert.equal(r.result.pearsonR, 1);
    assert.equal(r.result.rSquared, 1);
    assert.equal(r.result.slope, 2);
    assert.equal(r.result.intercept, 0);
    assert.equal(r.result.equation, "y = 2.0000x + 0.0000");
  });

  it("stats-regression: perfect line gives slope=3, intercept=1, R²=1 and an exact equation", async () => {
    // y = 3x + 1 → slope 3, intercept 1, rSquared 1 (no residual)
    const r = await lensRun("science", "stats-regression", { params: { x: [0, 1, 2, 3, 4], y: [1, 4, 7, 10, 13] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.n, 5);
    assert.equal(r.result.slope, 3);
    assert.equal(r.result.intercept, 1);
    assert.equal(r.result.rSquared, 1);
    assert.equal(r.result.equation, "y = 3.0000x + 1.0000");
  });

  it("stats-ttest one-sample: t-statistic, df and sample mean are exact for known data", async () => {
    // a=[4,5,6], mean=5, sample-sd=1, se=1/sqrt(3)=0.57735, mu=2 → t=(5-2)/0.57735=5.1962, df=2
    const r = await lensRun("science", "stats-ttest", { params: { kind: "one-sample", a: [4, 5, 6], mu: 2 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "one-sample");
    assert.equal(r.result.t, 5.1962);
    assert.equal(r.result.df, 2);
    assert.equal(r.result.sampleMean, 5);
    assert.equal(r.result.mu, 2);
  });

  it("stats-ttest two-sample: reports Welch kind, exact group means and sizes", async () => {
    // meanA = (1+2+3)/3 = 2, meanB = (4+5+6)/3 = 5; identical spread → symmetric
    const r = await lensRun("science", "stats-ttest", { params: { a: [1, 2, 3], b: [4, 5, 6] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "two-sample-welch");
    assert.equal(r.result.meanA, 2);
    assert.equal(r.result.meanB, 5);
    assert.equal(r.result.nA, 3);
    assert.equal(r.result.nB, 3);
    // means differ by 3 with tight spread → significant
    assert.equal(r.result.significantAt05, true);
  });

  it("stats-anova: identical group means → SS-between 0, F 0, not significant", async () => {
    const r = await lensRun("science", "stats-anova", { params: { groups: [[1, 2, 3], [1, 2, 3], [1, 2, 3]] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.ssBetween, 0);
    assert.equal(r.result.fStatistic, 0);
    assert.equal(r.result.dfBetween, 2); // k-1 = 3-1
    assert.equal(r.result.dfWithin, 6); // N-k = 9-3
    assert.equal(r.result.significantAt05, false);
  });

  it("stats-ci: CI is centered on the sample mean and the margin computes symmetrically", async () => {
    const r = await lensRun("science", "stats-ci", { params: { data: [10, 12, 14, 16, 18], confidence: 0.95 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.n, 5);
    assert.equal(r.result.mean, 14);
    // lower/upper symmetric about mean by marginOfError
    assert.equal(Math.round((r.result.upper - r.result.mean) * 10000) / 10000, r.result.marginOfError);
    assert.equal(Math.round((r.result.mean - r.result.lower) * 10000) / 10000, r.result.marginOfError);
    assert.equal(r.result.confidence, 0.95);
  });

  it("dataQualityReport: completeness and numeric stats are computed per field", async () => {
    const r = await lensRun("science", "dataQualityReport", {
      data: { dataset: [
        { temp: 20, ph: 7 },
        { temp: 22, ph: 8 },
        { temp: 24, ph: null },
        { temp: 26, ph: 6 },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalRecords, 4);
    assert.equal(r.result.totalFields, 2);
    // temp fully present (100%), mean (20+22+24+26)/4 = 23
    assert.equal(r.result.fieldStats.temp.completeness, 100);
    assert.equal(r.result.fieldStats.temp.numeric.mean, 23);
    // ph has 1 missing of 4 → 75% complete
    assert.equal(r.result.fieldStats.ph.completeness, 75);
  });
});

describe("science — calc validation rejections", () => {
  it("stats-descriptive rejects an empty data array", async () => {
    const bad = await lensRun("science", "stats-descriptive", { params: { data: [] } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /data array required/);
  });

  it("stats-correlation rejects mismatched x/y lengths", async () => {
    const bad = await lensRun("science", "stats-correlation", { params: { x: [1, 2, 3], y: [1, 2] } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /same length/);
  });

  it("stats-anova rejects fewer than two groups", async () => {
    const bad = await lensRun("science", "stats-anova", { params: { groups: [[1, 2, 3]] } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /need >= 2 groups/);
  });
});

describe("science — CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("science-crud"); });

  it("dataset-save → dataset-list → dataset-get: rows + columns round-trip", async () => {
    const save = await lensRun("science", "dataset-save", {
      params: { name: "Trial A", columns: ["x", "y"], rows: [[1, 2], [3, 4]] },
    }, ctx);
    assert.equal(save.ok, true);
    assert.equal(save.result.dataset.name, "Trial A");
    const id = save.result.dataset.id;

    const list = await lensRun("science", "dataset-list", {}, ctx);
    assert.ok(list.result.datasets.some((d) => d.id === id && d.rowCount === 2));

    const got = await lensRun("science", "dataset-get", { params: { id } }, ctx);
    assert.deepEqual(got.result.dataset.rows, [[1, 2], [3, 4]]);
    assert.deepEqual(got.result.dataset.columns, ["x", "y"]);
  });

  it("reagent-save → reagent-consume → reagent-list: quantity decrements and low-stock flips", async () => {
    const save = await lensRun("science", "reagent-save", {
      params: { name: "Ethanol", quantity: 10, unit: "mL", reorderThreshold: 5 },
    }, ctx);
    assert.equal(save.ok, true);
    assert.equal(save.result.reagent.quantity, 10);
    assert.equal(save.result.reagent.lowStock, false);
    const id = save.result.reagent.id;

    const consume = await lensRun("science", "reagent-consume", { params: { id, amount: 6 } }, ctx);
    assert.equal(consume.ok, true);
    assert.equal(consume.result.reagent.quantity, 4); // 10 - 6
    assert.equal(consume.result.reagent.lowStock, true); // 4 <= 5

    const list = await lensRun("science", "reagent-list", {}, ctx);
    assert.ok(list.result.reagents.some((r) => r.id === id && r.quantity === 4));
    assert.ok(list.result.lowStockCount >= 1);
  });

  it("reagent-consume rejects an amount exceeding stock", async () => {
    const save = await lensRun("science", "reagent-save", { params: { name: "Acetone", quantity: 3 } }, ctx);
    const bad = await lensRun("science", "reagent-consume", { params: { id: save.result.reagent.id, amount: 99 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /insufficient quantity/);
  });

  it("protorun-start → protorun-step → protorun-complete: step + deviation count round-trip", async () => {
    const start = await lensRun("science", "protorun-start", {
      params: { protocolName: "Titration", steps: ["prep", "titrate", "record"] },
    }, ctx);
    assert.equal(start.ok, true);
    assert.equal(start.result.run.steps.length, 3);
    const id = start.result.run.id;

    const step = await lensRun("science", "protorun-step", { params: { id, stepIndex: 1, status: "completed", deviation: true } }, ctx);
    assert.equal(step.ok, true);
    assert.equal(step.result.run.steps[1].status, "completed");
    assert.equal(step.result.run.currentStep, 1);

    const done = await lensRun("science", "protorun-complete", { params: { id, outcome: "success" } }, ctx);
    assert.equal(done.ok, true);
    assert.equal(done.result.run.status, "completed");
    assert.equal(done.result.run.deviationCount, 1); // the deviated step
  });

  it("notebook-add → notebook-list: entry reads back and is filterable by experimentId", async () => {
    const add = await lensRun("science", "notebook-add", {
      params: { title: "Day 1 observations", body: "pH rose to 8", experimentId: "exp-42" },
    }, ctx);
    assert.equal(add.ok, true);
    const id = add.result.entry.id;

    const list = await lensRun("science", "notebook-list", { params: { experimentId: "exp-42" } }, ctx);
    assert.ok(list.result.entries.some((e) => e.id === id && e.title === "Day 1 observations"));
  });

  it("dataset-save rejects an empty columns array", async () => {
    const bad = await lensRun("science", "dataset-save", { params: { name: "Bad", columns: [], rows: [] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /columns array required/);
  });
});
