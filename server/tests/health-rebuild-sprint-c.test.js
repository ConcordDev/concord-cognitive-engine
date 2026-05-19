// server/tests/health-rebuild-sprint-c.test.js
//
// Healthcare lens Sprint C — concord moats. Tests the patient-owned
// portable record DTU, SMART on FHIR import audit, FHIR R4 Bundle
// export, DPC subscription, and cross-lens cite cascade.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerHealthRebuildMacros from "../domains/healthcare-rebuild.js";
import registerHealthMoatsMacros from "../domains/healthcare-moats.js";
import {
  createPatient, addCondition, addMedication, addAllergy,
  addImmunization, addObservation, upsertProvider, grantConsent,
} from "../lib/health/persistence.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["240_health_rebuild", "241_health_ai", "242_health_moats"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS dtus (id TEXT PRIMARY KEY, kind TEXT, title TEXT, creator_id TEXT, meta_json TEXT, created_at INTEGER DEFAULT (unixepoch()))`);
  registerHealthRebuildMacros(register);
  registerHealthMoatsMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId) { return { db, actor: { userId } }; }

// ─── Record mints ─────────────────────────────────────────

describe("record_mint (patient-owned portable record)", () => {
  it("owner mints patient_bundle → DTU with embedded FHIR bundle", async () => {
    const p = createPatient(db, "u_mint", { nameGiven: "M", nameFamily: "Int", birthDate: "1990-05-15" });
    addCondition(db, "u_mint", { patientId: p.id, display: "Type 2 diabetes", code: "E11.9", codeSystem: "icd-10" });
    addMedication(db, "u_mint", { patientId: p.id, rxnormCode: "6845", name: "Metformin", dose: "500mg" });
    const r = await MACROS.get("record_mint")(ctx("u_mint"), { patientId: p.id, resourceKind: "patient_bundle" });
    assert.equal(r.ok, true);
    assert.ok(r.dtuId.startsWith("health_record:"));
    assert.equal(r.visibility, "private");
    assert.equal(r.allowAiTraining, false);
    assert.equal(r.allowResearchUse, false);
    // Verify DTU meta contains the FHIR bundle
    const dtu = db.prepare(`SELECT meta_json FROM dtus WHERE id = ?`).get(r.dtuId);
    const meta = JSON.parse(dtu.meta_json);
    assert.equal(meta.fhir_bundle.resourceType, "Bundle");
    assert.ok(meta.fhir_bundle.total >= 3);  // patient + condition + medication
  });

  it("non-owner cannot mint", async () => {
    const p = createPatient(db, "u_mint_owner", { nameGiven: "O", nameFamily: "M" });
    const r = await MACROS.get("record_mint")(ctx("u_random"), { patientId: p.id });
    assert.equal(r.ok, false);
  });

  it("opt-in AI training + research use", async () => {
    const p = createPatient(db, "u_optin", { nameGiven: "OI", nameFamily: "M" });
    const r = await MACROS.get("record_mint")(ctx("u_optin"), {
      patientId: p.id, resourceKind: "patient_bundle",
      allowAiTraining: true, allowResearchUse: true, visibility: "public",
    });
    assert.equal(r.allowAiTraining, true);
    assert.equal(r.allowResearchUse, true);
  });

  it("record_mints_list returns my patient's mints", async () => {
    const p = createPatient(db, "u_mlst", { nameGiven: "ML", nameFamily: "S" });
    await MACROS.get("record_mint")(ctx("u_mlst"), { patientId: p.id });
    const r = await MACROS.get("record_mints_list")(ctx("u_mlst"), { patientId: p.id });
    assert.ok(r.mints.length >= 1);
  });
});

// ─── FHIR import (SMART on FHIR) ───────────────────────────

describe("FHIR import (SMART on FHIR)", () => {
  it("import_start enforces SMART v2 + USCDI v3 per HTI-1", async () => {
    const r = await MACROS.get("fhir_import_start")(ctx("u_imp"), { sourceEhr: "epic", sourceEndpoint: "https://fhir.epic.com" });
    assert.equal(r.ok, true);
    assert.equal(r.smartAppLaunchVersion, "v2");
    assert.equal(r.uscdiVersion, "v3");
    assert.equal(r.status, "pending");
  });

  it("invalid sourceEhr rejected", async () => {
    const r = await MACROS.get("fhir_import_start")(ctx("u_bad_ehr"), { sourceEhr: "made_up_ehr" });
    assert.equal(r.reason, "invalid_sourceEhr");
  });

  it("import_complete updates counts + transitions to complete", async () => {
    const r1 = await MACROS.get("fhir_import_start")(ctx("u_imp2"), { sourceEhr: "cerner" });
    const p = createPatient(db, "u_imp2", { nameGiven: "I", nameFamily: "P" });
    const r2 = await MACROS.get("fhir_import_complete")(ctx("u_imp2"), {
      id: r1.id, patientId: p.id,
      counts: { bundle: 25, patient: 1, condition: 5, medication: 8, allergy: 2, immunization: 4, observation: 5, procedure: 0 },
    });
    assert.equal(r2.ok, true);
    const row = db.prepare(`SELECT status, completed_at, condition_count, medication_count FROM health_fhir_imports WHERE id = ?`).get(r1.id);
    assert.equal(row.status, "complete");
    assert.ok(row.completed_at > 0);
    assert.equal(row.condition_count, 5);
    assert.equal(row.medication_count, 8);
  });

  it("imports_list returns my imports", async () => {
    const r = await MACROS.get("fhir_imports_list")(ctx("u_imp2"));
    assert.ok(r.imports.length >= 1);  // u_imp2 owns one import from prior test
  });
});

// ─── FHIR export (R4 Bundle) ───────────────────────────────

describe("FHIR export (FHIR R4 Bundle)", () => {
  it("export builds FHIR R4 Bundle with all resources", async () => {
    const p = createPatient(db, "u_exp", { nameGiven: "Ex", nameFamily: "P", birthDate: "1980-01-01", gender: "female" });
    addCondition(db, "u_exp", { patientId: p.id, display: "Hypertension", code: "I10", codeSystem: "icd-10" });
    addMedication(db, "u_exp", { patientId: p.id, rxnormCode: "10612", name: "Lisinopril", dose: "10mg" });
    addAllergy(db, "u_exp", { patientId: p.id, substance: "Penicillin", category: "medication", criticality: "high" });
    addImmunization(db, "u_exp", { patientId: p.id, vaccineCode: "08", vaccineName: "Hepatitis B", administeredAt: "2020-05-01" });
    addObservation(db, "u_exp", { patientId: p.id, category: "vital-signs", loincCode: "8480-6", display: "Systolic BP", valueQuantity: 120, valueUnit: "mmHg", effectiveDate: "2026-05-19" });
    const r = await MACROS.get("fhir_export")(ctx("u_exp"), { patientId: p.id, targetApp: "apple_health", scope: ["all"] });
    assert.equal(r.ok, true);
    assert.equal(r.bundle.resourceType, "Bundle");
    assert.equal(r.bundle.type, "collection");
    assert.ok(r.bundle.entry.length >= 6);  // Patient + Condition + Med + Allergy + Imm + Obs
    // Verify FHIR R4 resource shapes
    const patientEntry = r.bundle.entry.find((e) => e.resource.resourceType === "Patient");
    assert.equal(patientEntry.resource.gender, "female");
    assert.equal(patientEntry.resource.birthDate, "1980-01-01");
    const conditionEntry = r.bundle.entry.find((e) => e.resource.resourceType === "Condition");
    assert.equal(conditionEntry.resource.code.text, "Hypertension");
    const medEntry = r.bundle.entry.find((e) => e.resource.resourceType === "MedicationStatement");
    assert.equal(medEntry.resource.medicationCodeableConcept.coding[0].system, "http://www.nlm.nih.gov/research/umls/rxnorm");
    const obsEntry = r.bundle.entry.find((e) => e.resource.resourceType === "Observation");
    assert.equal(obsEntry.resource.code.coding[0].system, "http://loinc.org");
  });

  it("scope filter omits non-requested resources", async () => {
    const p = createPatient(db, "u_scope", { nameGiven: "S", nameFamily: "C" });
    addCondition(db, "u_scope", { patientId: p.id, display: "X" });
    addMedication(db, "u_scope", { patientId: p.id, name: "Y" });
    const r = await MACROS.get("fhir_export")(ctx("u_scope"), { patientId: p.id, scope: ["medications"] });
    assert.ok(r.bundle.entry.find((e) => e.resource.resourceType === "MedicationStatement"));
    assert.ok(!r.bundle.entry.find((e) => e.resource.resourceType === "Condition"));
  });

  it("non-owner export refused", async () => {
    const p = createPatient(db, "u_priv_exp", { nameGiven: "P", nameFamily: "E" });
    const r = await MACROS.get("fhir_export")(ctx("u_thief"), { patientId: p.id });
    assert.equal(r.ok, false);
  });
});

// ─── DPC subscription ─────────────────────────────────────

describe("DPC subscription billing", () => {
  it("subscribe to DPC provider works + creates subscription with 30d billing", async () => {
    const p = createPatient(db, "u_dpc", { nameGiven: "D", nameFamily: "PC" });
    const prov = upsertProvider(db, { nameGiven: "Jane", nameFamily: "Doe", specialty: "family", acceptsDpc: true, dpcMonthlyFeeCents: 7500 });
    const r = await MACROS.get("dpc_subscribe")(ctx("u_dpc"), { patientId: p.id, providerId: prov.id });
    assert.equal(r.ok, true);
    assert.equal(r.monthlyFeeCents, 7500);
    assert.ok(r.nextBillingAt > Math.floor(Date.now() / 1000) + 25 * 86400);
  });

  it("refuses non-DPC provider", async () => {
    const p = createPatient(db, "u_dpc_n", { nameGiven: "N", nameFamily: "DPC" });
    const prov = upsertProvider(db, { nameGiven: "Trad", nameFamily: "ITional", specialty: "x", acceptsDpc: false });
    const r = await MACROS.get("dpc_subscribe")(ctx("u_dpc_n"), { patientId: p.id, providerId: prov.id });
    assert.equal(r.reason, "provider_not_dpc");
  });

  it("refuses duplicate subscription", async () => {
    const p = createPatient(db, "u_dpc_d", { nameGiven: "D", nameFamily: "U" });
    const prov = upsertProvider(db, { nameGiven: "X", nameFamily: "Y", acceptsDpc: true, dpcMonthlyFeeCents: 5000 });
    await MACROS.get("dpc_subscribe")(ctx("u_dpc_d"), { patientId: p.id, providerId: prov.id });
    const r2 = await MACROS.get("dpc_subscribe")(ctx("u_dpc_d"), { patientId: p.id, providerId: prov.id });
    assert.equal(r2.reason, "already_subscribed");
  });

  it("monthly fee out-of-range rejected (1000-50000 cents = $10-$500)", async () => {
    const p = createPatient(db, "u_dpc_r", { nameGiven: "R", nameFamily: "R" });
    const prov = upsertProvider(db, { nameGiven: "X", nameFamily: "Z", acceptsDpc: true, dpcMonthlyFeeCents: 100 });
    const r = await MACROS.get("dpc_subscribe")(ctx("u_dpc_r"), { patientId: p.id, providerId: prov.id, monthlyFeeCents: 100 });
    assert.equal(r.reason, "monthly_fee_out_of_range_cents_1000_to_50000");
  });

  it("cancel transitions to cancelled", async () => {
    const p = createPatient(db, "u_dpc_c", { nameGiven: "C", nameFamily: "C" });
    const prov = upsertProvider(db, { nameGiven: "X", nameFamily: "Q", acceptsDpc: true, dpcMonthlyFeeCents: 7500 });
    const sub = await MACROS.get("dpc_subscribe")(ctx("u_dpc_c"), { patientId: p.id, providerId: prov.id });
    const c = await MACROS.get("dpc_cancel")(ctx("u_dpc_c"), { id: sub.id });
    assert.equal(c.ok, true);
    const list = await MACROS.get("dpc_list")(ctx("u_dpc_c"), { patientId: p.id });
    assert.equal(list.subscriptions[0].status, "cancelled");
  });
});

// ─── Cross-lens cite ──────────────────────────────────────

describe("cross_lens_cite", () => {
  it("medication ↔ task refill_reminder fires cascade-aware cite", async () => {
    const p = createPatient(db, "u_xlc", { nameGiven: "X", nameFamily: "L" });
    addMedication(db, "u_xlc", { patientId: p.id, name: "Lisinopril" });
    const mint = await MACROS.get("record_mint")(ctx("u_xlc"), { patientId: p.id });
    // Create a fake task DTU
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json) VALUES ('dtu:task:refill', 'task', 'Refill reminder', 'u_xlc', '{}')`).run();
    const r = await MACROS.get("cross_lens_cite")(ctx("u_xlc"), {
      healthDtuId: mint.dtuId, parentDtuId: "dtu:task:refill",
      parentLens: "tasks", citeKind: "refill_reminder",
    });
    assert.equal(r.ok, true);
    assert.equal(r.parentLens, "tasks");
    assert.equal(r.citeKind, "refill_reminder");
    // Citation count bumped
    const m = db.prepare(`SELECT citation_count FROM health_record_mints WHERE dtu_id = ?`).get(mint.dtuId);
    assert.equal(m.citation_count, 1);
  });

  it("rejects invalid parent_lens", async () => {
    const p = createPatient(db, "u_xlc_bad", { nameGiven: "X", nameFamily: "B" });
    const mint = await MACROS.get("record_mint")(ctx("u_xlc_bad"), { patientId: p.id });
    const r = await MACROS.get("cross_lens_cite")(ctx("u_xlc_bad"), {
      healthDtuId: mint.dtuId, parentDtuId: "dtu:x", parentLens: "made_up",
    });
    assert.equal(r.reason, "invalid_parent_lens");
  });

  it("cross_lens_cites_list returns all cites for patient", async () => {
    const p = createPatient(db, "u_xlc_lst", { nameGiven: "L", nameFamily: "S" });
    const mint = await MACROS.get("record_mint")(ctx("u_xlc_lst"), { patientId: p.id });
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json) VALUES ('dtu:doc:letter', 'doc', 'Letter', 'u_xlc_lst', '{}')`).run();
    await MACROS.get("cross_lens_cite")(ctx("u_xlc_lst"), {
      healthDtuId: mint.dtuId, parentDtuId: "dtu:doc:letter",
      parentLens: "docs", citeKind: "spec_letter",
    });
    const r = await MACROS.get("cross_lens_cites_list")(ctx("u_xlc_lst"), { patientId: p.id });
    assert.ok(r.cites.length >= 1);
  });
});
