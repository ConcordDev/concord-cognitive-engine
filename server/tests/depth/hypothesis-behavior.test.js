// tests/depth/hypothesis-behavior.test.js — REAL behavioral tests for the
// hypothesis domain (registerLensAction family, invoked via lensRun). The
// statistics are all genuine computations, so every case below pins an
// exact expected value derived by hand from the source math, plus CRUD
// round-trips (dataset import/list/get/delete; registry preregister/list/
// recordOutcome/delete) sharing one ctx.
//
// Wrapping note (verified against server.js lens.run @ 37511-37517): a handler
// that returns { ok:true, result } is UNWRAPPED, so a SUCCESS surfaces at
// r.ok===true / r.result.<field>; a handler refusal ({ok:false,error}) has no
// `result` key so it passes through whole — r.result.ok===false / r.result.error.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

const approx = (a, b, eps = 1e-3) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (±${eps})`);

describe("hypothesis — classical test battery (exact computed values)", () => {
  it("zTest one-sample: z, effect size, standard error", async () => {
    // se = 15/sqrt(25) = 3 ; z = (105-100)/3 = 1.66667 ; d = |105-100|/15 = 0.33333
    const r = await lensRun("hypothesis", "zTest", {
      data: { sample: { mean: 105, stdDev: 15, n: 25 }, populationMean: 100 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.testType, "one-sample");
    approx(r.result.standardError, 3);
    approx(r.result.zStatistic, 1.66667);
    approx(r.result.effectSize, 0.33333);
    assert.equal(r.result.effectMagnitude, "small"); // 0.2 <= d < 0.5
    assert.equal(r.result.reject, false);            // p ≈ 0.0956 > 0.05
  });

  it("zTest: missing sample → handler refusal", async () => {
    const r = await lensRun("hypothesis", "zTest", { data: {} });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("sample data required"));
  });

  it("abTest: pooled-z statistic and significance", async () => {
    // pC=0.1 pV=0.13 ; pooled=230/2000=0.115 ; se=sqrt(0.115*0.885*0.002)=0.0142671
    // z = 0.03 / 0.0142671 = 2.10275
    const r = await lensRun("hypothesis", "abTest", {
      data: {
        control: { visitors: 1000, conversions: 100 },
        variant: { visitors: 1000, conversions: 130 },
      },
    });
    assert.equal(r.ok, true);
    approx(r.result.zStatistic, 2.10275, 1e-3);
    assert.equal(r.result.significant, true);          // p ≈ 0.0355 < 0.05
    assert.equal(r.result.relativeUplift, "30%");       // (0.13-0.1)/0.1 = 30%
    assert.equal(r.result.absoluteDifference, "3 pp");  // (0.13-0.1)*100
  });

  it("bayesianInference (Beta-Binomial): posterior params, mean and mode", async () => {
    // prior Beta(1,1), obs 8/10 → failures 2 → posterior Beta(9,3)
    // mean = 9/12 = 0.75 ; mode = (9-1)/(12-2) = 0.8
    const r = await lensRun("hypothesis", "bayesianInference", {
      data: { prior: { distribution: "beta", alpha: 1, beta: 1 },
              observations: { successes: 8, trials: 10 } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.posterior.alpha, 9);
    assert.equal(r.result.posterior.beta, 3);
    approx(r.result.posterior.mean, 0.75);
    approx(r.result.posterior.mode, 0.8);
    assert.equal(r.result.likelihood.failures, 2);
  });

  it("tTest paired: t-statistic and df on hand-checked diffs", async () => {
    // diffs = [1,1,2] ; md = 4/3 = 1.33333 ; vd = 0.66667/2 = 0.33333
    // se = sqrt(0.33333/3) = 0.33333 ; t = md/se = 4.0 ; df = 2
    const r = await lensRun("hypothesis", "tTest", {
      params: { sample1: [5, 6, 7], sample2: [4, 5, 5], paired: true },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.testType, "paired");
    approx(r.result.meanDifference, 1.33333);
    approx(r.result.tStatistic, 4.0, 1e-3);
    assert.equal(r.result.degreesOfFreedom, 2);
  });

  it("tTest two-sample (pooled): t, df and Cohen's d", async () => {
    // s1=[1..5] m=3 v=2.5 ; s2=[3..7] m=5 v=2.5 ; mDiff=-2
    // pooledVar=2.5 ; se=sqrt(2.5*0.4)=1 ; t=-2 ; df=8 ; d=2/sqrt(2.5)=1.26491
    const r = await lensRun("hypothesis", "tTest", {
      params: { sample1: [1, 2, 3, 4, 5], sample2: [3, 4, 5, 6, 7], kind: "two-sample" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.testType, "two-sample");
    approx(r.result.tStatistic, -2.0);
    assert.equal(r.result.degreesOfFreedom, 8);
    approx(r.result.standardError, 1.0);
    approx(r.result.effectSize, 1.26491, 1e-3);
    assert.equal(r.result.effectMagnitude, "large");
  });

  it("tTest: too-few values → handler refusal", async () => {
    const r = await lensRun("hypothesis", "tTest", { params: { sample1: [1] } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("at least 2"));
  });

  it("anova: F-statistic, sums of squares, eta-squared", async () => {
    // groups means 2,5,8 ; grand=5 ; ssBetween=54 ; ssWithin=6 ; F=27/1=27 ; eta²=54/60=0.9
    const r = await lensRun("hypothesis", "anova", {
      params: { groups: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] },
    });
    assert.equal(r.ok, true);
    approx(r.result.sumOfSquares.between, 54);
    approx(r.result.sumOfSquares.within, 6);
    approx(r.result.fStatistic, 27);
    approx(r.result.etaSquared, 0.9);
    assert.equal(r.result.degreesOfFreedom.between, 2);
    assert.equal(r.result.degreesOfFreedom.within, 6);
    assert.equal(r.result.reject, true);
  });

  it("chiSquare goodness-of-fit: chi2 against uniform expectation", async () => {
    // observed [10,20,30,40] total 100 ; expected 25 each
    // chi2 = (225+25+25+225)/25 = 20 ; df = 3
    const r = await lensRun("hypothesis", "chiSquare", {
      params: { observed: [10, 20, 30, 40] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.testType, "goodness-of-fit");
    approx(r.result.chiSquare, 20);
    assert.equal(r.result.degreesOfFreedom, 3);
    assert.equal(r.result.reject, true); // p ≈ 0.00017
  });

  it("chiSquare independence: chi2 and Cramér's V on a 2x2 table", async () => {
    // table [[10,20],[20,10]] ; all expected = 15 ; chi2 = 4*(25/15) = 6.66667 ; df=1
    // V = sqrt(6.66667/(60*1)) = 0.33333
    const r = await lensRun("hypothesis", "chiSquare", {
      params: { table: [[10, 20], [20, 10]] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.testType, "independence");
    approx(r.result.chiSquare, 6.66667);
    assert.equal(r.result.degreesOfFreedom, 1);
    approx(r.result.cramersV, 0.33333);
  });

  it("correlation: perfect positive linear relationship", async () => {
    const r = await lensRun("hypothesis", "correlation", {
      params: { x: [1, 2, 3, 4, 5], y: [2, 4, 6, 8, 10] },
    });
    assert.equal(r.ok, true);
    approx(r.result.pearson, 1);
    approx(r.result.spearman, 1);
    approx(r.result.rSquared, 1);
    assert.equal(r.result.direction, "positive");
    assert.equal(r.result.strength, "very strong");
  });

  it("regression (OLS): slope, intercept and R² on an exact line", async () => {
    // y = 2x ; slope=2 intercept=0 R²=1
    const r = await lensRun("hypothesis", "regression", {
      params: { x: [1, 2, 3, 4, 5], y: [2, 4, 6, 8, 10] },
    });
    assert.equal(r.ok, true);
    approx(r.result.slope, 2);
    approx(r.result.intercept, 0);
    approx(r.result.rSquared, 1);
    approx(r.result.sumOfSquares.residual, 0);
  });

  it("powerAnalysis (sampleSize): closed-form n for d=0.5, power=0.8", async () => {
    // n = ceil(((z_.975 + z_.8)/0.5)^2) = ceil(((1.95996+0.84162)/0.5)^2) = ceil(31.395) = 32
    const r = await lensRun("hypothesis", "powerAnalysis", {
      params: { solve: "sampleSize", effectSize: 0.5, power: 0.8, alpha: 0.05 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.requiredN, 32);
    assert.equal(r.result.totalForTwoGroups, 64);
    assert.equal(r.result.effectMagnitude, "medium");
  });

  it("multipleComparison: Bonferroni + Holm adjusted p-values", async () => {
    // p=[0.01,0.04,0.03] m=3 ; bonf=[0.03,0.12,0.09]
    // holm: sorted [0.01,0.03,0.04] -> adj 0.03,0.06,0.06 mapped back [0.03,0.06,0.06]
    const r = await lensRun("hypothesis", "multipleComparison", {
      params: { pValues: [0.01, 0.04, 0.03], alpha: 0.05 },
    });
    assert.equal(r.ok, true);
    approx(r.result.tests[0].bonferroniP, 0.03);
    approx(r.result.tests[1].bonferroniP, 0.12);
    approx(r.result.tests[2].bonferroniP, 0.09);
    approx(r.result.tests[0].holmP, 0.03);
    approx(r.result.tests[1].holmP, 0.06);
    approx(r.result.tests[2].holmP, 0.06);
    assert.equal(r.result.summary.rawSignificant, 3);
    assert.equal(r.result.summary.bonferroniSignificant, 1);
    assert.equal(r.result.summary.holmSignificant, 1);
  });

  it("multipleComparison: p-value out of [0,1] → handler refusal", async () => {
    const r = await lensRun("hypothesis", "multipleComparison", {
      params: { pValues: [0.5, 1.5] },
    });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("[0, 1]"));
  });
});

describe("hypothesis — dataset CRUD round-trip (shared ctx)", () => {
  let ctx;
  let dsId;
  before(async () => { ctx = await depthCtx("depth:hypothesis-ds"); });

  it("datasetImport: parses CSV, infers numeric vs categorical columns", async () => {
    const csv = "age,group\n30,a\n40,a\n50,b\n60,b";
    const r = await lensRun("hypothesis", "datasetImport", {
      params: { name: "demo", csv },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.rowCount, 4);
    assert.equal(r.result.columnCount, 2);
    const ageCol = r.result.columns.find(c => c.name === "age");
    const groupCol = r.result.columns.find(c => c.name === "group");
    assert.equal(ageCol.type, "numeric");
    assert.equal(groupCol.type, "categorical");
    approx(ageCol.stats.mean, 45);            // (30+40+50+60)/4
    assert.equal(ageCol.stats.min, 30);
    assert.equal(ageCol.stats.max, 60);
    assert.equal(groupCol.stats.distinct, 2); // a, b
    dsId = r.result.id;
  });

  it("datasetList: the imported dataset is now listed for this user", async () => {
    const r = await lensRun("hypothesis", "datasetList", {}, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 1);
    assert.ok(r.result.datasets.some(d => d.id === dsId && d.name === "demo"));
  });

  it("datasetGet: returns full columns + values for the dataset", async () => {
    const r = await lensRun("hypothesis", "datasetGet", { params: { id: dsId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.name, "demo");
    assert.equal(r.result.columns.length, 2);
  });

  it("runTestOnDataset (anova): groups the numeric column by the categorical column", async () => {
    // group a -> [30,40] mean 35 ; group b -> [50,60] mean 55
    const r = await lensRun("hypothesis", "runTestOnDataset", {
      params: { datasetId: dsId, test: "anova", groupColumn: "group", valueColumn: "age" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.groups.length, 2);
    approx(r.result.grandMean, 45);
  });

  it("datasetDelete: removes the dataset; subsequent get refuses", async () => {
    const del = await lensRun("hypothesis", "datasetDelete", { params: { id: dsId } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, dsId);
    const after = await lensRun("hypothesis", "datasetGet", { params: { id: dsId } }, ctx);
    assert.equal(after.result.ok, false);
    assert.ok(after.result.error.includes("not found"));
  });

  it("datasetGet: unknown id → handler refusal", async () => {
    const r = await lensRun("hypothesis", "datasetGet", { params: { id: "nope" } }, ctx);
    assert.equal(r.result.ok, false);
  });
});

describe("hypothesis — pre-registration registry round-trip (shared ctx)", () => {
  let ctx;
  let pregId;
  before(async () => { ctx = await depthCtx("depth:hypothesis-reg"); });

  it("preregister: stores the hypothesis with defaults", async () => {
    const r = await lensRun("hypothesis", "preregister", {
      params: { statement: "Treatment raises score", predictedDirection: "greater", alpha: 0.01 },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.statement, "Treatment raises score");
    assert.equal(r.result.predictedDirection, "greater");
    assert.equal(r.result.alpha, 0.01);
    assert.equal(r.result.status, "registered");
    assert.equal(r.result.outcome, null);
    pregId = r.result.id;
  });

  it("preregister: empty statement → handler refusal", async () => {
    const r = await lensRun("hypothesis", "preregister", { params: { statement: "   " } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("statement is required"));
  });

  it("recordOutcome: a rejecting result in the predicted direction is 'confirmed'", async () => {
    const r = await lensRun("hypothesis", "recordOutcome", {
      params: { id: pregId, reject: true, pValue: 0.004, observedDirection: "greater" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "resolved");
    assert.equal(r.result.outcome.verdict, "confirmed");
    assert.equal(r.result.outcome.predictionConfirmed, true);
    approx(r.result.outcome.pValue, 0.004);
  });

  it("registryList: reflects the resolved/confirmed status in its counts", async () => {
    const r = await lensRun("hypothesis", "registryList", {}, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 1);
    assert.ok(r.result.counts.confirmed >= 1);
  });

  it("recordOutcome: a non-rejecting result is 'refuted' regardless of direction", async () => {
    const pre = await lensRun("hypothesis", "preregister", {
      params: { statement: "Drug shrinks tumor", predictedDirection: "less" },
    }, ctx);
    const id2 = pre.result.id;
    const r = await lensRun("hypothesis", "recordOutcome", {
      params: { id: id2, reject: false, pValue: 0.4 },
    }, ctx);
    assert.equal(r.result.outcome.verdict, "refuted");
    assert.equal(r.result.outcome.predictionConfirmed, false);
  });

  it("registryDelete: removes a pre-registration; re-delete refuses", async () => {
    const del = await lensRun("hypothesis", "registryDelete", { params: { id: pregId } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, pregId);
    const again = await lensRun("hypothesis", "registryDelete", { params: { id: pregId } }, ctx);
    assert.equal(again.result.ok, false);
  });
});
