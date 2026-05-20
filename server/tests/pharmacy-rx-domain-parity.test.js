// Contract tests for the pharmacy GoodRx + MyTherapy 2026-parity macros
// (medications, schedules, adherence, refills, price comparison,
// coupons, measurements, journal). OpenFDA + compute macros are
// covered in pharmacy-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPharmacyActions from "../domains/pharmacy.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`pharmacy.${name}`);
  assert.ok(fn, `pharmacy.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPharmacyActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const today = () => new Date().toISOString().slice(0, 10);

function newMed(ctx = ctxA, over = {}) {
  return call("med-add", ctx, { name: "Lisinopril", strength: "10mg", quantity: 30, ...over }).result.medication;
}

describe("pharmacy.med-* CRUD", () => {
  it("add requires a name, scoped per user", () => {
    assert.equal(call("med-add", ctxA, {}).ok, false);
    newMed();
    assert.equal(call("med-list", ctxA, {}).result.count, 1);
    assert.equal(call("med-list", ctxB, {}).result.count, 0);
  });

  it("update, archive and detail work", () => {
    const med = newMed();
    assert.equal(call("med-update", ctxA, { id: med.id, quantity: 60 }).result.medication.quantity, 60);
    assert.equal(call("med-archive", ctxA, { id: med.id }).result.medication.archived, true);
    assert.equal(call("med-list", ctxA, {}).result.count, 0);
    assert.equal(call("med-list", ctxA, { includeArchived: true }).result.count, 1);
    assert.equal(call("med-detail", ctxA, { id: med.id }).ok, true);
  });

  it("cannot touch another user's medication", () => {
    const med = newMed(ctxA);
    assert.equal(call("med-update", ctxB, { id: med.id, quantity: 1 }).ok, false);
  });
});

describe("pharmacy.schedule + dose + adherence", () => {
  it("schedule rejects bad times, accepts HH:MM", () => {
    const med = newMed();
    assert.equal(call("schedule-set", ctxA, { medId: med.id, times: ["notatime"] }).ok, false);
    const r = call("schedule-set", ctxA, { medId: med.id, times: ["20:00", "08:00"] });
    assert.deepEqual(r.result.schedule.times, ["08:00", "20:00"]); // sorted
  });

  it("dose-log decrements quantity on 'taken'", () => {
    const med = newMed(ctxA, { quantity: 5 });
    call("schedule-set", ctxA, { medId: med.id, times: ["08:00"] });
    const d = call("dose-log", ctxA, { medId: med.id, status: "taken", scheduledTime: "08:00" });
    assert.equal(d.result.quantityRemaining, 4);
    call("dose-log", ctxA, { medId: med.id, status: "skipped", scheduledTime: "08:00" });
    assert.equal(call("med-detail", ctxA, { id: med.id }).result.medication.quantity, 4);
  });

  it("today-doses reflects taken vs pending", () => {
    const med = newMed();
    call("schedule-set", ctxA, { medId: med.id, times: ["08:00", "20:00"] });
    call("dose-log", ctxA, { medId: med.id, status: "taken", scheduledTime: "08:00" });
    const t = call("today-doses", ctxA, {});
    assert.equal(t.result.total, 2);
    assert.equal(t.result.taken, 1);
    assert.equal(t.result.pending, 1);
  });

  it("adherence-report computes a percentage", () => {
    const med = newMed();
    call("schedule-set", ctxA, { medId: med.id, times: ["08:00"] });
    call("dose-log", ctxA, { medId: med.id, status: "taken", scheduledTime: "08:00" });
    const r = call("adherence-report", ctxA, { days: 1 });
    assert.equal(r.result.perMed[0].scheduled, 1);
    assert.equal(r.result.perMed[0].taken, 1);
    assert.equal(r.result.overall, 100);
  });
});

describe("pharmacy.refill-*", () => {
  it("request, list, pick-up replenishes quantity and refills", () => {
    const med = newMed(ctxA, { quantity: 2, refillsRemaining: 3 });
    const rf = call("refill-request", ctxA, { medId: med.id, pharmacy: "CVS" }).result.refill;
    assert.equal(call("refill-list", ctxA, {}).result.count, 1);
    call("refill-update", ctxA, { id: rf.id, status: "picked_up", quantityAdded: 30 });
    const detail = call("med-detail", ctxA, { id: med.id }).result.medication;
    assert.equal(detail.quantity, 32);
    assert.equal(detail.refillsRemaining, 2);
  });

  it("refills-due flags low days-of-supply", () => {
    const med = newMed(ctxA, { quantity: 3 });
    call("schedule-set", ctxA, { medId: med.id, times: ["08:00"] }); // 1/day → 3 days supply
    const due = call("refills-due", ctxA, {});
    assert.equal(due.result.count, 1);
    assert.equal(due.result.due[0].daysOfSupply, 3);
  });
});

describe("pharmacy.price-compare (GoodRx shape)", () => {
  it("ranks recorded prices and computes savings", () => {
    call("price-record", ctxA, { drugName: "Atorvastatin", pharmacyName: "CVS", cashPrice: 45 });
    call("price-record", ctxA, { drugName: "Atorvastatin", pharmacyName: "Costco", cashPrice: 12 });
    call("price-record", ctxA, { drugName: "Atorvastatin", pharmacyName: "Walgreens", cashPrice: 38, couponPrice: 15 });
    const cmp = call("price-compare", ctxA, { drugName: "Atorvastatin" });
    assert.equal(cmp.result.quotes[0].effectivePrice, 12);
    assert.equal(cmp.result.quotes[0].isBest, true);
    assert.equal(cmp.result.lowest, 12);
    assert.equal(cmp.result.highest, 45);
    assert.equal(cmp.result.savings, 33);
  });

  it("rejects price with non-positive cash price", () => {
    assert.equal(call("price-record", ctxA, { drugName: "X", cashPrice: 0 }).ok, false);
  });
});

describe("pharmacy.measurement-history", () => {
  it("tracks a measurement series with trend", () => {
    call("measurement-log", ctxA, { kind: "weight", value: 80, date: "2026-05-01" });
    call("measurement-log", ctxA, { kind: "weight", value: 79, date: "2026-05-10" });
    const h = call("measurement-history", ctxA, { kind: "weight" });
    assert.equal(h.result.series.length, 2);
    assert.equal(h.result.trend, "down");
    assert.equal(h.result.latest.value, 79);
  });

  it("rejects an unknown measurement kind", () => {
    assert.equal(call("measurement-log", ctxA, { kind: "vibes", value: 5 }).ok, false);
  });
});

describe("pharmacy.coupon + journal", () => {
  it("coupons save and list", () => {
    call("coupon-save", ctxA, { drugName: "Metformin", pharmacyName: "Kroger", discountedPrice: 4, code: "RX10" });
    assert.equal(call("coupon-list", ctxA, {}).result.coupons.length, 1);
    assert.equal(call("coupon-save", ctxA, {}).ok, false);
  });

  it("journal entries record mood and symptoms", () => {
    call("journal-add", ctxA, { note: "Felt dizzy after morning dose", mood: "low", symptoms: ["dizziness"] });
    const list = call("journal-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.deepEqual(list.result.entries[0].symptoms, ["dizziness"]);
  });
});

describe("pharmacy.pharmacy-dashboard", () => {
  it("aggregates doses, adherence and refills", () => {
    const med = newMed(ctxA, { quantity: 3 });
    call("schedule-set", ctxA, { medId: med.id, times: ["08:00"] });
    call("dose-log", ctxA, { medId: med.id, status: "taken", scheduledTime: "08:00" });
    const d = call("pharmacy-dashboard", ctxA, {});
    assert.equal(d.result.medications, 1);
    assert.equal(d.result.todayDoses.taken, 1);
    assert.equal(d.result.refillsDue, 1);
  });
});
