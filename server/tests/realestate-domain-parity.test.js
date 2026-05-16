import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/realestate.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`realestate.${name}`);
  if (!fn) throw new Error(`realestate.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };
const ctxB = { actor: { userId: "v" }, userId: "v" };

describe("realestate — mortgage", () => {
  it("computes PITI for $500k at 7% 30yr 20% down", () => {
    const r = call("calc-mortgage", ctxA, { price: 500_000, downPercent: 20, rate: 7, termYears: 30, taxRate: 1.1, insurance: 1200, hoa: 0 });
    assert.equal(r.ok, true);
    // P&I for $400k at 7% 30yr ≈ $2661
    assert.ok(Math.abs(r.result.monthly.principalAndInterest - 2661) < 5);
    assert.equal(r.result.monthly.pmi, 0); // LTV=80%
  });

  it("adds PMI when LTV > 80%", () => {
    const r = call("calc-mortgage", ctxA, { price: 500_000, downPercent: 10 });
    assert.ok(r.result.monthly.pmi > 0);
  });

  it("rejects invalid rate", () => {
    const r = call("calc-mortgage", ctxA, { price: 500_000, rate: 50 });
    assert.equal(r.ok, false);
  });
});

describe("realestate — affordability", () => {
  it("$120k income → max home around $400-500k", () => {
    const r = call("calc-affordability", ctxA, { grossIncome: 120_000 });
    assert.equal(r.ok, true);
    assert.ok(r.result.maxHomePrice > 300_000);
    assert.ok(r.result.maxHomePrice < 800_000);
  });

  it("classification band returned", () => {
    const r = call("calc-affordability", ctxA, { grossIncome: 200_000 });
    assert.ok(["comfortable", "stretching", "tight"].includes(r.result.band));
  });

  it("rejects zero income", () => {
    const r = call("calc-affordability", ctxA, { grossIncome: 0 });
    assert.equal(r.ok, false);
  });
});

describe("realestate — rent vs buy", () => {
  it("returns chart points + verdict", () => {
    const r = call("calc-rent-vs-buy", ctxA, { price: 500_000, rent: 2500, horizonYears: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.chartPoints.length, 10);
    assert.ok(r.result.verdict);
  });

  it("rejects missing price or rent", () => {
    const r = call("calc-rent-vs-buy", ctxA, { rent: 1000 });
    assert.equal(r.ok, false);
  });
});

describe("realestate — neighborhood-stats (Census ACS live)", () => {
  it("rejects empty address", async () => {
    const r = await call("neighborhood-stats", ctxA, { address: "" });
    assert.equal(r.ok, false);
    assert.match(r.error, /address required/);
  });

  it("returns error when geocoder returns no match", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ result: { addressMatches: [] } }),
    });
    const r = await call("neighborhood-stats", ctxA, { address: "999 Fake St" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not geocoded/);
  });

  it("parses full two-step Census flow", async () => {
    let callIdx = 0;
    globalThis.fetch = async (url) => {
      callIdx++;
      if (url.includes("geocoder")) {
        return {
          ok: true,
          json: async () => ({
            result: { addressMatches: [{
              matchedAddress: "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500",
              coordinates: { x: -77.036, y: 38.898 },
              geographies: { "Census Tracts": [{ STATE: "11", COUNTY: "001", TRACT: "006202" }] },
            }] },
          }),
        };
      }
      // ACS endpoint
      return {
        ok: true,
        json: async () => ([
          ["NAME", "B19013_001E", "B01003_001E", "B01002_001E", "B15003_022E", "B25003_002E", "B25003_003E", "B08303_001E", "state", "county", "tract"],
          ["Census Tract 62.02", "120000", "3500", "38.5", "1200", "800", "700", "5000", "11", "001", "006202"],
        ]),
      };
    };
    const r = await call("neighborhood-stats", ctxA, { address: "1600 Pennsylvania Ave NW, Washington, DC" });
    assert.equal(r.ok, true);
    assert.equal(r.result.demographics.totalPopulation, 3500);
    assert.equal(r.result.economics.medianHouseholdIncome, 120000);
    assert.equal(r.result.housing.ownerOccupiedUnits, 800);
    assert.match(r.result.source, /Census ACS/);
    assert.equal(callIdx, 2); // geocode + ACS
  });
});

describe("realestate — saved searches", () => {
  it("create + list", () => {
    call("save-search", ctxA, { name: "Austin 3BR", alertCadence: "daily" });
    const r = call("saved-searches-list", ctxA);
    assert.equal(r.result.searches.length, 1);
    assert.equal(r.result.searches[0].alertCadence, "daily");
  });

  it("INVARIANT: scoped per-user", () => {
    call("save-search", ctxA, { name: "user A" });
    const b = call("saved-searches-list", ctxB);
    assert.equal(b.result.searches.length, 0);
  });

  it("rejects empty name", () => {
    const r = call("save-search", ctxA, { name: "  " });
    assert.equal(r.ok, false);
  });

  it("defaults alertCadence to weekly", () => {
    const r = call("save-search", ctxA, { name: "x" });
    assert.equal(r.result.search.alertCadence, "weekly");
  });
});
