// Contract tests for server/domains/global.js — pure-math cross-domain
// macros plus live World Bank data-exploration macros (choropleth, time
// series, comparison, scatter explorer, indicator catalog search, country
// profiles) and per-user saved/shareable views.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGlobalActions from "../domains/global.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`global.${name}`);
  if (!fn) throw new Error(`global.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerGlobalActions(register); });

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  clearExternalFetchCache();
  // wipe per-user saved-view store between tests
  if (globalThis._concordSTATE) globalThis._concordSTATE.globalSavedViews = new Map();
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

// --- World Bank [meta, series] response builder -----------------------------
function wbSeries(rows) {
  return [
    { page: 1, pages: 1, per_page: rows.length, total: rows.length },
    rows,
  ];
}
function wbRow(countryCode, countryName, indicatorCode, indicatorName, year, value) {
  return {
    indicator: { id: indicatorCode, value: indicatorName },
    country: { id: countryCode, value: countryName },
    countryiso3code: countryCode,
    date: String(year),
    value,
  };
}

// =============================================================================
describe("global.crossDomainSearch (pure-compute)", () => {
  it("rejects when no sources provided", () => {
    const r = call("crossDomainSearch", ctxA, { data: { sources: [] } }, { query: "x" });
    assert.equal(r.ok, false);
  });

  it("scores + dedupes results across domains", () => {
    const r = call("crossDomainSearch", ctxA, {
      data: {
        sources: [
          { domain: "finance", items: [{ id: "f1", title: "Global GDP report", tags: ["gdp"] }] },
          { domain: "health", items: [{ id: "h1", title: "Global GDP report", tags: ["gdp"] }] },
        ],
      },
    }, { query: "global gdp" });
    assert.equal(r.ok, true);
    assert.ok(r.result.matchCount >= 1);
    assert.ok(r.result.sourcesSearched === 2);
  });
});

describe("global.aggregateDashboard (pure-compute)", () => {
  it("rejects empty metrics", () => {
    const r = call("aggregateDashboard", ctxA, { data: { metrics: [] } }, {});
    assert.equal(r.ok, false);
  });

  it("normalizes + ranks domains", () => {
    const r = call("aggregateDashboard", ctxA, {
      data: {
        metrics: [
          { domain: "econ", name: "gdp", value: 100 },
          { domain: "econ", name: "gdp", value: 50 },
          { domain: "social", name: "literacy", value: 90 },
        ],
      },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.rankings.length >= 1);
    assert.ok(typeof r.result.overallComposite === "number");
  });
});

describe("global.correlationMatrix (pure-compute)", () => {
  it("rejects fewer than 2 variables", () => {
    const r = call("correlationMatrix", ctxA, { data: { variables: [{ name: "a", values: [1, 2, 3] }] } }, {});
    assert.equal(r.ok, false);
  });

  it("computes pearson/spearman for correlated variables", () => {
    const r = call("correlationMatrix", ctxA, {
      data: {
        variables: [
          { name: "x", domain: "a", values: [1, 2, 3, 4, 5] },
          { name: "y", domain: "b", values: [2, 4, 6, 8, 10] },
        ],
      },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.observations, 5);
    assert.ok(r.result.significantCount >= 1);
  });
});

// =============================================================================
describe("global.indicatorTimeseries (World Bank)", () => {
  it("rejects invalid country code", async () => {
    const r = await call("indicatorTimeseries", ctxA, {}, { country: "X", indicator: "NY.GDP.MKTP.CD" });
    assert.equal(r.ok, false);
  });

  it("rejects invalid indicator code", async () => {
    const r = await call("indicatorTimeseries", ctxA, {}, { country: "USA", indicator: "" });
    assert.equal(r.ok, false);
  });

  it("shapes a real World Bank series", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => wbSeries([
        wbRow("USA", "United States", "NY.GDP.MKTP.CD", "GDP (current US$)", 2020, 2.1e13),
        wbRow("USA", "United States", "NY.GDP.MKTP.CD", "GDP (current US$)", 2021, 2.3e13),
      ]),
    });
    const r = await call("indicatorTimeseries", ctxA, {}, { country: "USA", indicator: "NY.GDP.MKTP.CD" });
    assert.equal(r.ok, true);
    assert.equal(r.result.country, "USA");
    assert.equal(r.result.points.length, 2);
    assert.equal(r.result.latest.year, 2021);
    assert.ok(r.result.pctChange != null);
  });

  it("reports unreachable when fetch fails", async () => {
    const r = await call("indicatorTimeseries", ctxA, {}, { country: "USA", indicator: "NY.GDP.MKTP.CD" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable/);
  });
});

describe("global.choropleth (World Bank)", () => {
  it("rejects invalid indicator", async () => {
    const r = await call("choropleth", ctxA, {}, { indicator: "" });
    assert.equal(r.ok, false);
  });

  it("returns per-country values + normalized intensity", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => wbSeries([
        wbRow("USA", "United States", "NY.GDP.PCAP.CD", "GDP per capita", 2022, 76000),
        wbRow("IND", "India", "NY.GDP.PCAP.CD", "GDP per capita", 2022, 2400),
      ]),
    });
    const r = await call("choropleth", ctxA, {}, { indicator: "NY.GDP.PCAP.CD" });
    assert.equal(r.ok, true);
    assert.equal(r.result.countryCount, 2);
    const top = r.result.countries[0];
    assert.equal(top.code, "USA");
    assert.equal(top.intensity, 1);
  });
});

describe("global.compareCountries (World Bank)", () => {
  it("rejects fewer than 2 countries", async () => {
    const r = await call("compareCountries", ctxA, {}, { countries: ["USA"], indicator: "SP.POP.TOTL" });
    assert.equal(r.ok, false);
  });

  it("builds a wide year table across countries", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => wbSeries([
        wbRow("USA", "United States", "SP.POP.TOTL", "Population", 2020, 331e6),
        wbRow("USA", "United States", "SP.POP.TOTL", "Population", 2021, 332e6),
        wbRow("CHN", "China", "SP.POP.TOTL", "Population", 2020, 1411e6),
        wbRow("CHN", "China", "SP.POP.TOTL", "Population", 2021, 1412e6),
      ]),
    });
    const r = await call("compareCountries", ctxA, {}, { countries: ["USA", "CHN"], indicator: "SP.POP.TOTL" });
    assert.equal(r.ok, true);
    assert.equal(r.result.countries.length, 2);
    assert.ok(r.result.table.length >= 1);
    assert.ok("USA" in r.result.table[0] && "CHN" in r.result.table[0]);
  });
});

describe("global.scatterExplorer (World Bank)", () => {
  it("rejects when only one indicator given", async () => {
    const r = await call("scatterExplorer", ctxA, {}, { indicatorX: "NY.GDP.PCAP.CD" });
    assert.equal(r.ok, false);
  });

  it("builds X/Y frames keyed by year", async () => {
    globalThis.fetch = async (url) => {
      const isX = url.includes("NY.GDP.PCAP.CD");
      const code = isX ? "NY.GDP.PCAP.CD" : "SP.DYN.LE00.IN";
      const name = isX ? "GDP per capita" : "Life expectancy";
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => wbSeries([
          wbRow("USA", "United States", code, name, 2020, isX ? 63000 : 78),
          wbRow("IND", "India", code, name, 2020, isX ? 2000 : 70),
        ]),
      };
    };
    const r = await call("scatterExplorer", ctxA, {}, {
      indicatorX: "NY.GDP.PCAP.CD", indicatorY: "SP.DYN.LE00.IN",
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.years.includes(2020));
    const frame = r.result.frames.find((f) => f.year === 2020);
    assert.ok(frame && frame.points.length === 2);
  });
});

describe("global.searchIndicators (World Bank catalog)", () => {
  it("rejects short queries", async () => {
    const r = await call("searchIndicators", ctxA, {}, { query: "a" });
    assert.equal(r.ok, false);
  });

  it("filters the indicator catalog by keyword", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => [
        { page: 1, pages: 1 },
        [
          { id: "EN.ATM.CO2E.PC", name: "CO2 emissions (metric tons per capita)", sourceNote: "Carbon dioxide.", sourceOrganization: "Climate Watch", topics: [{ value: "Environment" }] },
          { id: "NY.GDP.MKTP.CD", name: "GDP (current US$)", sourceNote: "Gross domestic product.", sourceOrganization: "World Bank", topics: [{ value: "Economy" }] },
        ],
      ],
    });
    const r = await call("searchIndicators", ctxA, {}, { query: "emissions" });
    assert.equal(r.ok, true);
    assert.ok(r.result.totalMatches >= 1);
    assert.equal(r.result.indicators[0].code, "EN.ATM.CO2E.PC");
  });
});

describe("global.countryProfile (World Bank)", () => {
  it("rejects invalid country", async () => {
    const r = await call("countryProfile", ctxA, {}, { country: "" });
    assert.equal(r.ok, false);
  });

  it("aggregates headline indicators with trends", async () => {
    globalThis.fetch = async (url) => {
      const m = url.match(/indicator\/([A-Z0-9.]+)/i);
      const code = m ? m[1] : "NY.GDP.MKTP.CD";
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => wbSeries([
          wbRow("USA", "United States", code, code, 2020, 100),
          wbRow("USA", "United States", code, code, 2021, 110),
        ]),
      };
    };
    const r = await call("countryProfile", ctxA, {}, { country: "USA", indicators: ["NY.GDP.MKTP.CD", "SP.POP.TOTL"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.country, "USA");
    assert.ok(r.result.indicatorCount >= 1);
    assert.ok(r.result.indicators[0].trendPct != null);
  });
});

// =============================================================================
describe("global saved views (saveView / listViews / deleteView)", () => {
  it("requires authentication to save", () => {
    const r = call("saveView", {}, {}, { view: { mode: "choropleth" } });
    assert.equal(r.ok, false);
  });

  it("saves, lists, resolves, and deletes a view", () => {
    const saved = call("saveView", ctxA, {}, {
      view: { mode: "choropleth", label: "GDP map", config: { indicator: "NY.GDP.MKTP.CD" } },
    });
    assert.equal(saved.ok, true);
    assert.match(saved.result.shareLink, /\/lenses\/global\?view=/);
    const id = saved.result.saved.id;

    const list = call("listViews", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);

    const resolved = call("listViews", ctxA, {}, { id });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.result.view.mode, "choropleth");

    const del = call("deleteView", ctxA, {}, { id });
    assert.equal(del.ok, true);
    assert.equal(del.result.total, 0);
  });

  it("rejects deleting a non-existent view", () => {
    const r = call("deleteView", ctxA, {}, { id: "gv_nope" });
    assert.equal(r.ok, false);
  });

  it("isolates saved views per user", () => {
    call("saveView", ctxA, {}, { view: { mode: "timeseries", config: {} } });
    const other = { actor: { userId: "user_b" }, userId: "user_b" };
    const list = call("listViews", other, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 0);
  });
});
