// Realestate full build (GB-1089 pair) — pins for the truth-labelling
// repairs Review 5's first pass + the Lead compilation priced:
//   F3 — the AVM's printed confidence must equal its delivered spread.
//   F6 — the hot score carries its basis (a fresh listing's 75 is the
//        freshness bonus over the base, not market heat).
//   F4 — feed-items reads the ingested Census DTUs back and names
//        the source (the feed was unverifiable by construction).
//   F5 — Census sentinel values normalize to null, never print as data.

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

describe("realestate full build — F3: the AVM label tells the truth", () => {
  it("confidenceErrorPct equals the delivered ± spread of the bounds", () => {
    const r = call("avm-estimate", ctxA, { sqft: 2000, beds: 3, baths: 2, zipMedianPpsf: 150 });
    assert.equal(r.ok, true);
    const { estimate, lowEstimate, highEstimate, confidenceErrorPct } = r.result;
    assert.equal(confidenceErrorPct, 0.08);
    assert.ok(Math.abs(lowEstimate / estimate - 0.92) < 0.01, `low bound is the printed spread (${lowEstimate}/${estimate})`);
    assert.ok(Math.abs(highEstimate / estimate - 1.08) < 0.01, `high bound is the printed spread (${highEstimate}/${estimate})`);
  });
});

describe("realestate full build — F6: the hot score states its basis", () => {
  it("a brand-new listing scores 75 = base 50 + freshness 25, and a favourite adds exactly 5", () => {
    const added = call("listings-add", ctxA, { address: "1 Main St", price: 300000 });
    assert.equal(added.ok, true);
    const id = added.result.listing.id;
    const fresh = call("hot-score", ctxA, { listingId: id });
    assert.equal(fresh.result.score, 75);
    assert.deepEqual(fresh.result.basis, { base: 50, marketAge: 25, priceDrop: 0, tours: 0, favourite: 0 });
    const toggled = call("favourites-toggle", ctxA, { id });
    assert.equal(toggled.ok, true);
    assert.equal(toggled.result.favourited, true);
    const faved = call("hot-score", ctxA, { listingId: id });
    assert.equal(faved.result.score, 80);
    assert.equal(faved.result.basis.favourite, 5);
  });
});

describe("realestate full build — F4: feed items are inspectable, source named", () => {
  it("feed-items reads the ingested DTUs back with state + median value", async () => {
    globalThis._concordSTATE.realestateLens = { searches: new Map(), feedSeen: new Set(["acs_homevalue_36_2023"]) };
    const ctx = {
      ...ctxA,
      macro: {
        run: async (domain, action, input) => {
          assert.equal(domain, "dtu");
          assert.equal(action, "get");
          assert.equal(input.id, "acs_homevalue_36_2023");
          return { ok: true, dtu: { id: input.id, title: "Median home value: New York (2023)", meta: { state: "New York", fips: "36", medianValue: 384100, year: 2023 } } };
        },
      },
    };
    const r = await call("feed-items", ctx, {});
    assert.equal(r.ok, true);
    assert.match(r.result.source, /Census Bureau/);
    assert.equal(r.result.items.length, 1);
    assert.equal(r.result.items[0].state, "New York");
    assert.equal(r.result.items[0].medianValue, 384100);
  });

  it("feed-items is honestly empty before any pull", async () => {
    const ctx = { ...ctxA, macro: { run: async () => ({ ok: false }) } };
    const r = await call("feed-items", ctx, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.items, []);
  });
});

describe("realestate full build — F5: Census sentinels never print as data", () => {
  it("a -666666666 median age normalizes to null while real values survive", async () => {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes("geocoding.geo.census.gov")) {
        return {
          ok: true,
          json: async () => ({
            result: {
              addressMatches: [{
                matchedAddress: "1 MAIN ST",
                coordinates: { x: -73.9, y: 41.7 },
                geographies: { "Census Tracts": [{ STATE: "36", COUNTY: "027", TRACT: "010100" }] },
              }],
            },
          }),
        };
      }
      if (u.includes("api.census.gov")) {
        const headers = ["NAME", "B19013_001E", "B01003_001E", "B01002_001E", "B15003_022E", "B25003_002E", "B25003_003E", "B08303_001E"];
        const row = ["Tract 101", "85000", "4200", "-666666666", "900", "1800", "700", "1500"];
        return { ok: true, json: async () => [headers, row] };
      }
      throw new Error(`unexpected fetch ${u}`);
    };
    const r = await call("neighborhood-stats", ctxA, { address: "1 Main St" });
    assert.equal(r.ok, true);
    assert.equal(r.result.demographics.medianAge, null);
    assert.equal(r.result.economics.medianHouseholdIncome, 85000);
    assert.equal(r.result.demographics.totalPopulation, 4200);
  });
});
