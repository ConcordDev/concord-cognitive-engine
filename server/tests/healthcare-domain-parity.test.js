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

describe("healthcare.record-get (real EHR/FHIR data only)", () => {
  it("returns empty + setup hint when no record on file", () => {
    const r = call("record-get", ctxA, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.vitals, []);
    assert.deepEqual(r.result.allergies, []);
    assert.equal(r.result.source, "empty");
    assert.match(r.result.notes, /FHIR|MyChart|HealthKit|record-update/);
  });

  it("returns real stored record when populated by record-update / FHIR sync", () => {
    const STATE = globalThis._concordSTATE;
    STATE.healthLens = STATE.healthLens || {};
    STATE.healthLens.records = STATE.healthLens.records || new Map();
    STATE.healthLens.records.set("user_a", {
      vitals: [{ channel: "heart_rate", value: 68, unit: "bpm", recordedAt: "2026-05-15T10:00:00Z" }],
      allergies: [{ substance: "Penicillin", severity: "moderate" }],
      immunizations: [], conditions: [],
    });
    const r = call("record-get", ctxA, {});
    assert.equal(r.result.vitals.length, 1);
    assert.equal(r.result.vitals[0].channel, "heart_rate");
  });
});

describe("healthcare.providers-search + slots + book", () => {
  it("search returns NPI registry providers shaped for the workbench", async () => {
    globalThis.fetch = async (url) => {
      assert.match(url, /npiregistry\.cms\.hhs\.gov/);
      assert.match(url, /postal_code=94110/);
      return {
        ok: true,
        json: async () => ({
          result_count: 1,
          results: [{
            number: "1234567890",
            basic: { first_name: "JANE", last_name: "DOE", credential: "MD", gender: "F", enumeration_date: "2010-01-15" },
            addresses: [{
              address_purpose: "LOCATION",
              address_1: "123 Mission St", city: "San Francisco", state: "CA",
              postal_code: "94110", telephone_number: "415-555-1234",
            }],
            taxonomies: [{ primary: true, desc: "Cardiovascular Disease" }],
          }],
        }),
      };
    };
    const r = await call("providers-search", ctxA, { specialty: "Cardiology", zipCode: "94110" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "NPI registry (CMS NPPES)");
    assert.equal(r.result.providers.length, 1);
    assert.equal(r.result.providers[0].npi, "1234567890");
    assert.equal(r.result.providers[0].name, "MD JANE DOE");
    assert.equal(r.result.providers[0].specialty, "Cardiovascular Disease");
    assert.equal(r.result.providers[0].city, "San Francisco");
  });

  it("search handles network failure gracefully", async () => {
    const r = await call("providers-search", ctxA, { specialty: "Cardiology" });
    assert.equal(r.ok, false);
    assert.match(r.error, /failed|network/);
  });

  it("slots returns empty + setup hint when no scheduling feed wired", () => {
    const r = call("provider-slots", ctxA, { providerId: "prov_Card_0", days: 14 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.slots, []);
    assert.equal(r.result.source, "empty");
    assert.match(r.result.notes, /FHIR|MyChart|Cerner|athenahealth|Zocdoc/);
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

describe("healthcare.rx-price-compare (real PBM/pharmacy API required)", () => {
  it("returns error pointing to GOODRX_API_KEY / RXSAVER_API_KEY (no hash-seeded synthesizer)", () => {
    const r = call("rx-price-compare", ctxA, { drug: "Atorvastatin 20mg", zip: "94110" });
    assert.equal(r.ok, false);
    assert.match(r.error, /GOODRX_API_KEY|RXSAVER_API_KEY|PBM/);
    assert.equal(r.meta.drug, "Atorvastatin 20mg");
    assert.equal(r.meta.zip, "94110");
  });

  it("rejects empty drug", () => {
    assert.equal(call("rx-price-compare", ctxA, { drug: "" }).ok, false);
  });
});

describe("regression: pre-existing analytical macros still work", () => {
  it("at least one is registered", () => {
    assert.ok(ACTIONS.size > 12);
  });
});

describe("healthcare.appointment-charge-copay (real Stripe)", () => {
  it("rejects when STRIPE_SECRET_KEY env not set", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const booked = call("appointment-book", ctxA, { providerId: "p1", date: "2026-06-01", time: "10:00", copayUsd: 30 });
    const r = await call("appointment-charge-copay", ctxA, { appointmentId: booked.result.appointment.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /STRIPE_SECRET_KEY|Stripe not configured/);
  });

  it("rejects when appointment has no copay amount", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const booked = call("appointment-book", ctxA, { providerId: "p1", date: "2026-06-01", time: "10:00" });
    const r = await call("appointment-charge-copay", ctxA, { appointmentId: booked.result.appointment.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /no copay amount/);
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("creates a Stripe PaymentIntent for the copay (real API shape)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    let captured;
    globalThis.fetch = async (url, opts) => {
      captured = { url, body: opts?.body };
      return {
        ok: true,
        json: async () => ({ id: "pi_copay123", client_secret: "pi_copay123_secret_xyz", status: "requires_payment_method", amount: 3000 }),
      };
    };
    const booked = call("appointment-book", ctxA, { providerId: "p1", date: "2026-06-01", time: "10:00", copayUsd: 30 });
    const r = await call("appointment-charge-copay", ctxA, { appointmentId: booked.result.appointment.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.clientSecret, "pi_copay123_secret_xyz");
    assert.equal(r.result.paymentIntentId, "pi_copay123");
    assert.equal(r.result.copayUsd, 30);
    assert.match(captured.url, /\/payment_intents/);
    assert.match(captured.body, /amount=3000/);
    assert.match(captured.body, /metadata%5Bconcord_purpose%5D=healthcare_copay/);
    assert.match(captured.body, /metadata%5Bconcord_user_id%5D=user_a/);
    // appointment now in pending status
    const list = globalThis._concordSTATE.healthLens.appointments.get("user_a");
    assert.equal(list[0].copayStatus, "pending");
    assert.equal(list[0].stripePaymentIntentId, "pi_copay123");
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("rejects double-charging an already-paid copay", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ id: "pi_xx", client_secret: "x", status: "requires_payment_method", amount: 3000 }),
    });
    const booked = call("appointment-book", ctxA, { providerId: "p1", date: "2026-06-01", time: "10:00", copayUsd: 30 });
    await call("appointment-charge-copay", ctxA, { appointmentId: booked.result.appointment.id });
    // Simulate webhook flipping to paid
    globalThis._concordSTATE.healthLens.appointments.get("user_a")[0].copayStatus = "paid";
    const r2 = await call("appointment-charge-copay", ctxA, { appointmentId: booked.result.appointment.id });
    assert.equal(r2.ok, false);
    assert.match(r2.error, /already paid/);
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("surfaces real Stripe error messages on API failure", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_bad";
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Invalid API Key" } }),
    });
    const booked = call("appointment-book", ctxA, { providerId: "p1", date: "2026-06-01", time: "10:00", copayUsd: 30 });
    const r = await call("appointment-charge-copay", ctxA, { appointmentId: booked.result.appointment.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /Invalid API Key|stripe/i);
    delete process.env.STRIPE_SECRET_KEY;
  });
});

describe("healthcare.appointment-list", () => {
  it("lists appointments scoped per-user, sorted date desc", () => {
    call("appointment-book", ctxA, { providerId: "p1", date: "2026-05-01", time: "09:00" });
    call("appointment-book", ctxA, { providerId: "p1", date: "2026-06-01", time: "10:00" });
    const r = call("appointment-list", ctxA, {});
    assert.equal(r.result.appointments.length, 2);
    assert.equal(r.result.appointments[0].date, "2026-06-01");
  });

  it("filters by copayStatus", () => {
    const a = call("appointment-book", ctxA, { providerId: "p1", date: "2026-06-01", time: "10:00", copayUsd: 25 });
    const b = call("appointment-book", ctxA, { providerId: "p1", date: "2026-06-02", time: "11:00", copayUsd: 25 });
    // Mark first one paid
    globalThis._concordSTATE.healthLens.appointments.get("user_a")
      .find((x) => x.id === a.result.appointment.id).copayStatus = "paid";
    void b;
    assert.equal(call("appointment-list", ctxA, { copayStatus: "paid" }).result.appointments.length, 1);
    assert.equal(call("appointment-list", ctxA, { copayStatus: "unpaid" }).result.appointments.length, 1);
  });
});
