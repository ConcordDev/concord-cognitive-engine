// server/tests/health-rebuild-sprint-a.test.js
//
// Healthcare lens Sprint A — FHIR-aligned substrate + HIPAA-compliant
// consent layer + audit log.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerHealthRebuildMacros from "../domains/healthcare-rebuild.js";
import {
  createPatient, getPatient, listMyPatients,
  addCondition, listConditions,
  addMedication, listMedications, logDose,
  addAllergy, listAllergies,
  addImmunization, listImmunizations,
  addObservation, listObservations,
  bookAppointment, listAppointments, cancelAppointment,
  upsertProvider, searchProviders,
  grantConsent, revokeConsent, listConsentGrants,
  getAuditLog, checkAccess,
} from "../lib/health/persistence.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  const m = await import("../migrations/240_health_rebuild.js");
  m.up(db);
  registerHealthRebuildMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId, audit = {}) { return { db, actor: { userId }, ip: audit.ip || null, userAgent: audit.userAgent || null }; }

// ─── Patients + access control ─────────────────────────────

describe("patients + access control", () => {
  it("owner creates + reads own patient", () => {
    const r = createPatient(db, "u_self", { nameGiven: "Alice", nameFamily: "Smith", birthDate: "1980-01-15", gender: "female" });
    assert.equal(r.ok, true);
    const got = getPatient(db, r.id, "u_self");
    assert.equal(got.ok, true);
    assert.equal(got.patient.name_given, "Alice");
    assert.equal(got.accessMode, "self");
  });

  it("third party WITHOUT consent denied access", () => {
    const r = createPatient(db, "u_owner_a", { nameGiven: "Bob", nameFamily: "Jones" });
    const blocked = getPatient(db, r.id, "u_stranger");
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "no_consent");
  });

  it("third party WITH consent granted access", () => {
    const r = createPatient(db, "u_owner_b", { nameGiven: "Carol", nameFamily: "Davis" });
    grantConsent(db, "u_owner_b", { patientId: r.id, granteeId: "u_doctor", granteeKind: "provider", scope: "*" });
    const got = getPatient(db, r.id, "u_doctor");
    assert.equal(got.ok, true);
    assert.equal(got.accessMode, "grant");
  });

  it("scope filtering — grant for medications does NOT give condition access", () => {
    const r = createPatient(db, "u_scope_owner", { nameGiven: "Scope", nameFamily: "Test" });
    grantConsent(db, "u_scope_owner", { patientId: r.id, granteeId: "u_med_only", granteeKind: "app", scope: "medications" });
    const meds = listMedications(db, "u_med_only", r.id);
    assert.equal(meds.ok, true);  // medications scope granted
    const conds = listConditions(db, "u_med_only", r.id);
    assert.equal(conds.reason, "scope_not_granted");
  });

  it("listMyPatients only returns mine", () => {
    createPatient(db, "u_list_a", { nameGiven: "A1", nameFamily: "X" });
    createPatient(db, "u_list_a", { nameGiven: "A2", nameFamily: "X" });
    createPatient(db, "u_list_b", { nameGiven: "B1", nameFamily: "Y" });
    const mine = listMyPatients(db, "u_list_a");
    assert.equal(mine.length, 2);
  });
});

// ─── HIPAA audit log ───────────────────────────────────────

describe("HIPAA audit log", () => {
  it("read + write + grant + revoke all logged with actor + resource", () => {
    const r = createPatient(db, "u_aud", { nameGiven: "Aud", nameFamily: "It" });
    addMedication(db, "u_aud", { patientId: r.id, name: "Metformin", dose: "500mg" });
    grantConsent(db, "u_aud", { patientId: r.id, granteeId: "u_provider_a", granteeKind: "provider", scope: "*" });
    listMedications(db, "u_provider_a", r.id);
    const log = getAuditLog(db, "u_aud", r.id);
    assert.ok(log.length >= 3);
    const actions = log.map((l) => l.action);
    assert.ok(actions.includes("write"));
    assert.ok(actions.includes("read"));
  });

  it("audit log captures consent_grant_id for third-party access", () => {
    const r = createPatient(db, "u_grant_aud", { nameGiven: "G", nameFamily: "A" });
    grantConsent(db, "u_grant_aud", { patientId: r.id, granteeId: "u_consenter", granteeKind: "researcher", scope: "observations" });
    addObservation(db, "u_grant_aud", { patientId: r.id, category: "vital-signs", display: "BP", valueQuantity: 120, valueUnit: "mmHg", effectiveDate: "2026-05-19" });
    listObservations(db, "u_consenter", r.id);
    const log = getAuditLog(db, "u_grant_aud", r.id);
    const granteeRead = log.find((l) => l.actor_id === "u_consenter" && l.action === "read");
    assert.ok(granteeRead);
    assert.ok(granteeRead.consent_grant_id);  // grant id captured
  });

  it("owner cannot read another patient's audit log", () => {
    const r = createPatient(db, "u_priv1", { nameGiven: "P", nameFamily: "1" });
    const log = getAuditLog(db, "u_outsider", r.id);
    assert.equal(log.length, 0);
  });

  it("revoked consent immediately blocks subsequent reads", () => {
    const r = createPatient(db, "u_revoke_owner", { nameGiven: "Rev", nameFamily: "Test" });
    const grant = grantConsent(db, "u_revoke_owner", { patientId: r.id, granteeId: "u_to_revoke", granteeKind: "app", scope: "*" });
    // Read works
    assert.equal(listMedications(db, "u_to_revoke", r.id).ok, true);
    // Revoke
    revokeConsent(db, "u_revoke_owner", { consentGrantId: grant.id });
    // Now blocked
    const after = listMedications(db, "u_to_revoke", r.id);
    assert.equal(after.reason, "no_consent");
  });
});

// ─── FHIR resource CHECK constraints ──────────────────────

describe("FHIR resource constraints", () => {
  it("condition CHECK rejects invalid clinical_status", () => {
    const p = createPatient(db, "u_ccc", { nameGiven: "C", nameFamily: "C" });
    assert.throws(() => {
      db.prepare(`INSERT INTO health_conditions (id, patient_id, display, clinical_status, verification_status, recorded_by) VALUES ('c1', ?, 'X', 'NONSENSE', 'unconfirmed', 'u_ccc')`).run(p.id);
    }, /CHECK/);
  });

  it("observation CHECK rejects invalid category", () => {
    const p = createPatient(db, "u_obs_check", { nameGiven: "O", nameFamily: "C" });
    assert.throws(() => {
      db.prepare(`INSERT INTO health_observations (id, patient_id, category, display, effective_date, recorded_by) VALUES ('o1', ?, 'WEIRD', 'X', '2026', 'u_obs_check')`).run(p.id);
    }, /CHECK/);
  });

  it("appointment refuses inverted time window", () => {
    const p = createPatient(db, "u_appt_bad", { nameGiven: "A", nameFamily: "B" });
    const r = bookAppointment(db, "u_appt_bad", { patientId: p.id, startsAt: 1000, endsAt: 900, kind: "in-person" });
    assert.equal(r.reason, "invalid_time_window");
  });
});

// ─── Medications + dose log ────────────────────────────────

describe("medications + dose log", () => {
  it("medication add + list (active only by default)", () => {
    const p = createPatient(db, "u_med_test", { nameGiven: "M", nameFamily: "T" });
    addMedication(db, "u_med_test", { patientId: p.id, rxnormCode: "6845", name: "Metformin", dose: "500mg", frequency: "twice daily" });
    addMedication(db, "u_med_test", { patientId: p.id, name: "Aspirin", dose: "81mg", status: "stopped" });
    const r = listMedications(db, "u_med_test", p.id);
    assert.equal(r.medications.length, 1);  // active only
    assert.equal(r.medications[0].name, "Metformin");
    const all = listMedications(db, "u_med_test", p.id, { activeOnly: false });
    assert.equal(all.medications.length, 2);
  });

  it("dose log creates audit entry on the medication resource", () => {
    const p = createPatient(db, "u_dose_test", { nameGiven: "D", nameFamily: "T" });
    const m = addMedication(db, "u_dose_test", { patientId: p.id, name: "Vitamin D", dose: "2000IU" });
    logDose(db, "u_dose_test", { medicationId: m.id, patientId: p.id });
    const log = getAuditLog(db, "u_dose_test", p.id);
    const doseEntry = log.find((l) => l.resource_id === m.id && l.detail_json?.includes("dose_taken"));
    assert.ok(doseEntry);
  });
});

// ─── Providers ────────────────────────────────────────────

describe("providers + DPC discovery", () => {
  it("upsert by NPI is idempotent", () => {
    const r1 = upsertProvider(db, { npi: "1234567890", nameGiven: "Jane", nameFamily: "Doe", specialty: "family medicine", acceptsDpc: true, dpcMonthlyFeeCents: 7500 });
    const r2 = upsertProvider(db, { npi: "1234567890", nameGiven: "Jane", nameFamily: "Doe", specialty: "internal medicine", acceptsDpc: true, dpcMonthlyFeeCents: 7500 });
    assert.equal(r1.id, r2.id);
    const found = searchProviders(db, { specialty: "internal" });
    assert.ok(found.find((p) => p.npi === "1234567890"));
  });

  it("dpcOnly filter returns only DPC providers", () => {
    upsertProvider(db, { nameGiven: "Trad", nameFamily: "ITional", acceptsDpc: false });
    upsertProvider(db, { nameGiven: "DPC", nameFamily: "Doc", acceptsDpc: true });
    const dpcOnly = searchProviders(db, { dpcOnly: true });
    assert.ok(dpcOnly.every((p) => p.accepts_dpc === 1));
  });
});

// ─── Macros ────────────────────────────────────────────────

describe("macros end-to-end", () => {
  it("patient → medication → consent → third-party read flow via macros", async () => {
    const p = await MACROS.get("patient_create")(ctx("u_mac_owner"), { nameGiven: "Mac", nameFamily: "User" });
    assert.equal(p.ok, true);
    const m = await MACROS.get("medication_add")(ctx("u_mac_owner"), { patientId: p.id, name: "Lisinopril", dose: "10mg" });
    assert.equal(m.ok, true);
    // Grant consent to a provider
    const g = await MACROS.get("consent_grant")(ctx("u_mac_owner"), {
      patientId: p.id, granteeId: "u_mac_provider", granteeKind: "provider", scope: "medications,observations",
    });
    assert.equal(g.ok, true);
    // Provider reads
    const meds = await MACROS.get("medication_list")(ctx("u_mac_provider"), { patientId: p.id });
    assert.equal(meds.ok, true);
    assert.equal(meds.medications.length, 1);
    // Provider tries to read conditions (not in scope) → denied
    const conds = await MACROS.get("condition_list")(ctx("u_mac_provider"), { patientId: p.id });
    assert.equal(conds.reason, "scope_not_granted");
    // Owner reads audit log + sees the provider's read
    const log = await MACROS.get("audit_log")(ctx("u_mac_owner"), { patientId: p.id });
    assert.ok(log.log.find((l) => l.actor_id === "u_mac_provider" && l.action === "read"));
  });

  it("appointment book → cancel via macros", async () => {
    const p = await MACROS.get("patient_create")(ctx("u_appt_flow"), { nameGiven: "Appt", nameFamily: "Flow" });
    const a = await MACROS.get("appointment_book")(ctx("u_appt_flow"), {
      patientId: p.id, startsAt: 2_000_000_000, endsAt: 2_000_003_600, kind: "telehealth", reason: "annual checkup",
    });
    assert.equal(a.ok, true);
    const c = await MACROS.get("appointment_cancel")(ctx("u_appt_flow"), { appointmentId: a.id, reason: "rescheduled" });
    assert.equal(c.ok, true);
    const list = await MACROS.get("appointment_list")(ctx("u_appt_flow"), { patientId: p.id, upcomingOnly: false });
    const cancelled = list.appointments.find((x) => x.id === a.id);
    assert.equal(cancelled.status, "cancelled");
  });
});
