// Contract tests for the pets-care 2026-parity macros (health records +
// Rover-shape caregiver booking). Pre-existing breed/compute macros are
// covered in pets-breed-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPetsActions from "../domains/pets.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`pets.${name}`);
  assert.ok(fn, `pets.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPetsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const today = () => new Date().toISOString().slice(0, 10);
const dayOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function newPet(ctx = ctxA, over = {}) {
  return call("pet-add", ctx, { name: "Rex", species: "dog", birthdate: "2022-01-01", ...over }).result.pet;
}

describe("pets.pet-* CRUD", () => {
  it("add requires a name, scoped per user", () => {
    assert.equal(call("pet-add", ctxA, { species: "cat" }).ok, false);
    newPet();
    assert.equal(call("pet-list", ctxA, {}).result.count, 1);
    assert.equal(call("pet-list", ctxB, {}).result.count, 0);
  });

  it("detail computes age; update + delete work", () => {
    const pet = newPet();
    const d = call("pet-detail", ctxA, { id: pet.id });
    assert.equal(d.ok, true);
    assert.ok(d.result.pet.age.years >= 3);
    assert.equal(call("pet-update", ctxA, { id: pet.id, weightKg: 28 }).result.pet.weightKg, 28);
    assert.equal(call("pet-delete", ctxA, { id: pet.id }).ok, true);
    assert.equal(call("pet-detail", ctxA, { id: pet.id }).ok, false);
  });

  it("cannot touch another user's pet", () => {
    const pet = newPet(ctxA);
    assert.equal(call("pet-update", ctxB, { id: pet.id, weightKg: 5 }).ok, false);
  });
});

describe("pets.vaccine-*", () => {
  it("records vaccines and flags overdue / due-soon", () => {
    const pet = newPet();
    call("vaccine-record", ctxA, { petId: pet.id, name: "Rabies", date: dayOffset(-400), nextDueDate: dayOffset(-5) });
    call("vaccine-record", ctxA, { petId: pet.id, name: "DHPP", date: today(), nextDueDate: dayOffset(10) });
    const list = call("vaccine-list", ctxA, { petId: pet.id });
    assert.equal(list.result.overdue, 1);
    assert.equal(list.result.dueSoon, 1);
  });

  it("rejects vaccine on a missing pet", () => {
    assert.equal(call("vaccine-record", ctxA, { petId: "nope", name: "Rabies" }).ok, false);
  });
});

describe("pets.medication + vet-visit", () => {
  it("medication add / stop / list", () => {
    const pet = newPet();
    const med = call("medication-add", ctxA, { petId: pet.id, name: "Apoquel", dosage: "16mg" }).result.medication;
    assert.equal(call("medication-list", ctxA, { petId: pet.id }).result.active, 1);
    call("medication-delete", ctxA, { petId: pet.id, id: med.id, stop: true });
    assert.equal(call("medication-list", ctxA, { petId: pet.id }).result.active, 0);
  });

  it("vet visit with a cost mirrors into expenses", () => {
    const pet = newPet();
    call("vet-visit-log", ctxA, { petId: pet.id, reason: "Annual checkup", cost: 120 });
    assert.equal(call("vet-visit-list", ctxA, { petId: pet.id }).result.totalCost, 120);
    assert.equal(call("expense-summary", ctxA, { petId: pet.id }).result.byCategory.vet, 120);
  });
});

describe("pets.weight-history", () => {
  it("tracks trend across entries", () => {
    const pet = newPet();
    call("weight-log", ctxA, { petId: pet.id, weightKg: 25, date: dayOffset(-20) });
    call("weight-log", ctxA, { petId: pet.id, weightKg: 27, date: dayOffset(-10) });
    call("weight-log", ctxA, { petId: pet.id, weightKg: 28, date: today() });
    const h = call("weight-history", ctxA, { petId: pet.id });
    assert.equal(h.result.trend, "gaining");
    assert.equal(h.result.changeKg, 3);
    assert.equal(h.result.latest, 28);
  });

  it("rejects non-positive weight", () => {
    const pet = newPet();
    assert.equal(call("weight-log", ctxA, { petId: pet.id, weightKg: 0 }).ok, false);
  });
});

describe("pets.activity + symptom log", () => {
  it("logs care activities and filters by kind", () => {
    const pet = newPet();
    call("activity-log", ctxA, { petId: pet.id, kind: "walk", durationMin: 30 });
    call("activity-log", ctxA, { petId: pet.id, kind: "feeding" });
    assert.equal(call("activity-history", ctxA, { petId: pet.id }).result.count, 2);
    assert.equal(call("activity-history", ctxA, { petId: pet.id, kind: "walk" }).result.count, 1);
    assert.equal(call("activity-log", ctxA, { petId: pet.id, kind: "teleport" }).ok, false);
  });

  it("symptom severity counts", () => {
    const pet = newPet();
    call("symptom-log", ctxA, { petId: pet.id, symptom: "Limping", severity: "severe" });
    call("symptom-log", ctxA, { petId: pet.id, symptom: "Sneezing", severity: "mild" });
    assert.equal(call("symptom-list", ctxA, { petId: pet.id }).result.severeCount, 1);
  });
});

describe("pets.reminder-*", () => {
  it("lists across pets with overdue flags; complete + delete", () => {
    const pet = newPet();
    const r1 = call("reminder-create", ctxA, { petId: pet.id, title: "Flea treatment", dueDate: dayOffset(-2) }).result.reminder;
    call("reminder-create", ctxA, { petId: pet.id, title: "Grooming", dueDate: dayOffset(20) });
    const list = call("reminder-list", ctxA, {});
    assert.equal(list.result.reminders.length, 2);
    assert.equal(list.result.overdue, 1);
    assert.equal(call("reminder-complete", ctxA, { petId: pet.id, id: r1.id }).result.reminder.done, true);
    assert.equal(call("reminder-delete", ctxA, { petId: pet.id, id: r1.id }).ok, true);
  });
});

describe("pets.document + expense", () => {
  it("documents attach to a pet", () => {
    const pet = newPet();
    call("document-add", ctxA, { petId: pet.id, title: "Adoption papers", kind: "legal" });
    assert.equal(call("document-list", ctxA, { petId: pet.id }).result.documents.length, 1);
    assert.equal(call("document-add", ctxA, { petId: pet.id }).ok, false);
  });

  it("expense summary aggregates by category and month", () => {
    const pet = newPet();
    call("expense-log", ctxA, { petId: pet.id, category: "food", amount: 60 });
    call("expense-log", ctxA, { petId: pet.id, category: "food", amount: 40 });
    call("expense-log", ctxA, { petId: pet.id, category: "toys", amount: 25 });
    const sum = call("expense-summary", ctxA, { petId: pet.id });
    assert.equal(sum.result.total, 125);
    assert.equal(sum.result.byCategory.food, 100);
    assert.equal(sum.result.thisMonth, 125);
  });
});

describe("pets.caregiver + booking (Rover shape)", () => {
  it("register caregiver, book, status flow, rating", () => {
    const cg = call("caregiver-register", ctxB, {
      name: "Sam Walker", services: ["walking", "boarding"], rates: { walking: 22, boarding: 45 },
    }).result.caregiver;
    assert.equal(call("caregiver-list", ctxA, { service: "walking" }).result.count, 1);

    const pet = newPet(ctxA);
    const booking = call("booking-create", ctxA, {
      caregiverId: cg.id, petId: pet.id, service: "boarding",
      startDate: dayOffset(1), endDate: dayOffset(4),
    }).result.booking;
    assert.equal(booking.nights, 3);
    assert.equal(booking.estimatedCost, 135); // 45 × 3 nights

    // caregiver advances + completes; owner rates
    call("booking-update", ctxB, { id: booking.id, status: "confirmed" });
    call("booking-update", ctxB, { id: booking.id, status: "completed", update: "All done, great pup!" });
    call("booking-update", ctxA, { id: booking.id, rating: 5 });
    assert.equal(call("caregiver-list", ctxA, {}).result.caregivers[0].rating, 5);
    assert.equal(call("booking-list", ctxB, {}).result.asCaregiver.length, 1);
  });

  it("rejects booking for an unoffered service", () => {
    const cg = call("caregiver-register", ctxB, { name: "Sam", services: ["walking"] }).result.caregiver;
    const pet = newPet(ctxA);
    assert.equal(call("booking-create", ctxA, { caregiverId: cg.id, petId: pet.id, service: "boarding", startDate: dayOffset(1) }).ok, false);
  });
});

describe("pets.pets-dashboard", () => {
  it("aggregates overdue vaccines, reminders and spend", () => {
    const pet = newPet();
    call("vaccine-record", ctxA, { petId: pet.id, name: "Rabies", nextDueDate: dayOffset(-3) });
    call("reminder-create", ctxA, { petId: pet.id, title: "Vet", dueDate: dayOffset(-1) });
    call("expense-log", ctxA, { petId: pet.id, category: "food", amount: 50 });
    const d = call("pets-dashboard", ctxA, {});
    assert.equal(d.result.pets, 1);
    assert.equal(d.result.overdueVaccines, 1);
    assert.equal(d.result.overdueReminders, 1);
    assert.equal(d.result.monthSpend, 50);
  });
});
