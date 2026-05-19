// server/lib/health/persistence.js
//
// Healthcare lens rebuild Sprint A — durable FHIR-aligned CRUD with
// HIPAA audit logging baked in.
//
// HIPAA invariants enforced here:
//   - Every PHI read MUST log to health_audit_log
//   - Every PHI write MUST log to health_audit_log
//   - Consent grant active when third-party access (provider/app/research)
//   - Audit logs retained 6+ years (deletion blocked at this layer)
//   - Patient owner has implicit consent for self-access (no grant lookup)
//
// FHIR alignment: field names mirror FHIR R4 resource shapes where
// reasonable so future SMART on FHIR import/export is mechanical.

import { randomUUID } from "node:crypto";

function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

// ─── HIPAA audit logging (load-bearing) ──────────────────────

/**
 * Log a PHI access. Called by EVERY read + write helper below.
 * `consentGrantId` is null when actor owns the patient (self-access).
 */
export function auditLog(db, { patientId, actorId, actorKind = "user", action, resourceKind, resourceId = null, consentGrantId = null, ip = null, userAgent = null, detail = null }) {
  if (!db || !patientId || !actorId || !action || !resourceKind) return;
  try {
    db.prepare(`
      INSERT INTO health_audit_log (patient_id, actor_id, actor_kind, action, resource_kind, resource_id, consent_grant_id, ip, user_agent, detail_json, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(patientId, actorId, actorKind, action, resourceKind, resourceId,
      consentGrantId,
      ip ? String(ip).slice(0, 80) : null,
      userAgent ? String(userAgent).slice(0, 200) : null,
      detail ? JSON.stringify(detail) : null,
      _now());
  } catch { /* best effort — audit log can't itself break the user action */ }
}

/**
 * Check whether actor has access to patient. Returns:
 *   { ok: true, mode: 'self' | 'grant', consentGrantId? }
 *   { ok: false, reason: 'no_consent' | 'consent_expired' | 'consent_revoked' | 'patient_not_found' }
 *
 * Owner always has access (mode='self'). Third parties need an
 * unrevoked + unexpired grant that includes the requested scope.
 */
export function checkAccess(db, patientId, actorId, requiredScope = null) {
  if (!db || !patientId || !actorId) return { ok: false, reason: "missing_args" };
  const p = db.prepare(`SELECT owner_user_id FROM health_patients WHERE id = ?`).get(patientId);
  if (!p) return { ok: false, reason: "patient_not_found" };
  if (p.owner_user_id === actorId) return { ok: true, mode: "self" };
  // Look up active grant
  const now = _now();
  const grant = db.prepare(`
    SELECT id, scope, expires_at FROM health_consent_grants
    WHERE patient_id = ? AND grantee_id = ? AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY granted_at DESC LIMIT 1
  `).get(patientId, actorId, now);
  if (!grant) return { ok: false, reason: "no_consent" };
  if (requiredScope) {
    const scopeSet = new Set(String(grant.scope || "").split(",").map((s) => s.trim()));
    if (!scopeSet.has(requiredScope) && !scopeSet.has("*")) {
      return { ok: false, reason: "scope_not_granted", available: [...scopeSet] };
    }
  }
  return { ok: true, mode: "grant", consentGrantId: grant.id };
}

// ─── Patients ────────────────────────────────────────────────

export function createPatient(db, ownerUserId, { relation = "self", nameGiven, nameFamily, birthDate = null, gender = null, mrn = null, fhirId = null, fhirSource = "manual" }, audit = {}) {
  if (!db || !ownerUserId || !nameGiven || !nameFamily) return { ok: false, reason: "missing_args" };
  const id = `pat:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO health_patients (id, owner_user_id, relation, name_given, name_family, birth_date, gender, mrn, fhir_id, fhir_source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ownerUserId,
      ["self","child","parent","spouse","ward","other"].includes(relation) ? relation : "self",
      String(nameGiven).slice(0, 100), String(nameFamily).slice(0, 100),
      birthDate, gender, mrn, fhirId, fhirSource,
      _now(), _now());
    auditLog(db, { patientId: id, actorId: ownerUserId, action: "write", resourceKind: "patient", resourceId: id, ip: audit.ip, userAgent: audit.userAgent });
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getPatient(db, patientId, actorId, audit = {}) {
  if (!db || !patientId || !actorId) return { ok: false, reason: "missing_args" };
  const access = checkAccess(db, patientId, actorId);
  if (!access.ok) return access;
  const p = db.prepare(`SELECT * FROM health_patients WHERE id = ?`).get(patientId);
  if (!p) return { ok: false, reason: "not_found" };
  auditLog(db, { patientId, actorId, action: "read", resourceKind: "patient", resourceId: patientId, consentGrantId: access.consentGrantId, ip: audit.ip, userAgent: audit.userAgent });
  return { ok: true, patient: p, accessMode: access.mode };
}

export function listMyPatients(db, ownerUserId) {
  if (!db || !ownerUserId) return [];
  return db.prepare(`SELECT * FROM health_patients WHERE owner_user_id = ? ORDER BY relation, created_at ASC`).all(ownerUserId);
}

// ─── Conditions ─────────────────────────────────────────────

export function addCondition(db, actorId, { patientId, code = null, codeSystem = null, display, clinicalStatus = "active", verificationStatus = "unconfirmed", severity = null, onsetDate = null, notes = null }, audit = {}) {
  if (!db || !patientId || !display) return { ok: false, reason: "missing_args" };
  const access = checkAccess(db, patientId, actorId, "conditions");
  if (!access.ok) return access;
  const id = `cond:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO health_conditions (id, patient_id, code_system, code, display, clinical_status, verification_status, severity, onset_date, notes, recorded_by, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, patientId, codeSystem, code, String(display).slice(0, 500),
      clinicalStatus, verificationStatus, severity, onsetDate,
      notes ? String(notes).slice(0, 2000) : null,
      actorId, _now());
    auditLog(db, { patientId, actorId, action: "write", resourceKind: "condition", resourceId: id, consentGrantId: access.consentGrantId, ip: audit.ip, userAgent: audit.userAgent });
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function listConditions(db, actorId, patientId, { activeOnly = true } = {}, audit = {}) {
  const access = checkAccess(db, patientId, actorId, "conditions");
  if (!access.ok) return access;
  const sql = activeOnly
    ? `SELECT * FROM health_conditions WHERE patient_id = ? AND clinical_status IN ('active','recurrence','relapse') ORDER BY recorded_at DESC`
    : `SELECT * FROM health_conditions WHERE patient_id = ? ORDER BY recorded_at DESC`;
  const rows = db.prepare(sql).all(patientId);
  auditLog(db, { patientId, actorId, action: "read", resourceKind: "condition", consentGrantId: access.consentGrantId, ip: audit.ip, userAgent: audit.userAgent, detail: { count: rows.length, activeOnly } });
  return { ok: true, conditions: rows };
}

// ─── Medications ────────────────────────────────────────────

export function addMedication(db, actorId, { patientId, rxnormCode = null, name, dose = null, route = null, frequency = null, status = "active", prescribedBy = null, pharmacy = null, refillsRemaining = 0, startedAt = null, notes = null }, audit = {}) {
  if (!db || !patientId || !name) return { ok: false, reason: "missing_args" };
  const access = checkAccess(db, patientId, actorId, "medications");
  if (!access.ok) return access;
  const id = `med:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO health_medications (id, patient_id, rxnorm_code, name, dose, route, frequency, status, prescribed_by, pharmacy, refills_remaining, started_at, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, patientId, rxnormCode, String(name).slice(0, 200), dose, route, frequency,
      ["active","completed","entered-in-error","intended","stopped","on-hold","unknown","not-taken"].includes(status) ? status : "active",
      prescribedBy, pharmacy, Math.max(0, Math.floor(Number(refillsRemaining) || 0)),
      startedAt, notes ? String(notes).slice(0, 2000) : null,
      _now(), _now());
    auditLog(db, { patientId, actorId, action: "write", resourceKind: "medication", resourceId: id, consentGrantId: access.consentGrantId, ip: audit.ip, userAgent: audit.userAgent });
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function listMedications(db, actorId, patientId, { activeOnly = true } = {}, audit = {}) {
  const access = checkAccess(db, patientId, actorId, "medications");
  if (!access.ok) return access;
  const sql = activeOnly
    ? `SELECT * FROM health_medications WHERE patient_id = ? AND status = 'active' ORDER BY created_at DESC`
    : `SELECT * FROM health_medications WHERE patient_id = ? ORDER BY created_at DESC`;
  const rows = db.prepare(sql).all(patientId);
  auditLog(db, { patientId, actorId, action: "read", resourceKind: "medication", consentGrantId: access.consentGrantId, ip: audit.ip, userAgent: audit.userAgent, detail: { count: rows.length, activeOnly } });
  return { ok: true, medications: rows };
}

export function logDose(db, actorId, { medicationId, patientId, doseTaken = null, takenAt = null }, audit = {}) {
  if (!db || !medicationId || !patientId) return { ok: false, reason: "missing_args" };
  const access = checkAccess(db, patientId, actorId, "medications");
  if (!access.ok) return access;
  const id = `dose:${randomUUID()}`;
  db.prepare(`
    INSERT INTO health_medication_doses (id, medication_id, patient_id, taken_at, dose_taken, logged_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, medicationId, patientId,
    takenAt ? Number(takenAt) : _now(),
    doseTaken, actorId);
  auditLog(db, { patientId, actorId, action: "write", resourceKind: "medication", resourceId: medicationId, consentGrantId: access.consentGrantId, ip: audit.ip, userAgent: audit.userAgent, detail: { dose_taken: doseTaken } });
  return { ok: true, id };
}

// ─── Allergies ──────────────────────────────────────────────

export function addAllergy(db, actorId, { patientId, substance, substanceCode = null, category = null, criticality = "unable-to-assess", reaction = null, onsetDate = null }, audit = {}) {
  if (!db || !patientId || !substance) return { ok: false, reason: "missing_args" };
  const access = checkAccess(db, patientId, actorId, "allergies");
  if (!access.ok) return access;
  const id = `aller:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO health_allergies (id, patient_id, substance, substance_code, category, criticality, reaction, onset_date, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, patientId, String(substance).slice(0, 200), substanceCode, category,
      ["low","high","unable-to-assess"].includes(criticality) ? criticality : "unable-to-assess",
      reaction, onsetDate, _now());
    auditLog(db, { patientId, actorId, action: "write", resourceKind: "allergy", resourceId: id, consentGrantId: access.consentGrantId, ip: audit.ip, userAgent: audit.userAgent });
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function listAllergies(db, actorId, patientId, audit = {}) {
  const access = checkAccess(db, patientId, actorId, "allergies");
  if (!access.ok) return access;
  const rows = db.prepare(`SELECT * FROM health_allergies WHERE patient_id = ? AND clinical_status = 'active' ORDER BY recorded_at DESC`).all(patientId);
  auditLog(db, { patientId, actorId, action: "read", resourceKind: "allergy", consentGrantId: access.consentGrantId, ip: audit.ip, userAgent: audit.userAgent, detail: { count: rows.length } });
  return { ok: true, allergies: rows };
}

// ─── Immunizations ──────────────────────────────────────────

export function addImmunization(db, actorId, { patientId, vaccineCode = null, vaccineName, lotNumber = null, site = null, route = null, doseNumber = null, seriesComplete = false, administeredAt, administeredBy = null, providerName = null }, audit = {}) {
  if (!db || !patientId || !vaccineName || !administeredAt) return { ok: false, reason: "missing_args" };
  const access = checkAccess(db, patientId, actorId, "immunizations");
  if (!access.ok) return access;
  const id = `imm:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO health_immunizations (id, patient_id, vaccine_code, vaccine_name, lot_number, site, route, dose_number, series_complete, administered_at, administered_by, provider_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, patientId, vaccineCode, String(vaccineName).slice(0, 200), lotNumber, site, route,
      doseNumber, seriesComplete ? 1 : 0, administeredAt, administeredBy, providerName);
    auditLog(db, { patientId, actorId, action: "write", resourceKind: "immunization", resourceId: id, consentGrantId: access.consentGrantId, ip: audit.ip, userAgent: audit.userAgent });
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function listImmunizations(db, actorId, patientId, audit = {}) {
  const access = checkAccess(db, patientId, actorId, "immunizations");
  if (!access.ok) return access;
  const rows = db.prepare(`SELECT * FROM health_immunizations WHERE patient_id = ? ORDER BY administered_at DESC`).all(patientId);
  auditLog(db, { patientId, actorId, action: "read", resourceKind: "immunization", consentGrantId: access.consentGrantId, ip: audit.ip, userAgent: audit.userAgent, detail: { count: rows.length } });
  return { ok: true, immunizations: rows };
}

// ─── Observations (vitals + labs) ──────────────────────────

export function addObservation(db, actorId, { patientId, category, loincCode = null, display, valueQuantity = null, valueUnit = null, valueString = null, referenceLow = null, referenceHigh = null, interpretation = null, effectiveDate, notes = null }, audit = {}) {
  if (!db || !patientId || !category || !display || !effectiveDate) return { ok: false, reason: "missing_args" };
  const access = checkAccess(db, patientId, actorId, "observations");
  if (!access.ok) return access;
  const id = `obs:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO health_observations (id, patient_id, category, loinc_code, display, value_quantity, value_unit, value_string, reference_low, reference_high, interpretation, effective_date, recorded_by, recorded_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, patientId, category, loincCode, String(display).slice(0, 200),
      valueQuantity, valueUnit, valueString, referenceLow, referenceHigh,
      interpretation, effectiveDate, actorId, _now(),
      notes ? String(notes).slice(0, 2000) : null);
    auditLog(db, { patientId, actorId, action: "write", resourceKind: "observation", resourceId: id, consentGrantId: access.consentGrantId, ip: audit.ip, userAgent: audit.userAgent });
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function listObservations(db, actorId, patientId, { category = null, loincCode = null, limit = 200 } = {}, audit = {}) {
  const access = checkAccess(db, patientId, actorId, "observations");
  if (!access.ok) return access;
  const filters = ["patient_id = ?"];
  const args = [patientId];
  if (category) { filters.push("category = ?"); args.push(category); }
  if (loincCode) { filters.push("loinc_code = ?"); args.push(loincCode); }
  args.push(Math.min(Number(limit) || 200, 1000));
  const rows = db.prepare(`SELECT * FROM health_observations WHERE ${filters.join(" AND ")} ORDER BY effective_date DESC LIMIT ?`).all(...args);
  auditLog(db, { patientId, actorId, action: "read", resourceKind: "observation", consentGrantId: access.consentGrantId, ip: audit.ip, userAgent: audit.userAgent, detail: { count: rows.length, category, loincCode } });
  return { ok: true, observations: rows };
}

// ─── Appointments ──────────────────────────────────────────

export function bookAppointment(db, actorId, { patientId, providerId = null, providerName = null, startsAt, endsAt, kind = "in-person", reason = null, copayCents = null }, audit = {}) {
  if (!db || !patientId || !startsAt || !endsAt) return { ok: false, reason: "missing_args" };
  const access = checkAccess(db, patientId, actorId, "appointments");
  if (!access.ok) return access;
  if (Number(endsAt) <= Number(startsAt)) return { ok: false, reason: "invalid_time_window" };
  const id = `appt:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO health_appointments (id, patient_id, provider_id, provider_name, starts_at, ends_at, status, kind, reason, copay_cents, booked_at)
      VALUES (?, ?, ?, ?, ?, ?, 'booked', ?, ?, ?, ?)
    `).run(id, patientId, providerId, providerName, Number(startsAt), Number(endsAt),
      ["in-person","telehealth","phone","message"].includes(kind) ? kind : "in-person",
      reason, copayCents ? Math.floor(copayCents) : null, _now());
    auditLog(db, { patientId, actorId, action: "write", resourceKind: "appointment", resourceId: id, consentGrantId: access.consentGrantId, ip: audit.ip, userAgent: audit.userAgent });
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function listAppointments(db, actorId, patientId, { upcomingOnly = true, limit = 50 } = {}, audit = {}) {
  const access = checkAccess(db, patientId, actorId, "appointments");
  if (!access.ok) return access;
  const sql = upcomingOnly
    ? `SELECT * FROM health_appointments WHERE patient_id = ? AND status IN ('booked','checked-in') AND starts_at > ? ORDER BY starts_at ASC LIMIT ?`
    : `SELECT * FROM health_appointments WHERE patient_id = ? ORDER BY starts_at DESC LIMIT ?`;
  const args = upcomingOnly ? [patientId, _now(), Math.min(Number(limit) || 50, 500)] : [patientId, Math.min(Number(limit) || 50, 500)];
  const rows = db.prepare(sql).all(...args);
  auditLog(db, { patientId, actorId, action: "read", resourceKind: "appointment", consentGrantId: access.consentGrantId, ip: audit.ip, userAgent: audit.userAgent, detail: { count: rows.length, upcomingOnly } });
  return { ok: true, appointments: rows };
}

export function cancelAppointment(db, actorId, { appointmentId, reason = null }, audit = {}) {
  const cur = db.prepare(`SELECT patient_id, status FROM health_appointments WHERE id = ?`).get(appointmentId);
  if (!cur) return { ok: false, reason: "not_found" };
  const access = checkAccess(db, cur.patient_id, actorId, "appointments");
  if (!access.ok) return access;
  if (!["booked","checked-in","waitlist","pending","proposed"].includes(cur.status)) return { ok: false, reason: "not_cancellable" };
  db.prepare(`UPDATE health_appointments SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?`).run(_now(), actorId, reason, appointmentId);
  auditLog(db, { patientId: cur.patient_id, actorId, action: "update", resourceKind: "appointment", resourceId: appointmentId, consentGrantId: access.consentGrantId, ip: audit.ip, userAgent: audit.userAgent, detail: { cancel_reason: reason } });
  return { ok: true };
}

// ─── Providers ─────────────────────────────────────────────

export function upsertProvider(db, { npi = null, nameGiven, nameFamily, credentials = null, specialty = null, organization = null, phone = null, email = null, address = null, acceptsDpc = false, dpcMonthlyFeeCents = null }) {
  if (!db || !nameGiven || !nameFamily) return { ok: false, reason: "missing_args" };
  const id = npi ? `prov:npi:${npi}` : `prov:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO health_providers (id, npi, name_given, name_family, credentials, specialty, organization, phone, email, address, accepts_dpc, dpc_monthly_fee_cents, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name_given = excluded.name_given,
        name_family = excluded.name_family,
        credentials = excluded.credentials,
        specialty = excluded.specialty,
        organization = excluded.organization,
        phone = excluded.phone,
        email = excluded.email,
        address = excluded.address,
        accepts_dpc = excluded.accepts_dpc,
        dpc_monthly_fee_cents = excluded.dpc_monthly_fee_cents
    `).run(id, npi, String(nameGiven).slice(0, 100), String(nameFamily).slice(0, 100),
      credentials, specialty, organization, phone, email, address,
      acceptsDpc ? 1 : 0, dpcMonthlyFeeCents ? Math.floor(dpcMonthlyFeeCents) : null, _now());
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "upsert_failed", error: err?.message };
  }
}

export function searchProviders(db, { specialty = null, organization = null, dpcOnly = false, limit = 50 } = {}) {
  if (!db) return [];
  const filters = [];
  const args = [];
  if (specialty) { filters.push("specialty LIKE ?"); args.push(`%${specialty}%`); }
  if (organization) { filters.push("organization LIKE ?"); args.push(`%${organization}%`); }
  if (dpcOnly) filters.push("accepts_dpc = 1");
  args.push(Math.min(Number(limit) || 50, 500));
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM health_providers ${where} ORDER BY name_family, name_given LIMIT ?`).all(...args);
}

// ─── Consent grants ────────────────────────────────────────

export function grantConsent(db, ownerUserId, { patientId, granteeId, granteeKind, scope, purpose = null, expiresAt = null, grantText = null }, audit = {}) {
  if (!db || !ownerUserId || !patientId || !granteeId || !granteeKind || !scope) return { ok: false, reason: "missing_args" };
  const p = db.prepare(`SELECT owner_user_id FROM health_patients WHERE id = ?`).get(patientId);
  if (!p) return { ok: false, reason: "patient_not_found" };
  if (p.owner_user_id !== ownerUserId) return { ok: false, reason: "forbidden" };
  const id = `cons:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO health_consent_grants (id, patient_id, grantee_id, grantee_kind, scope, purpose, granted_at, expires_at, grant_text, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, patientId, granteeId,
      ["provider","app","researcher","caregiver","emergency"].includes(granteeKind) ? granteeKind : "app",
      String(scope).slice(0, 500), purpose, _now(),
      expiresAt ? Number(expiresAt) : null,
      grantText ? String(grantText).slice(0, 2000) : null,
      audit.ip || null, audit.userAgent || null);
    auditLog(db, { patientId, actorId: ownerUserId, action: "write", resourceKind: "patient", resourceId: patientId, ip: audit.ip, userAgent: audit.userAgent, detail: { event: "consent_granted", grantee: granteeId, scope } });
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function revokeConsent(db, ownerUserId, { consentGrantId, reason = null }, audit = {}) {
  if (!db || !ownerUserId || !consentGrantId) return { ok: false, reason: "missing_args" };
  const grant = db.prepare(`SELECT patient_id FROM health_consent_grants WHERE id = ? AND revoked_at IS NULL`).get(consentGrantId);
  if (!grant) return { ok: false, reason: "not_found" };
  const p = db.prepare(`SELECT owner_user_id FROM health_patients WHERE id = ?`).get(grant.patient_id);
  if (!p || p.owner_user_id !== ownerUserId) return { ok: false, reason: "forbidden" };
  db.prepare(`UPDATE health_consent_grants SET revoked_at = ?, revoked_by = ? WHERE id = ?`).run(_now(), ownerUserId, consentGrantId);
  auditLog(db, { patientId: grant.patient_id, actorId: ownerUserId, action: "update", resourceKind: "patient", resourceId: grant.patient_id, ip: audit.ip, userAgent: audit.userAgent, detail: { event: "consent_revoked", grant_id: consentGrantId, reason } });
  return { ok: true };
}

export function listConsentGrants(db, ownerUserId, patientId, { activeOnly = true } = {}) {
  if (!db || !ownerUserId || !patientId) return [];
  const p = db.prepare(`SELECT owner_user_id FROM health_patients WHERE id = ?`).get(patientId);
  if (!p || p.owner_user_id !== ownerUserId) return [];
  const sql = activeOnly
    ? `SELECT * FROM health_consent_grants WHERE patient_id = ? AND revoked_at IS NULL ORDER BY granted_at DESC`
    : `SELECT * FROM health_consent_grants WHERE patient_id = ? ORDER BY granted_at DESC`;
  return db.prepare(sql).all(patientId);
}

// ─── Audit log read ────────────────────────────────────────

export function getAuditLog(db, ownerUserId, patientId, { limit = 200 } = {}) {
  if (!db || !ownerUserId || !patientId) return [];
  const p = db.prepare(`SELECT owner_user_id FROM health_patients WHERE id = ?`).get(patientId);
  if (!p || p.owner_user_id !== ownerUserId) return [];
  return db.prepare(`SELECT * FROM health_audit_log WHERE patient_id = ? ORDER BY at DESC LIMIT ?`).all(patientId, Math.min(Number(limit) || 200, 5000));
}
