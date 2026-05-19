// server/migrations/242_health_moats.js
//
// Healthcare lens Sprint C — concord-native moats.
//
// RESEARCH GROUNDING (May 2026):
//   - 21st Century Cures Act mandates open FHIR APIs for certified
//     EHRs. SMART on FHIR is the OAuth-based protocol for patient
//     apps. Concord becomes a patient-facing app that can:
//       (a) IMPORT records from Epic/Cerner/Athena via SMART on FHIR
//       (b) EXPORT records as FHIR Bundle to Apple Health Records /
//           CommonHealth
//   - Health DTU = portable patient record. Same DTU substrate +
//     consent + cite cascade already proven in social/music/accounting.
//   - DPC (Direct Primary Care): 2,800+ practices, $50-150/mo
//     subscription. Healthie + SimplePractice dominate. Concord can
//     match natively via concord-coin recurring subscription.
//   - Cross-lens cite: medication ↔ task (refill reminder), encounter
//     ↔ calendar (follow-up), lab ↔ doc (specialist letter), symptom
//     ↔ chat (telehealth conversation).

export function up(db) {
  // health_record_mints — each patient resource (or bundle) minted
  // as a citable DTU. Patient-owned data, portable across providers.
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_record_mints (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id      TEXT NOT NULL,
      resource_kind   TEXT NOT NULL                        -- 'patient_bundle','condition','medication','observation','immunization','procedure','encounter'
                      CHECK (resource_kind IN ('patient_bundle','condition','medication','observation','immunization','procedure','encounter','allergy')),
      resource_id     TEXT,                                -- null for bundle mints (whole record)
      dtu_id          TEXT NOT NULL UNIQUE,
      creator_id      TEXT NOT NULL,
      royalty_rate    REAL NOT NULL DEFAULT 0.0,           -- usually 0; patients don't typically monetize
      visibility      TEXT NOT NULL DEFAULT 'private'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      allow_ai_training INTEGER NOT NULL DEFAULT 0,        -- opt-in only per Bandcamp/Subvert consent norm
      allow_research_use INTEGER NOT NULL DEFAULT 0,        -- de-identified research opt-in
      citation_count  INTEGER NOT NULL DEFAULT 0,
      minted_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hrm_patient ON health_record_mints(patient_id, minted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hrm_creator ON health_record_mints(creator_id, minted_at DESC);
  `);

  // health_fhir_imports — SMART on FHIR import audit. Tracks every
  // import attempt with source EHR + timing + resource counts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_fhir_imports (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT,                                -- null if pre-patient-creation
      user_id         TEXT NOT NULL,
      source_ehr      TEXT NOT NULL                        -- 'epic','cerner','athena','allscripts','manual_upload','apple_health'
                      CHECK (source_ehr IN ('epic','cerner','athena','allscripts','manual_upload','apple_health','common_health','smart_on_fhir')),
      source_endpoint TEXT,                                -- the FHIR base URL
      smart_app_launch_version TEXT NOT NULL DEFAULT 'v2'  -- HTI-1 requires v2 since Jan 2025
                      CHECK (smart_app_launch_version IN ('v1','v2')),
      uscdi_version  TEXT NOT NULL DEFAULT 'v3'           -- USCDI v3 baseline since Jan 1 2026
                      CHECK (uscdi_version IN ('v1','v2','v3','v4','v5')),
      bundle_resource_count INTEGER NOT NULL DEFAULT 0,
      patient_resource_count INTEGER NOT NULL DEFAULT 0,
      condition_count INTEGER NOT NULL DEFAULT 0,
      medication_count INTEGER NOT NULL DEFAULT 0,
      allergy_count   INTEGER NOT NULL DEFAULT 0,
      immunization_count INTEGER NOT NULL DEFAULT 0,
      observation_count INTEGER NOT NULL DEFAULT 0,
      procedure_count INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','authorizing','fetching','importing','complete','failed','cancelled')),
      error_message   TEXT,
      started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at    INTEGER,
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hfi_user ON health_fhir_imports(user_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hfi_patient ON health_fhir_imports(patient_id, started_at DESC) WHERE patient_id IS NOT NULL;
  `);

  // health_fhir_exports — patient-initiated export to external app
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_fhir_exports (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,
      requested_by    TEXT NOT NULL,
      target_app      TEXT,                                -- 'apple_health','common_health','custom_smart_app','download'
      scope_resources_json TEXT NOT NULL,                  -- ['conditions','medications','observations']
      bundle_json     TEXT,                                -- the actual FHIR Bundle JSON
      bundle_resource_count INTEGER NOT NULL DEFAULT 0,
      consent_grant_id TEXT,                               -- which consent authorized the export
      status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','building','ready','delivered','expired','revoked')),
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      delivered_at    INTEGER,
      expires_at      INTEGER,                             -- bundle URL TTL
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hfe_patient ON health_fhir_exports(patient_id, created_at DESC);
  `);

  // health_dpc_subscriptions — Direct Primary Care subscription
  // billing on top of provider relationship. Patient pays $50-150/mo
  // direct-to-provider, no insurance billing.
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_dpc_subscriptions (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,
      provider_id     TEXT NOT NULL,
      monthly_fee_cents INTEGER NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'concord_coin',
      status          TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('pending','active','past_due','cancelled','paused')),
      started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      next_billing_at INTEGER NOT NULL,
      cancelled_at    INTEGER,
      total_paid_cents INTEGER NOT NULL DEFAULT 0,
      months_active   INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE,
      FOREIGN KEY (provider_id) REFERENCES health_providers(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hdpc_patient ON health_dpc_subscriptions(patient_id, status);
    CREATE INDEX IF NOT EXISTS idx_hdpc_billing_due ON health_dpc_subscriptions(next_billing_at) WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS health_dpc_charges (
      id              TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      amount_cents    INTEGER NOT NULL,
      billing_period_start TEXT NOT NULL,
      billing_period_end TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','paid','failed','refunded','disputed')),
      charged_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      paid_at         INTEGER,
      FOREIGN KEY (subscription_id) REFERENCES health_dpc_subscriptions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hdpcc_sub ON health_dpc_charges(subscription_id, charged_at DESC);
  `);

  // health_cross_lens_cites — record when a health resource is cited
  // by a doc/task/calendar/chat/etc resource in another lens.
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_cross_lens_cites (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      health_dtu_id   TEXT NOT NULL,                       -- the minted health record
      parent_dtu_id   TEXT NOT NULL,                       -- the citing resource (task/calendar/doc/chat)
      parent_lens     TEXT NOT NULL,                       -- 'tasks','calendar','docs','chat','social'
      cite_kind       TEXT                                 -- 'refill_reminder','follow_up','referral_attachment','telehealth_link'
                      CHECK (cite_kind IS NULL OR cite_kind IN ('refill_reminder','follow_up','referral_attachment','telehealth_link','spec_letter','medication_chart_link')),
      consent_grant_id TEXT,                               -- consent that authorized the cite
      created_by      TEXT NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_hclc_health ON health_cross_lens_cites(health_dtu_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hclc_parent ON health_cross_lens_cites(parent_dtu_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS health_cross_lens_cites;
    DROP TABLE IF EXISTS health_dpc_charges;
    DROP TABLE IF EXISTS health_dpc_subscriptions;
    DROP TABLE IF EXISTS health_fhir_exports;
    DROP TABLE IF EXISTS health_fhir_imports;
    DROP TABLE IF EXISTS health_record_mints;
  `);
}
