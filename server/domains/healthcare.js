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
  });

  /**
   * exportEncounter
   * Format encounter data into a structured export.
   * artifact.data.encounter or artifact.data: { patientName, date, chiefComplaints, diagnosis, plan, vitals, notes }
   */
  registerLensAction("healthcare", "exportEncounter", (ctx, artifact, _params) => {
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
  });

  /**
   * soapAutoFill
   * Generate a SOAP note template from artifact data.
   * artifact.data: { chiefComplaint, symptoms, vitals, examFindings, conditions, assessment, medications, plan }
   */
  registerLensAction("healthcare", "soapAutoFill", (ctx, artifact, _params) => {
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
  });

  /**
   * generateSummary
   * Create a consolidated patient summary from encounters, labs, and
   * treatments stored in artifact.data.
   * Expects artifact.data.encounters, artifact.data.labs, artifact.data.treatments.
   */
  registerLensAction("healthcare", "generateSummary", (ctx, artifact, params) => {
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
  });

  // ─── Parity-sprint macros: MyChart / Doximity / Teladoc / GoodRx / ZocDoc ───

  function getHealthState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.healthLens) {
      STATE.healthLens = { medications: new Map(), records: new Map(), appointments: new Map(), doseLog: new Map() };
    }
    return STATE.healthLens;
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

  registerLensAction("healthcare", "record-get", (ctx, _artifact, _params = {}) => {
    const state = getHealthState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    if (!state.records.has(userId)) state.records.set(userId, seedDemoRecord(userId));
    return { ok: true, result: state.records.get(userId) };
  });

  registerLensAction("healthcare", "providers-search", (_ctx, _artifact, params = {}) => {
    const specialty = String(params.specialty || "Primary care");
    const zip = String(params.zipCode || "");
    const seed = hashStringHealth(zip || "default");
    const providers = SAMPLE_PROVIDER_NAMES.slice(0, 6).map((n, i) => ({
      id: `prov_${specialty.slice(0, 5)}_${i}`,
      name: n, specialty,
      practice: SAMPLE_PRACTICES[(seed + i) % SAMPLE_PRACTICES.length],
      inNetwork: i < 4,
      nextSlot: ["today", "tomorrow", "in 2 days", "in 3 days", "next week", "in 2 weeks"][i],
      acceptsTelehealth: i % 2 === 0,
      rating: 3.8 + ((seed + i * 7) % 13) / 10,
      distanceMi: ((seed + i * 11) % 50) / 5 + 0.5,
    }));
    return { ok: true, result: { providers, specialty, zip } };
  });

  registerLensAction("healthcare", "provider-slots", (_ctx, _artifact, params = {}) => {
    const providerId = String(params.providerId || "");
    const days = Math.max(1, Math.min(30, Number(params.days) || 14));
    if (!providerId) return { ok: false, error: "providerId required" };
    const seed = hashStringHealth(providerId);
    const slots = [];
    for (let d = 1; d <= days; d++) {
      const date = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      const dayOfWeek = new Date(date).getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;
      const slotsThisDay = (seed + d) % 5;
      const hours = [9, 10, 11, 13, 14, 15, 16];
      for (let i = 0; i < slotsThisDay; i++) {
        const hour = hours[i % hours.length];
        slots.push({
          providerId, date,
          time: `${String(hour).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"}`,
          kind: i % 3 === 0 ? "telehealth" : "in_person",
        });
      }
    }
    return { ok: true, result: { slots: slots.slice(0, 40) } };
  });

  registerLensAction("healthcare", "appointment-book", (ctx, _artifact, params = {}) => {
    const state = getHealthState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const providerId = String(params.providerId || "");
    const date = String(params.date || "");
    const time = String(params.time || "");
    const kind = ["telehealth", "in_person"].includes(params.kind) ? params.kind : "in_person";
    if (!providerId || !date || !time) return { ok: false, error: "providerId, date, time required" };
    if (!state.appointments.has(userId)) state.appointments.set(userId, []);
    const appt = {
      id: `appt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      providerId, date, time, kind,
      status: "booked", bookedAt: new Date().toISOString(),
    };
    state.appointments.get(userId).push(appt);
    saveStateIfAvailable();
    return { ok: true, result: { appointment: appt } };
  });

  registerLensAction("healthcare", "rx-price-compare", (_ctx, _artifact, params = {}) => {
    const drug = String(params.drug || "").trim();
    const zip = String(params.zip || "");
    if (!drug) return { ok: false, error: "drug required" };
    const seed = hashStringHealth(drug + zip);
    const base = 8 + (seed % 80);
    const pharmacies = [
      { name: "Costco Pharmacy", multiplier: 0.4, code: "GR-COSTCO" },
      { name: "Walmart Pharmacy", multiplier: 0.6, code: "GR-WALMART" },
      { name: "Kroger Pharmacy", multiplier: 0.75 },
      { name: "CVS Pharmacy", multiplier: 1.0 },
      { name: "Walgreens", multiplier: 1.15 },
      { name: "Rite Aid", multiplier: 0.85 },
      { name: "Mail-order (Express Scripts)", multiplier: 0.5, code: "ESI-MAIL" },
    ];
    const prices = pharmacies.map((p, i) => ({
      pharmacy: p.name,
      address: `${100 + (seed + i * 7) % 9000} Main St`,
      distanceMi: ((seed + i * 13) % 40) / 4 + 0.3,
      cashPrice: Math.round(base * p.multiplier * 100) / 100,
      withInsuranceCopay: (seed + i) % 3 === 0 ? Math.round(base * p.multiplier * 0.3 * 100) / 100 : undefined,
      couponCode: p.code,
      inStock: i !== 5,
    }));
    return { ok: true, result: { prices, drug, zip } };
  });
};

function hashStringHealth(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

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

function seedDemoRecord(userId) {
  const seed = hashStringHealth(userId);
  const baseDate = new Date(Date.now() - 86400000 * 2);
  return {
    vitals: [
      { channel: "heart_rate", value: 60 + (seed % 30), unit: "bpm", recordedAt: baseDate.toISOString() },
      { channel: "bp_systolic", value: 110 + (seed % 25), unit: "mmHg", recordedAt: baseDate.toISOString() },
      { channel: "bp_diastolic", value: 70 + (seed % 15), unit: "mmHg", recordedAt: baseDate.toISOString() },
      { channel: "spo2", value: 96 + (seed % 4), unit: "%", recordedAt: baseDate.toISOString() },
      { channel: "temperature", value: 97.5 + (seed % 30) / 10, unit: "°F", recordedAt: baseDate.toISOString() },
      { channel: "respiratory_rate", value: 14 + (seed % 6), unit: "/min", recordedAt: baseDate.toISOString() },
      { channel: "weight", value: 150 + (seed % 80), unit: "lb", recordedAt: baseDate.toISOString() },
    ],
    allergies: seed % 4 === 0 ? [
      { substance: "Penicillin", reaction: "Rash, hives", severity: "moderate" },
      { substance: "Shellfish", reaction: "Anaphylaxis", severity: "life_threatening" },
    ] : seed % 3 === 0 ? [
      { substance: "Sulfa drugs", reaction: "Rash", severity: "mild" },
    ] : [],
    immunizations: [
      { vaccine: "COVID-19 (Pfizer-BioNTech)", administeredAt: "2024-10-15", doseNumber: 4, totalDoses: 4 },
      { vaccine: "Influenza (seasonal)", administeredAt: "2024-10-15", doseNumber: 1, totalDoses: 1 },
      { vaccine: "Tdap", administeredAt: "2021-03-22", doseNumber: 1, totalDoses: 1 },
      { vaccine: "MMR", administeredAt: "1990-08-10", doseNumber: 2, totalDoses: 2 },
    ],
    conditions: seed % 5 === 0 ? [
      { name: "Type 2 Diabetes", diagnosedAt: "2020-06-15", status: "active" },
      { name: "Hypertension (controlled)", diagnosedAt: "2019-02-10", status: "active" },
    ] : seed % 4 === 0 ? [
      { name: "Seasonal allergies", diagnosedAt: "2018-04-01", status: "active" },
    ] : [],
  };
}

const SAMPLE_PROVIDER_NAMES = [
  "Dr. Aisha Patel, MD", "Dr. Marcus Chen, DO", "Dr. Sofia Martinez, MD", "Dr. James O'Brien, MD",
  "Dr. Priya Sharma, NP", "Dr. Robert Kim, MD", "Dr. Emily Walker, PA-C", "Dr. David Nguyen, MD",
];
const SAMPLE_PRACTICES = [
  "Bay Area Medical Group", "Westside Family Health", "Mission Wellness", "Pacific Heights Internal",
  "Sunset Family Practice", "Mid-City Clinic", "Civic Center Medical", "Marina District Health",
];
