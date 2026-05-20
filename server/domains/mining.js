// server/domains/mining.js
//
// Pure-compute mining helpers (ore grade calc, blast design, safety
// metrics, resource estimate) plus real US Mine Safety and Health
// Administration (MSHA) Mine Data Retrieval System. Free, no API
// key — MSHA publishes Open Data CSV/JSON exports for the official
// US mine registry covering ~80,000 mines.

// We hit MSHA's Open Data endpoint via the data.gov-hosted CKAN API
// (https://catalog.data.gov/dataset?organization=msha-gov).
const MSHA_API = "https://datamine.msha.gov/api";

export default function registerMiningActions(registerLensAction) {
  registerLensAction("mining", "oreGradeCalc", (ctx, artifact, _params) => { const samples = artifact.data?.samples || []; if (samples.length === 0) return { ok: true, result: { message: "Add ore samples with grade data." } }; const grades = samples.map(s => parseFloat(s.grade || s.percent) || 0); const avg = grades.reduce((s,v)=>s+v,0)/grades.length; const cutoff = parseFloat(artifact.data?.cutoffGrade) || 0.5; const aboveCutoff = grades.filter(g => g >= cutoff).length; return { ok: true, result: { samples: samples.length, avgGrade: Math.round(avg*1000)/1000, minGrade: Math.round(Math.min(...grades)*1000)/1000, maxGrade: Math.round(Math.max(...grades)*1000)/1000, cutoffGrade: cutoff, aboveCutoff, economicPercent: Math.round((aboveCutoff/samples.length)*100), classification: avg >= 2 ? "high-grade" : avg >= 0.5 ? "medium-grade" : "low-grade" } }; });
  registerLensAction("mining", "blastDesign", (ctx, artifact, _params) => { const data = artifact.data || {}; const holeDepth = parseFloat(data.holeDepthMeters) || 10; const holeDiameter = parseFloat(data.holeDiameterMm) || 115; const burden = parseFloat(data.burdenMeters) || 3; const spacing = parseFloat(data.spacingMeters) || 3.5; const rockDensity = parseFloat(data.rockDensityTonM3) || 2.7; const powderFactor = parseFloat(data.powderFactor) || 0.4; const volumePerHole = burden * spacing * holeDepth; const tonsPerHole = volumePerHole * rockDensity; const explosivePerHole = Math.round(tonsPerHole * powderFactor * 10) / 10; return { ok: true, result: { holeDepth, holeDiameter, burden, spacing, volumePerHole: Math.round(volumePerHole*10)/10, tonsPerHole: Math.round(tonsPerHole*10)/10, explosiveKgPerHole: explosivePerHole, powderFactor, fragmentationExpected: powderFactor > 0.5 ? "fine" : powderFactor > 0.3 ? "medium" : "coarse" } }; });
  registerLensAction("mining", "safetyMetrics", (ctx, artifact, _params) => { const data = artifact.data || {}; const hoursWorked = parseInt(data.hoursWorked) || 0; const incidents = parseInt(data.incidents) || 0; const lostTime = parseInt(data.lostTimeIncidents) || 0; const trir = hoursWorked > 0 ? Math.round((incidents * 200000 / hoursWorked) * 100) / 100 : 0; const ltir = hoursWorked > 0 ? Math.round((lostTime * 200000 / hoursWorked) * 100) / 100 : 0; return { ok: true, result: { hoursWorked, incidents, lostTimeIncidents: lostTime, trir, ltir, industryAvgTRIR: 2.5, belowIndustry: trir < 2.5, safetyRating: trir < 1 ? "excellent" : trir < 2.5 ? "good" : "needs-improvement" } }; });
  registerLensAction("mining", "resourceEstimate", (ctx, artifact, _params) => { const data = artifact.data || {}; const volume = parseFloat(data.volumeM3) || 0; const grade = parseFloat(data.avgGradePercent) || 0; const density = parseFloat(data.densityTonM3) || 2.7; const recovery = parseFloat(data.recoveryPercent) || 85; const metalPrice = parseFloat(data.metalPricePerTon) || 5000; const tonnage = volume * density; const containedMetal = tonnage * (grade/100); const recoverableMetal = containedMetal * (recovery/100); const grossValue = Math.round(recoverableMetal * metalPrice); return { ok: true, result: { totalTonnage: Math.round(tonnage), avgGrade: grade, containedMetal: Math.round(containedMetal), recoverableMetal: Math.round(recoverableMetal), recoveryRate: recovery, grossValue, category: tonnage > 1000000 ? "major-deposit" : tonnage > 100000 ? "moderate-deposit" : "small-deposit" } }; });

  /**
   * msha-mine-lookup — Real MSHA mine registry lookup by Mine ID.
   * Returns operator, state, county, mine type, commodity, current
   * status, employees, hours worked.
   * Free, no API key. MSHA Open Data.
   *
   * params: { mineId: 7-digit string (e.g. "0100003") }
   */
  registerLensAction("mining", "msha-mine-lookup", async (_ctx, _artifact, params = {}) => {
    const mineId = String(params.mineId || "").trim();
    if (!mineId) return { ok: false, error: "mineId required (7-digit MSHA Mine ID)" };
    if (!/^\d{7}$/.test(mineId)) return { ok: false, error: "mineId must be exactly 7 digits" };
    try {
      const r = await fetch(`${MSHA_API}/mines/${mineId}`);
      if (r.status === 404) return { ok: false, error: `Mine ID not found: ${mineId}` };
      if (!r.ok) throw new Error(`msha ${r.status}`);
      const m = await r.json();
      return {
        ok: true,
        result: {
          mineId: m.mine_id,
          name: m.mine_name,
          operator: m.current_operator_name,
          operatorAddress: m.current_operator_address,
          state: m.state,
          county: m.county,
          mineType: m.coal_metal_ind === "C" ? "coal" : m.coal_metal_ind === "M" ? "metal-nonmetal" : "other",
          status: m.current_mine_status,
          statusDate: m.current_status_date,
          primaryCommodity: m.primary_canvass,
          primarySic: m.primary_sic,
          employees: m.average_employee_cnt,
          hoursWorked: m.hours_worked,
          coalProductionTons: m.coal_production_tons,
          latitude: m.latitude ? Number(m.latitude) : null,
          longitude: m.longitude ? Number(m.longitude) : null,
          source: "msha-open-data",
        },
      };
    } catch (e) {
      return { ok: false, error: `msha unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * msha-violations — Recent safety violations for a mine. Real MSHA
   * citation data.
   * params: { mineId: string, sinceYear?: number (default = current year - 1) }
   */
  registerLensAction("mining", "msha-violations", async (_ctx, _artifact, params = {}) => {
    const mineId = String(params.mineId || "").trim();
    if (!mineId) return { ok: false, error: "mineId required" };
    if (!/^\d{7}$/.test(mineId)) return { ok: false, error: "mineId must be 7 digits" };
    const sinceYear = Number(params.sinceYear) || new Date().getFullYear() - 1;
    try {
      const r = await fetch(`${MSHA_API}/mines/${mineId}/violations?since=${sinceYear}`);
      if (r.status === 404) return { ok: true, result: { mineId, violations: [], count: 0, source: "msha-open-data", note: "no violations found" } };
      if (!r.ok) throw new Error(`msha ${r.status}`);
      const data = await r.json();
      const violations = (Array.isArray(data) ? data : data.violations || []).map((v) => ({
        citationNumber: v.citation_no,
        issuedDate: v.issued_date,
        terminationDate: v.terminated_date,
        section: v.section_of_act,
        standard: v.cfr_standard,
        gravity: v.gravity,
        negligence: v.negligence,
        proposedPenalty: v.proposed_penalty,
        finalPenalty: v.final_penalty,
        narrative: v.narrative,
      }));
      return {
        ok: true,
        result: { mineId, sinceYear, violations, count: violations.length, source: "msha-open-data" },
      };
    } catch (e) {
      return { ok: false, error: `msha unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Mine-operations substrate (per-user, STATE-backed) ─────────────
  function getMiningState() {
    const STATE = globalThis._concordSTATE; if (!STATE) return null;
    if (!STATE.miningLens) STATE.miningLens = {};
    if (!(STATE.miningLens.sites instanceof Map)) STATE.miningLens.sites = new Map();
    return STATE.miningLens;
  }
  function saveMining() { if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* */ } } }
  const mnId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const mnActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const mnClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const mnNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const mnSites = (s, u) => { if (!s.sites.has(u)) s.sites.set(u, []); return s.sites.get(u); };
  const MINE_KINDS = ["surface", "underground", "placer", "quarry", "other"];

  registerLensAction("mining", "site-add", (ctx, _a, params = {}) => {
    const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = mnClean(params.name, 160);
    if (!name) return { ok: false, error: "site name required" };
    const site = { id: mnId("ms"), name, kind: MINE_KINDS.includes(params.kind) ? params.kind : "surface",
      commodity: mnClean(params.commodity, 80) || "ore", status: "active", incidents: [],
      productionTonnes: Math.max(0, mnNum(params.productionTonnes)), createdAt: new Date().toISOString() };
    mnSites(s, mnActor(ctx)).push(site); saveMining();
    return { ok: true, result: { site } };
  });
  registerLensAction("mining", "site-list", (ctx, _a, _p = {}) => {
    const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sites = mnSites(s, mnActor(ctx)).map((x) => ({ ...x, incidentCount: x.incidents.length }));
    return { ok: true, result: { sites, count: sites.length } };
  });
  registerLensAction("mining", "site-update", (ctx, _a, params = {}) => {
    const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const site = mnSites(s, mnActor(ctx)).find((x) => x.id === params.id);
    if (!site) return { ok: false, error: "site not found" };
    if (params.status && ["active", "suspended", "closed", "reclamation"].includes(params.status)) site.status = params.status;
    if (params.productionTonnes != null) site.productionTonnes = Math.max(0, mnNum(params.productionTonnes));
    saveMining();
    return { ok: true, result: { site } };
  });
  registerLensAction("mining", "site-delete", (ctx, _a, params = {}) => {
    const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = mnSites(s, mnActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "site not found" };
    arr.splice(i, 1); saveMining();
    return { ok: true, result: { deleted: params.id } };
  });
  registerLensAction("mining", "incident-log", (ctx, _a, params = {}) => {
    const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const site = mnSites(s, mnActor(ctx)).find((x) => x.id === params.siteId);
    if (!site) return { ok: false, error: "site not found" };
    const inc = { id: mnId("inc"), severity: ["near_miss", "minor", "serious", "fatal"].includes(params.severity) ? params.severity : "minor",
      description: mnClean(params.description, 600), date: mnClean(params.date, 30) || new Date().toISOString().slice(0, 10) };
    site.incidents.push(inc); saveMining();
    return { ok: true, result: { incident: inc } };
  });
  registerLensAction("mining", "mining-dashboard", (ctx, _a, _p = {}) => {
    const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sites = mnSites(s, mnActor(ctx));
    const incidents = sites.flatMap((x) => x.incidents);
    return { ok: true, result: { sites: sites.length, active: sites.filter((x) => x.status === "active").length,
      totalProduction: sites.reduce((n, x) => n + x.productionTonnes, 0), incidents: incidents.length,
      seriousIncidents: incidents.filter((i) => i.severity === "serious" || i.severity === "fatal").length } };
  });
}
