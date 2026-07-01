// server/domains/healthcare.js
// Domain actions for healthcare: drug interaction checks, protocol matching, patient summaries.

import { callVision, callVisionUrl, visionPromptForDomain } from "../lib/vision-inference.js";

export default function registerHealthcareActions(registerLensAction) {
  registerLensAction("healthcare", "vision", async (ctx, artifact, _params) => {
    const { imageB64, imageUrl } = artifact.data || {};
    if (!imageB64 && !imageUrl) return { ok: false, error: "imageB64 or imageUrl required" };
    const prompt = visionPromptForDomain("healthcare");
    return imageUrl ? callVisionUrl(imageUrl, prompt) : callVision(imageB64, prompt);
  });
  /**
   * checkInteractions
   * Cross-reference the patient's current prescriptions for known drug-drug
   * interactions. artifact.data.prescriptions is an array of
   * { drug, rxcui, dose, route, frequency }.
   * params.knownInteractions is an optional lookup array of
   * { pair: [rxcui1, rxcui2], severity, description }.
   */
  registerLensAction("healthcare", "checkInteractions", (ctx, artifact, params) => {
  try {
    const prescriptions = artifact.data.prescriptions || [];
    const knownInteractions = params.knownInteractions || artifact.data.knownInteractions || [];

    if (prescriptions.length < 2) {
      return { ok: true, result: { interactions: [], message: "Fewer than 2 active prescriptions; no interactions possible." } };
    }

    // Build a set of active RxCUI codes
    const activeCodes = new Set(prescriptions.map((p) => String(p.rxcui)));

    // Check every known interaction pair against the active list
    const found = [];
    for (const interaction of knownInteractions) {
      const [a, b] = (interaction.pair || []).map(String);
      if (activeCodes.has(a) && activeCodes.has(b)) {
        const drugA = prescriptions.find((p) => String(p.rxcui) === a);
        const drugB = prescriptions.find((p) => String(p.rxcui) === b);
        found.push({
          drugs: [drugA.drug, drugB.drug],
          rxcuis: [a, b],
          severity: interaction.severity || "unknown",
          description: interaction.description || "",
        });
      }
    }

    // Sort by severity: critical > major > moderate > minor > unknown
    const severityOrder = { critical: 0, major: 1, moderate: 2, minor: 3, unknown: 4 };
    found.sort((x, y) => (severityOrder[x.severity] ?? 4) - (severityOrder[y.severity] ?? 4));

    // Persist the check result onto the artifact
    artifact.data.lastInteractionCheck = {
      timestamp: new Date().toISOString(),
      interactionsFound: found.length,
      interactions: found,
    };

    return {
      ok: true,
      result: {
        interactions: found,
        totalChecked: prescriptions.length,
        interactionsFound: found.length,
        hasCritical: found.some((i) => i.severity === "critical"),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * protocolMatch
   * Match patient conditions (artifact.data.conditions) to care protocols
   * (artifact.data.protocols or params.protocols). Each protocol has
   * { id, name, triggerConditions: [...icd10], steps: [...] }.
   * A protocol matches when ALL of its triggerConditions are present in the
   * patient's active condition list.
   */
  registerLensAction("healthcare", "protocolMatch", (ctx, artifact, params) => {
  try {
    const conditions = (artifact.data.conditions || []).map((c) =>
      typeof c === "string" ? c : c.icd10 || c.code
    );
    const protocols = params.protocols || artifact.data.protocols || [];

    if (conditions.length === 0) {
      return { ok: true, result: { matched: [], message: "No active conditions on record." } };
    }

    const conditionSet = new Set(conditions.map((c) => c.toUpperCase()));

    const matched = [];
    const partial = [];

    for (const protocol of protocols) {
      const triggers = (protocol.triggerConditions || []).map((t) => t.toUpperCase());
      if (triggers.length === 0) continue;

      const matchedTriggers = triggers.filter((t) => conditionSet.has(t));
      const matchRatio = matchedTriggers.length / triggers.length;

      if (matchRatio === 1) {
        matched.push({
          protocolId: protocol.id,
          name: protocol.name,
          matchRatio: 1,
          steps: protocol.steps || [],
          matchedConditions: matchedTriggers,
        });
      } else if (matchRatio >= 0.5) {
        partial.push({
          protocolId: protocol.id,
          name: protocol.name,
          matchRatio: Math.round(matchRatio * 100) / 100,
          missingConditions: triggers.filter((t) => !conditionSet.has(t)),
          matchedConditions: matchedTriggers,
        });
      }
    }

    artifact.data.protocolMatches = {
      timestamp: new Date().toISOString(),
      fullMatches: matched.length,
      partialMatches: partial.length,
      matched,
      partial,
    };

    return {
      ok: true,
      result: {
        matched,
        partial,
        conditionsEvaluated: conditions.length,
        protocolsEvaluated: protocols.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * exportEncounter
   * Format encounter data into a structured export.
   * artifact.data.encounter or artifact.data: { patientName, date, chiefComplaints, diagnosis, plan, vitals, notes }
   */
  registerLensAction("healthcare", "exportEncounter", (ctx, artifact, _params) => {
  try {
    const enc = artifact.data.encounter || artifact.data;
    const patientName = enc.patientName || artifact.data.patientName || artifact.title;
    const date = enc.date || enc.encounterDate || new Date().toISOString().split("T")[0];
    const chiefComplaints = enc.chiefComplaints || enc.complaints || [];
    const diagnosis = enc.diagnosis || enc.diagnoses || [];
    const plan = enc.plan || enc.treatmentPlan || [];
    const vitals = enc.vitals || {};
    const provider = enc.provider || enc.physician || "";
    const notes = enc.notes || "";

    const exported = {
      exportedAt: new Date().toISOString(),
      patient: {
        name: patientName,
        id: artifact.data.patientId || artifact.id,
        dob: enc.dob || artifact.data.dob || null,
      },
      encounter: {
        date,
        provider,
        type: enc.type || "office-visit",
        chiefComplaints: Array.isArray(chiefComplaints) ? chiefComplaints : [chiefComplaints],
        vitals: {
          bp: vitals.bp || vitals.bloodPressure || null,
          hr: vitals.hr || vitals.heartRate || null,
          temp: vitals.temp || vitals.temperature || null,
          rr: vitals.rr || vitals.respiratoryRate || null,
          o2sat: vitals.o2sat || vitals.spO2 || null,
          weight: vitals.weight || null,
        },
        diagnosis: Array.isArray(diagnosis) ? diagnosis : [diagnosis],
        plan: Array.isArray(plan) ? plan : [plan],
        notes,
      },
    };

    artifact.data.lastExport = exported;

    return { ok: true, result: exported };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * soapAutoFill
   * Generate a SOAP note template from artifact data.
   * artifact.data: { chiefComplaint, symptoms, vitals, examFindings, conditions, assessment, medications, plan }
   */
  registerLensAction("healthcare", "soapAutoFill", (ctx, artifact, _params) => {
  try {
    const d = artifact.data;

    const subjective = {
      chiefComplaint: d.chiefComplaint || d.complaints?.[0] || "",
      hpi: d.hpi || d.historyOfPresentIllness || "",
      symptoms: d.symptoms || [],
      reviewOfSystems: d.reviewOfSystems || d.ros || {},
      allergies: d.allergies || [],
      medications: d.medications || d.prescriptions?.map(p => p.drug) || [],
      socialHistory: d.socialHistory || "",
      familyHistory: d.familyHistory || "",
    };

    const objective = {
      vitals: {
        bp: d.vitals?.bp || d.vitals?.bloodPressure || null,
        hr: d.vitals?.hr || d.vitals?.heartRate || null,
        temp: d.vitals?.temp || d.vitals?.temperature || null,
        rr: d.vitals?.rr || d.vitals?.respiratoryRate || null,
        o2sat: d.vitals?.o2sat || d.vitals?.spO2 || null,
        weight: d.vitals?.weight || null,
        height: d.vitals?.height || null,
      },
      examFindings: d.examFindings || d.physicalExam || {},
      labs: d.labs || d.labResults || [],
    };

    const conditions = d.conditions || d.diagnoses || [];
    const assessment = {
      diagnoses: Array.isArray(conditions)
        ? conditions.map(c => typeof c === "string" ? c : c.name || c.code || "")
        : [conditions],
      clinicalImpression: d.assessment || d.clinicalImpression || "",
    };

    const planSection = {
      orders: d.orders || [],
      prescriptions: d.prescriptions || d.newPrescriptions || [],
      procedures: d.procedures || [],
      referrals: d.referrals || [],
      followUp: d.followUp || d.plan?.followUp || "",
      patientEducation: d.patientEducation || [],
    };

    const soapNote = {
      generatedAt: new Date().toISOString(),
      patientName: d.patientName || artifact.title,
      patientId: d.patientId || artifact.id,
      date: d.date || new Date().toISOString().split("T")[0],
      subjective,
      objective,
      assessment,
      plan: planSection,
    };

    artifact.data.soapNote = soapNote;

    return { ok: true, result: soapNote };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * generateSummary
   * Create a consolidated patient summary from encounters, labs, and
   * treatments stored in artifact.data.
   * Expects artifact.data.encounters, artifact.data.labs, artifact.data.treatments.
   */
  registerLensAction("healthcare", "generateSummary", (ctx, artifact, params) => {
  try {
    const encounters = artifact.data.encounters || [];
    const labs = artifact.data.labs || [];
    const treatments = artifact.data.treatments || [];
    const prescriptions = artifact.data.prescriptions || [];
    const conditions = artifact.data.conditions || [];

    const periodDays = params.periodDays || 90;
    const cutoff = new Date(Date.now() - periodDays * 86400000);

    // Filter to the period
    const recentEncounters = encounters.filter((e) => new Date(e.date) >= cutoff);
    const recentLabs = labs.filter((l) => new Date(l.date) >= cutoff);
    const recentTreatments = treatments.filter((t) => new Date(t.startDate || t.date) >= cutoff);

    // Compute lab trends: for each test name, find most recent value and direction
    const labsByName = {};
    for (const lab of recentLabs) {
      const key = lab.testName || lab.name;
      if (!labsByName[key]) labsByName[key] = [];
      labsByName[key].push(lab);
    }

    const labTrends = {};
    for (const [name, values] of Object.entries(labsByName)) {
      const sorted = values.sort((a, b) => new Date(a.date) - new Date(b.date));
      const latest = sorted[sorted.length - 1];
      let trend = "stable";
      if (sorted.length >= 2) {
        const prev = sorted[sorted.length - 2];
        const latestVal = parseFloat(latest.value);
        const prevVal = parseFloat(prev.value);
        if (!isNaN(latestVal) && !isNaN(prevVal)) {
          const change = ((latestVal - prevVal) / Math.abs(prevVal || 1)) * 100;
          if (change > 5) trend = "increasing";
          else if (change < -5) trend = "decreasing";
        }
      }
      const isAbnormal =
        latest.referenceRange &&
        (parseFloat(latest.value) < parseFloat(latest.referenceRange.low) ||
          parseFloat(latest.value) > parseFloat(latest.referenceRange.high));

      labTrends[name] = {
        latestValue: latest.value,
        latestDate: latest.date,
        unit: latest.unit || "",
        trend,
        abnormal: !!isAbnormal,
        sampleCount: sorted.length,
      };
    }

    // Encounter type breakdown
    const encounterTypes = {};
    for (const enc of recentEncounters) {
      const type = enc.type || "general";
      encounterTypes[type] = (encounterTypes[type] || 0) + 1;
    }

    // Active medications count
    const activeMedications = prescriptions.filter(
      (p) => p.status === "active" || !p.status
    ).length;

    const summary = {
      patientId: artifact.data.patientId || artifact.id,
      patientName: artifact.data.patientName || artifact.title,
      periodDays,
      generatedAt: new Date().toISOString(),
      activeConditions: conditions.map((c) => (typeof c === "string" ? c : c.name || c.code)),
      encounterSummary: {
        total: recentEncounters.length,
        byType: encounterTypes,
        lastEncounter: recentEncounters.length
          ? recentEncounters.sort((a, b) => new Date(b.date) - new Date(a.date))[0].date
          : null,
      },
      labSummary: {
        totalTests: recentLabs.length,
        uniqueTests: Object.keys(labTrends).length,
        trends: labTrends,
        abnormalCount: Object.values(labTrends).filter((t) => t.abnormal).length,
      },
      treatmentSummary: {
        activeTreatments: recentTreatments.length,
        activeMedications,
      },
    };

    artifact.data.latestSummary = summary;

    return { ok: true, result: summary };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Parity-sprint macros: MyChart / Doximity / Teladoc / GoodRx / ZocDoc ───

  function getHealthState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.healthLens) {
      STATE.healthLens = { medications: new Map(), records: new Map(), appointments: new Map(), doseLog: new Map() };
    }
    const s = STATE.healthLens;
    // Phase 2 (Epic 2026 parity) backfills — append-only.
    if (!s.patients)      s.patients      = new Map();
    if (!s.problems)      s.problems      = new Map();
    if (!s.allergies)     s.allergies     = new Map();
    if (!s.vitals)        s.vitals        = new Map();
    if (!s.labs)          s.labs          = new Map();
    if (!s.immunizations) s.immunizations = new Map();
    if (!s.encounters)    s.encounters    = new Map();
    if (!s.smartPhrases)  s.smartPhrases  = new Map();
    if (!s.messages)      s.messages      = new Map();
    if (!s.refills)       s.refills       = new Map();
    if (!s.intakeForms)   s.intakeForms   = new Map();
    if (!s.orders)        s.orders        = new Map();
    if (!s.careTeam)      s.careTeam      = new Map();
    if (!s.seq)           s.seq           = new Map();
    return s;
  }
  function saveStateIfAvailable() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }

  registerLensAction("healthcare", "symptom-triage", async (ctx, _artifact, params = {}) => {
    if (!ctx?.llm?.chat) {
      return { ok: true, result: { severity: "see_doctor", candidates: [], reasoning: "AI unavailable. Consult a provider." } };
    }
    const regions = Array.isArray(params.regions) ? params.regions : [];
    const description = String(params.description || "").trim();
    const age = Math.max(0, Math.min(120, Number(params.age) || 30));
    const sex = ["M", "F", "X"].includes(params.sex) ? params.sex : "X";
    if (regions.length === 0 && !description) return { ok: false, error: "regions or description required" };
    const sys = `You are a medical triage decision-support tool. NEVER claim to diagnose. Output ONLY JSON:
{"severity":"self_care|see_doctor|er","candidates":[{"condition":"...","confidence":0.0-1.0,"citations":["CDC-XYZ","NICE-NG12"]}],"reasoning":"..."}
- severity reflects care urgency, not certainty
- candidates are POSSIBLE conditions, not diagnoses
- ALWAYS suggest 'er' for chest pain, sudden weakness, severe headache, difficulty breathing, suicidal ideation
- reasoning explains the triage decision in 1-2 sentences`;
    const user = `Body regions: ${regions.join(", ") || "(unspecified)"}\nFree-text: ${description || "(none)"}\nPatient: age ${age}, sex assigned at birth ${sex}\nTriage.`;
    try {
      const llmRes = await ctx.llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        temperature: 0.1, maxTokens: 800, slot: "conscious",
      });
      const raw = String(llmRes?.text || llmRes?.content || "").trim();
      const parsed = extractJsonHealth(raw);
      if (!parsed?.severity) return { ok: true, result: { severity: "see_doctor", candidates: [], reasoning: "Could not generate confident triage. Consult a provider." } };
      const sev = ["self_care", "see_doctor", "er"].includes(parsed.severity) ? parsed.severity : "see_doctor";
      const candidates = Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 5).map(c => ({
        condition: String(c.condition || ""),
        confidence: Math.max(0, Math.min(1, Number(c.confidence) || 0.5)),
        citations: Array.isArray(c.citations) ? c.citations.slice(0, 3).map(String) : [],
      })) : [];
      return { ok: true, result: { severity: sev, candidates, reasoning: String(parsed.reasoning || "") } };
    } catch (e) {
      return { ok: true, result: { severity: "see_doctor", candidates: [], reasoning: `Triage error: ${e?.message || "unknown"}. Consult a provider.` } };
    }
  });

  registerLensAction("healthcare", "medications-list", (ctx, _artifact, _params = {}) => {
  try {
    const state = getHealthState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const meds = state.medications.get(userId) || [];
    const today = new Date().toISOString().slice(0, 10);
    const doses = (state.doseLog.get(userId) || []).filter(d => d.at.slice(0, 10) === today);
    const enriched = meds.map(m => {
      const scheduledToday = scheduleToDosesPerDay(m.schedule);
      const takenToday = doses.filter(d => d.medId === m.id).length;
      return { ...m, dosesScheduledToday: scheduledToday, dosesTakenToday: takenToday, takenToday: takenToday >= scheduledToday };
    });
    return { ok: true, result: { medications: enriched } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "medications-add", (ctx, _artifact, params = {}) => {
    const state = getHealthState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const name = String(params.name || "").trim();
    const dose = String(params.dose || "").trim();
    const schedule = String(params.schedule || "daily");
    if (!name || !dose) return { ok: false, error: "name and dose required" };
    if (!state.medications.has(userId)) state.medications.set(userId, []);
    const med = {
      id: `med_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name, dose, schedule,
      prescribedBy: params.prescribedBy || null,
      refillRemaining: Number(params.refillRemaining) || 30,
      status: "active", createdAt: new Date().toISOString(),
    };
    state.medications.get(userId).push(med);
    saveStateIfAvailable();
    return { ok: true, result: { medication: med } };
  });

  registerLensAction("healthcare", "medications-log-dose", (ctx, _artifact, params = {}) => {
    const state = getHealthState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const medId = String(params.id || "");
    if (!medId) return { ok: false, error: "id required" };
    if (!state.doseLog.has(userId)) state.doseLog.set(userId, []);
    state.doseLog.get(userId).push({ id: `dose_${Date.now()}`, medId, at: new Date().toISOString() });
    saveStateIfAvailable();
    return { ok: true, result: { logged: true } };
  });

  registerLensAction("healthcare", "medications-delete", (ctx, _artifact, params = {}) => {
    const state = getHealthState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const id = String(params.id || "");
    const list = state.medications.get(userId) || [];
    const idx = list.findIndex(m => m.id === id);
    if (idx < 0) return { ok: false, error: "med not found" };
    list.splice(idx, 1);
    saveStateIfAvailable();
    return { ok: true, result: { id, deleted: true } };
  });

  /**
   * record-get — Returns the user's real personal health record.
   * Per "everything must be real" directive: no auto-seeded demo
   * vitals / allergies / immunizations / conditions. Users populate
   * via healthcare.record-update or an EHR FHIR R4 sync (Epic MyChart,
   * Cerner HealtheLife, Apple HealthKit clinical records).
   */
  registerLensAction("healthcare", "record-get", (ctx, _artifact, _params = {}) => {
    const state = getHealthState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const record = state.records.get(userId) || null;
    if (!record) {
      return {
        ok: true,
        result: {
          vitals: [], allergies: [], immunizations: [], conditions: [],
          source: "empty",
          notes: "No health record on file. POST via healthcare.record-update, sync FHIR R4 from your provider portal (Epic MyChart / Cerner / athenahealth), or import from Apple HealthKit clinical records.",
        },
      };
    }
    return { ok: true, result: record };
  });

  registerLensAction("healthcare", "providers-search", async (_ctx, _artifact, params = {}) => {
    // Real provider search via the CMS National Plan and Provider Enumeration
    // System (NPPES / NPI registry). Free, no key required, official
    // government source. ~8M+ providers in the US.
    // Docs: https://npiregistry.cms.hhs.gov/registry/help-api
    const taxonomy = String(params.specialty || params.taxonomy || "").trim();
    const zip = String(params.zipCode || params.postalCode || "").trim();
    const state = String(params.state || "").trim().toUpperCase();
    const city = String(params.city || "").trim();
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 20));
    const qs = new URLSearchParams({ version: "2.1", limit: String(limit) });
    if (taxonomy) qs.set("taxonomy_description", taxonomy);
    if (zip) qs.set("postal_code", zip);
    if (state) qs.set("state", state);
    if (city) qs.set("city", city);
    try {
      const url = `https://npiregistry.cms.hhs.gov/api/?${qs.toString()}`;
      const r = await globalThis.fetch(url);
      if (!r.ok) return { ok: false, error: `NPI registry ${r.status}` };
      const data = await r.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      const providers = results.map((rec) => {
        const basic = rec.basic || {};
        const addr = (rec.addresses || []).find((a) => a.address_purpose === "LOCATION") || (rec.addresses || [])[0] || {};
        const tax = (rec.taxonomies || []).find((t) => t.primary) || (rec.taxonomies || [])[0] || {};
        const name = basic.organization_name
          ? basic.organization_name
          : [basic.credential, basic.first_name, basic.last_name].filter(Boolean).join(" ").trim();
        return {
          id: `npi_${rec.number}`,
          npi: rec.number,
          name: name || `NPI ${rec.number}`,
          specialty: tax.desc || taxonomy || "Not specified",
          credential: basic.credential || null,
          practice: addr.address_1 ? `${addr.address_1}${addr.address_2 ? `, ${addr.address_2}` : ""}` : null,
          city: addr.city || null,
          state: addr.state || null,
          zip: addr.postal_code || null,
          phone: addr.telephone_number || null,
          fax: addr.fax_number || null,
          gender: basic.gender || null,
          enumeratedAt: basic.enumeration_date || null,
        };
      });
      return {
        ok: true,
        result: {
          providers,
          count: providers.length,
          totalMatching: data?.result_count ?? providers.length,
          source: "NPI registry (CMS NPPES)",
          query: { taxonomy, zip, state, city, limit },
        },
      };
    } catch (e) {
      return { ok: false, error: `NPI search failed: ${e?.message || "network"}` };
    }
  });

  /**
   * provider-slots — Real appointment-slot availability requires the
   * provider's scheduling system (Epic MyChart FHIR R4 `Slot` resource,
   * Cerner / athenahealth scheduling APIs, or per-clinic booking APIs
   * like Zocdoc Provider API). Per "everything must be real" directive,
   * we no longer synthesize a fake slot grid from a seed.
   */
  registerLensAction("healthcare", "provider-slots", (ctx, _artifact, params = {}) => {
  try {
    const state = getHealthState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const providerId = String(params.providerId || "");
    if (!providerId) return { ok: false, error: "providerId required" };
    const slots = state.providerSlots?.get(providerId) || [];
    return {
      ok: true,
      result: {
        slots,
        source: slots.length === 0 ? "empty" : "scheduling-feed",
        notes: slots.length === 0
          ? "No live availability. Wire FHIR R4 Slot endpoint (Epic MyChart / Cerner / athenahealth) or Zocdoc Provider API, or POST slots via healthcare.provider-slot-add."
          : null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "appointment-book", (ctx, _artifact, params = {}) => {
  try {
    const state = getHealthState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const providerId = String(params.providerId || "");
    const date = String(params.date || "");
    const time = String(params.time || "");
    const kind = ["telehealth", "in_person"].includes(params.kind) ? params.kind : "in_person";
    if (!providerId || !date || !time) return { ok: false, error: "providerId, date, time required" };
    if (!state.appointments.has(userId)) state.appointments.set(userId, []);
    const copayUsd = Number(params.copayUsd);
    const appt = {
      id: `appt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      providerId, date, time, kind,
      copayUsd: Number.isFinite(copayUsd) && copayUsd > 0 ? Math.round(copayUsd * 100) / 100 : 0,
      copayStatus: "unpaid",
      status: "booked", bookedAt: new Date().toISOString(),
    };
    state.appointments.get(userId).push(appt);
    saveStateIfAvailable();
    return { ok: true, result: { appointment: appt } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * appointment-charge-copay — Stripe PaymentIntent for the appointment
   * co-pay. Returns { clientSecret, paymentIntentId } so the patient-
   * portal frontend can confirm via Stripe Elements. The webhook
   * (server/economy/stripe.js payment_intent.succeeded) marks the
   * appointment copayStatus:'paid' on capture.
   *
   * Per "everything must be real" directive: real Stripe API call,
   * env-gated by STRIPE_SECRET_KEY, no synthetic copay processor.
   */
  registerLensAction("healthcare", "appointment-charge-copay", async (ctx, _artifact, params = {}) => {
    const state = getHealthState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const apptId = String(params.appointmentId || params.id || "");
    if (!apptId) return { ok: false, error: "appointmentId required" };
    const list = state.appointments.get(userId) || [];
    const appt = list.find((a) => a.id === apptId);
    if (!appt) return { ok: false, error: "appointment not found" };
    if (appt.copayStatus === "paid") return { ok: false, error: "copay already paid" };
    if (!appt.copayUsd || appt.copayUsd <= 0) return { ok: false, error: "appointment has no copay amount" };

    if (!process.env.STRIPE_SECRET_KEY) {
      return {
        ok: false,
        error: "Stripe not configured. Set STRIPE_SECRET_KEY env to enable co-pay charges.",
      };
    }
    const amountCents = Math.round(appt.copayUsd * 100);
    if (amountCents < 50) return { ok: false, error: "copay below Stripe minimum ($0.50 USD)" };

    try {
      const url = `https://api.stripe.com/v1/payment_intents`;
      const body = new URLSearchParams({
        amount: String(amountCents),
        currency: "usd",
        "automatic_payment_methods[enabled]": "true",
        description: `Co-pay for appointment ${appt.id} (${appt.date} ${appt.time})`,
        "metadata[concord_user_id]": userId,
        "metadata[concord_appointment_id]": appt.id,
        "metadata[concord_purpose]": "healthcare_copay",
      }).toString();
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Stripe-Version": "2025-09-30.acacia",
        },
        body,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(`${r.status}: ${data?.error?.message || "unknown"}`);
      appt.copayStatus = "pending";
      appt.stripePaymentIntentId = data.id;
      saveStateIfAvailable();
      return {
        ok: true,
        result: {
          clientSecret: data.client_secret,
          paymentIntentId: data.id,
          copayUsd: appt.copayUsd,
          status: data.status,
        },
      };
    } catch (e) {
      return { ok: false, error: `stripe copay intent failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * appointment-list — lists appointments for the caller, sorted by date
   * desc. Supports optional status filter (booked|completed|cancelled|all)
   * and copay filter (unpaid|pending|paid|all).
   */
  registerLensAction("healthcare", "appointment-list", (ctx, _artifact, params = {}) => {
  try {
    const state = getHealthState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const status = ["booked", "completed", "cancelled", "all"].includes(params.status) ? params.status : "all";
    const copayStatus = ["unpaid", "pending", "paid", "all"].includes(params.copayStatus) ? params.copayStatus : "all";
    const list = state.appointments.get(userId) || [];
    const filtered = list.filter((a) => {
      if (status !== "all" && a.status !== status) return false;
      if (copayStatus !== "all" && (a.copayStatus || "unpaid") !== copayStatus) return false;
      return true;
    }).slice().sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    return { ok: true, result: { appointments: filtered } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * rx-price-compare — Real Rx pricing requires a pharmacy benefit
   * lookup (GoodRx API, RxSaver, ScriptCo, or direct NCPDP D.0). Per
   * "everything must be real" directive, no hash-seeded multiplier
   * table over 7 pharmacy chains.
   */
  registerLensAction("healthcare", "rx-price-compare", (_ctx, _artifact, params = {}) => {
    const drug = String(params.drug || "").trim();
    const zip = String(params.zip || "");
    if (!drug) return { ok: false, error: "drug required" };
    return {
      ok: false,
      error: "Rx price comparison requires a real PBM/pharmacy API. Set GOODRX_API_KEY or RXSAVER_API_KEY for live cash + insurance pricing across major chains.",
      meta: { drug, zip },
    };
  });

  // ═══════════════════════════════════════════════════════════════
  //  Epic 2026 parity — patients, problem list, allergies, vitals,
  //  labs, immunizations, encounters/SOAP, SmartPhrases, codes,
  //  AI scribe, patient portal, dashboard.
  // ═══════════════════════════════════════════════════════════════

  function aidH(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function uidH(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function isoH() { return new Date().toISOString(); }
  function dayH() { return new Date().toISOString().slice(0, 10); }
  function bucketH(m, k) { if (!m.has(k)) m.set(k, []); return m.get(k); }
  function ensureSeqH(s, userId) {
    if (!s.seq.has(userId)) s.seq.set(userId, { pat: 1, prob: 1, alg: 1, vit: 1, lab: 1, imm: 1, enc: 1, sp: 1, msg: 1, refill: 1, form: 1, ord: 1 });
    const seq = s.seq.get(userId);
    for (const k of ['pat','prob','alg','vit','lab','imm','enc','sp','msg','refill','form','ord']) if (!Number.isFinite(seq[k])) seq[k] = 1;
    return seq;
  }

  // ── Patients (patient chart owner) ─────────────────────────────

  registerLensAction("healthcare", "patients-list", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = bucketH(s.patients, aidH(ctx));
    const q = String(params.q || "").trim().toLowerCase();
    const filtered = q ? list.filter(p =>
      `${p.firstName} ${p.lastName} ${p.mrn}`.toLowerCase().includes(q)
    ) : list;
    return { ok: true, result: { patients: filtered.slice().sort((a, b) => a.lastName.localeCompare(b.lastName)) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "patients-create", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const firstName = String(params.firstName || "").trim();
    const lastName = String(params.lastName || "").trim();
    if (!firstName || !lastName) return { ok: false, error: "firstName + lastName required" };
    const seq = ensureSeqH(s, userId);
    const mrn = String(params.mrn || `MRN-${String(seq.pat).padStart(6, "0")}`);
    const patient = {
      id: uidH("pat"),
      mrn,
      firstName, lastName,
      dob: String(params.dob || ""),                   // YYYY-MM-DD
      sex: ['M','F','X','U'].includes(params.sex) ? params.sex : 'U',
      pronouns: String(params.pronouns || ""),
      phone: String(params.phone || ""),
      email: String(params.email || ""),
      address: String(params.address || ""),
      insurancePlan: String(params.insurancePlan || ""),
      insuranceMemberId: String(params.insuranceMemberId || ""),
      emergencyContact: String(params.emergencyContact || ""),
      preferredPharmacy: String(params.preferredPharmacy || ""),
      createdAt: isoH(),
    };
    seq.pat++;
    bucketH(s.patients, userId).push(patient);
    saveStateIfAvailable();
    return { ok: true, result: { patient } };
  });

  registerLensAction("healthcare", "patients-update", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = bucketH(s.patients, aidH(ctx)).find(x => x.id === String(params.id || ""));
    if (!p) return { ok: false, error: "patient not found" };
    for (const k of ['firstName','lastName','dob','pronouns','phone','email','address','insurancePlan','insuranceMemberId','emergencyContact','preferredPharmacy']) {
      if (typeof params[k] === 'string') p[k] = params[k];
    }
    if (['M','F','X','U'].includes(params.sex)) p.sex = params.sex;
    saveStateIfAvailable();
    return { ok: true, result: { patient: p } };
  });

  registerLensAction("healthcare", "patients-detail", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const id = String(params.id || "");
    const p = bucketH(s.patients, userId).find(x => x.id === id);
    if (!p) return { ok: false, error: "patient not found" };
    const filter = (arr) => arr.filter(x => x.patientId === id);
    return {
      ok: true,
      result: {
        patient: p,
        problems: filter(bucketH(s.problems, userId)),
        allergies: filter(bucketH(s.allergies, userId)),
        vitals: filter(bucketH(s.vitals, userId)).slice().sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).slice(0, 30),
        labs: filter(bucketH(s.labs, userId)).slice().sort((a, b) => b.collectedAt.localeCompare(a.collectedAt)).slice(0, 50),
        immunizations: filter(bucketH(s.immunizations, userId)),
        encounters: filter(bucketH(s.encounters, userId)).slice().sort((a, b) => b.encounteredAt.localeCompare(a.encounteredAt)),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Problem List with ICD-10 ──────────────────────────────────

  registerLensAction("healthcare", "problems-list", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const patientId = String(params.patientId || "");
    if (!patientId) return { ok: false, error: "patientId required" };
    const list = bucketH(s.problems, aidH(ctx)).filter(p => p.patientId === patientId);
    return { ok: true, result: { problems: list.slice().sort((a, b) => (b.onsetDate || '').localeCompare(a.onsetDate || '')) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "problems-add", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    const name = String(params.name || "").trim();
    if (!patientId || !name) return { ok: false, error: "patientId + name required" };
    const seq = ensureSeqH(s, userId);
    const problem = {
      id: uidH("prob"),
      number: `PRB-${String(seq.prob).padStart(5, "0")}`,
      patientId,
      name,
      icd10: String(params.icd10 || ""),
      status: ['active','resolved','inactive'].includes(params.status) ? params.status : 'active',
      onsetDate: String(params.onsetDate || dayH()),
      resolvedDate: null,
      notes: String(params.notes || ""),
      createdAt: isoH(),
    };
    seq.prob++;
    bucketH(s.problems, userId).push(problem);
    saveStateIfAvailable();
    return { ok: true, result: { problem } };
  });

  registerLensAction("healthcare", "problems-update", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = bucketH(s.problems, aidH(ctx)).find(x => x.id === String(params.id || ""));
    if (!p) return { ok: false, error: "problem not found" };
    if (['active','resolved','inactive'].includes(params.status)) {
      p.status = params.status;
      if (params.status === 'resolved' && !p.resolvedDate) p.resolvedDate = dayH();
      if (params.status !== 'resolved') p.resolvedDate = null;
    }
    for (const k of ['name','icd10','notes']) if (typeof params[k] === 'string') p[k] = params[k];
    saveStateIfAvailable();
    return { ok: true, result: { problem: p } };
  });

  // ICD-10 / CPT real lookup. Uses ClinicalTables NLM API (public, no key).
  registerLensAction("healthcare", "icd10-search", async (_ctx, _a, params = {}) => {
    const q = String(params.q || "").trim();
    if (q.length < 2) return { ok: false, error: "query too short" };
    try {
      const url = `https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?sf=code,name&terms=${encodeURIComponent(q)}&maxList=20`;
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) return { ok: false, error: `ClinicalTables ${r.status}` };
      const data = await r.json();
      // Response is [total, codes[], extras{}, displayStrings[]]
      const codes = Array.isArray(data?.[1]) ? data[1] : [];
      const display = Array.isArray(data?.[3]) ? data[3] : [];
      const matches = codes.map((code, i) => ({ code, description: (display[i] && display[i][1]) || (display[i] && display[i][0]) || code }));
      return { ok: true, result: { matches, source: 'ClinicalTables NLM ICD-10-CM' } };
    } catch (e) {
      return { ok: false, error: `lookup failed: ${e?.message || e}` };
    }
  });

  // ── Allergies ─────────────────────────────────────────────────

  registerLensAction("healthcare", "allergies-list", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const patientId = String(params.patientId || "");
    if (!patientId) return { ok: false, error: "patientId required" };
    const list = bucketH(s.allergies, aidH(ctx)).filter(a => a.patientId === patientId);
    return { ok: true, result: { allergies: list } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "allergies-add", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    const allergen = String(params.allergen || "").trim();
    if (!patientId || !allergen) return { ok: false, error: "patientId + allergen required" };
    const seq = ensureSeqH(s, userId);
    const allergy = {
      id: uidH("alg"),
      number: `AL-${String(seq.alg).padStart(5, "0")}`,
      patientId,
      allergen,
      kind: ['drug','food','environmental','other'].includes(params.kind) ? params.kind : 'drug',
      severity: ['mild','moderate','severe','life_threatening'].includes(params.severity) ? params.severity : 'moderate',
      reaction: String(params.reaction || ""),
      onsetDate: String(params.onsetDate || ""),
      notes: String(params.notes || ""),
      createdAt: isoH(),
    };
    seq.alg++;
    bucketH(s.allergies, userId).push(allergy);
    saveStateIfAvailable();
    return { ok: true, result: { allergy } };
  });

  registerLensAction("healthcare", "allergies-delete", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = bucketH(s.allergies, aidH(ctx));
    const i = list.findIndex(a => a.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "allergy not found" };
    list.splice(i, 1);
    saveStateIfAvailable();
    return { ok: true, result: { deleted: true } };
  });

  // ── Vitals ────────────────────────────────────────────────────

  registerLensAction("healthcare", "vitals-list", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const patientId = String(params.patientId || "");
    if (!patientId) return { ok: false, error: "patientId required" };
    const list = bucketH(s.vitals, aidH(ctx)).filter(v => v.patientId === patientId);
    return { ok: true, result: { vitals: list.slice().sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "vitals-record", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    if (!patientId) return { ok: false, error: "patientId required" };
    const seq = ensureSeqH(s, userId);
    const v = {
      id: uidH("vit"),
      number: `V-${String(seq.vit).padStart(6, "0")}`,
      patientId,
      recordedAt: String(params.recordedAt || isoH()),
      systolic:  Number.isFinite(Number(params.systolic))  ? Number(params.systolic)  : null,
      diastolic: Number.isFinite(Number(params.diastolic)) ? Number(params.diastolic) : null,
      heartRate: Number.isFinite(Number(params.heartRate)) ? Number(params.heartRate) : null,
      respRate:  Number.isFinite(Number(params.respRate))  ? Number(params.respRate)  : null,
      tempF:     Number.isFinite(Number(params.tempF))     ? Number(params.tempF)     : null,
      spo2:      Number.isFinite(Number(params.spo2))      ? Number(params.spo2)      : null,
      weightLb:  Number.isFinite(Number(params.weightLb))  ? Number(params.weightLb)  : null,
      heightIn:  Number.isFinite(Number(params.heightIn))  ? Number(params.heightIn)  : null,
      painScore: Number.isFinite(Number(params.painScore)) ? Number(params.painScore) : null,
      notes: String(params.notes || ""),
    };
    if (v.weightLb && v.heightIn && v.heightIn > 0) {
      v.bmi = Math.round((v.weightLb * 703 / (v.heightIn * v.heightIn)) * 10) / 10;
    }
    // Flag clinical alerts inline (Epic-style red-flag indicator).
    v.flags = [];
    if (v.systolic !== null && (v.systolic >= 180 || v.systolic < 90)) v.flags.push('bp_critical');
    else if (v.systolic !== null && v.systolic >= 140) v.flags.push('bp_high');
    if (v.diastolic !== null && (v.diastolic >= 120 || v.diastolic < 60)) v.flags.push('bp_critical');
    else if (v.diastolic !== null && v.diastolic >= 90) v.flags.push('bp_high');
    if (v.heartRate !== null && (v.heartRate > 130 || v.heartRate < 40)) v.flags.push('hr_critical');
    if (v.spo2 !== null && v.spo2 < 92) v.flags.push('hypoxia');
    if (v.tempF !== null && (v.tempF >= 103 || v.tempF <= 95)) v.flags.push('temp_critical');
    else if (v.tempF !== null && v.tempF >= 100.4) v.flags.push('fever');
    seq.vit++;
    bucketH(s.vitals, userId).push(v);
    saveStateIfAvailable();
    return { ok: true, result: { vitals: v } };
  });

  // ── Labs (with abnormal-flag logic) ───────────────────────────

  // Reference ranges — adult, conventional units. Lab-specific ranges should override per-org.
  const LAB_RANGES = {
    glucose:      { unit: 'mg/dL', low: 70,  high: 100,   critLow: 40,  critHigh: 400 },
    a1c:          { unit: '%',     low: 4.0, high: 5.6,   critLow: null,critHigh: 14 },
    sodium:       { unit: 'mEq/L', low: 135, high: 145,   critLow: 120, critHigh: 160 },
    potassium:    { unit: 'mEq/L', low: 3.5, high: 5.1,   critLow: 2.5, critHigh: 6.5 },
    creatinine:   { unit: 'mg/dL', low: 0.6, high: 1.3,   critLow: null,critHigh: 6 },
    bun:          { unit: 'mg/dL', low: 6,   high: 24,    critLow: null,critHigh: 100 },
    hemoglobin:   { unit: 'g/dL',  low: 12,  high: 17,    critLow: 7,   critHigh: 20 },
    hematocrit:   { unit: '%',     low: 36,  high: 50,    critLow: null,critHigh: null },
    wbc:          { unit: 'K/uL',  low: 4.5, high: 11,    critLow: 2,   critHigh: 30 },
    platelets:    { unit: 'K/uL',  low: 150, high: 450,   critLow: 50,  critHigh: 1000 },
    ast:          { unit: 'U/L',   low: 10,  high: 40,    critLow: null,critHigh: 1000 },
    alt:          { unit: 'U/L',   low: 7,   high: 56,    critLow: null,critHigh: 1000 },
    tsh:          { unit: 'uIU/mL',low: 0.4, high: 4.0,   critLow: null,critHigh: null },
    ldl:          { unit: 'mg/dL', low: 0,   high: 100,   critLow: null,critHigh: null },
    hdl:          { unit: 'mg/dL', low: 40,  high: 999,   critLow: null,critHigh: null },
    troponin_i:   { unit: 'ng/mL', low: 0,   high: 0.04,  critLow: null,critHigh: null },
  };

  registerLensAction("healthcare", "labs-list", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const patientId = String(params.patientId || "");
    if (!patientId) return { ok: false, error: "patientId required" };
    const list = bucketH(s.labs, aidH(ctx)).filter(l => l.patientId === patientId);
    return { ok: true, result: { labs: list.slice().sort((a, b) => b.collectedAt.localeCompare(a.collectedAt)) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "labs-record", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    const test = String(params.test || "").trim().toLowerCase();
    const value = Number(params.value);
    if (!patientId || !test || !Number.isFinite(value)) return { ok: false, error: "patientId + test + numeric value required" };
    const range = LAB_RANGES[test] || null;
    let flag = 'normal';
    if (range) {
      if (range.critLow !== null && value <= range.critLow) flag = 'critical_low';
      else if (range.critHigh !== null && value >= range.critHigh) flag = 'critical_high';
      else if (value < range.low) flag = 'low';
      else if (value > range.high) flag = 'high';
    } else flag = 'unflagged';
    const seq = ensureSeqH(s, userId);
    const lab = {
      id: uidH("lab"),
      number: `L-${String(seq.lab).padStart(6, "0")}`,
      patientId,
      test, value,
      unit: String(params.unit || range?.unit || ""),
      refLow: range?.low ?? null,
      refHigh: range?.high ?? null,
      flag,
      collectedAt: String(params.collectedAt || isoH()),
      orderingProvider: String(params.orderingProvider || ""),
      notes: String(params.notes || ""),
    };
    seq.lab++;
    bucketH(s.labs, userId).push(lab);
    saveStateIfAvailable();
    return { ok: true, result: { lab, knownTests: Object.keys(LAB_RANGES) } };
  });

  registerLensAction("healthcare", "labs-known-tests", (_ctx, _a, _p = {}) => {
    return { ok: true, result: { tests: Object.entries(LAB_RANGES).map(([t, r]) => ({ test: t, unit: r.unit, low: r.low, high: r.high })) } };
  });

  // ── Immunizations ─────────────────────────────────────────────

  registerLensAction("healthcare", "immunizations-list", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const patientId = String(params.patientId || "");
    if (!patientId) return { ok: false, error: "patientId required" };
    const list = bucketH(s.immunizations, aidH(ctx)).filter(i => i.patientId === patientId);
    return { ok: true, result: { immunizations: list.slice().sort((a, b) => b.administeredAt.localeCompare(a.administeredAt)) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "immunizations-add", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    const vaccine = String(params.vaccine || "").trim();
    if (!patientId || !vaccine) return { ok: false, error: "patientId + vaccine required" };
    const seq = ensureSeqH(s, userId);
    const imm = {
      id: uidH("imm"),
      number: `IMM-${String(seq.imm).padStart(5, "0")}`,
      patientId,
      vaccine,
      cvx: String(params.cvx || ""),
      manufacturer: String(params.manufacturer || ""),
      lotNumber: String(params.lotNumber || ""),
      doseSeries: String(params.doseSeries || ""),
      site: String(params.site || ""),
      administeredAt: String(params.administeredAt || dayH()),
      administeredBy: String(params.administeredBy || ""),
    };
    seq.imm++;
    bucketH(s.immunizations, userId).push(imm);
    saveStateIfAvailable();
    return { ok: true, result: { immunization: imm } };
  });

  // ── Encounters + SOAP notes ──────────────────────────────────

  registerLensAction("healthcare", "encounters-list", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const patientId = String(params.patientId || "");
    let list = bucketH(s.encounters, aidH(ctx));
    if (patientId) list = list.filter(e => e.patientId === patientId);
    return { ok: true, result: { encounters: list.slice().sort((a, b) => b.encounteredAt.localeCompare(a.encounteredAt)) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "encounters-create", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    const patient = bucketH(s.patients, userId).find(p => p.id === patientId);
    if (!patient) return { ok: false, error: "patient not found" };
    const seq = ensureSeqH(s, userId);
    const enc = {
      id: uidH("enc"),
      number: `ENC-${String(seq.enc).padStart(6, "0")}`,
      patientId,
      patientName: `${patient.firstName} ${patient.lastName}`,
      encounterType: ['office_visit','telehealth','urgent_care','er','admission','followup','annual'].includes(params.encounterType) ? params.encounterType : 'office_visit',
      encounteredAt: String(params.encounteredAt || isoH()),
      chiefComplaint: String(params.chiefComplaint || ""),
      // SOAP note fields — start blank, filled by note-save or ai-scribe.
      subjective: String(params.subjective || ""),
      objective: String(params.objective || ""),
      assessment: String(params.assessment || ""),
      plan: String(params.plan || ""),
      diagnosisCodes: Array.isArray(params.diagnosisCodes) ? params.diagnosisCodes.map(String) : [],
      cptCodes: Array.isArray(params.cptCodes) ? params.cptCodes.map(String) : [],
      provider: String(params.provider || ""),
      status: ['open','signed','amended'].includes(params.status) ? params.status : 'open',
      signedAt: null,
      createdAt: isoH(),
    };
    seq.enc++;
    bucketH(s.encounters, userId).push(enc);
    saveStateIfAvailable();
    return { ok: true, result: { encounter: enc } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "encounters-save-soap", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const enc = bucketH(s.encounters, aidH(ctx)).find(x => x.id === String(params.id || ""));
    if (!enc) return { ok: false, error: "encounter not found" };
    if (enc.status === 'signed') return { ok: false, error: "encounter signed; create an amendment instead" };
    for (const k of ['subjective','objective','assessment','plan','chiefComplaint','provider']) {
      if (typeof params[k] === 'string') enc[k] = params[k];
    }
    if (Array.isArray(params.diagnosisCodes)) enc.diagnosisCodes = params.diagnosisCodes.map(String);
    if (Array.isArray(params.cptCodes)) enc.cptCodes = params.cptCodes.map(String);
    saveStateIfAvailable();
    return { ok: true, result: { encounter: enc } };
  });

  registerLensAction("healthcare", "encounters-sign", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const enc = bucketH(s.encounters, aidH(ctx)).find(x => x.id === String(params.id || ""));
    if (!enc) return { ok: false, error: "encounter not found" };
    if (enc.status === 'signed') return { ok: false, error: "already signed" };
    if (!enc.assessment || !enc.plan) return { ok: false, error: "Assessment + Plan required before signing (CMS audit rule)" };
    enc.status = 'signed';
    enc.signedAt = isoH();
    saveStateIfAvailable();
    return { ok: true, result: { encounter: enc } };
  });

  // ── SmartPhrases (Epic-style dot-phrase shortcuts) ───────────

  registerLensAction("healthcare", "smartphrases-list", (ctx, _a, _p = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const list = bucketH(s.smartPhrases, userId);
    if (list.length === 0) {
      // Seed canonical Epic-style SmartPhrases
      const seed = [
        { name: '.ros', text: 'Constitutional: No fever, chills, or weight loss. HEENT: No headache, vision changes. CV: No chest pain, palpitations. Resp: No cough, dyspnea. GI: No nausea, vomiting, diarrhea. GU: No dysuria. MSK: No joint pain. Neuro: No focal deficits. Psych: No depression or anxiety.' },
        { name: '.normalexam', text: 'GEN: Alert, oriented x3, no acute distress. HEENT: NC/AT, PERRLA, EOMI, mucous membranes moist. CV: RRR, no m/r/g. Resp: CTA bilaterally. Abd: Soft, NT/ND, +BS. Neuro: CN II-XII intact. Skin: No rash.' },
        { name: '.htnplan', text: 'Continue lisinopril 10mg daily. Recheck BP in 2 weeks. Goal <130/80. DASH diet, 30 min exercise 5x/week. Recheck BMP in 3 months. Patient agrees with plan.' },
        { name: '.dmplan', text: 'Continue metformin 1000mg BID. Repeat A1C in 3 months, goal <7%. Annual eye exam, foot exam at every visit. Lipid panel in 6 months. Pneumovax updated. Patient reinforces low-carb diet.' },
        { name: '.urireturn', text: 'Return precautions: Fever >101F lasting >3 days, worsening cough, shortness of breath, ear pain, neck stiffness, or any concerning new symptom. Otherwise follow up PRN.' },
      ];
      for (const sp of seed) list.push({ id: uidH("sp"), createdAt: isoH(), ...sp });
      saveStateIfAvailable();
    }
    return { ok: true, result: { smartPhrases: list } };
  });

  registerLensAction("healthcare", "smartphrases-create", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = String(params.name || "").trim();
    const text = String(params.text || "").trim();
    if (!name || !text) return { ok: false, error: "name + text required" };
    const normalized = name.startsWith('.') ? name : '.' + name;
    const sp = { id: uidH("sp"), name: normalized, text, createdAt: isoH() };
    bucketH(s.smartPhrases, aidH(ctx)).push(sp);
    saveStateIfAvailable();
    return { ok: true, result: { smartPhrase: sp } };
  });

  registerLensAction("healthcare", "smartphrases-delete", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = bucketH(s.smartPhrases, aidH(ctx));
    const i = list.findIndex(sp => sp.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "SmartPhrase not found" };
    list.splice(i, 1);
    saveStateIfAvailable();
    return { ok: true, result: { deleted: true } };
  });

  // Expand .dotphrases in a body of text.
  registerLensAction("healthcare", "smartphrases-expand", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = bucketH(s.smartPhrases, aidH(ctx));
    const text = String(params.text || "");
    let expanded = text;
    for (const sp of list) {
      const re = new RegExp(`(^|\\s)${sp.name.replace('.', '\\.')}\\b`, 'g');
      expanded = expanded.replace(re, `$1${sp.text}`);
    }
    return { ok: true, result: { expanded, originalLength: text.length, expandedLength: expanded.length } };
  });

  // ── AI Scribe — raw note text → structured SOAP (Epic 2026 hero feature) ─

  registerLensAction("healthcare", "ai-scribe", async (ctx, _a, params = {}) => {
    const raw = String(params.text || "").trim();
    if (raw.length < 30) return { ok: false, error: "transcript too short (min 30 chars)" };
    // Deterministic shape so the lens has a useful response without brain.
    function deterministic() {
      const sentences = raw.split(/(?<=[.!?])\s+/);
      const detect = (kw) => sentences.find(s => new RegExp(kw, 'i').test(s)) || '';
      return {
        chiefComplaint: detect('reports?|complain|presenting|here for|chief complaint|cc:').slice(0, 200) || sentences[0]?.slice(0, 200) || '',
        subjective: sentences.filter(s => /reports?|complains?|states?|denies?|history|symptoms?|patient/i.test(s)).join(' ').slice(0, 1500) || raw.slice(0, 800),
        objective: sentences.filter(s => /exam|appears?|vital|bp|hr|temp|spo2|auscult|inspect|palpat|labs?|imaging/i.test(s)).join(' ').slice(0, 1500),
        assessment: sentences.filter(s => /assessment|diagnosis|likely|consistent with|impression|dx:|differential/i.test(s)).join(' ').slice(0, 1000),
        plan: sentences.filter(s => /plan|prescrib|order|follow.?up|return|refer|education|counsel/i.test(s)).join(' ').slice(0, 1500),
      };
    }
    const brain = ctx?.llm?.chat;
    if (typeof brain !== 'function') {
      return { ok: true, result: { soap: deterministic(), source: 'deterministic' } };
    }
    try {
      const sys = `You are a medical scribe. Convert raw clinical note text into structured SOAP. Output ONLY JSON:
{"chiefComplaint":"...","subjective":"...","objective":"...","assessment":"...","plan":"..."}
Use only facts present in the input — never invent. If a section has no data, leave it empty.`;
      const r = await brain({
        messages: [{ role: 'system', content: sys }, { role: 'user', content: raw.slice(0, 10000) }],
        temperature: 0.1,
        maxTokens: 2000,
      });
      const text = String(r?.content || r?.text || '').trim();
      const parsed = extractJsonHealth(text);
      if (!parsed?.subjective && !parsed?.assessment) {
        return { ok: true, result: { soap: deterministic(), source: 'deterministic_brain_unparseable' } };
      }
      return {
        ok: true,
        result: {
          soap: {
            chiefComplaint: String(parsed.chiefComplaint || '').slice(0, 500),
            subjective:     String(parsed.subjective     || '').slice(0, 3000),
            objective:      String(parsed.objective      || '').slice(0, 3000),
            assessment:     String(parsed.assessment     || '').slice(0, 2000),
            plan:           String(parsed.plan           || '').slice(0, 3000),
          },
          source: 'brain',
        },
      };
    } catch (e) {
      return { ok: true, result: { soap: deterministic(), source: 'deterministic_after_brain_error', error: String(e?.message || e) } };
    }
  });

  // Epic Conversational Search 2026 — search across a patient's chart with natural language.
  registerLensAction("healthcare", "ai-chart-search", async (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    const query = String(params.query || "").trim().toLowerCase();
    if (!patientId || !query) return { ok: false, error: "patientId + query required" };
    const filter = (arr) => arr.filter(x => x.patientId === patientId);
    const problems = filter(bucketH(s.problems, userId));
    const allergies = filter(bucketH(s.allergies, userId));
    const meds = (bucketH(s.medications, userId) || []).filter(m => m.patientId ? m.patientId === patientId : true);
    const vitals = filter(bucketH(s.vitals, userId));
    const labs = filter(bucketH(s.labs, userId));
    const encs = filter(bucketH(s.encounters, userId));
    function hits(label, items, formatter) {
      return items.filter(item => formatter(item).toLowerCase().includes(query)).slice(0, 5).map(item => ({ label, item, display: formatter(item) }));
    }
    const findings = [
      ...hits('problem', problems, p => `${p.name} ${p.icd10 || ''} ${p.notes || ''}`),
      ...hits('allergy', allergies, a => `${a.allergen} ${a.reaction || ''} (${a.severity})`),
      ...hits('medication', meds, m => `${m.name || m.drug || ''} ${m.dose || ''} ${m.schedule || ''}`),
      ...hits('vital', vitals, v => `BP ${v.systolic}/${v.diastolic} HR ${v.heartRate} ${v.notes || ''}`),
      ...hits('lab', labs, l => `${l.test} ${l.value} ${l.unit || ''} (${l.flag})`),
      ...hits('encounter', encs, e => `${e.encounterType} ${e.chiefComplaint || ''} ${e.assessment || ''} ${e.plan || ''}`),
    ];
    // Recent abnormal-flagged labs are always relevant when query mentions "abnormal" / "high" / "critical"
    if (/abnormal|high|low|critical/.test(query)) {
      for (const l of labs.filter(x => x.flag !== 'normal' && x.flag !== 'unflagged').slice(0, 5)) {
        if (!findings.some(f => f.label === 'lab' && f.item.id === l.id)) {
          findings.push({ label: 'lab', item: l, display: `${l.test} ${l.value} ${l.unit || ''} (${l.flag})` });
        }
      }
    }
    return { ok: true, result: { query, findings, hitCount: findings.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Patient Portal (MyChart-style) ────────────────────────────

  registerLensAction("healthcare", "messages-list", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const patientId = String(params.patientId || "");
    let list = bucketH(s.messages, aidH(ctx));
    if (patientId) list = list.filter(m => m.patientId === patientId);
    return { ok: true, result: { messages: list.slice().sort((a, b) => b.sentAt.localeCompare(a.sentAt)) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "messages-send", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    const body = String(params.body || "").trim();
    if (!patientId || !body) return { ok: false, error: "patientId + body required" };
    const seq = ensureSeqH(s, userId);
    const msg = {
      id: uidH("msg"),
      number: `MSG-${String(seq.msg).padStart(5, "0")}`,
      patientId,
      direction: ['from_patient','to_patient'].includes(params.direction) ? params.direction : 'to_patient',
      subject: String(params.subject || "").slice(0, 200),
      body: body.slice(0, 5000),
      sentAt: isoH(),
      readAt: null,
      sender: String(params.sender || ""),
    };
    seq.msg++;
    bucketH(s.messages, userId).push(msg);
    saveStateIfAvailable();
    return { ok: true, result: { message: msg } };
  });

  registerLensAction("healthcare", "messages-mark-read", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const m = bucketH(s.messages, aidH(ctx)).find(x => x.id === String(params.id || ""));
    if (!m) return { ok: false, error: "message not found" };
    m.readAt = isoH();
    saveStateIfAvailable();
    return { ok: true, result: { message: m } };
  });

  registerLensAction("healthcare", "refills-list", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const status = ['requested','approved','denied','filled','all'].includes(params.status) ? params.status : 'all';
    let list = bucketH(s.refills, aidH(ctx));
    if (status !== 'all') list = list.filter(r => r.status === status);
    return { ok: true, result: { refills: list.slice().sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "refills-request", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    const medication = String(params.medication || "").trim();
    if (!patientId || !medication) return { ok: false, error: "patientId + medication required" };
    const seq = ensureSeqH(s, userId);
    const refill = {
      id: uidH("refill"),
      number: `RX-${String(seq.refill).padStart(5, "0")}`,
      patientId,
      medication,
      dose: String(params.dose || ""),
      pharmacy: String(params.pharmacy || ""),
      notes: String(params.notes || ""),
      status: 'requested',
      requestedAt: isoH(),
      respondedAt: null,
    };
    seq.refill++;
    bucketH(s.refills, userId).push(refill);
    saveStateIfAvailable();
    return { ok: true, result: { refill } };
  });

  registerLensAction("healthcare", "refills-respond", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const r = bucketH(s.refills, aidH(ctx)).find(x => x.id === String(params.id || ""));
    if (!r) return { ok: false, error: "refill not found" };
    if (!['approved','denied','filled'].includes(params.status)) return { ok: false, error: "status must be approved | denied | filled" };
    r.status = params.status;
    r.respondedAt = isoH();
    r.responseNotes = String(params.responseNotes || "");
    saveStateIfAvailable();
    return { ok: true, result: { refill: r } };
  });

  // ═══════════════════════════════════════════════════════════════
  //  Orders (CPOE), care team, care gaps, drug-interaction check,
  //  after-visit summary — Epic ambulatory parity.
  // ═══════════════════════════════════════════════════════════════

  const ORDER_KINDS = ['medication', 'lab', 'imaging', 'referral', 'procedure'];
  const ORDER_STATUSES = ['placed', 'active', 'in-progress', 'completed', 'resulted', 'discontinued', 'cancelled'];
  const ORDER_PRIORITIES = ['routine', 'urgent', 'stat'];
  const CARE_TEAM_ROLES = ['pcp', 'attending', 'specialist', 'nurse', 'care-coordinator', 'pharmacist', 'social-worker', 'other'];

  function ageFromDob(dob) {
    if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(String(dob))) return null;
    const born = new Date(String(dob).slice(0, 10));
    if (Number.isNaN(born.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - born.getFullYear();
    const m = now.getMonth() - born.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age--;
    return age >= 0 && age < 140 ? age : null;
  }
  function daysSince(isoDate) {
    if (!isoDate) return Infinity;
    const t = new Date(String(isoDate).slice(0, 10)).getTime();
    if (Number.isNaN(t)) return Infinity;
    return (Date.now() - t) / 86400000;
  }

  // ── Orders (CPOE) ──────────────────────────────────────────────

  registerLensAction("healthcare", "order-create", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    if (!bucketH(s.patients, userId).some(p => p.id === patientId)) return { ok: false, error: "patient not found" };
    const kind = ORDER_KINDS.includes(params.kind) ? params.kind : null;
    if (!kind) return { ok: false, error: `kind must be one of ${ORDER_KINDS.join(', ')}` };
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "order name required" };
    const seq = ensureSeqH(s, userId);
    const order = {
      id: uidH("ord"),
      number: `ORD-${String(seq.ord).padStart(6, "0")}`,
      patientId, kind, name,
      status: kind === 'medication' ? 'active' : 'placed',
      priority: ORDER_PRIORITIES.includes(params.priority) ? params.priority : 'routine',
      details: String(params.details || ""),
      orderedBy: String(params.orderedBy || ""),
      orderedAt: isoH(),
      completedAt: null,
      // medication-specific fields
      dose: kind === 'medication' ? String(params.dose || "") : null,
      frequency: kind === 'medication' ? String(params.frequency || "") : null,
      route: kind === 'medication' ? String(params.route || "oral") : null,
    };
    seq.ord++;
    bucketH(s.orders, userId).push(order);
    saveStateIfAvailable();
    return { ok: true, result: { order } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "order-list", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const patientId = String(params.patientId || "");
    if (!patientId) return { ok: false, error: "patientId required" };
    const kind = ORDER_KINDS.includes(params.kind) ? params.kind : null;
    const status = ORDER_STATUSES.includes(params.status) ? params.status : null;
    let list = bucketH(s.orders, aidH(ctx)).filter(o => o.patientId === patientId);
    if (kind) list = list.filter(o => o.kind === kind);
    if (status) list = list.filter(o => o.status === status);
    list = list.slice().sort((a, b) => b.orderedAt.localeCompare(a.orderedAt));
    return { ok: true, result: { orders: list, total: list.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "order-update-status", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const order = bucketH(s.orders, aidH(ctx)).find(o => o.id === String(params.id || ""));
    if (!order) return { ok: false, error: "order not found" };
    if (!ORDER_STATUSES.includes(params.status)) return { ok: false, error: `status must be one of ${ORDER_STATUSES.join(', ')}` };
    order.status = params.status;
    if (['completed', 'resulted'].includes(params.status)) order.completedAt = isoH();
    saveStateIfAvailable();
    return { ok: true, result: { order } };
  });

  registerLensAction("healthcare", "order-cancel", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const order = bucketH(s.orders, aidH(ctx)).find(o => o.id === String(params.id || ""));
    if (!order) return { ok: false, error: "order not found" };
    if (['completed', 'resulted', 'cancelled', 'discontinued'].includes(order.status)) {
      return { ok: false, error: `order is already ${order.status}` };
    }
    order.status = order.kind === 'medication' ? 'discontinued' : 'cancelled';
    saveStateIfAvailable();
    return { ok: true, result: { order } };
  });

  // ── Drug interaction + drug-allergy check ──────────────────────

  // Curated, conservative interaction table — substring-matched, both
  // directions. Each entry: [drugA, drugB, severity, note].
  const DRUG_INTERACTIONS = [
    ['warfarin', 'aspirin', 'major', 'Additive bleeding risk — monitor INR closely.'],
    ['warfarin', 'ibuprofen', 'major', 'NSAID increases bleeding risk on anticoagulation.'],
    ['warfarin', 'naproxen', 'major', 'NSAID increases bleeding risk on anticoagulation.'],
    ['lisinopril', 'spironolactone', 'major', 'Risk of hyperkalemia — monitor potassium.'],
    ['lisinopril', 'potassium', 'moderate', 'Risk of hyperkalemia with ACE inhibitor.'],
    ['simvastatin', 'clarithromycin', 'major', 'CYP3A4 inhibition — rhabdomyolysis risk.'],
    ['simvastatin', 'amlodipine', 'moderate', 'Limit simvastatin to 20mg with amlodipine.'],
    ['sertraline', 'tramadol', 'major', 'Serotonin syndrome risk — avoid combination.'],
    ['sertraline', 'ibuprofen', 'moderate', 'SSRIs + NSAIDs increase GI bleeding risk.'],
    ['fluoxetine', 'tramadol', 'major', 'Serotonin syndrome risk — avoid combination.'],
    ['digoxin', 'furosemide', 'moderate', 'Diuretic-induced hypokalemia raises digoxin toxicity.'],
    ['methotrexate', 'trimethoprim', 'major', 'Additive bone-marrow suppression — avoid.'],
    ['clopidogrel', 'omeprazole', 'moderate', 'PPI reduces clopidogrel activation — prefer pantoprazole.'],
    ['metformin', 'contrast', 'moderate', 'Hold metformin around iodinated contrast — lactic acidosis risk.'],
    ['ciprofloxacin', 'tizanidine', 'major', 'CYP1A2 inhibition — severe hypotension/sedation.'],
  ];

  registerLensAction("healthcare", "drug-interaction-check", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    if (!patientId) return { ok: false, error: "patientId required" };
    const candidate = String(params.candidateDrug || "").trim();
    const activeMeds = bucketH(s.orders, userId)
      .filter(o => o.patientId === patientId && o.kind === 'medication' && ['active', 'placed', 'in-progress'].includes(o.status))
      .map(o => o.name);
    const allMeds = candidate ? [...activeMeds, candidate] : activeMeds;
    const lower = allMeds.map(m => m.toLowerCase());
    const interactions = [];
    // Drug–drug, every unordered pair.
    for (let i = 0; i < allMeds.length; i++) {
      for (let j = i + 1; j < allMeds.length; j++) {
        for (const [a, b, severity, note] of DRUG_INTERACTIONS) {
          const hit = (lower[i].includes(a) && lower[j].includes(b)) || (lower[i].includes(b) && lower[j].includes(a));
          if (hit) interactions.push({ type: 'drug-drug', a: allMeds[i], b: allMeds[j], severity, note });
        }
      }
    }
    // Drug–allergy.
    const allergies = bucketH(s.allergies, userId).filter(a => a.patientId === patientId);
    for (let i = 0; i < allMeds.length; i++) {
      for (const alg of allergies) {
        const allergen = String(alg.allergen || alg.name || "").trim().toLowerCase();
        if (allergen && allergen.length >= 3 && lower[i].includes(allergen)) {
          interactions.push({
            type: 'drug-allergy', a: allMeds[i], b: alg.allergen,
            severity: ['severe', 'life_threatening'].includes(alg.severity) ? 'major' : 'moderate',
            note: `Patient has a documented allergy to ${alg.allergen}.`,
          });
        }
      }
    }
    return {
      ok: true,
      result: {
        interactions,
        checked: allMeds,
        candidateDrug: candidate || null,
        hasMajor: interactions.some(i => i.severity === 'major'),
        clean: interactions.length === 0,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Care team ──────────────────────────────────────────────────

  registerLensAction("healthcare", "care-team-list", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const patientId = String(params.patientId || "");
    if (!patientId) return { ok: false, error: "patientId required" };
    const list = bucketH(s.careTeam, aidH(ctx)).filter(m => m.patientId === patientId);
    return { ok: true, result: { careTeam: list } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "care-team-assign", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    if (!bucketH(s.patients, userId).some(p => p.id === patientId)) return { ok: false, error: "patient not found" };
    const providerName = String(params.providerName || "").trim();
    if (!providerName) return { ok: false, error: "providerName required" };
    const member = {
      id: uidH("ct"), patientId, providerName,
      role: CARE_TEAM_ROLES.includes(params.role) ? params.role : 'other',
      specialty: String(params.specialty || ""),
      addedAt: isoH(),
    };
    bucketH(s.careTeam, userId).push(member);
    saveStateIfAvailable();
    return { ok: true, result: { member } };
  });

  registerLensAction("healthcare", "care-team-remove", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = bucketH(s.careTeam, aidH(ctx));
    const i = list.findIndex(m => m.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "care team member not found" };
    list.splice(i, 1);
    saveStateIfAvailable();
    return { ok: true, result: { removed: params.id } };
  });

  // ── Care gaps / health maintenance (Best Practice Advisories) ──

  registerLensAction("healthcare", "care-gaps", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    const patient = bucketH(s.patients, userId).find(p => p.id === patientId);
    if (!patient) return { ok: false, error: "patient not found" };
    const age = ageFromDob(patient.dob);
    const problems = bucketH(s.problems, userId).filter(p => p.patientId === patientId && p.status === 'active');
    const imms = bucketH(s.immunizations, userId).filter(x => x.patientId === patientId);
    const labs = bucketH(s.labs, userId).filter(x => x.patientId === patientId);
    const orders = bucketH(s.orders, userId).filter(o => o.patientId === patientId);
    const hasProblem = (re) => problems.some(p => re.test(p.name || '') || re.test(p.icd10 || ''));
    const lastImm = (re) => imms.filter(x => re.test(x.vaccine || '')).map(x => x.administeredAt || '').sort().pop() || null;
    const lastLab = (re) => labs.filter(x => re.test(x.test || '')).map(x => x.collectedAt || '').sort().pop() || null;
    const hasOrderEver = (re) => orders.some(o => re.test(o.name || ''));

    const gaps = [];
    const flu = lastImm(/flu|influenza/i);
    if (daysSince(flu) > 365) {
      gaps.push({ item: 'Influenza vaccine', status: flu ? 'overdue' : 'due', reason: 'Recommended annually for all patients.', lastDone: flu });
    }
    if (hasProblem(/diabet/i) || hasProblem(/^E1[01]/)) {
      const a1c = lastLab(/a1c|hba1c|glycohemoglobin/i);
      if (daysSince(a1c) > 180) {
        gaps.push({ item: 'Hemoglobin A1C', status: a1c ? 'overdue' : 'due', reason: 'Diabetes on the problem list — A1C every 6 months.', lastDone: a1c });
      }
    }
    if (age != null && age >= 40) {
      const lipid = lastLab(/lipid|cholesterol/i);
      if (daysSince(lipid) > 365) {
        gaps.push({ item: 'Lipid panel', status: lipid ? 'overdue' : 'due', reason: 'Cardiovascular screening for age 40+.', lastDone: lipid });
      }
    }
    if (age != null && age >= 45 && !hasOrderEver(/colonoscop|colorectal|cologuard|fit test/i)) {
      gaps.push({ item: 'Colorectal cancer screening', status: 'due', reason: 'USPSTF recommends screening starting at age 45.', lastDone: null });
    }
    if (age != null && age >= 40 && patient.sex === 'F') {
      const mammo = orders.filter(o => /mammogr/i.test(o.name || '')).map(o => o.orderedAt).sort().pop() || null;
      if (daysSince(mammo) > 365) {
        gaps.push({ item: 'Mammogram', status: mammo ? 'overdue' : 'due', reason: 'Breast cancer screening for women age 40+.', lastDone: mammo });
      }
    }
    if (age != null && age >= 65) {
      const pneumo = lastImm(/pneumo|pcv|ppsv/i);
      if (!pneumo) gaps.push({ item: 'Pneumococcal vaccine', status: 'due', reason: 'Recommended for adults age 65+.', lastDone: null });
    }
    return { ok: true, result: { patientId, age, gaps, count: gaps.length, allClear: gaps.length === 0 } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── After-visit summary ────────────────────────────────────────

  registerLensAction("healthcare", "visit-summary", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const enc = bucketH(s.encounters, userId).find(e => e.id === String(params.encounterId || ""));
    if (!enc) return { ok: false, error: "encounter not found" };
    const patient = bucketH(s.patients, userId).find(p => p.id === enc.patientId);
    const problems = bucketH(s.problems, userId).filter(p => p.patientId === enc.patientId && p.status === 'active');
    const meds = bucketH(s.orders, userId).filter(o => o.patientId === enc.patientId && o.kind === 'medication' && ['active', 'placed'].includes(o.status));
    const allergies = bucketH(s.allergies, userId).filter(a => a.patientId === enc.patientId);
    const summary = {
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : enc.patientName,
      mrn: patient?.mrn || null,
      encounterDate: enc.encounteredAt,
      encounterType: enc.encounterType,
      provider: enc.provider,
      signed: enc.status === 'signed',
      chiefComplaint: enc.chiefComplaint,
      assessment: enc.assessment,
      plan: enc.plan,
      diagnosisCodes: enc.diagnosisCodes || [],
      activeProblems: problems.map(p => ({ name: p.name, icd10: p.icd10 })),
      medications: meds.map(m => ({ name: m.name, dose: m.dose, frequency: m.frequency })),
      allergies: allergies.map(a => a.allergen || a.name),
    };
    const text = [
      `AFTER-VISIT SUMMARY`,
      `${summary.patientName}${summary.mrn ? ` (${summary.mrn})` : ''}`,
      `${summary.encounterType} · ${String(summary.encounterDate).slice(0, 10)}${summary.provider ? ` · ${summary.provider}` : ''}`,
      ``,
      `Reason for visit: ${summary.chiefComplaint || '—'}`,
      ``,
      `Assessment:`, summary.assessment || '—',
      ``,
      `Plan:`, summary.plan || '—',
      ``,
      `Active problems: ${summary.activeProblems.map(p => p.name).join('; ') || 'none'}`,
      `Current medications: ${summary.medications.map(m => `${m.name}${m.dose ? ` ${m.dose}` : ''}`).join('; ') || 'none'}`,
      `Allergies: ${summary.allergies.join('; ') || 'NKDA'}`,
    ].join('\n');
    return { ok: true, result: { summary, text } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ═══════════════════════════════════════════════════════════════
  //  Feature-parity backlog — results release, telehealth, device
  //  ingestion, insurance/claims, CDS alerts, FHIR export, proxy.
  // ═══════════════════════════════════════════════════════════════

  function ensureBacklogBuckets(s) {
    if (!s.telehealth)     s.telehealth     = new Map(); // userId -> [visit]
    if (!s.deviceReadings) s.deviceReadings = new Map(); // userId -> [reading]
    if (!s.coverage)       s.coverage       = new Map(); // userId -> [policy]
    if (!s.claims)         s.claims         = new Map(); // userId -> [claim]
    if (!s.proxyGrants)    s.proxyGrants    = new Map(); // userId -> [grant]
    return s;
  }

  // ── Patient portal results release + provider commentary ───────
  // labs-record already computes a `flag`. The clinician releases a
  // result to the patient portal here, optionally with plain-language
  // commentary. Until released the patient should not see it.

  registerLensAction("healthcare", "labs-release", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const lab = bucketH(s.labs, aidH(ctx)).find(l => l.id === String(params.id || ""));
    if (!lab) return { ok: false, error: "lab not found" };
    const commentary = String(params.commentary || "").trim();
    lab.released = true;
    lab.releasedAt = isoH();
    lab.providerCommentary = commentary;
    lab.releasedBy = String(params.releasedBy || "");
    saveStateIfAvailable();
    return { ok: true, result: { lab } };
  });

  // Patient-portal view: only released labs, with abnormal grouping.
  registerLensAction("healthcare", "labs-portal-view", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const patientId = String(params.patientId || "");
    if (!patientId) return { ok: false, error: "patientId required" };
    const released = bucketH(s.labs, aidH(ctx))
      .filter(l => l.patientId === patientId && l.released === true)
      .slice()
      .sort((a, b) => String(b.collectedAt).localeCompare(String(a.collectedAt)));
    const abnormal = released.filter(l => l.flag && l.flag !== "normal" && l.flag !== "unflagged");
    return {
      ok: true,
      result: {
        labs: released,
        abnormal,
        abnormalCount: abnormal.length,
        normalCount: released.length - abnormal.length,
        hasCritical: abnormal.some(l => l.flag === "critical_high" || l.flag === "critical_low"),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Telehealth video visit integration ─────────────────────────
  // Creates a video visit. With DAILY_API_KEY set we mint a real
  // Daily.co room (external client via roomUrl). Otherwise the
  // platform's OWN WebRTC path is used: the in-lens
  // TelehealthVideoCall component (simple-peer) joins the socket.io
  // signalling room `webrtc:<visitId>` — relay handlers in
  // server/lib/webrtc-signalling.js, attached to the realtime io in
  // server.js. That path is token-free by design (room privacy
  // derives from the unguessable visit id), so we return an honest
  // `join` descriptor mirroring the exact contract the client uses —
  // never a fabricated credential. If neither Daily nor the realtime
  // layer is available, the appointment is still scheduled but the
  // result says plainly that video isn't provisioned
  // (videoReady:false + note). POLISH_AUDIT T1.3.

  registerLensAction("healthcare", "telehealth-create", async (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogBuckets(s);
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    if (!bucketH(s.patients, userId).some(p => p.id === patientId)) return { ok: false, error: "patient not found" };
    const scheduledAt = String(params.scheduledAt || isoH());
    const visit = {
      id: uidH("tele"),
      patientId,
      appointmentId: String(params.appointmentId || ""),
      provider: String(params.provider || ""),
      scheduledAt,
      status: "scheduled",
      roomProvider: "none",
      roomUrl: null,
      videoReady: false,
      createdAt: isoH(),
    };
    if (process.env.DAILY_API_KEY) {
      try {
        const r = await fetch("https://api.daily.co/v1/rooms", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.DAILY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            privacy: "private",
            properties: { exp: Math.floor(Date.now() / 1000) + 7200 },
          }),
        });
        const data = await r.json();
        if (r.ok && data?.url) {
          visit.roomProvider = "daily";
          visit.roomUrl = data.url;
          visit.roomName = data.name || null;
          visit.videoReady = true;
        }
      } catch (_e) { /* fall through to the concord-webrtc check below */ }
    }
    if (!visit.videoReady) {
      // Concord's own in-lens WebRTC path is only claimed when the
      // socket signalling layer is genuinely mounted (server.js sets
      // globalThis._concordREALTIME right before attaching
      // attachWebRTCSignalling to it). No realtime → no video claim.
      const rt = globalThis._concordREALTIME || globalThis.__CONCORD_REALTIME__;
      if (rt?.ready && rt?.io) {
        visit.roomProvider = "concord-webrtc";
        visit.videoReady = true;
        // The real join contract consumed by TelehealthVideoCall.tsx:
        // it emits `webrtc:join { visitId }` on the main socket.io
        // connection and the server relays SDP/ICE inside the room
        // `webrtc:<visitId>`. No token exists on this path.
        visit.join = {
          transport: "socket.io",
          joinEvent: "webrtc:join",
          room: `webrtc:${visit.id}`,
          visitId: visit.id,
          component: "TelehealthVideoCall",
        };
      } else {
        visit.note = "Video calling requires configuration — appointment scheduled; video room not yet available.";
      }
    }
    bucketH(s.telehealth, userId).push(visit);
    saveStateIfAvailable();
    return { ok: true, result: { visit } };
  });

  registerLensAction("healthcare", "telehealth-list", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogBuckets(s);
    const patientId = String(params.patientId || "");
    let list = bucketH(s.telehealth, aidH(ctx));
    if (patientId) list = list.filter(v => v.patientId === patientId);
    return { ok: true, result: { visits: list.slice().sort((a, b) => String(b.scheduledAt).localeCompare(String(a.scheduledAt))) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "telehealth-update-status", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogBuckets(s);
    const visit = bucketH(s.telehealth, aidH(ctx)).find(v => v.id === String(params.id || ""));
    if (!visit) return { ok: false, error: "visit not found" };
    if (!["scheduled", "in_progress", "completed", "cancelled", "no_show"].includes(params.status)) {
      return { ok: false, error: "status must be scheduled | in_progress | completed | cancelled | no_show" };
    }
    visit.status = params.status;
    if (params.status === "in_progress" && !visit.startedAt) visit.startedAt = isoH();
    if (params.status === "completed") visit.endedAt = isoH();
    saveStateIfAvailable();
    return { ok: true, result: { visit } };
  });

  // ── Wearable / home-device data ingestion ──────────────────────
  // HR, glucose, BP, steps, weight, spo2 from home devices. Each
  // reading is timestamped; abnormal readings are flagged with the
  // same logic family as in-clinic vitals.

  const DEVICE_METRICS = {
    heart_rate:    { unit: "bpm",   low: 50,  high: 100 },
    glucose:       { unit: "mg/dL", low: 70,  high: 140 },
    systolic:      { unit: "mmHg",  low: 90,  high: 130 },
    diastolic:     { unit: "mmHg",  low: 60,  high: 85 },
    spo2:          { unit: "%",     low: 94,  high: 100 },
    steps:         { unit: "steps", low: 0,   high: 100000 },
    weight:        { unit: "lb",    low: 50,  high: 600 },
    body_temp:     { unit: "F",     low: 96,  high: 100.4 },
  };

  registerLensAction("healthcare", "device-ingest", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogBuckets(s);
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    const metric = String(params.metric || "").trim().toLowerCase();
    const value = Number(params.value);
    if (!patientId || !metric || !Number.isFinite(value)) {
      return { ok: false, error: "patientId + metric + numeric value required" };
    }
    const spec = DEVICE_METRICS[metric] || null;
    let flag = "normal";
    if (spec) {
      if (value < spec.low) flag = "low";
      else if (value > spec.high) flag = "high";
    } else flag = "unflagged";
    const reading = {
      id: uidH("dev"),
      patientId,
      metric,
      value,
      unit: String(params.unit || spec?.unit || ""),
      flag,
      device: String(params.device || "home_device"),
      recordedAt: String(params.recordedAt || isoH()),
      ingestedAt: isoH(),
    };
    bucketH(s.deviceReadings, userId).push(reading);
    saveStateIfAvailable();
    return { ok: true, result: { reading, knownMetrics: Object.keys(DEVICE_METRICS) } };
  });

  registerLensAction("healthcare", "device-readings", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogBuckets(s);
    const patientId = String(params.patientId || "");
    if (!patientId) return { ok: false, error: "patientId required" };
    const metric = String(params.metric || "").trim().toLowerCase();
    let list = bucketH(s.deviceReadings, aidH(ctx)).filter(r => r.patientId === patientId);
    if (metric) list = list.filter(r => r.metric === metric);
    list = list.slice().sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
    // Per-metric trend summary.
    const byMetric = {};
    for (const r of list) {
      if (!byMetric[r.metric]) byMetric[r.metric] = [];
      byMetric[r.metric].push(r);
    }
    const summary = Object.entries(byMetric).map(([m, rows]) => {
      const chrono = rows.slice().sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
      const latest = chrono[chrono.length - 1];
      let trend = "stable";
      if (chrono.length >= 2) {
        const prev = chrono[chrono.length - 2];
        if (latest.value > prev.value * 1.05) trend = "up";
        else if (latest.value < prev.value * 0.95) trend = "down";
      }
      return { metric: m, count: rows.length, latest: latest.value, unit: latest.unit, latestFlag: latest.flag, trend };
    });
    return { ok: true, result: { readings: list, summary } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Insurance eligibility + claims/billing workflow ────────────

  registerLensAction("healthcare", "coverage-list", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogBuckets(s);
    const patientId = String(params.patientId || "");
    if (!patientId) return { ok: false, error: "patientId required" };
    const list = bucketH(s.coverage, aidH(ctx)).filter(c => c.patientId === patientId);
    return { ok: true, result: { policies: list } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "coverage-add", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogBuckets(s);
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    const payer = String(params.payer || "").trim();
    const memberId = String(params.memberId || "").trim();
    if (!patientId || !payer || !memberId) return { ok: false, error: "patientId + payer + memberId required" };
    const policy = {
      id: uidH("cov"),
      patientId,
      payer,
      memberId,
      groupNumber: String(params.groupNumber || ""),
      planName: String(params.planName || ""),
      planType: ["PPO", "HMO", "EPO", "POS", "HDHP", "Medicare", "Medicaid", "other"].includes(params.planType) ? params.planType : "other",
      copayUsd: Number.isFinite(Number(params.copayUsd)) ? Number(params.copayUsd) : null,
      deductibleUsd: Number.isFinite(Number(params.deductibleUsd)) ? Number(params.deductibleUsd) : null,
      deductibleMetUsd: 0,
      effectiveDate: String(params.effectiveDate || ""),
      eligibilityStatus: "unverified",
      verifiedAt: null,
      createdAt: isoH(),
    };
    bucketH(s.coverage, userId).push(policy);
    saveStateIfAvailable();
    return { ok: true, result: { policy } };
  });

  // Eligibility check — verifies the policy is active. A real X12 270/271
  // payer transaction needs an EDI clearinghouse key; without one the
  // check confirms structural completeness and stamps the policy.
  registerLensAction("healthcare", "coverage-verify", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogBuckets(s);
    const policy = bucketH(s.coverage, aidH(ctx)).find(c => c.id === String(params.id || ""));
    if (!policy) return { ok: false, error: "policy not found" };
    const complete = !!(policy.payer && policy.memberId);
    policy.eligibilityStatus = complete ? "active" : "incomplete";
    policy.verifiedAt = isoH();
    const remainingDeductible = policy.deductibleUsd != null
      ? Math.max(0, policy.deductibleUsd - (policy.deductibleMetUsd || 0))
      : null;
    saveStateIfAvailable();
    return {
      ok: true,
      result: {
        policy,
        eligibilityStatus: policy.eligibilityStatus,
        remainingDeductible,
        note: process.env.EDI_CLEARINGHOUSE_KEY
          ? "Set up an X12 270/271 transaction for real-time payer verification."
          : "Structural verification only. Set EDI_CLEARINGHOUSE_KEY for real payer eligibility (X12 270/271).",
      },
    };
  });

  // CPT line items each have a billed charge. The claim total sums
  // them; once a payer "adjudicates" we record allowed/paid/patient.
  registerLensAction("healthcare", "claim-create", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogBuckets(s);
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    if (!bucketH(s.patients, userId).some(p => p.id === patientId)) return { ok: false, error: "patient not found" };
    const rawLines = Array.isArray(params.lines) ? params.lines : [];
    const lines = rawLines.map(l => ({
      cpt: String(l.cpt || ""),
      description: String(l.description || ""),
      units: Math.max(1, Number(l.units) || 1),
      chargeUsd: Math.max(0, Math.round((Number(l.chargeUsd) || 0) * 100) / 100),
    })).filter(l => l.cpt);
    if (lines.length === 0) return { ok: false, error: "at least one CPT line item with a cpt code required" };
    const totalChargeUsd = Math.round(lines.reduce((sum, l) => sum + l.chargeUsd * l.units, 0) * 100) / 100;
    const claim = {
      id: uidH("clm"),
      claimNumber: `CLM-${Date.now().toString(36).toUpperCase()}`,
      patientId,
      encounterId: String(params.encounterId || ""),
      coverageId: String(params.coverageId || ""),
      diagnosisCodes: Array.isArray(params.diagnosisCodes) ? params.diagnosisCodes.map(String) : [],
      lines,
      totalChargeUsd,
      allowedUsd: null,
      paidUsd: null,
      patientResponsibilityUsd: null,
      status: "draft",
      denialReason: "",
      submittedAt: null,
      adjudicatedAt: null,
      createdAt: isoH(),
    };
    bucketH(s.claims, userId).push(claim);
    saveStateIfAvailable();
    return { ok: true, result: { claim } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "claim-list", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogBuckets(s);
    const patientId = String(params.patientId || "");
    const status = ["draft", "submitted", "paid", "partial", "denied", "all"].includes(params.status) ? params.status : "all";
    let list = bucketH(s.claims, aidH(ctx));
    if (patientId) list = list.filter(c => c.patientId === patientId);
    if (status !== "all") list = list.filter(c => c.status === status);
    list = list.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const outstanding = Math.round(list
      .filter(c => ["draft", "submitted", "denied"].includes(c.status))
      .reduce((sum, c) => sum + (c.totalChargeUsd || 0), 0) * 100) / 100;
    return { ok: true, result: { claims: list, count: list.length, outstandingUsd: outstanding } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // Workflow: draft -> submitted, then adjudicate (paid/partial/denied).
  registerLensAction("healthcare", "claim-submit", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogBuckets(s);
    const claim = bucketH(s.claims, aidH(ctx)).find(c => c.id === String(params.id || ""));
    if (!claim) return { ok: false, error: "claim not found" };
    if (claim.status !== "draft") return { ok: false, error: `claim is already ${claim.status}` };
    claim.status = "submitted";
    claim.submittedAt = isoH();
    saveStateIfAvailable();
    return { ok: true, result: { claim } };
  });

  registerLensAction("healthcare", "claim-adjudicate", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogBuckets(s);
    const claim = bucketH(s.claims, aidH(ctx)).find(c => c.id === String(params.id || ""));
    if (!claim) return { ok: false, error: "claim not found" };
    if (claim.status !== "submitted") return { ok: false, error: "only submitted claims can be adjudicated" };
    const allowedUsd = Math.max(0, Math.round((Number(params.allowedUsd) || 0) * 100) / 100);
    const paidUsd = Math.max(0, Math.round((Number(params.paidUsd) || 0) * 100) / 100);
    if (paidUsd > allowedUsd) return { ok: false, error: "paidUsd cannot exceed allowedUsd" };
    claim.allowedUsd = allowedUsd;
    claim.paidUsd = paidUsd;
    claim.patientResponsibilityUsd = Math.round((allowedUsd - paidUsd) * 100) / 100;
    claim.denialReason = String(params.denialReason || "");
    claim.adjudicatedAt = isoH();
    if (paidUsd <= 0) claim.status = "denied";
    else if (paidUsd >= allowedUsd) claim.status = "paid";
    else claim.status = "partial";
    saveStateIfAvailable();
    return { ok: true, result: { claim } };
  });

  // ── Clinical decision support at order entry (beyond interactions) ──
  // Fires Best-Practice-Advisory alerts when an order is placed:
  // duplicate orders, renal dosing on imaging contrast, missing
  // baseline labs, age-inappropriate, and allergy cross-check.

  registerLensAction("healthcare", "cds-order-check", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    const patient = bucketH(s.patients, userId).find(p => p.id === patientId);
    if (!patient) return { ok: false, error: "patient not found" };
    const orderKind = ["lab", "imaging", "medication", "referral", "procedure"].includes(params.orderKind) ? params.orderKind : "lab";
    const orderName = String(params.orderName || "").trim();
    if (!orderName) return { ok: false, error: "orderName required" };
    const lower = orderName.toLowerCase();
    const age = ageFromDob(patient.dob);
    const orders = bucketH(s.orders, userId).filter(o => o.patientId === patientId);
    const labs = bucketH(s.labs, userId).filter(l => l.patientId === patientId);
    const allergies = bucketH(s.allergies, userId).filter(a => a.patientId === patientId);
    const alerts = [];

    // Duplicate-order advisory — same name, still open, last 7 days.
    const dup = orders.find(o =>
      String(o.name || "").toLowerCase() === lower &&
      ["placed", "active", "in-progress"].includes(o.status) &&
      daysSince(o.orderedAt) <= 7
    );
    if (dup) {
      alerts.push({ severity: "moderate", code: "DUPLICATE_ORDER", message: `A "${orderName}" order was already placed in the last 7 days.` });
    }
    // Imaging contrast + renal function.
    if (orderKind === "imaging" && /contrast|with iv contrast|ct\b|angiogra|mri with/.test(lower)) {
      const cr = labs.filter(l => /creatinine/.test(l.test || "")).slice().sort((a, b) => String(b.collectedAt).localeCompare(String(a.collectedAt)))[0];
      if (!cr) {
        alerts.push({ severity: "moderate", code: "MISSING_BASELINE", message: "No baseline creatinine on file — recommended before iodinated contrast." });
      } else if (Number(cr.value) > 1.5) {
        alerts.push({ severity: "major", code: "RENAL_RISK", message: `Last creatinine ${cr.value} ${cr.unit || ""} is elevated — contrast-induced nephropathy risk.` });
      }
    }
    // Drug allergy cross-check at medication order entry.
    if (orderKind === "medication") {
      for (const alg of allergies) {
        const allergen = String(alg.allergen || alg.name || "").trim().toLowerCase();
        if (allergen.length >= 3 && lower.includes(allergen)) {
          alerts.push({ severity: "major", code: "ALLERGY", message: `Patient has a documented allergy to ${alg.allergen}.` });
        }
      }
      // High-risk meds in the elderly (Beers-style).
      if (age != null && age >= 65 && /(diazepam|lorazepam|alprazolam|diphenhydramine|amitriptyline|cyclobenzaprine)/.test(lower)) {
        alerts.push({ severity: "moderate", code: "BEERS", message: "Potentially inappropriate medication for patients age 65+ (Beers criteria)." });
      }
    }
    // Anticoagulant monitoring advisory.
    if (orderKind === "medication" && /(warfarin|coumadin)/.test(lower)) {
      const inr = labs.filter(l => /inr|pt\b/.test(l.test || ""));
      if (inr.length === 0) {
        alerts.push({ severity: "moderate", code: "MONITOR", message: "Warfarin ordered — schedule baseline INR/PT and follow-up monitoring." });
      }
    }
    return {
      ok: true,
      result: {
        orderName,
        orderKind,
        alerts,
        alertCount: alerts.length,
        hasMajor: alerts.some(a => a.severity === "major"),
        clean: alerts.length === 0,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── FHIR R4 export (immunization / health-record sharing) ──────
  // Produces a real FHIR R4 Bundle (type: collection) so the record
  // can be imported into any FHIR-conformant system.

  registerLensAction("healthcare", "fhir-export", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    const patient = bucketH(s.patients, userId).find(p => p.id === patientId);
    if (!patient) return { ok: false, error: "patient not found" };
    const filter = (m) => bucketH(m, userId).filter(x => x.patientId === patientId);
    const sexMap = { M: "male", F: "female", X: "other", U: "unknown" };
    const entries = [];
    entries.push({
      resource: {
        resourceType: "Patient",
        id: patient.id,
        identifier: [{ system: "urn:concord:mrn", value: patient.mrn }],
        name: [{ family: patient.lastName, given: [patient.firstName] }],
        gender: sexMap[patient.sex] || "unknown",
        birthDate: patient.dob || undefined,
        telecom: [
          patient.phone ? { system: "phone", value: patient.phone } : null,
          patient.email ? { system: "email", value: patient.email } : null,
        ].filter(Boolean),
      },
    });
    for (const prob of filter(s.problems)) {
      entries.push({
        resource: {
          resourceType: "Condition",
          id: prob.id,
          clinicalStatus: { coding: [{ code: prob.status === "resolved" ? "resolved" : "active" }] },
          code: {
            text: prob.name,
            coding: prob.icd10 ? [{ system: "http://hl7.org/fhir/sid/icd-10-cm", code: prob.icd10 }] : [],
          },
          subject: { reference: `Patient/${patient.id}` },
          onsetDateTime: prob.onsetDate || undefined,
        },
      });
    }
    for (const alg of filter(s.allergies)) {
      entries.push({
        resource: {
          resourceType: "AllergyIntolerance",
          id: alg.id,
          category: [alg.kind === "drug" ? "medication" : alg.kind],
          criticality: ["severe", "life_threatening"].includes(alg.severity) ? "high" : "low",
          code: { text: alg.allergen },
          patient: { reference: `Patient/${patient.id}` },
          reaction: alg.reaction ? [{ manifestation: [{ text: alg.reaction }] }] : undefined,
        },
      });
    }
    for (const imm of filter(s.immunizations)) {
      entries.push({
        resource: {
          resourceType: "Immunization",
          id: imm.id,
          status: "completed",
          vaccineCode: {
            text: imm.vaccine,
            coding: imm.cvx ? [{ system: "http://hl7.org/fhir/sid/cvx", code: imm.cvx }] : [],
          },
          patient: { reference: `Patient/${patient.id}` },
          occurrenceDateTime: imm.administeredAt || undefined,
          lotNumber: imm.lotNumber || undefined,
        },
      });
    }
    for (const lab of filter(s.labs)) {
      entries.push({
        resource: {
          resourceType: "Observation",
          id: lab.id,
          status: lab.released ? "final" : "preliminary",
          category: [{ coding: [{ code: "laboratory" }] }],
          code: { text: lab.test },
          subject: { reference: `Patient/${patient.id}` },
          effectiveDateTime: lab.collectedAt || undefined,
          valueQuantity: { value: lab.value, unit: lab.unit || undefined },
          interpretation: lab.flag && lab.flag !== "normal"
            ? [{ text: lab.flag }]
            : undefined,
          referenceRange: (lab.refLow != null || lab.refHigh != null)
            ? [{ low: lab.refLow != null ? { value: lab.refLow } : undefined, high: lab.refHigh != null ? { value: lab.refHigh } : undefined }]
            : undefined,
        },
      });
    }
    for (const v of filter(s.vitals)) {
      entries.push({
        resource: {
          resourceType: "Observation",
          id: v.id,
          status: "final",
          category: [{ coding: [{ code: "vital-signs" }] }],
          code: { text: "Vital signs panel" },
          subject: { reference: `Patient/${patient.id}` },
          effectiveDateTime: v.recordedAt || undefined,
          component: [
            v.systolic != null ? { code: { text: "Systolic BP" }, valueQuantity: { value: v.systolic, unit: "mmHg" } } : null,
            v.diastolic != null ? { code: { text: "Diastolic BP" }, valueQuantity: { value: v.diastolic, unit: "mmHg" } } : null,
            v.heartRate != null ? { code: { text: "Heart rate" }, valueQuantity: { value: v.heartRate, unit: "bpm" } } : null,
            v.spo2 != null ? { code: { text: "SpO2" }, valueQuantity: { value: v.spo2, unit: "%" } } : null,
            v.tempF != null ? { code: { text: "Body temperature" }, valueQuantity: { value: v.tempF, unit: "F" } } : null,
          ].filter(Boolean),
        },
      });
    }
    const onlyImm = params.scope === "immunizations";
    const bundle = {
      resourceType: "Bundle",
      type: "collection",
      timestamp: isoH(),
      entry: onlyImm
        ? entries.filter(e => ["Patient", "Immunization"].includes(e.resource.resourceType))
        : entries,
    };
    return {
      ok: true,
      result: {
        fhirVersion: "4.0.1",
        bundle,
        resourceCount: bundle.entry.length,
        scope: onlyImm ? "immunizations" : "full-record",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Family / proxy access to another patient's chart ───────────
  // The chart owner grants a named proxy scoped read (and optionally
  // write) access to a specific patient. Grants are revocable.

  registerLensAction("healthcare", "proxy-grant", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogBuckets(s);
    const userId = aidH(ctx);
    const patientId = String(params.patientId || "");
    if (!bucketH(s.patients, userId).some(p => p.id === patientId)) return { ok: false, error: "patient not found" };
    const proxyName = String(params.proxyName || "").trim();
    if (!proxyName) return { ok: false, error: "proxyName required" };
    const grant = {
      id: uidH("proxy"),
      patientId,
      proxyName,
      proxyEmail: String(params.proxyEmail || ""),
      relationship: ["parent", "child", "spouse", "guardian", "caregiver", "sibling", "other"].includes(params.relationship) ? params.relationship : "other",
      accessLevel: ["view", "view_and_message", "full"].includes(params.accessLevel) ? params.accessLevel : "view",
      status: "active",
      grantedAt: isoH(),
      revokedAt: null,
      expiresOn: String(params.expiresOn || ""),
    };
    bucketH(s.proxyGrants, userId).push(grant);
    saveStateIfAvailable();
    return { ok: true, result: { grant } };
  });

  registerLensAction("healthcare", "proxy-list", (ctx, _a, params = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogBuckets(s);
    const patientId = String(params.patientId || "");
    let list = bucketH(s.proxyGrants, aidH(ctx));
    if (patientId) list = list.filter(g => g.patientId === patientId);
    return {
      ok: true,
      result: {
        grants: list.slice().sort((a, b) => String(b.grantedAt).localeCompare(String(a.grantedAt))),
        activeCount: list.filter(g => g.status === "active").length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("healthcare", "proxy-revoke", (ctx, _a, params = {}) => {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogBuckets(s);
    const grant = bucketH(s.proxyGrants, aidH(ctx)).find(g => g.id === String(params.id || ""));
    if (!grant) return { ok: false, error: "grant not found" };
    if (grant.status === "revoked") return { ok: false, error: "grant already revoked" };
    grant.status = "revoked";
    grant.revokedAt = isoH();
    saveStateIfAvailable();
    return { ok: true, result: { grant } };
  });

  // ── Dashboard summary ─────────────────────────────────────────

  registerLensAction("healthcare", "dashboard-summary", (ctx, _a, _p = {}) => {
  try {
    const s = getHealthState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidH(ctx);
    const patients = bucketH(s.patients, userId);
    const encs = bucketH(s.encounters, userId);
    const today = dayH();
    const todaysVisits = encs.filter(e => e.encounteredAt.slice(0, 10) === today).length;
    const unsignedNotes = encs.filter(e => e.status === 'open').length;
    const inboxUnread = bucketH(s.messages, userId).filter(m => !m.readAt && m.direction === 'from_patient').length;
    const pendingRefills = bucketH(s.refills, userId).filter(r => r.status === 'requested').length;
    const criticalLabs = bucketH(s.labs, userId).filter(l => /critical/.test(l.flag)).length;
    const allergiesCount = bucketH(s.allergies, userId).length;
    const activeProblems = bucketH(s.problems, userId).filter(p => p.status === 'active').length;
    return {
      ok: true,
      result: {
        patientCount: patients.length,
        todaysVisits,
        unsignedNotes,
        inboxUnread,
        pendingRefills,
        criticalLabs,
        activeProblems,
        allergiesCount,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
};

function extractJsonHealth(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(body.slice(first, last + 1)); } catch { return null; }
}

function scheduleToDosesPerDay(schedule) {
  switch (schedule) {
    case "twice_daily": return 2;
    case "three_times_daily": return 3;
    case "four_times_daily": return 4;
    case "weekly": return 0;
    case "as_needed": return 1;
    default: return 1;
  }
}

// Note: prior versions held SAMPLE_PROVIDER_NAMES + SAMPLE_PRACTICES
// constants used to synthesize fake provider search results. Per the
// "everything must be real" directive, those have been removed —
// `providers-search` now hits the CMS NPI registry directly.
