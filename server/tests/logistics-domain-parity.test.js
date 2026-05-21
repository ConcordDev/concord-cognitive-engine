import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLogisticsActions from "../domains/logistics.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`logistics.${name}`);
  assert.ok(fn, `logistics.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerLogisticsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});
const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("logistics.shipments-* + track (real carrier API)", () => {
  it("returns error pointing to SHIPENGINE_API_KEY / EASYPOST_API_KEY when no broker wired", async () => {
    delete process.env.SHIPENGINE_API_KEY;
    delete process.env.EASYPOST_API_KEY;
    const r = await call("shipment-track", ctxA, { trackingNumber: "1Z999AA10123456784", carrier: "UPS" });
    assert.equal(r.ok, false);
    assert.match(r.error, /SHIPENGINE_API_KEY|EASYPOST_API_KEY/);
  });
  it("rejects empty tracking number", async () => {
    assert.equal((await call("shipment-track", ctxA, { trackingNumber: "" })).ok, false);
  });
  it("parses ShipEngine response when key set + fetch mocked", async () => {
    process.env.SHIPENGINE_API_KEY = "test-key";
    globalThis.fetch = async (url) => {
      assert.match(url, /shipengine\.com\/v1\/tracking/);
      return {
        ok: true,
        json: async () => ({
          status_code: "in_transit", estimated_delivery_date: "2026-05-20",
          events: [{ occurred_at: "2026-05-16T09:00:00Z", city_locality: "Los Angeles", state_province: "CA", country_code: "US", description: "Picked up by carrier" }],
        }),
      };
    };
    const r = await call("shipment-track", ctxA, { trackingNumber: "1Z999", carrier: "UPS" });
    assert.equal(r.ok, true);
    assert.equal(r.result.shipment.source, "shipengine");
    assert.equal(r.result.shipment.status, "in_transit");
    delete process.env.SHIPENGINE_API_KEY;
  });
});

describe("logistics.route-optimize (real OSRM routing)", () => {
  it("rejects fewer than 2 stops", async () => {
    assert.equal((await call("route-optimize", ctxA, { stops: ["A"] })).ok, false);
  });
  it("rejects when coords not supplied and Nominatim unreachable", async () => {
    const r = await call("route-optimize", ctxA, { stops: ["100 Main St", "200 Oak Ave"], vehicleType: "van" });
    assert.equal(r.ok, false);
    assert.match(r.error, /geocoding unreachable|nominatim/);
  });
  it("optimizes with caller-supplied coords + mocked OSRM matrix", async () => {
    globalThis.fetch = async (url) => {
      assert.match(url, /router\.project-osrm\.org\/table/);
      return {
        ok: true,
        json: async () => ({
          distances: [[0, 16093, 32186, 48279], [16093, 0, 16093, 32186], [32186, 16093, 0, 16093], [48279, 32186, 16093, 0]],
        }),
      };
    };
    const r = await call("route-optimize", ctxA, {
      stops: ["A", "B", "C", "D"],
      coords: [{ lat: 37.7, lng: -122.4 }, { lat: 37.71, lng: -122.41 }, { lat: 37.72, lng: -122.42 }, { lat: 37.73, lng: -122.43 }],
      vehicleType: "van",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.stops.length, 4);
    assert.ok(r.result.totalDistanceMi > 0);
    assert.ok(r.result.fuelCostUsd > 0);
  });
  it("EV is cheaper to operate than truck on the same OSRM matrix", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ distances: [[0, 16093, 32186], [16093, 0, 16093], [32186, 16093, 0]] }),
    });
    const stops = ["A", "B", "C"];
    const coords = [{ lat: 37.7, lng: -122.4 }, { lat: 37.71, lng: -122.41 }, { lat: 37.72, lng: -122.42 }];
    const truck = await call("route-optimize", ctxA, { stops, coords, vehicleType: "truck" });
    const ev = await call("route-optimize", ctxA, { stops, coords, vehicleType: "ev" });
    assert.ok(ev.result.fuelCostUsd < truck.result.fuelCostUsd);
  });
});

describe("logistics.inventory-list", () => {
  it("returns empty + setup hint when no real inventory feed is wired (no SAMPLE_SKUS fallback)", () => {
    const r = call("inventory-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.items, []);
    assert.equal(r.result.source, "empty");
    assert.match(r.result.notes, /warehouse feed|WMS|Shopify/);
  });
});

describe("regression: pre-existing macros", () => {
  it("registered count plausible", () => assert.ok(ACTIONS.size >= 5));
});

// ── Full-app parity (FedEx + Project44 + SAP TMS 2026) ─────────

describe("logistics.shipments-create/get/delete/set-status", () => {
  it("create / get / set-status / delete cycle, per-user scoped", () => {
    const a = call("shipments-create", ctxA, { origin: "Austin, TX", destination: "Boston, MA", carrierId: "c1", mode: "parcel", weightLbs: 12 });
    assert.equal(a.ok, true);
    assert.match(a.result.shipment.trackingNumber, /^1Z/);
    const id = a.result.shipment.id;
    const got = call("shipments-get", ctxA, { id });
    assert.equal(got.result.shipment.origin, "Austin, TX");
    assert.equal(call("shipments-get", ctxB, { id }).ok, false);
    const st = call("shipments-set-status", ctxA, { id, status: "in_transit" });
    assert.equal(st.result.shipment.status, "in_transit");
    const events = call("shipment-events", ctxA, { shipmentId: id });
    assert.equal(events.result.events.length, 1);
    const del = call("shipments-delete", ctxA, { id });
    assert.equal(del.ok, true);
  });
  it("rejects empty origin/dest and invalid status", () => {
    assert.equal(call("shipments-create", ctxA, { origin: "", destination: "X" }).ok, false);
    const c = call("shipments-create", ctxA, { origin: "A", destination: "B" });
    assert.equal(call("shipments-set-status", ctxA, { id: c.result.shipment.id, status: "bogus" }).ok, false);
  });
  it("delivered status records actualDelivery timestamp", () => {
    const c = call("shipments-create", ctxA, { origin: "A", destination: "B" });
    call("shipments-set-status", ctxA, { id: c.result.shipment.id, status: "delivered" });
    const got = call("shipments-get", ctxA, { id: c.result.shipment.id });
    assert.ok(got.result.shipment.actualDelivery);
  });
});

describe("logistics.carriers-*", () => {
  it("add / list / delete cycle", () => {
    const a = call("carriers-add", ctxA, { name: "FedEx", code: "FDX", scac: "FDEG", modes: ["parcel", "air"] });
    assert.equal(a.ok, true);
    assert.equal(a.result.carrier.code, "FDX");
    assert.equal(call("carriers-list", ctxA, {}).result.carriers.length, 1);
    assert.equal(call("carriers-delete", ctxA, { id: a.result.carrier.id }).ok, true);
  });
  it("rejects missing name/code", () => {
    assert.equal(call("carriers-add", ctxA, { name: "", code: "X" }).ok, false);
    assert.equal(call("carriers-add", ctxA, { name: "X", code: "" }).ok, false);
  });
});

describe("logistics.rates-quote (multi-carrier compare)", () => {
  it("requires at least one carrier", () => {
    const r = call("rates-quote", ctxA, { origin: "A", destination: "B", mode: "parcel" });
    assert.equal(r.ok, false);
  });
  it("returns ranked quotes when carriers configured", () => {
    call("carriers-add", ctxA, { name: "FedEx", code: "FDX", modes: ["parcel"] });
    call("carriers-add", ctxA, { name: "UPS", code: "UPS", modes: ["parcel"] });
    call("carriers-add", ctxA, { name: "USPS", code: "USPS", modes: ["parcel"] });
    const r = call("rates-quote", ctxA, { origin: "Austin, TX", destination: "Boston, MA", weightLbs: 5, mode: "parcel" });
    assert.equal(r.ok, true);
    assert.equal(r.result.quotes.length, 3);
    // Verify sorted ascending by rate
    for (let i = 1; i < r.result.quotes.length; i++) {
      assert.ok(r.result.quotes[i].rateUsd >= r.result.quotes[i - 1].rateUsd);
    }
  });
  it("filters carriers by mode capability", () => {
    call("carriers-add", ctxA, { name: "FedEx", code: "FDX", modes: ["parcel"] });
    call("carriers-add", ctxA, { name: "OceanCo", code: "OCN", modes: ["ocean"] });
    const r = call("rates-quote", ctxA, { origin: "A", destination: "B", mode: "parcel" });
    assert.equal(r.result.quotes.length, 1);
    assert.equal(r.result.quotes[0].carrierCode, "FDX");
  });
});

describe("logistics.pickups-* (carrier pickup)", () => {
  it("schedule / list / cancel cycle", () => {
    const c = call("carriers-add", ctxA, { name: "FedEx", code: "FDX" });
    const p = call("pickups-schedule", ctxA, { carrierId: c.result.carrier.id, address: "123 Main", date: "2026-06-01", packageCount: 5 });
    assert.equal(p.ok, true);
    assert.match(p.result.pickup.confirmationNumber, /^PKP/);
    const cancel = call("pickups-cancel", ctxA, { id: p.result.pickup.id });
    assert.equal(cancel.result.pickup.status, "cancelled");
  });
  it("rejects unknown carrier and missing required fields", () => {
    assert.equal(call("pickups-schedule", ctxA, { carrierId: "nope", address: "X", date: "2026-01-01" }).ok, false);
    const c = call("carriers-add", ctxA, { name: "X", code: "Y" });
    assert.equal(call("pickups-schedule", ctxA, { carrierId: c.result.carrier.id, address: "", date: "2026-01-01" }).ok, false);
  });
});

describe("logistics.delivery-confirm (POD)", () => {
  it("creates POD + flips shipment to delivered", () => {
    const s = call("shipments-create", ctxA, { origin: "A", destination: "B" });
    const pod = call("delivery-confirm", ctxA, { shipmentId: s.result.shipment.id, signatureName: "J. Smith", receivedBy: "J. Smith", gpsLat: 42.36, gpsLng: -71.05 });
    assert.equal(pod.ok, true);
    assert.equal(pod.result.shipment.status, "delivered");
    assert.equal(pod.result.pod.signatureName, "J. Smith");
    assert.equal(call("pods-list", ctxA, { shipmentId: s.result.shipment.id }).result.pods.length, 1);
  });
  it("rejects unknown shipment", () => {
    assert.equal(call("delivery-confirm", ctxA, { shipmentId: "nope" }).ok, false);
  });
});

describe("logistics.docks-* + dock-appointments-* (Project44)", () => {
  it("create dock + book appointment + cancel cycle", () => {
    const d = call("docks-create", ctxA, { name: "Dock A1", facility: "Houston DC", kind: "loading" });
    assert.equal(d.ok, true);
    const a = call("dock-appointments-book", ctxA, { dockId: d.result.dock.id, date: "2026-06-01", startTime: "09:00", durationMin: 60, kind: "delivery", truckNumber: "T-101" });
    assert.equal(a.ok, true);
    const cancel = call("dock-appointments-cancel", ctxA, { id: a.result.appointment.id });
    assert.equal(cancel.result.appointment.status, "cancelled");
  });
  it("rejects overlapping appointment on same dock", () => {
    const d = call("docks-create", ctxA, { name: "Dock B", facility: "F" });
    call("dock-appointments-book", ctxA, { dockId: d.result.dock.id, date: "2026-06-01", startTime: "09:00", durationMin: 60 });
    const conflict = call("dock-appointments-book", ctxA, { dockId: d.result.dock.id, date: "2026-06-01", startTime: "09:30", durationMin: 30 });
    assert.equal(conflict.ok, false);
    assert.match(conflict.error, /conflict/);
  });
});

describe("logistics.fleet-vehicles-*", () => {
  it("add / list / update-status / delete cycle", () => {
    const v = call("fleet-vehicles-add", ctxA, { number: "T-101", kind: "box_truck", make: "Freightliner", year: 2023, capacityLbs: 26000 });
    assert.equal(v.ok, true);
    assert.equal(v.result.vehicle.status, "available");
    const u = call("fleet-vehicles-update-status", ctxA, { id: v.result.vehicle.id, status: "in_use", mileage: 50000, lat: 30.27, lng: -97.74 });
    assert.equal(u.result.vehicle.status, "in_use");
    assert.equal(u.result.vehicle.mileage, 50000);
    assert.equal(call("fleet-vehicles-delete", ctxA, { id: v.result.vehicle.id }).ok, true);
  });
  it("rejects missing number / invalid status", () => {
    assert.equal(call("fleet-vehicles-add", ctxA, { number: "" }).ok, false);
    const v = call("fleet-vehicles-add", ctxA, { number: "X" });
    assert.equal(call("fleet-vehicles-update-status", ctxA, { id: v.result.vehicle.id, status: "bogus" }).ok, false);
  });
});

describe("logistics.loads-* (load board + bidding)", () => {
  it("post / bid / accept-bid cycle", () => {
    const l = call("loads-post", ctxA, { origin: "Dallas", destination: "Atlanta", ratePerMile: 2.5, weightLbs: 35000, equipment: "reefer" });
    assert.equal(l.ok, true);
    call("loads-bid", ctxA, { id: l.result.load.id, carrierId: "carrierA", amount: 2200 });
    call("loads-bid", ctxA, { id: l.result.load.id, carrierId: "carrierB", amount: 2100 });
    const accept = call("loads-accept-bid", ctxA, { id: l.result.load.id, carrierId: "carrierB" });
    assert.equal(accept.result.load.status, "booked");
    assert.equal(accept.result.load.bookedAmount, 2100);
  });
  it("rejects invalid input", () => {
    assert.equal(call("loads-post", ctxA, { origin: "A", destination: "", ratePerMile: 2 }).ok, false);
    assert.equal(call("loads-post", ctxA, { origin: "A", destination: "B", ratePerMile: 0 }).ok, false);
  });
});

describe("logistics.dashboard-summary (TmsShell data source)", () => {
  it("aggregates shipments + carriers + fleet + pickups + loads", () => {
    call("carriers-add", ctxA, { name: "FedEx", code: "FDX" });
    const s1 = call("shipments-create", ctxA, { origin: "A", destination: "B" });
    call("shipments-set-status", ctxA, { id: s1.result.shipment.id, status: "in_transit" });
    const s2 = call("shipments-create", ctxA, { origin: "C", destination: "D" });
    call("delivery-confirm", ctxA, { shipmentId: s2.result.shipment.id, signatureName: "X" });
    call("fleet-vehicles-add", ctxA, { number: "T-1" });
    call("loads-post", ctxA, { origin: "X", destination: "Y", ratePerMile: 2 });
    const d = call("dashboard-summary", ctxA, {});
    assert.equal(d.result.totalShipments, 2);
    assert.equal(d.result.inTransit, 1);
    assert.equal(d.result.deliveredToday, 1);
    assert.equal(d.result.carrierCount, 1);
    assert.equal(d.result.vehicles, 1);
    assert.equal(d.result.loadsAvailable, 1);
  });
});

// ════════════════════════════════════════════════════════════════
//  Feature-parity backlog (vs Project44 / FourKites visibility)
// ════════════════════════════════════════════════════════════════

describe("[L] logistics.gps-track-* — real-time GPS/ELD feed + live ETA", () => {
  it("gps-track-init creates a track with computed total distance", () => {
    const r = call("gps-track-init", ctxA, {
      shipmentId: "shp1", originLat: 30.27, originLng: -97.74, destLat: 32.78, destLng: -96.80,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.track.shipmentId, "shp1");
    assert.ok(r.result.track.totalDistanceMi > 0);
    assert.equal(r.result.track.status, "awaiting_first_ping");
  });
  it("gps-track-init rejects missing/non-numeric coords", () => {
    assert.equal(call("gps-track-init", ctxA, { shipmentId: "x" }).ok, false);
    assert.equal(call("gps-track-init", ctxA, { originLat: 1, originLng: 2, destLat: 3, destLng: 4 }).ok, false);
  });
  it("gps-ping recomputes a live ETA from measured speed between two real pings", () => {
    call("gps-track-init", ctxA, { shipmentId: "shp2", originLat: 30.0, originLng: -97.0, destLat: 31.0, destLng: -97.0 });
    const p1 = call("gps-ping", ctxA, { shipmentId: "shp2", lat: 30.0, lng: -97.0, at: "2026-05-21T08:00:00Z" });
    assert.equal(p1.ok, true);
    const p2 = call("gps-ping", ctxA, { shipmentId: "shp2", lat: 30.5, lng: -97.0, at: "2026-05-21T09:00:00Z" });
    assert.equal(p2.ok, true);
    assert.ok(p2.result.measuredSpeedMph > 0);
    assert.ok(p2.result.etaIso);
    assert.ok(p2.result.progressPct > 0);
  });
  it("gps-ping rejects unknown track + gps-track-get returns the track", () => {
    assert.equal(call("gps-ping", ctxA, { shipmentId: "nope", lat: 1, lng: 2 }).ok, false);
    call("gps-track-init", ctxA, { shipmentId: "shp3", originLat: 0, originLng: 0, destLat: 1, destLng: 1 });
    const g = call("gps-track-get", ctxA, { shipmentId: "shp3" });
    assert.equal(g.ok, true);
    assert.equal(g.result.track.shipmentId, "shp3");
    assert.equal(call("gps-track-get", ctxA, {}).result.tracks.length, 1);
  });
});

describe("[M] logistics.delay-risk-score — predictive ETA + delay-risk scoring", () => {
  it("scores an in-transit shipment with no GPS track as elevated risk", () => {
    const s = call("shipments-create", ctxA, { origin: "A", destination: "B" });
    call("shipments-set-status", ctxA, { id: s.result.shipment.id, status: "in_transit" });
    const r = call("delay-risk-score", ctxA, { shipmentId: s.result.shipment.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.riskScore >= 20);
    assert.ok(["low", "medium", "high"].includes(r.result.riskTier));
    assert.ok(r.result.factors.some((f) => f.factor === "no_gps"));
  });
  it("flags an exception shipment as a high-risk factor", () => {
    const s = call("shipments-create", ctxA, { origin: "A", destination: "B" });
    call("exceptions-flag", ctxA, { shipmentId: s.result.shipment.id, kind: "delay", severity: "high" });
    const r = call("delay-risk-score", ctxA, { shipmentId: s.result.shipment.id });
    assert.ok(r.result.factors.some((f) => f.factor === "status_exception"));
  });
  it("rejects unknown shipment", () => {
    assert.equal(call("delay-risk-score", ctxA, { shipmentId: "nope" }).ok, false);
  });
});

describe("[M] logistics.vrp-optimize — capacity-constrained multi-stop routing", () => {
  it("splits stops across vehicles by capacity and orders each route", () => {
    const r = call("vrp-optimize", ctxA, {
      depot: { lat: 30.0, lng: -97.0 },
      stops: [
        { stopId: "s1", lat: 30.1, lng: -97.0, demand: 600 },
        { stopId: "s2", lat: 30.2, lng: -97.1, demand: 600 },
        { stopId: "s3", lat: 30.3, lng: -97.2, demand: 600 },
      ],
      vehicleCount: 3,
      vehicleCapacity: 1000,
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.vehiclesUsed >= 2);
    assert.equal(r.result.totalStops, 3);
    assert.ok(r.result.totalDistanceMi > 0);
    assert.equal(r.result.overCapacity, false);
  });
  it("rejects missing depot and empty stops", () => {
    assert.equal(call("vrp-optimize", ctxA, { stops: [{ lat: 1, lng: 2 }] }).ok, false);
    assert.equal(call("vrp-optimize", ctxA, { depot: { lat: 1, lng: 2 }, stops: [] }).ok, false);
  });
});

describe("[M] logistics.carrier-scorecard — on-time/damage/tender analytics", () => {
  it("computes a composite letter grade from real shipments + tenders + damage", () => {
    const c = call("carriers-add", ctxA, { name: "FedEx", code: "FDX" });
    const cid = c.result.carrier.id;
    const s = call("shipments-create", ctxA, { origin: "A", destination: "B", carrierId: cid });
    call("tender-record", ctxA, { carrierId: cid, outcome: "accepted" });
    call("damage-report", ctxA, { shipmentId: s.result.shipment.id, severity: "minor", claimAmountUsd: 50 });
    const r = call("carrier-scorecard", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.scorecards.length, 1);
    const card = r.result.scorecards[0];
    assert.equal(card.carrierCode, "FDX");
    assert.ok("letterGrade" in card && "grade" in card);
    assert.equal(card.tenderOffers, 1);
    assert.equal(card.damageReports, 1);
  });
  it("tender-record rejects bad outcome / unknown carrier", () => {
    assert.equal(call("tender-record", ctxA, { carrierId: "x", outcome: "bogus" }).ok, false);
    assert.equal(call("tender-record", ctxA, { carrierId: "nope", outcome: "accepted" }).ok, false);
  });
  it("damage-report rejects unknown shipment", () => {
    assert.equal(call("damage-report", ctxA, { shipmentId: "nope" }).ok, false);
  });
});

describe("[S] logistics.geofence-* — milestone auto-events", () => {
  it("create / list / delete geofence cycle", () => {
    const g = call("geofence-create", ctxA, { name: "Houston DC", lat: 29.76, lng: -95.36, radiusMi: 2, kind: "hub" });
    assert.equal(g.ok, true);
    assert.equal(call("geofences-list", ctxA, {}).result.geofences.length, 1);
    assert.equal(call("geofence-delete", ctxA, { id: g.result.geofence.id }).ok, true);
  });
  it("geofence-evaluate emits arrived then departed milestone events", () => {
    call("geofence-create", ctxA, { name: "Hub", lat: 30.0, lng: -97.0, radiusMi: 5 });
    const e1 = call("geofence-evaluate", ctxA, { shipmentId: "shpG", lat: 30.0, lng: -97.0, at: "2026-05-21T08:00:00Z" });
    assert.equal(e1.ok, true);
    assert.equal(e1.result.milestones[0].kind, "arrived");
    const e2 = call("geofence-evaluate", ctxA, { shipmentId: "shpG", lat: 32.0, lng: -99.0, at: "2026-05-21T09:00:00Z" });
    assert.equal(e2.result.milestones[0].kind, "departed");
    assert.ok(e2.result.milestones[0].dwellMinutes >= 0);
    assert.equal(call("milestones-list", ctxA, { shipmentId: "shpG" }).result.milestones.length, 2);
  });
  it("geofence-evaluate rejects when no geofences exist", () => {
    assert.equal(call("geofence-evaluate", ctxA, { shipmentId: "x", lat: 1, lng: 2 }).ok, false);
  });
});

describe("[M] logistics.freight-invoice-* — invoice reconciliation vs quoted rate", () => {
  it("audits an overbilled invoice and flags variance", () => {
    const r = call("freight-invoice-audit", ctxA, {
      invoiceNumber: "INV-1", carrierId: "c1", quotedAmountUsd: 1000, invoicedAmountUsd: 1200,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.invoice.status, "overbilled");
    assert.equal(r.result.invoice.varianceUsd, 200);
    assert.ok(r.result.invoice.disputableUsd > 0);
  });
  it("approves an invoice within tolerance", () => {
    const r = call("freight-invoice-audit", ctxA, {
      invoiceNumber: "INV-2", quotedAmountUsd: 1000, invoicedAmountUsd: 1010,
    });
    assert.equal(r.result.invoice.status, "approved");
  });
  it("dispute + summary aggregate reconciled invoices", () => {
    const a = call("freight-invoice-audit", ctxA, { invoiceNumber: "INV-3", quotedAmountUsd: 500, invoicedAmountUsd: 700 });
    const d = call("freight-invoice-dispute", ctxA, { id: a.result.invoice.id, action: "dispute", note: "detention not approved" });
    assert.equal(d.result.invoice.status, "disputed");
    const sum = call("freight-audit-summary", ctxA, {});
    assert.equal(sum.result.invoiceCount, 1);
    assert.equal(sum.result.disputedCount, 1);
  });
  it("rejects missing invoice number / negative amounts", () => {
    assert.equal(call("freight-invoice-audit", ctxA, { quotedAmountUsd: 1, invoicedAmountUsd: 1 }).ok, false);
    assert.equal(call("freight-invoice-audit", ctxA, { invoiceNumber: "X", quotedAmountUsd: -1, invoicedAmountUsd: 1 }).ok, false);
  });
});

describe("[S] logistics.exceptions-* — exception management dashboard", () => {
  it("flag / update / dashboard cycle with severity-ranked triage queue", () => {
    const s1 = call("shipments-create", ctxA, { origin: "A", destination: "B" });
    const s2 = call("shipments-create", ctxA, { origin: "C", destination: "D" });
    call("exceptions-flag", ctxA, { shipmentId: s1.result.shipment.id, kind: "delay", severity: "low" });
    const exc = call("exceptions-flag", ctxA, { shipmentId: s2.result.shipment.id, kind: "damage", severity: "critical" });
    assert.equal(exc.ok, true);
    const dash = call("exceptions-dashboard", ctxA, {});
    assert.equal(dash.result.totalExceptions, 2);
    assert.equal(dash.result.openCount, 2);
    // Critical sorts to the front of the triage queue.
    assert.equal(dash.result.triageQueue[0].severity, "critical");
    const u = call("exceptions-update", ctxA, { id: exc.result.exception.id, status: "resolved" });
    assert.equal(u.result.exception.status, "resolved");
    assert.ok(u.result.exception.resolvedAt);
    assert.equal(call("exceptions-dashboard", ctxA, {}).result.resolvedCount, 1);
  });
  it("exceptions-flag rejects unknown shipment + flips shipment to exception status", () => {
    assert.equal(call("exceptions-flag", ctxA, { shipmentId: "nope" }).ok, false);
    const s = call("shipments-create", ctxA, { origin: "A", destination: "B" });
    call("exceptions-flag", ctxA, { shipmentId: s.result.shipment.id, kind: "lost", severity: "high" });
    assert.equal(call("shipments-get", ctxA, { id: s.result.shipment.id }).result.shipment.status, "exception");
  });
  it("exceptions-update rejects invalid status", () => {
    const s = call("shipments-create", ctxA, { origin: "A", destination: "B" });
    const e = call("exceptions-flag", ctxA, { shipmentId: s.result.shipment.id, kind: "other", severity: "medium" });
    assert.equal(call("exceptions-update", ctxA, { id: e.result.exception.id, status: "bogus" }).ok, false);
  });
});
