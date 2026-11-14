// FIX-aviation-005 — airport-lookup depended on ONE free API with no
// fallback: a network-level failure of api.aviationapi.com (the walker's
// KJFK 'airport lookup failed: fetch failed', reproduced at fix time
// from a second egress: TLS completes, the API drops the request)
// failed the whole lookup, although aviation.js's own header promised
// an OurAirports CC0 fallback that was never built. The fallback now
// exists: the CC0 airports.csv, indexed by ident/gps/iata, consulted on
// a primary throw, a primary HTTP error, and a primary not-found — and
// it only replaces the outcome when it actually finds the airport;
// otherwise the primary's original error stands verbatim.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAviationActions from "../domains/aviation.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`aviation.${name}`);
  if (!fn) throw new Error(`aviation.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

// Re-register per test: the fallback index is registration-closure
// state, so a fresh registration is a cold cache.
beforeEach(() => { ACTIONS.clear(); registerAviationActions(register); });

const CSV = [
  "id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,gps_code,iata_code,local_code,home_link,wikipedia_link,keywords",
  '3622,"KJFK","large_airport","John F. Kennedy International Airport",40.639447,-73.779317,13,"NA","US","US-NY","New York","yes","KJFK","JFK","KJFK","","",""',
  '6523,"EGLL","large_airport","London Heathrow Airport",51.4706,-0.461941,83,"EU","GB","GB-ENG","London","yes","EGLL","LHR","","","",""',
].join("\n");

const ctx = { actor: { userId: "user_a" }, userId: "user_a" };

function stubFetch({ primary, csv = true }) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("davidmegginson.github.io")) {
      if (!csv) throw new Error("fetch failed");
      return { ok: true, text: async () => CSV };
    }
    if (u.includes("api.aviationapi.com")) {
      if (typeof primary === "function") return primary(u);
      throw new Error(primary || "fetch failed");
    }
    throw new Error("unexpected url " + u);
  };
}

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

describe("airport-lookup OurAirports fallback (FIX-aviation-005)", () => {
  it("primary fetch throws -> KJFK resolves from the CC0 fallback with its real fields", async () => {
    stubFetch({ primary: "fetch failed" });
    const r = await call("airport-lookup", ctx, { ident: "KJFK" });
    assert.equal(r.ok, true);
    assert.equal(r.result.airport.name, "John F. Kennedy International Airport");
    assert.equal(r.result.airport.city, "New York, NY");
    assert.ok(Math.abs(r.result.airport.lat - 40.639447) < 1e-6);
    assert.ok(Math.abs(r.result.airport.lng - -73.779317) < 1e-6);
    assert.equal(r.result.airport.elev_ft, 13);
    assert.match(r.result.source, /OurAirports/);
  });

  it("a non-FAA ident the primary reports not-found resolves via the fallback (the documented international case)", async () => {
    stubFetch({
      primary: async () => ({ ok: true, json: async () => ({}) }),
    });
    const r = await call("airport-lookup", ctx, { ident: "EGLL" });
    assert.equal(r.ok, true);
    assert.equal(r.result.airport.name, "London Heathrow Airport");
    // IATA code resolves too
    const byIata = await call("airport-lookup", ctx, { ident: "LHR" });
    assert.equal(byIata.ok, true);
    assert.equal(byIata.result.airport.ident, "EGLL");
  });

  it("when BOTH sources are down the original primary error stands verbatim", async () => {
    stubFetch({ primary: "fetch failed", csv: false });
    const r = await call("airport-lookup", ctx, { ident: "KJFK" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "airport lookup failed: fetch failed");
  });

  it("an ident in neither source keeps the not-found wording", async () => {
    stubFetch({ primary: async () => ({ ok: true, json: async () => ({}) }) });
    const r = await call("airport-lookup", ctx, { ident: "ZZZZ" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found in FAA database/);
  });
});
