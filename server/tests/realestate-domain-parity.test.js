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

// ── Full-app parity (Zillow/Redfin 2026) ───────────────────────

describe("realestate.listings-* (CRUD + search)", () => {
  it("add / list / get / delete cycle, per-user scoped", () => {
    const added = call("listings-add", ctxA, { address: "123 Main", price: 500000, beds: 3, baths: 2, sqft: 1800, city: "Austin", state: "TX" });
    assert.equal(added.ok, true);
    const id = added.result.listing.id;
    const list = call("listings-list", ctxA, {});
    assert.equal(list.result.listings.length, 1);
    assert.equal(call("listings-list", ctxB, {}).result.listings.length, 0);
    const got = call("listings-get", ctxA, { id });
    assert.equal(got.result.listing.beds, 3);
    const del = call("listings-delete", ctxA, { id });
    assert.equal(del.ok, true);
    assert.equal(call("listings-list", ctxA, {}).result.listings.length, 0);
  });
  it("rejects invalid input", () => {
    assert.equal(call("listings-add", ctxA, { address: "", price: 100 }).ok, false);
    assert.equal(call("listings-add", ctxA, { address: "x", price: 0 }).ok, false);
    assert.equal(call("listings-get", ctxA, { id: "nope" }).ok, false);
  });
  it("sort by price asc/desc", () => {
    call("listings-add", ctxA, { address: "a", price: 300000 });
    call("listings-add", ctxA, { address: "b", price: 100000 });
    call("listings-add", ctxA, { address: "c", price: 200000 });
    const asc = call("listings-list", ctxA, { sortBy: "price_asc" });
    assert.equal(asc.result.listings[0].price, 100000);
    const desc = call("listings-list", ctxA, { sortBy: "price_desc" });
    assert.equal(desc.result.listings[0].price, 300000);
  });
  it("search filters by price/beds/baths/sqft/kind/city", () => {
    call("listings-add", ctxA, { address: "a", price: 500000, beds: 3, baths: 2, sqft: 2000, city: "Austin", kind: "single_family" });
    call("listings-add", ctxA, { address: "b", price: 300000, beds: 2, baths: 1, sqft: 1000, city: "Dallas", kind: "condo" });
    call("listings-add", ctxA, { address: "c", price: 700000, beds: 4, baths: 3, sqft: 3000, city: "Austin", kind: "single_family" });
    const r = call("listings-search", ctxA, { filters: { minBeds: 3, maxPrice: 600000, kinds: ["single_family"], city: "austin" } });
    assert.equal(r.result.matches.length, 1);
    assert.equal(r.result.matches[0].beds, 3);
  });
});

describe("realestate.favourites-* (toggle + list)", () => {
  it("toggle adds / removes; list returns full listings", () => {
    const added = call("listings-add", ctxA, { address: "x", price: 400000 });
    const id = added.result.listing.id;
    const t1 = call("favourites-toggle", ctxA, { id });
    assert.equal(t1.result.favourited, true);
    const l1 = call("favourites-list", ctxA, {});
    assert.equal(l1.result.favourites.length, 1);
    const t2 = call("favourites-toggle", ctxA, { id });
    assert.equal(t2.result.favourited, false);
    assert.equal(call("favourites-list", ctxA, {}).result.favourites.length, 0);
  });
});

describe("realestate.tours-* (request + cancel)", () => {
  it("request / list / cancel cycle", () => {
    const r = call("tours-request", ctxA, { listingId: "lst_x", date: "2026-06-01", time: "10:00" });
    assert.equal(r.ok, true);
    const id = r.result.tour.id;
    assert.equal(call("tours-list", ctxA, {}).result.tours.length, 1);
    const cancelled = call("tours-cancel", ctxA, { id });
    assert.equal(cancelled.result.tour.status, "cancelled");
  });
  it("rejects missing fields", () => {
    assert.equal(call("tours-request", ctxA, { listingId: "", date: "2026-06-01" }).ok, false);
    assert.equal(call("tours-request", ctxA, { listingId: "x", date: "" }).ok, false);
  });
});

describe("realestate.avm-estimate (Zestimate-shape)", () => {
  it("computes deterministic estimate within low/high band", () => {
    const r = call("avm-estimate", ctxA, { sqft: 2000, beds: 3, baths: 2, yearBuilt: 2010, zipMedianPpsf: 280 });
    assert.equal(r.ok, true);
    assert.ok(r.result.estimate > 0);
    assert.ok(r.result.lowEstimate < r.result.estimate);
    assert.ok(r.result.highEstimate > r.result.estimate);
    assert.ok(r.result.pricePerSqft > 0);
    assert.ok(r.result.rentEstimate > 0);
  });
  it("excellent condition > good > fair > poor", () => {
    const base = { sqft: 2000, beds: 3, baths: 2, yearBuilt: 2010 };
    const exc = call("avm-estimate", ctxA, { ...base, condition: "excellent" }).result.estimate;
    const gd = call("avm-estimate", ctxA, { ...base, condition: "good" }).result.estimate;
    const poor = call("avm-estimate", ctxA, { ...base, condition: "poor" }).result.estimate;
    assert.ok(exc > gd);
    assert.ok(gd > poor);
  });
  it("rejects sqft <= 0", () => {
    assert.equal(call("avm-estimate", ctxA, { sqft: 0 }).ok, false);
  });
});

describe("realestate.school-ratings + walk-score + commute-estimate", () => {
  it("school-ratings returns 3 schools with rating 3-10", () => {
    const r = call("school-ratings", ctxA, { address: "123 Main St, Austin, TX" });
    assert.equal(r.ok, true);
    assert.equal(r.result.schools.length, 3);
    for (const s of r.result.schools) {
      assert.ok(s.rating >= 3 && s.rating <= 10);
    }
  });
  it("walk-score returns 0-100 with descriptions", () => {
    const r = call("walk-score", ctxA, { address: "123 Main St" });
    assert.equal(r.ok, true);
    assert.ok(r.result.walkScore >= 0 && r.result.walkScore <= 100);
    assert.ok(typeof r.result.walkDesc === "string");
    assert.ok(typeof r.result.transitDesc === "string");
    assert.ok(typeof r.result.bikeDesc === "string");
  });
  it("commute-estimate scales with mode", () => {
    const drive = call("commute-estimate", ctxA, { from: "A", to: "B", mode: "drive" }).result.minutes;
    const walk = call("commute-estimate", ctxA, { from: "A", to: "B", mode: "walk" }).result.minutes;
    assert.ok(walk > drive);
  });
  it("address-input determinism (same address → same scores)", () => {
    const r1 = call("walk-score", ctxA, { address: "123 Main" });
    const r2 = call("walk-score", ctxA, { address: "123 Main" });
    assert.equal(r1.result.walkScore, r2.result.walkScore);
  });
});

describe("realestate.hot-score", () => {
  it("scores higher for low days-on-market + tours requested", () => {
    const fresh = call("listings-add", ctxA, { address: "fresh", price: 500000, daysOnMarket: 1 });
    const stale = call("listings-add", ctxA, { address: "stale", price: 500000, daysOnMarket: 90 });
    const f = call("hot-score", ctxA, { listingId: fresh.result.listing.id });
    const s = call("hot-score", ctxA, { listingId: stale.result.listing.id });
    assert.ok(f.result.score > s.result.score);
  });
  it("rejects unknown listing", () => {
    assert.equal(call("hot-score", ctxA, { listingId: "nope" }).ok, false);
  });
});

describe("realestate.parse-search-query (AI parser)", () => {
  it("extracts beds, baths, max price, kind, city", () => {
    const r = call("parse-search-query", ctxA, { query: "3 bed 2 bath condo under $500k in Austin with pool" });
    assert.equal(r.ok, true);
    assert.equal(r.result.filters.minBeds, 3);
    assert.equal(r.result.filters.minBaths, 2);
    assert.equal(r.result.filters.maxPrice, 500000);
    assert.deepEqual(r.result.filters.kinds, ["condo"]);
    assert.equal(r.result.filters.city, "austin");
    assert.ok(r.result.tags.includes("pool"));
  });
  it("$1m converts to 1000000", () => {
    const r = call("parse-search-query", ctxA, { query: "house under $1m" });
    assert.equal(r.result.filters.maxPrice, 1_000_000);
  });
  it("empty query rejected", () => {
    assert.equal(call("parse-search-query", ctxA, { query: "" }).ok, false);
  });
});

describe("realestate.compare", () => {
  it("returns 8 spec rows across N listings", () => {
    const a = call("listings-add", ctxA, { address: "a", price: 500000, beds: 3, baths: 2, sqft: 2000, yearBuilt: 2010 });
    const b = call("listings-add", ctxA, { address: "b", price: 700000, beds: 4, baths: 3, sqft: 3000, yearBuilt: 2020 });
    const r = call("compare", ctxA, { ids: [a.result.listing.id, b.result.listing.id] });
    assert.equal(r.ok, true);
    assert.equal(r.result.listings.length, 2);
    assert.equal(r.result.rows.length, 8);
    const priceRow = r.result.rows.find(row => row.field === "Price");
    assert.deepEqual(priceRow.values, [500000, 700000]);
    const ppsfRow = r.result.rows.find(row => row.field === "$/Sqft");
    assert.equal(ppsfRow.values[0], 250);
  });
  it("rejects less than 2 ids", () => {
    assert.equal(call("compare", ctxA, { ids: ["x"] }).ok, false);
  });
});

describe("realestate.agents-* + agent-message + messages-list", () => {
  it("add agent + send message + list messages", () => {
    const ag = call("agents-add", ctxA, { name: "Jane Doe", brokerage: "Acme", email: "jane@x.com", rating: 5 });
    assert.equal(ag.ok, true);
    const msg = call("agent-message", ctxA, { agentId: ag.result.agent.id, text: "Interested in 123 Main" });
    assert.equal(msg.ok, true);
    const list = call("messages-list", ctxA, { agentId: ag.result.agent.id });
    assert.equal(list.result.messages.length, 1);
  });
  it("rejects empty text", () => {
    assert.equal(call("agent-message", ctxA, { agentId: "x", text: "" }).ok, false);
  });
});

describe("realestate.open-houses-upcoming", () => {
  it("returns one event per for_sale listing sorted by date", () => {
    call("listings-add", ctxA, { address: "a", price: 500000, status: "for_sale" });
    call("listings-add", ctxA, { address: "b", price: 600000, status: "sold" });
    const r = call("open-houses-upcoming", ctxA, { days: 14 });
    assert.equal(r.result.events.length, 1);
    assert.equal(r.result.events[0].address, "a");
  });
});

describe("realestate.notes-* (per-listing notes)", () => {
  it("save / list / delete cycle, scoped by listingId", () => {
    const n = call("notes-save", ctxA, { listingId: "lst_a", text: "Loved the kitchen" });
    assert.equal(n.ok, true);
    const list = call("notes-list", ctxA, { listingId: "lst_a" });
    assert.equal(list.result.notes.length, 1);
    assert.equal(call("notes-list", ctxA, { listingId: "lst_b" }).result.notes.length, 0);
    const del = call("notes-delete", ctxA, { id: n.result.note.id });
    assert.equal(del.ok, true);
  });
});

describe("realestate.dashboard-summary (RealtorShell data source)", () => {
  it("aggregates listings + favs + tours + searches + messages", () => {
    const a = call("listings-add", ctxA, { address: "a", price: 500000, status: "for_sale" });
    call("listings-add", ctxA, { address: "b", price: 700000, status: "sold" });
    call("favourites-toggle", ctxA, { id: a.result.listing.id });
    call("tours-request", ctxA, { listingId: a.result.listing.id, date: "2026-06-01" });
    call("save-search", ctxA, { name: "Austin 3br", filters: {} });
    call("agent-message", ctxA, { agentId: "x", text: "hi" });
    const r = call("dashboard-summary", ctxA, {});
    assert.equal(r.result.totalListings, 2);
    assert.equal(r.result.forSaleCount, 1);
    assert.equal(r.result.favouriteCount, 1);
    assert.equal(r.result.upcomingTourCount, 1);
    assert.equal(r.result.savedSearchCount, 1);
    assert.equal(r.result.unreadMessageCount, 1);
    assert.equal(r.result.medianListPrice, 500000);
  });
  it("empty state returns zeros", () => {
    const r = call("dashboard-summary", ctxA, {});
    assert.equal(r.result.totalListings, 0);
    assert.equal(r.result.medianListPrice, 0);
  });
});

