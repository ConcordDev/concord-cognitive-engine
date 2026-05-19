// server/domains/healthcare-rebuild.js
//
// Healthcare lens Sprint A — register()-pattern macros sitting
// alongside the legacy registerLensAction macros in
// server/domains/healthcare.js (which cover symptom-triage,
// drug interaction, SOAP, vision, MyChart-style record exports).
//
// This file adds the durable FHIR-aligned substrate + HIPAA-compliant
// consent layer + audit log.

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
  getAuditLog,
} from "../lib/health/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _audit(ctx) { return { ip: ctx?.req?.ip || ctx?.ip || null, userAgent: ctx?.req?.headers?.["user-agent"] || ctx?.userAgent || null }; }

export default function registerHealthRebuildMacros(register) {

  // ─── Patients ──────────────────────────────────────────────

  register("healthcare", "patient_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return createPatient(db, userId, input, _audit(ctx));
  }, { destructive: true, note: "Create a patient record (self or caregiver-relationship). Always audit-logged." });

  register("healthcare", "patient_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return getPatient(db, String(input.patientId || input.id || ""), userId, _audit(ctx));
  }, { note: "Get a patient. Requires owner self-access OR active consent grant. Logged to audit." });

  register("healthcare", "patient_list_mine", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, patients: listMyPatients(db, userId) };
  }, { note: "List patients I own (self + dependents)" });

  // ─── Conditions ────────────────────────────────────────────

  register("healthcare", "condition_add", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return addCondition(db, userId, input, _audit(ctx));
  }, { destructive: true, note: "Add a condition (ICD-10 / SNOMED / manual). Consent + audit enforced." });

  register("healthcare", "condition_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return listConditions(db, userId, String(input.patientId || ""), { activeOnly: input.activeOnly !== false }, _audit(ctx));
  }, { note: "List patient conditions (active only by default). Consent + audit enforced." });

  // ─── Medications ──────────────────────────────────────────

  register("healthcare", "medication_add", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return addMedication(db, userId, input, _audit(ctx));
  }, { destructive: true, note: "Add a medication (rxnorm code preferred). Consent + audit enforced." });

  register("healthcare", "medication_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return listMedications(db, userId, String(input.patientId || ""), { activeOnly: input.activeOnly !== false }, _audit(ctx));
  }, { note: "List patient medications (active only by default)" });

  register("healthcare", "dose_log", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return logDose(db, userId, input, _audit(ctx));
  }, { destructive: true, note: "Log that a medication dose was taken" });

  // ─── Allergies ────────────────────────────────────────────

  register("healthcare", "allergy_add", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return addAllergy(db, userId, input, _audit(ctx));
  }, { destructive: true, note: "Add an allergy (food / medication / environment / biologic)" });

  register("healthcare", "allergy_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return listAllergies(db, userId, String(input.patientId || ""), _audit(ctx));
  }, { note: "List active allergies. Used by drug-interaction macro for cross-checking." });

  // ─── Immunizations ────────────────────────────────────────

  register("healthcare", "immunization_add", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return addImmunization(db, userId, input, _audit(ctx));
  }, { destructive: true, note: "Record a vaccination" });

  register("healthcare", "immunization_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return listImmunizations(db, userId, String(input.patientId || ""), _audit(ctx));
  }, { note: "List vaccinations chronologically" });

  // ─── Observations (vitals + labs) ─────────────────────────

  register("healthcare", "observation_add", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return addObservation(db, userId, input, _audit(ctx));
  }, { destructive: true, note: "Record a vital sign or lab result. LOINC code preferred." });

  register("healthcare", "observation_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return listObservations(db, userId, String(input.patientId || ""), { category: input.category, loincCode: input.loincCode, limit: input.limit }, _audit(ctx));
  }, { note: "List observations filterable by category (vital-signs/laboratory/...) or LOINC code" });

  // ─── Appointments ─────────────────────────────────────────

  register("healthcare", "appointment_book", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return bookAppointment(db, userId, input, _audit(ctx));
  }, { destructive: true, note: "Book an appointment (in-person/telehealth/phone/message)" });

  register("healthcare", "appointment_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return listAppointments(db, userId, String(input.patientId || ""), { upcomingOnly: input.upcomingOnly !== false, limit: input.limit }, _audit(ctx));
  }, { note: "List appointments (upcoming by default)" });

  register("healthcare", "appointment_cancel", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return cancelAppointment(db, userId, input, _audit(ctx));
  }, { destructive: true, note: "Cancel an appointment with reason" });

  // ─── Providers (DPC discovery) ────────────────────────────

  register("healthcare", "provider_upsert", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return upsertProvider(db, input);
  }, { destructive: true, note: "Add/update a provider in the directory (NPI-keyed when available)" });

  register("healthcare", "provider_search", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, providers: searchProviders(db, input) };
  }, { note: "Search providers by specialty / organization / dpcOnly filter" });

  // ─── Consent layer (HIPAA) ────────────────────────────────

  register("healthcare", "consent_grant", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return grantConsent(db, userId, input, _audit(ctx));
  }, { destructive: true, note: "Grant a third party (provider/app/researcher/caregiver) consent to access specific scope of patient data. HIPAA-compliant: grant_text + ip + user-agent stored." });

  register("healthcare", "consent_revoke", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return revokeConsent(db, userId, input, _audit(ctx));
  }, { destructive: true, note: "Revoke a previously-granted consent. HIPAA: revocation actionable without delay." });

  register("healthcare", "consent_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, grants: listConsentGrants(db, userId, String(input.patientId || ""), { activeOnly: input.activeOnly !== false }) };
  }, { note: "List my patient's active consent grants (who has access to what)" });

  // ─── Audit log ────────────────────────────────────────────

  register("healthcare", "audit_log", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, log: getAuditLog(db, userId, String(input.patientId || ""), { limit: input.limit }) };
  }, { note: "HIPAA audit log for one of my patients. Shows every PHI access with who/when/what." });
}
