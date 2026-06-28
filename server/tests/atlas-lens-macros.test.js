// Behavioral macro tests for server/domains/atlas.js — the geo/maps substrate
// the /lenses/atlas lens drives (geocode, distance matrices, region stats, TSP
// route optimization, plus the OSM-backed live_* family).
//
// This file mirrors the REAL LENS_ACTIONS dispatch: handlers registered via
// `registerLensAction(domain, action, handler)` are invoked as
// `handler(ctx, virtualArtifact, input)` — the 3-ARG convention with
// `virtualArtifact.data = input`. The dispatch ALSO peels exactly one
// redundant `{ artifact: { data } }` wrapper (lens-input-normalize.js); two
// atlas panels (DistanceMatrixPanel, MapsDirections, AtlasActionPanel) send the
// double-wrapped shape, so our harness peels it the same way before calling.
//
// These are NOT shape-only assertions and they DO NOT duplicate the existing
// atlas parity suites. They pin ACTUAL geodesy (haversine distance, bearing,
// nearest-neighbor + 2-opt TSP, Gini concentration) for KNOWN inputs → KNOWN
// outputs, the EXACT field names each lens component renders (so a dead-surface
// regression surfaces here), validation-rejection, graceful degradation, and a
// fail-CLOSED poisoned-numeric contract: Infinity/NaN/1e308 coordinates are
// REJECTED rather than leaking Infinity/NaN (serialized null) into the result.
// External-IO macros (nominatim/overpass/osrm/mapillary) are asserted to
// validate+reject bad input WITHOUT performing a network call.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAtlasActions from "../domains/atlas.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "atlas", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror the live dispatch exactly: peel one redundant artifact wrapper, then
// handler(ctx, virtualArtifact, input) with virtualArtifact.data = input.
function call(name, ctx, rawInput = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`atlas.${name} not registered`);
  const input = peelRedundantArtifactWrapper(rawInput);
  const virtualArtifact = { id: null, title: null, domain: "atlas", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerAtlasActions(registerLensAction); });

let fetchCalls = 0;
beforeEach(() => {
  // No boot, no network, no LLM. Any handler that reaches for the network in a
  // test marks itself as a leak via fetchCalls.
  fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error("network disabled in tests"); };
  globalThis._concordSTATE = { atlasLens: undefined };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

// Reference coordinates the handler's built-in table and the tests share.
const NYC = { name: "NYC", lat: 40.7128, lon: -74.006 };
const LA = { name: "LA", lat: 34.0522, lon: -118.2437 };
const CHI = { name: "CHI", lat: 41.8781, lon: -87.6298 };

describe("atlas — registration (every lens-driven macro present)", () => {
  it("registers the deterministic compute macros the lens components call", () => {
    for (const m of [
      // The four page "Atlas Compute Actions" buttons + DistanceMatrixPanel +
      // MapsDirections + AtlasActionPanel pure-compute surface.
      "geocode", "distanceMatrix", "regionStats", "routeOptimize",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing atlas.${m}`);
    }
  });

  it("registers the external-IO (OSM/OSRM/Mapillary) macros the panels drive", () => {
    for (const m of [
      "nominatim-geocode", "nominatim-reverse", "overpass-poi",
      "directions", "directions-multimodal", "live-traffic-eta",
      "transit-directions", "route-stops", "street-imagery", "place-details",
      "nav-start", "nav-update",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing atlas.${m}`);
    }
  });
});

// ── atlas.geocode — name→coords + haversine distance/bearing ───────────────
describe("atlas.geocode — reference resolution + distance/bearing from origin", () => {
  it("resolves known cities, computes real distance + cardinal direction from origin", () => {
    // EXACT shape the page's geocode action operates over (artifact.data.places
    // + origin). The page renders resolvedCount/unresolvedCount + each
    // resolved row's name/lat/lon/distanceFromOriginKm.
    const r = call("geocode", ctxA, { places: [{ name: "London" }, { name: "Tokyo" }, { name: "Nowhereville" }], origin: { lat: NYC.lat, lon: NYC.lon } });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.count, 3);
    assert.equal(res.resolvedCount, 2);
    assert.equal(res.unresolvedCount, 1);
    const london = res.resolved.find((p) => p.name === "London");
    // London is in the built-in reference table; coords echoed exactly.
    assert.equal(london.resolved, true);
    assert.equal(london.lat, 51.5074);
    assert.equal(london.lon, -0.1278);
    // Real haversine from NYC → London ≈ 5570 km, bearing roughly NE.
    assert.ok(Math.abs(london.distanceFromOriginKm - 5570.22) < 1, `dist ${london.distanceFromOriginKm}`);
    assert.equal(london.directionFromOrigin, "NE");
    assert.equal(london.hemisphere, "Northern");
    // The unresolved entry is honest — no fabricated 0,0 coordinate.
    const miss = res.resolved.find((p) => p.name === "Nowhereville");
    assert.equal(miss.resolved, false);
    assert.match(miss.message, /Could not resolve/);
    // nearestToOrigin is a real ranking across resolved places.
    assert.equal(res.nearestToOrigin, "London");
  });

  it("honors provided lat/lon over the reference table", () => {
    const r = call("geocode", ctxA, { places: [{ name: "Custom", lat: 10, lon: 20 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.resolved[0].source, "provided");
    assert.equal(r.result.resolved[0].lat, 10);
    assert.equal(r.result.resolved[0].lon, 20);
  });

  it("degrade-graceful: no places → guidance message, not a crash", () => {
    const r = call("geocode", ctxA, {});
    assert.equal(r.ok, true);
    assert.match(r.result.message, /No places provided/);
    assert.deepEqual(r.result.resolved, []);
  });

  it("fail-CLOSED: a poisoned Infinity provided coord is treated as unresolved (never NaN distance)", () => {
    const r = call("geocode", ctxA, { places: [{ name: "zzz_unknown", lat: Infinity, lon: 1 }], origin: { lat: NYC.lat, lon: NYC.lon } });
    assert.equal(r.ok, true);
    // Unknown name + poisoned coords ⇒ honestly unresolved, no NaN leaked.
    const row = r.result.resolved[0];
    assert.equal(row.resolved, false);
    // The poisoned coord never produced a distance/bearing field at all.
    assert.equal(row.distanceFromOriginKm, undefined);
    assert.equal(row.bearingFromOrigin, undefined);
    // No serialized NaN slipped into the row.
    assert.ok(!Object.values(row).some((v) => typeof v === "number" && Number.isNaN(v)), "no NaN in row");
  });
});

// ── atlas.distanceMatrix — NxN haversine + DistanceMatrixPanel field contract ─
describe("atlas.distanceMatrix — real geodesy + every rendered field", () => {
  it("computes the NxN km matrix + stats the DistanceMatrixPanel renders", () => {
    // EXACT double-wrapped shape DistanceMatrixPanel.callAtlas sends.
    const r = call("distanceMatrix", ctxA, { artifact: { data: { points: [NYC, LA, CHI] } } });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.deepEqual(res.labels, ["NYC", "LA", "CHI"]);
    // Symmetric NxN number matrix (the heatmap reads matrix as number[][]).
    assert.equal(res.matrix.length, 3);
    assert.equal(res.matrix[0][1], res.matrix[1][0]);
    assert.equal(res.matrix[0][0], 0);
    // NYC→LA ≈ 3935.75 km (pinned haversine).
    assert.equal(res.matrix[0][1], 3935.75);
    // stats aliases the panel renders directly (meanKm / maxKm / maxPair / minPair).
    assert.equal(res.stats.maxKm, 3935.75);
    assert.deepEqual(res.stats.maxPair, ["NYC", "LA"]);
    assert.equal(res.stats.meanKm, res.stats.averageDistanceKm);
    assert.equal(res.stats.maxKm, res.stats.maxDistanceKm);
    assert.equal(res.stats.minKm, res.stats.minDistanceKm);
    assert.deepEqual(res.stats.minPair, res.stats.minDistancePair);
    // Flat pair list + nearest — the AtlasActionPanel field contract.
    assert.equal(res.pairs.length, 3); // C(3,2)
    const nycLa = res.pairs.find((p) => p.from === "NYC" && p.to === "LA");
    assert.equal(nycLa.distanceKm, 3935.75);
    assert.ok(Number.isFinite(nycLa.estTimeMinutes) && nycLa.estTimeMinutes > 0);
    assert.equal(res.nearest.from, "NYC");
    assert.equal(res.nearest.to, "CHI"); // closest pair of the three
    assert.equal(res.nearest.distanceKm, res.stats.minKm);
  });

  it("accepts the AtlasActionPanel lng-keyed shape identically to lon", () => {
    // AtlasActionPanel sends points with `lng`; DistanceMatrixPanel sends `lon`.
    const withLng = call("distanceMatrix", ctxA, { artifact: { data: { points: [{ name: "NYC", lat: 40.7128, lng: -74.006 }, { name: "LA", lat: 34.0522, lng: -118.2437 }] } } });
    const withLon = call("distanceMatrix", ctxA, { artifact: { data: { points: [NYC, LA] } } });
    assert.equal(withLng.ok, true);
    // lng path must NOT collapse to 0 distance — the historical dead-surface bug.
    assert.equal(withLng.result.matrix[0][1], withLon.result.matrix[0][1]);
    assert.equal(withLng.result.matrix[0][1], 3935.75);
  });

  it("validation-rejection: fewer than 2 points → guidance message", () => {
    const r = call("distanceMatrix", ctxA, { artifact: { data: { points: [NYC] } } });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /at least 2 points/i);
  });

  it("fail-CLOSED: poisoned Infinity/1e308 coords are REJECTED, never emit null", () => {
    const inf = call("distanceMatrix", ctxA, { artifact: { data: { points: [{ name: "X", lat: Infinity, lon: 1e308 }, { name: "Y", lat: 1, lon: 2 }] } } });
    assert.equal(inf.ok, false);
    assert.match(inf.error, /finite/);
    const big = call("distanceMatrix", ctxA, { artifact: { data: { points: [{ name: "X", lat: 1e308, lon: 0 }, { name: "Y", lat: 1, lon: 2 }] } } });
    assert.equal(big.ok, false);
  });
});

// ── atlas.routeOptimize — nearest-neighbor + 2-opt TSP, MapsDirections shape ─
describe("atlas.routeOptimize — TSP + every rendered route field", () => {
  it("returns an ordered route + legs the DistanceMatrixPanel/MapsDirections render", () => {
    // EXACT double-wrapped shape MapsDirections.optimize sends.
    const r = call("routeOptimize", ctxA, { artifact: { data: { waypoints: [NYC, LA, CHI] } } });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.waypointCount, 3);
    // route is the ordered list of place NAMES (string[]) — the panel iterates it.
    assert.deepEqual(res.route, ["NYC", "CHI", "LA"]);
    // order mirrors route as integer waypoint indices.
    assert.deepEqual(res.order, [0, 2, 1]);
    // legs are { from, to, km } — the MapsDirections "Steps" list.
    assert.equal(res.legs.length, 2);
    assert.equal(res.legs[0].from, "NYC");
    assert.equal(res.legs[0].to, "CHI");
    assert.ok(Number.isFinite(res.legs[0].km) && res.legs[0].km > 0);
    // totalDistanceKm equals the sum of leg km (cross-check).
    const legSum = Math.round(res.legs.reduce((s, l) => s + l.km, 0) * 100) / 100;
    assert.equal(res.totalDistanceKm, legSum);
    // optimizedRoute (the page's render) carries step/name and stays consistent.
    assert.equal(res.optimizedRoute.length, 3);
    assert.equal(res.optimizedRoute[0].step, 1);
    assert.deepEqual(res.optimizedRoute.map((s) => s.name), res.route);
    // The optimizer never returns a route longer than naive input order.
    assert.ok(res.totalDistanceKm <= res.naiveOrderDistanceKm + 0.01);
  });

  it("validation-rejection: fewer than 2 waypoints → guidance message", () => {
    const r = call("routeOptimize", ctxA, { artifact: { data: { waypoints: [NYC] } } });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /at least 2 waypoints/i);
  });

  it("fail-CLOSED: a NaN/non-finite waypoint coord is REJECTED", () => {
    const r = call("routeOptimize", ctxA, { artifact: { data: { waypoints: [{ name: "X", lat: "abc", lon: 0 }, NYC] } } });
    assert.equal(r.ok, false);
    assert.match(r.error, /finite/);
  });
});

// ── atlas.regionStats — totals/averages/Gini concentration ─────────────────
describe("atlas.regionStats — aggregate demographics the page Region Stats panel renders", () => {
  it("computes totals, per-capita, rankings + a real Gini concentration index", () => {
    const r = call("regionStats", ctxA, {
      regions: [
        { name: "Alpha", population: 1000000, area: 500, gdp: 50000000000, growth: 0.02 },
        { name: "Beta", population: 3000000, area: 1500, gdp: 60000000000, growth: 0.04 },
      ],
    });
    assert.equal(r.ok, true);
    const res = r.result;
    // The page renders regionCount + totals + averages + distribution.concentration.
    assert.equal(res.regionCount, 2);
    assert.equal(res.totals.population, 4000000);
    assert.equal(res.totals.gdp, 110000000000);
    // gdpPerCapita = total gdp / total pop.
    assert.equal(res.averages.gdpPerCapita, Math.round((110000000000 / 4000000) * 100) / 100);
    // Gini in [0,1]; concentration label is a pure function of it.
    assert.ok(res.distribution.populationGini >= 0 && res.distribution.populationGini <= 1);
    const g = res.distribution.populationGini;
    const expected = g > 0.5 ? "highly-concentrated" : g > 0.3 ? "moderately-concentrated" : "evenly-distributed";
    assert.equal(res.distribution.concentration, expected);
    // Rankings sort descending by population.
    assert.equal(res.rankings.byPopulation[0].name, "Beta");
    assert.equal(res.rankings.byPopulation[0].rank, 1);
  });

  it("degrade-graceful: no regions → guidance message", () => {
    const r = call("regionStats", ctxA, {});
    assert.equal(r.ok, true);
    assert.match(r.result.message, /No region data/);
  });

  it("fail-CLOSED: a non-finite metric (Infinity population) is REJECTED, never leaks into Gini", () => {
    const r = call("regionStats", ctxA, { regions: [{ name: "Bad", population: Infinity, area: 1, gdp: 1 }] });
    assert.equal(r.ok, false);
    assert.match(r.error, /non-finite/);
  });

  it("a cosmologically-large-but-finite population is preserved (no false rejection)", () => {
    const r = call("regionStats", ctxA, { regions: [{ name: "Huge", population: 1e12, area: 1, gdp: 1 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.totals.population, 1e12);
  });
});

// ── External-IO macros — validate+reject WITHOUT a network call ─────────────
describe("atlas external-IO — validation-rejection happens BEFORE any fetch", () => {
  it("nominatim-geocode rejects an empty query without touching the network", async () => {
    const r = await call("nominatim-geocode", ctxA, { query: "   " });
    assert.equal(r.ok, false);
    assert.match(r.error, /query required/);
    assert.equal(fetchCalls, 0, "no network call on validation-reject");
  });

  it("nominatim-reverse rejects non-numeric lat/lng without a fetch", async () => {
    const r = await call("nominatim-reverse", ctxA, { latitude: "x", longitude: "y" });
    assert.equal(r.ok, false);
    assert.match(r.error, /latitude \+ longitude required/);
    assert.equal(fetchCalls, 0);
  });

  it("overpass-poi rejects an invalid bbox (south >= north) without a fetch", async () => {
    const r = await call("overpass-poi", ctxA, { south: 10, west: 0, north: 5, east: 5 });
    assert.equal(r.ok, false);
    assert.match(r.error, /bbox invalid/);
    assert.equal(fetchCalls, 0);
  });

  it("directions rejects <2 waypoints without a fetch", async () => {
    const r = await call("directions", ctxA, { waypoints: [{ lat: 1, lng: 2 }] });
    assert.equal(r.ok, false);
    assert.match(r.error, /at least 2 waypoints/);
    assert.equal(fetchCalls, 0);
  });

  it("route-stops rejects a missing start/end without a fetch", async () => {
    const r = await call("route-stops", ctxA, { start: {}, end: {} });
    assert.equal(r.ok, false);
    assert.match(r.error, /numeric lat\/lng/);
    assert.equal(fetchCalls, 0);
  });

  it("transit-directions rejects a missing start/end without a fetch", async () => {
    const r = await call("transit-directions", ctxA, { start: {}, end: { lat: 1, lng: 2 } });
    assert.equal(r.ok, false);
    assert.equal(fetchCalls, 0);
  });

  it("street-imagery rejects non-numeric lat/lng without a fetch", async () => {
    const r = await call("street-imagery", ctxA, { lat: "a", lng: "b" });
    assert.equal(r.ok, false);
    assert.match(r.error, /numeric lat\/lng/);
    assert.equal(fetchCalls, 0);
  });

  it("place-details rejects a missing osmType/osmId without a fetch", async () => {
    const r = await call("place-details", ctxA, { osmType: "bogus", osmId: "x" });
    assert.equal(r.ok, false);
    assert.equal(fetchCalls, 0);
  });
});
