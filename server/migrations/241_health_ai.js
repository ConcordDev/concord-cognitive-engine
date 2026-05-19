// server/migrations/241_health_ai.js
//
// Healthcare lens rebuild Sprint B — AI surface substrate with
// FDA + HIPAA guardrails baked into the schema.
//
// COMPLIANCE GROUNDING:
//   - FDA stance: LLMs "not intended for clinical decision-making";
//     "Generative AI can hallucinate, so rigorous guardrails will be
//     needed". Every clinical AI output stores: disclaimer text,
//     sources cited, confidence, and the explicit "not for diagnosis"
//     flag.
//   - HIPAA AI rules (Jan 2025): every ePHI-touching AI call must log
//     prompt content + model version + workflow + 6+ year retention.
//     health_ai_runs is the dedicated ledger.
//   - RxNorm RXCUI codes for cross-checking drug interactions against
//     a recognized standard, not an opaque LLM judgment.

export function up(db) {
  // health_ai_runs ─────────────────────────────────────────────
  // Dedicated AI ledger separate from health_audit_log so we can
  // store the prompt + model + tokens + sources without bloating
  // the regular audit trail.
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_ai_runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id      TEXT,                                -- nullable for non-PHI AI runs
      user_id         TEXT NOT NULL,
      kind            TEXT NOT NULL                        -- 'symptom_triage','drug_interaction','lab_anomaly','clinical_summary','vision','code_lookup'
                      CHECK (kind IN ('symptom_triage','drug_interaction','lab_anomaly','clinical_summary','vision','code_lookup','medication_reconciliation')),
      prompt_text     TEXT,                                -- exact prompt sent to LLM (truncated to 8KB)
      model_name      TEXT,                                -- 'gpt-4o','qwen2.5:3b','llava:13b' etc
      model_version   TEXT,                                -- model checksum / version tag
      output_text     TEXT,                                -- raw model output (truncated to 16KB)
      sources_json    TEXT,                                -- citations used: [{kind,id,relevance}]
      disclaimer_shown TEXT,                                -- exact disclaimer text returned to user
      not_for_diagnosis INTEGER NOT NULL DEFAULT 1,        -- always 1 for any clinical output
      confidence      REAL,                                 -- 0-1 model self-reported (when available)
      tokens          INTEGER NOT NULL DEFAULT 0,
      latency_ms      INTEGER,
      source          TEXT NOT NULL DEFAULT 'llm'
                      CHECK (source IN ('llm','llm_with_vision','fallback','deterministic','rxnorm','loinc')),
      flagged_for_review INTEGER NOT NULL DEFAULT 0,
      reviewed_by     TEXT,
      reviewed_at     INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_hair_patient ON health_ai_runs(patient_id, created_at DESC) WHERE patient_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_hair_user ON health_ai_runs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hair_flagged ON health_ai_runs(flagged_for_review, created_at DESC) WHERE flagged_for_review = 1;
  `);

  // health_symptom_triages ────────────────────────────────────
  // Concord's symptom-triage output. Always returns severity tier +
  // disposition recommendation, NEVER a diagnosis. The 4-tier
  // disposition is a recognized triage protocol (Manchester /
  // Emergency Severity Index / Canadian Triage and Acuity Scale).
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_symptom_triages (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,
      ai_run_id       INTEGER,
      reported_symptoms_json TEXT NOT NULL,                -- ["chest pain","shortness of breath"]
      duration_hours  REAL,
      severity_tier   TEXT NOT NULL                        -- ESI-aligned
                      CHECK (severity_tier IN ('emergency','urgent','routine','self_care','unknown')),
      disposition     TEXT NOT NULL                        -- recommendation, not diagnosis
                      CHECK (disposition IN ('call_911','go_to_er','urgent_care_today','schedule_appointment','self_monitor','wait_and_see','more_info_needed')),
      red_flags_json  TEXT,                                -- ["age > 50","diabetic"]
      reasoning       TEXT,
      disclaimer      TEXT NOT NULL,                       -- always shown to user
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      acted_on        TEXT,                                -- 'followed','ignored','went_elsewhere'
      acted_at        INTEGER,
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hst_patient ON health_symptom_triages(patient_id, created_at DESC);
  `);

  // health_drug_interaction_alerts ────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_drug_interaction_alerts (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,
      ai_run_id       INTEGER,
      drug_a_name     TEXT NOT NULL,
      drug_a_rxnorm   TEXT,
      drug_b_name     TEXT NOT NULL,
      drug_b_rxnorm   TEXT,
      severity        TEXT NOT NULL
                      CHECK (severity IN ('contraindicated','major','moderate','minor','no_known_interaction')),
      mechanism       TEXT,                                -- short description
      management      TEXT,                                -- 'avoid','monitor','adjust dose','no action'
      sources_json    TEXT,                                -- citations
      disclaimer      TEXT NOT NULL,
      acknowledged_at INTEGER,
      acknowledged_by TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hdia_patient ON health_drug_interaction_alerts(patient_id, severity, created_at DESC);
  `);

  // health_lab_anomalies ──────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_lab_anomalies (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,
      observation_id  TEXT NOT NULL,
      ai_run_id       INTEGER,
      anomaly_kind    TEXT NOT NULL
                      CHECK (anomaly_kind IN ('out_of_reference_range','trend_alarming','sudden_change','critical_value','panic_value')),
      severity        TEXT NOT NULL DEFAULT 'medium'
                      CHECK (severity IN ('low','medium','high','critical')),
      summary         TEXT,
      suggested_action TEXT,                                -- "discuss with PCP", "ER if symptomatic"
      disclaimer      TEXT NOT NULL,
      detected_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      acknowledged_at INTEGER,
      acknowledged_by TEXT,
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE,
      FOREIGN KEY (observation_id) REFERENCES health_observations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hla_patient ON health_lab_anomalies(patient_id, detected_at DESC);
  `);

  // health_clinical_summaries ─────────────────────────────────
  // Composed prose summarizing a patient's record for handoff.
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_clinical_summaries (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,
      ai_run_id       INTEGER,
      kind            TEXT NOT NULL DEFAULT 'full'
                      CHECK (kind IN ('full','medications_only','conditions_only','recent_visits','handoff_brief','er_summary','referral')),
      summary         TEXT NOT NULL,
      key_findings_json TEXT,
      sources_json    TEXT,                                -- which resources were included
      disclaimer      TEXT NOT NULL,
      tone            TEXT NOT NULL DEFAULT 'patient'
                      CHECK (tone IN ('patient','clinician','er_doc','referral','self_review')),
      composed_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      composed_by     TEXT NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES health_patients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hcs_patient ON health_clinical_summaries(patient_id, composed_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS health_clinical_summaries;
    DROP TABLE IF EXISTS health_lab_anomalies;
    DROP TABLE IF EXISTS health_drug_interaction_alerts;
    DROP TABLE IF EXISTS health_symptom_triages;
    DROP TABLE IF EXISTS health_ai_runs;
  `);
}
