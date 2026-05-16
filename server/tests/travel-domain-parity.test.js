// Contract tests for server/domains/travel.js — pure-math macros
// plus real REST Countries + exchangerate.host integrations.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTravelActions from "../domains/travel.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`travel.${name}`);
  if (!fn) throw new Error(`travel.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerTravelActions(register); });

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("travel.tripBudget (pure-compute)", () => {
  it("flags derived flightCost when user doesn't supply one", () => {
    const r = call("tripBudget", ctxA, { data: { destination: "Lisbon", days: 5, travelStyle: "moderate" } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.flightCostSource, "derived");
    assert.equal(r.result.destination, "Lisbon");
  });

  it("uses user-supplied flightCost when provided", () => {
    const r = call("tripBudget", ctxA, { data: { destination: "X", days: 5, flightCost: 850 } }, {});
    assert.equal(r.result.flightCostSource, "user");
    assert.equal(r.result.breakdown.flights, 850);
  });

  it("scales daily by style", () => {
    const budget = call("tripBudget", ctxA, { data: { days: 7, travelStyle: "budget" } }, {}).result;
    const luxury = call("tripBudget", ctxA, { data: { days: 7, travelStyle: "luxury" } }, {}).result;
    assert.ok(luxury.totalEstimate > budget.totalEstimate * 3);
  });
});

describe("travel.country-info (REST Countries)", () => {
  it("rejects empty country", async () => {
    const r = await call("country-info", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("hits /alpha for ISO codes + shapes real response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([{
          name: { common: "Japan", official: "Japan" },
          cca2: "JP", cca3: "JPN",
          capital: ["Tokyo"], region: "Asia", subregion: "Eastern Asia",
          population: 125_836_021, area: 377975,
          currencies: { JPY: { name: "Japanese yen", symbol: "¥" } },
          languages: { jpn: "Japanese" },
          timezones: ["UTC+09:00"],
          idd: { root: "+8", suffixes: ["1"] },
          car: { side: "left" },
          postalCode: { format: "###-####" },
          latlng: [36, 138],
          flags: { svg: "https://flagcdn.com/jp.svg" },
        }]),
      };
    };
    const r = await call("country-info", ctxA, { country: "JP" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /restcountries\.com\/v3\.1\/alpha\/JP/);
    assert.equal(r.result.name, "Japan");
    assert.equal(r.result.capital, "Tokyo");
    assert.equal(r.result.currencies[0].code, "JPY");
    assert.equal(r.result.callingCode, "+81");
    assert.equal(r.result.drivingSide, "left");
    assert.equal(r.result.source, "rest-countries");
  });

  it("hits /name for common-name lookups", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([{ name: { common: "Brazil" }, cca2: "BR", cca3: "BRA" }]),
      };
    };
    await call("country-info", ctxA, { country: "Brazil" });
    assert.match(capturedUrl, /restcountries\.com\/v3\.1\/name\/Brazil/);
  });

  it("returns explicit not-found on 404", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("country-info", ctxA, { country: "ZZ" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });

  it("surfaces other network failures", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const r = await call("country-info", ctxA, { country: "JP" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable.*503/);
  });
});

describe("travel.currency-convert (exchangerate.host / ECB)", () => {
  it("rejects bad inputs", async () => {
    assert.equal((await call("currency-convert", ctxA, {})).ok, false);
    assert.equal((await call("currency-convert", ctxA, { amount: 100 })).ok, false);
    assert.equal((await call("currency-convert", ctxA, { amount: 100, from: "USD" })).ok, false);
    assert.equal((await call("currency-convert", ctxA, { amount: 100, from: "USD", to: "ZZZZ" })).ok, false);
    assert.equal((await call("currency-convert", ctxA, { amount: -5, from: "USD", to: "EUR" })).ok, false);
  });

  it("hits exchangerate.host + shapes the response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({ success: true, date: "2026-05-16", info: { rate: 0.9234 }, result: 92.34 }),
      };
    };
    const r = await call("currency-convert", ctxA, { amount: 100, from: "USD", to: "EUR" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.exchangerate\.host\/convert/);
    assert.match(capturedUrl, /from=USD&to=EUR&amount=100/);
    assert.equal(r.result.converted, 92.34);
    assert.equal(r.result.rate, 0.9234);
    assert.equal(r.result.source, "exchangerate.host (ECB)");
  });

  it("supports historical date queries", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ success: true, date: "2024-01-01", info: { rate: 0.9 }, result: 90 }) };
    };
    await call("currency-convert", ctxA, { amount: 100, from: "USD", to: "EUR", date: "2024-01-01" });
    assert.match(capturedUrl, /api\.exchangerate\.host\/2024-01-01\/convert/);
  });

  it("surfaces network failures", async () => {
    const r = await call("currency-convert", ctxA, { amount: 100, from: "USD", to: "EUR" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable/);
  });
});

describe("travel.visaCheck (real bilateral tables)", () => {
  it("rejects missing destination", () => {
    const r = call("visaCheck", ctxA, { data: { passportCountry: "US" } }, {});
    assert.equal(r.ok, false);
  });

  it("recognizes Schengen freedom-of-movement for EU citizen → Schengen state", () => {
    const r = call("visaCheck", ctxA, { data: { passportCountry: "FR", destination: "DE", durationDays: 60 } }, {});
    assert.equal(r.result.arrangement, "schengen-freedom-of-movement");
    assert.equal(r.result.visaRequired, false);
    assert.equal(r.result.maxFreeStay, "unlimited");
  });

  it("recognizes Common Travel Area for UK ↔ Ireland", () => {
    const r = call("visaCheck", ctxA, { data: { passportCountry: "GB", destination: "IE" } }, {});
    assert.equal(r.result.arrangement, "common-travel-area");
  });

  it("recognizes USMCA for US/CA/MX up to 180 days", () => {
    const r = call("visaCheck", ctxA, { data: { passportCountry: "US", destination: "CA", durationDays: 90 } }, {});
    assert.equal(r.result.arrangement, "usmca-bilateral");
    assert.equal(r.result.visaRequired, false);
    const longStay = call("visaCheck", ctxA, { data: { passportCountry: "US", destination: "MX", durationDays: 200 } }, {});
    assert.equal(longStay.result.visaRequired, true);
  });

  it("INVARIANT: returns unknown + 'consult embassy' for non-bilateral pairs (never synthesizes)", () => {
    const r = call("visaCheck", ctxA, { data: { passportCountry: "US", destination: "JP", durationDays: 14 } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.arrangement, null);
    assert.equal(r.result.visaRequired, null);
    assert.equal(r.result.source, "unknown");
    assert.match(r.result.disclaimer, /Concord does not synthesize visa requirements/);
  });
});
