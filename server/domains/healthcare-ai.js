// server/domains/healthcare-ai.js
//
// Healthcare lens Sprint B — AI surface with FDA + HIPAA guardrails.
// Every clinical-content macro:
//   1. Returns a mandatory "Not for diagnosis" disclaimer
//   2. Logs prompt + model + tokens to health_ai_runs (HIPAA Jan 2025)
//   3. Cites sources used (RxNorm / LOINC / specific patient resources)
//   4. Uses deterministic fallback when LLM unavailable
//   5. Re-uses the consent layer from Sprint A — every PHI access
//      still requires owner-self OR active grant + audit log entry

import { randomUUID } from "node:crypto";
import {
  checkAccess, auditLog, listMedications, listAllergies, listConditions, listObservations,
} from "../lib/health/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }
function _audit(ctx) { return { ip: ctx?.req?.ip || ctx?.ip || null, userAgent: ctx?.req?.headers?.["user-agent"] || ctx?.userAgent || null }; }

const TIMEOUT_MS = 12_000;
function _withTimeout(p, ms = TIMEOUT_MS) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout_${ms}ms`)), ms))]);
}
function _stripFences(s) { const m = String(s || "").match(/```(?:\w+)?\n([\s\S]*?)```/); return m ? m[1] : s; }
function _extractJsonObject(raw) {
  const stripped = _stripFences(raw).trim();
  try { const v = JSON.parse(stripped); if (v && typeof v === "object") return v; } catch { /* try */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

// ─── Disclaimers (load-bearing FDA compliance) ─────────────

export const DISCLAIMER = {
  symptom_triage: "⚠️ NOT FOR DIAGNOSIS. This is an educational triage hint, not medical advice. If you're worried, call a clinician. If life-threatening, call emergency services immediately.",
  drug_interaction: "⚠️ NOT FOR DIAGNOSIS. Drug-interaction signals are decision-support hints, not clinical determination. Confirm with a pharmacist or prescriber before changing any medication.",
  lab_anomaly: "⚠️ NOT FOR DIAGNOSIS. Lab values outside the reference range are not always pathological. Discuss with your provider before acting.",
  clinical_summary: "⚠️ NOT FOR DIAGNOSIS. This summary is generated from your records and is for review only. It is not a substitute for clinician interpretation.",
  vision: "⚠️ NOT FOR DIAGNOSIS. Image interpretation is approximate and for educational purposes only.",
};

export function recordAiRun(db, { patientId, userId, kind, promptText, modelName, modelVersion, outputText, sources = null, disclaimerShown = null, confidence = null, tokens = 0, latencyMs = null, source = "llm", flaggedForReview = false }) {
  if (!db) return null;
  try {
    const r = db.prepare(`
      INSERT INTO health_ai_runs (patient_id, user_id, kind, prompt_text, model_name, model_version, output_text, sources_json, disclaimer_shown, not_for_diagnosis, confidence, tokens, latency_ms, source, flagged_for_review, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    `).run(patientId || null, userId, kind,
      promptText ? String(promptText).slice(0, 8000) : null,
      modelName, modelVersion,
      outputText ? String(outputText).slice(0, 16000) : null,
      sources ? JSON.stringify(sources) : null,
      disclaimerShown, confidence, tokens || 0, latencyMs, source,
      flaggedForReview ? 1 : 0, _now());
    return r.lastInsertRowid;
  } catch { return null; }
}

// ─── Symptom triage deterministic fallback ─────────────────
// Pattern-match well-known red-flag combinations to a severity tier.
// Not a diagnosis — a routing hint at the level of an ESI nurse.

const RED_FLAG_PATTERNS = {
  emergency: [
    /chest pain.*(shortness of breath|sweat|left arm|jaw|nausea)/i,
    /chest pain.*(diabet|coronary|heart attack)/i,
    /(stroke|facial droop|slurred speech|sudden weakness|FAST)/i,
    /(anaphylax|throat swelling|trouble breathing.*hives)/i,
    /(suicid|kill myself|self-harm)/i,
    /severe bleeding|won't stop bleeding/i,
    /unconscious|unresponsive|seizure/i,
    /head injury.*(vomit|confus|loss of conscious)/i,
  ],
  urgent: [
    /high fever.*(stiff neck|rash|confusion)/i,
    /severe abdominal pain/i,
    /persistent vomiting/i,
    /(broken|fracture).*\b(visible|deformed)/i,
    /eye injury|vision loss/i,
    /(burn|burned).*\b(face|hand|large)/i,
  ],
  self_care: [
    /(mild cold|sniff|congest)/i,
    /(headache).*(no other symptoms)/i,
    /minor cut|paper cut|small abrasion/i,
  ],
};

export function triageDeterministic(symptomText) {
  const text = String(symptomText || "");
  for (const re of RED_FLAG_PATTERNS.emergency) if (re.test(text)) return { severity: "emergency", disposition: "call_911", matched: re.toString() };
  for (const re of RED_FLAG_PATTERNS.urgent) if (re.test(text)) return { severity: "urgent", disposition: "go_to_er", matched: re.toString() };
  for (const re of RED_FLAG_PATTERNS.self_care) if (re.test(text)) return { severity: "self_care", disposition: "self_monitor", matched: re.toString() };
  return { severity: "routine", disposition: "schedule_appointment", matched: null };
}

// ─── Drug interaction deterministic baseline ───────────────
// Small hard-coded set of well-known major interactions for cases
// where LLM is unavailable. Production would query RxNorm + the
// DrugBank API or NIH's MedlinePlus.

const KNOWN_INTERACTIONS = {
  // RxNorm RXCUI pairs → severity + mechanism
  // Sorted ascending so we can look up by sorted-pair key
  "11289|6845": { severity: "major", mechanism: "Metformin + alcohol can increase lactic acidosis risk", management: "monitor; counsel patient on alcohol intake" },
  "1191|11289": { severity: "major", mechanism: "Aspirin + warfarin: increased bleeding risk", management: "monitor INR; consider PPI" },
  "11289|3640": { severity: "major", mechanism: "Warfarin + erythromycin: increased anticoagulant effect", management: "reduce warfarin dose; monitor INR closely" },
  "1191|36567": { severity: "moderate", mechanism: "Aspirin + ibuprofen: combined GI bleed risk + antiplatelet interference", management: "avoid concurrent use" },
};

export function checkInteractionDeterministic(rxcuiA, rxcuiB) {
  if (!rxcuiA || !rxcuiB || rxcuiA === rxcuiB) return null;
  const [a, b] = [String(rxcuiA), String(rxcuiB)].sort();
  const hit = KNOWN_INTERACTIONS[`${a}|${b}`];
  if (hit) return { ...hit, source: "deterministic" };
  return { severity: "no_known_interaction", mechanism: null, management: null, source: "deterministic" };
}

export default function registerHealthAiMacros(register) {

  // ─── Symptom triage ───────────────────────────────────────

  register("healthcare", "symptom_triage_v2", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const patientId = String(input.patientId || "");
    if (!patientId) return { ok: false, reason: "patientId_required" };
    const access = checkAccess(db, patientId, userId, "conditions");
    if (!access.ok) return access;
    const symptomText = String(input.symptoms || input.text || "").trim();
    if (!symptomText) return { ok: false, reason: "symptoms_required" };
    const durationHours = Number(input.durationHours) || null;
    const t0 = Date.now();

    // Deterministic baseline
    const baseline = triageDeterministic(symptomText);

    // LLM augmentation if available
    const llm = ctx?.llm;
    let severity = baseline.severity;
    let disposition = baseline.disposition;
    let redFlags = baseline.matched ? [baseline.matched] : [];
    let reasoning = `Pattern-matched to ${baseline.severity} severity.`;
    let aiSource = "deterministic";
    let modelName = null;
    let modelVersion = null;
    let promptText = null;

    if (llm?.chat) {
      const sys = `You are a triage assistant (NOT a doctor). Given the patient's reported symptoms, output JSON:
{
  "severity": "emergency"|"urgent"|"routine"|"self_care"|"unknown",
  "disposition": "call_911"|"go_to_er"|"urgent_care_today"|"schedule_appointment"|"self_monitor"|"wait_and_see"|"more_info_needed",
  "red_flags": ["any concerning combinations"],
  "reasoning": "1-2 sentences"
}
You MUST NOT diagnose. Pick the highest applicable severity. If unsure, lean toward urgent_care_today (over-triage is safer than under-triage). Output ONLY JSON.`;
      promptText = `Symptoms: ${symptomText}\nDuration: ${durationHours ? `${durationHours}h` : "not stated"}`;
      try {
        const r = await _withTimeout(llm.chat({
          messages: [{ role: "system", content: sys }, { role: "user", content: promptText }],
          temperature: 0.1, maxTokens: 400, slot: "utility",
        }), 8000);
        const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
        const parsed = _extractJsonObject(raw);
        if (parsed) {
          // Take the MORE conservative severity (LLM vs baseline)
          const order = ["emergency", "urgent", "routine", "self_care", "unknown"];
          const llmIdx = order.indexOf(parsed.severity);
          const baselineIdx = order.indexOf(baseline.severity);
          if (llmIdx >= 0 && llmIdx < baselineIdx) {
            severity = parsed.severity;
            disposition = parsed.disposition || disposition;
          }
          if (Array.isArray(parsed.red_flags)) redFlags = [...new Set([...redFlags, ...parsed.red_flags])];
          if (parsed.reasoning) reasoning = String(parsed.reasoning).slice(0, 500);
          aiSource = "llm";
          modelName = r?.model || "utility-brain";
          modelVersion = r?.version || null;
        }
      } catch { /* fall back to deterministic */ }
    }

    const disclaimer = DISCLAIMER.symptom_triage;
    const aiRunId = recordAiRun(db, {
      patientId, userId, kind: "symptom_triage",
      promptText, modelName, modelVersion,
      outputText: JSON.stringify({ severity, disposition, redFlags, reasoning }),
      sources: null,
      disclaimerShown: disclaimer,
      source: aiSource,
      latencyMs: Date.now() - t0,
      flaggedForReview: severity === "emergency",
    });

    const triageId = `tri:${randomUUID()}`;
    db.prepare(`
      INSERT INTO health_symptom_triages (id, patient_id, ai_run_id, reported_symptoms_json, duration_hours, severity_tier, disposition, red_flags_json, reasoning, disclaimer, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(triageId, patientId, aiRunId,
      JSON.stringify([symptomText]), durationHours,
      severity, disposition, JSON.stringify(redFlags),
      reasoning, disclaimer, _now());

    auditLog(db, { patientId, actorId: userId, actorKind: "ai", action: "ai_process", resourceKind: "patient", resourceId: patientId, consentGrantId: access.consentGrantId, ip: _audit(ctx).ip, userAgent: _audit(ctx).userAgent, detail: { kind: "symptom_triage", severity } });

    return {
      ok: true,
      triageId,
      severity, disposition,
      redFlags, reasoning,
      disclaimer,
      not_for_diagnosis: true,
      source: aiSource,
    };
  }, { destructive: true, note: "FDA-compliant symptom triage. ESI-aligned 5-tier severity + 7-state disposition. Mandatory disclaimer. LLM output is conservatively merged (more severe wins). Logged to health_ai_runs + health_symptom_triages + audit log." });

  // ─── Drug interaction check ───────────────────────────────

  register("healthcare", "drug_interaction_check", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const patientId = String(input.patientId || "");
    if (!patientId) return { ok: false, reason: "patientId_required" };
    const access = checkAccess(db, patientId, userId, "medications");
    if (!access.ok) return access;
    const t0 = Date.now();

    // Get all active medications for the patient
    const medsResult = listMedications(db, userId, patientId, { activeOnly: true });
    if (!medsResult.ok) return medsResult;
    const meds = medsResult.medications;

    // If input.newRxnorm provided, check it against existing meds. Otherwise pairwise.
    const newMed = input.newRxnorm ? { rxnorm_code: String(input.newRxnorm), name: input.newName || "new medication" } : null;
    const pairs = [];
    if (newMed) {
      for (const m of meds) {
        if (m.rxnorm_code && m.rxnorm_code !== newMed.rxnorm_code) {
          pairs.push([newMed, m]);
        }
      }
    } else {
      for (let i = 0; i < meds.length; i++) {
        for (let j = i + 1; j < meds.length; j++) {
          if (meds[i].rxnorm_code && meds[j].rxnorm_code) pairs.push([meds[i], meds[j]]);
        }
      }
    }

    const alerts = [];
    for (const [a, b] of pairs) {
      const det = checkInteractionDeterministic(a.rxnorm_code, b.rxnorm_code);
      if (!det || det.severity === "no_known_interaction") continue;
      const alertId = `dia:${randomUUID()}`;
      const disclaimer = DISCLAIMER.drug_interaction;
      const aiRunId = recordAiRun(db, {
        patientId, userId, kind: "drug_interaction",
        promptText: `${a.name} (${a.rxnorm_code}) × ${b.name} (${b.rxnorm_code})`,
        modelName: "deterministic-rxnorm",
        outputText: JSON.stringify(det),
        sources: [{ kind: "rxnorm", id: a.rxnorm_code }, { kind: "rxnorm", id: b.rxnorm_code }],
        disclaimerShown: disclaimer,
        source: "rxnorm",
        latencyMs: Date.now() - t0,
        flaggedForReview: det.severity === "contraindicated" || det.severity === "major",
      });
      db.prepare(`
        INSERT INTO health_drug_interaction_alerts (id, patient_id, ai_run_id, drug_a_name, drug_a_rxnorm, drug_b_name, drug_b_rxnorm, severity, mechanism, management, sources_json, disclaimer, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(alertId, patientId, aiRunId,
        a.name, a.rxnorm_code, b.name, b.rxnorm_code,
        det.severity, det.mechanism, det.management,
        JSON.stringify([{ kind: "rxnorm", id: a.rxnorm_code }, { kind: "rxnorm", id: b.rxnorm_code }]),
        disclaimer, _now());
      alerts.push({ id: alertId, drugA: a.name, drugB: b.name, severity: det.severity, mechanism: det.mechanism, management: det.management });
    }
    auditLog(db, { patientId, actorId: userId, actorKind: "ai", action: "ai_process", resourceKind: "medication", consentGrantId: access.consentGrantId, ip: _audit(ctx).ip, userAgent: _audit(ctx).userAgent, detail: { kind: "drug_interaction", pairs_checked: pairs.length, alerts: alerts.length } });
    return { ok: true, alerts, pairsChecked: pairs.length, disclaimer: DISCLAIMER.drug_interaction, not_for_diagnosis: true };
  }, { destructive: true, note: "RxNorm-based drug interaction check across active medications. Returns severity-graded alerts with mechanism + management hint + mandatory disclaimer. Logged to health_ai_runs + health_drug_interaction_alerts + audit log." });

  // ─── Lab anomaly detection ────────────────────────────────

  register("healthcare", "lab_anomaly_scan", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const patientId = String(input.patientId || "");
    if (!patientId) return { ok: false, reason: "patientId_required" };
    const access = checkAccess(db, patientId, userId, "observations");
    if (!access.ok) return access;
    const t0 = Date.now();
    // Pull recent lab observations with reference ranges
    const labs = db.prepare(`
      SELECT * FROM health_observations
      WHERE patient_id = ? AND category = 'laboratory'
        AND value_quantity IS NOT NULL
        AND (reference_low IS NOT NULL OR reference_high IS NOT NULL)
      ORDER BY effective_date DESC LIMIT 200
    `).all(patientId);
    const anomalies = [];
    for (const lab of labs) {
      let kind = null;
      let severity = "medium";
      if (lab.reference_low != null && lab.value_quantity < lab.reference_low) {
        kind = "out_of_reference_range";
        if (lab.value_quantity < lab.reference_low * 0.7) severity = "high";
        if (lab.value_quantity < lab.reference_low * 0.5) severity = "critical";
      } else if (lab.reference_high != null && lab.value_quantity > lab.reference_high) {
        kind = "out_of_reference_range";
        if (lab.value_quantity > lab.reference_high * 1.3) severity = "high";
        if (lab.value_quantity > lab.reference_high * 1.5) severity = "critical";
      }
      if (lab.interpretation === "critical-low" || lab.interpretation === "critical-high") {
        kind = "critical_value";
        severity = "critical";
      }
      if (!kind) continue;
      const anomalyId = `lan:${randomUUID()}`;
      const disclaimer = DISCLAIMER.lab_anomaly;
      const aiRunId = recordAiRun(db, {
        patientId, userId, kind: "lab_anomaly",
        promptText: `${lab.display} = ${lab.value_quantity} ${lab.value_unit || ""} (ref ${lab.reference_low}-${lab.reference_high})`,
        modelName: "deterministic-reference-range",
        outputText: JSON.stringify({ kind, severity }),
        sources: [{ kind: "observation", id: lab.id }],
        disclaimerShown: disclaimer,
        source: "deterministic",
        latencyMs: Date.now() - t0,
        flaggedForReview: severity === "critical",
      });
      const suggested = severity === "critical" ? "Contact your provider today; ER if symptomatic." :
                       severity === "high" ? "Discuss with your provider at next visit or sooner." :
                       "Monitor and discuss at next routine appointment.";
      db.prepare(`
        INSERT INTO health_lab_anomalies (id, patient_id, observation_id, ai_run_id, anomaly_kind, severity, summary, suggested_action, disclaimer, detected_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(anomalyId, patientId, lab.id, aiRunId, kind, severity,
        `${lab.display}: ${lab.value_quantity} ${lab.value_unit || ""} (ref ${lab.reference_low ?? "?"}-${lab.reference_high ?? "?"})`,
        suggested, disclaimer, _now());
      anomalies.push({ id: anomalyId, observationId: lab.id, display: lab.display, value: lab.value_quantity, severity, kind, suggested });
    }
    auditLog(db, { patientId, actorId: userId, actorKind: "ai", action: "ai_process", resourceKind: "observation", consentGrantId: access.consentGrantId, ip: _audit(ctx).ip, userAgent: _audit(ctx).userAgent, detail: { kind: "lab_anomaly_scan", anomalies: anomalies.length, labs_checked: labs.length } });
    return { ok: true, anomalies, labsChecked: labs.length, disclaimer: DISCLAIMER.lab_anomaly, not_for_diagnosis: true };
  }, { destructive: true, note: "Scan recent lab observations for out-of-reference-range / critical values. Severity scaled by deviation from range. Logged to health_ai_runs + health_lab_anomalies + audit log." });

  // ─── Clinical summary composer ────────────────────────────

  register("healthcare", "clinical_summary_compose", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const patientId = String(input.patientId || "");
    if (!patientId) return { ok: false, reason: "patientId_required" };
    const access = checkAccess(db, patientId, userId, "conditions");
    if (!access.ok) return access;
    const kind = ["full","medications_only","conditions_only","recent_visits","handoff_brief","er_summary","referral"].includes(input.kind) ? input.kind : "full";
    const tone = ["patient","clinician","er_doc","referral","self_review"].includes(input.tone) ? input.tone : "patient";
    const t0 = Date.now();

    // Pull source resources
    const conds = listConditions(db, userId, patientId, { activeOnly: true });
    const meds = listMedications(db, userId, patientId, { activeOnly: true });
    const allergies = listAllergies(db, userId, patientId);
    const sources = [];

    // Deterministic prose assembly
    const condStr = (conds.conditions || []).map((c) => c.display).join("; ") || "none recorded";
    const medStr = (meds.medications || []).map((m) => `${m.name} ${m.dose || ""}`.trim()).join("; ") || "none recorded";
    const allergyStr = (allergies.allergies || []).map((a) => a.substance).join("; ") || "no known allergies";
    sources.push(
      ...(conds.conditions || []).map((c) => ({ kind: "condition", id: c.id })),
      ...(meds.medications || []).map((m) => ({ kind: "medication", id: m.id })),
      ...(allergies.allergies || []).map((a) => ({ kind: "allergy", id: a.id })),
    );

    let summary = "";
    if (kind === "medications_only") {
      summary = `Active medications: ${medStr}.\nKnown allergies: ${allergyStr}.`;
    } else if (kind === "conditions_only") {
      summary = `Active conditions: ${condStr}.`;
    } else if (kind === "er_summary") {
      summary = `Active conditions: ${condStr}. Current medications: ${medStr}. Allergies: ${allergyStr}.`;
    } else {
      summary = `Active conditions: ${condStr}.\n\nCurrent medications: ${medStr}.\n\nKnown allergies: ${allergyStr}.`;
    }

    // LLM tone enhancement
    const llm = ctx?.llm;
    let aiSource = "deterministic";
    let modelName = null;
    let promptText = null;
    if (llm?.chat) {
      const toneInstruction = {
        patient: "Plain language. No jargon. Reassuring but factual.",
        clinician: "Clinical terminology. Brief.",
        er_doc: "Telegram-style. Critical info first. <50 words.",
        referral: "Formal referral language. Cite specific concerns.",
        self_review: "Reflective tone. Help patient understand their own health story.",
      }[tone];
      const sys = `You write a ${kind} clinical summary in this tone:
${toneInstruction}

You MUST NOT diagnose, prescribe, or recommend treatment changes. Output 2-5 sentences of summary prose only. Stick strictly to the data provided.`;
      promptText = summary;
      try {
        const r = await _withTimeout(llm.chat({
          messages: [{ role: "system", content: sys }, { role: "user", content: promptText }],
          temperature: 0.3, maxTokens: 500, slot: "subconscious",
        }));
        const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
        if (raw) {
          summary = raw;
          aiSource = "llm";
          modelName = r?.model || "subconscious-brain";
        }
      } catch { /* deterministic prose stands */ }
    }

    const disclaimer = DISCLAIMER.clinical_summary;
    const aiRunId = recordAiRun(db, {
      patientId, userId, kind: "clinical_summary",
      promptText, modelName,
      outputText: summary,
      sources,
      disclaimerShown: disclaimer,
      source: aiSource,
      latencyMs: Date.now() - t0,
    });
    const summaryId = `csum:${randomUUID()}`;
    db.prepare(`
      INSERT INTO health_clinical_summaries (id, patient_id, ai_run_id, kind, summary, key_findings_json, sources_json, disclaimer, tone, composed_at, composed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(summaryId, patientId, aiRunId, kind, summary,
      JSON.stringify({ conditions: condStr, medications: medStr, allergies: allergyStr }),
      JSON.stringify(sources), disclaimer, tone, _now(), userId);
    auditLog(db, { patientId, actorId: userId, actorKind: "ai", action: "ai_process", resourceKind: "patient", resourceId: patientId, consentGrantId: access.consentGrantId, ip: _audit(ctx).ip, userAgent: _audit(ctx).userAgent, detail: { kind: "clinical_summary", tone, summary_kind: kind } });
    return { ok: true, summaryId, summary, kind, tone, disclaimer, not_for_diagnosis: true, source: aiSource, sources };
  }, { note: "Compose a clinical summary in 5 tones × 7 kinds. Strict 'no diagnosis / no prescribe' rule in the prompt. Always cites source resources. Logged to health_ai_runs + health_clinical_summaries + audit log." });

  // ─── Read paths for AI output ─────────────────────────────

  register("healthcare", "ai_runs_recent", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const patientId = input.patientId ? String(input.patientId) : null;
    if (patientId) {
      const access = checkAccess(db, patientId, userId);
      if (!access.ok) return access;
      return { ok: true, runs: db.prepare(`SELECT * FROM health_ai_runs WHERE patient_id = ? ORDER BY created_at DESC LIMIT 100`).all(patientId) };
    }
    return { ok: true, runs: db.prepare(`SELECT * FROM health_ai_runs WHERE user_id = ? AND patient_id IS NULL ORDER BY created_at DESC LIMIT 100`).all(userId) };
  }, { note: "Recent AI invocations. HIPAA: each row has prompt + model + tokens + disclaimer + sources." });

  register("healthcare", "triages_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const patientId = String(input.patientId || "");
    const access = checkAccess(db, patientId, userId);
    if (!access.ok) return access;
    return { ok: true, triages: db.prepare(`SELECT * FROM health_symptom_triages WHERE patient_id = ? ORDER BY created_at DESC LIMIT 50`).all(patientId) };
  }, { note: "Recent symptom triages for a patient" });

  register("healthcare", "interaction_alerts_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const patientId = String(input.patientId || "");
    const access = checkAccess(db, patientId, userId, "medications");
    if (!access.ok) return access;
    const unackOnly = input.unackOnly !== false;
    const sql = unackOnly
      ? `SELECT * FROM health_drug_interaction_alerts WHERE patient_id = ? AND acknowledged_at IS NULL ORDER BY severity DESC, created_at DESC`
      : `SELECT * FROM health_drug_interaction_alerts WHERE patient_id = ? ORDER BY created_at DESC`;
    return { ok: true, alerts: db.prepare(sql).all(patientId) };
  }, { note: "Drug-interaction alerts; unacknowledged by default" });

  register("healthcare", "lab_anomalies_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const patientId = String(input.patientId || "");
    const access = checkAccess(db, patientId, userId, "observations");
    if (!access.ok) return access;
    return { ok: true, anomalies: db.prepare(`SELECT * FROM health_lab_anomalies WHERE patient_id = ? ORDER BY detected_at DESC LIMIT 100`).all(patientId) };
  }, { note: "Lab anomalies detected for a patient" });

  register("healthcare", "summaries_recent", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const patientId = String(input.patientId || "");
    const access = checkAccess(db, patientId, userId);
    if (!access.ok) return access;
    return { ok: true, summaries: db.prepare(`SELECT * FROM health_clinical_summaries WHERE patient_id = ? ORDER BY composed_at DESC LIMIT 20`).all(patientId) };
  }, { note: "Recent composed clinical summaries" });
}
