// B10-takeover pins (B6, CB-0616):
//   FIX-research-007 — citations carry the bibliographic locator:
//     reference-add stores volume/issue/pages, and every style's format
//     emits them (APA "Journal, 50(3), 367." · MLA "vol. 50, no. 3").
//   FIX-society-010 — latestPerKey dedupes multi-year World Bank rows to
//     one row per key (the choropleth/rankings count fix).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import registerResearchActions from "../domains/research.js";
import { latestPerKey } from "../lib/wb-catalog-search.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`research.${name}`);
  if (!fn) throw new Error(`research.${name} not registered`);
  return fn(ctx, null, params);
}
const CTX = { actor: { userId: "u-cite" }, userId: "u-cite" };

before(() => {
  globalThis._concordSTATE = {};
  registerResearchActions(register);
});

describe("FIX-research-007 — citations carry volume, issue and pages", () => {
  it("reference-add stores the locator and every style emits it", async () => {
    const add = await call("reference-add", CTX, {
      title: "Graph neural network",
      authors: "Yuting Liu",
      year: 2020,
      journal: "SCIENTIA SINICA Mathematica",
      volume: "50", issue: "3", pages: "367",
      doi: "10.1360/n012019-00133",
    });
    assert.equal(add.ok, true);
    const ref = add.result.reference;
    assert.equal(ref.volume, "50");
    assert.equal(ref.issue, "3");
    assert.equal(ref.pages, "367");

    const detail = await call("reference-detail", CTX, { id: ref.id });
    assert.equal(detail.ok, true);
    const c = detail.result.citations;
    assert.match(c.apa, /SCIENTIA SINICA Mathematica, 50\(3\), 367\./);
    assert.match(c.mla, /vol\. 50, no\. 3, 2020, p\. 367,/);
    assert.match(c.chicago, /SCIENTIA SINICA Mathematica 50, no\. 3 \(2020\): 367\./);
    assert.match(c.vancouver, /2020;50\(3\):367\./);
    assert.match(c.bibtex, /volume=\{50\}/);
    assert.match(c.bibtex, /number=\{3\}/);
    assert.match(c.bibtex, /pages=\{367\}/);
  });

  it("a ref without a locator formats exactly as before (no stray segments)", async () => {
    const add = await call("reference-add", CTX, {
      title: "Locatorless paper", authors: "Jane Doe", year: 2021, journal: "Some Journal", doi: "10.1/xyz",
    });
    const detail = await call("reference-detail", CTX, { id: add.result.reference.id });
    const c = detail.result.citations;
    assert.match(c.apa, /Some Journal\. https:\/\/doi\.org\/10\.1\/xyz$/);
    assert.ok(!/vol\.|no\.|pp?\./.test(c.mla.replace("Doe, Jane.", "")), c.mla);
  });
});

describe("FIX-society-010 — latestPerKey keeps one latest row per key", () => {
  const rows = [
    { countryiso3code: "USA", date: "2019", value: 1 },
    { countryiso3code: "USA", date: "2023", value: 2 },
    { countryiso3code: "USA", date: "2021", value: 3 },
    { countryiso3code: "FRA", date: "2020", value: 4 },
    { countryiso3code: "", date: "2020", value: 5 },
    { country: { id: "CHN" }, date: "2018", value: 6 },
  ];
  it("collapses duplicates to the latest year and drops keyless rows", () => {
    const out = latestPerKey(rows, (r) => r.countryiso3code || r.country?.id, (r) => r.date);
    assert.equal(out.length, 3);
    const usa = out.find((r) => (r.countryiso3code || r.country?.id) === "USA");
    assert.equal(usa.value, 2);
    assert.equal(usa.date, "2023");
  });
});
