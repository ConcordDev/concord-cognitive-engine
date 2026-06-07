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

describe("science — forensic / lab-integrity contracts (wave 13 top-up)", () => {
  it("chainOfCustody: a contiguous transfer chain is intact with zero gaps", async () => {
    const r = await lensRun("science", "chainOfCustody", {
      data: {
        chainOfCustody: [
          { receivedBy: "alice", transferredTo: "bob", date: "2026-01-01" },
          { receivedBy: "bob", transferredTo: "carol", date: "2026-01-02" },
          { receivedBy: "carol", transferredTo: "dan", date: "2026-01-03" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.intact, true);
    assert.equal(r.result.transfers, 3);
    assert.equal(r.result.gaps.length, 0);
  });

  it("chainOfCustody: a broken handoff is flagged with the exact expected/actual mismatch", async () => {
    // prev.transferredTo = "bob" but next.receivedBy = "eve" → gap at position 1
    const r = await lensRun("science", "chainOfCustody", {
      data: {
        chainOfCustody: [
          { receivedBy: "alice", transferredTo: "bob", date: "2026-01-01" },
          { receivedBy: "eve", transferredTo: "carol", date: "2026-01-02" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.intact, false);
    assert.equal(r.result.gaps.length, 1);
    assert.equal(r.result.gaps[0].position, 1);
    assert.equal(r.result.gaps[0].expected, "bob");
    assert.equal(r.result.gaps[0].actual, "eve");
  });

  it("calibrationCheck: a date far in the future reads 'current' with a positive day count", async () => {
    const future = new Date(Date.now() + 100 * 86400000).toISOString();
    const r = await lensRun("science", "calibrationCheck", {
      data: { calibrationDate: "2026-01-01", nextCalibration: future, serial: "SN-7" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "current");
    assert.equal(r.result.serial, "SN-7");
    // ceil over ~100 days → between 99 and 101 inclusive
    assert.ok(r.result.daysUntilDue >= 99 && r.result.daysUntilDue <= 101, `daysUntilDue=${r.result.daysUntilDue}`);
  });

  it("calibrationCheck: a past nextCalibration reads 'overdue' with a negative day count", async () => {
    const past = new Date(Date.now() - 10 * 86400000).toISOString();
    const r = await lensRun("science", "calibrationCheck", { data: { nextCalibration: past } });
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "overdue");
    assert.ok(r.result.daysUntilDue < 0, `daysUntilDue=${r.result.daysUntilDue}`);
  });

  it("calibrationCheck: a near-future date (≤14d) reads 'due_soon'", async () => {
    const soon = new Date(Date.now() + 5 * 86400000).toISOString();
    const r = await lensRun("science", "calibrationCheck", { data: { nextCalibration: soon } });
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "due_soon");
  });

  it("sampleAudit: a temperature deviation beyond tolerance produces a non-compliant sample", async () => {
    // required 4°C, actual 10°C, tolerance 2 → |10-4|=6 > 2 → deviation
    const r = await lensRun("science", "sampleAudit", {
      data: { samples: [{ sampleId: "S1", storage: { requiredTemp: 4, actualTemp: 10, tolerance: 2 } }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalSamples, 1);
    assert.equal(r.result.nonCompliant, 1);
    assert.equal(r.result.samples[0].status, "non-compliant");
    assert.equal(r.result.samples[0].storageCompliant, false);
    assert.ok(r.result.samples[0].issues.some((i) => i.type === "temperature_deviation"));
  });

  it("sampleAudit: an in-tolerance, in-date, gloved sample is compliant with zero issues", async () => {
    const r = await lensRun("science", "sampleAudit", {
      data: { samples: [{
        sampleId: "S2",
        storage: { requiredTemp: 4, actualTemp: 5, tolerance: 2 },
        expiryDate: new Date(Date.now() + 86400000).toISOString(),
        handling: { requiresGloves: true, glovesUsed: true },
      }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.compliant, 1);
    assert.equal(r.result.samples[0].issueCount, 0);
    assert.equal(r.result.samples[0].status, "compliant");
  });

  it("validateProtocol: a protocol missing required steps + safety checks is needs_revision", async () => {
    const r = await lensRun("science", "validateProtocol", {
      data: { protocol: { name: "P1", steps: [{ name: "preparation" }, { name: "execution" }] } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.valid, false);
    assert.equal(r.result.status, "needs_revision");
    // missing data_collection + cleanup (2 high) + no safety checks (1 high) = 3 high
    assert.equal(r.result.highSeverityCount, 3);
    assert.ok(r.result.issues.some((i) => i.type === "missing_step" && i.step === "cleanup"));
  });

  it("validateProtocol: a complete protocol with verified safety is approved", async () => {
    const r = await lensRun("science", "validateProtocol", {
      data: { protocol: {
        name: "P2",
        steps: [{ name: "preparation" }, { name: "execution" }, { name: "data_collection" }, { name: "cleanup" }],
        safetyChecks: [{ verified: true }, { completed: true }],
      } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.valid, true);
    assert.equal(r.result.status, "approved");
    assert.equal(r.result.highSeverityCount, 0);
    assert.equal(r.result.safetyChecksVerified, 2);
  });
});

describe("science — geo / export contracts (wave 13 top-up)", () => {
  it("dataExport geojson: GPS observations become Point features ordered [lon,lat]", async () => {
    const r = await lensRunExport("geojson");
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "geojson");
    assert.equal(r.result.data.type, "FeatureCollection");
    assert.equal(r.result.data.features.length, 1); // only the GPS one
    assert.deepEqual(r.result.data.features[0].geometry.coordinates, [20, 10]); // [lon, lat]
    assert.equal(r.result.data.features[0].properties.type, "bird");
  });

  it("dataExport csv (default): passes the raw observations array through, record count exact", async () => {
    const r = await lensRunExport("csv");
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "csv");
    assert.equal(r.result.records, 2);
    assert.equal(r.result.data.length, 2);
  });

  it("spatialCluster: two near points merge into one cluster, a far point stands alone", async () => {
    // p0 (0,0) and p1 (~0.005,0) ≈ 0.55km apart → same 1km cluster.
    // p2 at (5,0) ≈ 555km away → its own cluster.
    const r = await lensRun("science", "spatialCluster", {
      data: { observations: [
        { gps: { lat: 0, lon: 0 } },
        { gps: { lat: 0, lon: 0.005 } },
        { gps: { lat: 5, lon: 0 } },
      ] },
      params: { radiusKm: 1 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalObservations, 3);
    assert.equal(r.result.clusters.length, 2);
    assert.equal(r.result.clusters[0].observations, 2); // p0 + p1
    assert.equal(r.result.clusters[1].observations, 1); // p2 alone
    assert.equal(r.result.radiusKm, 1);
  });
});

// helper for the dataExport tests — shared observations fixture
async function lensRunExport(format) {
  return lensRun("science", "dataExport", {
    data: { observations: [
      { gps: { lat: 10, lon: 20 }, date: "d1", type: "bird", observer: "obs", notes: "n" },
      { date: "d2", type: "no-gps" },
    ] },
    params: { format },
  });
}

describe("science — non-parametric + chart contracts (wave 13 top-up)", () => {
  it("stats-nonparametric mann-whitney: fully-separated samples give U=0 and report exact rank sum", async () => {
    // a=[1,2,3], b=[4,5,6]; combined ranks 1..6, group a ranks {1,2,3} → rankSumA=6.
    // u1 = 6 - (3*4/2) = 6 - 6 = 0; u2 = 3*3 - 0 = 9; U = min = 0.
    const r = await lensRun("science", "stats-nonparametric", { params: { test: "mann-whitney", a: [1, 2, 3], b: [4, 5, 6] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.test, "mann-whitney-u");
    assert.equal(r.result.rankSumA, 6);
    assert.equal(r.result.u1, 0);
    assert.equal(r.result.u2, 9);
    assert.equal(r.result.U, 0);
    assert.equal(r.result.medianA, 2);
    assert.equal(r.result.medianB, 5);
  });

  it("stats-nonparametric rejects an undersized sample", async () => {
    const bad = await lensRun("science", "stats-nonparametric", { params: { a: [1], b: [4, 5, 6] } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, />= 2 values/);
  });

  it("chart-render histogram: bins a numeric column and the counts sum to n", async () => {
    const r = await lensRun("science", "chart-render", {
      params: { kind: "histogram", columns: ["v"], rows: [[1], [2], [3], [4], [5], [6], [7], [8]], valueColumn: "v", bins: 4 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "histogram");
    assert.equal(r.result.n, 8);
    assert.equal(r.result.bins, 4);
    assert.equal(r.result.points.reduce((s, b) => s + b.count, 0), 8);
  });

  it("chart-render box: exact quartiles + whiskers for a known column", async () => {
    // values 1..9: q2(median)=5, q1=3, q3=7, iqr=4, no outliers → whiskers at 1 and 9
    const r = await lensRun("science", "chart-render", {
      params: { kind: "box", columns: ["v"], rows: [[1], [2], [3], [4], [5], [6], [7], [8], [9]], valueColumn: "v" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "box");
    assert.equal(r.result.median, 5);
    assert.equal(r.result.q1, 3);
    assert.equal(r.result.q3, 7);
    assert.equal(r.result.whiskerLow, 1);
    assert.equal(r.result.whiskerHigh, 9);
    assert.equal(r.result.outliers.length, 0);
  });

  it("chart-render pie: category counts aggregate and sort by frequency desc", async () => {
    const r = await lensRun("science", "chart-render", {
      params: { kind: "pie", columns: ["c"], rows: [["a"], ["a"], ["b"], ["a"], ["b"]], categoryColumn: "c" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "pie");
    assert.equal(r.result.total, 5);
    assert.equal(r.result.slices[0].name, "a"); // most frequent first
    assert.equal(r.result.slices[0].count, 3);
    assert.equal(r.result.slices[1].count, 2);
  });

  it("chart-render rejects an unknown chart kind", async () => {
    const bad = await lensRun("science", "chart-render", {
      params: { kind: "donut", columns: ["v"], rows: [[1], [2]] },
    });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /kind must be one of/);
  });
});

describe("science — extended CRUD round-trips (wave 13 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("science-t13"); });

  it("dataset-update: full table replace round-trips through dataset-get", async () => {
    const save = await lensRun("science", "dataset-save", {
      params: { name: "Grid", columns: ["a"], rows: [[1]] },
    }, ctx);
    const id = save.result.dataset.id;
    const upd = await lensRun("science", "dataset-update", {
      params: { id, name: "Grid v2", columns: ["a", "b"], rows: [[1, 2], [3, 4]] },
    }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.dataset.name, "Grid v2");
    const got = await lensRun("science", "dataset-get", { params: { id } }, ctx);
    assert.deepEqual(got.result.dataset.columns, ["a", "b"]);
    assert.deepEqual(got.result.dataset.rows, [[1, 2], [3, 4]]);
  });

  it("dataset-delete: removes a dataset so a subsequent get reports not found", async () => {
    const save = await lensRun("science", "dataset-save", { params: { name: "Temp", columns: ["x"], rows: [] } }, ctx);
    const id = save.result.dataset.id;
    const del = await lensRun("science", "dataset-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
    const got = await lensRun("science", "dataset-get", { params: { id } }, ctx);
    assert.equal(got.result.ok, false);
    assert.match(got.result.error, /not found/);
  });

  it("notebook-update → notebook-list: edited title reads back", async () => {
    const add = await lensRun("science", "notebook-add", { params: { title: "Draft", body: "x", experimentId: "e-13" } }, ctx);
    const id = add.result.entry.id;
    const upd = await lensRun("science", "notebook-update", { params: { id, title: "Final", body: "edited" } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.entry.title, "Final");
    const list = await lensRun("science", "notebook-list", { params: { experimentId: "e-13" } }, ctx);
    assert.ok(list.result.entries.some((e) => e.id === id && e.title === "Final" && e.body === "edited"));
  });

  it("notebook-delete: a deleted entry no longer appears in the list", async () => {
    const add = await lensRun("science", "notebook-add", { params: { title: "Scratch", experimentId: "e-del" } }, ctx);
    const id = add.result.entry.id;
    const del = await lensRun("science", "notebook-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    const list = await lensRun("science", "notebook-list", { params: { experimentId: "e-del" } }, ctx);
    assert.equal(list.result.entries.some((e) => e.id === id), false);
  });

  it("protorun-list → protorun-delete: a started run appears then disappears", async () => {
    const start = await lensRun("science", "protorun-start", { params: { protocolName: "Assay", steps: ["a", "b"] } }, ctx);
    const id = start.result.run.id;
    const list = await lensRun("science", "protorun-list", {}, ctx);
    assert.ok(list.result.runs.some((r) => r.id === id));
    const del = await lensRun("science", "protorun-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    const list2 = await lensRun("science", "protorun-list", {}, ctx);
    assert.equal(list2.result.runs.some((r) => r.id === id), false);
  });

  it("reagent-list → reagent-delete: a low-stock reagent is counted then removed", async () => {
    const save = await lensRun("science", "reagent-save", { params: { name: "Buffer", quantity: 1, reorderThreshold: 5 } }, ctx);
    const id = save.result.reagent.id;
    const list = await lensRun("science", "reagent-list", {}, ctx);
    assert.ok(list.result.reagents.some((r) => r.id === id && r.lowStock === true));
    assert.ok(list.result.lowStockCount >= 1);
    const del = await lensRun("science", "reagent-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    const list2 = await lensRun("science", "reagent-list", {}, ctx);
    assert.equal(list2.result.reagents.some((r) => r.id === id), false);
  });

  it("reagent-consume rejects a zero / negative amount", async () => {
    const save = await lensRun("science", "reagent-save", { params: { name: "Saline", quantity: 5 } }, ctx);
    const bad = await lensRun("science", "reagent-consume", { params: { id: save.result.reagent.id, amount: 0 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /amount must be > 0/);
  });
});

describe("science — publication export (wave 13 top-up)", () => {
  it("publication-export markdown: bundles title/authors/sections + exact figure & word counts", async () => {
    const r = await lensRun("science", "publication-export", {
      params: {
        title: "On Foo",
        authors: ["Ada", "Babbage"],
        abstract: "two words",      // 2 words
        methods: "three methods here", // 3 words
        results: "one",             // 1 word → total 6
        figures: [{ caption: "Fig A", chartKind: "bar" }, { caption: "Fig B" }],
        format: "markdown",
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "markdown");
    assert.equal(r.result.figureCount, 2);
    assert.equal(r.result.wordCount, 6);
    assert.equal(r.result.filename, "on-foo.md");
    assert.match(r.result.bundle, /# On Foo/);
    assert.match(r.result.bundle, /\*\*Authors:\*\* Ada, Babbage/);
  });

  it("publication-export json: returns a structured bundle with figures preserved", async () => {
    const r = await lensRun("science", "publication-export", {
      params: { title: "JSON Paper", authors: ["X"], figures: [{ caption: "f1" }], format: "json" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "json");
    assert.equal(r.result.bundle.title, "JSON Paper");
    assert.equal(r.result.bundle.figures.length, 1);
    assert.equal(r.result.filename, "json-paper.json");
  });

  it("publication-export rejects a missing title", async () => {
    const bad = await lensRun("science", "publication-export", { params: { authors: ["X"] } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title required/);
  });
});

describe("science — deeper stats branches (wave 13 top-up)", () => {
  it("stats-regression: noisy data reports residual std error + a slope CI bracketing the slope", async () => {
    // x=[1,2,3,4,5], y=[2,4,5,4,5]: sxx=10, my=4, sxy = sum(dx*dy):
    //   dx=[-2,-1,0,1,2], dy=[-2,0,1,0,1] → -2*-2 + -1*0 + 0 + 1*0 + 2*1 = 4+2 = 6.
    // slope = 6/10 = 0.6, intercept = 4 - 0.6*3 = 2.2.
    const r = await lensRun("science", "stats-regression", { params: { x: [1, 2, 3, 4, 5], y: [2, 4, 5, 4, 5] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.slope, 0.6);
    assert.equal(r.result.intercept, 2.2);
    // rSquared < 1 because there's residual; equation embeds the rounded slope/intercept
    assert.ok(r.result.rSquared > 0 && r.result.rSquared < 1, `rSquared=${r.result.rSquared}`);
    assert.equal(r.result.equation, "y = 0.6000x + 2.2000");
    assert.ok(r.result.residualStdError > 0, `residualStdError=${r.result.residualStdError}`);
    // 95% CI is symmetric about the slope by ± tCrit*seSlope
    const [lo, hi] = r.result.slopeCI95;
    assert.ok(lo < 0.6 && hi > 0.6, `CI [${lo},${hi}] should bracket slope`);
    assert.equal(Math.round((0.6 - lo) * 100000) / 100000, Math.round((hi - 0.6) * 100000) / 100000);
  });

  it("stats-anova: separated group means give a positive F, eta² in (0,1], and significance", async () => {
    // groups means 10, 20, 30; tight within-group spread → large F, significant.
    const r = await lensRun("science", "stats-anova", {
      params: { groups: [[10, 11, 9], [20, 21, 19], [30, 31, 29]] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.dfBetween, 2);
    assert.equal(r.result.dfWithin, 6);
    assert.ok(r.result.ssBetween > 0, `ssBetween=${r.result.ssBetween}`);
    assert.ok(r.result.fStatistic > 1, `F=${r.result.fStatistic}`);
    assert.ok(r.result.etaSquared > 0.9 && r.result.etaSquared <= 1, `eta²=${r.result.etaSquared}`);
    assert.equal(r.result.significantAt05, true);
    // grand mean 20 → middle group's reported mean is exactly 20
    assert.equal(r.result.groups[1].mean, 20);
  });

  it("stats-ci: standardError = sd/sqrt(n) and margin = tCritical*se exactly", async () => {
    // data [10,12,14,16,18]: mean=14, sample sd = sqrt(40/4)=sqrt(10)=3.1623, n=5, se=sd/sqrt5
    const r = await lensRun("science", "stats-ci", { params: { data: [10, 12, 14, 16, 18], confidence: 0.95 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.mean, 14);
    assert.equal(r.result.sd, 3.1623);
    const expectedSe = Math.round((Math.sqrt(10) / Math.sqrt(5)) * 10000) / 10000;
    assert.equal(r.result.standardError, expectedSe);
    // margin == tCritical * standardError, reconstructed from the reported (rounded)
    // values to within a 1e-3 tolerance (the source multiplies the UNROUNDED tCrit·se,
    // so reconstructing from rounded fields carries ≤1 ulp of accumulated rounding).
    assert.ok(Math.abs(r.result.marginOfError - r.result.tCritical * r.result.standardError) < 1e-3,
      `margin=${r.result.marginOfError} vs tCrit*se=${r.result.tCritical * r.result.standardError}`);
    assert.ok(r.result.tCritical > 2 && r.result.tCritical < 3, `tCrit=${r.result.tCritical}`); // df=4, ~2.776
    // df=4 95% two-sided tCritical ≈ 2.7764
    assert.equal(r.result.tCritical, 2.7764);
  });

  it("stats-ci rejects a confidence outside (0,1)", async () => {
    const bad = await lensRun("science", "stats-ci", { params: { data: [1, 2, 3], confidence: 1.5 } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /confidence must be between 0 and 1/);
  });

  it("stats-nonparametric mann-whitney: tied values average ranks correctly", async () => {
    // a=[1,3], b=[2,3]; sorted by v: 1(a),2(b),3(a),3(b). The two 3s share ranks 3,4 → avg 3.5.
    // rankSumA = rank(1)+rank(3a) = 1 + 3.5 = 4.5. u1 = 4.5 - (2*3/2)=4.5-3=1.5; u2 = 4-1.5=2.5; U=1.5.
    const r = await lensRun("science", "stats-nonparametric", { params: { test: "mann-whitney", a: [1, 3], b: [2, 3] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.rankSumA, 4.5);
    assert.equal(r.result.u1, 1.5);
    assert.equal(r.result.u2, 2.5);
    assert.equal(r.result.U, 1.5);
    assert.equal(r.result.medianA, 2); // (1+3)/2
    assert.equal(r.result.medianB, 2.5); // (2+3)/2
  });

  it("stats-nonparametric rejects an unknown test name", async () => {
    const bad = await lensRun("science", "stats-nonparametric", { params: { test: "kruskal", a: [1, 2], b: [3, 4] } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /test must be mann-whitney/);
  });

  it("stats-ttest one-sample rejects a missing mu", async () => {
    const bad = await lensRun("science", "stats-ttest", { params: { kind: "one-sample", a: [1, 2, 3] } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /mu required/);
  });

  it("stats-ttest rejects an undersized sample a", async () => {
    const bad = await lensRun("science", "stats-ttest", { params: { a: [1], b: [4, 5, 6] } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /sample a needs >= 2/);
  });

  it("stats-correlation rejects fewer than 3 paired values", async () => {
    const bad = await lensRun("science", "stats-correlation", { params: { x: [1, 2], y: [2, 4] } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, />= 3 paired/);
  });
});

describe("science — chart x/y series + quality detail (wave 13 top-up)", () => {
  it("chart-render scatter: builds one point per row with numeric x/y coercion", async () => {
    const r = await lensRun("science", "chart-render", {
      params: { kind: "scatter", columns: ["x", "y"], rows: [[1, 10], [2, 20], [3, 30]], xColumn: "x", yColumn: "y" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "scatter");
    assert.equal(r.result.xKey, "x");
    assert.equal(r.result.n, 3);
    assert.equal(r.result.points.length, 3);
    assert.deepEqual(r.result.points[1], { x: 2, y: 20 });
    assert.ok(r.result.series.some((sr) => sr.key === "y"));
  });

  it("chart-render bar: multi-y series exposes a series entry per y column", async () => {
    const r = await lensRun("science", "chart-render", {
      params: { kind: "bar", columns: ["g", "p", "q"], rows: [["a", 1, 2], ["b", 3, 4]], xColumn: "g", yColumns: ["p", "q"] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.series.length, 2);
    assert.deepEqual(r.result.points[0], { g: "a", p: 1, q: 2 });
    assert.equal(r.result.points[1].q, 4);
  });

  it("chart-render rejects an empty rows array", async () => {
    const bad = await lensRun("science", "chart-render", { params: { kind: "bar", columns: ["v"], rows: [] } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /no rows/);
  });

  it("dataQualityReport: numeric sub-stats (median/q1/q3/stdDev) + qualityRating are exact", async () => {
    // temp column = 10,20,30,40,50 (n=5). sorted index floors: q1=idx1=20, median=idx2=30, q3=idx3=40.
    // mean=30, variance=200 (population), stdDev=sqrt(200)=14.142.
    const r = await lensRun("science", "dataQualityReport", {
      data: { records: [
        { temp: 10 }, { temp: 20 }, { temp: 30 }, { temp: 40 }, { temp: 50 },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.fieldStats.temp.numeric.mean, 30);
    assert.equal(r.result.fieldStats.temp.numeric.median, 30);
    assert.equal(r.result.fieldStats.temp.numeric.q1, 20);
    assert.equal(r.result.fieldStats.temp.numeric.q3, 40);
    assert.equal(r.result.fieldStats.temp.numeric.min, 10);
    assert.equal(r.result.fieldStats.temp.numeric.max, 50);
    assert.equal(r.result.fieldStats.temp.numeric.stdDev, 14.142);
    // fully present → 100% → excellent
    assert.equal(r.result.overallCompleteness, 100);
    assert.equal(r.result.qualityRating, "excellent");
  });

  it("dataQualityReport: poor completeness lowers the qualityRating", async () => {
    // one field, 1 present of 4 → 25% completeness → poor
    const r = await lensRun("science", "dataQualityReport", {
      data: { dataset: [{ v: 5 }, { v: null }, { v: null }, { v: null }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.fieldStats.v.completeness, 25);
    assert.equal(r.result.overallCompleteness, 25);
    assert.equal(r.result.qualityRating, "poor");
  });
});

describe("science — audit/protocol/export edge branches (wave 13 top-up)", () => {
  it("sampleAudit: a custody gap + expiry + missing-gloves stack into one non-compliant sample", async () => {
    const r = await lensRun("science", "sampleAudit", {
      data: { samples: [{
        sampleId: "S9",
        chainOfCustody: [
          { transferredTo: "bob", receivedBy: "alice" },
          { transferredTo: "carol", receivedBy: "eve" }, // gap: bob != eve
        ],
        expiryDate: new Date(Date.now() - 2 * 86400000).toISOString(), // expired
        handling: { requiresGloves: true, glovesUsed: false },
      }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.nonCompliant, 1);
    const s = r.result.samples[0];
    assert.equal(s.status, "non-compliant");
    assert.equal(s.custodyIntact, false);
    assert.equal(s.expired, true);
    assert.ok(s.issues.some((i) => i.type === "custody_gap" && i.expected === "bob" && i.actual === "eve"));
    assert.ok(s.issues.some((i) => i.type === "expired"));
    assert.ok(s.issues.some((i) => i.type === "handling"));
  });

  it("validateProtocol: overdue equipment calibration adds a high-severity calibration issue", async () => {
    const past = new Date(Date.now() - 30 * 86400000).toISOString();
    const r = await lensRun("science", "validateProtocol", {
      data: { protocol: {
        name: "Cal Test",
        steps: [{ name: "preparation" }, { name: "execution" }, { name: "data_collection" }, { name: "cleanup" }],
        safetyChecks: [{ verified: true }],
        equipment: [{ name: "Spectrometer", nextCalibration: past }],
      } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.valid, false); // calibration is high severity
    assert.equal(r.result.equipmentCount, 1);
    assert.ok(r.result.calibrationIssues.some((c) => c.equipment === "Spectrometer" && c.status === "overdue"));
    assert.ok(r.result.issues.some((i) => i.type === "calibration" && i.severity === "high"));
  });

  it("validateProtocol: an unverified safety check is a medium issue that doesn't block approval", async () => {
    const r = await lensRun("science", "validateProtocol", {
      data: { protocol: {
        name: "Soft",
        steps: [{ name: "preparation" }, { name: "execution" }, { name: "data_collection" }, { name: "cleanup" }],
        safetyChecks: [{ verified: false, completed: false }],
      } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.valid, true); // no high-severity issues → approved
    assert.equal(r.result.status, "approved");
    assert.equal(r.result.safetyChecksTotal, 1);
    assert.equal(r.result.safetyChecksVerified, 0);
    assert.ok(r.result.issues.some((i) => i.type === "safety" && i.severity === "medium"));
  });

  it("dataExport geojson: a gps point given as { lat, lng } maps lng → coordinates[0]", async () => {
    const r = await lensRun("science", "dataExport", {
      data: { observations: [{ gps: { lat: 7, lng: 42 }, type: "fox" }] },
      params: { format: "geojson" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.data.features.length, 1);
    assert.deepEqual(r.result.data.features[0].geometry.coordinates, [42, 7]); // [lng, lat]
    assert.equal(r.result.records, 1);
  });

  it("publication-export markdown: protocol runs + keywords render into the bundle", async () => {
    const r = await lensRun("science", "publication-export", {
      params: {
        title: "Run Paper",
        authors: ["Q"],
        keywords: ["alpha", "beta"],
        protocolRuns: [{ name: "Titration", outcome: "success" }],
        format: "markdown",
      },
    });
    assert.equal(r.ok, true);
    assert.match(r.result.bundle, /\*\*Keywords:\*\* alpha, beta/);
    assert.match(r.result.bundle, /### Protocol Runs/);
    assert.match(r.result.bundle, /- Titration: success/);
    assert.equal(r.result.filename, "run-paper.md");
  });

  it("publication-export rejects an unknown format", async () => {
    const bad = await lensRun("science", "publication-export", { params: { title: "X", format: "pdf" } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /format must be markdown \| json/);
  });
});

describe("science — reagent flags + dataset guards (wave 13 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("science-t13b"); });

  it("reagent-save: a past expiryDate flips the expired flag true", async () => {
    const past = new Date(Date.now() - 5 * 86400000).toISOString();
    const r = await lensRun("science", "reagent-save", {
      params: { name: "Old Stock", quantity: 8, reorderThreshold: 2, expiryDate: past },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.reagent.expired, true);
    assert.equal(r.result.reagent.lowStock, false); // 8 > 2
  });

  it("reagent-save: passing an existing id updates the same reagent in place", async () => {
    const first = await lensRun("science", "reagent-save", { params: { name: "Mutable", quantity: 4 } }, ctx);
    const id = first.result.reagent.id;
    const upd = await lensRun("science", "reagent-save", { params: { id, name: "Mutable", quantity: 99, unit: "g" } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.reagent.id, id); // same row
    assert.equal(upd.result.reagent.quantity, 99);
    assert.equal(upd.result.reagent.unit, "g");
  });

  it("reagent-save rejects a negative quantity", async () => {
    const bad = await lensRun("science", "reagent-save", { params: { name: "Neg", quantity: -3 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /quantity must be >= 0/);
  });

  it("reagent-save rejects a missing name", async () => {
    const bad = await lensRun("science", "reagent-save", { params: { quantity: 1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /name required/);
  });

  it("dataset-update on a missing id reports not found", async () => {
    const bad = await lensRun("science", "dataset-update", { params: { id: "ds_nope", name: "x" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not found/);
  });

  it("dataset-update rejects emptying the columns array", async () => {
    const save = await lensRun("science", "dataset-save", { params: { name: "Keep", columns: ["a"], rows: [[1]] } }, ctx);
    const bad = await lensRun("science", "dataset-update", { params: { id: save.result.dataset.id, columns: [] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /columns must be a non-empty array/);
  });

  it("protorun-step rejects an out-of-range stepIndex", async () => {
    const start = await lensRun("science", "protorun-start", { params: { protocolName: "Bound", steps: ["one"] } }, ctx);
    const bad = await lensRun("science", "protorun-step", { params: { id: start.result.run.id, stepIndex: 9 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /valid stepIndex required/);
  });

  it("notebook-add rejects a missing title", async () => {
    const bad = await lensRun("science", "notebook-add", { params: { body: "no title" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title required/);
  });
});
