// server/tests/travel-trip-dates.test.js
//
// Q24 (E-82): trip-create / trip-update must REJECT endDate <
// startDate instead of clamping durationDays to a fake 1-day trip.
// Pins: create stores nothing on an inverted range; update rejects
// inversions from either direction and mutates nothing at all;
// same-day and valid ranges still work with correct durations.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTravelActions from "../domains/travel.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params = {}) {
  const fn = ACTIONS.get(`travel.${name}`);
  if (!fn) throw new Error(`travel.${name} not registered`);
  return fn({ actor: { userId: "trav-1" } }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerTravelActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const tripCount = () => (globalThis._concordSTATE.travelLens.trips.get("trav-1") || []).length;

describe("travel trip date order (Q24)", () => {
  it("create rejects end-before-start and stores nothing", () => {
    const r = call("trip-create", { name: "Backwards", destination: "Rome", startDate: "2026-11-10", endDate: "2026-11-05" });
    assert.equal(r.ok, false);
    assert.match(r.error, /The end date must be on or after the start date/);
    assert.equal(tripCount(), 0);
  });

  it("create accepts valid and same-day ranges with correct durations; a missing end defaults to start", () => {
    const week = call("trip-create", { name: "Week", destination: "Rome", startDate: "2026-11-10", endDate: "2026-11-16" });
    assert.equal(week.ok, true);
    assert.equal(week.result.trip.durationDays, 7);
    const day = call("trip-create", { name: "Day", destination: "Rome", startDate: "2026-11-10", endDate: "2026-11-10" });
    assert.equal(day.result.trip.durationDays, 1);
    const open = call("trip-create", { name: "Open", destination: "Rome", startDate: "2026-11-10" });
    assert.equal(open.result.trip.endDate, "2026-11-10");
    assert.equal(open.result.trip.durationDays, 1);
  });

  it("update rejects an inversion from either direction and mutates nothing", () => {
    const trip = call("trip-create", { name: "Week", destination: "Rome", startDate: "2026-11-10", endDate: "2026-11-16" }).result.trip;
    const byEnd = call("trip-update", { id: trip.id, name: "Renamed", endDate: "2026-11-01" });
    assert.equal(byEnd.ok, false);
    assert.match(byEnd.error, /The end date must be on or after the start date/);
    const byStart = call("trip-update", { id: trip.id, startDate: "2026-12-01" });
    assert.equal(byStart.ok, false);
    const stored = call("trip-list", {}).result.trips.find((t) => t.id === trip.id);
    assert.equal(stored.name, "Week", "the rejected update applied no partial write");
    assert.equal(stored.startDate, "2026-11-10");
    assert.equal(stored.endDate, "2026-11-16");
    assert.equal(stored.durationDays, 7);
  });

  it("FIX-travel-003: travelers is refused, not silently clamped, on create and update", () => {
    const neg = call("trip-create", { name: "Neg", destination: "Rome", startDate: "2026-11-10", travelers: -1 });
    assert.equal(neg.ok, false);
    assert.match(neg.error, /Travelers must be a whole number of at least 1/);
    assert.equal(tripCount(), 0);
    const trip = call("trip-create", { name: "Pair", destination: "Rome", startDate: "2026-11-10", travelers: 2 }).result.trip;
    assert.equal(trip.travelers, 2);
    const bad = call("trip-update", { id: trip.id, travelers: -1 });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /Travelers must be a whole number of at least 1/);
    const stored = call("trip-list", {}).result.trips.find((t) => t.id === trip.id);
    assert.equal(stored.travelers, 2, "the rejected update changed nothing");
    const absent = call("trip-create", { name: "Solo", destination: "Rome", startDate: "2026-11-10" });
    assert.equal(absent.result.trip.travelers, 1, "absent still defaults to 1");
  });

  it("a valid update recomputes duration", () => {
    const trip = call("trip-create", { name: "Week", destination: "Rome", startDate: "2026-11-10", endDate: "2026-11-16" }).result.trip;
    const r = call("trip-update", { id: trip.id, endDate: "2026-11-12" });
    assert.equal(r.ok, true);
    assert.equal(r.result.trip.durationDays, 3);
  });
});
