// FIX-automotive-001 — Garage summary stays stale after vehicle delete;
// possible orphaned records.
//
// Diagnosis pinned by this suite:
//  1. `vehicles-delete` cascade-removed only the six primary buckets
//     (fuel/service/schedule/expenses/trips/documents). The parity-backlog
//     buckets keyed by the same vehicleId — obd readings, attachments,
//     appointments, renewals — survived, so `renewals-upcoming` kept
//     surfacing a deleted vehicle's renewals (orphans).
//  2. The dashboard summary itself is computed live from the same state
//     maps, so once the cascade is complete a fresh summary read is exact.
//
// Hermetic harness mirroring automotive-lens-macros.test.js: handlers are
// invoked as handler(ctx, virtualArtifact, input) with
// virtualArtifact.data === input, against a fresh _concordSTATE per test.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAutomotiveActions from "../domains/automotive.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "automotive", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`automotive.${name} not registered`);
  const virtualArtifact = { id: null, domain: "automotive", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerAutomotiveActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

function isoDay(offsetDays) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function seedVehicleWithEverything(ctx) {
  const v = call("vehicles-create", ctx, { name: "QA car", make: "Test", model: "One", year: 2022, odometer: 1000 });
  assert.equal(v.ok, true, JSON.stringify(v));
  const id = v.result.vehicle.id;
  const must = (name, input) => {
    const r = call(name, ctx, input);
    assert.equal(r.ok, true, `${name}: ${JSON.stringify(r)}`);
    return r;
  };
  must("fuel-log", { vehicleId: id, volume: 10, totalCost: 30, odometer: 1000 });
  must("service-log", { vehicleId: id, serviceType: "Oil change", cost: 50, odometer: 1000 });
  must("expenses-log", { vehicleId: id, category: "repair", amount: 197, note: "ticket repro spend" });
  must("trips-log", { vehicleId: id, distance: 42, purpose: "personal", from: "A", to: "B" });
  must("documents-create", { vehicleId: id, kind: "insurance", title: "Policy" });
  must("schedule-create", { vehicleId: id, serviceType: "Oil change", intervalMiles: 5000 });
  must("obd-import", { vehicleId: id, readings: [{ metric: "rpm", value: 900 }] });
  must("attachments-add", { vehicleId: id, url: "https://example.com/p.jpg", kind: "receipt" });
  must("appointments-create", { vehicleId: id, date: isoDay(7), serviceType: "Inspection" });
  must("renewals-create", { vehicleId: id, kind: "insurance", title: "Policy renewal", renewalDate: isoDay(10) });
  return id;
}

describe("FIX-automotive-001 — vehicle delete leaves no orphans and an exact summary", () => {
  it("summary is exact before the delete (fuel/service mirror into spend)", () => {
    seedVehicleWithEverything(ctxA);
    const s = call("automotive-dashboard-summary", ctxA, {});
    assert.equal(s.ok, true);
    assert.equal(s.result.vehicleCount, 1);
    assert.equal(s.result.fuelEntryCount, 1);
    assert.equal(s.result.serviceEntryCount, 1);
    // 30 fuel mirror + 50 service mirror + 197 direct expense, all today.
    assert.equal(s.result.spend12moUsd, 277);
    assert.equal(s.result.scheduleCount, 1);
    const up = call("renewals-upcoming", ctxA, { withinDays: 60 });
    assert.equal(up.result.count, 1);
  });

  it("after the delete, every vehicle-keyed bucket is empty and the summary reads zero", () => {
    const id = seedVehicleWithEverything(ctxA);
    const del = call("vehicles-delete", ctxA, { id });
    assert.equal(del.ok, true, JSON.stringify(del));

    assert.equal(call("vehicles-list", ctxA, {}).result.vehicles.length, 0);
    const s = call("automotive-dashboard-summary", ctxA, {});
    assert.equal(s.result.vehicleCount, 0);
    assert.equal(s.result.fuelEntryCount, 0);
    assert.equal(s.result.serviceEntryCount, 0);
    assert.equal(s.result.spend12moUsd, 0);
    assert.equal(s.result.scheduleCount, 0);

    assert.equal(call("fuel-list", ctxA, { vehicleId: id }).result.fuel.length, 0);
    assert.equal(call("service-list", ctxA, { vehicleId: id }).result.service.length, 0);
    assert.equal(call("expenses-list", ctxA, { vehicleId: id }).result.expenses.length, 0);
    assert.equal(call("trips-list", ctxA, { vehicleId: id }).result.trips.length, 0);
    assert.equal(call("documents-list", ctxA, { vehicleId: id }).result.documents.length, 0);
    // The parity buckets the old cascade missed:
    assert.equal(call("obd-list", ctxA, { vehicleId: id }).result.count, 0);
    assert.equal(call("attachments-list", ctxA, { vehicleId: id }).result.attachments.length, 0);
    assert.equal(call("appointments-list", ctxA, { vehicleId: id }).result.appointments.length, 0);
    assert.equal(call("renewals-list", ctxA, { vehicleId: id }).result.renewals.length, 0);
    assert.equal(call("renewals-upcoming", ctxA, { withinDays: 60 }).result.count, 0);
  });

  it("deleting one vehicle leaves the user's other vehicle and other users untouched", () => {
    const id1 = seedVehicleWithEverything(ctxA);
    const v2 = call("vehicles-create", ctxA, { name: "Keeper", make: "Test", model: "Two", year: 2023, odometer: 500 });
    const id2 = v2.result.vehicle.id;
    call("fuel-log", ctxA, { vehicleId: id2, volume: 5, totalCost: 15, odometer: 500 });
    seedVehicleWithEverything(ctxB);

    assert.equal(call("vehicles-delete", ctxA, { id: id1 }).ok, true);

    const sA = call("automotive-dashboard-summary", ctxA, {});
    assert.equal(sA.result.vehicleCount, 1);
    assert.equal(sA.result.fuelEntryCount, 1);
    assert.equal(call("vehicles-list", ctxA, {}).result.vehicles[0].id, id2);

    const sB = call("automotive-dashboard-summary", ctxB, {});
    assert.equal(sB.result.vehicleCount, 1);
    assert.equal(sB.result.spend12moUsd, 277);
    assert.equal(call("renewals-upcoming", ctxB, { withinDays: 60 }).result.count, 1);
  });

  it("deleting an unknown vehicle still refuses", () => {
    const r = call("vehicles-delete", ctxA, { id: "veh_nope" });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /vehicle not found/);
  });
});
