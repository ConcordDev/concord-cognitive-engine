// Behavioral macro tests for server/domains/society.js — the World Bank Open
// Data explorer substrate (parity vs Our World in Data / Gapminder).
//
// PRIOR BUG these tests guard against: society.js used the LEGACY 3-arg
// registerLensAction(domain, action, (ctx, artifact, params)) convention AND was
// never imported by server.js — so every society.* (wb-*) macro was invisible to
// runMacro and hit `unknown_macro`, leaving the DataExplorer + SocietyActionPanel
// (the live World Bank surface) dead-wired. The module is now exported as a
// canonical registerSocietyActions(register) with an internal shim; these tests
// drive each macro the way runMacro would — a canonical (ctx, input) call —
// against the REAL in-memory chart store the domain uses.
//
// These are NOT shape-only assertions. They assert ACTUAL computed values +
// multi-step round-trips (save chart → list → load; CSV serialise of real rows;
// per-capita + inflation transforms with hand-checked arithmetic), per-user
// isolation, and the fail-CLOSED validation guards (ISO-3 regex, indicator-code
// format guard that blocks an XSS probe BEFORE any network call, numeric guard
// the macro-assassin's V2 vector probes). The macros that make a real outbound
// World Bank call are exercised ONLY on their pre-network validation-rejection
// paths, so the suite is hermetic — it stands up NO server and makes NO network
// request — and runs in well under 10s.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSocietyActions from "../domains/society.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "society", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`society.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerSocietyActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

const XSS = "<script>alert(1)</script>";

describe("society — registration (canonical convention, all 16 macros visible)", () => {
  it("registers every wb-* macro the lens components call", () => {
    for (const m of [
      "wb-indicator", "wb-country", "wb-compare", "wb-common-indicators",
      "wb-chart-series", "wb-bubble-frames", "wb-choropleth", "wb-indicator-search",
      "wb-country-dashboard", "wb-export-csv", "wb-save-chart", "wb-load-chart",
      "wb-list-charts", "wb-region-rankings", "wb-aggregate-codes", "wb-transform-series",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing society.${m}`);
    }
    assert.equal(ACTIONS.size, 16);
  });

  it("a handler receives the canonical (ctx, input) call and reads input fields", () => {
    // wb-common-indicators is pure-compute; the canonical input is the 2nd arg.
    const r = call("wb-common-indicators", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.indicators, "object");
  });
});

describe("society — pure-compute reference tables (real values, no network)", () => {
  it("wb-common-indicators returns the alias→WB-code map with a correct count", () => {
    const r = call("wb-common-indicators", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.indicators.population, "SP.POP.TOTL");
    assert.equal(r.result.indicators.gdpPerCapita, "NY.GDP.PCAP.CD");
    assert.equal(r.result.count, Object.keys(r.result.indicators).length);
    assert.ok(r.result.count >= 16);
  });

  it("wb-aggregate-codes returns the region/income aggregate table", () => {
    const r = call("wb-aggregate-codes", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.aggregates.WLD, "World");
    assert.equal(r.result.aggregates.SSF, "Sub-Saharan Africa");
    assert.equal(r.result.count, Object.keys(r.result.aggregates).length);
  });
});

describe("society — wb-export-csv serialises real rows", () => {
  it("emits a header + one line per row, with quoting + correct byteLength", () => {
    const rows = [
      { year: 2020, value: 1000, note: "a,b" },
      { year: 2021, value: 2000, note: 'has "quote"' },
    ];
    const r = call("wb-export-csv", ctxA, { rows, columns: ["year", "value", "note"], filename: "usa-gdp" });
    assert.equal(r.ok, true);
    assert.equal(r.result.rowCount, 2);
    assert.equal(r.result.filename, "usa-gdp.csv");
    const lines = r.result.csv.split("\n");
    assert.equal(lines[0], "year,value,note");
    assert.equal(lines[1], '2020,1000,"a,b"');          // comma forces quoting
    assert.equal(lines[2], '2021,2000,"has ""quote"""'); // embedded quote doubled
    assert.equal(r.result.byteLength, Buffer.byteLength(r.result.csv, "utf8"));
  });

  it("derives columns from row keys when none are given", () => {
    const r = call("wb-export-csv", ctxA, { rows: [{ a: 1, b: 2 }] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.columns, ["a", "b"]);
  });

  it("fails closed on an empty rows array", () => {
    assert.equal(call("wb-export-csv", ctxA, { rows: [] }).error, "rows array required");
    assert.equal(call("wb-export-csv", ctxA, {}).error, "rows array required");
  });
});

describe("society — saved-chart permalink lifecycle (save → list → load), per-user", () => {
  it("saves a chart, lists it for the owner, and loads it by id", () => {
    const spec = { view: "chart", country: "USA", indicator: "gdpPerCapita" };
    const saved = call("wb-save-chart", ctxA, { spec, title: "US GDP/cap" });
    assert.equal(saved.ok, true);
    const id = saved.result.id;
    assert.match(id, /^soc_/);
    assert.equal(saved.result.permalink, `/lenses/society?chart=${id}`);
    assert.equal(saved.result.title, "US GDP/cap");

    // owner lists exactly one chart
    const listed = call("wb-list-charts", ctxA, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.count, 1);
    assert.equal(listed.result.charts[0].id, id);

    // load round-trips the exact spec
    const loaded = call("wb-load-chart", ctxA, { id });
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.result.spec, spec);
    assert.equal(loaded.result.owner, "user_a");
  });

  it("never leaks one user's saved charts to another", () => {
    call("wb-save-chart", ctxA, { spec: { x: 1 }, title: "A chart" });
    assert.equal(call("wb-list-charts", ctxA, {}).result.count, 1);
    assert.equal(call("wb-list-charts", ctxB, {}).result.count, 0);
  });

  it("fails closed on a missing spec / unknown id", () => {
    assert.equal(call("wb-save-chart", ctxA, {}).error, "spec object required");
    assert.equal(call("wb-load-chart", ctxA, {}).error, "id required");
    assert.equal(call("wb-load-chart", ctxA, { id: "soc_nope" }).error, "chart not found");
  });
});

describe("society — wb-transform-series (per-capita + inflation arithmetic)", () => {
  it("computes per-capita with the supplied population series", () => {
    const r = call("wb-transform-series", ctxA, {
      series: [{ year: 2020, value: 1000 }, { year: 2021, value: 2200 }],
      population: [{ year: 2020, value: 100 }, { year: 2021, value: 200 }],
      perCapita: true,
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.series, [{ year: 2020, value: 10 }, { year: 2021, value: 11 }]);
    assert.deepEqual(r.result.transforms, ["per-capita"]);
    assert.equal(r.result.min, 10);
    assert.equal(r.result.max, 11);
  });

  it("inflation-adjusts using the embedded CPI anchors (base 2024)", () => {
    // 2020 CPI 258.81, 2024 CPI 313.69 → factor 313.69/258.81.
    const r = call("wb-transform-series", ctxA, {
      series: [{ year: 2020, value: 100 }],
      inflationAdjust: true, baseYear: 2024,
    });
    assert.equal(r.ok, true);
    const expected = 100 * (313.69 / 258.81);
    assert.ok(Math.abs(r.result.series[0].value - expected) < 1e-6,
      `got ${r.result.series[0].value}, expected ~${expected}`);
    assert.equal(r.result.transforms[0], "inflation-adjusted (USD 2024)");
  });

  it("fails closed when no transform is requested or series is empty", () => {
    assert.equal(call("wb-transform-series", ctxA, { series: [] }).error, "series array required");
    assert.equal(
      call("wb-transform-series", ctxA, { series: [{ year: 2020, value: 1 }] }).error,
      "specify perCapita and/or inflationAdjust",
    );
    assert.equal(
      call("wb-transform-series", ctxA, { series: [{ year: 2020, value: 1 }], perCapita: true }).error,
      "perCapita requires a population series",
    );
  });

  it("fail-CLOSED numeric guard rejects a poisoned baseYear (assassin V2)", () => {
    for (const bad of [NaN, Infinity, -Infinity, 1e308, -1]) {
      const r = call("wb-transform-series", ctxA, {
        series: [{ year: 2020, value: 1 }], inflationAdjust: true, baseYear: bad,
      });
      assert.equal(r.ok, false, `baseYear=${bad} should fail-closed`);
      assert.equal(r.error, "invalid baseYear");
    }
  });
});

describe("society — network macros reject BEFORE any outbound call (hermetic)", () => {
  // Every assertion here lands on a pre-fetch validation branch, so NO World
  // Bank request is made — the suite is fully offline + deterministic. The
  // network macros are `async`, so each call is awaited; a validation reject
  // resolves synchronously without ever reaching `fetch`.
  const aerr = async (name, input) => (await call(name, ctxA, input)).error;

  it("wb-indicator validates the ISO-3 country and indicator shape pre-network", async () => {
    assert.match(await aerr("wb-indicator", {}), /3-letter ISO/);
    assert.match(await aerr("wb-indicator", { country: "us" }), /3-letter ISO/);
    assert.match(await aerr("wb-indicator", { country: XSS }), /3-letter ISO/);
    assert.match(await aerr("wb-indicator", { country: "USA" }), /indicator required/);
    // the XSS probe on indicator is blocked by the format guard, never reaching fetch
    assert.match(await aerr("wb-indicator", { country: "USA", indicator: XSS }), /World Bank code or alias/);
  });

  it("wb-country / wb-compare reject malformed ISO-3 pre-network", async () => {
    assert.match(await aerr("wb-country", { country: XSS }), /3-letter ISO/);
    assert.match(await aerr("wb-compare", { countries: ["USA"] }), /2-10 ISO-3/);
    assert.match(await aerr("wb-compare", { countries: ["USA", XSS] }), /3-letter ISO/);
    assert.match(await aerr("wb-compare", { countries: ["USA", "GBR"], indicator: XSS }), /World Bank code or alias/);
  });

  it("wb-choropleth / wb-region-rankings block an XSS indicator pre-network", async () => {
    assert.match(await aerr("wb-choropleth", {}), /indicator required/);
    assert.match(await aerr("wb-choropleth", { indicator: XSS }), /World Bank code or alias/);
    assert.match(await aerr("wb-region-rankings", { indicator: XSS }), /World Bank code or alias/);
  });

  it("wb-indicator-search rejects short + hostile queries and poisoned limit pre-network", async () => {
    assert.match(await aerr("wb-indicator-search", { query: "x" }), /at least 2/);
    assert.match(await aerr("wb-indicator-search", { query: XSS }), /unsupported characters/);
    assert.equal(await aerr("wb-indicator-search", { query: "gdp", limit: NaN }), "invalid limit");
  });

  it("wb-bubble-frames validates countries, year shape, and indicator codes pre-network", async () => {
    assert.match(await aerr("wb-bubble-frames", { countries: ["USA"] }), /2-30 ISO-3/);
    assert.equal(await aerr("wb-bubble-frames", { countries: ["USA", "GBR"], startYear: NaN }), "invalid startYear");
    assert.match(await aerr("wb-bubble-frames", { countries: ["USA", "GBR"], xIndicator: XSS }), /World Bank code or alias/);
    assert.match(
      await aerr("wb-bubble-frames", { countries: ["USA", "GBR"], startYear: 2020, endYear: 2010 }),
      /endYear must be >= startYear/,
    );
  });

  it("wb-chart-series / wb-country-dashboard reject malformed inputs pre-network", async () => {
    assert.match(await aerr("wb-chart-series", { country: "USA", indicator: XSS }), /World Bank code or alias/);
    assert.match(await aerr("wb-country-dashboard", { country: "us" }), /3-letter ISO/);
    // valid country + an XSS alias in the indicators array → rejected by the
    // array format guard BEFORE any fetch.
    assert.match(
      await aerr("wb-country-dashboard", { country: "USA", indicators: ["population", XSS] }),
      /World Bank code or alias/,
    );
  });
});
