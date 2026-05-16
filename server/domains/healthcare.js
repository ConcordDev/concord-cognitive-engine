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
