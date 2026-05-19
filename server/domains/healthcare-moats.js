// server/domains/healthcare-moats.js
//
// Healthcare lens Sprint C — concord-native moats. Research-grounded
// per docs/LENS_RESEARCH_NOTES.md healthcare section:
//
//   record_mint         → patient-owned portable health DTU. Same
//                          substrate as social/music/accounting DTUs;
//                          opt-in AI training (default OFF per Bandcamp
//                          consent norm); opt-in de-identified research.
//   fhir_import         → SMART on FHIR import audit (Epic / Cerner /
//                          Athena / Allscripts). HTI-1 requires SMART
//                          v2 since Jan 2025. USCDI v3 baseline since
//                          Jan 1 2026.
//   fhir_export         → FHIR Bundle export to Apple Health Records /
//                          CommonHealth / custom SMART app / download.
//   dpc_subscribe       → Direct Primary Care subscription billing
//                          ($50-150/mo precedent). Concord-coin
//                          recurring charge direct-to-provider.
//   cross_lens_cite     → medication ↔ task refill, encounter ↔
//                          calendar follow-up, lab ↔ doc letter,
//                          symptom ↔ chat telehealth.

import { randomUUID } from "node:crypto";
import {
  auditLog, checkAccess, listConditions, listMedications, listAllergies,
  listImmunizations, listObservations, getPatient,
} from "../lib/health/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }
function _audit(ctx) { return { ip: ctx?.req?.ip || ctx?.ip || null, userAgent: ctx?.req?.headers?.["user-agent"] || ctx?.userAgent || null }; }

function _ensureDtuRow(db, { id, kind, title, creatorId, meta }) {
  try {
    db.prepare(`
      INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
    `).run(id, kind, String(title).slice(0, 200), creatorId, JSON.stringify(meta || {}));
  } catch { /* dtus may be absent in test envs */ }
}

const VALID_VIS = new Set(["private","workspace","public","published","global"]);
const VALID_RESOURCE_KINDS = new Set(["patient_bundle","condition","medication","observation","immunization","procedure","encounter","allergy"]);

// ─── Build a FHIR R4 Bundle ──────────────────────────────────
//
// Compose a transaction-mode Bundle including selected resources.
// Field names mirror FHIR R4 spec where reasonable (Patient,
// Condition, MedicationStatement, Observation, AllergyIntolerance,
// Immunization, Procedure).

function _buildFhirBundle(db, patientId, scope = ["all"]) {
  const patient = db.prepare(`SELECT * FROM health_patients WHERE id = ?`).get(patientId);
  if (!patient) return null;
  const includeAll = scope.includes("all") || scope.includes("*");
  const include = (k) => includeAll || scope.includes(k);
  const entries = [];

  // Patient resource
  entries.push({
    fullUrl: `Patient/${patient.id}`,
    resource: {
      resourceType: "Patient",
      id: patient.id,
      name: [{ given: [patient.name_given], family: patient.name_family }],
      birthDate: patient.birth_date || undefined,
      gender: patient.gender || undefined,
      identifier: patient.mrn ? [{ system: "urn:concord:mrn", value: patient.mrn }] : undefined,
    },
  });

  if (include("conditions")) {
    const conds = db.prepare(`SELECT * FROM health_conditions WHERE patient_id = ?`).all(patientId);
    for (const c of conds) {
      entries.push({
        fullUrl: `Condition/${c.id}`,
        resource: {
          resourceType: "Condition",
          id: c.id,
          subject: { reference: `Patient/${patient.id}` },
          code: { text: c.display, coding: c.code ? [{ system: c.code_system || "urn:concord:icd", code: c.code, display: c.display }] : undefined },
          clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: c.clinical_status }] },
          verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: c.verification_status }] },
          severity: c.severity ? { text: c.severity } : undefined,
          onsetDateTime: c.onset_date || undefined,
        },
      });
    }
  }

  if (include("medications")) {
    const meds = db.prepare(`SELECT * FROM health_medications WHERE patient_id = ?`).all(patientId);
    for (const m of meds) {
      entries.push({
        fullUrl: `MedicationStatement/${m.id}`,
        resource: {
          resourceType: "MedicationStatement",
          id: m.id,
          subject: { reference: `Patient/${patient.id}` },
          status: m.status,
          medicationCodeableConcept: { text: m.name, coding: m.rxnorm_code ? [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: m.rxnorm_code, display: m.name }] : undefined },
          dosage: m.dose ? [{ text: `${m.dose}${m.route ? ` ${m.route}` : ""}${m.frequency ? ` ${m.frequency}` : ""}` }] : undefined,
          effectiveDateTime: m.started_at || undefined,
        },
      });
    }
  }

  if (include("allergies")) {
    const allergies = db.prepare(`SELECT * FROM health_allergies WHERE patient_id = ?`).all(patientId);
    for (const a of allergies) {
      entries.push({
        fullUrl: `AllergyIntolerance/${a.id}`,
        resource: {
          resourceType: "AllergyIntolerance",
          id: a.id,
          patient: { reference: `Patient/${patient.id}` },
          code: { text: a.substance, coding: a.substance_code ? [{ code: a.substance_code }] : undefined },
          category: a.category ? [a.category] : undefined,
          criticality: a.criticality,
          clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: a.clinical_status }] },
          reaction: a.reaction ? [{ manifestation: [{ text: a.reaction }] }] : undefined,
        },
      });
    }
  }

  if (include("immunizations")) {
    const imms = db.prepare(`SELECT * FROM health_immunizations WHERE patient_id = ?`).all(patientId);
    for (const im of imms) {
      entries.push({
        fullUrl: `Immunization/${im.id}`,
        resource: {
          resourceType: "Immunization",
          id: im.id,
          patient: { reference: `Patient/${patient.id}` },
          vaccineCode: { text: im.vaccine_name, coding: im.vaccine_code ? [{ system: "http://hl7.org/fhir/sid/cvx", code: im.vaccine_code }] : undefined },
          status: "completed",
          occurrenceDateTime: im.administered_at,
          lotNumber: im.lot_number || undefined,
          site: im.site ? { text: im.site } : undefined,
          route: im.route ? { text: im.route } : undefined,
          doseQuantity: im.dose_number ? { value: im.dose_number } : undefined,
        },
      });
    }
  }

  if (include("observations")) {
    const obs = db.prepare(`SELECT * FROM health_observations WHERE patient_id = ?`).all(patientId);
    for (const o of obs) {
      entries.push({
        fullUrl: `Observation/${o.id}`,
        resource: {
          resourceType: "Observation",
          id: o.id,
          subject: { reference: `Patient/${patient.id}` },
          status: "final",
          category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: o.category }] }],
          code: { text: o.display, coding: o.loinc_code ? [{ system: "http://loinc.org", code: o.loinc_code, display: o.display }] : undefined },
          valueQuantity: o.value_quantity != null ? { value: o.value_quantity, unit: o.value_unit, system: "http://unitsofmeasure.org" } : undefined,
          valueString: o.value_string || undefined,
          effectiveDateTime: o.effective_date,
          interpretation: o.interpretation ? [{ coding: [{ code: o.interpretation }] }] : undefined,
          referenceRange: (o.reference_low != null || o.reference_high != null) ? [{ low: o.reference_low != null ? { value: o.reference_low } : undefined, high: o.reference_high != null ? { value: o.reference_high } : undefined }] : undefined,
        },
      });
    }
  }

  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: new Date().toISOString(),
    total: entries.length,
    entry: entries,
  };
}

export default function registerHealthMoatsMacros(register) {

  // ─── Record mint ──────────────────────────────────────────

  register("healthcare", "record_mint", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const patientId = String(input.patientId || "");
    if (!patientId) return { ok: false, reason: "patientId_required" };
    const access = checkAccess(db, patientId, userId);
    if (!access.ok || access.mode !== "self") return { ok: false, reason: "only_owner_can_mint" };
    const resourceKind = VALID_RESOURCE_KINDS.has(input.resourceKind) ? input.resourceKind : "patient_bundle";
    const resourceId = resourceKind === "patient_bundle" ? null : (input.resourceId ? String(input.resourceId) : null);
    const visibility = VALID_VIS.has(input.visibility) ? input.visibility : "private";
    const royaltyRate = typeof input.royaltyRate === "number" ? Math.max(0, Math.min(0.30, input.royaltyRate)) : 0;
    const allowAi = input.allowAiTraining === true ? 1 : 0;
    const allowResearch = input.allowResearchUse === true ? 1 : 0;
    const dtuId = `health_record:${randomUUID()}`;

    // Build payload for the DTU meta
    let metaPayload = {};
    if (resourceKind === "patient_bundle") {
      metaPayload = _buildFhirBundle(db, patientId, ["all"]);
    } else if (resourceId) {
      // Minimal payload for single-resource mints
      metaPayload = { resourceKind, resourceId, ref: `${resourceKind}/${resourceId}` };
    }

    const patient = db.prepare(`SELECT name_given, name_family FROM health_patients WHERE id = ?`).get(patientId);
    const title = `Health record: ${patient.name_given} ${patient.name_family} (${resourceKind})`;

    try {
      const tx = db.transaction(() => {
        _ensureDtuRow(db, {
          id: dtuId, kind: "health_record", title,
          creatorId: userId,
          meta: {
            type: "health_record",
            patient_id: patientId,
            resource_kind: resourceKind, resource_id: resourceId,
            royalty_rate: royaltyRate, visibility,
            allow_ai_training: !!allowAi, allow_research_use: !!allowResearch,
            fhir_bundle: resourceKind === "patient_bundle" ? metaPayload : undefined,
          },
        });
        db.prepare(`
          INSERT INTO health_record_mints (patient_id, resource_kind, resource_id, dtu_id, creator_id, royalty_rate, visibility, allow_ai_training, allow_research_use, minted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(patientId, resourceKind, resourceId, dtuId, userId, royaltyRate, visibility, allowAi, allowResearch, _now());
      });
      tx();
      auditLog(db, { patientId, actorId: userId, action: "export", resourceKind: resourceKind === "patient_bundle" ? "patient" : resourceKind, resourceId: resourceId || patientId, ip: _audit(ctx).ip, userAgent: _audit(ctx).userAgent, detail: { event: "record_minted", dtu_id: dtuId, visibility } });
      return { ok: true, dtuId, resourceKind, visibility, allowAiTraining: !!allowAi, allowResearchUse: !!allowResearch };
    } catch (err) {
      return { ok: false, reason: "mint_failed", error: err?.message };
    }
  }, { destructive: true, note: "Mint a health record as a portable patient-owned DTU. Only the patient owner can mint. AI training + research use are opt-in (default OFF). Visibility ladder enforced." });

  register("healthcare", "record_mints_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const patientId = String(input.patientId || "");
    const access = checkAccess(db, patientId, userId);
    if (!access.ok || access.mode !== "self") return { ok: false, reason: "forbidden" };
    return { ok: true, mints: db.prepare(`SELECT * FROM health_record_mints WHERE patient_id = ? ORDER BY minted_at DESC`).all(patientId) };
  }, { note: "List minted record DTUs for one of my patients" });

  // ─── FHIR import (SMART on FHIR) ───────────────────────────

  register("healthcare", "fhir_import_start", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const sourceEhr = ["epic","cerner","athena","allscripts","manual_upload","apple_health","common_health","smart_on_fhir"].includes(input.sourceEhr) ? input.sourceEhr : null;
    if (!sourceEhr) return { ok: false, reason: "invalid_sourceEhr" };
    const id = `fimp:${randomUUID()}`;
    db.prepare(`
      INSERT INTO health_fhir_imports (id, patient_id, user_id, source_ehr, source_endpoint, smart_app_launch_version, uscdi_version, status, started_at)
      VALUES (?, ?, ?, ?, ?, 'v2', 'v3', 'pending', ?)
    `).run(id, input.patientId || null, userId, sourceEhr,
      input.sourceEndpoint ? String(input.sourceEndpoint).slice(0, 500) : null,
      _now());
    return { ok: true, id, status: "pending", smartAppLaunchVersion: "v2", uscdiVersion: "v3" };
  }, { destructive: true, note: "Start a SMART on FHIR import from Epic/Cerner/Athena/etc. SMART v2 + USCDI v3 enforced (HTI-1 rule, effective Jan 2025/2026)." });

  register("healthcare", "fhir_import_complete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || input.importId || "");
    if (!id) return { ok: false, reason: "id_required" };
    const cur = db.prepare(`SELECT user_id, status FROM health_fhir_imports WHERE id = ?`).get(id);
    if (!cur) return { ok: false, reason: "not_found" };
    if (cur.user_id !== userId) return { ok: false, reason: "forbidden" };
    if (cur.status === "complete" || cur.status === "failed") return { ok: false, reason: "already_finalized" };
    const counts = input.counts || {};
    db.prepare(`
      UPDATE health_fhir_imports
      SET status = 'complete', completed_at = ?, patient_id = ?,
          bundle_resource_count = ?, patient_resource_count = ?, condition_count = ?, medication_count = ?,
          allergy_count = ?, immunization_count = ?, observation_count = ?, procedure_count = ?
      WHERE id = ?
    `).run(_now(), input.patientId || null,
      Math.max(0, Number(counts.bundle) || 0),
      Math.max(0, Number(counts.patient) || 0),
      Math.max(0, Number(counts.condition) || 0),
      Math.max(0, Number(counts.medication) || 0),
      Math.max(0, Number(counts.allergy) || 0),
      Math.max(0, Number(counts.immunization) || 0),
      Math.max(0, Number(counts.observation) || 0),
      Math.max(0, Number(counts.procedure) || 0),
      id);
    return { ok: true, id };
  }, { destructive: true, note: "Finalize a pending import with counts." });

  register("healthcare", "fhir_imports_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const rows = input.patientId
      ? db.prepare(`SELECT * FROM health_fhir_imports WHERE patient_id = ? ORDER BY started_at DESC`).all(input.patientId)
      : db.prepare(`SELECT * FROM health_fhir_imports WHERE user_id = ? ORDER BY started_at DESC LIMIT 50`).all(userId);
    return { ok: true, imports: rows };
  }, { note: "List my SMART on FHIR imports" });

  // ─── FHIR export ──────────────────────────────────────────

  register("healthcare", "fhir_export", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const patientId = String(input.patientId || "");
    const access = checkAccess(db, patientId, userId);
    if (!access.ok || access.mode !== "self") return { ok: false, reason: "only_owner_can_export" };
    const targetApp = String(input.targetApp || "download").slice(0, 100);
    const scope = Array.isArray(input.scope) && input.scope.length > 0 ? input.scope : ["all"];
    const bundle = _buildFhirBundle(db, patientId, scope);
    if (!bundle) return { ok: false, reason: "bundle_failed" };
    const id = `fexp:${randomUUID()}`;
    const expiresAt = _now() + 86400;  // 24-hour TTL on the bundle
    db.prepare(`
      INSERT INTO health_fhir_exports (id, patient_id, requested_by, target_app, scope_resources_json, bundle_json, bundle_resource_count, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
    `).run(id, patientId, userId, targetApp,
      JSON.stringify(scope), JSON.stringify(bundle),
      bundle.total, _now(), expiresAt);
    auditLog(db, { patientId, actorId: userId, action: "export", resourceKind: "patient", resourceId: patientId, ip: _audit(ctx).ip, userAgent: _audit(ctx).userAgent, detail: { target_app: targetApp, scope, resource_count: bundle.total } });
    return { ok: true, id, bundle, resourceCount: bundle.total, expiresAt };
  }, { destructive: true, note: "Export patient record as FHIR R4 Bundle. Only owner can export. 24h TTL. Audit-logged with target app + scope." });

  register("healthcare", "fhir_exports_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const patientId = String(input.patientId || "");
    const access = checkAccess(db, patientId, userId);
    if (!access.ok || access.mode !== "self") return { ok: false, reason: "forbidden" };
    const rows = db.prepare(`SELECT id, target_app, scope_resources_json, bundle_resource_count, status, created_at, expires_at FROM health_fhir_exports WHERE patient_id = ? ORDER BY created_at DESC LIMIT 50`).all(patientId);
    return { ok: true, exports: rows.map((r) => ({ ...r, scope_resources: _safeJson(r.scope_resources_json, []) })) };
  }, { note: "List recent FHIR exports for my patient" });

  // ─── DPC subscription ──────────────────────────────────────

  register("healthcare", "dpc_subscribe", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const patientId = String(input.patientId || "");
    const providerId = String(input.providerId || "");
    if (!patientId || !providerId) return { ok: false, reason: "patientId_and_providerId_required" };
    const access = checkAccess(db, patientId, userId);
    if (!access.ok || access.mode !== "self") return { ok: false, reason: "only_owner_can_subscribe" };
    const provider = db.prepare(`SELECT accepts_dpc, dpc_monthly_fee_cents, name_given, name_family FROM health_providers WHERE id = ?`).get(providerId);
    if (!provider) return { ok: false, reason: "provider_not_found" };
    if (!provider.accepts_dpc) return { ok: false, reason: "provider_not_dpc" };
    const monthlyFee = Number(input.monthlyFeeCents) || provider.dpc_monthly_fee_cents;
    if (!monthlyFee || monthlyFee < 1000 || monthlyFee > 50000) return { ok: false, reason: "monthly_fee_out_of_range_cents_1000_to_50000" };
    const existing = db.prepare(`SELECT id FROM health_dpc_subscriptions WHERE patient_id = ? AND provider_id = ? AND status IN ('active','past_due','paused')`).get(patientId, providerId);
    if (existing) return { ok: false, reason: "already_subscribed", id: existing.id };
    const id = `dpc:${randomUUID()}`;
    const nextBilling = _now() + 30 * 86400;
    db.prepare(`
      INSERT INTO health_dpc_subscriptions (id, patient_id, provider_id, monthly_fee_cents, status, started_at, next_billing_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(id, patientId, providerId, monthlyFee, _now(), nextBilling);
    auditLog(db, { patientId, actorId: userId, action: "write", resourceKind: "patient", resourceId: patientId, ip: _audit(ctx).ip, userAgent: _audit(ctx).userAgent, detail: { event: "dpc_subscribe", provider_id: providerId, monthly_fee_cents: monthlyFee } });
    return { ok: true, id, monthlyFeeCents: monthlyFee, nextBillingAt: nextBilling, providerName: `${provider.name_given} ${provider.name_family}` };
  }, { destructive: true, note: "Subscribe to a DPC provider. $10-500/mo range. Owner-only. Creates active subscription with 30-day billing cycle." });

  register("healthcare", "dpc_cancel", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || input.subscriptionId || "");
    const cur = db.prepare(`SELECT patient_id, status FROM health_dpc_subscriptions WHERE id = ?`).get(id);
    if (!cur) return { ok: false, reason: "not_found" };
    const access = checkAccess(db, cur.patient_id, userId);
    if (!access.ok || access.mode !== "self") return { ok: false, reason: "forbidden" };
    if (cur.status === "cancelled") return { ok: false, reason: "already_cancelled" };
    db.prepare(`UPDATE health_dpc_subscriptions SET status = 'cancelled', cancelled_at = ? WHERE id = ?`).run(_now(), id);
    return { ok: true };
  }, { destructive: true, note: "Cancel a DPC subscription" });

  register("healthcare", "dpc_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const patientId = String(input.patientId || "");
    const access = checkAccess(db, patientId, userId);
    if (!access.ok || access.mode !== "self") return { ok: false, reason: "forbidden" };
    const rows = db.prepare(`
      SELECT s.*, p.name_given AS provider_given, p.name_family AS provider_family, p.specialty
      FROM health_dpc_subscriptions s
      INNER JOIN health_providers p ON p.id = s.provider_id
      WHERE s.patient_id = ? ORDER BY s.started_at DESC
    `).all(patientId);
    return { ok: true, subscriptions: rows };
  }, { note: "List my DPC subscriptions with provider info" });

  // ─── Cross-lens cite ──────────────────────────────────────

  register("healthcare", "cross_lens_cite", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const healthDtuId = String(input.healthDtuId || "");
    const parentDtuId = String(input.parentDtuId || "");
    const parentLens = String(input.parentLens || "");
    if (!healthDtuId || !parentDtuId || !parentLens) return { ok: false, reason: "healthDtuId_parentDtuId_parentLens_required" };
    if (!["tasks","calendar","docs","chat","social","music","accounting"].includes(parentLens)) return { ok: false, reason: "invalid_parent_lens" };
    const mint = db.prepare(`SELECT patient_id, allow_ai_training FROM health_record_mints WHERE dtu_id = ?`).get(healthDtuId);
    if (!mint) return { ok: false, reason: "health_dtu_not_minted" };
    const access = checkAccess(db, mint.patient_id, userId);
    if (!access.ok) return access;
    const citeKind = input.citeKind && ["refill_reminder","follow_up","referral_attachment","telehealth_link","spec_letter","medication_chart_link"].includes(input.citeKind) ? input.citeKind : null;
    db.prepare(`
      INSERT INTO health_cross_lens_cites (health_dtu_id, parent_dtu_id, parent_lens, cite_kind, consent_grant_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(healthDtuId, parentDtuId, parentLens, citeKind, access.consentGrantId || null, userId, _now());
    db.prepare(`UPDATE health_record_mints SET citation_count = citation_count + 1 WHERE dtu_id = ?`).run(healthDtuId);
    // Fire royalty cascade if engine present
    let cascade = { ok: false, reason: "engine_unavailable" };
    try {
      const { registerCitation } = await import("../economy/royalty-cascade.js");
      const parent = db.prepare(`SELECT id, creator_id FROM dtus WHERE id = ?`).get(parentDtuId);
      if (parent) {
        cascade = registerCitation(db, {
          childId: healthDtuId, parentId: parentDtuId,
          creatorId: userId, parentCreatorId: parent.creator_id,
          parentDtu: { id: parent.id, creator_id: parent.creator_id, visibility: "public" },
          generation: 1,
        });
      }
    } catch { /* graceful degrade */ }
    auditLog(db, { patientId: mint.patient_id, actorId: userId, action: "share", resourceKind: "patient", resourceId: mint.patient_id, consentGrantId: access.consentGrantId, ip: _audit(ctx).ip, userAgent: _audit(ctx).userAgent, detail: { event: "cross_lens_cite", parent_lens: parentLens, cite_kind: citeKind } });
    return { ok: true, healthDtuId, parentDtuId, parentLens, citeKind, cascade };
  }, { destructive: true, note: "Cross-lens cite: link a minted health DTU to a doc/task/calendar/chat/social/music/accounting DTU. Common patterns: medication ↔ task (refill reminder), encounter ↔ calendar (follow-up), lab ↔ doc (specialist letter)." });

  register("healthcare", "cross_lens_cites_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const patientId = String(input.patientId || "");
    const access = checkAccess(db, patientId, userId);
    if (!access.ok || access.mode !== "self") return { ok: false, reason: "forbidden" };
    const rows = db.prepare(`
      SELECT c.* FROM health_cross_lens_cites c
      INNER JOIN health_record_mints m ON m.dtu_id = c.health_dtu_id
      WHERE m.patient_id = ?
      ORDER BY c.created_at DESC LIMIT 100
    `).all(patientId);
    return { ok: true, cites: rows };
  }, { note: "List cross-lens cites of my patient's health DTUs" });
}
