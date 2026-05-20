// Contract tests for the Google Maps + Felt 2026-parity macros in
// server/domains/atlas.js — saved places, Lists, trips, directions
// (OSRM stubbed), recent searches, AI trip planner.
// Pure-Node Tier-2 — no server boot, no HTTP except a stubbed fetch.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAtlasActions from "../domains/atlas.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`atlas.${name}`);
  assert.ok(fn, `atlas.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAtlasActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "atlas_a" }, userId: "atlas_a" };
const ctxB = { actor: { userId: "atlas_b" }, userId: "atlas_b" };

describe("atlas — saved places", () => {
  it("places-save validates lat/lng + lists per user", () => {
    const r = call("places-save", ctxA, { name: "Blue Bottle", lat: 37.7765, lng: -122.4231, category: "cafe", rating: 4.5 });
    assert.equal(r.ok, true);
    assert.match(r.result.place.number, /^PL-\d{5}$/);
    assert.equal(call("places-list", ctxA).result.places.length, 1);
    assert.equal(call("places-list", ctxB).result.places.length, 0);
  });

  it("rejects out-of-range coordinates", () => {
    const r = call("places-save", ctxA, { name: "Bad", lat: 200, lng: 0 });
    assert.equal(r.ok, false);
  });

  it("places-delete cascades out of lists", () => {
    const p = call("places-save", ctxA, { name: "X", lat: 1, lng: 1 }).result.place;
    const l = call("lists-create", ctxA, { name: "Faves" }).result.list;
    call("lists-add-place", ctxA, { listId: l.id, placeId: p.id });
    call("places-delete", ctxA, { id: p.id });
    const lists = call("lists-list", ctxA).result.lists;
    assert.equal(lists[0].placeCount, 0);
  });
});

describe("atlas — Lists (Google Maps Lists)", () => {
  it("create + add place + remove place", () => {
    const p1 = call("places-save", ctxA, { name: "A", lat: 1, lng: 1 }).result.place;
    const p2 = call("places-save", ctxA, { name: "B", lat: 2, lng: 2 }).result.place;
    const l = call("lists-create", ctxA, { name: "Tokyo trip", color: "#f43f5e" }).result.list;
    call("lists-add-place", ctxA, { listId: l.id, placeId: p1.id });
    call("lists-add-place", ctxA, { listId: l.id, placeId: p2.id });
    call("lists-add-place", ctxA, { listId: l.id, placeId: p1.id }); // dup — no-op
    let lists = call("lists-list", ctxA).result.lists;
    assert.equal(lists[0].placeCount, 2);
    assert.equal(lists[0].places.length, 2);
    call("lists-remove-place", ctxA, { listId: l.id, placeId: p1.id });
    lists = call("lists-list", ctxA).result.lists;
    assert.equal(lists[0].placeCount, 1);
  });
});

describe("atlas — trips (multi-stop itineraries)", () => {
  it("create + add stops (from place + ad-hoc) + reorder + remove", () => {
    const p = call("places-save", ctxA, { name: "Hotel", lat: 35.6, lng: 139.7 }).result.place;
    const trip = call("trips-create", ctxA, { name: "Japan", startDate: "2026-07-01" }).result.trip;
    call("trips-add-stop", ctxA, { tripId: trip.id, placeId: p.id, day: 1 });
    call("trips-add-stop", ctxA, { tripId: trip.id, name: "Shrine", lat: 35.7, lng: 139.8, day: 2 });
    let t = call("trips-list", ctxA).result.trips[0];
    assert.equal(t.stops.length, 2);
    // Reorder
    const ids = t.stops.map(st => st.id).reverse();
    const r = call("trips-reorder-stops", ctxA, { tripId: trip.id, stopIds: ids });
    assert.equal(r.ok, true);
    assert.equal(r.result.trip.stops[0].name, "Shrine");
    // Remove
    call("trips-remove-stop", ctxA, { tripId: trip.id, stopId: ids[0] });
    t = call("trips-list", ctxA).result.trips[0];
    assert.equal(t.stops.length, 1);
  });

  it("reorder rejects mismatched stopIds", () => {
    const trip = call("trips-create", ctxA, { name: "T" }).result.trip;
    call("trips-add-stop", ctxA, { tripId: trip.id, name: "S1", lat: 1, lng: 1 });
    const r = call("trips-reorder-stops", ctxA, { tripId: trip.id, stopIds: ["bogus"] });
    assert.equal(r.ok, false);
  });
});

describe("atlas — directions (OSRM)", () => {
  it("returns parsed route from stubbed OSRM response", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 12000, duration: 900, geometry: { type: 'LineString', coordinates: [] }, legs: [{}] }],
      }),
    });
    const r = await call("directions", ctxA, { waypoints: [{ lat: 37.77, lng: -122.42 }, { lat: 37.80, lng: -122.40 }], mode: "driving" });
    assert.equal(r.ok, true);
    assert.equal(r.result.distanceKm, 12);
    assert.equal(r.result.durationText, "15m");
    assert.equal(r.result.source, "osrm-project-osrm.org");
  });

  it("rejects fewer than 2 waypoints", async () => {
    const r = await call("directions", ctxA, { waypoints: [{ lat: 1, lng: 1 }] });
    assert.equal(r.ok, false);
  });
});

describe("atlas — recent searches", () => {
  it("records, dedups, lists newest-first, clears", () => {
    call("recent-searches-record", ctxA, { query: "coffee near me" });
    call("recent-searches-record", ctxA, { query: "ramen" });
    call("recent-searches-record", ctxA, { query: "COFFEE NEAR ME" }); // dup case-insensitive
    const list = call("recent-searches-list", ctxA).result.recent;
    assert.equal(list.length, 2);
    assert.equal(list[0].query, "COFFEE NEAR ME"); // most recent
    call("recent-searches-clear", ctxA);
    assert.equal(call("recent-searches-list", ctxA).result.recent.length, 0);
  });
});

describe("atlas — AI trip planner", () => {
  it("builds a deterministic itinerary from saved places", async () => {
    call("places-save", ctxA, { name: "Sushi Bar", lat: 1, lng: 1, category: "restaurant" });
    call("places-save", ctxA, { name: "Art Museum", lat: 2, lng: 2, category: "museum" });
    call("places-save", ctxA, { name: "City Park", lat: 3, lng: 3, category: "park" });
    call("places-save", ctxA, { name: "Rooftop Bar", lat: 4, lng: 4, category: "bar" });
    const r = await call("ai-trip-plan", ctxA, { prompt: "fun weekend", days: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "deterministic");
    assert.ok(r.result.itinerary.length <= 2);
    const totalStops = r.result.itinerary.reduce((s, d) => s + d.stops.length, 0);
    assert.equal(totalStops, 4);
  });

  it("rejects when no places saved", async () => {
    const r = await call("ai-trip-plan", ctxB, { prompt: "trip" });
    assert.equal(r.ok, false);
    assert.match(r.error, /save some places/);
  });
});

describe("atlas — dashboard summary", () => {
  it("aggregates places / lists / trips / stops", () => {
    call("places-save", ctxA, { name: "A", lat: 1, lng: 1, category: "cafe" });
    call("places-save", ctxA, { name: "B", lat: 2, lng: 2, category: "cafe" });
    const l = call("lists-create", ctxA, { name: "L" }).result.list;
    void l;
    const trip = call("trips-create", ctxA, { name: "T" }).result.trip;
    call("trips-add-stop", ctxA, { tripId: trip.id, name: "S", lat: 1, lng: 1 });
    const r = call("atlas-dashboard-summary", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.placeCount, 2);
    assert.equal(r.result.listCount, 1);
    assert.equal(r.result.tripCount, 1);
    assert.equal(r.result.totalStops, 1);
    assert.equal(r.result.byCategory.cafe, 2);
  });
});

describe("atlas.route-stops (Ask Maps-style stop suggestion)", () => {
  it("rejects start/end without numeric lat/lng", async () => {
    const r = await call("route-stops", ctxA, { start: {}, end: {} });
    assert.equal(r.ok, false);
  });

  it("routes via OSRM then finds amenities near the midpoint", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("router.project-osrm.org")) {
        return { ok: true, json: async () => ({
          code: "Ok",
          routes: [{
            distance: 120000, duration: 5400,
            geometry: { type: "LineString", coordinates: [[-122.4, 37.7], [-122.2, 37.6], [-122.0, 37.5]] },
            legs: [{}],
          }],
        }) };
      }
      // Overpass
      return { ok: true, json: async () => ({
        elements: [
          { lat: 37.61, lon: -122.21, tags: { name: "Midway Fuel", amenity: "fuel", brand: "Shell" } },
          { lat: 37.65, lon: -122.25, tags: { amenity: "fuel" } },
        ],
      }) };
    };
    const r = await call("route-stops", ctxA, {
      start: { lat: 37.7, lng: -122.4 }, end: { lat: 37.5, lng: -122.0 }, amenity: "fuel",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.amenity, "fuel");
    assert.equal(r.result.count, 2);
    assert.equal(r.result.stops[0].name, "Midway Fuel"); // nearest the midpoint first
    assert.ok(r.result.midpoint.lat > 37.5 && r.result.midpoint.lat < 37.7);
  });
});
