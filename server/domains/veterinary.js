// server/domains/veterinary.js
//
// Veterinary practice lens. Clinical calculators (triage, weight,
// vaccine schedule, cost) + a per-user patient-records substrate
// (patients / visits / vaccinations) + a real openFDA animal &
// veterinary adverse-event feed. Free public source, no API key.

export default function registerVeterinaryActions(registerLensAction) {
  // ─── Clinical calculators ───────────────────────────────────────────
  registerLensAction("veterinary", "triageAssess", (ctx, artifact, _params) => { const data = artifact.data || {}; const symptoms = data.symptoms || []; const species = (data.species || "dog").toLowerCase(); const age = parseFloat(data.age) || 3; const emergency = symptoms.some(s => ["not-breathing","seizure","bleeding","unconscious","poisoning","bloat","hit-by-car"].includes((s.name || s).toLowerCase())); const urgent = symptoms.some(s => ["vomiting","diarrhea","limping","not-eating","lethargy","swelling"].includes((s.name || s).toLowerCase())); return { ok: true, result: { species, age, symptoms: symptoms.map(s => s.name || s), triageLevel: emergency ? "EMERGENCY" : urgent ? "urgent" : "routine", responseTime: emergency ? "Immediate — go to emergency vet NOW" : urgent ? "See vet within 24 hours" : "Schedule routine appointment", firstAid: emergency ? ["Keep animal calm", "Do not move if spinal injury suspected", "Apply pressure to bleeding", "Call emergency vet en route"] : [] } }; });
  registerLensAction("veterinary", "weightCheck", (ctx, artifact, _params) => { const data = artifact.data || {}; const species = (data.species || "dog").toLowerCase(); const breed = (data.breed || "").toLowerCase(); const weight = parseFloat(data.weight) || 0; const idealRanges = { dog: { small: [5,20], medium: [20,55], large: [55,100] }, cat: { all: [6,14] } }; const range = species === "cat" ? idealRanges.cat.all : weight < 25 ? idealRanges.dog.small : weight < 60 ? idealRanges.dog.medium : idealRanges.dog.large; const inRange = weight >= range[0] && weight <= range[1]; return { ok: true, result: { species, breed: breed || "mixed", currentWeight: weight, idealRange: `${range[0]}-${range[1]} lbs`, status: inRange ? "healthy-weight" : weight < range[0] ? "underweight" : "overweight", recommendation: !inRange ? "Discuss weight management with your vet" : "Weight is in healthy range" } }; });
  registerLensAction("veterinary", "vaccineSchedule", (ctx, artifact, _params) => { const data = artifact.data || {}; const species = (data.species || "dog").toLowerCase(); const age = parseFloat(data.age) || 1; const schedules = { dog: [{ vaccine: "Rabies", ageMonths: 3, booster: "1-3 years" }, { vaccine: "DHPP", ageMonths: 2, booster: "annually" }, { vaccine: "Bordetella", ageMonths: 2, booster: "6-12 months" }], cat: [{ vaccine: "Rabies", ageMonths: 3, booster: "1-3 years" }, { vaccine: "FVRCP", ageMonths: 2, booster: "annually" }, { vaccine: "FeLV", ageMonths: 2, booster: "annually" }] }; const schedule = schedules[species] || schedules.dog; const ageMonths = age * 12; return { ok: true, result: { species, ageMonths: Math.round(ageMonths), vaccines: schedule.map(v => ({ ...v, due: ageMonths >= v.ageMonths ? "due-or-overdue" : `at ${v.ageMonths} months` })), overdueCount: schedule.filter(v => ageMonths >= v.ageMonths).length } }; });
  registerLensAction("veterinary", "costEstimate", (ctx, artifact, _params) => { const procedures = artifact.data?.procedures || []; if (procedures.length === 0) return { ok: true, result: { message: "Add procedures to estimate costs." } }; const costs = { exam: 55, vaccination: 25, spay: 300, neuter: 200, dental: 400, xray: 150, bloodwork: 120, surgery: 1500, emergency: 800, microchip: 45 }; const estimated = procedures.map(p => { const type = (p.type || p.name || "exam").toLowerCase(); const cost = costs[type] || parseFloat(p.cost) || 100; return { procedure: type, estimatedCost: cost }; }); const total = estimated.reduce((s,e) => s + e.estimatedCost, 0); return { ok: true, result: { procedures: estimated, totalEstimate: total, tip: total > 500 ? "Ask about payment plans or pet insurance" : "Routine care is an investment in your pet health" } }; });

  // ─── Patient-records substrate (per-user, STATE-backed) ─────────────
  function getVetState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.veterinaryLens) STATE.veterinaryLens = {};
    const s = STATE.veterinaryLens;
    if (!(s.patients instanceof Map)) s.patients = new Map(); // userId -> Array
    return s;
  }
  function saveVet() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const vtId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const vtActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const vtClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const vtNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const vtPatients = (s, userId) => { if (!s.patients.has(userId)) s.patients.set(userId, []); return s.patients.get(userId); };
  const SPECIES = ["dog", "cat", "bird", "rabbit", "reptile", "horse", "other"];

  registerLensAction("veterinary", "patient-add", (ctx, _a, params = {}) => {
    const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = vtClean(params.name, 120);
    if (!name) return { ok: false, error: "patient name required" };
    const patient = {
      id: vtId("pat"), name,
      species: SPECIES.includes(params.species) ? params.species : "dog",
      breed: vtClean(params.breed, 80) || "mixed",
      owner: vtClean(params.owner, 120) || "",
      ageYears: Math.max(0, vtNum(params.ageYears)),
      weightLbs: Math.max(0, vtNum(params.weightLbs)),
      notes: vtClean(params.notes, 1000) || "",
      visits: [], vaccinations: [],
      createdAt: new Date().toISOString(),
    };
    vtPatients(s, vtActor(ctx)).push(patient);
    saveVet();
    return { ok: true, result: { patient } };
  });

  registerLensAction("veterinary", "patient-list", (ctx, _a, _params = {}) => {
    const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const patients = vtPatients(s, vtActor(ctx)).map((p) => ({
      ...p, visitCount: p.visits.length, vaccinationCount: p.vaccinations.length,
      lastVisit: p.visits.length ? p.visits[p.visits.length - 1].date : null,
    }));
    return { ok: true, result: { patients, count: patients.length } };
  });

  registerLensAction("veterinary", "patient-delete", (ctx, _a, params = {}) => {
    const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = vtPatients(s, vtActor(ctx));
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "patient not found" };
    arr.splice(i, 1);
    saveVet();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("veterinary", "visit-log", (ctx, _a, params = {}) => {
    const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const patient = vtPatients(s, vtActor(ctx)).find((p) => p.id === params.patientId);
    if (!patient) return { ok: false, error: "patient not found" };
    const kind = ["checkup", "vaccination", "surgery", "dental", "emergency", "followup"].includes(params.kind) ? params.kind : "checkup";
    const visit = {
      id: vtId("vis"), kind,
      date: vtClean(params.date, 30) || new Date().toISOString().slice(0, 10),
      diagnosis: vtClean(params.diagnosis, 400) || "",
      treatment: vtClean(params.treatment, 600) || "",
      cost: Math.max(0, vtNum(params.cost)),
    };
    patient.visits.push(visit);
    saveVet();
    return { ok: true, result: { visit } };
  });

  registerLensAction("veterinary", "vaccine-record", (ctx, _a, params = {}) => {
    const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const patient = vtPatients(s, vtActor(ctx)).find((p) => p.id === params.patientId);
    if (!patient) return { ok: false, error: "patient not found" };
    const record = {
      id: vtId("vac"),
      vaccine: vtClean(params.vaccine, 80) || "vaccine",
      date: vtClean(params.date, 30) || new Date().toISOString().slice(0, 10),
      nextDue: vtClean(params.nextDue, 30) || "",
    };
    patient.vaccinations.push(record);
    saveVet();
    return { ok: true, result: { record } };
  });

  registerLensAction("veterinary", "vet-dashboard", (ctx, _a, _params = {}) => {
    const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const patients = vtPatients(s, vtActor(ctx));
    const bySpecies = {};
    let visits = 0, revenue = 0;
    for (const p of patients) {
      bySpecies[p.species] = (bySpecies[p.species] || 0) + 1;
      visits += p.visits.length;
      revenue += p.visits.reduce((n, v) => n + (v.cost || 0), 0);
    }
    return {
      ok: true,
      result: {
        patients: patients.length, visits,
        revenue: Math.round(revenue * 100) / 100,
        bySpecies,
      },
    };
  });

  // feed — ingest real animal & veterinary adverse-event reports from
  // openFDA as visible DTUs. Free public API, no key.
  registerLensAction("veterinary", "feed", async (ctx, _a, params = {}) => {
    const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 10)));
    try {
      const r = await fetch(`https://api.fda.gov/animalandveterinary/event.json?sort=original_receive_date:desc&limit=${limit}`);
      if (!r.ok) return { ok: false, error: `openfda ${r.status}` };
      const data = await r.json();
      const events = (Array.isArray(data?.results) ? data.results : []).slice(0, limit);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const ev of events) {
        const id = `vetevent_${ev.unique_aer_id_number || JSON.stringify(ev).slice(0, 40)}`;
        if (s.feedSeen.has(id)) { skipped++; continue; }
        const species = ev.animal?.species || "animal";
        const drugs = (ev.drug || []).map((d) => d.brand_name || d.active_ingredients?.[0]?.name).filter(Boolean).join(", ");
        const reactions = (ev.reaction || []).map((rx) => rx.veddra_term_name).filter(Boolean).slice(0, 5).join(", ");
        const title = `Vet adverse event: ${species}${drugs ? ` — ${drugs}` : ""}`.slice(0, 110);
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nSpecies: ${species}\nBreed: ${ev.animal?.breed?.breed_component || "?"}\nDrug(s): ${drugs || "?"}\nReaction(s): ${reactions || "?"}\nReceived: ${ev.original_receive_date || "?"}\nSource: openFDA Animal & Veterinary`,
          tags: ["veterinary", "feed", "adverse-event", "openfda"],
          source: "openfda-vet-feed",
          meta: { aerId: ev.unique_aer_id_number, species, drugs, receiveDate: ev.original_receive_date },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(id); }
      }
      saveVet();
      return { ok: true, result: { ingested, skipped, source: "openfda-vet-events", dtuIds } };
    } catch (e) {
      return { ok: false, error: `openfda unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
