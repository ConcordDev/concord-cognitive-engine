// server/domains/pharmacy-live.js
//
// Phase 4 of the 10-dimension UX completeness sprint — real FDA
// OpenFDA wire-up for the pharmacy lens.
//
// OpenFDA is the FDA's free public API for drug labels, adverse events,
// recalls, and NDC information. No API key required for basic queries
// (rate-limited at 240/min, 1000/hr unauthenticated).
//
// Macros:
//   pharmacy.live_label_lookup   FDA drug-label search (by brand or generic name)
//   pharmacy.live_adverse_events Adverse-event reports for a drug
//   pharmacy.live_recalls        Recent FDA enforcement reports (recalls)
//
// REAL_FREE tier per integration-registry. The pharmacy lens itself
// remains REAL_FREE (with partial label data); full formulary requires
// paid feeds (FirstDataBank etc.).

const OPENFDA_BASE = "https://api.fda.gov";
const FETCH_TIMEOUT_MS = 8000;

async function fetchJsonWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "ConcordOS/5.0 (pharmacy-lens)" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export default function registerPharmacyLiveMacros(register) {
  register("pharmacy", "live_label_lookup", async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, reason: "missing_query" };
    if (q.length > 100) return { ok: false, reason: "query_too_long" };
    const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 20);
    // Search both brand and generic name.
    const search = encodeURIComponent(`openfda.brand_name:"${q}" openfda.generic_name:"${q}"`).replace(/%20/g, "+OR+");
    const url = `${OPENFDA_BASE}/drug/label.json?search=${search}&limit=${limit}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const labels = (data.results || []).map(r => ({
        setId: r.set_id,
        brandName: r.openfda?.brand_name?.[0] || null,
        genericName: r.openfda?.generic_name?.[0] || null,
        manufacturer: r.openfda?.manufacturer_name?.[0] || null,
        substanceName: r.openfda?.substance_name || [],
        route: r.openfda?.route || [],
        productType: r.openfda?.product_type?.[0] || null,
        indicationsAndUsage: (r.indications_and_usage || []).join("\n").slice(0, 1200) || null,
        contraindications: (r.contraindications || []).join("\n").slice(0, 800) || null,
        warnings: (r.warnings || []).join("\n").slice(0, 800) || null,
        dosageAndAdministration: (r.dosage_and_administration || []).join("\n").slice(0, 800) || null,
      }));
      return {
        ok: true,
        source: "FDA OpenFDA — Drug Label",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: q,
        total: data.meta?.results?.total || labels.length,
        labels,
      };
    } catch (e) {
      // OpenFDA returns 404 when no match — treat as empty, not error.
      if (String(e?.message || e).includes("404")) {
        return { ok: true, source: "FDA OpenFDA — Drug Label", fetchedAt: Math.floor(Date.now() / 1000), query: q, total: 0, labels: [] };
      }
      return { ok: false, reason: "openfda_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live FDA drug label lookup" });

  register("pharmacy", "live_adverse_events", async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, reason: "missing_query" };
    if (q.length > 100) return { ok: false, reason: "query_too_long" };
    const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 25);
    const search = encodeURIComponent(`patient.drug.openfda.brand_name:"${q}" patient.drug.openfda.generic_name:"${q}"`).replace(/%20/g, "+OR+");
    const url = `${OPENFDA_BASE}/drug/event.json?search=${search}&limit=${limit}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const events = (data.results || []).map(r => ({
        reportDate: r.receiptdate,
        serious: r.serious === "1",
        reactions: (r.patient?.reaction || []).map(rx => rx.reactionmeddrapt).slice(0, 6),
        patientAge: r.patient?.patientonsetage || null,
        patientSex: r.patient?.patientsex === "1" ? "M" : r.patient?.patientsex === "2" ? "F" : null,
        outcomes: (r.patient?.reaction || []).map(rx => rx.reactionoutcome).filter(Boolean).slice(0, 3),
        reportingCountry: r.occurcountry || null,
      }));
      return {
        ok: true,
        source: "FDA OpenFDA — Adverse Events (FAERS)",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: q,
        total: data.meta?.results?.total || events.length,
        events,
      };
    } catch (e) {
      if (String(e?.message || e).includes("404")) {
        return { ok: true, source: "FDA OpenFDA — Adverse Events", fetchedAt: Math.floor(Date.now() / 1000), query: q, total: 0, events: [] };
      }
      return { ok: false, reason: "openfda_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live FDA adverse events" });

  register("pharmacy", "live_recalls", async (_ctx, input = {}) => {
    const limit = Math.min(Math.max(Number(input.limit) || 15, 1), 50);
    // Last 30 days, sorted by recall_initiation_date desc.
    const today = new Date();
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 86400000);
    const startStr = thirtyDaysAgo.toISOString().slice(0, 10).replace(/-/g, "");
    const endStr = today.toISOString().slice(0, 10).replace(/-/g, "");
    const search = encodeURIComponent(`recall_initiation_date:[${startStr}+TO+${endStr}]`);
    const url = `${OPENFDA_BASE}/drug/enforcement.json?search=${search}&limit=${limit}&sort=recall_initiation_date:desc`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const recalls = (data.results || []).map(r => ({
        recallNumber: r.recall_number,
        initiationDate: r.recall_initiation_date,
        productDescription: (r.product_description || "").slice(0, 240),
        reason: (r.reason_for_recall || "").slice(0, 240),
        classification: r.classification,
        status: r.status,
        recallingFirm: r.recalling_firm,
        state: r.state || null,
        country: r.country || null,
        distributionPattern: (r.distribution_pattern || "").slice(0, 200),
      }));
      return {
        ok: true,
        source: "FDA OpenFDA — Drug Enforcement",
        fetchedAt: Math.floor(Date.now() / 1000),
        window: "past 30 days",
        total: data.meta?.results?.total || recalls.length,
        recalls,
      };
    } catch (e) {
      if (String(e?.message || e).includes("404")) {
        return { ok: true, source: "FDA OpenFDA — Drug Enforcement", fetchedAt: Math.floor(Date.now() / 1000), window: "past 30 days", total: 0, recalls: [] };
      }
      return { ok: false, reason: "openfda_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live FDA drug recalls (past 30 days)" });
}
