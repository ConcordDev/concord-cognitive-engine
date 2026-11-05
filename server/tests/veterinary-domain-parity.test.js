// Contract tests for server/domains/veterinary.js — clinical calculators,
// the per-user practice-management substrate (patients / appointments /
// invoices / SOAP notes / prescriptions / lab results / inventory) and
// the owner portal aggregator. The openFDA feed integration is not
// exercised here (network-dependent).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerVeterinaryActions from "../domains/veterinary.js";
import { collectLensExport } from "../lib/lens-export.js";

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

  it("triageAssess names the limit beside the grade", () => {
    const r = call("triageAssess", ctxA, { data: { species: "dog", age: 4, symptoms: ["seizure"] } }, {});
    assert.equal(r.result.status, "ADVISORY");
    assert.equal(r.result.verdict, null);
    assert.equal(
      r.result.advisoryBasis,
      "Not a veterinary assessment and not a substitute for one. Call a veterinarian or an emergency clinic.",
    );
  });

  it("weightCheck reports overweight", () => {
    const r = call("weightCheck", ctxA, { data: { species: "cat", weight: 22 } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "overweight");
  });

  it("vaccineSchedule lists species vaccines", () => {
    const r = call("vaccineSchedule", ctxA, { data: { species: "dog", age: 2 } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "ADVISORY");
    assert.ok(r.result.vaccines.length >= 3);
    assert.equal(r.result.vaccines.some((v) => v.vaccine === "DHPP"), true);
  });

  it("vaccineSchedule and weightCheck read a patient chart, and stay generic without one", () => {
    const generic = call("vaccineSchedule", ctxA, { data: { species: "dog", age: 2 } }, {});
    assert.equal(generic.result.scope, "generic");
    assert.equal(generic.result.vaccines.find((v) => v.vaccine === "Rabies").due, "due-or-overdue");

    const pat = call("patient-add", ctxA, {}, { name: "Rex", species: "dog", ageYears: 4 }).result.patient;
    call("vaccine-record", ctxA, {}, { patientId: pat.id, vaccine: "Rabies", date: "2026-11-03", nextDue: "2027-11-03" });
    call("vaccine-record", ctxA, {}, { patientId: pat.id, vaccine: "DHPP", date: "2026-11-03" });
    const chart = call("vaccineSchedule", ctxA, { data: { patientId: pat.id, species: "cat", age: 1 } }, {});
    assert.equal(chart.result.scope, "patient");
    assert.equal(chart.result.species, "dog");
    assert.equal(chart.result.ageMonths, 48);
    const rabies = chart.result.vaccines.find((v) => v.vaccine === "Rabies");
    assert.equal(rabies.due, "recorded, due 2027-11-03");
    assert.equal(rabies.fromChart, true);
    const dhpp = chart.result.vaccines.find((v) => v.vaccine === "DHPP");
    assert.match(dhpp.due, /^recorded /);
    assert.equal(dhpp.due.includes("due-or-overdue"), false);
    const bordetella = chart.result.vaccines.find((v) => v.vaccine === "Bordetella");
    assert.equal(bordetella.due, "due-or-overdue");
    assert.equal(bordetella.fromChart, false);

    const typed = call("weightCheck", ctxA, { data: { species: "cat", weight: 22 } }, {});
    assert.equal(typed.result.scope, "generic");
    assert.equal(typed.result.weightSource, "typed");
    assert.equal(typed.result.status, "overweight");
    const heavy = call("patient-add", ctxA, {}, { name: "Otis", species: "cat", weightLbs: 22 }).result.patient;
    const fromChart = call("weightCheck", ctxA, { data: { patientId: heavy.id, species: "dog", weight: 10 } }, {});
    assert.equal(fromChart.result.scope, "patient");
    assert.equal(fromChart.result.weightSource, "record");
    assert.equal(fromChart.result.species, "cat");
    assert.equal(fromChart.result.currentWeight, 22);
    assert.equal(fromChart.result.status, "overweight");
    const missing = call("weightCheck", ctxA, { data: { patientId: pat.id } }, {});
    assert.equal(missing.result.status, "NOT_COMPUTED");
    assert.equal(missing.result.scope, "patient");
  });

  it("vaccineSchedule does not invent a dog, an age, or a dog table for another species", () => {
    const blank = call("vaccineSchedule", ctxA, { data: {} }, {});
    assert.equal(blank.ok, true);
    assert.equal(blank.result.status, "NOT_COMPUTED");
    assert.deepEqual(blank.result.missingInputs, ["species", "age"]);
    assert.equal(blank.result.vaccines, undefined);
    assert.notEqual(blank.result.species, "dog");

    const noAge = call("vaccineSchedule", ctxA, { data: { species: "cat" } }, {});
    assert.equal(noAge.result.status, "NOT_COMPUTED");
    assert.deepEqual(noAge.result.missingInputs, ["age"]);

    const bird = call("vaccineSchedule", ctxA, { data: { species: "bird", age: 2 } }, {});
    assert.equal(bird.result.status, "NOT_COMPUTED");
    assert.deepEqual(bird.result.missingInputs, ["species"]);
    assert.equal(bird.result.vaccines, undefined);

    const newborn = call("vaccineSchedule", ctxA, { data: { species: "dog", age: 0 } }, {});
    assert.equal(newborn.result.status, "ADVISORY");
    assert.equal(newborn.result.ageMonths, 0);
    assert.equal(newborn.result.overdueCount, 0);
    assert.equal(newborn.result.vaccines[0].due, "at 3 months");
  });

  it("triageAssess does not invent species or age", () => {
    const symptomsOnly = call("triageAssess", ctxA, { data: { symptoms: ["seizure"] } }, {});
    assert.equal(symptomsOnly.ok, true);
    assert.equal(symptomsOnly.result.status, "ADVISORY");
    assert.equal(symptomsOnly.result.triageLevel, "EMERGENCY");
    assert.equal(symptomsOnly.result.species, null);
    assert.equal(symptomsOnly.result.age, null);

    const named = call("triageAssess", ctxA, { data: { species: "Cat", age: 0, symptoms: ["vomiting"] } }, {});
    assert.equal(named.result.species, "cat");
    assert.equal(named.result.age, 0);
    assert.equal(named.result.triageLevel, "urgent");

    const blank = call("triageAssess", ctxA, { data: {} }, {});
    assert.equal(blank.result.species, null);
    assert.equal(blank.result.age, null);
    assert.notEqual(blank.result.species, "dog");
    assert.notEqual(blank.result.age, 3);
  });

  it("costEstimate totals procedures", () => {
    const r = call("costEstimate", ctxA, { data: { procedures: [{ type: "dental" }, { type: "xray" }] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalEstimate, 550);
    assert.equal(r.result.reason, null);
  });

  it("costEstimate does not invent an exam or a $100 unknown procedure", () => {
    const blank = call("costEstimate", ctxA, { data: { procedures: [{}] } }, {});
    assert.equal(blank.ok, true);
    assert.equal(blank.result.totalEstimate, null);
    assert.equal(blank.result.reason, "not_recorded");
    assert.equal(blank.result.procedures[0].procedure, null);
    assert.equal(blank.result.procedures[0].estimatedCost, null);
    assert.deepEqual(blank.result.unavailable, ["procedures[0]"]);

    const unknown = call("costEstimate", ctxA, { data: { procedures: [{ type: "acupuncture" }] } }, {});
    assert.equal(unknown.result.totalEstimate, null);
    assert.equal(unknown.result.procedures[0].estimatedCost, null);
    assert.notEqual(unknown.result.procedures[0].estimatedCost, 100);
    assert.deepEqual(unknown.result.unavailable, ["acupuncture"]);

    const quoted = call("costEstimate", ctxA, { data: { procedures: [{ type: "boarding", cost: 0 }, { name: "dental" }] } }, {});
    assert.equal(quoted.result.procedures[0].estimatedCost, 0);
    assert.equal(quoted.result.procedures[1].estimatedCost, 400);
    assert.equal(quoted.result.totalEstimate, 400);
  });
});

describe("veterinary — patient records substrate", () => {
  it("patient-add refuses a missing or unknown species and does not store a dog", () => {
    const missing = call("patient-add", ctxA, {}, { name: "Rex" });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "invalid_input");
    assert.equal(missing.field, "species");
    const unknown = call("patient-add", ctxA, {}, { name: "Rex", species: "iguana" });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.field, "species");
    assert.equal(call("patient-list", ctxA, {}, {}).result.count, 0);
    const titled = call("patient-add", ctxA, {}, { name: "Rex", species: "Dog" });
    assert.equal(titled.ok, true);
    assert.equal(titled.result.patient.species, "dog");
  });

  it("patient-add keeps a recorded age and weight and leaves a blank one unrecorded", () => {
    const rec = call("patient-add", ctxA, {}, { name: "Rex", species: "dog", ageYears: 4, weightLbs: 12 });
    assert.equal(rec.ok, true);
    assert.equal(rec.result.patient.ageYears, 4);
    assert.equal(rec.result.patient.weightLbs, 12);
    const listed = call("patient-list", ctxA, {}, {}).result.patients[0];
    assert.equal(listed.ageYears, 4);
    assert.equal(listed.weightLbs, 12);
    const blank = call("patient-add", ctxA, {}, { name: "Miso", species: "cat" });
    assert.equal(blank.result.patient.ageYears, null);
    assert.equal(blank.result.patient.weightLbs, null);
    const zero = call("patient-add", ctxA, {}, { name: "Zero", species: "dog", ageYears: 0, weightLbs: 0 });
    assert.equal(zero.result.patient.ageYears, 0);
    assert.equal(zero.result.patient.weightLbs, 0);
    const bad = call("patient-add", ctxA, {}, { name: "Bad", species: "dog", weightLbs: -3 });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "invalid_input");
    assert.equal(bad.field, "weightLbs");
    assert.equal(call("patient-list", ctxA, {}, {}).result.count, 3);
  });

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

  it("patient-update corrects the chart and leaves omitted fields stored", () => {
    const pat = call("patient-add", ctxA, {}, {
      name: "Rex", species: "dog", owner: "Jane", breed: "lab", ageYears: 4, weightLbs: 40,
    }).result.patient;
    const updated = call("patient-update", ctxA, {}, { id: pat.id, owner: "Joan", breed: "collie" });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.patient.owner, "Joan");
    assert.equal(updated.result.patient.breed, "collie");
    assert.equal(updated.result.patient.name, "Rex");
    assert.equal(updated.result.patient.species, "dog");
    assert.equal(updated.result.patient.ageYears, 4);
    assert.equal(updated.result.patient.weightLbs, 40);
    const zero = call("patient-update", ctxA, {}, { id: pat.id, ageYears: 0, weightLbs: 0 });
    assert.equal(zero.result.patient.ageYears, 0);
    assert.equal(zero.result.patient.weightLbs, 0);
    const bad = call("patient-update", ctxA, {}, { id: pat.id, species: "salt" });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "invalid_input");
    assert.equal(bad.field, "species");
    const still = call("patient-list", ctxA, {}, {}).result.patients[0];
    assert.equal(still.species, "dog");
    assert.equal(still.owner, "Joan");
    const other = call("patient-update", { actor: { userId: "vet_user_b" }, userId: "vet_user_b" }, {}, { id: pat.id, owner: "Thief" });
    assert.equal(other.ok, false);
    assert.equal(call("patient-list", ctxA, {}, {}).result.patients[0].owner, "Joan");
    assert.equal(call("patient-update", ctxA, {}, { id: pat.id, name: "   " }).ok, false);
    assert.equal(call("patient-list", ctxA, {}, {}).result.patients[0].name, "Rex");
  });

  it("visit-delete and vaccine-delete remove one sub-record and leave the patient", () => {
    const pat = call("patient-add", ctxA, {}, { name: "Bella", species: "cat" }).result.patient;
    const v1 = call("visit-log", ctxA, {}, { patientId: pat.id, kind: "dental", cost: 400 }).result.visit;
    const v2 = call("visit-log", ctxA, {}, { patientId: pat.id, kind: "checkup", cost: 50 }).result.visit;
    const vac = call("vaccine-record", ctxA, {}, { patientId: pat.id, vaccine: "Rabies", nextDue: "2027-01-01" }).result.record;
    assert.equal(call("visit-delete", ctxA, {}, { patientId: pat.id, id: v1.id }).ok, true);
    const listed = call("patient-list", ctxA, {}, {}).result.patients[0];
    assert.equal(listed.visits.length, 1);
    assert.equal(listed.visits[0].id, v2.id);
    assert.equal(listed.vaccinations.length, 1);
    assert.equal(call("vaccine-delete", ctxA, {}, { patientId: pat.id, id: vac.id }).ok, true);
    const after = call("patient-list", ctxA, {}, {}).result;
    assert.equal(after.count, 1);
    assert.equal(after.patients[0].vaccinations.length, 0);
    assert.equal(call("visit-delete", ctxA, {}, { patientId: pat.id, id: v1.id }).ok, false);
    assert.equal(call("visit-delete", { actor: { userId: "vet_user_b" } }, {}, { patientId: pat.id, id: v2.id }).ok, false);
    assert.equal(call("patient-list", ctxA, {}, {}).result.patients[0].visits.length, 1);
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
    assert.equal(rec.result.record.date, "");
    assert.equal(rec.result.record.nextDue, "2027-01-01");
  });

  it("vaccine-record derives the due date from the given date and the interval", () => {
    const pat = call("patient-add", ctxA, {}, { name: "Max", species: "dog" }).result.patient;
    const rec = call("vaccine-record", ctxA, {}, {
      patientId: pat.id, vaccine: "Rabies", date: "2026-11-03",
      intervalCount: 1, intervalUnit: "year", nextDue: "2026-11-03",
    });
    assert.equal(rec.ok, true);
    assert.equal(rec.result.record.date, "2026-11-03");
    assert.equal(rec.result.record.nextDue, "2027-11-03");
    assert.equal(rec.result.record.intervalCount, 1);
    assert.equal(rec.result.record.intervalUnit, "year");
    const reminders = call("vaccine-reminders", ctxA, {}, { horizonDays: 30 });
    assert.equal(reminders.result.overdueCount, 0);
    assert.equal(reminders.result.dueSoonCount, 0);
    const months = call("vaccine-record", ctxA, {}, {
      patientId: pat.id, vaccine: "Bordetella", date: "2026-11-01", intervalCount: 6, intervalUnit: "month",
    });
    assert.equal(months.result.record.nextDue, "2027-05-01");
    const givenOnly = call("vaccine-record", ctxA, {}, { patientId: pat.id, vaccine: "DHPP", date: "2026-11-03" });
    assert.equal(givenOnly.ok, true);
    assert.equal(givenOnly.result.record.nextDue, "");
    const missing = call("vaccine-record", ctxA, {}, {
      patientId: pat.id, vaccine: "Rabies", intervalCount: 1, intervalUnit: "year",
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "invalid_input");
    assert.equal(missing.field, "date");
    assert.equal(call("patient-list", ctxA, {}, {}).result.patients[0].vaccinations.length, 3);
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
    const pat = call("patient-add", ctxA, {}, { name: "Rex", species: "dog", owner: "Jane" }).result.patient;
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

  it("soap-delete removes one note and does not cross accounts", () => {
    const drop = call("soap-chart", ctxA, {}, { patientName: "Rex", subjective: "cough" }).result.note;
    const keep = call("soap-chart", ctxA, {}, { patientName: "Rex", subjective: "fine" }).result.note;
    assert.equal(call("soap-delete", ctxA, {}, { id: drop.id }).ok, true);
    const listed = call("soap-list", ctxA, {}, {});
    assert.equal(listed.result.count, 1);
    assert.equal(listed.result.notes[0].id, keep.id);
    assert.equal(call("soap-delete", ctxA, {}, { id: drop.id }).ok, false);
    assert.equal(call("soap-delete", { actor: { userId: "vet_user_b" } }, {}, { id: keep.id }).ok, false);
    assert.equal(call("soap-list", ctxA, {}, {}).result.count, 1);
  });
});

describe("veterinary — prescriptions & refills", () => {
  it("prescription-add / list / refill", () => {
    const pat = call("patient-add", ctxA, {}, { name: "Rex", species: "dog" }).result.patient;
    const namedOnly = call("prescription-add", ctxA, {}, { drug: "Amoxicillin", patientName: "Rex" });
    assert.equal(namedOnly.ok, false);
    assert.equal(namedOnly.error, "invalid_input");
    assert.equal(namedOnly.field, "patientId");
    assert.equal(call("prescription-list", ctxA, {}, {}).result.count, 0);
    const other = call("prescription-add", { actor: { userId: "vet_user_b" }, userId: "vet_user_b" }, {}, { drug: "Amoxicillin", patientId: pat.id });
    assert.equal(other.ok, false);
    assert.equal(other.error, "patient not found");
    const rx = call("prescription-add", ctxA, {}, {
      drug: "Amoxicillin", patientId: pat.id, patientName: "Not Rex", dosage: "250mg", refills: 2,
    });
    assert.equal(rx.ok, true);
    assert.equal(rx.result.prescription.patientId, pat.id);
    assert.equal(rx.result.prescription.patientName, "Rex");
    assert.equal(rx.result.prescription.refillsRemaining, 2);
    const r1 = call("prescription-refill", ctxA, {}, { id: rx.result.prescription.id });
    assert.equal(r1.result.prescription.refillsRemaining, 1);
    call("prescription-refill", ctxA, {}, { id: rx.result.prescription.id });
    const exhausted = call("prescription-refill", ctxA, {}, { id: rx.result.prescription.id });
    assert.equal(exhausted.ok, false);
    const l = call("prescription-list", ctxA, {}, { patientId: pat.id });
    assert.equal(l.ok, true);
    assert.equal(l.result.count, 1);
    assert.equal(l.result.prescriptions[0].drug, "Amoxicillin");
  });
});

describe("veterinary — owner portal", () => {
  it("aggregates pets, appointments, invoices, prescriptions", () => {
    const pat = call("patient-add", ctxA, {}, { name: "Rex", species: "dog", owner: "Jane Doe" }).result.patient;
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

describe("veterinary — chart export", () => {
  it("includes the caller's patient and visit, and not another account's chart", async () => {
    const pat = call("patient-add", ctxA, {}, { name: "Rex", species: "dog" }).result.patient;
    call("visit-log", ctxA, {}, { patientId: pat.id, kind: "checkup", cost: 55 });
    call("patient-add", { actor: { userId: "vet_user_b" }, userId: "vet_user_b" }, {}, { name: "Other", species: "cat" });
    call("lab-attach", ctxA, {}, { patientName: "Rex", patientId: pat.id, kind: "bloodwork" });
    const runMacro = async () => ({ ok: true, artifacts: [] });
    const out = await collectLensExport({ runMacro, domain: "veterinary", ctx: ctxA });
    assert.equal(out.ok, true);
    assert.equal(out.stateBacked, true);
    const rex = out.artifacts.find((a) => a.type === "patient" && a.title === "Rex");
    assert.ok(rex);
    assert.equal(rex.data.visits.length, 1);
    assert.equal(rex.data.visits[0].kind, "checkup");
    assert.equal(out.artifacts.some((a) => a.title === "Other"), false);
    const lab = out.artifacts.find((a) => a.type === "lab" && a.title === "Rex");
    assert.ok(lab);
    assert.equal(lab.data.kind, "bloodwork");
    const other = await collectLensExport({
      runMacro,
      domain: "veterinary",
      ctx: { actor: { userId: "vet_user_b" }, userId: "vet_user_b" },
    });
    assert.equal(other.artifacts.some((a) => a.title === "Rex"), false);
    assert.equal(other.artifacts.some((a) => a.title === "Other"), true);
    assert.equal(other.artifacts.some((a) => a.type === "lab"), false);
    const empty = await collectLensExport({
      runMacro,
      domain: "veterinary",
      ctx: { actor: { userId: "vet_user_c" }, userId: "vet_user_c" },
    });
    assert.equal(empty.ok, true);
    assert.equal(empty.stateBacked, true);
    assert.equal(empty.artifacts.length, 0);
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
