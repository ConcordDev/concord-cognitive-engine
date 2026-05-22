// Contract tests for server/domains/travel.js — pure-math macros
// plus real REST Countries + exchangerate.host integrations, and the
// Google Travel / TripIt feature-parity backlog: itinerary map +
// agenda, live flight/hotel search, weather forecast, booking-email
// import, flight-status tracking, collaborative trip planning, and
// per-category budget breakdown.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTravelActions from "../domains/travel.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";

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
  // Fresh in-memory STATE per test so trip Maps don't bleed across tests.
  globalThis._concordSTATE = {};
  // Drop the TTL cache so cachedFetchJson re-hits the (mocked) network.
  clearExternalFetchCache();
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// Helper: create a trip and return its id.
function makeTrip(ctx, params = {}) {
  const r = call("trip-create", ctx, {
    name: params.name || "Test Trip",
    destination: params.destination || "Lisbon",
    startDate: params.startDate || "2026-09-01",
    endDate: params.endDate || "2026-09-04",
  });
  assert.equal(r.ok, true);
  return r.result.trip.id;
}

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

// ════════════════════════════════════════════════════════════════════
// Backlog: Google Travel / TripIt feature-parity macros.
// ════════════════════════════════════════════════════════════════════

describe("travel.itinerary-geocode (Nominatim map pins)", () => {
  it("rejects unknown trip", async () => {
    const r = await call("itinerary-geocode", ctxA, { tripId: "nope", id: "x" });
    assert.equal(r.ok, false);
  });

  it("resolves a location to coords + persists them on the item", async () => {
    const tripId = makeTrip(ctxA);
    const itin = call("itinerary-add", ctxA, { tripId, title: "Belém Tower", location: "Belém Tower, Lisbon" });
    assert.equal(itin.ok, true);
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ([{ lat: "38.6916", lon: "-9.2160", display_name: "Belém Tower, Lisbon, Portugal" }]),
    });
    const r = await call("itinerary-geocode", ctxA, { tripId, id: itin.result.item.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.item.lat, 38.6916);
    assert.equal(r.result.item.lng, -9.216);
    assert.match(r.result.item.resolvedAddress, /Belém Tower/);
  });

  it("surfaces a no-coordinates miss", async () => {
    const tripId = makeTrip(ctxA);
    const itin = call("itinerary-add", ctxA, { tripId, title: "Nowhere", location: "qqqzzz" });
    globalThis.fetch = async () => ({ ok: true, json: async () => ([]) });
    const r = await call("itinerary-geocode", ctxA, { tripId, id: itin.result.item.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /no coordinates/);
  });
});

describe("travel.itinerary-map (pin + route)", () => {
  it("collects geocoded points + computes straight-line route distance", () => {
    const tripId = makeTrip(ctxA);
    const a = call("itinerary-add", ctxA, { tripId, title: "A", day: "2026-09-01" });
    const b = call("itinerary-add", ctxA, { tripId, title: "B", day: "2026-09-02" });
    // Geocode by hand-setting coords through itinerary state (simulating geocode).
    const s = globalThis._concordSTATE.travelLens;
    const arr = s.itinerary.get(tripId);
    arr.find((x) => x.id === a.result.item.id).lat = 38.7;
    arr.find((x) => x.id === a.result.item.id).lng = -9.1;
    arr.find((x) => x.id === b.result.item.id).lat = 38.8;
    arr.find((x) => x.id === b.result.item.id).lng = -9.0;
    const r = call("itinerary-map", ctxA, { tripId });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.ok(r.result.routeKm > 0);
  });

  it("reports ungeocoded items", () => {
    const tripId = makeTrip(ctxA);
    call("itinerary-add", ctxA, { tripId, title: "Plain item" });
    const r = call("itinerary-map", ctxA, { tripId });
    assert.equal(r.result.count, 0);
    assert.equal(r.result.ungeocoded, 1);
  });
});

describe("travel.itinerary-agenda (day-by-day timeline)", () => {
  it("enumerates every trip day and groups items by time", () => {
    const tripId = makeTrip(ctxA, { startDate: "2026-09-01", endDate: "2026-09-03" });
    call("itinerary-add", ctxA, { tripId, title: "Breakfast", day: "2026-09-01", time: "08:00" });
    call("itinerary-add", ctxA, { tripId, title: "Museum", day: "2026-09-01", time: "10:00" });
    const r = call("itinerary-agenda", ctxA, { tripId });
    assert.equal(r.ok, true);
    assert.equal(r.result.dayCount, 3);
    assert.equal(r.result.agenda[0].itemCount, 2);
    assert.equal(r.result.agenda[0].items[0].title, "Breakfast");
    assert.ok(r.result.agenda[0].weekday);
  });

  it("surfaces unscheduled items separately", () => {
    const tripId = makeTrip(ctxA);
    call("itinerary-add", ctxA, { tripId, title: "Floating idea" });
    const r = call("itinerary-agenda", ctxA, { tripId });
    assert.equal(r.result.unscheduled.length, 1);
  });
});

describe("travel.weather-forecast (Open-Meteo)", () => {
  it("rejects missing coordinates", async () => {
    const r = await call("weather-forecast", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("shapes the Open-Meteo daily payload with WMO condition names", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        daily: {
          time: ["2026-09-01", "2026-09-02"],
          temperature_2m_max: [27, 29],
          temperature_2m_min: [18, 19],
          precipitation_probability_max: [10, 5],
          weather_code: [0, 61],
        },
        daily_units: { temperature_2m_max: "°C" },
      }),
    });
    const r = await call("weather-forecast", ctxA, { lat: 38.72, lng: -9.14 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.days[0].condition, "Clear");
    assert.equal(r.result.days[1].condition, "Light rain");
    assert.equal(r.result.source, "open-meteo");
  });
});

describe("travel.flight-search (OpenSky live state vectors)", () => {
  it("returns live airborne flights and filters by airline ICAO prefix", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        states: [
          ["abc123", "UAL837 ", "United States", 0, 0, -120, 37, 11000, false, 250, 90, 0],
          ["def456", "DLH400 ", "Germany", 0, 0, 8, 50, 10000, false, 240, 270, 0],
          ["gnd789", "AAL10  ", "United States", 0, 0, -100, 40, 0, true, 0, 0, 0],
        ],
      }),
    });
    const all = await call("flight-search", ctxA, {});
    assert.equal(all.ok, true);
    // On-ground flight excluded.
    assert.equal(all.result.count, 2);
    const filtered = await call("flight-search", ctxA, { airline: "UAL" });
    assert.equal(filtered.result.count, 1);
    assert.equal(filtered.result.flights[0].callsign, "UAL837");
  });

  it("surfaces OpenSky network failure", async () => {
    const r = await call("flight-search", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable/);
  });
});

describe("travel.hotel-search (OSM Overpass lodging POIs)", () => {
  it("rejects missing coordinates", async () => {
    const r = await call("hotel-search", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("returns real OSM lodging POIs", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        elements: [
          { id: 1, lat: 38.71, lon: -9.14, tags: { name: "Hotel Lisboa", tourism: "hotel", stars: "4" } },
          { id: 2, lat: 38.72, lon: -9.13, tags: { tourism: "hostel" } }, // no name → dropped
        ],
      }),
    });
    const r = await call("hotel-search", ctxA, { lat: 38.72, lng: -9.14 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.lodging[0].name, "Hotel Lisboa");
    assert.equal(r.result.source, "openstreetmap-overpass");
  });
});

describe("travel.booking-import (email-forwarding parse)", () => {
  it("rejects unknown trip / empty email", () => {
    assert.equal(call("booking-import", ctxA, { tripId: "nope", emailText: "x" }).ok, false);
    const tripId = makeTrip(ctxA);
    assert.equal(call("booking-import", ctxA, { tripId, emailText: "" }).ok, false);
  });

  it("parses a flight confirmation into a booking + itinerary item", () => {
    const tripId = makeTrip(ctxA);
    const email = "Your flight is confirmed. Confirmation: ABC123. "
      + "Departure gate B12, seat 14C. Total: $452.10. Date 2026-09-01.";
    const r = call("booking-import", ctxA, { tripId, emailText: email });
    assert.equal(r.ok, true);
    assert.equal(r.result.booking.type, "flight");
    assert.equal(r.result.booking.confirmationCode, "ABC123");
    assert.equal(r.result.booking.cost, 452.1);
    assert.equal(r.result.booking.date, "2026-09-01");
    assert.equal(r.result.booking.importedFromEmail, true);
    assert.ok(r.result.itineraryItem);
    assert.ok(r.result.parsed.confidence >= 3);
  });

  it("parses a hotel confirmation type", () => {
    const tripId = makeTrip(ctxA);
    const r = call("booking-import", ctxA, { tripId, emailText: "Your hotel room is reserved for 3 nights stay. Check-in May 5, 2026." });
    assert.equal(r.result.booking.type, "hotel");
  });
});

describe("travel.flight-status (OpenSky live tracking)", () => {
  it("rejects missing callsign", async () => {
    const r = await call("flight-status", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("reports not_airborne when no live state matches", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ states: [] }) });
    const r = await call("flight-status", ctxA, { callsign: "UAL837" });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, false);
    assert.equal(r.result.status, "not_airborne");
  });

  it("reports live airborne state when matched", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        states: [["abc123", "UAL837 ", "United States", 1716000000, 1716000000, -120, 37, 11000, false, 250, 90, 2]],
      }),
    });
    const r = await call("flight-status", ctxA, { callsign: "UAL837" });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, true);
    assert.equal(r.result.status, "airborne");
    assert.equal(r.result.baroAltitudeM, 11000);
  });
});

describe("travel.trip-share / trip-unshare / trip-shared-list (collaboration)", () => {
  it("rejects sharing an unknown trip / sharing with yourself", () => {
    assert.equal(call("trip-share", ctxA, { tripId: "nope", collaborator: "user_b" }).ok, false);
    const tripId = makeTrip(ctxA);
    assert.equal(call("trip-share", ctxA, { tripId, collaborator: "user_a" }).ok, false);
  });

  it("shares a trip and the collaborator can find it", () => {
    const tripId = makeTrip(ctxA, { name: "Lisbon with friends" });
    const share = call("trip-share", ctxA, { tripId, collaborator: "user_b", role: "editor" });
    assert.equal(share.ok, true);
    assert.equal(share.result.collaborators[0].userId, "user_b");
    const seenByB = call("trip-shared-list", ctxB, {});
    assert.equal(seenByB.ok, true);
    assert.equal(seenByB.result.count, 1);
    assert.equal(seenByB.result.trips[0].name, "Lisbon with friends");
    assert.equal(seenByB.result.trips[0].myRole, "editor");
  });

  it("unshares a trip and removes the collaborator's access", () => {
    const tripId = makeTrip(ctxA);
    call("trip-share", ctxA, { tripId, collaborator: "user_b" });
    const un = call("trip-unshare", ctxA, { tripId, collaborator: "user_b" });
    assert.equal(un.ok, true);
    assert.equal(call("trip-shared-list", ctxB, {}).result.count, 0);
  });
});

describe("travel.budget-breakdown (per-category + currency)", () => {
  it("maps booking types onto budget categories", async () => {
    const tripId = makeTrip(ctxA);
    call("budget-set", ctxA, { tripId, categories: { flights: 600, accommodation: 400 } });
    call("booking-add", ctxA, { tripId, type: "flight", cost: 520 });
    call("booking-add", ctxA, { tripId, type: "hotel", cost: 450 });
    const r = await call("budget-breakdown", ctxA, { tripId });
    assert.equal(r.ok, true);
    const flights = r.result.lines.find((l) => l.category === "flights");
    assert.equal(flights.planned, 600);
    assert.equal(flights.booked, 520);
    const accom = r.result.lines.find((l) => l.category === "accommodation");
    assert.equal(accom.overBudget, true);
    assert.equal(r.result.totalBooked, 970);
  });

  it("converts display totals at the live ECB rate when requested", async () => {
    const tripId = makeTrip(ctxA);
    call("budget-set", ctxA, { tripId, categories: { flights: 100 } });
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ success: true, info: { rate: 0.9 }, result: 0.9 }),
    });
    const r = await call("budget-breakdown", ctxA, { tripId, displayCurrency: "EUR" });
    assert.equal(r.ok, true);
    assert.equal(r.result.displayCurrency, "EUR");
    assert.equal(r.result.fxRate, 0.9);
    assert.equal(r.result.converted.totalPlanned, 90);
  });
});
