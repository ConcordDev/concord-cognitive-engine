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

  // ─── Appointment scheduling / calendar ─────────────────────────────
  function vtCollection(s, key) {
    if (!(s[key] instanceof Map)) s[key] = new Map(); // userId -> Array
    return s[key];
  }
  const vtList = (col, userId) => { if (!col.has(userId)) col.set(userId, []); return col.get(userId); };
  const APPT_TYPES = ["wellness", "sick", "surgery", "dental", "emergency", "vaccination", "followup"];
  const APPT_STATUS = ["scheduled", "checked_in", "in_progress", "completed", "no_show", "cancelled"];

  registerLensAction("veterinary", "appointment-book", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const col = vtCollection(s, "appointments");
      const patientName = vtClean(params.patientName, 120);
      if (!patientName) return { ok: false, error: "patientName required" };
      const date = vtClean(params.date, 30);
      if (!date) return { ok: false, error: "date required (YYYY-MM-DD)" };
      const appt = {
        id: vtId("apt"),
        patientId: vtClean(params.patientId, 60) || "",
        patientName,
        owner: vtClean(params.owner, 120) || "",
        type: APPT_TYPES.includes(params.type) ? params.type : "wellness",
        date,
        time: vtClean(params.time, 10) || "09:00",
        durationMin: Math.max(5, Math.min(480, vtNum(params.durationMin) || 30)),
        vet: vtClean(params.vet, 80) || "",
        reason: vtClean(params.reason, 400) || "",
        status: "scheduled",
        createdAt: new Date().toISOString(),
      };
      vtList(col, vtActor(ctx)).push(appt);
      saveVet();
      return { ok: true, result: { appointment: appt } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("veterinary", "appointment-list", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const col = vtCollection(s, "appointments");
      let appts = vtList(col, vtActor(ctx)).slice();
      const day = vtClean(params.date, 30);
      if (day) appts = appts.filter((a) => a.date === day);
      const status = vtClean(params.status, 30);
      if (status) appts = appts.filter((a) => a.status === status);
      appts.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      const noShows = vtList(col, vtActor(ctx)).filter((a) => a.status === "no_show").length;
      return { ok: true, result: { appointments: appts, count: appts.length, noShows } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("veterinary", "appointment-status", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = vtList(vtCollection(s, "appointments"), vtActor(ctx));
      const appt = arr.find((a) => a.id === params.id);
      if (!appt) return { ok: false, error: "appointment not found" };
      if (!APPT_STATUS.includes(params.status)) return { ok: false, error: "invalid status" };
      appt.status = params.status;
      appt.updatedAt = new Date().toISOString();
      saveVet();
      return { ok: true, result: { appointment: appt } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("veterinary", "appointment-cancel", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = vtList(vtCollection(s, "appointments"), vtActor(ctx));
      const i = arr.findIndex((a) => a.id === params.id);
      if (i < 0) return { ok: false, error: "appointment not found" };
      arr.splice(i, 1);
      saveVet();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Invoicing & payment ───────────────────────────────────────────
  registerLensAction("veterinary", "invoice-create", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const col = vtCollection(s, "invoices");
      const patientName = vtClean(params.patientName, 120);
      if (!patientName) return { ok: false, error: "patientName required" };
      const rawItems = Array.isArray(params.lineItems) ? params.lineItems : [];
      const lineItems = rawItems.map((li) => ({
        description: vtClean(li.description, 200) || "service",
        qty: Math.max(1, vtNum(li.qty) || 1),
        unitPrice: Math.max(0, vtNum(li.unitPrice)),
      })).map((li) => ({ ...li, lineTotal: Math.round(li.qty * li.unitPrice * 100) / 100 }));
      const subtotal = lineItems.reduce((n, li) => n + li.lineTotal, 0);
      const taxRate = Math.max(0, Math.min(0.3, vtNum(params.taxRate)));
      const tax = Math.round(subtotal * taxRate * 100) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;
      const invoice = {
        id: vtId("inv"),
        patientId: vtClean(params.patientId, 60) || "",
        patientName,
        owner: vtClean(params.owner, 120) || "",
        lineItems, subtotal, taxRate, tax, total,
        amountPaid: 0,
        balanceDue: total,
        status: total === 0 ? "paid" : "unpaid",
        payments: [],
        createdAt: new Date().toISOString(),
      };
      vtList(col, vtActor(ctx)).push(invoice);
      saveVet();
      return { ok: true, result: { invoice } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("veterinary", "invoice-list", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let invoices = vtList(vtCollection(s, "invoices"), vtActor(ctx)).slice();
      const status = vtClean(params.status, 30);
      if (status) invoices = invoices.filter((iv) => iv.status === status);
      invoices.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      const outstanding = invoices.reduce((n, iv) => n + (iv.balanceDue || 0), 0);
      const collected = invoices.reduce((n, iv) => n + (iv.amountPaid || 0), 0);
      return {
        ok: true,
        result: {
          invoices, count: invoices.length,
          outstanding: Math.round(outstanding * 100) / 100,
          collected: Math.round(collected * 100) / 100,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("veterinary", "invoice-pay", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = vtList(vtCollection(s, "invoices"), vtActor(ctx));
      const inv = arr.find((iv) => iv.id === params.id);
      if (!inv) return { ok: false, error: "invoice not found" };
      const amount = Math.max(0, vtNum(params.amount));
      if (amount <= 0) return { ok: false, error: "payment amount required" };
      const payment = {
        amount: Math.round(amount * 100) / 100,
        method: ["cash", "card", "check", "insurance", "plan"].includes(params.method) ? params.method : "card",
        date: new Date().toISOString(),
      };
      inv.payments.push(payment);
      inv.amountPaid = Math.round((inv.amountPaid + payment.amount) * 100) / 100;
      inv.balanceDue = Math.round(Math.max(0, inv.total - inv.amountPaid) * 100) / 100;
      inv.status = inv.balanceDue <= 0 ? "paid" : inv.amountPaid > 0 ? "partial" : "unpaid";
      saveVet();
      return { ok: true, result: { invoice: inv, payment } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Vaccine-due reminders / overdue alerts ────────────────────────
  registerLensAction("veterinary", "vaccine-reminders", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const horizonDays = Math.max(1, Math.min(365, vtNum(params.horizonDays) || 30));
      const now = new Date();
      const horizon = new Date(now.getTime() + horizonDays * 86400000);
      const overdue = [], dueSoon = [];
      for (const p of vtPatients(s, vtActor(ctx))) {
        for (const v of (p.vaccinations || [])) {
          if (!v.nextDue) continue;
          const due = new Date(v.nextDue);
          if (Number.isNaN(due.getTime())) continue;
          const daysOut = Math.round((due.getTime() - now.getTime()) / 86400000);
          const entry = {
            patientId: p.id, patientName: p.name, owner: p.owner,
            vaccine: v.vaccine, nextDue: v.nextDue, daysOut,
          };
          if (due < now) overdue.push(entry);
          else if (due <= horizon) dueSoon.push(entry);
        }
      }
      overdue.sort((a, b) => a.daysOut - b.daysOut);
      dueSoon.sort((a, b) => a.daysOut - b.daysOut);
      return {
        ok: true,
        result: {
          overdue, dueSoon,
          overdueCount: overdue.length, dueSoonCount: dueSoon.length,
          horizonDays,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── SOAP-format medical charting ──────────────────────────────────
  registerLensAction("veterinary", "soap-chart", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const col = vtCollection(s, "soapNotes");
      const patientName = vtClean(params.patientName, 120);
      if (!patientName) return { ok: false, error: "patientName required" };
      const note = {
        id: vtId("soap"),
        patientId: vtClean(params.patientId, 60) || "",
        patientName,
        visitId: vtClean(params.visitId, 60) || "",
        date: vtClean(params.date, 30) || new Date().toISOString().slice(0, 10),
        vet: vtClean(params.vet, 80) || "",
        subjective: vtClean(params.subjective, 2000) || "",
        objective: vtClean(params.objective, 2000) || "",
        assessment: vtClean(params.assessment, 2000) || "",
        plan: vtClean(params.plan, 2000) || "",
        createdAt: new Date().toISOString(),
      };
      vtList(col, vtActor(ctx)).push(note);
      saveVet();
      return { ok: true, result: { note } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("veterinary", "soap-list", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let notes = vtList(vtCollection(s, "soapNotes"), vtActor(ctx)).slice();
      const pid = vtClean(params.patientId, 60);
      if (pid) notes = notes.filter((n) => n.patientId === pid);
      notes.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      return { ok: true, result: { notes, count: notes.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Prescription / medication tracking & refills ──────────────────
  registerLensAction("veterinary", "prescription-add", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const col = vtCollection(s, "prescriptions");
      const drug = vtClean(params.drug, 120);
      if (!drug) return { ok: false, error: "drug required" };
      const refillsTotal = Math.max(0, Math.min(24, vtNum(params.refills)));
      const rx = {
        id: vtId("rx"),
        patientId: vtClean(params.patientId, 60) || "",
        patientName: vtClean(params.patientName, 120) || "",
        drug,
        dosage: vtClean(params.dosage, 200) || "",
        frequency: vtClean(params.frequency, 120) || "",
        durationDays: Math.max(0, vtNum(params.durationDays)),
        refillsTotal,
        refillsUsed: 0,
        refillsRemaining: refillsTotal,
        prescribedBy: vtClean(params.prescribedBy, 80) || "",
        status: "active",
        prescribedAt: new Date().toISOString(),
        refillHistory: [],
      };
      vtList(col, vtActor(ctx)).push(rx);
      saveVet();
      return { ok: true, result: { prescription: rx } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("veterinary", "prescription-list", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let rxs = vtList(vtCollection(s, "prescriptions"), vtActor(ctx)).slice();
      const pid = vtClean(params.patientId, 60);
      if (pid) rxs = rxs.filter((r) => r.patientId === pid);
      const status = vtClean(params.status, 30);
      if (status) rxs = rxs.filter((r) => r.status === status);
      rxs.sort((a, b) => (b.prescribedAt || "").localeCompare(a.prescribedAt || ""));
      const active = rxs.filter((r) => r.status === "active").length;
      return { ok: true, result: { prescriptions: rxs, count: rxs.length, active } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("veterinary", "prescription-refill", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = vtList(vtCollection(s, "prescriptions"), vtActor(ctx));
      const rx = arr.find((r) => r.id === params.id);
      if (!rx) return { ok: false, error: "prescription not found" };
      if (rx.refillsRemaining <= 0) return { ok: false, error: "no refills remaining" };
      rx.refillsUsed += 1;
      rx.refillsRemaining = rx.refillsTotal - rx.refillsUsed;
      rx.refillHistory.push({ date: new Date().toISOString() });
      if (rx.refillsRemaining <= 0) rx.status = "completed";
      saveVet();
      return { ok: true, result: { prescription: rx } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Owner portal ──────────────────────────────────────────────────
  registerLensAction("veterinary", "owner-portal", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const owner = vtClean(params.owner, 120);
      if (!owner) return { ok: false, error: "owner name required" };
      const userId = vtActor(ctx);
      const ownerLc = owner.toLowerCase();
      const pets = vtPatients(s, userId)
        .filter((p) => (p.owner || "").toLowerCase() === ownerLc)
        .map((p) => ({
          id: p.id, name: p.name, species: p.species, breed: p.breed,
          ageYears: p.ageYears, weightLbs: p.weightLbs,
          visits: p.visits || [], vaccinations: p.vaccinations || [],
        }));
      const petIds = new Set(pets.map((p) => p.id));
      const appts = vtList(vtCollection(s, "appointments"), userId)
        .filter((a) => petIds.has(a.patientId) || (a.owner || "").toLowerCase() === ownerLc);
      const invoices = vtList(vtCollection(s, "invoices"), userId)
        .filter((iv) => petIds.has(iv.patientId) || (iv.owner || "").toLowerCase() === ownerLc);
      const rxs = vtList(vtCollection(s, "prescriptions"), userId)
        .filter((r) => petIds.has(r.patientId));
      const balanceDue = invoices.reduce((n, iv) => n + (iv.balanceDue || 0), 0);
      return {
        ok: true,
        result: {
          owner, pets, appointments: appts, invoices, prescriptions: rxs,
          petCount: pets.length,
          balanceDue: Math.round(balanceDue * 100) / 100,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Lab / imaging result attachments ──────────────────────────────
  registerLensAction("veterinary", "lab-attach", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const col = vtCollection(s, "labResults");
      const patientName = vtClean(params.patientName, 120);
      if (!patientName) return { ok: false, error: "patientName required" };
      const kind = ["bloodwork", "urinalysis", "xray", "ultrasound", "cytology", "biopsy", "other"]
        .includes(params.kind) ? params.kind : "bloodwork";
      const result = {
        id: vtId("lab"),
        patientId: vtClean(params.patientId, 60) || "",
        patientName,
        visitId: vtClean(params.visitId, 60) || "",
        kind,
        title: vtClean(params.title, 200) || `${kind} result`,
        findings: vtClean(params.findings, 3000) || "",
        attachmentUrl: vtClean(params.attachmentUrl, 600) || "",
        flag: ["normal", "abnormal", "critical", "pending"].includes(params.flag) ? params.flag : "pending",
        date: vtClean(params.date, 30) || new Date().toISOString().slice(0, 10),
        createdAt: new Date().toISOString(),
      };
      vtList(col, vtActor(ctx)).push(result);
      saveVet();
      return { ok: true, result: { labResult: result } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("veterinary", "lab-list", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let results = vtList(vtCollection(s, "labResults"), vtActor(ctx)).slice();
      const pid = vtClean(params.patientId, 60);
      if (pid) results = results.filter((r) => r.patientId === pid);
      const flag = vtClean(params.flag, 30);
      if (flag) results = results.filter((r) => r.flag === flag);
      results.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      const abnormal = results.filter((r) => r.flag === "abnormal" || r.flag === "critical").length;
      return { ok: true, result: { results, count: results.length, abnormal } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("veterinary", "lab-delete", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = vtList(vtCollection(s, "labResults"), vtActor(ctx));
      const i = arr.findIndex((r) => r.id === params.id);
      if (i < 0) return { ok: false, error: "lab result not found" };
      arr.splice(i, 1);
      saveVet();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Inventory management for clinic supplies & meds ───────────────
  registerLensAction("veterinary", "inventory-add", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const col = vtCollection(s, "inventory");
      const name = vtClean(params.name, 160);
      if (!name) return { ok: false, error: "item name required" };
      const item = {
        id: vtId("itm"),
        name,
        category: ["medication", "vaccine", "supply", "food", "equipment", "other"]
          .includes(params.category) ? params.category : "supply",
        sku: vtClean(params.sku, 60) || "",
        quantity: Math.max(0, vtNum(params.quantity)),
        unit: vtClean(params.unit, 30) || "units",
        reorderLevel: Math.max(0, vtNum(params.reorderLevel)),
        unitCost: Math.max(0, vtNum(params.unitCost)),
        expiryDate: vtClean(params.expiryDate, 30) || "",
        createdAt: new Date().toISOString(),
      };
      vtList(col, vtActor(ctx)).push(item);
      saveVet();
      return { ok: true, result: { item } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("veterinary", "inventory-list", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let items = vtList(vtCollection(s, "inventory"), vtActor(ctx)).slice();
      const category = vtClean(params.category, 30);
      if (category) items = items.filter((it) => it.category === category);
      items.sort((a, b) => a.name.localeCompare(b.name));
      const now = Date.now();
      const lowStock = items.filter((it) => it.quantity <= it.reorderLevel).length;
      const expiringSoon = items.filter((it) => {
        if (!it.expiryDate) return false;
        const t = Date.parse(it.expiryDate);
        return Number.isFinite(t) && t - now <= 30 * 86400000;
      }).length;
      const totalValue = items.reduce((n, it) => n + it.quantity * it.unitCost, 0);
      return {
        ok: true,
        result: {
          items, count: items.length, lowStock, expiringSoon,
          totalValue: Math.round(totalValue * 100) / 100,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("veterinary", "inventory-adjust", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = vtList(vtCollection(s, "inventory"), vtActor(ctx));
      const item = arr.find((it) => it.id === params.id);
      if (!item) return { ok: false, error: "item not found" };
      const delta = vtNum(params.delta);
      item.quantity = Math.max(0, item.quantity + delta);
      item.updatedAt = new Date().toISOString();
      saveVet();
      return { ok: true, result: { item } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("veterinary", "inventory-delete", (ctx, _a, params = {}) => {
    try {
      const s = getVetState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = vtList(vtCollection(s, "inventory"), vtActor(ctx));
      const i = arr.findIndex((it) => it.id === params.id);
      if (i < 0) return { ok: false, error: "item not found" };
      arr.splice(i, 1);
      saveVet();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
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
