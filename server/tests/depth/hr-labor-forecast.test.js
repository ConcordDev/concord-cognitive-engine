// tests/depth/hr-labor-forecast.test.js
//
// Behavioral test for hr.laborForecast — the Track-D "false-friend" assembly
// macro that wires the REAL BLS connector (hr.bls-series-lookup) to the REAL
// Holt-Winters engine (temporal.forecast).
//
// The test injects a fake global.fetch returning a known BLS-shaped payload
// (so NO real network egress is needed) and asserts that the macro's forecast
// EQUALS the value computed by the real temporal.forecast engine on the same
// extracted series — the expected values are COMPUTED from the existing engine
// at test time, never pasted. It also pins the honest no-egress failure path.

import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

const SERIES_ID = "CES0500000003"; // real BLS: avg hourly earnings, total private

// Build a deterministic monthly BLS-shaped series, NEWEST-FIRST (exactly how
// the BLS v2 API returns data). 36 months of a trend + seasonal wave so the
// engine runs seasonal (period 12, n=36 ≥ 2 cycles). Values are arbitrary but
// fixed — correctness comes from matching the engine, not from the numbers.
function buildBlsPayload() {
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const rows = [];
  const startYear = 2023;
  for (let m = 0; m < 36; m++) {
    const year = startYear + Math.floor(m / 12);
    const monthIdx = m % 12; // 0-based
    // deterministic trend + seasonal + tiny deterministic wobble
    const value =
      28 + m * 0.12 +
      1.5 * Math.sin((2 * Math.PI * monthIdx) / 12) +
      ((m * 7) % 5) * 0.03;
    rows.push({
      year: String(year),
      period: `M${String(monthIdx + 1).padStart(2, "0")}`,
      periodName: MONTHS[monthIdx],
      value: String(Math.round(value * 1000) / 1000),
      footnotes: [{}],
    });
  }
  // newest-first
  rows.reverse();
  return {
    status: "REQUEST_SUCCEEDED",
    Results: { series: [{ seriesID: SERIES_ID, catalog: null, data: rows }] },
  };
}

// Mirror the macro's extraction: monthly filter → ascending (year, month) →
// numeric values. Used to compute the ENGINE's expected forecast.
function extractAscendingValues(payload) {
  const points = payload.Results.series[0].data;
  const monthly = points.filter((p) => /^M(0[1-9]|1[0-2])$/.test(p.period));
  const ordered = [...monthly].sort(
    (a, b) =>
      Number(a.year) - Number(b.year) ||
      Number(a.period.slice(1)) - Number(b.period.slice(1))
  );
  return ordered.map((p) => Number(p.value)).filter((v) => Number.isFinite(v));
}

function stubFetch(payload) {
  const orig = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("api.bls.gov")) {
      return { ok: true, status: 200, json: async () => payload };
    }
    return orig ? orig(url) : { ok: false, status: 500, json: async () => ({}) };
  };
  return () => { global.fetch = orig; };
}

describe("hr.laborForecast — BLS connector × Holt-Winters assembly", () => {
  let payload;
  let restore = () => {};

  before(() => { payload = buildBlsPayload(); });
  afterEach(() => { restore(); restore = () => {}; });

  it("forecast equals the real temporal.forecast engine output on the same series", async () => {
    restore = stubFetch(payload);

    const horizon = 6;
    const macro = await lensRun("hr", "laborForecast", {
      params: { seriesId: SERIES_ID, horizon },
    });

    // lens.run unwraps a handler's { ok, result } — success lands the forecast
    // object directly in macro.result (no nested `ok` field).
    const r = macro.result;
    assert.ok(r && Array.isArray(r.forecast), `macro should succeed: ${JSON.stringify(macro)}`);
    assert.equal(r.granularity, "monthly");
    assert.equal(r.seasonal, true);
    assert.equal(r.method, "holt-winters-additive");
    assert.equal(r.horizon, horizon);
    assert.match(r.source, /bls/i);
    assert.match(r.source, /holt-winters/i);

    // Compute the EXPECTED forecast from the real engine directly, with the
    // exact values + period + horizon the macro fed it.
    const values = extractAscendingValues(payload);
    assert.equal(r.observations, values.length);
    const expected = await lensRun("temporal", "forecast", {
      params: { values, period: 12, horizon },
    });
    assert.equal(expected.ok, true, `engine should succeed: ${JSON.stringify(expected)}`);

    // The assembled macro's forecast must be BYTE-IDENTICAL to the engine's —
    // proving it reuses the real math rather than re-implementing it.
    assert.deepEqual(r.forecast, expected.result.predictions);
    assert.deepEqual(r.parameters, expected.result.parameters);
    assert.deepEqual(r.trend, expected.result.trend);
    assert.deepEqual(r.accuracy, expected.result.accuracy);

    // Sanity: the intervals the math produced are real and ordered.
    for (const p of r.forecast) {
      assert.ok(p.lower95 <= p.lower80, "lower95 <= lower80");
      assert.ok(p.lower80 <= p.forecast, "lower80 <= forecast");
      assert.ok(p.forecast <= p.upper80, "forecast <= upper80");
      assert.ok(p.upper80 <= p.upper95, "upper80 <= upper95");
    }
  });

  it("resolves a friendly LABOR_SERIES key to a real series id", async () => {
    restore = stubFetch(payload);
    const macro = await lensRun("hr", "laborForecast", {
      params: { series: "avg-hourly-earnings", horizon: 3 },
    });
    assert.equal(macro.ok, true);
    assert.equal(macro.result.seriesId, SERIES_ID);
    assert.equal(macro.result.unit, "USD/hr");
    assert.equal(macro.result.forecast.length, 3);
  });

  it("returns honest no_egress (never a fabricated series) when BLS is unreachable", async () => {
    restore = (() => {
      const orig = global.fetch;
      global.fetch = async () => { throw new Error("fetch failed"); };
      return () => { global.fetch = orig; };
    })();

    const macro = await lensRun("hr", "laborForecast", {
      params: { seriesId: SERIES_ID },
    });
    // Honest-failure envelope: lens.run wraps { ok:false, reason } into
    // macro.result — no fabricated forecast is ever returned.
    assert.equal(macro.result.ok, false);
    assert.equal(macro.result.reason, "no_egress");
    assert.equal(macro.result.forecast, undefined);
  });

  it("rejects a missing series id up front", async () => {
    const macro = await lensRun("hr", "laborForecast", { params: {} });
    assert.equal(macro.result.ok, false);
    // availableSeries is surfaced so the caller knows the real presets.
    const av = macro.result.availableSeries;
    assert.ok(Array.isArray(av) && av.includes("unemployment-rate"));
  });
});
