import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAutomotive from "../domains/automotive.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function call(name, params) {
  return actions.get(`automotive.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAutomotive(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("automotive child records can be edited", () => {
  it("updates a fill-up, a service, an expense, a trip, and a document owned by the caller", () => {
    const vehicle = call("vehicles-create", { name: "Wagon", odometer: 1000 });
    const id = vehicle.result.vehicle.id;
    const fuel = call("fuel-log", { vehicleId: id, volume: 10, totalCost: 40, odometer: 1100 });
    assert.equal(fuel.ok, true);
    const fuelEdit = call("fuel-update", { id: fuel.result.entry.id, volume: 12, totalCost: 48 });
    assert.equal(fuelEdit.ok, true);
    assert.equal(fuelEdit.result.entry.volume, 12);
    assert.match(call("fuel-update", { id: fuel.result.entry.id, volume: -1 }).message, /Volume/);

    const service = call("service-log", { vehicleId: id, serviceType: "Oil", cost: 30, odometer: 1200 });
    const serviceEdit = call("service-update", { id: service.result.entry.id, serviceType: "Oil and filter", cost: 45 });
    assert.equal(serviceEdit.result.entry.serviceType, "Oil and filter");

    const expense = call("expenses-log", { vehicleId: id, amount: 15, category: "fuel", note: "toll" });
    const expenseEdit = call("expenses-update", { id: expense.result.entry?.id || expense.result.expense?.id, amount: 18, note: "bridge" });
    assert.equal(expenseEdit.ok, true);

    const trip = call("trips-log", { vehicleId: id, distance: 12, from: "Home", to: "Shop" });
    const tripEdit = call("trips-update", { id: trip.result.trip.id, distance: 14, to: "Yard" });
    assert.equal(tripEdit.result.trip.distance, 14);
    assert.equal(tripEdit.result.trip.to, "Yard");

    const doc = call("documents-create", { vehicleId: id, kind: "registration", title: "Reg", expiryDate: "2027-01-01" });
    const docId = doc.result.document?.id || doc.result.doc?.id;
    const docEdit = call("documents-update", { id: docId, title: "Registration 2027" });
    assert.equal(docEdit.ok, true);
    assert.equal(docEdit.result.document.title, "Registration 2027");
  });

  it("lists saved VIN reports for the caller, empty until a decode is stored", () => {
    const listed = call("vin-report-list", {});
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.result.reports, []);
  });
});
