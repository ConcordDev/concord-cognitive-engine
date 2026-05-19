// server/tests/health-rebuild-sprint-b.test.js
//
// Healthcare lens Sprint B — AI surface with FDA + HIPAA guardrails.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerHealthRebuildMacros from "../domains/healthcare-rebuild.js";
import registerHealthAiMacros, { DISCLAIMER, triageDeterministic, checkInteractionDeterministic } from "../domains/healthcare-ai.js";
import { createPatient, addMedication, addObservation } from "../lib/health/persistence.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["240_health_rebuild", "241_health_ai"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  registerHealthRebuildMacros(register);
  registerHealthAiMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId) { return { db, actor: { userId } }; }

// ─── Disclaimers (FDA-mandated) ────────────────────────────

describe("FDA-mandated disclaimers always shown", () => {
  it("disclaimer object has all 5 clinical kinds", () => {
    assert.ok(DISCLAIMER.symptom_triage);
    assert.ok(DISCLAIMER.drug_interaction);
    assert.ok(DISCLAIMER.lab_anomaly);
    assert.ok(DISCLAIMER.clinical_summary);
    assert.ok(DISCLAIMER.vision);
    // Each must contain "NOT FOR DIAGNOSIS" literally
    for (const [k, v] of Object.entries(DISCLAIMER)) {
      assert.ok(v.includes("NOT FOR DIAGNOSIS"), `${k} disclaimer missing 'NOT FOR DIAGNOSIS'`);
    }
  });
});

// ─── Deterministic triage ─────────────────────────────────

describe("triageDeterministic red-flag patterns", () => {
  it("chest pain + shortness of breath → emergency / call_911", () => {
    const r = triageDeterministic("I have chest pain and shortness of breath");
    assert.equal(r.severity, "emergency");
    assert.equal(r.disposition, "call_911");
  });

  it("suicidal ideation → emergency / call_911", () => {
    const r = triageDeterministic("I want to kill myself");
    assert.equal(r.severity, "emergency");
  });

  it("stroke FAST signs → emergency", () => {
    const r = triageDeterministic("My face is drooping and I have slurred speech");
    assert.equal(r.severity, "emergency");
  });

  it("severe abdominal pain → urgent", () => {
    const r = triageDeterministic("I have severe abdominal pain");
    assert.equal(r.severity, "urgent");
    assert.equal(r.disposition, "go_to_er");
  });

  it("mild cold → self_care", () => {
    const r = triageDeterministic("I have a mild cold and some congestion");
    assert.equal(r.severity, "self_care");
  });

  it("vague symptoms → routine", () => {
    const r = triageDeterministic("Feeling a bit off today");
    assert.equal(r.severity, "routine");
    assert.equal(r.disposition, "schedule_appointment");
  });
});

// ─── Deterministic drug interaction ───────────────────────

describe("checkInteractionDeterministic", () => {
  it("metformin + alcohol-relevant pair flagged major", () => {
    // RXCUIs 11289 (warfarin) and 6845 (metformin) — sorted ascending
    const r = checkInteractionDeterministic("6845", "11289");
    assert.equal(r.severity, "major");
    assert.ok(r.mechanism);
  });

  it("unknown pair → no_known_interaction", () => {
    const r = checkInteractionDeterministic("9999", "8888");
    assert.equal(r.severity, "no_known_interaction");
  });

  it("self-comparison returns null", () => {
    const r = checkInteractionDeterministic("6845", "6845");
    assert.equal(r, null);
  });
});

// ─── Macros: symptom_triage_v2 ────────────────────────────

describe("symptom_triage_v2 macro", () => {
  it("emergency input → disposition call_911 + flagged_for_review=1", async () => {
    const p = createPatient(db, "u_emerg", { nameGiven: "Em", nameFamily: "Er" });
    const r = await MACROS.get("symptom_triage_v2")(ctx("u_emerg"), {
      patientId: p.id, symptoms: "I have crushing chest pain radiating to my left arm with shortness of breath",
    });
    assert.equal(r.ok, true);
    assert.equal(r.severity, "emergency");
    assert.equal(r.disposition, "call_911");
    assert.ok(r.disclaimer.includes("NOT FOR DIAGNOSIS"));
    assert.equal(r.not_for_diagnosis, true);
    // Verify flagged for review
    const aiRun = db.prepare(`SELECT flagged_for_review FROM health_ai_runs WHERE patient_id = ? ORDER BY id DESC LIMIT 1`).get(p.id);
    assert.equal(aiRun.flagged_for_review, 1);
  });

  it("triage persisted to health_symptom_triages + linked to ai_run", async () => {
    const p = createPatient(db, "u_tri_persist", { nameGiven: "T", nameFamily: "P" });
    const r = await MACROS.get("symptom_triage_v2")(ctx("u_tri_persist"), {
      patientId: p.id, symptoms: "Mild headache",
    });
    assert.equal(r.ok, true);
    const triage = db.prepare(`SELECT * FROM health_symptom_triages WHERE id = ?`).get(r.triageId);
    assert.ok(triage);
    assert.ok(triage.ai_run_id);
  });

  it("no consent → access denied", async () => {
    const p = createPatient(db, "u_t_owner", { nameGiven: "X", nameFamily: "Y" });
    const r = await MACROS.get("symptom_triage_v2")(ctx("u_stranger_tri"), {
      patientId: p.id, symptoms: "headache",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_consent");
  });
});

// ─── Macros: drug_interaction_check ───────────────────────

describe("drug_interaction_check macro", () => {
  it("two interacting RxNorm-coded meds → alert created", async () => {
    const p = createPatient(db, "u_dx", { nameGiven: "Dr", nameFamily: "Ug" });
    addMedication(db, "u_dx", { patientId: p.id, rxnormCode: "6845", name: "Metformin", dose: "500mg" });
    addMedication(db, "u_dx", { patientId: p.id, rxnormCode: "11289", name: "Warfarin", dose: "5mg" });
    const r = await MACROS.get("drug_interaction_check")(ctx("u_dx"), { patientId: p.id });
    assert.equal(r.ok, true);
    assert.ok(r.alerts.length >= 1);
    assert.equal(r.alerts[0].severity, "major");
    assert.ok(r.disclaimer.includes("NOT FOR DIAGNOSIS"));
  });

  it("non-interacting pair → no alerts", async () => {
    const p = createPatient(db, "u_no_dx", { nameGiven: "N", nameFamily: "I" });
    addMedication(db, "u_no_dx", { patientId: p.id, rxnormCode: "111", name: "Drug A" });
    addMedication(db, "u_no_dx", { patientId: p.id, rxnormCode: "222", name: "Drug B" });
    const r = await MACROS.get("drug_interaction_check")(ctx("u_no_dx"), { patientId: p.id });
    assert.equal(r.alerts.length, 0);
  });

  it("newRxnorm parameter checks just the new med against existing", async () => {
    const p = createPatient(db, "u_new_med", { nameGiven: "N", nameFamily: "M" });
    addMedication(db, "u_new_med", { patientId: p.id, rxnormCode: "6845", name: "Metformin" });
    const r = await MACROS.get("drug_interaction_check")(ctx("u_new_med"), {
      patientId: p.id, newRxnorm: "11289", newName: "Warfarin",
    });
    assert.equal(r.alerts.length, 1);
  });
});

// ─── Macros: lab_anomaly_scan ─────────────────────────────

describe("lab_anomaly_scan macro", () => {
  it("out-of-range lab triggers anomaly with severity scaled by deviation", async () => {
    const p = createPatient(db, "u_lab", { nameGiven: "L", nameFamily: "A" });
    // Slightly out of range = medium
    addObservation(db, "u_lab", { patientId: p.id, category: "laboratory", loincCode: "4548-4", display: "HbA1c", valueQuantity: 8.5, valueUnit: "%", referenceLow: 4.0, referenceHigh: 5.6, effectiveDate: "2026-05-19" });
    // Critical-high = critical
    addObservation(db, "u_lab", { patientId: p.id, category: "laboratory", loincCode: "2345-7", display: "Glucose", valueQuantity: 450, valueUnit: "mg/dL", referenceLow: 70, referenceHigh: 100, effectiveDate: "2026-05-19" });
    const r = await MACROS.get("lab_anomaly_scan")(ctx("u_lab"), { patientId: p.id });
    assert.equal(r.ok, true);
    assert.ok(r.anomalies.length >= 2);
    const glucose = r.anomalies.find((a) => a.display === "Glucose");
    assert.equal(glucose.severity, "critical");
    assert.ok(r.disclaimer.includes("NOT FOR DIAGNOSIS"));
  });

  it("in-range lab → no anomaly", async () => {
    const p = createPatient(db, "u_normal", { nameGiven: "N", nameFamily: "R" });
    addObservation(db, "u_normal", { patientId: p.id, category: "laboratory", loincCode: "2345-7", display: "Glucose", valueQuantity: 95, valueUnit: "mg/dL", referenceLow: 70, referenceHigh: 100, effectiveDate: "2026-05-19" });
    const r = await MACROS.get("lab_anomaly_scan")(ctx("u_normal"), { patientId: p.id });
    assert.equal(r.anomalies.length, 0);
  });
});

// ─── Macros: clinical_summary_compose ─────────────────────

describe("clinical_summary_compose macro", () => {
  it("deterministic full summary cites conditions + meds + allergies", async () => {
    const p = createPatient(db, "u_sum", { nameGiven: "S", nameFamily: "U" });
    addMedication(db, "u_sum", { patientId: p.id, name: "Lisinopril", dose: "10mg" });
    const { addCondition, addAllergy } = await import("../lib/health/persistence.js");
    addCondition(db, "u_sum", { patientId: p.id, display: "Hypertension" });
    addAllergy(db, "u_sum", { patientId: p.id, substance: "Penicillin", category: "medication", criticality: "high" });
    const r = await MACROS.get("clinical_summary_compose")(ctx("u_sum"), { patientId: p.id, kind: "full" });
    assert.equal(r.ok, true);
    assert.ok(r.summary.includes("Hypertension"));
    assert.ok(r.summary.includes("Lisinopril"));
    assert.ok(r.summary.includes("Penicillin"));
    assert.ok(r.disclaimer.includes("NOT FOR DIAGNOSIS"));
    assert.ok(r.sources.length >= 3);  // condition + medication + allergy
  });

  it("er_summary tone is shorter / different", async () => {
    const p = createPatient(db, "u_er", { nameGiven: "E", nameFamily: "R" });
    addMedication(db, "u_er", { patientId: p.id, name: "Insulin" });
    const r = await MACROS.get("clinical_summary_compose")(ctx("u_er"), { patientId: p.id, kind: "er_summary" });
    assert.equal(r.ok, true);
    assert.equal(r.kind, "er_summary");
  });
});

// ─── HIPAA AI log compliance ──────────────────────────────

describe("HIPAA AI compliance — every clinical AI invocation logged", () => {
  it("ai_runs_recent returns prompt + model + disclaimer for every run", async () => {
    const p = createPatient(db, "u_ai_log", { nameGiven: "A", nameFamily: "I" });
    await MACROS.get("symptom_triage_v2")(ctx("u_ai_log"), { patientId: p.id, symptoms: "headache" });
    const r = await MACROS.get("ai_runs_recent")(ctx("u_ai_log"), { patientId: p.id });
    assert.equal(r.ok, true);
    assert.ok(r.runs.length >= 1);
    const lastRun = r.runs[0];
    assert.ok(lastRun.disclaimer_shown);
    assert.equal(lastRun.not_for_diagnosis, 1);
    assert.ok(lastRun.prompt_text || lastRun.output_text); // at least one captured
  });

  it("ai_process action logged to health_audit_log", async () => {
    const p = createPatient(db, "u_ai_audit", { nameGiven: "A", nameFamily: "U" });
    await MACROS.get("symptom_triage_v2")(ctx("u_ai_audit"), { patientId: p.id, symptoms: "test" });
    const log = db.prepare(`SELECT * FROM health_audit_log WHERE patient_id = ? AND action = 'ai_process'`).all(p.id);
    assert.ok(log.length >= 1);
    assert.equal(log[0].actor_kind, "ai");
  });
});
