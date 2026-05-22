// Contract tests for server/domains/veterinary.js — clinical calculators,
// the per-user practice-management substrate (patients / appointments /
// invoices / SOAP notes / prescriptions / lab results / inventory) and
// the owner portal aggregator. The openFDA feed integration is not
// exercised here (network-dependent).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerVeterinaryActions from "../domains/veterinary.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`veterinary.${name}`);
  if (!fn) throw new Error(`veterinary.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerVeterinaryActions(register); });

beforeEach(() => {
  // fresh per-user STATE for each test
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "vet_user_a" }, userId: "vet_user_a" };

describe("veterinary — clinical calculators", () => {
  it("triageAssess flags emergency symptoms", () => {
    const r = call("triageAssess", ctxA, { data: { species: "dog", age: 4, symptoms: ["seizure"] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.triageLevel, "EMERGENCY");
    assert.ok(r.result.firstAid.length > 0);
  });

  it("weightCheck reports overweight", () => {
    const r = call("weightCheck", ctxA, { data: { species: "cat", weight: 22 } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "overweight");
  });

  it("vaccineSchedule lists species vaccines", () => {
    const r = call("vaccineSchedule", ctxA, { data: { species: "dog", age: 2 } }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.vaccines.length >= 3);
  });

  it("costEstimate totals procedures", () => {
    const r = call("costEstimate", ctxA, { data: { procedures: [{ type: "dental" }, { type: "xray" }] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalEstimate, 550);
  });
});

describe("veterinary — patient records substrate", () => {
  it("patient-add / patient-list / patient-delete round-trip", () => {
    const add = call("patient-add", ctxA, {}, { name: "Rex", species: "dog", owner: "Jane Doe" });
    assert.equal(add.ok, true);
    assert.equal(add.result.patient.name, "Rex");
    const list = call("patient-list", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    const del = call("patient-delete", ctxA, {}, { id: add.result.patient.id });
    assert.equal(del.ok, true);
    assert.equal(call("patient-list", ctxA, {}, {}).result.count, 0);
  });

  it("visit-log appends to a patient", () => {
    const pat = call("patient-add", ctxA, {}, { name: "Bella", species: "cat" }).result.patient;
    const visit = call("visit-log", ctxA, {}, { patientId: pat.id, kind: "dental", cost: 400 });
    assert.equal(visit.ok, true);
    assert.equal(visit.result.visit.kind, "dental");
  });

  it("vaccine-record appends to a patient", () => {
    const pat = call("patient-add", ctxA, {}, { name: "Max", species: "dog" }).result.patient;
    const rec = call("vaccine-record", ctxA, {}, { patientId: pat.id, vaccine: "Rabies", nextDue: "2027-01-01" });
    assert.equal(rec.ok, true);
    assert.equal(rec.result.record.vaccine, "Rabies");
  });

  it("vet-dashboard aggregates revenue and species", () => {
    const pat = call("patient-add", ctxA, {}, { name: "Coco", species: "bird" }).result.patient;
    call("visit-log", ctxA, {}, { patientId: pat.id, cost: 120 });
    const d = call("vet-dashboard", ctxA, {}, {});
    assert.equal(d.ok, true);
    assert.equal(d.result.patients, 1);
    assert.equal(d.result.revenue, 120);
    assert.equal(d.result.bySpecies.bird, 1);
  });
});

describe("veterinary — appointment scheduling", () => {
  it("appointment-book / list / status / cancel", () => {
    const b = call("appointment-book", ctxA, {}, { patientName: "Rex", date: "2026-06-01", type: "wellness" });
    assert.equal(b.ok, true);
    const l = call("appointment-list", ctxA, {}, { date: "2026-06-01" });
    assert.equal(l.ok, true);
    assert.equal(l.result.count, 1);
    const st = call("appointment-status", ctxA, {}, { id: b.result.appointment.id, status: "no_show" });
    assert.equal(st.ok, true);
    assert.equal(call("appointment-list", ctxA, {}, {}).result.noShows, 1);
    const c = call("appointment-cancel", ctxA, {}, { id: b.result.appointment.id });
    assert.equal(c.ok, true);
  });

  it("appointment-book rejects missing fields", () => {
    assert.equal(call("appointment-book", ctxA, {}, {}).ok, false);
    assert.equal(call("appointment-book", ctxA, {}, { patientName: "X" }).ok, false);
  });
});

describe("veterinary — invoicing & payment", () => {
  it("invoice-create computes totals with tax", () => {
    const r = call("invoice-create", ctxA, {}, {
      patientName: "Rex",
      lineItems: [{ description: "Exam", qty: 1, unitPrice: 55 }, { description: "Vax", qty: 2, unitPrice: 25 }],
      taxRate: 0.1,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.invoice.subtotal, 105);
    assert.equal(r.result.invoice.total, 115.5);
    assert.equal(r.result.invoice.status, "unpaid");
  });

  it("invoice-pay reduces balance and flips status", () => {
    const inv = call("invoice-create", ctxA, {}, {
      patientName: "Bella", lineItems: [{ description: "Surgery", qty: 1, unitPrice: 100 }],
    }).result.invoice;
    const partial = call("invoice-pay", ctxA, {}, { id: inv.id, amount: 40, method: "card" });
    assert.equal(partial.result.invoice.status, "partial");
    const full = call("invoice-pay", ctxA, {}, { id: inv.id, amount: 60 });
    assert.equal(full.result.invoice.status, "paid");
    assert.equal(full.result.invoice.balanceDue, 0);
  });

  it("invoice-list totals outstanding and collected", () => {
    call("invoice-create", ctxA, {}, { patientName: "P1", lineItems: [{ description: "x", qty: 1, unitPrice: 200 }] });
    const l = call("invoice-list", ctxA, {}, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.outstanding, 200);
  });
});

describe("veterinary — vaccine reminders", () => {
  it("classifies overdue vs due-soon", () => {
    const pat = call("patient-add", ctxA, {}, { name: "Rex", owner: "Jane" }).result.patient;
    const past = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    call("vaccine-record", ctxA, {}, { patientId: pat.id, vaccine: "Rabies", nextDue: past });
    call("vaccine-record", ctxA, {}, { patientId: pat.id, vaccine: "DHPP", nextDue: soon });
    const r = call("vaccine-reminders", ctxA, {}, { horizonDays: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.overdueCount, 1);
    assert.equal(r.result.dueSoonCount, 1);
  });
});

describe("veterinary — SOAP charting", () => {
  it("soap-chart / soap-list round-trip", () => {
    const c = call("soap-chart", ctxA, {}, {
      patientName: "Rex", patientId: "pat_1",
      subjective: "lethargic", objective: "temp 39.5", assessment: "infection", plan: "antibiotics",
    });
    assert.equal(c.ok, true);
    const l = call("soap-list", ctxA, {}, { patientId: "pat_1" });
    assert.equal(l.ok, true);
    assert.equal(l.result.count, 1);
    assert.equal(l.result.notes[0].assessment, "infection");
  });
});

describe("veterinary — prescriptions & refills", () => {
  it("prescription-add / list / refill", () => {
    const rx = call("prescription-add", ctxA, {}, {
      drug: "Amoxicillin", patientName: "Rex", dosage: "250mg", refills: 2,
    });
    assert.equal(rx.ok, true);
    assert.equal(rx.result.prescription.refillsRemaining, 2);
    const r1 = call("prescription-refill", ctxA, {}, { id: rx.result.prescription.id });
    assert.equal(r1.result.prescription.refillsRemaining, 1);
    call("prescription-refill", ctxA, {}, { id: rx.result.prescription.id });
    const exhausted = call("prescription-refill", ctxA, {}, { id: rx.result.prescription.id });
    assert.equal(exhausted.ok, false);
    const l = call("prescription-list", ctxA, {}, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.count, 1);
  });
});

describe("veterinary — owner portal", () => {
  it("aggregates pets, appointments, invoices, prescriptions", () => {
    const pat = call("patient-add", ctxA, {}, { name: "Rex", owner: "Jane Doe" }).result.patient;
    call("appointment-book", ctxA, {}, { patientName: "Rex", patientId: pat.id, owner: "Jane Doe", date: "2026-07-01" });
    call("invoice-create", ctxA, {}, { patientName: "Rex", patientId: pat.id, owner: "Jane Doe", lineItems: [{ description: "Exam", qty: 1, unitPrice: 80 }] });
    call("prescription-add", ctxA, {}, { drug: "Carprofen", patientId: pat.id });
    const r = call("owner-portal", ctxA, {}, { owner: "Jane Doe" });
    assert.equal(r.ok, true);
    assert.equal(r.result.petCount, 1);
    assert.equal(r.result.appointments.length, 1);
    assert.equal(r.result.invoices.length, 1);
    assert.equal(r.result.prescriptions.length, 1);
    assert.equal(r.result.balanceDue, 80);
  });

  it("rejects missing owner", () => {
    assert.equal(call("owner-portal", ctxA, {}, {}).ok, false);
  });
});

describe("veterinary — lab/imaging results", () => {
  it("lab-attach / list / delete", () => {
    const a = call("lab-attach", ctxA, {}, {
      patientName: "Rex", patientId: "pat_1", kind: "bloodwork", flag: "abnormal",
    });
    assert.equal(a.ok, true);
    const l = call("lab-list", ctxA, {}, { patientId: "pat_1" });
    assert.equal(l.ok, true);
    assert.equal(l.result.count, 1);
    assert.equal(l.result.abnormal, 1);
    const d = call("lab-delete", ctxA, {}, { id: a.result.labResult.id });
    assert.equal(d.ok, true);
    assert.equal(call("lab-list", ctxA, {}, {}).result.count, 0);
  });
});

describe("veterinary — inventory management", () => {
  it("inventory-add / list / adjust / delete", () => {
    const a = call("inventory-add", ctxA, {}, {
      name: "Rabies vaccine", category: "vaccine", quantity: 3, reorderLevel: 5, unitCost: 12,
    });
    assert.equal(a.ok, true);
    const l = call("inventory-list", ctxA, {}, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.lowStock, 1);
    assert.equal(l.result.totalValue, 36);
    const adj = call("inventory-adjust", ctxA, {}, { id: a.result.item.id, delta: 10 });
    assert.equal(adj.result.item.quantity, 13);
    const d = call("inventory-delete", ctxA, {}, { id: a.result.item.id });
    assert.equal(d.ok, true);
    assert.equal(call("inventory-list", ctxA, {}, {}).result.count, 0);
  });

  it("inventory-add rejects missing name", () => {
    assert.equal(call("inventory-add", ctxA, {}, {}).ok, false);
  });
});
