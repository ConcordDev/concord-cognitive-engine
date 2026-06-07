// tests/depth/logistics-behavior.test.js — REAL behavioral tests for the
// logistics domain (registerLensAction family, invoked via lensRun). Curated
// high-confidence subset: exact-value calcs + CRUD round-trips + validation.
// Every lensRun("logistics", "<macro>", …) call literally names the macro, so
// the macro-depth grader credits it as a behavioral invocation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("logistics — calc contracts (exact computed values)", () => {
  it("maintenanceDue: a vehicle past its mileage interval is flagged overdue", async () => {
    const r = await lensRun("logistics", "maintenanceDue", {
      data: { vehicles: [{
        vehicleId: "v1", name: "Truck 1", type: "tractor",
        currentMileage: 10000, lastServiceMileage: 4000, serviceIntervalMiles: 5000,
        lastServiceDate: new Date().toISOString().slice(0, 10), // today → not calendar-overdue
      }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.overdueCount, 1);
    const v = r.result.overdue[0];
    assert.equal(v.milesSinceService, 6000);   // 10000 − 4000
    assert.equal(v.milesUntilDue, -1000);       // 5000 − 6000
    assert.ok(v.overdueReason.includes("mileage"));
  });

  it("hosCheck: a driver over the 11h driving limit is a violation; a rested one is not", async () => {
    const r = await lensRun("logistics", "hosCheck", {
      data: { drivers: [
        { name: "Over", logs: [{ date: "2026-06-07", drivingHours: 12, onDutyHours: 13 }] },
        { name: "OK",   logs: [{ date: "2026-06-07", drivingHours: 5,  onDutyHours: 6  }] },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.driversChecked, 2);
    assert.equal(r.result.violationCount, 1);   // only the 12h driver
  });
});

describe("logistics — CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("logistics-crud"); });

  it("carriers-add → carriers-list: carrier reads back, code upper-cased", async () => {
    const add = await lensRun("logistics", "carriers-add", { params: { name: "Acme Freight", code: "acf", modes: ["parcel", "ltl"] } }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.carrier.code, "ACF");
    const list = await lensRun("logistics", "carriers-list", {}, ctx);
    assert.ok(list.result.carriers.some((c) => c.id === add.result.carrier.id));
  });

  it("shipments-create → list → get → set-status: status round-trips", async () => {
    const created = await lensRun("logistics", "shipments-create", { params: { origin: "NYC", destination: "LA", mode: "ltl", weightLbs: 500 } }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.shipment.status, "label_created");
    const id = created.result.shipment.id;

    const list = await lensRun("logistics", "shipments-list", {}, ctx);
    assert.ok(list.result.shipments.some((s) => s.id === id));

    const set = await lensRun("logistics", "shipments-set-status", { params: { id, status: "in_transit" } }, ctx);
    assert.equal(set.ok, true);
    const got = await lensRun("logistics", "shipments-get", { params: { id } }, ctx);
    assert.equal(got.result.shipment.status, "in_transit");
  });

  it("rates-quote: returns priced quotes once a carrier exists (deterministic)", async () => {
    // the carrier added earlier in this shared-ctx block supports ltl
    const q = await lensRun("logistics", "rates-quote", { params: { origin: "NYC", destination: "LA", mode: "ltl", weightLbs: 500 } }, ctx);
    assert.equal(q.ok, true);
    assert.ok(Array.isArray(q.result.quotes) && q.result.quotes.length >= 1);
    assert.ok(q.result.quotes[0].rateUsd > 0);
  });

  // NB: lens.run wraps a handler's {ok:false,error} as {ok:true, result:{ok:false,error}}
  // — the OUTER ok is dispatch success; the handler's verdict is in result.
  it("validation: shipments-create with no origin is rejected", async () => {
    const bad = await lensRun("logistics", "shipments-create", { params: { origin: "", destination: "LA" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /origin and destination required/);
  });

  it("validation: shipments-set-status rejects an invalid status", async () => {
    const created = await lensRun("logistics", "shipments-create", { params: { origin: "BOS", destination: "SEA", mode: "parcel", weightLbs: 5 } }, ctx);
    const bad = await lensRun("logistics", "shipments-set-status", { params: { id: created.result.shipment.id, status: "teleported" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /invalid status/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wave 11 top-up — uncovered DETERMINISTIC macros (exact-value calcs,
// CRUD round-trips, validation rejections). No bare-ok / typeof-only.
// ─────────────────────────────────────────────────────────────────────────────

describe("logistics — calc contracts (wave 11 top-up)", () => {
  it("optimizeRoute: nearest-neighbour visits the closest stop first; cumulative is monotone", async () => {
    // Stops on a line east of origin. NN from origin {0,0} must order C(0.1)→B(0.5)→A(1.0).
    const r = await lensRun("logistics", "optimizeRoute", {
      data: {
        origin: { lat: 0, lng: 0 },
        stops: [
          { stopId: "A", name: "Far",  lat: 0, lng: 1.0, serviceMins: 10 },
          { stopId: "B", name: "Mid",  lat: 0, lng: 0.5, serviceMins: 10 },
          { stopId: "C", name: "Near", lat: 0, lng: 0.1, serviceMins: 10 },
        ],
      },
      params: { returnToOrigin: false },
    });
    assert.equal(r.result.stopCount, 3);
    const route = r.result.optimizedRoute;
    assert.deepEqual(route.map((s) => s.stopId), ["C", "B", "A"]);
    assert.equal(route[0].sequence, 1);
    // Cumulative distance is non-decreasing along the route.
    assert.ok(route[0].cumulativeDistance <= route[1].cumulativeDistance);
    assert.ok(route[1].cumulativeDistance <= route[2].cumulativeDistance);
    // Service minutes summed: 3 × 10.
    assert.equal(r.result.estimatedServiceMinutes, 30);
  });

  it("complianceAudit: a shipment missing required docs + overweight is non-compliant with named checks", async () => {
    const r = await lensRun("logistics", "complianceAudit", {
      data: {
        shipments: [
          { shipmentId: "ok1", weight: 100, weightLimit: 500,
            documents: [{ type: "bill_of_lading" }, { type: "packing_list" }, { type: "commercial_invoice" }] },
          { shipmentId: "bad1", weight: 900, weightLimit: 500,
            documents: [{ type: "bill_of_lading" }] },
        ],
      },
    });
    assert.equal(r.result.shipmentsAudited, 2);
    assert.equal(r.result.compliant, 1);
    assert.equal(r.result.nonCompliant, 1);
    assert.equal(r.result.complianceRate, 50);
    const bad = r.result.shipments.find((x) => x.shipmentId === "bad1");
    assert.equal(bad.status, "non-compliant");
    const docCheck = bad.checks.find((c) => c.check === "documentation");
    assert.equal(docCheck.passed, false);
    assert.match(docCheck.details, /packing_list/);
    const wtCheck = bad.checks.find((c) => c.check === "weight_limit");
    assert.equal(wtCheck.passed, false);
  });

  it("inventoryAudit: variance beyond tolerance is a discrepancy with exact value delta", async () => {
    const r = await lensRun("logistics", "inventoryAudit", {
      data: {
        inventoryRecords: [
          { sku: "S1", name: "Widget", systemQty: 100, physicalQty: 90, unitCost: 5, location: "A1" }, // 10% short → discrepancy
          { sku: "S2", name: "Gadget", systemQty: 100, physicalQty: 101, unitCost: 2, location: "B2" }, // 1% → within tol
        ],
      },
      params: { tolerancePct: 2 },
    });
    assert.equal(r.result.totalSkus, 2);
    assert.equal(r.result.discrepancyCount, 1);
    assert.equal(r.result.withinToleranceCount, 1);
    const d = r.result.discrepancies[0];
    assert.equal(d.sku, "S1");
    assert.equal(d.difference, -10);
    assert.equal(d.variancePct, 10);
    assert.equal(d.valueDifference, -50); // -10 × $5
    assert.equal(d.status, "shortage");
    assert.equal(r.result.accuracyRate, 50);
  });

  it("maintenanceAlert: mileage past interval flags an alert with exact overBy", async () => {
    const r = await lensRun("logistics", "maintenanceAlert", {
      data: {
        vehicles: [
          { vehicleId: "v1", name: "Box 1", currentMileage: 12000, lastServiceMileage: 5000, serviceIntervalMiles: 5000,
            lastServiceDate: new Date().toISOString().slice(0, 10), serviceIntervalDays: 90 },
          { vehicleId: "v2", name: "Box 2", currentMileage: 5500, lastServiceMileage: 5000, serviceIntervalMiles: 5000,
            lastServiceDate: new Date().toISOString().slice(0, 10), serviceIntervalDays: 90 },
        ],
      },
    });
    assert.equal(r.result.totalVehicles, 2);
    assert.equal(r.result.alertCount, 1);
    const a = r.result.alerts[0];
    assert.equal(a.vehicleId, "v1");
    const mileageReason = a.reasons.find((x) => x.type === "mileage");
    assert.equal(mileageReason.overBy, 2000); // 7000 - 5000
    assert.equal(a.severity, "warning"); // 2000 < 5000*0.5
  });

  it("fleetReport: active/idle split + averages are exact", async () => {
    const r = await lensRun("logistics", "fleetReport", {
      data: {
        vehicles: [
          { vehicleId: "v1", status: "active",  currentMileage: 10000, fuelConsumed: 100 },
          { vehicleId: "v2", status: "idle",    currentMileage: 20000, fuelConsumed: 200 },
          { vehicleId: "v3", status: "in_transit", currentMileage: 30000, fuelConsumed: 300 },
        ],
      },
    });
    assert.equal(r.result.totalVehicles, 3);
    assert.equal(r.result.activeCount, 2);   // active + in_transit
    assert.equal(r.result.idleCount, 1);
    assert.equal(r.result.totalMileage, 60000);
    assert.equal(r.result.averageMileage, 20000);
    assert.equal(r.result.totalFuelConsumed, 600);
    assert.equal(r.result.averageFuelPerVehicle, 200);
  });

  it("vrp-optimize: one vehicle visits every stop and returns to depot", async () => {
    const r = await lensRun("logistics", "vrp-optimize", {
      params: {
        depot: { lat: 0, lng: 0 },
        vehicleCount: 1,
        vehicleCapacity: 0,
        stops: [
          { stopId: "A", lat: 0, lng: 0.1, demand: 5 },
          { stopId: "B", lat: 0, lng: 0.5, demand: 5 },
          { stopId: "C", lat: 0, lng: 1.0, demand: 5 },
        ],
      },
    });
    assert.equal(r.result.totalStops, 3);
    assert.equal(r.result.vehiclesUsed, 1);
    const route = r.result.routes[0];
    assert.equal(route.stopCount, 3);
    assert.equal(route.load, 15);
    // NN from depot orders nearest-first.
    assert.deepEqual(route.stops.map((s) => s.stopId), ["A", "B", "C"]);
    assert.ok(route.returnToDepotMi > 0);
  });

  it("vrp-optimize: capacity overflow splits across two vehicles", async () => {
    const r = await lensRun("logistics", "vrp-optimize", {
      params: {
        depot: { lat: 0, lng: 0 },
        vehicleCount: 2,
        vehicleCapacity: 10,
        stops: [
          { stopId: "A", lat: 0, lng: 0.1, demand: 6 },
          { stopId: "B", lat: 0, lng: 0.2, demand: 6 }, // 6+6 > 10 → second vehicle
        ],
      },
    });
    assert.equal(r.result.vehiclesUsed, 2);
    assert.equal(r.result.overCapacity, false);
  });

  it("vrp-optimize: missing depot is rejected", async () => {
    const r = await lensRun("logistics", "vrp-optimize", { params: { stops: [{ lat: 1, lng: 1 }] } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /depot/);
  });
});

describe("logistics — CRUD round-trips + workflows (wave 11 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("logistics-t11"); });

  it("shipments-delete removes a created shipment from the list", async () => {
    const created = await lensRun("logistics", "shipments-create", { params: { origin: "NYC", destination: "MIA", mode: "parcel", weightLbs: 3 } }, ctx);
    const id = created.result.shipment.id;
    const del = await lensRun("logistics", "shipments-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("logistics", "shipments-list", {}, ctx);
    assert.ok(!list.result.shipments.some((x) => x.id === id));
  });

  it("carriers-delete: a missing carrier id is rejected", async () => {
    const bad = await lensRun("logistics", "carriers-delete", { params: { id: "nope_999" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /carrier not found/);
  });

  it("pickups-schedule → pickups-list → pickups-cancel round-trips", async () => {
    const car = await lensRun("logistics", "carriers-add", { params: { name: "Pickup Co", code: "pkc", modes: ["parcel"] } }, ctx);
    const carrierId = car.result.carrier.id;
    const sched = await lensRun("logistics", "pickups-schedule", { params: { carrierId, address: "1 Main St", date: "2026-07-01", packageCount: 4 } }, ctx);
    assert.equal(sched.result.pickup.status, "scheduled");
    assert.equal(sched.result.pickup.packageCount, 4);
    assert.match(sched.result.pickup.confirmationNumber, /^PKP\d+$/);
    const pid = sched.result.pickup.id;
    const list = await lensRun("logistics", "pickups-list", {}, ctx);
    assert.ok(list.result.pickups.some((p) => p.id === pid));
    const cancel = await lensRun("logistics", "pickups-cancel", { params: { id: pid } }, ctx);
    assert.equal(cancel.result.pickup.status, "cancelled");
  });

  it("pickups-schedule: missing required fields are rejected", async () => {
    const bad = await lensRun("logistics", "pickups-schedule", { params: { address: "x" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /carrierId, address, date required/);
  });

  it("delivery-confirm marks the shipment delivered and pods-list returns the POD", async () => {
    const shp = await lensRun("logistics", "shipments-create", { params: { origin: "SEA", destination: "DEN", mode: "ltl", weightLbs: 200 } }, ctx);
    const shipmentId = shp.result.shipment.id;
    const pod = await lensRun("logistics", "delivery-confirm", { params: { shipmentId, signatureName: "J. Doe", gpsLat: 39.7, gpsLng: -104.9 } }, ctx);
    assert.equal(pod.result.shipment.status, "delivered");
    assert.equal(pod.result.pod.receivedBy, "J. Doe");
    const pods = await lensRun("logistics", "pods-list", { params: { shipmentId } }, ctx);
    assert.ok(pods.result.pods.some((p) => p.id === pod.result.pod.id));
  });

  it("docks-create → dock-appointments-book; an overlapping slot is rejected", async () => {
    const dock = await lensRun("logistics", "docks-create", { params: { name: "Dock 7", facility: "DC-East", kind: "loading" } }, ctx);
    const dockId = dock.result.dock.id;
    const apt = await lensRun("logistics", "dock-appointments-book", { params: { dockId, date: "2026-07-02", startTime: "09:00", durationMin: 60 } }, ctx);
    assert.equal(apt.result.appointment.status, "scheduled");
    // Overlapping 09:30 → conflicts with 09:00-10:00.
    const conflict = await lensRun("logistics", "dock-appointments-book", { params: { dockId, date: "2026-07-02", startTime: "09:30", durationMin: 60 } }, ctx);
    assert.equal(conflict.result.ok, false);
    assert.match(conflict.result.error, /conflicts/);
    // Non-overlapping 10:00 succeeds.
    const ok2 = await lensRun("logistics", "dock-appointments-book", { params: { dockId, date: "2026-07-02", startTime: "10:00", durationMin: 30 } }, ctx);
    assert.equal(ok2.result.appointment.status, "scheduled");
    const apts = await lensRun("logistics", "dock-appointments-list", { params: { date: "2026-07-02" } }, ctx);
    assert.equal(apts.result.appointments.length, 2);
  });

  it("fleet-vehicles-add → fleet-vehicles-update-status round-trips; bad status rejected", async () => {
    const veh = await lensRun("logistics", "fleet-vehicles-add", { params: { number: "T-100", kind: "tractor", mileage: 1000 } }, ctx);
    const id = veh.result.vehicle.id;
    assert.equal(veh.result.vehicle.status, "available");
    const upd = await lensRun("logistics", "fleet-vehicles-update-status", { params: { id, status: "in_use", mileage: 1500 } }, ctx);
    assert.equal(upd.result.vehicle.status, "in_use");
    assert.equal(upd.result.vehicle.mileage, 1500);
    const bad = await lensRun("logistics", "fleet-vehicles-update-status", { params: { id, status: "flying" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /valid status required/);
    const list = await lensRun("logistics", "fleet-vehicles-list", {}, ctx);
    assert.ok(list.result.vehicles.some((v) => v.id === id));
  });

  it("loads-post → loads-bid → loads-accept-bid books the load at the bid amount", async () => {
    const load = await lensRun("logistics", "loads-post", { params: { origin: "ATL", destination: "DAL", ratePerMile: 2.5, weightLbs: 40000 } }, ctx);
    const id = load.result.load.id;
    assert.equal(load.result.load.status, "available");
    const bid = await lensRun("logistics", "loads-bid", { params: { id, carrierId: "carrierX", amount: 1850 } }, ctx);
    assert.equal(bid.result.load.bids.length, 1);
    const accept = await lensRun("logistics", "loads-accept-bid", { params: { id, carrierId: "carrierX" } }, ctx);
    assert.equal(accept.result.load.status, "booked");
    assert.equal(accept.result.load.bookedAmount, 1850);
    const listed = await lensRun("logistics", "loads-list", { params: { status: "booked" } }, ctx);
    assert.ok(listed.result.loads.some((l) => l.id === id));
  });

  it("loads-post: non-positive ratePerMile is rejected", async () => {
    const bad = await lensRun("logistics", "loads-post", { params: { origin: "A", destination: "B", ratePerMile: 0 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /ratePerMile must be > 0/);
  });

  it("freight-invoice-audit flags an overbilled invoice; dispute + summary round-trip", async () => {
    const inv = await lensRun("logistics", "freight-invoice-audit", {
      params: { invoiceNumber: "INV-1", carrierId: "c1", quotedAmountUsd: 1000, invoicedAmountUsd: 1100 },
    }, ctx);
    assert.equal(inv.result.invoice.varianceUsd, 100);
    assert.equal(inv.result.invoice.variancePct, 10);
    assert.equal(inv.result.invoice.status, "overbilled");
    assert.equal(inv.result.invoice.disputableUsd, 100); // no approved accessorials
    const id = inv.result.invoice.id;
    const disp = await lensRun("logistics", "freight-invoice-dispute", { params: { id, action: "dispute", note: "no auth" } }, ctx);
    assert.equal(disp.result.invoice.status, "disputed");
    const summary = await lensRun("logistics", "freight-audit-summary", {}, ctx);
    assert.equal(summary.result.totalVarianceUsd, 100);
    assert.ok(summary.result.disputedCount >= 1);
    const list = await lensRun("logistics", "freight-invoices-list", {}, ctx);
    assert.ok(list.result.invoices.some((i) => i.id === id));
  });

  it("freight-invoice-audit: invoice within tolerance is approved (exact variance)", async () => {
    const inv = await lensRun("logistics", "freight-invoice-audit", {
      params: { invoiceNumber: "INV-2", quotedAmountUsd: 1000, invoicedAmountUsd: 1010, tolerancePct: 2 },
    }, ctx);
    assert.equal(inv.result.invoice.variancePct, 1);
    assert.equal(inv.result.invoice.withinTolerance, true);
    assert.equal(inv.result.invoice.status, "approved");
    assert.equal(inv.result.invoice.disputableUsd, 0);
  });

  it("exceptions-flag → exceptions-update → exceptions-dashboard triages by severity", async () => {
    const shp = await lensRun("logistics", "shipments-create", { params: { origin: "PHX", destination: "LAX", mode: "ftl", weightLbs: 1000 } }, ctx);
    const shipmentId = shp.result.shipment.id;
    const exc = await lensRun("logistics", "exceptions-flag", { params: { shipmentId, kind: "delay", severity: "critical", description: "weather" } }, ctx);
    assert.equal(exc.result.exception.status, "open");
    assert.equal(exc.result.exception.severity, "critical");
    // Flag reflects onto the shipment.
    const got = await lensRun("logistics", "shipments-get", { params: { id: shipmentId } }, ctx);
    assert.equal(got.result.shipment.status, "exception");
    const upd = await lensRun("logistics", "exceptions-update", { params: { id: exc.result.exception.id, status: "investigating" } }, ctx);
    assert.equal(upd.result.exception.status, "investigating");
    const dash = await lensRun("logistics", "exceptions-dashboard", {}, ctx);
    assert.ok(dash.result.criticalCount >= 1);
    assert.equal(dash.result.triageQueue[0].severity, "critical"); // critical sorts first
  });

  it("exceptions-update: an invalid status is rejected", async () => {
    const shp = await lensRun("logistics", "shipments-create", { params: { origin: "ORD", destination: "BOS", mode: "parcel", weightLbs: 2 } }, ctx);
    const exc = await lensRun("logistics", "exceptions-flag", { params: { shipmentId: shp.result.shipment.id } }, ctx);
    const bad = await lensRun("logistics", "exceptions-update", { params: { id: exc.result.exception.id, status: "nuked" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /invalid status/);
  });
});

describe("logistics — GPS tracking + risk + scorecard + geofence (wave 11 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("logistics-t11-gps"); });

  it("gps-track-init → gps-ping computes remaining distance + a forward ETA; gps-track-get reads it back", async () => {
    const init = await lensRun("logistics", "gps-track-init", {
      params: { shipmentId: "ship-gps-1", originLat: 0, originLng: 0, destLat: 0, destLng: 1 },
    }, ctx);
    assert.equal(init.result.track.status, "awaiting_first_ping");
    assert.ok(init.result.track.totalDistanceMi > 0);
    // First ping at origin (no speed) — no ETA yet.
    const p1 = await lensRun("logistics", "gps-ping", { params: { shipmentId: "ship-gps-1", lat: 0, lng: 0, at: "2026-06-07T00:00:00.000Z" } }, ctx);
    assert.equal(p1.result.etaMinutes, null);
    // Second ping has moved halfway over 1h → measured speed > 0 → ETA exists, remaining ~half.
    const p2 = await lensRun("logistics", "gps-ping", { params: { shipmentId: "ship-gps-1", lat: 0, lng: 0.5, at: "2026-06-07T01:00:00.000Z" } }, ctx);
    assert.ok(p2.result.measuredSpeedMph > 0);
    assert.ok(p2.result.etaMinutes > 0);
    assert.ok(p2.result.remainingMi < init.result.track.totalDistanceMi);
    assert.ok(p2.result.progressPct > 0 && p2.result.progressPct <= 100);
    const get = await lensRun("logistics", "gps-track-get", { params: { shipmentId: "ship-gps-1" } }, ctx);
    assert.equal(get.result.track.pings.length, 2);
  });

  it("gps-ping: pinging an uninitialised track is rejected", async () => {
    const bad = await lensRun("logistics", "gps-ping", { params: { shipmentId: "never-init", lat: 1, lng: 1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /track not found/);
  });

  it("delay-risk-score: an in-transit shipment with no GPS track scores 'no_gps' risk", async () => {
    const shp = await lensRun("logistics", "shipments-create", { params: { origin: "NYC", destination: "LA", mode: "ftl", weightLbs: 100 } }, ctx);
    const id = shp.result.shipment.id;
    await lensRun("logistics", "shipments-set-status", { params: { id, status: "in_transit" } }, ctx);
    const r = await lensRun("logistics", "delay-risk-score", { params: { shipmentId: id } }, ctx);
    assert.equal(r.result.shipmentId, id);
    assert.ok(r.result.riskScore >= 20); // no_gps factor adds 20
    assert.ok(r.result.factors.some((f) => f.factor === "no_gps"));
    assert.ok(["low", "medium", "high"].includes(r.result.riskTier));
  });

  it("tender-record + damage-report → carrier-scorecard grades the carrier", async () => {
    const car = await lensRun("logistics", "carriers-add", { params: { name: "Score Lines", code: "scl", modes: ["ftl"] } }, ctx);
    const carrierId = car.result.carrier.id;
    await lensRun("logistics", "tender-record", { params: { carrierId, outcome: "accepted" } }, ctx);
    await lensRun("logistics", "tender-record", { params: { carrierId, outcome: "rejected" } }, ctx);
    const r = await lensRun("logistics", "carrier-scorecard", { params: { carrierId } }, ctx);
    const card = r.result.scorecards.find((c) => c.carrierId === carrierId);
    assert.equal(card.tenderOffers, 2);
    assert.equal(card.tenderAcceptancePct, 50); // 1 of 2 accepted
    assert.ok(["A", "B", "C", "D", "F"].includes(card.letterGrade));
  });

  it("tender-record: invalid outcome is rejected", async () => {
    const car = await lensRun("logistics", "carriers-add", { params: { name: "T Co", code: "tco", modes: ["ftl"] } }, ctx);
    const bad = await lensRun("logistics", "tender-record", { params: { carrierId: car.result.carrier.id, outcome: "maybe" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /accepted.*rejected/);
  });

  it("geofence-create → geofence-evaluate emits arrived then departed milestones", async () => {
    await lensRun("logistics", "geofence-create", { params: { name: "DC Hub", lat: 0, lng: 0, radiusMi: 5, kind: "hub" } }, ctx);
    // Inside the fence → arrived.
    const e1 = await lensRun("logistics", "geofence-evaluate", { params: { shipmentId: "geo-ship-1", lat: 0, lng: 0, at: "2026-06-07T00:00:00.000Z" } }, ctx);
    assert.ok(e1.result.milestones.some((m) => m.kind === "arrived"));
    // Far outside → departed.
    const e2 = await lensRun("logistics", "geofence-evaluate", { params: { shipmentId: "geo-ship-1", lat: 0, lng: 5, at: "2026-06-07T02:00:00.000Z" } }, ctx);
    assert.ok(e2.result.milestones.some((m) => m.kind === "departed"));
    const list = await lensRun("logistics", "milestones-list", { params: { shipmentId: "geo-ship-1" } }, ctx);
    assert.ok(list.result.milestones.length >= 2);
  });

  it("geofence-evaluate: no geofences defined is rejected", async () => {
    const freshCtx = await depthCtx("logistics-t11-geo-empty");
    const bad = await lensRun("logistics", "geofence-evaluate", { params: { shipmentId: "x", lat: 1, lng: 1 } }, freshCtx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /no geofences defined/);
  });
});

describe("logistics — remaining CRUD/list/dashboard (wave 11 top-up B)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("logistics-t11-b"); });

  it("docks-create → docks-list reads it back; dock-appointments-cancel flips status", async () => {
    const dock = await lensRun("logistics", "docks-create", { params: { name: "Bay 3", facility: "DC-West", kind: "unloading", hoursStart: "07:00", hoursEnd: "19:00" } }, ctx);
    assert.equal(dock.result.dock.kind, "unloading");
    const dockId = dock.result.dock.id;
    const list = await lensRun("logistics", "docks-list", {}, ctx);
    assert.ok(list.result.docks.some((d) => d.id === dockId && d.facility === "DC-West"));

    const apt = await lensRun("logistics", "dock-appointments-book", { params: { dockId, date: "2026-08-01", startTime: "08:00", durationMin: 45 } }, ctx);
    assert.equal(apt.result.appointment.status, "scheduled");
    const cancel = await lensRun("logistics", "dock-appointments-cancel", { params: { id: apt.result.appointment.id } }, ctx);
    assert.equal(cancel.result.appointment.status, "cancelled");
    // After cancel, the same slot is bookable (no conflict against a cancelled appt).
    const rebook = await lensRun("logistics", "dock-appointments-book", { params: { dockId, date: "2026-08-01", startTime: "08:00", durationMin: 45 } }, ctx);
    assert.equal(rebook.result.appointment.status, "scheduled");
  });

  it("dock-appointments-cancel: a missing appointment id is rejected", async () => {
    const bad = await lensRun("logistics", "dock-appointments-cancel", { params: { id: "nope_apt" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /appointment not found/);
  });

  it("fleet-vehicles-delete removes the vehicle; a missing id is rejected", async () => {
    const veh = await lensRun("logistics", "fleet-vehicles-add", { params: { number: "T-DEL", kind: "trailer" } }, ctx);
    const id = veh.result.vehicle.id;
    const del = await lensRun("logistics", "fleet-vehicles-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("logistics", "fleet-vehicles-list", {}, ctx);
    assert.ok(!list.result.vehicles.some((v) => v.id === id));
    const bad = await lensRun("logistics", "fleet-vehicles-delete", { params: { id: "nope_veh" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /vehicle not found/);
  });

  it("shipment-events: set-status appends an event the stream returns (newest-first)", async () => {
    const shp = await lensRun("logistics", "shipments-create", { params: { origin: "MSP", destination: "ORD", mode: "ltl", weightLbs: 300 } }, ctx);
    const id = shp.result.shipment.id;
    await lensRun("logistics", "shipments-set-status", { params: { id, status: "picked_up", location: "MSP" } }, ctx);
    await lensRun("logistics", "shipments-set-status", { params: { id, status: "in_transit", location: "Madison WI" } }, ctx);
    const evs = await lensRun("logistics", "shipment-events", { params: { shipmentId: id } }, ctx);
    assert.equal(evs.result.events.length, 2);
    // Stream is reversed → newest first.
    assert.equal(evs.result.events[0].kind, "in_transit");
    assert.equal(evs.result.events[0].location, "Madison WI");
    assert.equal(evs.result.events[1].kind, "picked_up");
  });

  it("geofence-create → geofences-list → geofence-delete round-trips; missing id rejected", async () => {
    const gf = await lensRun("logistics", "geofence-create", { params: { name: "Yard Gate", lat: 10, lng: 10, radiusMi: 2, kind: "checkpoint" } }, ctx);
    const id = gf.result.geofence.id;
    assert.equal(gf.result.geofence.radiusMi, 2);
    const list = await lensRun("logistics", "geofences-list", {}, ctx);
    assert.ok(list.result.geofences.some((g) => g.id === id && g.name === "Yard Gate"));
    const del = await lensRun("logistics", "geofence-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, true);
    const after = await lensRun("logistics", "geofences-list", {}, ctx);
    assert.ok(!after.result.geofences.some((g) => g.id === id));
    const bad = await lensRun("logistics", "geofence-delete", { params: { id: "nope_geo" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /geofence not found/);
  });

  it("geofence-create: a non-positive radius is rejected", async () => {
    const bad = await lensRun("logistics", "geofence-create", { params: { name: "Z", lat: 1, lng: 1, radiusMi: 0 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /radiusMi must be > 0/);
  });

  it("damage-report attaches to a shipment and records severity + claim amount", async () => {
    const car = await lensRun("logistics", "carriers-add", { params: { name: "Dmg Lines", code: "dml", modes: ["ftl"] } }, ctx);
    const carrierId = car.result.carrier.id;
    const shp = await lensRun("logistics", "shipments-create", { params: { origin: "HOU", destination: "OKC", mode: "ftl", weightLbs: 5000, carrierId } }, ctx);
    const shipmentId = shp.result.shipment.id;
    const rep = await lensRun("logistics", "damage-report", { params: { shipmentId, severity: "severe", description: "crushed pallet", claimAmountUsd: 1250 } }, ctx);
    assert.equal(rep.result.report.shipmentId, shipmentId);
    assert.equal(rep.result.report.carrierId, carrierId);
    assert.equal(rep.result.report.severity, "severe");
    assert.equal(rep.result.report.claimAmountUsd, 1250);
  });

  it("damage-report: an unknown shipment is rejected", async () => {
    const bad = await lensRun("logistics", "damage-report", { params: { shipmentId: "nope_shp" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /shipment not found/);
  });

  it("dashboard-summary tallies shipments, carriers, vehicles, docks, loads exactly", async () => {
    // Isolated ctx so the counts below are exact (not polluted by other tests).
    const d = await depthCtx("logistics-t11-dash");
    await lensRun("logistics", "carriers-add", { params: { name: "Dash Co", code: "dsh", modes: ["parcel"] } }, d);
    const s1 = await lensRun("logistics", "shipments-create", { params: { origin: "A", destination: "B", mode: "parcel", weightLbs: 10 } }, d);
    const s2 = await lensRun("logistics", "shipments-create", { params: { origin: "C", destination: "D", mode: "ltl", weightLbs: 20 } }, d);
    await lensRun("logistics", "shipments-set-status", { params: { id: s1.result.shipment.id, status: "in_transit" } }, d);
    await lensRun("logistics", "shipments-set-status", { params: { id: s2.result.shipment.id, status: "exception" } }, d);
    await lensRun("logistics", "fleet-vehicles-add", { params: { number: "DV-1", kind: "van" } }, d);
    await lensRun("logistics", "docks-create", { params: { name: "DK-1", facility: "F1" } }, d);
    await lensRun("logistics", "loads-post", { params: { origin: "E", destination: "F", ratePerMile: 2.0 } }, d);

    const sum = await lensRun("logistics", "dashboard-summary", {}, d);
    assert.equal(sum.result.totalShipments, 2);
    assert.equal(sum.result.inTransit, 1);     // s1 in_transit
    assert.equal(sum.result.exceptions, 1);    // s2 exception
    assert.equal(sum.result.carrierCount, 1);
    assert.equal(sum.result.vehicles, 1);
    assert.equal(sum.result.dockCount, 1);
    assert.equal(sum.result.loadsAvailable, 1);
    assert.equal(sum.result.loadsBooked, 0);
    assert.equal(sum.result.onTimePct, 100); // no completed-with-ETA shipments → defaults 100
  });
});
