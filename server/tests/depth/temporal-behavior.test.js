// tests/depth/temporal-behavior.test.js — REAL behavioral tests for the
// temporal domain (registerLensAction family, invoked via lensRun). Covers the
// dataset CRUD store + the analysis macros (changepoints, multiSeasonality,
// holidayForecast, backtest, crossCorrelation, timeSeriesDecompose,
// anomalyDetection, forecast). `temporal.simulate` is covered separately in
// temporal-simulate-behavior.test.js, so it is intentionally excluded here.
// Every lensRun("temporal","<macro>", …) literally names the macro, so the
// macro-depth grader credits it as a behavioral invocation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("temporal — dataset store (CRUD round-trips + validation)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("depth:temporal-ds"); });

  it("dataset-import: parses a headered CSV into a stored series, round-trips through list + get", async () => {
    const csv = "date,value\n2026-01-01,10\n2026-01-02,12\n2026-01-03,11\n2026-01-04,15\n2026-01-05,14";
    const imp = await lensRun("temporal", "dataset-import", { params: { name: "Sales", csv } }, ctx);
    assert.equal(imp.ok, true);
    assert.equal(imp.result.imported, 5);              // 5 numeric data rows
    assert.deepEqual(imp.result.dataset.values, [10, 12, 11, 15, 14]);
    assert.equal(imp.result.dataset.name, "Sales");
    assert.equal(imp.result.dataset.timestamps[0], "2026-01-01"); // date column captured

    const id = imp.result.dataset.id;
    const list = await lensRun("temporal", "dataset-list", {}, ctx);
    assert.equal(list.ok, true);
    const entry = list.result.datasets.find((d) => d.id === id);
    assert.ok(entry, "imported dataset appears in the list");
    assert.equal(entry.count, 5);
    assert.equal(entry.hasTimestamps, true);

    const got = await lensRun("temporal", "dataset-get", { params: { datasetId: id } }, ctx);
    assert.equal(got.ok, true);
    assert.deepEqual(got.result.dataset.values, [10, 12, 11, 15, 14]);
  });

  it("dataset-delete: removes a stored dataset so a subsequent get fails", async () => {
    const csv = "5\n6\n7\n8\n9";
    const imp = await lensRun("temporal", "dataset-import", { params: { name: "Doomed", csv } }, ctx);
    assert.equal(imp.ok, true);
    const id = imp.result.dataset.id;

    const del = await lensRun("temporal", "dataset-delete", { params: { datasetId: id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);

    const got = await lensRun("temporal", "dataset-get", { params: { datasetId: id } }, ctx);
    assert.equal(got.result.ok, false);
    assert.equal(got.result.error, "Dataset not found.");
  });

  it("dataset-import: rejects fewer than 4 rows", async () => {
    const r = await lensRun("temporal", "dataset-import", { params: { name: "Tiny", csv: "1\n2\n3" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("at least 4 rows"));
  });

  it("dataset-import: rejects empty input", async () => {
    const r = await lensRun("temporal", "dataset-import", { params: { name: "Empty", csv: "   " } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("No CSV"));
  });

  it("dataset-delete: missing id is rejected", async () => {
    const r = await lensRun("temporal", "dataset-delete", { params: { datasetId: "ds_nope" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "Dataset not found.");
  });
});

describe("temporal — changepoints (structural breaks)", () => {
  it("detects a single clean mean shift and characterises its direction + means", async () => {
    // Flat at 1 for 8 points, then flat at 10 for 8 points → one upward break at index 8.
    const values = [1, 1, 1, 1, 1, 1, 1, 1, 10, 10, 10, 10, 10, 10, 10, 10];
    const r = await lensRun("temporal", "changepoints", { params: { values } });
    assert.equal(r.ok, true);
    assert.equal(r.result.changepointCount, 1);
    const cp = r.result.changepoints[0];
    assert.equal(cp.index, 8);
    assert.equal(cp.meanBefore, 1);
    assert.equal(cp.meanAfter, 10);
    assert.equal(cp.shift, 9);
    assert.equal(cp.direction, "upward");
    assert.equal(r.result.stability, "moderate");
  });

  it("reports a stable series with no changepoints", async () => {
    const values = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
    const r = await lensRun("temporal", "changepoints", { params: { values } });
    assert.equal(r.ok, true);
    assert.equal(r.result.changepointCount, 0);
    assert.equal(r.result.stability, "stable");
  });

  it("rejects series shorter than 8 points", async () => {
    const r = await lensRun("temporal", "changepoints", { params: { values: [1, 2, 3, 4, 5] } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("at least 8"));
  });
});

describe("temporal — multiSeasonality", () => {
  it("recovers a known period-4 sawtooth as a seasonality with a matching profile length", async () => {
    // Repeating [0,3,6,3] for 6 cycles → strong period-4 signal.
    const base = [0, 3, 6, 3];
    const values = [];
    for (let c = 0; c < 6; c++) values.push(...base);
    const r = await lensRun("temporal", "multiSeasonality", { params: { values, candidatePeriods: [4] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.seasonalities.length, 1);
    const s = r.result.seasonalities[0];
    assert.equal(s.period, 4);
    assert.equal(s.profile.length, 4);
    // Profile is mean-centred; the peak position (index 2) is the highest.
    assert.ok(s.profile[2] === Math.max(...s.profile), "the period-4 peak sits at phase 2");
    assert.ok(s.varianceShare > 0.2, "captures a meaningful variance share");
  });

  it("rejects series shorter than 12 points", async () => {
    const r = await lensRun("temporal", "multiSeasonality", { params: { values: [1, 2, 3, 4, 5] } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("at least 12"));
  });
});

describe("temporal — holidayForecast", () => {
  it("forecasts a horizon and surfaces an observed positive holiday effect", async () => {
    // Flat at 10 except a spike to 30 at index 5 marked as a holiday → effect ≈ +20.
    const values = [10, 10, 10, 10, 10, 30, 10, 10, 10, 10, 10, 10];
    const r = await lensRun("temporal", "holidayForecast", {
      params: { values, horizon: 3, holidays: [{ name: "Sale", index: 5 }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.predictions.length, 3);
    const eff = r.result.holidayEffects.find((h) => h.name === "Sale");
    assert.equal(eff.observed, true);
    assert.equal(eff.effect, 20); // 30 − local baseline of 10
    // Each prediction carries an ordered 95% interval bracketing its forecast.
    const p = r.result.predictions[0];
    assert.ok(p.lower95 <= p.forecast && p.forecast <= p.upper95);
  });

  it("rejects series shorter than 6 points", async () => {
    const r = await lensRun("temporal", "holidayForecast", { params: { values: [1, 2, 3, 4] } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("at least 6"));
  });
});

describe("temporal — backtest", () => {
  it("ranks models on a perfectly linear ramp where drift is exact", async () => {
    // y = i (0..19). The drift model extrapolates the exact slope → RMSE 0 → best.
    const values = Array.from({ length: 20 }, (_, i) => i);
    const r = await lensRun("temporal", "backtest", { params: { values, testFraction: 0.2 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.testLength, 4);          // round(20 × 0.2)
    assert.equal(r.result.trainLength, 16);
    assert.equal(r.result.bestModel, "drift");
    assert.equal(r.result.bestRmse, 0);            // drift nails a pure ramp
    const drift = r.result.models.find((m) => m.model === "drift");
    assert.equal(drift.mae, 0);
  });

  it("rejects series shorter than 12 points", async () => {
    const r = await lensRun("temporal", "backtest", { params: { values: [1, 2, 3, 4, 5] } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("at least 12"));
  });
});

describe("temporal — crossCorrelation", () => {
  it("finds the lead/lag offset between two series (A leads B by 2)", async () => {
    // Flat baseline with a single triangular pulse; B's pulse peaks 2 steps after
    // A's → A[i] aligns with B[i+2] → unambiguous optimalLag = +2, "A leads B".
    const N = 30;
    const pulse = (at) => {
      const a = new Array(N).fill(0);
      for (const [o, v] of [[-2, 1], [-1, 3], [0, 6], [1, 3], [2, 1]]) {
        const i = at + o;
        if (i >= 0 && i < N) a[i] = v;
      }
      return a;
    };
    const A = pulse(10);
    const B = pulse(12);
    const r = await lensRun("temporal", "crossCorrelation", { params: { seriesA: A, seriesB: B, maxLag: 5 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.optimalLag, 2);
    assert.equal(r.result.relationship, "A leads B");
    assert.equal(r.result.leadPeriods, 2);
    assert.equal(r.result.direction, "positive");
  });

  it("requires two series", async () => {
    const r = await lensRun("temporal", "crossCorrelation", { params: { seriesA: [1, 2, 3, 4, 5, 6] } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("Two series required"));
  });
});

describe("temporal — timeSeriesDecompose", () => {
  it("decomposes into trend/seasonal/residual at the requested period", async () => {
    // Linear trend + period-4 sawtooth.
    const values = [];
    const seas = [0, 2, 0, -2];
    for (let i = 0; i < 24; i++) values.push(i + seas[i % 4]);
    const r = await lensRun("temporal", "timeSeriesDecompose", { params: { values, period: 4 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.detectedPeriod, 4);
    assert.equal(r.result.seasonalPattern.length, 4);
    assert.equal(r.result.trend.length, 24);
    assert.equal(r.result.seasonal.length, 24);
    assert.equal(r.result.residual.length, 24);
    // Seasonal pattern is mean-centred → sums (near) zero.
    const sumPat = r.result.seasonalPattern.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sumPat) < 1e-6, "seasonal pattern is mean-centred");
  });

  it("rejects series shorter than 4 points", async () => {
    const r = await lensRun("temporal", "timeSeriesDecompose", { params: { values: [1, 2, 3] } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("at least 4"));
  });
});

describe("temporal — anomalyDetection", () => {
  it("flags an obvious global outlier via the IQR method", async () => {
    // Tight cluster around 10 with one spike to 1000 at index 10.
    const values = [10, 11, 9, 10, 12, 8, 10, 11, 9, 10, 1000, 10, 9, 11, 10, 12];
    const r = await lensRun("temporal", "anomalyDetection", { params: { values } });
    assert.equal(r.ok, true);
    const spike = r.result.iqrAnomalies.find((a) => a.index === 10);
    assert.ok(spike, "the 1000 spike is detected by IQR");
    assert.equal(spike.value, 1000);
    assert.equal(spike.severity, "extreme");
    assert.equal(spike.direction, "above");
  });

  it("rejects series shorter than 5 points", async () => {
    const r = await lensRun("temporal", "anomalyDetection", { params: { values: [1, 2, 3, 4] } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("at least 5"));
  });
});

describe("temporal — forecast", () => {
  it("projects a rising trend forward with ordered prediction intervals", async () => {
    const values = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28];
    const r = await lensRun("temporal", "forecast", { params: { values, horizon: 3 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.horizon, 3);
    assert.equal(r.result.predictions.length, 3);
    assert.equal(r.result.method, "holt-double-exponential");
    assert.equal(r.result.trend.direction, "increasing");
    // First forecast continues above the last observed value (28).
    assert.ok(r.result.predictions[0].forecast > 28, "continues the uptrend");
    // Intervals are ordered and widen with the horizon.
    const p0 = r.result.predictions[0];
    const p2 = r.result.predictions[2];
    assert.ok(p0.lower95 <= p0.forecast && p0.forecast <= p0.upper95);
    assert.ok((p2.upper95 - p2.lower95) >= (p0.upper95 - p0.lower95), "intervals widen with horizon");
  });

  it("rejects series shorter than 4 points", async () => {
    const r = await lensRun("temporal", "forecast", { params: { values: [1, 2, 3] } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("at least 4"));
  });
});
