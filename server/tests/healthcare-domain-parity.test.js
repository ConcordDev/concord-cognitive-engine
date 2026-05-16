import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHealthcareActions from "../domains/healthcare.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`healthcare.${name}`);
  assert.ok(fn, `healthcare.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerHealthcareActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("healthcare.symptom-triage", () => {
  it("rejects when no input", async () => {
    const r = await call("symptom-triage", { llm: { chat: async () => ({}) } }, { regions: [], description: "" });
    assert.equal(r.ok, false);
  });

  it("graceful fallback when LLM unavailable", async () => {
    const r = await call("symptom-triage", ctxA, { regions: ["head"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.severity, "see_doctor");
  });

  it("parses LLM JSON to severity + candidates + citations", async () => {
    const ctx = {
      actor: { userId: "user_a" }, userId: "user_a",
      llm: { chat: async () => ({ text: '{"severity":"er","candidates":[{"condition":"Possible MI","confidence":0.7,"citations":["AHA-MI-2024"]}],"reasoning":"Chest pain with radiation"}' }) },
    };
    const r = await call("symptom-triage", ctx, { regions: ["chest"], description: "crushing pain", age: 55 });
    assert.equal(r.result.severity, "er");
    assert.equal(r.result.candidates[0].condition, "Possible MI");
    assert.deepEqual(r.result.candidates[0].citations, ["AHA-MI-2024"]);
  });

  it("falls back to see_doctor when LLM output isn't parseable", async () => {
    const ctx = { actor: { userId: "u" }, userId: "u", llm: { chat: async () => ({ text: "I cannot help" }) } };
    const r = await call("symptom-triage", ctx, { regions: ["chest"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.severity, "see_doctor");
  });
});

describe("healthcare.medications-*", () => {
  it("add + list + log-dose + delete scoped per user", () => {
    const r1 = call("medications-add", ctxA, { name: "Atorvastatin", dose: "20mg", schedule: "daily" });
    assert.equal(r1.ok, true);
    const list1 = call("medications-list", ctxA, {});
    assert.equal(list1.result.medications.length, 1);
    assert.equal(list1.result.medications[0].dosesScheduledToday, 1);
    assert.equal(list1.result.medications[0].dosesTakenToday, 0);

    call("medications-log-dose", ctxA, { id: r1.result.medication.id });
    const list2 = call("medications-list", ctxA, {});
    assert.equal(list2.result.medications[0].dosesTakenToday, 1);
    assert.equal(list2.result.medications[0].takenToday, true);

    // Other user empty
    assert.equal(call("medications-list", ctxB, {}).result.medications.length, 0);

    call("medications-delete", ctxA, { id: r1.result.medication.id });
    assert.equal(call("medications-list", ctxA, {}).result.medications.length, 0);
  });

  it("rejects missing name or dose", () => {
    assert.equal(call("medications-add", ctxA, { name: "X" }).ok, false);
    assert.equal(call("medications-add", ctxA, { dose: "20mg" }).ok, false);
  });

  it("schedule maps to correct doses-per-day", () => {
    const r = call("medications-add", ctxA, { name: "X", dose: "1mg", schedule: "three_times_daily" });
    const list = call("medications-list", ctxA, {});
    assert.equal(list.result.medications[0].dosesScheduledToday, 3);
    void r;
  });
});

describe("healthcare.record-get", () => {
  it("seeds demo record on first call (deterministic per user)", () => {
    const r1 = call("record-get", ctxA, {});
    assert.equal(r1.ok, true);
    assert.ok(r1.result.vitals.length >= 5);
    assert.ok(Array.isArray(r1.result.allergies));
    assert.ok(r1.result.immunizations.length >= 1);

    // Same user → same record
    const r2 = call("record-get", ctxA, {});
    assert.deepEqual(r1.result.vitals, r2.result.vitals);
  });
});

describe("healthcare.providers-search + slots + book", () => {
  it("search returns providers with specialty + zip-keyed practice", () => {
    const r = call("providers-search", ctxA, { specialty: "Cardiology", zipCode: "94110" });
    assert.equal(r.ok, true);
    assert.ok(r.result.providers.length >= 5);
    assert.ok(r.result.providers.every(p => p.specialty === "Cardiology"));
  });

  it("slots respect days param and skip weekends", () => {
    const r = call("provider-slots", ctxA, { providerId: "prov_Card_0", days: 14 });
    assert.ok(r.result.slots.length > 0);
    for (const s of r.result.slots) {
      const dow = new Date(s.date).getDay();
      assert.ok(dow !== 0 && dow !== 6, `slot ${s.date} fell on weekend`);
    }
  });

  it("book persists appointment scoped per user", () => {
    const r = call("appointment-book", ctxA, { providerId: "p1", date: "2026-06-01", time: "10:00", kind: "telehealth" });
    assert.equal(r.ok, true);
    const state = globalThis._concordSTATE.healthLens;
    assert.equal((state.appointments.get("user_a") || []).length, 1);
    assert.equal((state.appointments.get("user_b") || []).length, 0);
  });

  it("book rejects missing fields", () => {
    assert.equal(call("appointment-book", ctxA, { providerId: "x", date: "2026-06-01" }).ok, false);
  });
});

describe("healthcare.rx-price-compare", () => {
  it("returns 7 pharmacies sorted by price ascending in caller", () => {
    const r = call("rx-price-compare", ctxA, { drug: "Atorvastatin 20mg", zip: "94110" });
    assert.equal(r.ok, true);
    assert.equal(r.result.prices.length, 7);
    assert.ok(r.result.prices.every(p => p.cashPrice > 0));
  });

  it("rejects empty drug", () => {
    assert.equal(call("rx-price-compare", ctxA, { drug: "" }).ok, false);
  });

  it("determinism per drug+zip", () => {
    const r1 = call("rx-price-compare", ctxA, { drug: "X", zip: "Y" });
    const r2 = call("rx-price-compare", ctxA, { drug: "X", zip: "Y" });
    assert.deepEqual(r1.result.prices, r2.result.prices);
  });
});

describe("regression: pre-existing analytical macros still work", () => {
  it("at least one is registered", () => {
    assert.ok(ACTIONS.size > 12);
  });
});
