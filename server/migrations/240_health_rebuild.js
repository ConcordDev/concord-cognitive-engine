// server/migrations/240_health_rebuild.js
//
// Healthcare lens rebuild Sprint A — durable FHIR-aligned substrate.
//
// RESEARCH GROUNDING (May 2026):
//   - FHIR R4 + R5 are the mandated standards. HTI-1 final rule
//     effective Jan 15 2025. USCDI v3 baseline Jan 1 2026.
//   - CommonHealth supports 7 core FHIR resource types: allergies,
//     conditions, immunizations, lab results, medications,
//     procedures, vitals. These are the substrate.
//   - HIPAA Security Rule + 2025 AI updates require audit logs for:
//     who accessed PHI, when, what actions, what data, prompt
//     content for AI runs, model versions, 6+ year retention.
//   - 21st Century Cures Act mandates open FHIR APIs. Concord must
//     speak FHIR for both import (from Epic/Cerner) and export
//     (to Apple Health Records / CommonHealth).
//
// Pre-this-migration the healthcare lens stored everything in
// STATE.healthLens.{medications,records,appointments,doseLog} Maps
// with no FHIR-aligned schema. This migration ships a CommonHealth-
// shape substrate with HIPAA audit logging baked in.

export function up(db) {
  // health_patients ──────────────────────────────────────────────
  // FHIR Patient resource. Per-user with caregiver_mode flag so a
  // user can manage multiple patients (kids, aging parents).
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_patients (
      id              TEXT PRIMARY KEY,
      owner_user_id   TEXT NOT NULL,                       -- who can read/write this patient's data
      relation        TEXT NOT NULL DEFAULT 'self'
                      CHECK (relation IN ('self','child','parent','spouse','ward','other')),
      name_given      TEXT NOT NULL,
      name_family     TEXT NOT NULL,
      birth_date      TEXT,                                -- ISO date
      gender          TEXT
                      CHECK (gender IS NULL OR gender IN ('male','female','other','unknown')),
      mrn             TEXT,                                -- medical record number (provider-assigned)
      fhir_id         TEXT,                                -- if imported from a FHIR source
      fhir_source     TEXT,                                -- 'epic','cerner','athena','manual','apple_health','common_health'
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_hpat_owner ON health_patients(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_hpat_fhir ON health_patients(fhir_id) WHERE fhir_id IS NOT NULL;
  `);

  // health_conditions ──────────────────────────────────────────
  // FHIR Condition resource.
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_conditions (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,
      code_system     TEXT,                                -- 'icd-10','snomed','manual'
      code            TEXT,                                -- e.g. 'E11.9' for type 2 diabetes
      display         TEXT NOT NULL,                       -- human-readable label
      clinical_status TEXT NOT NULL DEFAULT 'active'
                      CHECK (clinical_status IN ('active','recurrence','relapse','inactive','remission','resolved')),
      verification_status TEXT NOT NULL DEFAULT 'unconfirmed'
                          CHECK (verification_status IN ('unconfirmed','provisional','differential','confirmed','refuted','entered-in-error')),
      severity        TEXT
                      CHECK (severity IS NULL OR severity IN ('mild','moderate','severe')),
      onset_date      TEXT,
      abatement_date  TEXT,
      notes           TEXT,
      recorded_by     TEXT NOT NULL,
      recorded_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hcond_patient ON health_conditions(patient_id, clinical_status, recorded_at DESC);
  `);

  // health_medications ─────────────────────────────────────────
  // FHIR MedicationStatement / MedicationRequest resource.
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_medications (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,
      rxnorm_code     TEXT,                                -- RxNorm RXCUI (e.g. '6845' for metformin)
      name            TEXT NOT NULL,
      dose            TEXT,                                -- '500 mg'
      route           TEXT,                                -- 'oral','iv','topical'
      frequency       TEXT,                                -- 'twice daily'
      status          TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','completed','entered-in-error','intended','stopped','on-hold','unknown','not-taken')),
      prescribed_by   TEXT,
      pharmacy        TEXT,
      refills_remaining INTEGER NOT NULL DEFAULT 0,
      started_at      TEXT,
      ended_at        TEXT,
      notes           TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hmed_patient ON health_medications(patient_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hmed_rxnorm ON health_medications(rxnorm_code) WHERE rxnorm_code IS NOT NULL;
  `);

  // health_medication_doses ────────────────────────────────────
  // Dose-taken log (was STATE.healthLens.doseLog).
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_medication_doses (
      id              TEXT PRIMARY KEY,
      medication_id   TEXT NOT NULL,
      patient_id      TEXT NOT NULL,
      taken_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      dose_taken      TEXT,                                -- if different from prescribed
      logged_by       TEXT NOT NULL,
      FOREIGN KEY (medication_id) REFERENCES health_medications(id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hdose_med ON health_medication_doses(medication_id, taken_at DESC);
  `);

  // health_allergies ───────────────────────────────────────────
  // FHIR AllergyIntolerance.
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_allergies (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,
      substance       TEXT NOT NULL,                       -- 'penicillin','peanuts'
      substance_code  TEXT,                                -- RxNorm / SNOMED
      category        TEXT
                      CHECK (category IS NULL OR category IN ('food','medication','environment','biologic')),
      criticality     TEXT NOT NULL DEFAULT 'unable-to-assess'
                      CHECK (criticality IN ('low','high','unable-to-assess')),
      clinical_status TEXT NOT NULL DEFAULT 'active'
                      CHECK (clinical_status IN ('active','inactive','resolved')),
      reaction        TEXT,                                -- 'anaphylaxis','rash','swelling'
      onset_date      TEXT,
      recorded_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_haller_patient ON health_allergies(patient_id, clinical_status);
  `);

  // health_immunizations ───────────────────────────────────────
  // FHIR Immunization.
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_immunizations (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,
      vaccine_code    TEXT,                                -- CVX code (e.g. '08' for HepB)
      vaccine_name    TEXT NOT NULL,                       -- 'COVID-19 mRNA Pfizer'
      lot_number      TEXT,
      site            TEXT,                                -- 'left-deltoid'
      route           TEXT,                                -- 'IM','SC','oral'
      dose_number     INTEGER,
      series_complete INTEGER NOT NULL DEFAULT 0,
      administered_at TEXT NOT NULL,                       -- ISO date
      administered_by TEXT,
      provider_name   TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_himmun_patient ON health_immunizations(patient_id, administered_at DESC);
  `);

  // health_observations ────────────────────────────────────────
  // FHIR Observation — vitals + labs + measurements.
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_observations (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,
      category        TEXT NOT NULL                        -- FHIR observation-category
                      CHECK (category IN ('vital-signs','laboratory','imaging','procedure','survey','exam','therapy','activity','social-history')),
      loinc_code      TEXT,                                -- LOINC code (e.g. '8480-6' = Systolic BP)
      display         TEXT NOT NULL,                       -- 'Blood Pressure', 'HbA1c'
      value_quantity  REAL,                                -- numeric value
      value_unit      TEXT,                                -- 'mmHg','mg/dL','bpm'
      value_string    TEXT,                                -- for non-numeric obs
      reference_low   REAL,                                -- normal range low
      reference_high  REAL,                                -- normal range high
      interpretation  TEXT
                      CHECK (interpretation IS NULL OR interpretation IN ('normal','low','high','critical-low','critical-high','abnormal','positive','negative')),
      effective_date  TEXT NOT NULL,                       -- when observed
      recorded_by     TEXT NOT NULL,
      recorded_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      notes           TEXT,
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hobs_patient ON health_observations(patient_id, category, effective_date DESC);
    CREATE INDEX IF NOT EXISTS idx_hobs_loinc ON health_observations(loinc_code, patient_id) WHERE loinc_code IS NOT NULL;
  `);

  // health_procedures ──────────────────────────────────────────
  // FHIR Procedure — surgeries, treatments, dental work.
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_procedures (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,
      cpt_code        TEXT,                                -- CPT or SNOMED code
      display         TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'completed'
                      CHECK (status IN ('preparation','in-progress','not-done','on-hold','stopped','completed','entered-in-error','unknown')),
      performed_at    TEXT,
      performer       TEXT,
      location        TEXT,
      outcome         TEXT,
      notes           TEXT,
      recorded_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hproc_patient ON health_procedures(patient_id, performed_at DESC);
  `);

  // health_encounters ──────────────────────────────────────────
  // FHIR Encounter — visit / appointment / phone call / message.
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_encounters (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,
      class_code      TEXT NOT NULL DEFAULT 'ambulatory'
                      CHECK (class_code IN ('ambulatory','emergency','field','home-health','inpatient','observation','virtual','telehealth')),
      type            TEXT,                                -- 'annual physical', 'urgent care', 'follow-up'
      provider_id     TEXT,
      provider_name   TEXT,
      location        TEXT,
      start_at        INTEGER,                             -- unixepoch
      end_at          INTEGER,
      status          TEXT NOT NULL DEFAULT 'planned'
                      CHECK (status IN ('planned','arrived','triaged','in-progress','onleave','finished','cancelled','entered-in-error','unknown')),
      chief_complaint TEXT,
      soap_note       TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_henc_patient ON health_encounters(patient_id, start_at DESC);
  `);

  // health_providers ───────────────────────────────────────────
  // FHIR Practitioner — care providers.
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_providers (
      id              TEXT PRIMARY KEY,
      npi             TEXT UNIQUE,                         -- National Provider Identifier
      name_given      TEXT NOT NULL,
      name_family     TEXT NOT NULL,
      credentials     TEXT,                                -- 'MD','DO','NP','PA'
      specialty       TEXT,
      organization    TEXT,
      phone           TEXT,
      email           TEXT,
      address         TEXT,
      accepts_dpc     INTEGER NOT NULL DEFAULT 0,          -- Direct Primary Care?
      dpc_monthly_fee_cents INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_hprov_specialty ON health_providers(specialty, organization);
    CREATE INDEX IF NOT EXISTS idx_hprov_dpc ON health_providers(accepts_dpc) WHERE accepts_dpc = 1;
  `);

  // health_appointments ────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_appointments (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,
      provider_id     TEXT,
      provider_name   TEXT,
      starts_at       INTEGER NOT NULL,
      ends_at         INTEGER NOT NULL,
      status          TEXT NOT NULL DEFAULT 'booked'
                      CHECK (status IN ('proposed','pending','booked','arrived','fulfilled','cancelled','noshow','entered-in-error','checked-in','waitlist')),
      kind            TEXT NOT NULL DEFAULT 'in-person'
                      CHECK (kind IN ('in-person','telehealth','phone','message')),
      reason          TEXT,
      copay_cents     INTEGER,
      copay_status    TEXT NOT NULL DEFAULT 'unpaid'
                      CHECK (copay_status IN ('unpaid','paid','waived','refunded')),
      booked_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      cancelled_at    INTEGER,
      cancelled_by    TEXT,
      cancel_reason   TEXT,
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_happt_patient ON health_appointments(patient_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_happt_upcoming ON health_appointments(starts_at) WHERE status IN ('booked','checked-in');
  `);

  // health_consent_grants ──────────────────────────────────────
  // HIPAA-compliant consent ledger. Every PHI access requires
  // an active grant.
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_consent_grants (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,
      grantee_id      TEXT NOT NULL,                       -- user_id of provider/app/researcher being granted access
      grantee_kind    TEXT NOT NULL
                      CHECK (grantee_kind IN ('provider','app','researcher','caregiver','emergency')),
      scope           TEXT NOT NULL                        -- comma-separated resource types: 'medications,conditions,observations'
                                                            ,
      purpose         TEXT,                                -- 'treatment','payment','operations','research','self_access'
      granted_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at      INTEGER,                             -- null = until revoked
      revoked_at      INTEGER,
      revoked_by      TEXT,
      grant_text      TEXT,                                -- the consent prompt the user agreed to
      ip              TEXT,
      user_agent      TEXT,
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hcons_patient ON health_consent_grants(patient_id, grantee_id, revoked_at);
    CREATE INDEX IF NOT EXISTS idx_hcons_active ON health_consent_grants(patient_id) WHERE revoked_at IS NULL;
  `);

  // health_audit_log ───────────────────────────────────────────
  // HIPAA-mandated audit log. Every PHI access is logged with
  // who/when/what-action/what-data. 6+ year retention enforced
  // at backup level.
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_audit_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id      TEXT NOT NULL,
      actor_id        TEXT NOT NULL,                       -- who performed the action
      actor_kind      TEXT NOT NULL DEFAULT 'user'
                      CHECK (actor_kind IN ('user','provider','app','system','ai','emergency')),
      action          TEXT NOT NULL                        -- 'read','write','update','delete','export','print','share','ai_process'
                      CHECK (action IN ('read','write','update','delete','export','print','share','ai_process')),
      resource_kind   TEXT NOT NULL,                       -- 'medication','observation','condition','encounter','appointment','allergy','immunization','procedure','patient'
      resource_id     TEXT,
      consent_grant_id TEXT,                               -- which grant authorized this access
      ip              TEXT,
      user_agent      TEXT,
      detail_json     TEXT,                                -- additional context (e.g. fields accessed)
      at              INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_hlog_patient ON health_audit_log(patient_id, at DESC);
    CREATE INDEX IF NOT EXISTS idx_hlog_actor ON health_audit_log(actor_id, at DESC);
    CREATE INDEX IF NOT EXISTS idx_hlog_resource ON health_audit_log(resource_kind, resource_id, at DESC) WHERE resource_id IS NOT NULL;
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS health_audit_log;
    DROP TABLE IF EXISTS health_consent_grants;
    DROP TABLE IF EXISTS health_appointments;
    DROP TABLE IF EXISTS health_providers;
    DROP TABLE IF EXISTS health_encounters;
    DROP TABLE IF EXISTS health_procedures;
    DROP TABLE IF EXISTS health_observations;
    DROP TABLE IF EXISTS health_immunizations;
    DROP TABLE IF EXISTS health_allergies;
    DROP TABLE IF EXISTS health_medication_doses;
    DROP TABLE IF EXISTS health_medications;
    DROP TABLE IF EXISTS health_conditions;
    DROP TABLE IF EXISTS health_patients;
  `);
}
