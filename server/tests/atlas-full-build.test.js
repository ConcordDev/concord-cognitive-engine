// Atlas full-build tests (B6, F-C row 12) — the legs the build adds:
//   S1 endpoint honesty: OSRM snap verification + NoRoute in words, on
//      the shared osrmRoute path (multimodal / traffic) and the plain
//      directions verb — a route is only a route if it reaches the
//      places it was asked for.
//   S2 duplicate places-save refusal (server half; the FE two-step
//      delete half is pinned in the frontend suite).
//   S4 planner narration derives from the computed itinerary.
//   F6 signal cortex: MHz band ladder, the LoRa modulation leg, the
//      433 MHz ISM range, and the stored description.
// Harness mirrors the shipped atlas-domain-parity suite.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerAtlasActions from "../domains/atlas.js";
import { classifySignal, getSpectralOccupancy } from "../lib/atlas-signal-cortex.js";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`atlas.${name}`);
  assert.ok(fn, `atlas.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

function stubTransport(payload) {
  __setPublicFetchTestTransport(async () => ({ ok: true, json: async () => payload }));
}

before(() => { registerAtlasActions(register); });
afterEach(() => { __setPublicFetchTestTransport(null); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "atlas_a" }, userId: "atlas_a" };
const ctxB = { actor: { userId: "atlas_b" }, userId: "atlas_b" };

const NY_PAIR = [{ lat: 41.7, lng: -73.93 }, { lat: 40.71, lng: -74.0 }];
// OSRM-shaped success whose geometry sits in Iberia — the walk's
// fabrication: the snapped route never reaches New York.
const IBERIA_ROUTE = {
  code: "Ok",
  routes: [{
    distance: 9500, duration: 5400,
    geometry: { type: "LineString", coordinates: [[-9.14, 38.72], [-8.87, 38.99], [-8.61, 39.4]] },
    legs: [{
      distance: 9500, duration: 5400,
      steps: [{ distance: 9500, duration: 5400, name: "Estrada", maneuver: { type: "depart", modifier: "left" } }],
    }],
  }],
};
const NY_ROUTE = {
  code: "Ok",
  routes: [{
    distance: 140000, duration: 7200,
    geometry: { type: "LineString", coordinates: [[-73.93, 41.7], [-73.96, 41.2], [-74.0, 40.71]] },
    legs: [{
      distance: 140000, duration: 7200,
      steps: [{ distance: 140000, duration: 7200, name: "Route 9", maneuver: { type: "depart", modifier: "left" } }],
    }],
  }],
};

describe("atlas S2 — duplicate places are refused at save", () => {
  it("refuses the same name at the same coordinates, naming the standing place", () => {
    const first = call("places-save", ctxA, { name: "Tour Eiffel", lat: 48.8584, lng: 2.2945 });
    assert.equal(first.ok, true);
    const dupe = call("places-save", ctxA, { name: "tour eiffel", lat: 48.8584, lng: 2.2945 });
    assert.equal(dupe.ok, false);
    assert.match(dupe.error, /already saved/);
    assert.match(dupe.error, /Tour Eiffel/);
    assert.equal(call("places-list", ctxA).result.places.length, 1);
  });

  it("still allows a different name at the same spot, the same name elsewhere, and another user's identical save", () => {
    call("places-save", ctxA, { name: "Tour Eiffel", lat: 48.8584, lng: 2.2945 });
    assert.equal(call("places-save", ctxA, { name: "Eiffel viewpoint", lat: 48.8584, lng: 2.2945 }).ok, true);
    assert.equal(call("places-save", ctxA, { name: "Tour Eiffel", lat: 48.86, lng: 2.3 }).ok, true);
    assert.equal(call("places-save", ctxB, { name: "Tour Eiffel", lat: 48.8584, lng: 2.2945 }).ok, true);
  });
});

describe("atlas S1 — routes must reach the requested destination", () => {
  it("directions-multimodal refuses Iberian geometry for New York waypoints, in words", async () => {
    stubTransport(IBERIA_ROUTE);
    const r = await call("directions-multimodal", ctxA, { waypoints: NY_PAIR, mode: "walking" });
    assert.equal(r.ok, false);
    assert.match(r.error, /no route reaches the requested destination/);
    assert.doesNotMatch(r.error, /unreachable/);
  });

  it("directions-multimodal accepts a route whose geometry reaches the waypoints", async () => {
    stubTransport(NY_ROUTE);
    const r = await call("directions-multimodal", ctxA, { waypoints: NY_PAIR, mode: "driving" });
    assert.equal(r.ok, true);
    assert.ok(r.result.distanceKm > 100);
  });

  it("live-traffic-eta refuses the same fabrication in words", async () => {
    stubTransport(IBERIA_ROUTE);
    const r = await call("live-traffic-eta", ctxA, { waypoints: NY_PAIR, mode: "walking" });
    assert.equal(r.ok, false);
    assert.match(r.error, /no route reaches the requested destination/);
    assert.doesNotMatch(r.error, /unreachable/);
  });

  it("the plain directions verb answers NoRoute in words, not the raw engine code", async () => {
    stubTransport({ code: "NoRoute", routes: [] });
    const r = await call("directions", ctxA, { waypoints: NY_PAIR, mode: "driving" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "no land route between these points");
  });

  it("the plain directions verb also verifies the snap", async () => {
    stubTransport(IBERIA_ROUTE);
    const r = await call("directions", ctxA, { waypoints: NY_PAIR, mode: "driving" });
    assert.equal(r.ok, false);
    assert.match(r.error, /no route reaches the requested destination/);
  });

  it("route-stops refuses to suggest stops along a fabricated route", async () => {
    __setPublicFetchTestTransport(async (url) => ({
      ok: true,
      json: async () => (String(url).includes("overpass") ? { elements: [] } : IBERIA_ROUTE),
    }));
    const r = await call("route-stops", ctxA, {
      start: { lat: 41.7, lng: -73.93 }, end: { lat: 40.71, lng: -74.0 }, amenity: "fuel",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /no route reaches the requested destination/);
  });
});

describe("atlas S4 — the planner narration describes the computed itinerary", () => {
  it("the brain is handed the day-by-day plan, in the plan's own order", async () => {
    call("places-save", ctxA, { name: "Sushi Bar", lat: 1, lng: 1, category: "restaurant" });
    call("places-save", ctxA, { name: "Art Museum", lat: 2, lng: 2, category: "museum" });
    call("places-save", ctxA, { name: "City Park", lat: 3, lng: 3, category: "park" });
    call("places-save", ctxA, { name: "Rooftop Bar", lat: 4, lng: 4, category: "bar" });
    let seen = null;
    const ctxLlm = {
      actor: { userId: "atlas_a" }, userId: "atlas_a",
      llm: { chat: async (req) => { seen = req; return { content: "Follow the plan as laid out." }; } },
    };
    const r = await call("ai-trip-plan", ctxLlm, { prompt: "fun weekend", days: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "brain");
    assert.ok(seen, "the brain was called");
    const userMsg = seen.messages.find((m) => m.role === "user")?.content || "";
    const sysMsg = seen.messages.find((m) => m.role === "system")?.content || "";
    assert.match(sysMsg, /FINAL/);
    // The itinerary handed to the brain is the returned itinerary, day
    // by day, in order — the narration cannot re-sequence it.
    const expected = r.result.itinerary.map((d) => `Day ${d.day}: ${d.stops.map((x) => x.name).join("; ")}`);
    for (const line of expected) assert.ok(userMsg.includes(line), `brain input carries "${line}"`);
  });
});

describe("atlas F6 — the signal cortex classifies and bands honestly", () => {
  it("433.92 MHz + LoRa classifies COMMUNICATION and keeps its description", () => {
    const rec = classifySignal({ frequency: 433.92, modulation: "LoRa", bandwidth: 125, power: -80, description: "telemetry probe" });
    assert.equal(rec.category, "COMMUNICATION");
    assert.equal(rec.description, "telemetry probe");
  });

  it("spectral occupancy bands 433.92 MHz as UHF+, not LF/MF", () => {
    const occ = getSpectralOccupancy();
    assert.equal(occ.bands["UHF+"], 1);
    assert.equal(occ.bands["LF/MF"] || 0, 0);
  });
});
