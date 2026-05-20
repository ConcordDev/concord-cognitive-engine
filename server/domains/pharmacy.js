// server/domains/pharmacy.js
//
// Pure-compute pharmacy helpers (dosage calc, inventory alerts,
// formulary search) plus real OpenFDA Drug API for label info,
// adverse events, and drug interactions sourced from FDA's
// Structured Product Labeling (SPL) database.
//
// OpenFDA is free, no API key required (rate-limited 240 req/min
// per IP). For higher quotas, register at open.fda.gov/apis/authentication
// and set OPENFDA_API_KEY env.
//
// Per the "everything must be real" directive: drugInteractionCheck
// previously hardcoded 5 interactions; now hits the real FDA label
// database (50,000+ drug labels with full DRUG_INTERACTIONS sections).

const OPENFDA_BASE = "https://api.fda.gov/drug";

async function openfdaLabelLookup(name) {
  const apiKey = process.env.OPENFDA_API_KEY;
  const keyParam = apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : "";
  const url = `${OPENFDA_BASE}/label.json?search=openfda.brand_name:"${encodeURIComponent(name)}"+OR+openfda.generic_name:"${encodeURIComponent(name)}"&limit=1${keyParam}`;
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) {
    if (r.status === 429) throw new Error("openfda rate limit exceeded — set OPENFDA_API_KEY env");
    throw new Error(`openfda ${r.status}`);
  }
  const data = await r.json();
  return data?.results?.[0] || null;
}

export default function registerPharmacyActions(registerLensAction) {
  /**
   * drugInteractionCheck — Real drug-interaction lookup via OpenFDA SPL.
   * Pulls the DRUG_INTERACTIONS section from each drug's FDA label and
   * reports cross-mentions. This is NOT a true interaction matrix
   * (requires First Databank or Wolters Kluwer paid feeds); it's the
   * authoritative published warnings text. For clinical decision
   * support, use Lexicomp / FDB / Wolters Kluwer.
   */
  registerLensAction("pharmacy", "drugInteractionCheck", async (_ctx, artifact, params = {}) => {
    const medications = artifact?.data?.medications || params.medications || [];
    if (!Array.isArray(medications) || medications.length < 2) {
      return { ok: false, error: "at least 2 medications required" };
    }
    const names = medications.map((m) => String(typeof m === "string" ? m : (m.name || "")).trim()).filter(Boolean);
    if (names.length < 2) return { ok: false, error: "medications must have non-empty names" };

    const labels = [];
    for (const name of names) {
      try {
        const label = await openfdaLabelLookup(name);
        if (!label) { labels.push({ name, found: false }); continue; }
        labels.push({
          name,
          found: true,
          genericName: label.openfda?.generic_name?.[0] || null,
          brandName: label.openfda?.brand_name?.[0] || null,
          manufacturer: label.openfda?.manufacturer_name?.[0] || null,
          drugInteractionsText: Array.isArray(label.drug_interactions) ? label.drug_interactions[0]?.slice(0, 2000) : null,
          warningsText: Array.isArray(label.warnings) ? label.warnings[0]?.slice(0, 1000) : null,
          spIDsetId: label.set_id,
        });
      } catch (e) {
        return { ok: false, error: `openfda unreachable for "${name}": ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // Co-mention signal: does each drug's DRUG_INTERACTIONS section
    // mention the other by generic or brand name?
    const pairs = [];
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i], b = labels[j];
        if (!a.found || !b.found) continue;
        const aText = `${a.drugInteractionsText || ""} ${a.warningsText || ""}`.toLowerCase();
        const bText = `${b.drugInteractionsText || ""} ${b.warningsText || ""}`.toLowerCase();
        const aMentionsB = [b.genericName, b.brandName].filter(Boolean).some((n) => aText.includes(n.toLowerCase()));
        const bMentionsA = [a.genericName, a.brandName].filter(Boolean).some((n) => bText.includes(n.toLowerCase()));
        if (aMentionsB || bMentionsA) {
          pairs.push({
            drug1: a.name, drug2: b.name,
            aMentionsB, bMentionsA,
            source: "fda-spl-cross-mention",
            severity: "review-label",
          });
        }
      }
    }
    return {
      ok: true,
      result: {
        medications: names,
        labels: labels.map(({ drugInteractionsText: _d, warningsText: _w, ...meta }) => meta),
        interactionsFound: pairs.length,
        coMentions: pairs,
        source: "openfda-drug-label",
        disclaimer: "FDA SPL cross-mention is a SIGNAL, not a clinical decision. For pharmacy-grade interaction screening, use Lexicomp / First Databank / Wolters Kluwer. ALWAYS verify with a pharmacist.",
      },
    };
  });

  registerLensAction("pharmacy", "dosageCalculator", (ctx, artifact, _params) => { const data = artifact.data || {}; const weight = parseFloat(data.weightKg) || 70; const dosePerKg = parseFloat(data.dosePerKg) || 0; const frequency = parseInt(data.frequencyPerDay) || 1; const maxDaily = parseFloat(data.maxDailyDose) || Infinity; if (!dosePerKg) return { ok: true, result: { message: "Provide dose per kg to calculate." } }; const singleDose = Math.round(weight * dosePerKg * 100) / 100; const dailyDose = singleDose * frequency; const capped = Math.min(dailyDose, maxDaily); return { ok: true, result: { weightKg: weight, dosePerKg, singleDose: `${singleDose} mg`, frequency: `${frequency}x daily`, dailyDose: `${Math.round(capped)} mg`, maxDailyDose: isFinite(maxDaily) ? `${maxDaily} mg` : "not specified", capped: dailyDose > maxDaily, disclaimer: "Verify all dosages with prescriber" } }; });
  registerLensAction("pharmacy", "inventoryAlert", (ctx, artifact, _params) => { const items = artifact.data?.inventory || []; if (items.length === 0) return { ok: true, result: { message: "Add inventory items to monitor." } }; const alerts = items.map(i => { const qty = parseInt(i.quantity) || 0; const reorder = parseInt(i.reorderPoint) || 10; const expiry = i.expiryDate ? new Date(i.expiryDate) : null; const daysToExpiry = expiry ? Math.ceil((expiry.getTime() - Date.now()) / 86400000) : null; return { name: i.name, quantity: qty, reorderPoint: reorder, lowStock: qty <= reorder, expired: daysToExpiry !== null && daysToExpiry <= 0, nearExpiry: daysToExpiry !== null && daysToExpiry > 0 && daysToExpiry <= 30, daysToExpiry }; }); return { ok: true, result: { totalItems: items.length, lowStock: alerts.filter(a => a.lowStock).length, expired: alerts.filter(a => a.expired).length, nearExpiry: alerts.filter(a => a.nearExpiry).length, alerts: alerts.filter(a => a.lowStock || a.expired || a.nearExpiry), allClear: alerts.every(a => !a.lowStock && !a.expired && !a.nearExpiry) } }; });
  registerLensAction("pharmacy", "formularySearch", (ctx, artifact, _params) => { const query = (artifact.data?.query || artifact.data?.drugName || "").toLowerCase(); const formulary = artifact.data?.formulary || []; if (!query) return { ok: true, result: { message: "Provide a drug name to search." } }; const matches = formulary.filter(f => (f.name || f.genericName || "").toLowerCase().includes(query) || (f.brandName || "").toLowerCase().includes(query)); return { ok: true, result: { query, matches: matches.map(m => ({ generic: m.genericName || m.name, brand: m.brandName || "", tier: m.tier || "unknown", covered: m.covered !== false, priorAuth: m.priorAuth || false })), found: matches.length, formularySize: formulary.length } }; });

  /**
   * drug-label — Full FDA-approved label by drug name.
   * params: { drug: string }
   */
  registerLensAction("pharmacy", "drug-label", async (_ctx, _artifact, params = {}) => {
    const drug = String(params.drug || "").trim();
    if (!drug) return { ok: false, error: "drug required" };
    try {
      const label = await openfdaLabelLookup(drug);
      if (!label) return { ok: false, error: `no FDA label found for: ${drug}` };
      const pick = (k) => Array.isArray(label[k]) ? label[k][0] : null;
      return {
        ok: true,
        result: {
          query: drug,
          genericName: label.openfda?.generic_name?.[0] || null,
          brandName: label.openfda?.brand_name?.[0] || null,
          manufacturer: label.openfda?.manufacturer_name?.[0] || null,
          productType: label.openfda?.product_type?.[0] || null,
          route: label.openfda?.route?.[0] || null,
          rxOtc: label.openfda?.rxotc?.[0] || null,
          indications: pick("indications_and_usage"),
          dosageAndAdministration: pick("dosage_and_administration"),
          warnings: pick("warnings"),
          contraindications: pick("contraindications"),
          adverseReactions: pick("adverse_reactions"),
          drugInteractions: pick("drug_interactions"),
          mechanismOfAction: pick("mechanism_of_action"),
          pregnancyCategory: pick("pregnancy"),
          spIDsetId: label.set_id,
          source: "openfda-drug-label",
        },
      };
    } catch (e) {
      return { ok: false, error: `openfda unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * adverse-events — Real adverse event reports via OpenFDA FAERS.
   * params: { drug: string, since?: "YYYYMMDD", until?: "YYYYMMDD" }
   */
  registerLensAction("pharmacy", "adverse-events", async (_ctx, _artifact, params = {}) => {
    const drug = String(params.drug || "").trim();
    if (!drug) return { ok: false, error: "drug required" };
    const apiKey = process.env.OPENFDA_API_KEY;
    const keyParam = apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : "";
    const since = params.since && /^\d{8}$/.test(String(params.since))
      ? `+AND+receivedate:[${params.since}+TO+${params.until && /^\d{8}$/.test(String(params.until)) ? params.until : new Date().toISOString().slice(0, 10).replace(/-/g, "")}]`
      : "";
    try {
      const url = `${OPENFDA_BASE}/event.json?search=patient.drug.medicinalproduct:"${encodeURIComponent(drug)}"${since}&count=patient.reaction.reactionmeddrapt.exact&limit=20${keyParam}`;
      const r = await fetch(url);
      if (r.status === 404) {
        return { ok: true, result: { drug, reportCount: 0, topReactions: [], source: "openfda-faers", note: "no reports found" } };
      }
      if (!r.ok) {
        if (r.status === 429) return { ok: false, error: "openfda rate limit exceeded — set OPENFDA_API_KEY env" };
        throw new Error(`openfda ${r.status}`);
      }
      const data = await r.json();
      const topReactions = (data.results || []).map((rec) => ({ term: rec.term, count: rec.count }));
      const reportCount = topReactions.reduce((s, rec) => s + rec.count, 0);
      return {
        ok: true,
        result: {
          drug, reportCount, topReactions,
          since: params.since || null,
          source: "openfda-faers",
          disclaimer: "FAERS reports are voluntary submissions and DO NOT establish causality. Underreporting is significant.",
        },
      };
    } catch (e) {
      return { ok: false, error: `openfda unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── GoodRx + MyTherapy 2026 parity ─────────────────────────────────
  // Medications, dose schedules + adherence, refills, pharmacy price
  // comparison, coupons, health measurements, journal. All STATE-backed,
  // per-user scoped, real math. Not medical advice.

  function getRxState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.pharmacyLens) STATE.pharmacyLens = {};
    const s = STATE.pharmacyLens;
    for (const k of [
      "medications", "schedules", "doses", "refills", "pharmacies",
      "prices", "coupons", "measurements", "journal",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveRxState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const rid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const rnow = () => new Date().toISOString();
  const raid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const rlistB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const rnum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const rclean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const rday = (v) => rclean(v, 10).slice(0, 10);
  const findMed = (s, userId, medId) => (s.medications.get(userId) || []).find((m) => m.id === medId) || null;
  const RX_DAY = 86400000;

  // ── Medications ─────────────────────────────────────────────────────
  registerLensAction("pharmacy", "med-add", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = rclean(params.name, 120);
    if (!name) return { ok: false, error: "medication name required" };
    const med = {
      id: rid("rx"), name,
      strength: rclean(params.strength, 60) || null,
      form: rclean(params.form, 40).toLowerCase() || "tablet",
      condition: rclean(params.condition, 120) || null,
      prescriber: rclean(params.prescriber || params.prescribingDoctor, 120) || null,
      quantity: Math.max(0, Math.round(rnum(params.quantity))),
      refillsRemaining: Math.max(0, Math.round(rnum(params.refillsRemaining))),
      archived: false, createdAt: rnow(),
    };
    rlistB(s.medications, raid(ctx)).push(med);
    saveRxState();
    return { ok: true, result: { medication: med } };
  });

  registerLensAction("pharmacy", "med-list", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let meds = (s.medications.get(raid(ctx)) || []);
    if (!params.includeArchived) meds = meds.filter((m) => !m.archived);
    return {
      ok: true,
      result: {
        medications: meds.map((m) => ({ ...m, hasSchedule: s.schedules.has(m.id) })),
        count: meds.length,
      },
    };
  });

  registerLensAction("pharmacy", "med-update", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const med = findMed(s, raid(ctx), params.id);
    if (!med) return { ok: false, error: "medication not found" };
    for (const f of ["strength", "condition", "prescriber"]) {
      if (params[f] != null) med[f] = rclean(params[f], 120) || null;
    }
    if (params.quantity != null) med.quantity = Math.max(0, Math.round(rnum(params.quantity)));
    if (params.refillsRemaining != null) med.refillsRemaining = Math.max(0, Math.round(rnum(params.refillsRemaining)));
    saveRxState();
    return { ok: true, result: { medication: med } };
  });

  registerLensAction("pharmacy", "med-archive", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const med = findMed(s, raid(ctx), params.id);
    if (!med) return { ok: false, error: "medication not found" };
    med.archived = !(params.unarchive === true);
    saveRxState();
    return { ok: true, result: { medication: med } };
  });

  // dose math helpers
  function scheduledPerDay(schedule) {
    if (!schedule) return 0;
    return (schedule.times || []).length;
  }
  function adherenceFor(s, medId, days) {
    const schedule = s.schedules.get(medId);
    if (!schedule) return { scheduled: 0, taken: 0, pct: null };
    const perDay = scheduledPerDay(schedule);
    const logs = s.doses.get(medId) || [];
    const cutoff = Date.now() - days * RX_DAY;
    const recent = logs.filter((d) => new Date(d.createdAt).getTime() >= cutoff);
    const taken = recent.filter((d) => d.status === "taken").length;
    const scheduled = perDay * days;
    return { scheduled, taken, pct: scheduled > 0 ? Math.round((taken / scheduled) * 100) : null };
  }

  registerLensAction("pharmacy", "med-detail", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const med = findMed(s, raid(ctx), params.id);
    if (!med) return { ok: false, error: "medication not found" };
    const schedule = s.schedules.get(med.id) || null;
    const perDay = scheduledPerDay(schedule);
    return {
      ok: true,
      result: {
        medication: med, schedule,
        adherence30d: adherenceFor(s, med.id, 30),
        daysOfSupply: perDay > 0 ? Math.floor(med.quantity / perDay) : null,
      },
    };
  });

  // ── Dose schedules + logging ────────────────────────────────────────
  registerLensAction("pharmacy", "schedule-set", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const med = findMed(s, raid(ctx), params.medId);
    if (!med) return { ok: false, error: "medication not found" };
    const times = Array.isArray(params.times)
      ? params.times.map((t) => rclean(t, 5)).filter((t) => /^\d{1,2}:\d{2}$/.test(t)).slice(0, 12)
      : [];
    if (!times.length) return { ok: false, error: "at least one valid HH:MM time required" };
    const schedule = {
      medId: med.id, times: times.sort(),
      doseAmount: rclean(params.doseAmount, 40) || "1 dose",
      daysOfWeek: Array.isArray(params.daysOfWeek) && params.daysOfWeek.length
        ? params.daysOfWeek.map((d) => Math.max(0, Math.min(6, Math.round(rnum(d)))))
        : [0, 1, 2, 3, 4, 5, 6],
      updatedAt: rnow(),
    };
    s.schedules.set(med.id, schedule);
    saveRxState();
    return { ok: true, result: { schedule } };
  });

  registerLensAction("pharmacy", "dose-log", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const med = findMed(s, raid(ctx), params.medId);
    if (!med) return { ok: false, error: "medication not found" };
    const status = ["taken", "skipped", "missed"].includes(String(params.status).toLowerCase())
      ? String(params.status).toLowerCase() : "taken";
    const entry = {
      id: rid("dose"), medId: med.id, status,
      scheduledTime: rclean(params.scheduledTime, 5) || null,
      date: rday(params.date) || rday(rnow()),
      createdAt: rnow(),
    };
    rlistB(s.doses, med.id).push(entry);
    if (status === "taken" && med.quantity > 0) med.quantity -= 1;
    saveRxState();
    return { ok: true, result: { dose: entry, quantityRemaining: med.quantity } };
  });

  registerLensAction("pharmacy", "dose-history", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = raid(ctx);
    const meds = s.medications.get(userId) || [];
    const medIds = params.medId
      ? (findMed(s, userId, params.medId) ? [String(params.medId)] : [])
      : meds.map((m) => m.id);
    const medName = new Map(meds.map((m) => [m.id, m.name]));
    const doses = [];
    for (const id of medIds) {
      for (const d of s.doses.get(id) || []) doses.push({ ...d, medName: medName.get(id) || null });
    }
    doses.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { doses: doses.slice(0, 100), count: doses.length } };
  });

  registerLensAction("pharmacy", "adherence-report", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = raid(ctx);
    const days = Math.max(1, Math.min(365, Math.round(rnum(params.days, 30))));
    const meds = (s.medications.get(userId) || []).filter((m) => !m.archived);
    const perMed = meds.map((m) => ({ medId: m.id, name: m.name, ...adherenceFor(s, m.id, days) }));
    const scored = perMed.filter((x) => x.pct != null);
    const overall = scored.length
      ? Math.round(scored.reduce((a, x) => a + x.pct, 0) / scored.length)
      : null;
    return { ok: true, result: { windowDays: days, overall, perMed } };
  });

  registerLensAction("pharmacy", "today-doses", (ctx, _a, _params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = raid(ctx);
    const today = rday(rnow());
    const dow = new Date().getDay();
    const doses = [];
    for (const med of (s.medications.get(userId) || []).filter((m) => !m.archived)) {
      const schedule = s.schedules.get(med.id);
      if (!schedule || !schedule.daysOfWeek.includes(dow)) continue;
      const logs = (s.doses.get(med.id) || []).filter((d) => d.date === today);
      for (const time of schedule.times) {
        const log = logs.find((d) => d.scheduledTime === time);
        doses.push({
          medId: med.id, medName: med.name, time,
          doseAmount: schedule.doseAmount,
          status: log ? log.status : "pending",
        });
      }
    }
    doses.sort((a, b) => a.time.localeCompare(b.time));
    return {
      ok: true,
      result: {
        doses,
        total: doses.length,
        taken: doses.filter((d) => d.status === "taken").length,
        pending: doses.filter((d) => d.status === "pending").length,
      },
    };
  });

  // ── Refills ─────────────────────────────────────────────────────────
  registerLensAction("pharmacy", "refill-request", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const med = findMed(s, raid(ctx), params.medId);
    if (!med) return { ok: false, error: "medication not found" };
    const refill = {
      id: rid("rf"), medId: med.id, medName: med.name,
      pharmacy: rclean(params.pharmacy, 120) || null,
      status: "requested",
      requestedAt: rnow(),
    };
    rlistB(s.refills, raid(ctx)).push(refill);
    saveRxState();
    return { ok: true, result: { refill } };
  });

  registerLensAction("pharmacy", "refill-list", (ctx, _a, _params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const refills = [...(s.refills.get(raid(ctx)) || [])]
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    return { ok: true, result: { refills, count: refills.length } };
  });

  registerLensAction("pharmacy", "refill-update", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = raid(ctx);
    const refill = (s.refills.get(userId) || []).find((r) => r.id === params.id);
    if (!refill) return { ok: false, error: "refill not found" };
    const status = ["requested", "processing", "ready", "picked_up", "cancelled"].includes(String(params.status).toLowerCase())
      ? String(params.status).toLowerCase() : refill.status;
    refill.status = status;
    if (status === "picked_up") {
      const med = findMed(s, userId, refill.medId);
      if (med) {
        if (med.refillsRemaining > 0) med.refillsRemaining -= 1;
        med.quantity += Math.max(0, Math.round(rnum(params.quantityAdded, 30)));
      }
    }
    saveRxState();
    return { ok: true, result: { refill } };
  });

  registerLensAction("pharmacy", "refills-due", (ctx, _a, _params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = raid(ctx);
    const due = [];
    for (const med of (s.medications.get(userId) || []).filter((m) => !m.archived)) {
      const perDay = scheduledPerDay(s.schedules.get(med.id));
      const daysOfSupply = perDay > 0 ? Math.floor(med.quantity / perDay) : null;
      if (daysOfSupply != null && daysOfSupply <= 7) {
        due.push({
          medId: med.id, name: med.name, quantity: med.quantity,
          daysOfSupply, refillsRemaining: med.refillsRemaining,
          urgency: daysOfSupply <= 2 ? "critical" : "soon",
        });
      }
    }
    due.sort((a, b) => a.daysOfSupply - b.daysOfSupply);
    return { ok: true, result: { due, count: due.length } };
  });

  // ── Pharmacies + price comparison ───────────────────────────────────
  registerLensAction("pharmacy", "pharmacy-add", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = rclean(params.name, 120);
    if (!name) return { ok: false, error: "pharmacy name required" };
    const ph = {
      id: rid("ph"), name,
      address: rclean(params.address, 200) || null,
      phone: rclean(params.phone, 40) || null,
      createdAt: rnow(),
    };
    rlistB(s.pharmacies, raid(ctx)).push(ph);
    saveRxState();
    return { ok: true, result: { pharmacy: ph } };
  });

  registerLensAction("pharmacy", "pharmacy-list", (ctx, _a, _params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { pharmacies: s.pharmacies.get(raid(ctx)) || [] } };
  });

  registerLensAction("pharmacy", "price-record", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const drugName = rclean(params.drugName, 120);
    if (!drugName) return { ok: false, error: "drugName required" };
    const cashPrice = rnum(params.cashPrice);
    if (cashPrice <= 0) return { ok: false, error: "cashPrice must be > 0" };
    const userId = raid(ctx);
    const pharmacy = (s.pharmacies.get(userId) || []).find((p) => p.id === params.pharmacyId);
    const couponPrice = params.couponPrice != null ? Math.max(0, rnum(params.couponPrice)) : null;
    const rec = {
      id: rid("pr"), drugName: drugName.toLowerCase(),
      pharmacyId: params.pharmacyId ? String(params.pharmacyId) : null,
      pharmacyName: pharmacy ? pharmacy.name : rclean(params.pharmacyName, 120) || "Unknown pharmacy",
      cashPrice: Math.round(cashPrice * 100) / 100,
      couponPrice: couponPrice != null ? Math.round(couponPrice * 100) / 100 : null,
      recordedAt: rnow(),
    };
    rlistB(s.prices, userId).push(rec);
    saveRxState();
    return { ok: true, result: { price: rec } };
  });

  registerLensAction("pharmacy", "price-list", (ctx, _a, _params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const prices = [...(s.prices.get(raid(ctx)) || [])].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    return { ok: true, result: { prices, count: prices.length } };
  });

  registerLensAction("pharmacy", "price-compare", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const drugName = rclean(params.drugName, 120).toLowerCase();
    if (!drugName) return { ok: false, error: "drugName required" };
    const rows = (s.prices.get(raid(ctx)) || [])
      .filter((p) => p.drugName === drugName)
      .map((p) => ({ ...p, effectivePrice: p.couponPrice != null ? p.couponPrice : p.cashPrice }))
      .sort((a, b) => a.effectivePrice - b.effectivePrice);
    if (!rows.length) {
      return { ok: true, result: { drugName, quotes: [], lowest: null, highest: null, savings: 0 } };
    }
    const lowest = rows[0].effectivePrice;
    const highest = rows[rows.length - 1].effectivePrice;
    return {
      ok: true,
      result: {
        drugName,
        quotes: rows.map((r, i) => ({ ...r, rank: i + 1, isBest: i === 0 })),
        lowest, highest,
        savings: Math.round((highest - lowest) * 100) / 100,
        savingsPct: highest > 0 ? Math.round(((highest - lowest) / highest) * 100) : 0,
      },
    };
  });

  // ── Coupons ─────────────────────────────────────────────────────────
  registerLensAction("pharmacy", "coupon-save", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const drugName = rclean(params.drugName, 120);
    if (!drugName) return { ok: false, error: "drugName required" };
    const coupon = {
      id: rid("cp"), drugName,
      pharmacyName: rclean(params.pharmacyName, 120) || null,
      discountedPrice: Math.max(0, rnum(params.discountedPrice)),
      code: rclean(params.code, 60) || null,
      createdAt: rnow(),
    };
    rlistB(s.coupons, raid(ctx)).push(coupon);
    saveRxState();
    return { ok: true, result: { coupon } };
  });

  registerLensAction("pharmacy", "coupon-list", (ctx, _a, _params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { coupons: [...(s.coupons.get(raid(ctx)) || [])].reverse() } };
  });

  // ── Health measurements ─────────────────────────────────────────────
  const MEASUREMENT_KINDS = ["blood_pressure", "weight", "glucose", "heart_rate", "temperature", "oxygen"];
  registerLensAction("pharmacy", "measurement-log", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const kind = String(params.kind || "").toLowerCase();
    if (!MEASUREMENT_KINDS.includes(kind)) return { ok: false, error: `kind must be one of ${MEASUREMENT_KINDS.join("/")}` };
    const value = rnum(params.value);
    if (value <= 0) return { ok: false, error: "value must be > 0" };
    const entry = {
      id: rid("ms"), kind, value: Math.round(value * 100) / 100,
      value2: params.value2 != null ? Math.round(rnum(params.value2) * 100) / 100 : null,
      date: rday(params.date) || rday(rnow()),
      note: rclean(params.note, 200) || null,
      createdAt: rnow(),
    };
    rlistB(s.measurements, raid(ctx)).push(entry);
    saveRxState();
    return { ok: true, result: { measurement: entry } };
  });

  registerLensAction("pharmacy", "measurement-history", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const all = s.measurements.get(raid(ctx)) || [];
    const kind = params.kind ? String(params.kind).toLowerCase() : null;
    let series = kind ? all.filter((m) => m.kind === kind) : all.slice();
    series.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let trend = "no_data";
    if (kind && series.length >= 2) {
      const delta = series[series.length - 1].value - series[series.length - 2].value;
      trend = delta > 0.5 ? "up" : delta < -0.5 ? "down" : "stable";
    }
    const kinds = [...new Set(all.map((m) => m.kind))];
    return {
      ok: true,
      result: {
        series, trend, kinds,
        latest: series.length ? series[series.length - 1] : null,
      },
    };
  });

  // ── Symptom / health journal ────────────────────────────────────────
  registerLensAction("pharmacy", "journal-add", (ctx, _a, params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const note = rclean(params.note, 1000);
    if (!note) return { ok: false, error: "note required" };
    const entry = {
      id: rid("jr"), note,
      mood: rclean(params.mood, 40).toLowerCase() || null,
      symptoms: Array.isArray(params.symptoms)
        ? params.symptoms.map((x) => rclean(x, 60)).filter(Boolean).slice(0, 20) : [],
      date: rday(params.date) || rday(rnow()),
      createdAt: rnow(),
    };
    rlistB(s.journal, raid(ctx)).push(entry);
    saveRxState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("pharmacy", "journal-list", (ctx, _a, _params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entries = [...(s.journal.get(raid(ctx)) || [])]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { entries, count: entries.length } };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("pharmacy", "pharmacy-dashboard", (ctx, _a, _params = {}) => {
    const s = getRxState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = raid(ctx);
    const meds = (s.medications.get(userId) || []).filter((m) => !m.archived);
    const today = rday(rnow());
    const dow = new Date().getDay();
    let todayTotal = 0, todayTaken = 0, refillsDue = 0;
    for (const med of meds) {
      const schedule = s.schedules.get(med.id);
      if (schedule && schedule.daysOfWeek.includes(dow)) {
        const logs = (s.doses.get(med.id) || []).filter((d) => d.date === today);
        for (const time of schedule.times) {
          todayTotal++;
          if (logs.some((d) => d.scheduledTime === time && d.status === "taken")) todayTaken++;
        }
      }
      const perDay = scheduledPerDay(schedule);
      if (perDay > 0 && Math.floor(med.quantity / perDay) <= 7) refillsDue++;
    }
    const adh = adherenceFor;
    const scored = meds.map((m) => adh(s, m.id, 30).pct).filter((x) => x != null);
    return {
      ok: true,
      result: {
        medications: meds.length,
        todayDoses: { total: todayTotal, taken: todayTaken, pending: todayTotal - todayTaken },
        adherence30d: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
        refillsDue,
        openRefillRequests: (s.refills.get(userId) || []).filter((r) => ["requested", "processing", "ready"].includes(r.status)).length,
      },
    };
  });
}
