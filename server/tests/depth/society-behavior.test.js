// tests/depth/society-behavior.test.js — REAL behavioral tests for the
// society domain (registerLensAction family, invoked via lensRun). The society
// macros wrap the World Bank Open Data API; under the no-egress test preload
// every external fetch fails instantly, so the network-backed macros are
// exercised on their DETERMINISTIC branches: input validation rejections and
// the graceful "worldbank unreachable" fallback. The pure-compute macros
// (transforms, CSV export, chart store, lookup tables) are exercised on exact
// computed values + CRUD round-trips.
//
// lens.run unwraps a handler's {ok,result}: handler success {ok:true,result:X}
// surfaces as r.ok===true / r.result.X; a handler refusal {ok:false,error}
// (no `result` key) surfaces nested as r.result.ok===false / r.result.error.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("society — pure-compute lookup tables (exact contracts)", () => {
  it("wb-common-indicators: maps aliases to WB codes, count matches map size", async () => {
    const r = await lensRun("society", "wb-common-indicators", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.indicators.population, "SP.POP.TOTL");
    assert.equal(r.result.indicators.gdpPerCapita, "NY.GDP.PCAP.CD");
    assert.equal(r.result.count, Object.keys(r.result.indicators).length);
    assert.equal(r.result.count, 16);
  });

  it("wb-aggregate-codes: region/income aggregate table resolves WLD to World", async () => {
    const r = await lensRun("society", "wb-aggregate-codes", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.aggregates.WLD, "World");
    assert.equal(r.result.aggregates.SSF, "Sub-Saharan Africa");
    assert.equal(r.result.count, Object.keys(r.result.aggregates).length);
    assert.equal(r.result.count, 11);
  });
});

describe("society — wb-transform-series (pure compute, exact math)", () => {
  it("per-capita divides value by population for the same year", async () => {
    const r = await lensRun("society", "wb-transform-series", {
      params: {
        series: [{ year: 2020, value: 2000 }, { year: 2021, value: 4400 }],
        population: [{ year: 2020, value: 100 }, { year: 2021, value: 200 }],
        perCapita: true,
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.points, 2);
    assert.equal(r.result.series[0].value, 20);   // 2000 / 100
    assert.equal(r.result.series[1].value, 22);   // 4400 / 200
    assert.ok(r.result.transforms.includes("per-capita"));
  });

  it("per-capita drops years with no matching population datum", async () => {
    const r = await lensRun("society", "wb-transform-series", {
      params: {
        series: [{ year: 2020, value: 1000 }, { year: 2099, value: 9999 }],
        population: [{ year: 2020, value: 10 }],
        perCapita: true,
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.points, 1);
    assert.equal(r.result.series[0].year, 2020);
    assert.equal(r.result.series[0].value, 100);  // 1000 / 10
  });

  it("inflation-adjust scales by base-CPI / year-CPI (2024 base → 2020 value upscaled)", async () => {
    const r = await lensRun("society", "wb-transform-series", {
      params: { series: [{ year: 2020, value: 100 }], inflationAdjust: true },
    });
    assert.equal(r.ok, true);
    // 100 * (CPI_2024 / CPI_2020) = 100 * (313.69 / 258.81) ≈ 121.20
    const v = r.result.series[0].value;
    assert.ok(v > 121.18 && v < 121.21, `expected ≈121.20, got ${v}`);
    assert.ok(r.result.transforms.some((t) => t.includes("inflation-adjusted")));
  });

  it("base-year 2024 value is unchanged by inflation adjustment", async () => {
    const r = await lensRun("society", "wb-transform-series", {
      params: { series: [{ year: 2024, value: 500 }], inflationAdjust: true, baseYear: 2024 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.series[0].value, 500);  // CPI cancels at base year
  });

  it("rejects empty series", async () => {
    const r = await lensRun("society", "wb-transform-series", { params: { series: [], perCapita: true } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /series array required/);
  });

  it("rejects per-capita with no population series", async () => {
    const r = await lensRun("society", "wb-transform-series", {
      params: { series: [{ year: 2020, value: 1 }], perCapita: true },
    });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /requires a population series/);
  });

  it("rejects when neither transform flag is set", async () => {
    const r = await lensRun("society", "wb-transform-series", {
      params: { series: [{ year: 2020, value: 1 }] },
    });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /perCapita and\/or inflationAdjust/);
  });
});

describe("society — wb-export-csv (pure compute, exact serialization)", () => {
  it("serializes rows to CSV with header + quoting of commas, exact byteLength", async () => {
    const r = await lensRun("society", "wb-export-csv", {
      params: { rows: [{ year: 2020, value: "a,b" }, { year: 2021, value: 5 }], filename: "rep" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.csv, 'year,value\n2020,"a,b"\n2021,5');
    assert.equal(r.result.rowCount, 2);
    assert.deepEqual(r.result.columns, ["year", "value"]);
    assert.equal(r.result.filename, "rep.csv");
    assert.equal(r.result.byteLength, Buffer.byteLength(r.result.csv, "utf8"));
  });

  it("honours an explicit column subset/order", async () => {
    const r = await lensRun("society", "wb-export-csv", {
      params: { rows: [{ a: 1, b: 2, c: 3 }], columns: ["c", "a"] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.csv, "c,a\n3,1");
  });

  it("rejects an empty rows array", async () => {
    const r = await lensRun("society", "wb-export-csv", { params: { rows: [] } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /rows array required/);
  });
});

describe("society — chart store CRUD (round-trip, shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("society-charts"); });

  it("wb-save-chart → wb-load-chart: spec round-trips by share id", async () => {
    const spec = { kind: "line", country: "USA", indicator: "population" };
    const saved = await lensRun("society", "wb-save-chart", { params: { spec, title: "US pop" } }, ctx);
    assert.equal(saved.ok, true);
    assert.ok(saved.result.id.startsWith("soc_"));
    assert.equal(saved.result.permalink, `/lenses/society?chart=${saved.result.id}`);

    const loaded = await lensRun("society", "wb-load-chart", { params: { id: saved.result.id } }, ctx);
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.result.spec, spec);
    assert.equal(loaded.result.title, "US pop");
  });

  it("wb-save-chart → wb-list-charts: saved chart appears in the caller's list", async () => {
    const saved = await lensRun("society", "wb-save-chart", { params: { spec: { kind: "bar" }, title: "Listed" } }, ctx);
    const list = await lensRun("society", "wb-list-charts", {}, ctx);
    assert.equal(list.ok, true);
    assert.ok(list.result.charts.some((c) => c.id === saved.result.id && c.title === "Listed"));
    assert.equal(list.result.count, list.result.charts.length);
  });

  it("wb-load-chart: unknown id is not found", async () => {
    const r = await lensRun("society", "wb-load-chart", { params: { id: "soc_doesnotexist" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /chart not found/);
  });

  it("wb-save-chart rejects a missing spec", async () => {
    const r = await lensRun("society", "wb-save-chart", { params: { title: "no spec" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /spec object required/);
  });

  it("wb-load-chart rejects a missing id", async () => {
    const r = await lensRun("society", "wb-load-chart", { params: {} }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /id required/);
  });
});

describe("society — network macros: validation rejections (deterministic, pre-fetch)", () => {
  it("wb-indicator rejects a non-ISO-3 country before any fetch", async () => {
    const r = await lensRun("society", "wb-indicator", { params: { country: "US", indicator: "population" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /3-letter ISO code/);
  });

  it("wb-indicator rejects a missing indicator", async () => {
    const r = await lensRun("society", "wb-indicator", { params: { country: "USA" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /indicator required/);
  });

  it("wb-country rejects a non-ISO-3 country", async () => {
    const r = await lensRun("society", "wb-country", { params: { country: "United States" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /3-letter ISO code/);
  });

  it("wb-compare rejects fewer than 2 countries", async () => {
    const r = await lensRun("society", "wb-compare", { params: { countries: ["USA"], indicator: "gdp" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /2-10 ISO-3 codes/);
  });

  it("wb-compare rejects a malformed code among valid ones", async () => {
    const r = await lensRun("society", "wb-compare", { params: { countries: ["USA", "GB"], indicator: "gdp" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /3-letter ISO codes/);
  });

  it("wb-chart-series rejects a non-ISO-3 country", async () => {
    const r = await lensRun("society", "wb-chart-series", { params: { country: "JP", indicator: "gdp" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /3-letter ISO code/);
  });

  it("wb-bubble-frames rejects too few countries", async () => {
    const r = await lensRun("society", "wb-bubble-frames", { params: { countries: ["USA"] } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /2-30 ISO-3 codes/);
  });

  it("wb-bubble-frames rejects endYear before startYear", async () => {
    const r = await lensRun("society", "wb-bubble-frames", {
      params: { countries: ["USA", "JPN"], startYear: 2020, endYear: 2010 },
    });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /endYear must be >= startYear/);
  });

  it("wb-choropleth rejects a missing indicator", async () => {
    const r = await lensRun("society", "wb-choropleth", { params: {} });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /indicator required/);
  });

  it("wb-indicator-search rejects a too-short query", async () => {
    const r = await lensRun("society", "wb-indicator-search", { params: { query: "a" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /at least 2 characters/);
  });

  it("wb-country-dashboard rejects a non-ISO-3 country", async () => {
    const r = await lensRun("society", "wb-country-dashboard", { params: { country: "fr" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /3-letter ISO code/);
  });

  it("wb-region-rankings rejects a missing indicator", async () => {
    const r = await lensRun("society", "wb-region-rankings", { params: {} });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /indicator required/);
  });
});

describe("society — network macros: graceful unreachable fallback (post-validation, no egress)", () => {
  it("wb-indicator with valid params degrades to a worldbank-unreachable refusal", async () => {
    const r = await lensRun("society", "wb-indicator", { params: { country: "USA", indicator: "population" } });
    // Passed validation; the blocked external fetch lands the catch branch.
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /worldbank unreachable/);
  });

  it("wb-country with a valid code degrades to a worldbank-unreachable refusal", async () => {
    const r = await lensRun("society", "wb-country", { params: { country: "GBR" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /worldbank unreachable/);
  });
});
