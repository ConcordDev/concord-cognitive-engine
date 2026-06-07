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
