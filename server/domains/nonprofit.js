// server/domains/nonprofit.js
//
// Nonprofit lens — pure-compute donor/grant/volunteer/campaign macros
// plus real 990-form lookup via ProPublica's Nonprofit Explorer
// (free, no API key — uses IRS Form 990 filings sourced from the
// IRS BMF + e-File via the publicly funded ProPublica dataset).
//
// Per the "everything must be real" directive: no fake EIN database;
// real ProPublica Nonprofit Explorer integration for org details +
// search.

const PROPUBLICA_BASE = "https://projects.propublica.org/nonprofits/api/v2";

export default function registerNonprofitActions(registerLensAction) {
  registerLensAction("nonprofit", "donorRetention", (ctx, artifact, params) => {
    const givingHistory = artifact.data?.givingHistory || [];
    const currentYear = params.year || new Date().getFullYear();
    const priorYear = currentYear - 1;
    const currentDonors = new Set(givingHistory.filter(g => new Date(g.date).getFullYear() === currentYear).map(g => g.donorId || g.name));
    const priorDonors = new Set(givingHistory.filter(g => new Date(g.date).getFullYear() === priorYear).map(g => g.donorId || g.name));
    const retained = [...priorDonors].filter(d => currentDonors.has(d)).length;
    const rate = priorDonors.size > 0 ? Math.round((retained / priorDonors.size) * 100) : 0;
    return { ok: true, result: { retentionRate: rate, retained, priorTotal: priorDonors.size, currentTotal: currentDonors.size, period: `${priorYear}-${currentYear}` } };
  });

  registerLensAction("nonprofit", "grantReporting", (ctx, artifact, _params) => {
    const deliverables = artifact.data?.deliverables || [];
    const metrics = artifact.data?.impactMetrics || [];
    const completed = deliverables.filter(d => d.status === 'completed').length;
    const result = {
      grantId: artifact.id,
      grantName: artifact.title,
      funder: artifact.data?.funder || 'Unknown',
      amount: artifact.data?.amount || 0,
      deliverableProgress: deliverables.length > 0 ? Math.round((completed / deliverables.length) * 100) : 0,
      completedDeliverables: completed,
      totalDeliverables: deliverables.length,
      impactSummary: metrics.map(m => ({ name: m.name, target: m.target, actual: m.actual, achieved: m.actual >= m.target })),
      generatedAt: new Date().toISOString(),
    };
    return { ok: true, result };
  });

  registerLensAction("nonprofit", "volunteerMatch", (ctx, artifact, params) => {
    const skills = artifact.data?.skills || [];
    const availability = artifact.data?.availability || [];
    const needs = params.programNeeds || [];
    const matches = needs.map(need => ({
      program: need.program,
      requiredSkill: need.skill,
      matched: skills.some(s => s.toLowerCase().includes(need.skill.toLowerCase())),
      availabilityMatch: !need.schedule || availability.some(a => a === need.schedule),
    }));
    const matchScore = matches.length > 0 ? Math.round((matches.filter(m => m.matched && m.availabilityMatch).length / matches.length) * 100) : 0;
    return { ok: true, result: { volunteer: artifact.title, matches, matchScore } };
  });

  registerLensAction("nonprofit", "campaignProgress", (ctx, artifact, _params) => {
    const goal = artifact.data?.goalAmount || 0;
    const raised = artifact.data?.raisedAmount || 0;
    const donorCount = artifact.data?.donorCount || 0;
    const startDate = artifact.data?.startDate ? new Date(artifact.data.startDate) : new Date();
    const endDate = artifact.data?.endDate ? new Date(artifact.data.endDate) : new Date();
    const now = new Date();
    const totalDays = Math.max(1, (endDate - startDate) / (1000 * 60 * 60 * 24));
    const elapsedDays = Math.max(0, (now - startDate) / (1000 * 60 * 60 * 24));
    const percentComplete = goal > 0 ? Math.round((raised / goal) * 100) : 0;
    const dailyRate = elapsedDays > 0 ? raised / elapsedDays : 0;
    const projected = Math.round(dailyRate * totalDays);
    return { ok: true, result: { campaign: artifact.title, goal, raised, percentComplete, donorCount, dailyRate: Math.round(dailyRate), projected, onTrack: projected >= goal } };
  });

  /**
   * lookup-org-by-ein — Pulls authoritative IRS 990 data for a given
   * EIN (Employer Identification Number, 9 digits) via ProPublica's
   * Nonprofit Explorer. Returns the org's NTEE classification,
   * ruling date, recent filings, total revenue/expenses/assets.
   * Free, no API key.
   */
  registerLensAction("nonprofit", "lookup-org-by-ein", async (_ctx, _artifact, params = {}) => {
    const ein = String(params.ein || "").replace(/\D/g, "");
    if (!ein) return { ok: false, error: "ein required (9-digit IRS EIN)" };
    if (ein.length !== 9) return { ok: false, error: `ein must be 9 digits (got ${ein.length})` };
    try {
      const r = await fetch(`${PROPUBLICA_BASE}/organizations/${ein}.json`);
      if (r.status === 404) return { ok: false, error: `EIN not found in ProPublica Nonprofit Explorer: ${ein}` };
      if (!r.ok) throw new Error(`propublica ${r.status}`);
      const data = await r.json();
      const org = data.organization || {};
      const filings = (data.filings_with_data || []).map((f) => ({
        taxPeriod: f.tax_prd,
        year: f.tax_prd_yr,
        totalRevenue: f.totrevenue,
        totalExpenses: f.totfuncexpns,
        totalAssets: f.totassetsend,
        netIncome: f.totrevenue - f.totfuncexpns,
        pdfUrl: f.pdf_url,
      }));
      return {
        ok: true,
        result: {
          ein: org.ein,
          name: org.name,
          dbaName: org.sub_name || null,
          address: {
            line1: org.address,
            city: org.city,
            state: org.state,
            zip: org.zipcode,
          },
          nteeCode: org.ntee_code,
          nteeClassification: org.ntee_classification,
          rulingYear: org.ruling_date ? new Date(org.ruling_date).getFullYear() : null,
          taxExemptStatus: org.subsection_code === 3 ? "501(c)(3)" : `501(c)(${org.subsection_code})`,
          deductible: org.deductibility === 1,
          assetAmount: org.asset_amount,
          incomeAmount: org.income_amount,
          revenueAmount: org.revenue_amount,
          filings,
          source: "propublica-nonprofit-explorer",
        },
      };
    } catch (e) {
      return { ok: false, error: `propublica unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * search-orgs — Fuzzy name search via ProPublica.
   * params: { query, state?, ntee?, page? }
   */
  registerLensAction("nonprofit", "search-orgs", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    if (query.length < 3) return { ok: false, error: "query must be ≥ 3 characters" };
    const state = params.state ? `&state%5Bid%5D=${encodeURIComponent(String(params.state).toUpperCase())}` : "";
    const ntee = params.ntee ? `&ntee%5Bid%5D=${encodeURIComponent(String(params.ntee))}` : "";
    const page = Number.isFinite(Number(params.page)) ? Number(params.page) : 0;
    try {
      const r = await fetch(`${PROPUBLICA_BASE}/search.json?q=${encodeURIComponent(query)}&page=${page}${state}${ntee}`);
      if (!r.ok) throw new Error(`propublica ${r.status}`);
      const data = await r.json();
      const orgs = (data.organizations || []).map((o) => ({
        ein: o.ein,
        name: o.name,
        city: o.city,
        state: o.state,
        nteeCode: o.ntee_code,
        score: o.score,
        rulingYear: o.ruling_date ? new Date(o.ruling_date).getFullYear() : null,
      }));
      return {
        ok: true,
        result: {
          orgs,
          totalResults: data.total_results,
          numPages: data.num_pages,
          curPage: data.cur_page,
          query, state: params.state || null, ntee: params.ntee || null,
          source: "propublica-nonprofit-explorer",
        },
      };
    } catch (e) {
      return { ok: false, error: `propublica unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Campaign + donation substrate (per-user, STATE-backed) ─────────
  function getNonprofitState() {
    const STATE = globalThis._concordSTATE; if (!STATE) return null;
    if (!STATE.nonprofitLens) STATE.nonprofitLens = {};
    if (!(STATE.nonprofitLens.campaigns instanceof Map)) STATE.nonprofitLens.campaigns = new Map();
    return STATE.nonprofitLens;
  }
  function saveNonprofit() { if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* */ } } }
  const npId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const npActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const npClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const npNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const npCampaigns = (s, u) => { if (!s.campaigns.has(u)) s.campaigns.set(u, []); return s.campaigns.get(u); };

  registerLensAction("nonprofit", "campaign-create", (ctx, _a, params = {}) => {
    const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = npClean(params.name, 160);
    if (!name) return { ok: false, error: "campaign name required" };
    const campaign = { id: npId("cmp"), name, goal: Math.max(0, npNum(params.goal)),
      deadline: npClean(params.deadline, 30) || null, status: "active", donations: [], createdAt: new Date().toISOString() };
    npCampaigns(s, npActor(ctx)).push(campaign); saveNonprofit();
    return { ok: true, result: { campaign } };
  });
  registerLensAction("nonprofit", "campaign-list", (ctx, _a, _p = {}) => {
    const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const campaigns = npCampaigns(s, npActor(ctx)).map((c) => {
      const raised = c.donations.reduce((n, d) => n + d.amount, 0);
      return { ...c, raised, donorCount: c.donations.length, progressPct: c.goal > 0 ? Math.round((raised / c.goal) * 100) : 0 };
    });
    return { ok: true, result: { campaigns, count: campaigns.length } };
  });
  registerLensAction("nonprofit", "campaign-update", (ctx, _a, params = {}) => {
    const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = npCampaigns(s, npActor(ctx)).find((x) => x.id === params.id);
    if (!c) return { ok: false, error: "campaign not found" };
    if (params.goal != null) c.goal = Math.max(0, npNum(params.goal));
    if (params.status && ["active", "complete", "paused"].includes(params.status)) c.status = params.status;
    saveNonprofit();
    return { ok: true, result: { campaign: c } };
  });
  registerLensAction("nonprofit", "campaign-delete", (ctx, _a, params = {}) => {
    const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = npCampaigns(s, npActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "campaign not found" };
    arr.splice(i, 1); saveNonprofit();
    return { ok: true, result: { deleted: params.id } };
  });
  registerLensAction("nonprofit", "donation-log", (ctx, _a, params = {}) => {
    const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = npCampaigns(s, npActor(ctx)).find((x) => x.id === params.campaignId);
    if (!c) return { ok: false, error: "campaign not found" };
    const amount = npNum(params.amount);
    if (amount <= 0) return { ok: false, error: "donation amount must be positive" };
    const donation = { id: npId("don"), amount, donor: npClean(params.donor, 120) || "Anonymous",
      recurring: params.recurring === true, at: new Date().toISOString() };
    c.donations.push(donation); saveNonprofit();
    return { ok: true, result: { donation } };
  });
  registerLensAction("nonprofit", "nonprofit-dashboard", (ctx, _a, _p = {}) => {
    const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const campaigns = npCampaigns(s, npActor(ctx));
    const allDonations = campaigns.flatMap((c) => c.donations);
    return { ok: true, result: { campaigns: campaigns.length, active: campaigns.filter((c) => c.status === "active").length,
      totalRaised: allDonations.reduce((n, d) => n + d.amount, 0), donations: allDonations.length,
      recurringDonors: allDonations.filter((d) => d.recurring).length } };
  });
};
