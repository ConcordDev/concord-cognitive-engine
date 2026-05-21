// Contract tests for server/domains/society.js — the Our World in Data /
// Gapminder feature-parity pass. Exercises every macro registered by
// registerSocietyActions: pure-compute helpers (CSV export, chart
// save/load/list, series transforms, alias/aggregate tables) plus the
// live World Bank Open Data integrations (chart series, bubble frames,
// choropleth, catalog search, country dashboard, region rankings).
//
// World Bank network calls are mocked at globalThis.fetch — the macros
// reach it through cachedFetchJson; clearExternalFetchCache() resets the
// URL cache between tests.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSocietyActions from "../domains/society.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`society.${name}`);
  if (!fn) throw new Error(`society.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSocietyActions(register); });

beforeEach(() => {
  clearExternalFetchCache();
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

// WB response helper: [metadata, rows].
function wbResponse(rows, meta = {}) {
  return { ok: true, json: async () => ([{ total: rows.length, ...meta }, rows]) };
}
function row(date, value, opts = {}) {
  return {
    date: String(date),
    value,
    countryiso3code: opts.iso3 || "USA",
    country: { id: opts.iso3 || "USA", value: opts.countryName || "United States" },
  };
}

// ─── Pure-compute macros ─────────────────────────────────────────────────────

describe("society.wb-common-indicators (alias table)", () => {
  it("returns the alias map", () => {
    const r = call("wb-common-indicators", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.indicators.population, "SP.POP.TOTL");
    assert.ok(r.result.count >= 10);
  });
});

describe("society.wb-aggregate-codes (region table)", () => {
  it("returns the region + income aggregate codes", () => {
    const r = call("wb-aggregate-codes", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.aggregates.WLD, "World");
    assert.ok(r.result.count >= 5);
  });
});

describe("society.wb-export-csv", () => {
  it("rejects an empty rows array", () => {
    assert.equal(call("wb-export-csv", ctxA, { rows: [] }).ok, false);
  });

  it("serialises rows to CSV with a header line", () => {
    const r = call("wb-export-csv", ctxA, {
      rows: [{ year: 2020, value: 5 }, { year: 2021, value: 7 }],
      columns: ["year", "value"],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.csv, "year,value\n2020,5\n2021,7");
    assert.equal(r.result.rowCount, 2);
    assert.match(r.result.filename, /\.csv$/);
  });

  it("escapes values containing commas / quotes", () => {
    const r = call("wb-export-csv", ctxA, { rows: [{ name: 'a,"b"' }], columns: ["name"] });
    assert.equal(r.ok, true);
    assert.match(r.result.csv, /"a,""b"""/);
  });
});

describe("society.wb-save-chart / wb-load-chart / wb-list-charts", () => {
  it("rejects a missing spec", () => {
    assert.equal(call("wb-save-chart", ctxA, {}).ok, false);
  });

  it("round-trips a saved chart spec and returns a permalink", () => {
    const saved = call("wb-save-chart", ctxA, {
      title: "GDP per capita — USA",
      spec: { view: "chart", country: "USA", indicator: "gdpPerCapita" },
    });
    assert.equal(saved.ok, true);
    assert.match(saved.result.permalink, /\/lenses\/society\?chart=/);

    const loaded = call("wb-load-chart", ctxA, { id: saved.result.id });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.result.spec.country, "USA");
    assert.equal(loaded.result.title, "GDP per capita — USA");
  });

  it("returns not-found for an unknown chart id", () => {
    const r = call("wb-load-chart", ctxA, { id: "soc_nonexistent" });
    assert.equal(r.ok, false);
  });

  it("lists the calling user's saved charts", () => {
    call("wb-save-chart", ctxA, { title: "L1", spec: { a: 1 } });
    const r = call("wb-list-charts", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 1);
    assert.ok(r.result.charts.every((c) => c.permalink.includes("chart=")));
  });
});

describe("society.wb-transform-series (per-capita / inflation)", () => {
  it("rejects an empty series", () => {
    assert.equal(call("wb-transform-series", ctxA, { series: [] }).ok, false);
  });

  it("requires at least one transform flag", () => {
    const r = call("wb-transform-series", ctxA, { series: [{ year: 2020, value: 10 }] });
    assert.equal(r.ok, false);
  });

  it("applies a per-capita transform with a population series", () => {
    const r = call("wb-transform-series", ctxA, {
      series: [{ year: 2020, value: 1000 }],
      population: [{ year: 2020, value: 100 }],
      perCapita: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.series[0].value, 10);
    assert.ok(r.result.transforms.includes("per-capita"));
  });

  it("applies an inflation adjustment to the base year", () => {
    const r = call("wb-transform-series", ctxA, {
      series: [{ year: 2000, value: 100 }],
      inflationAdjust: true,
      baseYear: 2024,
    });
    assert.equal(r.ok, true);
    // 2000 dollars are worth more in 2024 terms — value scales up.
    assert.ok(r.result.series[0].value > 100);
  });
});

// ─── Live World Bank integration macros (mocked network) ─────────────────────

describe("society.wb-chart-series (interactive charting)", () => {
  it("rejects a bad country code", async () => {
    assert.equal((await call("wb-chart-series", ctxA, { country: "US", indicator: "gdp" })).ok, false);
  });

  it("returns an ascending chart-ready series", async () => {
    globalThis.fetch = async () => wbResponse([row(2021, 200), row(2020, 100)]);
    const r = await call("wb-chart-series", ctxA, { country: "USA", indicator: "gdp" });
    assert.equal(r.ok, true);
    assert.equal(r.result.chartKind, "line");
    assert.equal(r.result.series[0].year, 2020);
    assert.equal(r.result.series[1].year, 2021);
    assert.equal(r.result.first.value, 100);
    assert.equal(r.result.last.value, 200);
  });

  it("applies a per-capita transform via the population series", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("SP.POP.TOTL")) return wbResponse([row(2020, 100)]);
      return wbResponse([row(2020, 1000)]);
    };
    const r = await call("wb-chart-series", ctxA, { country: "USA", indicator: "gdp", perCapita: true });
    assert.equal(r.ok, true);
    assert.equal(r.result.series[0].value, 10);
    assert.ok(r.result.transforms.includes("per-capita"));
  });
});

describe("society.wb-bubble-frames (animated Gapminder chart)", () => {
  it("rejects fewer than two countries", async () => {
    assert.equal((await call("wb-bubble-frames", ctxA, { countries: ["USA"] })).ok, false);
  });

  it("builds one frame per year with x/y/size", async () => {
    globalThis.fetch = async () => wbResponse([
      row(2000, 50000, { iso3: "USA" }),
      row(2000, 1000, { iso3: "IND", countryName: "India" }),
    ]);
    const r = await call("wb-bubble-frames", ctxA, {
      countries: ["USA", "IND"], startYear: 2000, endYear: 2000,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.frameCount, 1);
    assert.equal(r.result.frames[0].year, 2000);
    assert.ok(r.result.frames[0].bubbles.length >= 1);
    assert.ok("x" in r.result.frames[0].bubbles[0]);
    assert.ok("y" in r.result.frames[0].bubbles[0]);
  });
});

describe("society.wb-choropleth (world map)", () => {
  it("rejects a missing indicator", async () => {
    assert.equal((await call("wb-choropleth", ctxA, {})).ok, false);
  });

  it("returns points with lat/lon and 0..1 intensity", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("/country?format=json")) {
        return wbResponse([
          { id: "USA", name: "United States", latitude: "38", longitude: "-97", region: { value: "North America" } },
          { id: "IND", name: "India", latitude: "20", longitude: "77", region: { value: "South Asia" } },
        ]);
      }
      return wbResponse([
        row(2022, 80, { iso3: "USA" }),
        row(2022, 70, { iso3: "IND", countryName: "India" }),
      ]);
    };
    const r = await call("wb-choropleth", ctxA, { indicator: "lifeExpectancy" });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 1);
    const p = r.result.points[0];
    assert.ok("lat" in p && "lon" in p);
    assert.ok(p.intensity >= 0 && p.intensity <= 1);
  });
});

describe("society.wb-indicator-search (catalog search)", () => {
  it("rejects a too-short query", async () => {
    assert.equal((await call("wb-indicator-search", ctxA, { query: "a" })).ok, false);
  });

  it("matches indicators by free text", async () => {
    globalThis.fetch = async () => wbResponse([
      { id: "SP.POP.TOTL", name: "Population, total", source: { value: "WDI" }, topics: [{ value: "Health" }] },
      { id: "NY.GDP.MKTP.CD", name: "GDP (current US$)", source: { value: "WDI" }, topics: [] },
    ]);
    const r = await call("wb-indicator-search", ctxA, { query: "population", limit: 10 });
    assert.equal(r.ok, true);
    assert.ok(r.result.matches.some((m) => m.code === "SP.POP.TOTL"));
  });
});

describe("society.wb-country-dashboard (one-country dashboard)", () => {
  it("rejects a bad country code", async () => {
    assert.equal((await call("wb-country-dashboard", ctxA, { country: "U" })).ok, false);
  });

  it("returns a profile + indicator cards", async () => {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (/\/country\/USA\?format=json/.test(u)) {
        return wbResponse([{
          name: "United States", capitalCity: "Washington D.C.",
          region: { value: "North America" }, incomeLevel: { value: "High income" },
          latitude: "38", longitude: "-97",
        }]);
      }
      return wbResponse([row(2022, 42)]);
    };
    const r = await call("wb-country-dashboard", ctxA, { country: "USA", indicators: ["population", "gdp"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.profile.name, "United States");
    assert.equal(r.result.cardCount, 2);
    assert.ok(r.result.cards[0].latest);
  });
});

describe("society.wb-region-rankings (region aggregates)", () => {
  it("rejects a missing indicator", async () => {
    assert.equal((await call("wb-region-rankings", ctxA, {})).ok, false);
  });

  it("ranks region aggregates descending by value", async () => {
    globalThis.fetch = async () => wbResponse([
      row(2022, 50, { iso3: "WLD" }),
      row(2022, 90, { iso3: "HIC" }),
      row(2022, 10, { iso3: "LIC" }),
    ]);
    const r = await call("wb-region-rankings", ctxA, { indicator: "gdpPerCapita" });
    assert.equal(r.ok, true);
    assert.equal(r.result.rankings[0].rank, 1);
    assert.equal(r.result.rankings[0].code, "HIC");
    assert.equal(r.result.worldValue, 50);
  });
});

// ─── Pre-existing macros still parity-tested ─────────────────────────────────

describe("society.wb-indicator / wb-country / wb-compare (baseline)", () => {
  it("wb-indicator rejects a bad ISO code", async () => {
    assert.equal((await call("wb-indicator", ctxA, { country: "U", indicator: "gdp" })).ok, false);
  });

  it("wb-compare rejects fewer than two countries", async () => {
    assert.equal((await call("wb-compare", ctxA, { countries: ["USA"], indicator: "gdp" })).ok, false);
  });

  it("wb-country shapes a profile", async () => {
    globalThis.fetch = async () => wbResponse([{
      id: "USA", iso2Code: "US", name: "United States",
      capitalCity: "Washington D.C.", region: { value: "North America" },
      incomeLevel: { value: "High income" }, latitude: "38", longitude: "-97",
    }]);
    const r = await call("wb-country", ctxA, { country: "USA" });
    assert.equal(r.ok, true);
    assert.equal(r.result.name, "United States");
    assert.equal(r.result.iso3, "USA");
  });
});
