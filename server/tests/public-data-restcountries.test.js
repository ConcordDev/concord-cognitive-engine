// FIX-global-003 — the country atlas's upstream was a dead API version.
//
// restcountries.com v3.1 is deprecated: it 301-redirects to a
// deprecation envelope ({ success:false, data:null, errors:[…] }), so
// the atlas received an envelope where a country array belongs and
// showed "unavailable" on every view, from any host — and the v5 API
// requires an authorization key. fetchRestCountries now reads the open
// dataset v3.1 itself was built from (mledoze/countries via jsDelivr)
// and joins population from the World Bank's keyless SP.POP.TOTL
// indicator by ISO-3 code, latest year winning. These pins drive the
// real accessor through the stubbed test transport:
//   - a region returns v3.1-shaped rows with joined populations;
//   - the deprecated v3.1 endpoint is never requested;
//   - either source failing (or answering an envelope) fails the
//     fetch — the cache's stale copy or the honest unavailable state
//     serves, never a population-less atlas presented as real.
//
// Run: cd server && NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs tests/public-data-restcountries.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getRestCountriesRegion,
  _resetPublicDataForTests, setPublicDataTransportForTests,
} from "../lib/public-data-sources.js";

const DATASET = [
  { name: { common: "France", official: "French Republic" }, cca3: "FRA", capital: ["Paris"], region: "Europe", subregion: "Western Europe", area: 551695, languages: { fra: "French" }, currencies: { EUR: { name: "Euro", symbol: "€" } } },
  { name: { common: "Germany", official: "Federal Republic of Germany" }, cca3: "DEU", capital: ["Berlin"], region: "Europe", subregion: "Western Europe", area: 357114, languages: { deu: "German" }, currencies: { EUR: { name: "Euro", symbol: "€" } } },
  { name: { common: "Japan", official: "Japan" }, cca3: "JPN", capital: ["Tokyo"], region: "Asia", subregion: "Eastern Asia", area: 377930, languages: { jpn: "Japanese" }, currencies: { JPY: { name: "Japanese yen", symbol: "¥" } } },
  { name: { common: "Antarctica", official: "Antarctica" }, cca3: "ATA", capital: [], region: "Antarctic", area: 14000000, languages: {}, currencies: {} },
];
const WB = [
  { page: 1, pages: 1, per_page: 1000, total: 5 },
  [
    { countryiso3code: "FRA", date: "2023", value: 68372286 },
    { countryiso3code: "FRA", date: "2024", value: 68551653 },
    { countryiso3code: "DEU", date: "2024", value: 83491249 },
    { countryiso3code: "JPN", date: "2024", value: 123753041 },
    { countryiso3code: "EUU", date: "2024", value: 450000000 },
  ],
];

// What the deprecated v3.1 endpoint served while it lived — an array
// carrying its own (here deliberately different) population figures.
// Serving it lets the pristine fetcher succeed, so every pin below
// discriminates on behaviour, not on the stub refusing a URL.
const V31 = [
  { name: { common: "France", official: "French Republic" }, cca3: "FRA", capital: ["Paris"], region: "Europe", subregion: "Western Europe", population: 67000000, area: 551695, languages: { fra: "French" }, currencies: { EUR: { name: "Euro", symbol: "€" } } },
  { name: { common: "Germany", official: "Federal Republic of Germany" }, cca3: "DEU", capital: ["Berlin"], region: "Europe", subregion: "Western Europe", population: 83000000, area: 357114, languages: { deu: "German" }, currencies: { EUR: { name: "Euro", symbol: "€" } } },
];

let calls;
function transport(handler) {
  calls = [];
  setPublicDataTransportForTests(async (url, init) => {
    calls.push(String(url));
    const body = handler(String(url));
    if (body instanceof Error) throw body;
    if (typeof body === "number") return { ok: false, status: body, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  });
}
const healthy = (url) => {
  if (url.includes("mledoze/countries")) return DATASET;
  if (url.includes("api.worldbank.org")) return WB;
  if (url.includes("restcountries.com/v3.1")) return V31;
  throw new Error(`unexpected url ${url}`);
};

beforeEach(() => {
  _resetPublicDataForTests();
  calls = [];
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

describe("restcountries region after the v3.1 deprecation (FIX-global-003)", () => {
  it("returns v3.1-shaped rows for the region with the latest World Bank population joined by ISO-3", async () => {
    transport(healthy);
    const r = await getRestCountriesRegion({ region: "Europe" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.data.length, 2);
    const fra = r.data.find((c) => c.cca3 === "FRA");
    assert.equal(fra.name.common, "France");
    assert.deepEqual(fra.capital, ["Paris"]);
    assert.equal(fra.population, 68551653); // the 2024 value, not 2023's
    assert.equal(fra.languages.fra, "French");
    assert.equal(fra.currencies.EUR.name, "Euro");
    assert.equal(r.data.find((c) => c.cca3 === "DEU").population, 83491249);
    assert.ok(!calls.some((u) => u.includes("restcountries.com/v3.1")), "the deprecated endpoint must not be requested");
  });

  it("a country with no World Bank row keeps population 0 rather than a fabricated figure", async () => {
    transport(healthy);
    const r = await getRestCountriesRegion({ region: "Antarctic" });
    assert.equal(r.ok, true);
    assert.equal(r.data.length, 1);
    assert.equal(r.data[0].cca3, "ATA");
    assert.equal(r.data[0].population, 0);
  });

  it("the population source failing fails the fetch — no population-less atlas", async () => {
    transport((url) => (url.includes("api.worldbank.org") ? new Error("wb down") : healthy(url)));
    const r = await getRestCountriesRegion({ region: "Europe" });
    assert.equal(r.ok, false);
    assert.equal(r.status, "unavailable");
  });

  it("a deprecation-style envelope from the dataset URL fails the fetch instead of parsing as countries", async () => {
    transport((url) => (url.includes("mledoze/countries")
      ? { success: false, data: null, errors: [{ message: "deprecated" }] }
      : healthy(url)));
    const r = await getRestCountriesRegion({ region: "Europe" });
    assert.equal(r.ok, false);
    assert.equal(r.status, "unavailable");
  });
});
