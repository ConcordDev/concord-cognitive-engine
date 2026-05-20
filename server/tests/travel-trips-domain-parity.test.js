// Contract tests for the travel TripAdvisor + Hopper 2026-parity macros
// (trips, itineraries, places + reviews, bookings, price watches,
// budgets, documents, checklists). Compute/API macros covered in
// travel-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTravelActions from "../domains/travel.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`travel.${name}`);
  assert.ok(fn, `travel.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerTravelActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newTrip(ctx = ctxA, over = {}) {
  return call("trip-create", ctx, {
    name: "Japan 2026", destination: "Tokyo",
    startDate: "2026-09-01", endDate: "2026-09-08", travelers: 2, ...over,
  }).result.trip;
}

describe("travel.trip-* CRUD", () => {
  it("create computes duration, requires name + destination", () => {
    assert.equal(call("trip-create", ctxA, { name: "X" }).ok, false);
    const t = newTrip();
    assert.equal(t.durationDays, 8);
    assert.equal(call("trip-list", ctxA, {}).result.count, 1);
    assert.equal(call("trip-list", ctxB, {}).result.count, 0);
  });

  it("update, detail and delete", () => {
    const t = newTrip();
    assert.equal(call("trip-update", ctxA, { id: t.id, travelers: 4 }).result.trip.travelers, 4);
    assert.equal(call("trip-detail", ctxA, { id: t.id }).ok, true);
    assert.equal(call("trip-delete", ctxA, { id: t.id }).ok, true);
    assert.equal(call("trip-list", ctxA, {}).result.count, 0);
  });
});

describe("travel.itinerary-*", () => {
  it("add items, list grouped by day", () => {
    const t = newTrip();
    call("itinerary-add", ctxA, { tripId: t.id, title: "Senso-ji", day: "2026-09-02", time: "10:00", category: "sightseeing" });
    call("itinerary-add", ctxA, { tripId: t.id, title: "Sushi dinner", day: "2026-09-02", time: "19:00", category: "food" });
    const list = call("itinerary-list", ctxA, { tripId: t.id });
    assert.equal(list.result.count, 2);
    assert.equal(list.result.byDay["2026-09-02"].length, 2);
    assert.equal(list.result.items[0].title, "Senso-ji"); // earlier time first
  });

  it("rejects itinerary on a missing trip", () => {
    assert.equal(call("itinerary-add", ctxA, { tripId: "nope", title: "X" }).ok, false);
  });
});

describe("travel.place-* + reviews", () => {
  it("places shared, ratings aggregate, save toggles", () => {
    const place = call("place-add", ctxA, { name: "Park Hyatt", kind: "hotel", destination: "Tokyo" }).result.place;
    call("place-review", ctxA, { placeId: place.id, rating: 5 });
    call("place-review", ctxB, { placeId: place.id, rating: 3 });
    assert.equal(call("place-detail", ctxA, { id: place.id }).result.place.rating, 4);
    call("place-save", ctxA, { id: place.id });
    assert.equal(call("place-list", ctxA, { savedOnly: true }).result.count, 1);
    assert.equal(call("place-list", ctxA, { kind: "hotel" }).result.count, 1);
  });

  it("only the contributor can delete a place", () => {
    const place = call("place-add", ctxA, { name: "Cafe", kind: "restaurant" }).result.place;
    assert.equal(call("place-delete", ctxB, { id: place.id }).ok, false);
    assert.equal(call("place-delete", ctxA, { id: place.id }).ok, true);
  });
});

describe("travel.booking-* + budget", () => {
  it("bookings sum into trip cost and budget summary", () => {
    const t = newTrip();
    call("booking-add", ctxA, { tripId: t.id, type: "flight", provider: "ANA", cost: 1200 });
    call("booking-add", ctxA, { tripId: t.id, type: "hotel", provider: "Hyatt", cost: 1400 });
    assert.equal(call("booking-list", ctxA, { tripId: t.id }).result.totalCost, 2600);
    call("budget-set", ctxA, { tripId: t.id, categories: { flights: 1000, lodging: 1200 } });
    const bs = call("budget-summary", ctxA, { tripId: t.id });
    assert.equal(bs.result.planned, 2200);
    assert.equal(bs.result.booked, 2600);
    assert.equal(bs.result.overBudget, true);
  });

  it("rejects an unknown booking type", () => {
    const t = newTrip();
    assert.equal(call("booking-add", ctxA, { tripId: t.id, type: "teleport" }).ok, false);
  });
});

describe("travel.price-watch (Hopper shape)", () => {
  it("tracks price history, trend and buy/wait recommendation", () => {
    const w = call("price-watch-create", ctxA, { subject: "SFO→NRT", kind: "flight", targetPrice: 700, currentPrice: 950 }).result.watch;
    call("price-watch-update", ctxA, { id: w.id, price: 880 });   // falling
    let list = call("price-watch-list", ctxA, {});
    assert.equal(list.result.watches[0].trend, "falling");
    assert.equal(list.result.watches[0].recommendation, "wait");
    call("price-watch-update", ctxA, { id: w.id, price: 680 });   // below target
    list = call("price-watch-list", ctxA, {});
    assert.equal(list.result.watches[0].belowTarget, true);
    assert.equal(list.result.watches[0].recommendation, "buy_now");
    assert.equal(list.result.triggered, 1);
  });

  it("rejects non-positive prices", () => {
    assert.equal(call("price-watch-create", ctxA, { subject: "X", currentPrice: 0 }).ok, false);
  });
});

describe("travel.documents + checklist", () => {
  it("documents flag expiry status", () => {
    call("travel-doc-add", ctxA, { title: "Passport", kind: "passport", expiryDate: "2020-01-01" });
    call("travel-doc-add", ctxA, { title: "Insurance", kind: "insurance", expiryDate: "2030-01-01" });
    const docs = call("travel-doc-list", ctxA, {});
    assert.equal(docs.result.documents.find((d) => d.kind === "passport").expiryStatus, "expired");
    assert.equal(docs.result.documents.find((d) => d.kind === "insurance").expiryStatus, "valid");
  });

  it("checklist add / toggle / count", () => {
    const t = newTrip();
    const item = call("checklist-add", ctxA, { tripId: t.id, item: "Pack adapter" }).result.item;
    call("checklist-add", ctxA, { tripId: t.id, item: "Buy SIM" });
    call("checklist-toggle", ctxA, { tripId: t.id, id: item.id });
    const list = call("checklist-list", ctxA, { tripId: t.id });
    assert.equal(list.result.total, 2);
    assert.equal(list.result.done, 1);
  });
});

describe("travel.travel-dashboard", () => {
  it("aggregates upcoming trips, watches and bookings", () => {
    const t = newTrip(ctxA, { startDate: "2099-01-01", endDate: "2099-01-10" });
    call("booking-add", ctxA, { tripId: t.id, type: "flight", cost: 500 });
    call("price-watch-create", ctxA, { subject: "X", targetPrice: 100, currentPrice: 90 });
    const d = call("travel-dashboard", ctxA, {});
    assert.equal(d.result.upcomingTrips, 1);
    assert.equal(d.result.nextTrip.name, "Japan 2026");
    assert.equal(d.result.watchesTriggered, 1);
    assert.equal(d.result.totalBooked, 500);
  });
});
