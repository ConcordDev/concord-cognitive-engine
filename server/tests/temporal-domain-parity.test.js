// Contract tests for server/domains/temporal.js — pure-compute time-series
// macros: dataset CRUD, decomposition, anomaly detection, forecasting,
// changepoints, multi-seasonality, holiday forecast, backtest, cross-correlation.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTemporalActions from "../domains/temporal.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`temporal.${name}`);
  if (!fn) throw new Error(`temporal.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerTemporalActions(register); });

// Fresh per-user STATE before every test so dataset CRUD is isolated.
beforeEach(() => {
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_t" }, userId: "user_t" };

// Deterministic synthetic series: linear trend + period-4 seasonality.
function syntheticSeries(n = 48) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(100 + i * 1.5 + 10 * Math.sin((i / 4) * 2 * Math.PI));
  }
  return out;
}

describe("temporal dataset CRUD", () => {
  it("imports a CSV with a header + date column", () => {
    const csv = "date,value\n2026-01-01,120\n2026-01-02,135\n2026-01-03,118\n2026-01-04,150\n2026-01-05,142";
    const r = call("dataset-import", ctxA, { name: "Sales", csv });
    assert.equal(r.ok, true);
    assert.equal(r.result.imported, 5);
    assert.equal(r.result.dataset.name, "Sales");
    assert.ok(Array.isArray(r.result.dataset.timestamps));
  });

  it("rejects too-short input", () => {
    const r = call("dataset-import", ctxA, { name: "X", csv: "1\n2" });
    assert.equal(r.ok, false);
  });

  it("lists, gets, and deletes datasets", () => {
    const csv = "10\n20\n30\n40\n50";
    const imp = call("dataset-import", ctxA, { name: "Bare", csv });
    const id = imp.result.dataset.id;

    const list = call("dataset-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);

    const got = call("dataset-get", ctxA, { datasetId: id });
    assert.equal(got.ok, true);
    assert.equal(got.result.dataset.count, 5);

    const del = call("dataset-delete", ctxA, { datasetId: id });
    assert.equal(del.ok, true);
    assert.equal(del.result.remaining, 0);
  });
});

describe("temporal.timeSeriesDecompose", () => {
  it("splits a series into trend / seasonal / residual", () => {
    const r = call("timeSeriesDecompose", ctxA, { values: syntheticSeries(), period: 4 });
    assert.equal(r.ok, true);
    assert.equal(r.result.detectedPeriod, 4);
    assert.equal(r.result.trend.length, 48);
    assert.equal(r.result.seasonal.length, 48);
    assert.equal(r.result.residual.length, 48);
    assert.ok(r.result.strength.trend >= 0 && r.result.strength.trend <= 1);
  });

  it("rejects an undersized series", () => {
    const r = call("timeSeriesDecompose", ctxA, { values: [1, 2] });
    assert.equal(r.ok, false);
  });
});

describe("temporal.anomalyDetection", () => {
  it("flags an injected spike", () => {
    const vals = syntheticSeries(40);
    vals[20] = 9999;
    const r = call("anomalyDetection", ctxA, { values: vals, threshold: 2.5 });
    assert.equal(r.ok, true);
    // A lone extreme value is robustly caught by the global IQR method
    // (the sliding z-score window can be inflated by the spike itself).
    assert.ok(r.result.iqrCount >= 1);
    assert.ok(r.result.iqrAnomalies.some((a) => a.index === 20));
    assert.equal(r.result.anomalyRateLabel !== undefined, true);
  });
});

describe("temporal.forecast", () => {
  it("projects horizon points with confidence intervals", () => {
    const r = call("forecast", ctxA, { values: syntheticSeries(), horizon: 8 });
    assert.equal(r.ok, true);
    assert.equal(r.result.predictions.length, 8);
    const p = r.result.predictions[0];
    assert.ok(p.lower95 <= p.forecast && p.forecast <= p.upper95);
    assert.ok(typeof r.result.accuracy.rmse === "number");
  });
});

describe("temporal.changepoints", () => {
  it("detects a structural mean shift", () => {
    const vals = [...new Array(20).fill(10), ...new Array(20).fill(60)];
    const r = call("changepoints", ctxA, { values: vals });
    assert.equal(r.ok, true);
    assert.ok(r.result.changepointCount >= 1);
    assert.ok(r.result.changepoints[0].direction === "upward");
  });

  it("rejects an undersized series", () => {
    const r = call("changepoints", ctxA, { values: [1, 2, 3] });
    assert.equal(r.ok, false);
  });
});

describe("temporal.multiSeasonality", () => {
  it("detects a seasonal period via autocorrelation", () => {
    const r = call("multiSeasonality", ctxA, { values: syntheticSeries(64) });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.seasonalities));
    assert.ok(Array.isArray(r.result.acfCurve));
  });
});

describe("temporal.holidayForecast", () => {
  it("estimates a holiday effect and re-applies it to forecasts", () => {
    const vals = syntheticSeries(40);
    vals[30] += 200; // spike at index 30
    const r = call("holidayForecast", ctxA, {
      values: vals,
      horizon: 6,
      holidays: [{ name: "BigDay", index: 30, window: 0 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.predictions.length, 6);
    const eff = r.result.holidayEffects.find((h) => h.name === "BigDay");
    assert.ok(eff && eff.observed);
    assert.ok(eff.effect > 50);
  });
});

describe("temporal.backtest", () => {
  it("compares models with MAE / RMSE / MAPE on held-out data", () => {
    const r = call("backtest", ctxA, { values: syntheticSeries(60), testFraction: 0.25 });
    assert.equal(r.ok, true);
    assert.ok(r.result.models.length >= 3);
    assert.ok(r.result.bestModel);
    for (const m of r.result.models) {
      assert.ok(typeof m.mae === "number");
      assert.ok(typeof m.rmse === "number");
      assert.ok(typeof m.mape === "number");
    }
  });
});

describe("temporal.crossCorrelation", () => {
  it("finds the lead/lag between two related series", () => {
    const a = syntheticSeries(40);
    const b = a.map((_, i) => a[Math.max(0, i - 3)]); // b lags a by 3
    const r = call("crossCorrelation", ctxA, { seriesA: a, seriesB: b, maxLag: 8 });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.ccf));
    assert.ok(["A leads B", "B leads A", "synchronous"].includes(r.result.relationship));
  });

  it("rejects when only one series is given", () => {
    const r = call("crossCorrelation", ctxA, { seriesA: [1, 2, 3, 4, 5, 6] });
    assert.equal(r.ok, false);
  });
});

describe("temporal macros run against a stored dataset by id", () => {
  it("forecast resolves params.datasetId", () => {
    const imp = call("dataset-import", ctxA, {
      name: "Stored",
      csv: syntheticSeries(36).join("\n"),
    });
    const id = imp.result.dataset.id;
    const r = call("forecast", ctxA, { datasetId: id, horizon: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.predictions.length, 5);
  });
});
