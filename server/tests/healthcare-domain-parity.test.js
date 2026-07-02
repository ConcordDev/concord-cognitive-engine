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

// ═════════════════════════════════════════════════════════════════
//  Epic 2026 parity macros — patients, problems, allergies, vitals,
//  labs, immunizations, encounters/SOAP, SmartPhrases, AI scribe,
//  patient portal, dashboard.
// ═════════════════════════════════════════════════════════════════

describe("healthcare — patients CRUD + detail", () => {
  it("creates a patient and lists per user", () => {
    const r = call("patients-create", ctxA, { firstName: "Jane", lastName: "Doe", dob: "1985-04-12", sex: "F", phone: "555-0101" });
    assert.equal(r.ok, true);
    assert.match(r.result.patient.mrn, /^MRN-/);
    assert.equal(r.result.patient.sex, "F");
    assert.equal(call("patients-list", ctxA).result.patients.length, 1);
    assert.equal(call("patients-list", ctxB).result.patients.length, 0);
  });

  it("patients-detail joins problems, allergies, vitals, labs, immunizations, encounters", () => {
    const p = call("patients-create", ctxA, { firstName: "Bob", lastName: "Smith" }).result.patient;
    call("problems-add", ctxA, { patientId: p.id, name: "Hypertension", icd10: "I10" });
    call("allergies-add", ctxA, { patientId: p.id, allergen: "Penicillin", severity: "severe" });
    call("vitals-record", ctxA, { patientId: p.id, systolic: 145, diastolic: 92, heartRate: 78 });
    call("labs-record", ctxA, { patientId: p.id, test: "glucose", value: 220 });
    const d = call("patients-detail", ctxA, { id: p.id });
    assert.equal(d.ok, true);
    assert.equal(d.result.problems.length, 1);
    assert.equal(d.result.allergies.length, 1);
    assert.equal(d.result.vitals.length, 1);
    assert.equal(d.result.labs.length, 1);
  });
});

describe("healthcare — problems + ICD-10", () => {
  it("resolves a problem and sets resolvedDate", () => {
    const p = call("patients-create", ctxA, { firstName: "Pat", lastName: "Test" }).result.patient;
    const prob = call("problems-add", ctxA, { patientId: p.id, name: "Acute bronchitis", icd10: "J20.9" }).result.problem;
    assert.equal(prob.status, "active");
    const u = call("problems-update", ctxA, { id: prob.id, status: "resolved" });
    assert.equal(u.result.problem.status, "resolved");
    assert.ok(u.result.problem.resolvedDate);
  });
});

describe("healthcare — vitals with clinical alert flags", () => {
  it("flags hypertensive crisis", () => {
    const p = call("patients-create", ctxA, { firstName: "Hi", lastName: "BP" }).result.patient;
    const v = call("vitals-record", ctxA, { patientId: p.id, systolic: 195, diastolic: 125, heartRate: 80 });
    assert.ok(v.result.vitals.flags.includes("bp_critical"));
  });
  it("flags hypoxia + fever", () => {
    const p = call("patients-create", ctxA, { firstName: "Sick", lastName: "Pt" }).result.patient;
    const v = call("vitals-record", ctxA, { patientId: p.id, spo2: 88, tempF: 102.5 });
    assert.ok(v.result.vitals.flags.includes("hypoxia"));
    assert.ok(v.result.vitals.flags.includes("fever"));
  });
  it("computes BMI from weight + height", () => {
    const p = call("patients-create", ctxA, { firstName: "Bmi", lastName: "Test" }).result.patient;
    const v = call("vitals-record", ctxA, { patientId: p.id, weightLb: 180, heightIn: 70 });
    assert.ok(v.result.vitals.bmi > 25 && v.result.vitals.bmi < 27);
  });
});

describe("healthcare — labs with reference ranges + abnormal flags", () => {
  it("flags critical_high glucose", () => {
    const p = call("patients-create", ctxA, { firstName: "Db", lastName: "Pt" }).result.patient;
    const l = call("labs-record", ctxA, { patientId: p.id, test: "glucose", value: 450 });
    assert.equal(l.result.lab.flag, "critical_high");
    assert.equal(l.result.lab.unit, "mg/dL");
  });
  it("flags normal A1C", () => {
    const p = call("patients-create", ctxA, { firstName: "Db", lastName: "Pt" }).result.patient;
    const l = call("labs-record", ctxA, { patientId: p.id, test: "a1c", value: 5.2 });
    assert.equal(l.result.lab.flag, "normal");
  });
  it("flags unflagged for unknown tests", () => {
    const p = call("patients-create", ctxA, { firstName: "Db", lastName: "Pt" }).result.patient;
    const l = call("labs-record", ctxA, { patientId: p.id, test: "rare_test", value: 42, unit: "u/L" });
    assert.equal(l.result.lab.flag, "unflagged");
  });
});

describe("healthcare — encounters + SOAP + sign", () => {
  it("encounters-save-soap requires assessment + plan to sign", () => {
    const p = call("patients-create", ctxA, { firstName: "P", lastName: "T" }).result.patient;
    const e = call("encounters-create", ctxA, { patientId: p.id, chiefComplaint: "Cough x 3 days" }).result.encounter;
    const noSign = call("encounters-sign", ctxA, { id: e.id });
    assert.equal(noSign.ok, false);
    assert.match(noSign.error, /Assessment.*Plan|CMS/i);
    call("encounters-save-soap", ctxA, { id: e.id, assessment: "URI", plan: "Sx care, return precautions" });
    const sign = call("encounters-sign", ctxA, { id: e.id });
    assert.equal(sign.ok, true);
    assert.equal(sign.result.encounter.status, "signed");
  });
  it("cannot save SOAP on signed encounter", () => {
    const p = call("patients-create", ctxA, { firstName: "P", lastName: "T" }).result.patient;
    const e = call("encounters-create", ctxA, { patientId: p.id }).result.encounter;
    call("encounters-save-soap", ctxA, { id: e.id, assessment: "x", plan: "y" });
    call("encounters-sign", ctxA, { id: e.id });
    const r = call("encounters-save-soap", ctxA, { id: e.id, plan: "new" });
    assert.equal(r.ok, false);
  });
});

describe("healthcare — SmartPhrases", () => {
  it("seeds canonical Epic-style dot-phrases on first list", () => {
    const r = call("smartphrases-list", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.smartPhrases.find(sp => sp.name === ".ros"));
    assert.ok(r.result.smartPhrases.find(sp => sp.name === ".normalexam"));
  });
  it("expands a .dotphrase inline", () => {
    call("smartphrases-list", ctxA); // seed
    const r = call("smartphrases-expand", ctxA, { text: "PE: .normalexam. Notes follow." });
    assert.equal(r.ok, true);
    assert.ok(r.result.expandedLength > r.result.originalLength);
    assert.ok(r.result.expanded.includes("Alert, oriented x3"));
  });
});

describe("healthcare — AI scribe", () => {
  it("deterministic SOAP extract when no brain", async () => {
    const raw = "Patient reports fever and cough for 3 days. Exam reveals temp 101.2. Likely viral URI. Plan: supportive care, fluids, return if worse.";
    const r = await call("ai-scribe", ctxA, { text: raw });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "deterministic");
    assert.ok(r.result.soap.subjective.length > 0);
    assert.ok(r.result.soap.plan.length > 0);
  });
  it("rejects too-short transcript", async () => {
    const r = await call("ai-scribe", ctxA, { text: "Cold" });
    assert.equal(r.ok, false);
  });
});

describe("healthcare — chart conversational search", () => {
  it("finds problems + labs + meds matching a query", async () => {
    const p = call("patients-create", ctxA, { firstName: "Diabetes", lastName: "Pt" }).result.patient;
    call("problems-add", ctxA, { patientId: p.id, name: "Type 2 Diabetes Mellitus", icd10: "E11.9" });
    call("labs-record", ctxA, { patientId: p.id, test: "a1c", value: 8.2 });
    const r = await call("ai-chart-search", ctxA, { patientId: p.id, query: "diabetes" });
    assert.equal(r.ok, true);
    assert.ok(r.result.findings.some(f => f.label === "problem"));
  });
  it("surfaces abnormal labs when query mentions 'critical'", async () => {
    const p = call("patients-create", ctxA, { firstName: "P", lastName: "T" }).result.patient;
    call("labs-record", ctxA, { patientId: p.id, test: "potassium", value: 7.5 });
    const r = await call("ai-chart-search", ctxA, { patientId: p.id, query: "critical values" });
    assert.equal(r.ok, true);
    assert.ok(r.result.findings.some(f => f.label === "lab"));
  });
});

describe("healthcare — patient portal (messages + refills)", () => {
  it("send a message and mark it read", () => {
    const p = call("patients-create", ctxA, { firstName: "P", lastName: "T" }).result.patient;
    const m = call("messages-send", ctxA, { patientId: p.id, body: "Hello", direction: "from_patient" }).result.message;
    assert.ok(!m.readAt);
    const r = call("messages-mark-read", ctxA, { id: m.id });
    assert.ok(r.result.message.readAt);
  });
  it("refill: request → approve workflow", () => {
    const p = call("patients-create", ctxA, { firstName: "P", lastName: "T" }).result.patient;
    const r1 = call("refills-request", ctxA, { patientId: p.id, medication: "Lisinopril 10mg", pharmacy: "CVS #123" });
    assert.equal(r1.result.refill.status, "requested");
    const r2 = call("refills-respond", ctxA, { id: r1.result.refill.id, status: "approved", responseNotes: "Sent to pharmacy" });
    assert.equal(r2.result.refill.status, "approved");
    assert.ok(r2.result.refill.respondedAt);
  });
});

describe("healthcare — dashboard summary", () => {
  it("aggregates patients, today's visits, unsigned notes, inbox, refills, critical labs", () => {
    const p = call("patients-create", ctxA, { firstName: "P", lastName: "T" }).result.patient;
    call("problems-add", ctxA, { patientId: p.id, name: "HTN" });
    call("encounters-create", ctxA, { patientId: p.id });
    call("messages-send", ctxA, { patientId: p.id, body: "?", direction: "from_patient" });
    call("refills-request", ctxA, { patientId: p.id, medication: "X" });
    call("labs-record", ctxA, { patientId: p.id, test: "potassium", value: 7.5 });
    const r = call("dashboard-summary", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.patientCount, 1);
    assert.equal(r.result.todaysVisits, 1);
    assert.equal(r.result.unsignedNotes, 1);
    assert.equal(r.result.inboxUnread, 1);
    assert.equal(r.result.pendingRefills, 1);
    assert.equal(r.result.criticalLabs, 1);
    assert.equal(r.result.activeProblems, 1);
  });
});

// ── Orders (CPOE), care team, care gaps, interactions, AVS ───────

function newPatient(ctx = ctxA, extra = {}) {
  return call("patients-create", ctx, { firstName: "Test", lastName: "Patient", ...extra }).result.patient;
}

describe("healthcare orders (CPOE)", () => {
  it("creates, lists, updates status and cancels orders", () => {
    const p = newPatient();
    const lab = call("order-create", ctxA, { patientId: p.id, kind: "lab", name: "CBC with diff" }).result.order;
    assert.equal(lab.status, "placed");
    const med = call("order-create", ctxA, { patientId: p.id, kind: "medication", name: "Lisinopril", dose: "10mg", frequency: "daily" }).result.order;
    assert.equal(med.status, "active");
    assert.equal(call("order-list", ctxA, { patientId: p.id }).result.total, 2);
    assert.equal(call("order-list", ctxA, { patientId: p.id, kind: "medication" }).result.total, 1);
    call("order-update-status", ctxA, { id: lab.id, status: "resulted" });
    assert.equal(call("order-list", ctxA, { patientId: p.id, status: "resulted" }).result.total, 1);
    call("order-cancel", ctxA, { id: med.id });
    assert.equal(call("order-list", ctxA, { patientId: p.id, kind: "medication" }).result.orders[0].status, "discontinued");
  });

  it("rejects an invalid order kind", () => {
    const p = newPatient();
    assert.equal(call("order-create", ctxA, { patientId: p.id, kind: "spell", name: "x" }).ok, false);
  });
});

describe("healthcare drug-interaction-check", () => {
  it("flags a known drug-drug interaction among active medication orders", () => {
    const p = newPatient();
    call("order-create", ctxA, { patientId: p.id, kind: "medication", name: "Warfarin 5mg" });
    call("order-create", ctxA, { patientId: p.id, kind: "medication", name: "Aspirin 81mg" });
    const r = call("drug-interaction-check", ctxA, { patientId: p.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.hasMajor, true);
    assert.ok(r.result.interactions.some((i) => i.type === "drug-drug"));
  });

  it("flags a drug-allergy conflict against the candidate drug", () => {
    const p = newPatient();
    call("allergies-add", ctxA, { patientId: p.id, allergen: "penicillin", severity: "severe" });
    const r = call("drug-interaction-check", ctxA, { patientId: p.id, candidateDrug: "Penicillin VK 500mg" });
    assert.ok(r.result.interactions.some((i) => i.type === "drug-allergy" && i.severity === "major"));
  });

  it("returns clean when there are no interactions", () => {
    const p = newPatient();
    call("order-create", ctxA, { patientId: p.id, kind: "medication", name: "Vitamin D" });
    assert.equal(call("drug-interaction-check", ctxA, { patientId: p.id }).result.clean, true);
  });
});

describe("healthcare care team", () => {
  it("assigns, lists and removes care team members", () => {
    const p = newPatient();
    const m = call("care-team-assign", ctxA, { patientId: p.id, providerName: "Dr. Lee", role: "pcp" }).result.member;
    assert.equal(m.role, "pcp");
    assert.equal(call("care-team-list", ctxA, { patientId: p.id }).result.careTeam.length, 1);
    call("care-team-remove", ctxA, { id: m.id });
    assert.equal(call("care-team-list", ctxA, { patientId: p.id }).result.careTeam.length, 0);
  });
});

describe("healthcare care-gaps", () => {
  it("flags an overdue flu shot and a diabetes A1C gap", () => {
    const p = newPatient(ctxA, { dob: "1970-01-01", sex: "M" });
    call("problems-add", ctxA, { patientId: p.id, name: "Type 2 diabetes mellitus", icd10: "E11.9" });
    const r = call("care-gaps", ctxA, { patientId: p.id });
    assert.equal(r.ok, true);
    const items = r.result.gaps.map((g) => g.item);
    assert.ok(items.includes("Influenza vaccine"));
    assert.ok(items.includes("Hemoglobin A1C"));
  });

  it("clears the flu gap once a recent immunization is on file", () => {
    const p = newPatient(ctxA, { dob: "1990-06-01", sex: "M" });
    const today = new Date().toISOString().slice(0, 10);
    call("immunizations-add", ctxA, { patientId: p.id, vaccine: "Influenza", administeredAt: today });
    const r = call("care-gaps", ctxA, { patientId: p.id });
    assert.ok(!r.result.gaps.some((g) => g.item === "Influenza vaccine"));
  });
});

describe("healthcare visit-summary", () => {
  it("generates an after-visit summary from an encounter", () => {
    const p = newPatient(ctxA, { firstName: "Ann", lastName: "Vee" });
    const enc = call("encounters-create", ctxA, { patientId: p.id, chiefComplaint: "Cough" }).result.encounter;
    call("encounters-save-soap", ctxA, { id: enc.id, assessment: "Acute bronchitis", plan: "Rest, fluids, return if worse" });
    call("problems-add", ctxA, { patientId: p.id, name: "Hypertension", icd10: "I10" });
    call("order-create", ctxA, { patientId: p.id, kind: "medication", name: "Lisinopril", dose: "10mg" });
    const r = call("visit-summary", ctxA, { encounterId: enc.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.summary.patientName, "Ann Vee");
    assert.equal(r.result.summary.activeProblems.length, 1);
    assert.equal(r.result.summary.medications.length, 1);
    assert.ok(r.result.text.includes("AFTER-VISIT SUMMARY"));
  });
});

// ═════════════════════════════════════════════════════════════════
//  Feature-parity backlog — results release, telehealth, device
//  ingestion, insurance/claims, CDS alerts, FHIR export, proxy.
// ═════════════════════════════════════════════════════════════════

describe("healthcare — patient portal results release (labs-release / labs-portal-view)", () => {
  it("releases a lab with provider commentary; portal view shows only released labs", () => {
    const p = newPatient();
    const lab1 = call("labs-record", ctxA, { patientId: p.id, test: "glucose", value: 95 }).result.lab;
    call("labs-record", ctxA, { patientId: p.id, test: "potassium", value: 7.2 }); // abnormal, not released
    // Before release the portal view is empty
    let portal = call("labs-portal-view", ctxA, { patientId: p.id });
    assert.equal(portal.result.labs.length, 0);
    const rel = call("labs-release", ctxA, { id: lab1.id, commentary: "Your glucose is normal.", releasedBy: "Dr. Lee" });
    assert.equal(rel.ok, true);
    assert.equal(rel.result.lab.released, true);
    assert.equal(rel.result.lab.providerCommentary, "Your glucose is normal.");
    portal = call("labs-portal-view", ctxA, { patientId: p.id });
    assert.equal(portal.result.labs.length, 1);
    assert.equal(portal.result.labs[0].id, lab1.id);
  });

  it("flags abnormal results in the portal view", () => {
    const p = newPatient();
    const abn = call("labs-record", ctxA, { patientId: p.id, test: "potassium", value: 7.5 }).result.lab;
    call("labs-release", ctxA, { id: abn.id });
    const portal = call("labs-portal-view", ctxA, { patientId: p.id });
    assert.equal(portal.result.abnormalCount, 1);
    assert.equal(portal.result.hasCritical, true);
  });

  it("labs-release rejects an unknown lab id", () => {
    assert.equal(call("labs-release", ctxA, { id: "nope" }).ok, false);
  });
});

describe("healthcare — telehealth video visits", () => {
  it("creates, lists and advances a telehealth visit lifecycle", async () => {
    const p = newPatient();
    const created = await call("telehealth-create", ctxA, { patientId: p.id, provider: "Dr. Ng" });
    assert.equal(created.ok, true);
    assert.equal(created.result.visit.status, "scheduled");
    // Honesty (POLISH_AUDIT T1.3): no fabricated joinToken — the concord-webrtc
    // path is token-free (room = webrtc:<visitId>). With no realtime layer in
    // this harness (and no DAILY_API_KEY), video is honestly not provisioned.
    assert.equal("joinToken" in created.result.visit, false);
    assert.equal(created.result.visit.videoReady, false);
    const list = call("telehealth-list", ctxA, { patientId: p.id });
    assert.equal(list.result.visits.length, 1);
    const started = call("telehealth-update-status", ctxA, { id: created.result.visit.id, status: "in_progress" });
    assert.equal(started.result.visit.status, "in_progress");
    assert.ok(started.result.visit.startedAt);
    const done = call("telehealth-update-status", ctxA, { id: created.result.visit.id, status: "completed" });
    assert.ok(done.result.visit.endedAt);
  });

  it("telehealth-create rejects an unknown patient", async () => {
    const r = await call("telehealth-create", ctxA, { patientId: "ghost" });
    assert.equal(r.ok, false);
  });

  it("telehealth-update-status rejects an invalid status", async () => {
    const p = newPatient();
    const v = (await call("telehealth-create", ctxA, { patientId: p.id })).result.visit;
    assert.equal(call("telehealth-update-status", ctxA, { id: v.id, status: "bogus" }).ok, false);
  });
});

describe("healthcare — wearable / device data ingestion", () => {
  it("ingests readings, flags out-of-range, and summarises trend per metric", () => {
    const p = newPatient();
    call("device-ingest", ctxA, { patientId: p.id, metric: "glucose", value: 90, recordedAt: "2026-05-01T08:00:00Z" });
    const high = call("device-ingest", ctxA, { patientId: p.id, metric: "glucose", value: 210, recordedAt: "2026-05-02T08:00:00Z" });
    assert.equal(high.result.reading.flag, "high");
    const readings = call("device-readings", ctxA, { patientId: p.id });
    assert.equal(readings.result.readings.length, 2);
    const glucoseSummary = readings.result.summary.find(s => s.metric === "glucose");
    assert.equal(glucoseSummary.count, 2);
    assert.equal(glucoseSummary.trend, "up");
  });

  it("device-ingest rejects a non-numeric value", () => {
    const p = newPatient();
    assert.equal(call("device-ingest", ctxA, { patientId: p.id, metric: "glucose", value: "abc" }).ok, false);
  });

  it("device-readings filters by metric", () => {
    const p = newPatient();
    call("device-ingest", ctxA, { patientId: p.id, metric: "heart_rate", value: 72 });
    call("device-ingest", ctxA, { patientId: p.id, metric: "spo2", value: 98 });
    const hr = call("device-readings", ctxA, { patientId: p.id, metric: "heart_rate" });
    assert.equal(hr.result.readings.length, 1);
    assert.equal(hr.result.readings[0].metric, "heart_rate");
  });
});

describe("healthcare — insurance coverage + claims workflow", () => {
  it("adds a policy and verifies eligibility", () => {
    const p = newPatient();
    const pol = call("coverage-add", ctxA, { patientId: p.id, payer: "Aetna", memberId: "W12345", planType: "PPO", deductibleUsd: 1000 });
    assert.equal(pol.ok, true);
    assert.equal(pol.result.policy.eligibilityStatus, "unverified");
    const v = call("coverage-verify", ctxA, { id: pol.result.policy.id });
    assert.equal(v.result.eligibilityStatus, "active");
    assert.equal(v.result.remainingDeductible, 1000);
    assert.equal(call("coverage-list", ctxA, { patientId: p.id }).result.policies.length, 1);
  });

  it("coverage-add rejects missing payer or memberId", () => {
    const p = newPatient();
    assert.equal(call("coverage-add", ctxA, { patientId: p.id, payer: "X" }).ok, false);
  });

  it("creates a claim, submits it and adjudicates a partial payment", () => {
    const p = newPatient();
    const claim = call("claim-create", ctxA, {
      patientId: p.id,
      lines: [{ cpt: "99213", description: "Office visit", units: 1, chargeUsd: 200 }],
      diagnosisCodes: ["I10"],
    });
    assert.equal(claim.ok, true);
    assert.equal(claim.result.claim.totalChargeUsd, 200);
    assert.equal(claim.result.claim.status, "draft");
    const submitted = call("claim-submit", ctxA, { id: claim.result.claim.id });
    assert.equal(submitted.result.claim.status, "submitted");
    const adj = call("claim-adjudicate", ctxA, { id: claim.result.claim.id, allowedUsd: 150, paidUsd: 120 });
    assert.equal(adj.result.claim.status, "partial");
    assert.equal(adj.result.claim.patientResponsibilityUsd, 30);
  });

  it("claim-create rejects a claim with no CPT line items", () => {
    const p = newPatient();
    assert.equal(call("claim-create", ctxA, { patientId: p.id, lines: [] }).ok, false);
  });

  it("claim-adjudicate rejects paid exceeding allowed", () => {
    const p = newPatient();
    const c = call("claim-create", ctxA, { patientId: p.id, lines: [{ cpt: "99213", chargeUsd: 100 }] }).result.claim;
    call("claim-submit", ctxA, { id: c.id });
    assert.equal(call("claim-adjudicate", ctxA, { id: c.id, allowedUsd: 50, paidUsd: 80 }).ok, false);
  });
});

describe("healthcare — clinical decision support at order entry (cds-order-check)", () => {
  it("fires a Beers-criteria advisory for a benzodiazepine in an elderly patient", () => {
    const p = newPatient(ctxA, { dob: "1945-01-01" });
    const r = call("cds-order-check", ctxA, { patientId: p.id, orderKind: "medication", orderName: "Lorazepam 1mg" });
    assert.equal(r.ok, true);
    assert.ok(r.result.alerts.some(a => a.code === "BEERS"));
  });

  it("fires a renal-risk advisory for contrast imaging with an elevated creatinine", () => {
    const p = newPatient();
    call("labs-record", ctxA, { patientId: p.id, test: "creatinine", value: 2.4 });
    const r = call("cds-order-check", ctxA, { patientId: p.id, orderKind: "imaging", orderName: "CT abdomen with contrast" });
    assert.ok(r.result.alerts.some(a => a.code === "RENAL_RISK"));
    assert.equal(r.result.hasMajor, true);
  });

  it("returns clean when an order has no advisories", () => {
    const p = newPatient(ctxA, { dob: "1990-01-01" });
    const r = call("cds-order-check", ctxA, { patientId: p.id, orderKind: "lab", orderName: "CBC with diff" });
    assert.equal(r.result.clean, true);
  });

  it("cds-order-check rejects an unknown patient or missing order name", () => {
    assert.equal(call("cds-order-check", ctxA, { patientId: "ghost", orderName: "x" }).ok, false);
    const p = newPatient();
    assert.equal(call("cds-order-check", ctxA, { patientId: p.id, orderName: "" }).ok, false);
  });
});

describe("healthcare — FHIR R4 export", () => {
  it("exports a FHIR collection Bundle with Patient + clinical resources", () => {
    const p = newPatient(ctxA, { firstName: "Fhir", lastName: "Pt", dob: "1980-02-02", sex: "F" });
    call("problems-add", ctxA, { patientId: p.id, name: "Hypertension", icd10: "I10" });
    call("allergies-add", ctxA, { patientId: p.id, allergen: "Penicillin", severity: "severe" });
    call("immunizations-add", ctxA, { patientId: p.id, vaccine: "Influenza" });
    const r = call("fhir-export", ctxA, { patientId: p.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.fhirVersion, "4.0.1");
    assert.equal(r.result.bundle.resourceType, "Bundle");
    const kinds = r.result.bundle.entry.map(e => e.resource.resourceType);
    assert.ok(kinds.includes("Patient"));
    assert.ok(kinds.includes("Condition"));
    assert.ok(kinds.includes("AllergyIntolerance"));
    assert.ok(kinds.includes("Immunization"));
  });

  it("scopes the export to immunizations only when requested", () => {
    const p = newPatient();
    call("problems-add", ctxA, { patientId: p.id, name: "HTN" });
    call("immunizations-add", ctxA, { patientId: p.id, vaccine: "Influenza" });
    const r = call("fhir-export", ctxA, { patientId: p.id, scope: "immunizations" });
    const kinds = new Set(r.result.bundle.entry.map(e => e.resource.resourceType));
    assert.deepEqual([...kinds].sort(), ["Immunization", "Patient"]);
    assert.equal(r.result.scope, "immunizations");
  });

  it("fhir-export rejects an unknown patient", () => {
    assert.equal(call("fhir-export", ctxA, { patientId: "ghost" }).ok, false);
  });
});

describe("healthcare — family / proxy access", () => {
  it("grants, lists and revokes proxy access", () => {
    const p = newPatient();
    const g = call("proxy-grant", ctxA, { patientId: p.id, proxyName: "Jane Caregiver", relationship: "caregiver", accessLevel: "view" });
    assert.equal(g.ok, true);
    assert.equal(g.result.grant.status, "active");
    const list = call("proxy-list", ctxA, { patientId: p.id });
    assert.equal(list.result.grants.length, 1);
    assert.equal(list.result.activeCount, 1);
    const rev = call("proxy-revoke", ctxA, { id: g.result.grant.id });
    assert.equal(rev.result.grant.status, "revoked");
    assert.ok(rev.result.grant.revokedAt);
  });

  it("proxy-grant rejects an unknown patient or missing proxy name", () => {
    assert.equal(call("proxy-grant", ctxA, { patientId: "ghost", proxyName: "X" }).ok, false);
    const p = newPatient();
    assert.equal(call("proxy-grant", ctxA, { patientId: p.id, proxyName: "" }).ok, false);
  });

  it("proxy-revoke rejects re-revoking an already-revoked grant", () => {
    const p = newPatient();
    const g = call("proxy-grant", ctxA, { patientId: p.id, proxyName: "Y" }).result.grant;
    call("proxy-revoke", ctxA, { id: g.id });
    assert.equal(call("proxy-revoke", ctxA, { id: g.id }).ok, false);
  });
});
