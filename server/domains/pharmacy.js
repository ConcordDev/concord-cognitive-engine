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
}
