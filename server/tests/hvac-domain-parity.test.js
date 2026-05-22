// Contract tests for server/domains/hvac.js — compute macros plus the
// ServiceTitan / Housecall Pro field-service management surface.
// Pattern mirrors tests/travel-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHVACActions from "../domains/hvac.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`hvac.${name}`);
  if (!fn) throw new Error(`hvac.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerHVACActions(register); });

beforeEach(() => {
  // fresh per-user state for each test
  globalThis._concordSTATE = {};
});

const ctx = { actor: { userId: "hvac_user_a" }, userId: "hvac_user_a" };

describe("hvac compute macros", () => {
  it("loadCalculation derives BTU + tonnage", () => {
    const r = call("loadCalculation", ctx, {}, { data: { squareFootage: 2000, climate: "hot" } });
    assert.equal(r.ok, true);
    assert.ok(r.result.requiredBTU > 0);
    assert.ok(r.result.tonnage > 0);
  });
  it("energyAudit grades cost per sqft", () => {
    const r = call("energyAudit", ctx, {}, { data: { monthlyBill: 300, squareFootage: 1500, systemAge: 12 } });
    assert.equal(r.ok, true);
    assert.ok(["A", "B", "C", "D"].includes(r.result.grade));
  });
  it("maintenanceSchedule returns tasks", () => {
    const r = call("maintenanceSchedule", ctx, {}, { data: { systemType: "central-ac" } });
    assert.equal(r.ok, true);
    assert.ok(r.result.tasks.length > 0);
  });
  it("zoneBalance flags deviation", () => {
    const r = call("zoneBalance", ctx, {}, { data: { zones: [{ name: "A", currentTemp: 70, targetTemp: 78 }] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.balanced, false);
  });
});

describe("hvac dispatch board", () => {
  it("adds + lists technicians", () => {
    const add = call("tech-add", ctx, { name: "Jordan", skills: ["heat-pump"] });
    assert.equal(add.ok, true);
    const list = call("tech-list", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
  });
  it("rejects technician with no name", () => {
    const r = call("tech-add", ctx, {});
    assert.equal(r.ok, false);
  });
  it("creates + assigns + statuses + deletes appointments", () => {
    const tech = call("tech-add", ctx, { name: "Sam" }).result.technician;
    const appt = call("appointment-create", ctx, { title: "AC repair", client: "Acme" }).result.appointment;
    assert.ok(appt.id);
    const assigned = call("appointment-assign", ctx, { id: appt.id, technicianId: tech.id });
    assert.equal(assigned.result.appointment.technicianId, tech.id);
    const st = call("appointment-status", ctx, { id: appt.id, status: "dispatched" });
    assert.equal(st.result.appointment.status, "dispatched");
    const del = call("appointment-delete", ctx, { id: appt.id });
    assert.equal(del.ok, true);
  });
  it("dispatch-board returns lanes + unassigned + stats", () => {
    call("tech-add", ctx, { name: "Lee" });
    call("appointment-create", ctx, { title: "Tune-up" });
    const r = call("dispatch-board", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.lanes.length, 1);
    assert.equal(r.result.stats.unassigned, 1);
  });
});

describe("hvac customer bookings", () => {
  it("creates booking with confirmation code", () => {
    const r = call("booking-request", ctx, { customer: "Pat", phone: "555-1234" });
    assert.equal(r.ok, true);
    assert.match(r.result.booking.confirmation, /^HVAC-/);
  });
  it("rejects booking with no contact", () => {
    const r = call("booking-request", ctx, { customer: "Pat" });
    assert.equal(r.ok, false);
  });
  it("confirm promotes booking to an appointment", () => {
    const b = call("booking-request", ctx, { customer: "Pat", phone: "555" }).result.booking;
    const c = call("booking-confirm", ctx, { id: b.id });
    assert.equal(c.ok, true);
    assert.ok(c.result.appointment.id);
    const list = call("booking-list", ctx, {});
    assert.equal(list.result.bookings[0].status, "confirmed");
  });
});

describe("hvac equipment / service history", () => {
  it("adds an asset and logs service", () => {
    const a = call("asset-add", ctx, { address: "1 Main St", brand: "Carrier", installYear: 2018 }).result.asset;
    assert.ok(a.id);
    const svc = call("asset-log-service", ctx, { assetId: a.id, serviceType: "tune-up", cost: 120 });
    assert.equal(svc.ok, true);
    const list = call("asset-list", ctx, {});
    assert.equal(list.result.assets[0].serviceCount, 1);
    assert.ok(list.result.assets[0].ageYears > 0);
  });
  it("rejects asset with no address", () => {
    assert.equal(call("asset-add", ctx, {}).ok, false);
  });
  it("deletes an asset", () => {
    const a = call("asset-add", ctx, { address: "2 Oak" }).result.asset;
    assert.equal(call("asset-delete", ctx, { id: a.id }).ok, true);
  });
});

describe("hvac estimate e-sign", () => {
  it("requests + captures a signature", () => {
    const req = call("estimate-request-signature", ctx, { estimateId: "EST-1", amount: 4200, client: "Ray" });
    assert.equal(req.ok, true);
    const sigId = req.result.signatureRequest.id;
    const signed = call("estimate-sign", ctx, { id: sigId, signedName: "Ray Smith" });
    assert.equal(signed.result.signatureRequest.status, "signed");
  });
  it("rejects signature request with no amount", () => {
    assert.equal(call("estimate-request-signature", ctx, { estimateId: "EST-2" }).ok, false);
  });
});

describe("hvac payments", () => {
  it("charges + lists + refunds a payment", () => {
    const pay = call("payment-charge", ctx, { invoiceId: "INV-1", amount: 500, method: "card" });
    assert.equal(pay.ok, true);
    assert.ok(pay.result.payment.processingFee > 0);
    const list = call("payment-list", ctx, {});
    assert.equal(list.result.summary.count, 1);
    const refund = call("payment-refund", ctx, { id: pay.result.payment.id });
    assert.equal(refund.result.payment.status, "refunded");
  });
  it("rejects non-positive payment amount", () => {
    assert.equal(call("payment-charge", ctx, { invoiceId: "INV-2", amount: 0 }).ok, false);
  });
});

describe("hvac maintenance agreements", () => {
  it("creates contract with scheduled visits + computes MRR", () => {
    const r = call("agreement-create", ctx, { client: "Dana", tier: "premium" });
    assert.equal(r.ok, true);
    assert.equal(r.result.agreement.visits.length, 4);
    const list = call("agreement-list", ctx, {});
    assert.ok(list.result.monthlyRecurringRevenue > 0);
  });
  it("completes a visit + cancels an agreement", () => {
    const a = call("agreement-create", ctx, { client: "Dana" }).result.agreement;
    const done = call("agreement-complete-visit", ctx, { id: a.id, seq: 1 });
    assert.equal(done.result.visit.status, "completed");
    const cancel = call("agreement-cancel", ctx, { id: a.id });
    assert.equal(cancel.result.agreement.status, "cancelled");
  });
});

describe("hvac technician mobile workflow", () => {
  it("starts a visit, checks items, adds parts, completes", () => {
    const appt = call("appointment-create", ctx, { title: "Field job", client: "Mo" }).result.appointment;
    const start = call("field-visit-start", ctx, { appointmentId: appt.id, technician: "Alex" });
    assert.equal(start.ok, true);
    const vId = start.result.visit.id;
    const upd = call("field-visit-update", ctx, { id: vId, checkIndex: 0, done: true, part: { name: "Capacitor", quantity: 2, unitPrice: 25 } });
    assert.equal(upd.result.visit.partsUsed.length, 1);
    const done = call("field-visit-complete", ctx, { id: vId });
    assert.equal(done.result.visit.status, "completed");
    assert.equal(done.result.partsTotal, 50);
    const list = call("field-visit-list", ctx, {});
    assert.equal(list.result.count, 1);
  });
  it("rejects field visit start for unknown appointment", () => {
    assert.equal(call("field-visit-start", ctx, { appointmentId: "nope" }).ok, false);
  });
});
