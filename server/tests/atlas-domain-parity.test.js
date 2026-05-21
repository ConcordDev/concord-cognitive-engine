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
    assert.equal(r.result.offlineAreaCount, 0);
    assert.equal(r.result.navActive, false);
  });
});

// ── Google Maps parity backlog ───────────────────────────────────

const OSRM_STUB = {
  code: "Ok",
  routes: [{
    distance: 24000, duration: 1800,
    geometry: { type: "LineString", coordinates: [[-122.42, 37.77], [-122.35, 37.72], [-122.28, 37.68], [-122.20, 37.62]] },
    legs: [{
      distance: 24000, duration: 1800,
      steps: [
        { distance: 12000, duration: 900, name: "Market St", maneuver: { type: "depart", modifier: "left" } },
        { distance: 12000, duration: 900, name: "Mission St", maneuver: { type: "arrive", modifier: "right" } },
      ],
    }],
  }],
};

describe("atlas — multi-modal directions", () => {
  it("returns turn-by-turn steps for the chosen mode", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => OSRM_STUB });
    const r = await call("directions-multimodal", ctxA, {
      waypoints: [{ lat: 37.77, lng: -122.42 }, { lat: 37.62, lng: -122.20 }], mode: "cycling",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.mode, "cycling");
    assert.equal(r.result.distanceKm, 24);
    assert.equal(r.result.stepCount, 2);
    assert.ok(r.result.steps[0].roadName === "Market St");
  });

  it("rejects fewer than 2 waypoints", async () => {
    const r = await call("directions-multimodal", ctxA, { waypoints: [{ lat: 1, lng: 1 }] });
    assert.equal(r.ok, false);
  });
});

describe("atlas — live traffic ETA", () => {
  it("derives a traffic-adjusted ETA from the time-of-day model", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => OSRM_STUB });
    const r = await call("live-traffic-eta", ctxA, {
      waypoints: [{ lat: 37.77, lng: -122.42 }, { lat: 37.62, lng: -122.20 }], mode: "driving",
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.trafficSeconds >= r.result.freeFlowSeconds);
    assert.ok(["free-flow", "light", "moderate", "heavy"].includes(r.result.congestionLevel));
    assert.ok(typeof r.result.etaIso === "string");
    assert.equal(r.result.legs.length, 1);
  });

  it("walking is immune to vehicle congestion", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => OSRM_STUB });
    const r = await call("live-traffic-eta", ctxA, {
      waypoints: [{ lat: 37.77, lng: -122.42 }, { lat: 37.62, lng: -122.20 }], mode: "walking",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.congestionFactor, 1.0);
    assert.equal(r.result.congestionLevel, "none");
  });
});

describe("atlas — transit directions", () => {
  it("builds walk + transit + walk legs from OSM stops", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      elements: [
        { lat: 37.775, lon: -122.418, tags: { name: "Powell Station", railway: "station" } },
        { lat: 37.621, lon: -122.205, tags: { name: "Daly Plaza", highway: "bus_stop" } },
      ],
    }) });
    const r = await call("transit-directions", ctxA, {
      start: { lat: 37.77, lng: -122.42 }, end: { lat: 37.62, lng: -122.20 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.feasible, true);
    assert.equal(r.result.legs.length, 3);
    assert.equal(r.result.legs[1].type, "transit");
    assert.ok(r.result.totalSeconds > 0);
  });

  it("rejects start/end without numeric lat/lng", async () => {
    const r = await call("transit-directions", ctxA, { start: {}, end: {} });
    assert.equal(r.ok, false);
  });
});

describe("atlas — street imagery", () => {
  it("returns coverage tile reference when no token configured", async () => {
    delete process.env.MAPILLARY_TOKEN;
    const r = await call("street-imagery", ctxA, { lat: 37.77, lng: -122.42 });
    assert.equal(r.ok, true);
    assert.equal(r.result.hasToken, false);
    assert.ok(r.result.coverageTileUrl.includes("mapillary"));
  });

  it("rejects non-numeric coordinates", async () => {
    const r = await call("street-imagery", ctxA, { lat: "x", lng: "y" });
    assert.equal(r.ok, false);
  });
});

describe("atlas — place details", () => {
  it("merges OSM tags + Wikipedia summary", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("overpass")) {
        return { ok: true, json: async () => ({ elements: [{
          type: "node", id: 42, lat: 37.77, lon: -122.42,
          tags: { name: "Ferry Building", amenity: "marketplace", opening_hours: "Mo-Su 10:00-19:00", wikipedia: "en:San Francisco Ferry Building", website: "https://example.org" },
        }] }) };
      }
      return { ok: true, json: async () => ({ extract: "A historic landmark.", thumbnail: { source: "https://img" }, content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/X" } } }) };
    };
    const r = await call("place-details", ctxA, { osmType: "node", osmId: 42 });
    assert.equal(r.ok, true);
    assert.equal(r.result.details.name, "Ferry Building");
    assert.equal(r.result.details.openingHours, "Mo-Su 10:00-19:00");
    assert.equal(r.result.details.summary, "A historic landmark.");
  });

  it("rejects missing osmType/osmId", async () => {
    const r = await call("place-details", ctxA, {});
    assert.equal(r.ok, false);
  });
});

describe("atlas — offline map areas", () => {
  it("creates an area with a computed tile manifest, lists, deletes", () => {
    const r = call("offline-areas-create", ctxA, {
      name: "Downtown SF", south: 37.77, west: -122.43, north: 37.80, east: -122.40, minZoom: 12, maxZoom: 14,
    });
    assert.equal(r.ok, true);
    assert.match(r.result.area.number, /^OA-\d{4}$/);
    assert.ok(r.result.area.tileCount > 0);
    assert.ok(r.result.area.estimatedSizeMB >= 0);
    assert.equal(r.result.area.status, "pending");
    const list = call("offline-areas-list", ctxA).result.areas;
    assert.equal(list.length, 1);
    const upd = call("offline-areas-update-status", ctxA, { id: r.result.area.id, status: "ready", cachedTiles: 10 });
    assert.equal(upd.result.area.status, "ready");
    call("offline-areas-delete", ctxA, { id: r.result.area.id });
    assert.equal(call("offline-areas-list", ctxA).result.areas.length, 0);
  });

  it("rejects an invalid bbox", () => {
    const r = call("offline-areas-create", ctxA, { name: "Bad", south: 50, west: 0, north: 40, east: 10 });
    assert.equal(r.ok, false);
  });
});

describe("atlas — real-time navigation mode", () => {
  it("starts a session, advances on-route, and re-routes off-route", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => OSRM_STUB });
    const start = await call("nav-start", ctxA, {
      waypoints: [{ lat: 37.77, lng: -122.42 }, { lat: 37.62, lng: -122.20 }], mode: "driving",
    });
    assert.equal(start.ok, true);
    assert.equal(start.result.session.status, "active");
    assert.ok(start.result.session.steps.length > 0);
    // On-route position near the polyline.
    const onRoute = await call("nav-update", ctxA, { lat: 37.72, lng: -122.35 });
    assert.equal(onRoute.ok, true);
    assert.equal(onRoute.result.rerouted, false);
    // Far off-route triggers a reroute.
    const offRoute = await call("nav-update", ctxA, { lat: 38.50, lng: -121.00 });
    assert.equal(offRoute.ok, true);
    assert.equal(offRoute.result.rerouted, true);
    assert.equal(offRoute.result.session.rerouteCount, 1);
    // Status + stop.
    assert.ok(call("nav-status", ctxA).result.session);
    assert.equal(call("nav-stop", ctxA).result.stopped, true);
    assert.equal(call("nav-status", ctxA).result.session, null);
  });

  it("nav-update rejects when no active session", async () => {
    const r = await call("nav-update", ctxB, { lat: 1, lng: 1 });
    assert.equal(r.ok, false);
  });

  it("nav-status returns null with no session and nav-stop rejects with no session", () => {
    assert.equal(call("nav-status", ctxB).result.session, null);
    const stop = call("nav-stop", ctxB);
    assert.equal(stop.ok, false);
  });
});

describe("atlas — offline areas extra validation", () => {
  it("offline-areas-update-status rejects an unknown status", () => {
    const created = call("offline-areas-create", ctxA, {
      name: "Zone", south: 1, west: 1, north: 2, east: 2,
    }).result.area;
    const bad = call("offline-areas-update-status", ctxA, { id: created.id, status: "frozen" });
    assert.equal(bad.ok, false);
  });

  it("offline-areas-delete rejects an unknown id", () => {
    const r = call("offline-areas-delete", ctxA, { id: "no-such-area" });
    assert.equal(r.ok, false);
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
