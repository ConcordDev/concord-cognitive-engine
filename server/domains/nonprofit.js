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

  // ─── Extended STATE accessors (donor CRM, recurring, comms, vols, events) ──
  function npMap(s, key) {
    if (!(s[key] instanceof Map)) s[key] = new Map();
    return s[key];
  }
  const npList = (m, u) => { if (!m.has(u)) m.set(u, []); return m.get(u); };
  const npIso = () => new Date().toISOString();
  const npBool = (v) => v === true || v === "true";

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE: Donor CRM — full donor profiles with giving history,
  //          contact info, communication log
  // ═══════════════════════════════════════════════════════════════════
  registerLensAction("nonprofit", "donor-create", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const name = npClean(params.name, 160);
      if (!name) return { ok: false, error: "donor name required" };
      const donor = {
        id: npId("dnr"), name,
        email: npClean(params.email, 160), phone: npClean(params.phone, 40),
        address: npClean(params.address, 240), type: npClean(params.type, 40) || "Individual",
        notes: npClean(params.notes, 1000),
        gifts: [], comms: [], pledges: [],
        firstGiftAt: null, lastGiftAt: null,
        createdAt: npIso(),
      };
      npList(npMap(s, "donors"), npActor(ctx)).push(donor);
      saveNonprofit();
      return { ok: true, result: { donor } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  function donorStats(d) {
    const totalGiven = d.gifts.reduce((n, g) => n + g.amount, 0);
    const giftCount = d.gifts.length;
    const sorted = [...d.gifts].sort((a, b) => new Date(a.at) - new Date(b.at));
    const lastGiftAt = sorted.length ? sorted[sorted.length - 1].at : null;
    const firstGiftAt = sorted.length ? sorted[0].at : null;
    const pledgeBalance = d.pledges.reduce((n, p) => n + Math.max(0, p.amount - p.paid), 0);
    return { totalGiven, giftCount, avgGift: giftCount ? Math.round(totalGiven / giftCount) : 0,
      lastGiftAt, firstGiftAt, pledgeBalance };
  }

  registerLensAction("nonprofit", "donor-list", (ctx, _a, _p = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const donors = npList(npMap(s, "donors"), npActor(ctx)).map((d) => ({
        ...d, ...donorStats(d), commCount: d.comms.length,
      }));
      return { ok: true, result: { donors, count: donors.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("nonprofit", "donor-update", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const d = npList(npMap(s, "donors"), npActor(ctx)).find((x) => x.id === params.id);
      if (!d) return { ok: false, error: "donor not found" };
      ["name", "email", "phone", "address", "type", "notes"].forEach((k) => {
        if (params[k] != null) d[k] = npClean(params[k], k === "notes" ? 1000 : 240);
      });
      saveNonprofit();
      return { ok: true, result: { donor: { ...d, ...donorStats(d) } } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("nonprofit", "donor-delete", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = npList(npMap(s, "donors"), npActor(ctx));
      const i = arr.findIndex((x) => x.id === params.id);
      if (i < 0) return { ok: false, error: "donor not found" };
      arr.splice(i, 1); saveNonprofit();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // Log a gift directly to a donor's giving history (donor CRM path).
  registerLensAction("nonprofit", "donor-gift-log", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const d = npList(npMap(s, "donors"), npActor(ctx)).find((x) => x.id === params.donorId);
      if (!d) return { ok: false, error: "donor not found" };
      const amount = npNum(params.amount);
      if (amount <= 0) return { ok: false, error: "gift amount must be positive" };
      const gift = {
        id: npId("gft"), amount, at: npClean(params.date, 30) || npIso(),
        fund: npClean(params.fund, 80) || "General", campaign: npClean(params.campaign, 120),
        method: npClean(params.method, 30) || "check",
        receiptIssued: false, ackSent: false,
      };
      d.gifts.push(gift);
      saveNonprofit();
      return { ok: true, result: { gift, donor: { ...d, ...donorStats(d) } } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE: Donor segmentation — major / lapsed / first-time / by-interest
  // ═══════════════════════════════════════════════════════════════════
  registerLensAction("nonprofit", "donor-segment", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const majorThreshold = npNum(params.majorThreshold) || 1000;
      const lapsedDays = npNum(params.lapsedDays) || 365;
      const now = Date.now();
      const donors = npList(npMap(s, "donors"), npActor(ctx)).map((d) => ({ ...d, ...donorStats(d) }));
      const seg = { major: [], midLevel: [], firstTime: [], lapsed: [], recurring: [], prospect: [] };
      for (const d of donors) {
        if (d.totalGiven >= majorThreshold) seg.major.push(d);
        else if (d.totalGiven > 0) seg.midLevel.push(d);
        if (d.giftCount === 1) seg.firstTime.push(d);
        if (d.giftCount === 0) seg.prospect.push(d);
        if (d.lastGiftAt) {
          const ageDays = (now - new Date(d.lastGiftAt).getTime()) / 86_400_000;
          if (ageDays > lapsedDays) seg.lapsed.push(d);
        } else if (d.giftCount === 0) { /* prospect already counted */ }
        if (d.pledges.some((p) => p.recurring)) seg.recurring.push(d);
      }
      const summary = Object.fromEntries(Object.entries(seg).map(([k, v]) => [k, v.length]));
      return { ok: true, result: { segments: seg, summary, totalDonors: donors.length, majorThreshold, lapsedDays } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE: Email / communications — thank-you automation, appeals, receipts
  // ═══════════════════════════════════════════════════════════════════
  function composeMessage(kind, donor, params) {
    const name = donor.name.split(" ")[0] || donor.name;
    if (kind === "thank_you") {
      return { subject: `Thank you, ${name}`,
        body: `Dear ${name},\n\nThank you for your generous gift. Your support directly powers our mission. We are deeply grateful to have you as part of our community.\n\nWith gratitude,\nThe Team` };
    }
    if (kind === "appeal") {
      const cause = npClean(params.cause, 120) || "our work";
      return { subject: `Help us continue ${cause}`,
        body: `Dear ${name},\n\nWe are reaching out because your past support has made a real difference. Today we invite you to give again so we can continue ${cause}.\n\nEvery gift counts.\n\nWarmly,\nThe Team` };
    }
    if (kind === "receipt") {
      const amt = npNum(params.amount);
      return { subject: `Your tax receipt`,
        body: `Dear ${name},\n\nThis confirms your tax-deductible contribution of $${amt.toLocaleString()}. No goods or services were provided in exchange for this gift. Please retain this receipt for your tax records.\n\nThank you,\nThe Team` };
    }
    return { subject: npClean(params.subject, 160) || "A note from us",
      body: npClean(params.body, 4000) || `Dear ${name},\n\n` };
  }

  registerLensAction("nonprofit", "comm-send", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const donors = npList(npMap(s, "donors"), npActor(ctx));
      const d = donors.find((x) => x.id === params.donorId);
      if (!d) return { ok: false, error: "donor not found" };
      const kind = ["thank_you", "appeal", "receipt", "custom"].includes(params.kind) ? params.kind : "custom";
      const msg = composeMessage(kind, d, params);
      const comm = { id: npId("cmm"), kind, channel: npClean(params.channel, 20) || "email",
        subject: msg.subject, body: msg.body, sentAt: npIso() };
      d.comms.push(comm);
      saveNonprofit();
      return { ok: true, result: { comm, donor: d.name } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // Compose without sending (preview) — also used by automation.
  registerLensAction("nonprofit", "comm-compose", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const d = npList(npMap(s, "donors"), npActor(ctx)).find((x) => x.id === params.donorId)
        || { name: npClean(params.donorName, 160) || "Friend" };
      const kind = ["thank_you", "appeal", "receipt", "custom"].includes(params.kind) ? params.kind : "thank_you";
      const msg = composeMessage(kind, d, params);
      return { ok: true, result: { kind, ...msg, donor: d.name } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("nonprofit", "comm-log", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const d = npList(npMap(s, "donors"), npActor(ctx)).find((x) => x.id === params.donorId);
      if (!d) return { ok: false, error: "donor not found" };
      return { ok: true, result: { comms: d.comms, count: d.comms.length, donor: d.name } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // Thank-you automation — finds unacknowledged gifts and queues thank-yous.
  registerLensAction("nonprofit", "thankyou-run", (ctx, _a, _p = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const donors = npList(npMap(s, "donors"), npActor(ctx));
      let sent = 0;
      const queued = [];
      for (const d of donors) {
        const pending = d.gifts.filter((g) => !g.ackSent);
        if (!pending.length) continue;
        const msg = composeMessage("thank_you", d, {});
        const comm = { id: npId("cmm"), kind: "thank_you", channel: "email",
          subject: msg.subject, body: msg.body, sentAt: npIso(), auto: true };
        d.comms.push(comm);
        pending.forEach((g) => { g.ackSent = true; });
        sent += 1;
        queued.push({ donor: d.name, gifts: pending.length });
      }
      saveNonprofit();
      return { ok: true, result: { sent, queued } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE: Tax-receipt generation for donations
  // ═══════════════════════════════════════════════════════════════════
  registerLensAction("nonprofit", "receipt-generate", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const d = npList(npMap(s, "donors"), npActor(ctx)).find((x) => x.id === params.donorId);
      if (!d) return { ok: false, error: "donor not found" };
      const gift = d.gifts.find((g) => g.id === params.giftId);
      if (!gift) return { ok: false, error: "gift not found" };
      gift.receiptIssued = true;
      const receiptNo = `R-${new Date().getFullYear()}-${gift.id.slice(-6).toUpperCase()}`;
      saveNonprofit();
      return { ok: true, result: { receipt: {
        receiptNo, donorName: d.name, donorAddress: d.address,
        amount: gift.amount, giftDate: gift.at, fund: gift.fund, method: gift.method,
        statement: "No goods or services were provided in exchange for this contribution. This gift is tax-deductible to the extent allowed by law.",
        issuedAt: npIso(),
      } } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // Annual giving statement — all gifts for a donor in a tax year.
  registerLensAction("nonprofit", "receipt-annual", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const d = npList(npMap(s, "donors"), npActor(ctx)).find((x) => x.id === params.donorId);
      if (!d) return { ok: false, error: "donor not found" };
      const year = npNum(params.year) || new Date().getFullYear();
      const gifts = d.gifts.filter((g) => new Date(g.at).getFullYear() === year);
      const total = gifts.reduce((n, g) => n + g.amount, 0);
      return { ok: true, result: { statement: {
        donorName: d.name, donorAddress: d.address, year,
        gifts: gifts.map((g) => ({ date: g.at, amount: g.amount, fund: g.fund })),
        totalDeductible: total, giftCount: gifts.length,
        statement: "This annual statement summarizes all tax-deductible contributions for the calendar year. No goods or services were provided in exchange.",
      } } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE: Recurring-giving management — manage / edit / cancel pledges
  // ═══════════════════════════════════════════════════════════════════
  function nextDue(frequency, fromIso) {
    const base = fromIso ? new Date(fromIso) : new Date();
    const days = { weekly: 7, monthly: 30, quarterly: 91, annual: 365 }[frequency] || 30;
    return new Date(base.getTime() + days * 86_400_000).toISOString();
  }

  registerLensAction("nonprofit", "pledge-create", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const d = npList(npMap(s, "donors"), npActor(ctx)).find((x) => x.id === params.donorId);
      if (!d) return { ok: false, error: "donor not found" };
      const amount = npNum(params.amount);
      if (amount <= 0) return { ok: false, error: "pledge amount must be positive" };
      const frequency = ["weekly", "monthly", "quarterly", "annual"].includes(params.frequency)
        ? params.frequency : "monthly";
      const pledge = {
        id: npId("plg"), amount, frequency, recurring: true,
        status: "active", paid: 0, payments: 0,
        startedAt: npIso(), nextDue: nextDue(frequency, null),
        fund: npClean(params.fund, 80) || "General",
      };
      d.pledges.push(pledge);
      saveNonprofit();
      return { ok: true, result: { pledge, donor: d.name } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("nonprofit", "pledge-list", (ctx, _a, _p = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const donors = npList(npMap(s, "donors"), npActor(ctx));
      const pledges = [];
      for (const d of donors) {
        for (const p of d.pledges) pledges.push({ ...p, donorId: d.id, donorName: d.name });
      }
      const active = pledges.filter((p) => p.status === "active");
      return { ok: true, result: { pledges, count: pledges.length, active: active.length,
        monthlyValue: active.reduce((n, p) => {
          const perMonth = { weekly: 4.33, monthly: 1, quarterly: 1 / 3, annual: 1 / 12 }[p.frequency] || 1;
          return n + p.amount * perMonth;
        }, 0) } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("nonprofit", "pledge-update", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const donors = npList(npMap(s, "donors"), npActor(ctx));
      const d = donors.find((x) => x.id === params.donorId);
      if (!d) return { ok: false, error: "donor not found" };
      const p = d.pledges.find((x) => x.id === params.pledgeId);
      if (!p) return { ok: false, error: "pledge not found" };
      if (params.amount != null) {
        const a = npNum(params.amount);
        if (a <= 0) return { ok: false, error: "pledge amount must be positive" };
        p.amount = a;
      }
      if (["weekly", "monthly", "quarterly", "annual"].includes(params.frequency)) {
        p.frequency = params.frequency;
        p.nextDue = nextDue(p.frequency, null);
      }
      if (["active", "paused"].includes(params.status)) p.status = params.status;
      saveNonprofit();
      return { ok: true, result: { pledge: p } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("nonprofit", "pledge-cancel", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const donors = npList(npMap(s, "donors"), npActor(ctx));
      const d = donors.find((x) => x.id === params.donorId);
      if (!d) return { ok: false, error: "donor not found" };
      const p = d.pledges.find((x) => x.id === params.pledgeId);
      if (!p) return { ok: false, error: "pledge not found" };
      p.status = "cancelled"; p.recurring = false; p.cancelledAt = npIso();
      saveNonprofit();
      return { ok: true, result: { pledge: p } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // Process a scheduled recurring payment — credits the pledge + a gift.
  registerLensAction("nonprofit", "pledge-charge", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const donors = npList(npMap(s, "donors"), npActor(ctx));
      const d = donors.find((x) => x.id === params.donorId);
      if (!d) return { ok: false, error: "donor not found" };
      const p = d.pledges.find((x) => x.id === params.pledgeId);
      if (!p) return { ok: false, error: "pledge not found" };
      if (p.status !== "active") return { ok: false, error: "pledge is not active" };
      p.paid += p.amount; p.payments += 1; p.nextDue = nextDue(p.frequency, null);
      const gift = { id: npId("gft"), amount: p.amount, at: npIso(),
        fund: p.fund, campaign: "", method: "recurring", pledgeId: p.id,
        receiptIssued: false, ackSent: false };
      d.gifts.push(gift);
      saveNonprofit();
      return { ok: true, result: { pledge: p, gift } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE: Online donation pages — public branded giving page
  // ═══════════════════════════════════════════════════════════════════
  registerLensAction("nonprofit", "donation-page-create", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const title = npClean(params.title, 160);
      if (!title) return { ok: false, error: "donation page title required" };
      const slug = (npClean(params.slug, 60) || title)
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50)
        || `give-${Date.now().toString(36)}`;
      const amts = Array.isArray(params.suggestedAmounts)
        ? params.suggestedAmounts.map(npNum).filter((n) => n > 0) : [25, 50, 100, 250];
      const page = {
        id: npId("pag"), slug, title,
        story: npClean(params.story, 4000),
        goal: Math.max(0, npNum(params.goal)),
        suggestedAmounts: amts.length ? amts : [25, 50, 100, 250],
        accentColor: npClean(params.accentColor, 20) || "#f43f5e",
        coverImage: npClean(params.coverImage, 500),
        published: false, raised: 0, donations: [],
        createdAt: npIso(),
      };
      npList(npMap(s, "donationPages"), npActor(ctx)).push(page);
      saveNonprofit();
      return { ok: true, result: { page } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("nonprofit", "donation-page-list", (ctx, _a, _p = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const pages = npList(npMap(s, "donationPages"), npActor(ctx)).map((p) => ({
        ...p, donorCount: p.donations.length,
        progressPct: p.goal > 0 ? Math.round((p.raised / p.goal) * 100) : 0,
        publicUrl: `/give/${p.slug}`,
      }));
      return { ok: true, result: { pages, count: pages.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("nonprofit", "donation-page-update", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const p = npList(npMap(s, "donationPages"), npActor(ctx)).find((x) => x.id === params.id);
      if (!p) return { ok: false, error: "donation page not found" };
      if (params.title != null) p.title = npClean(params.title, 160) || p.title;
      if (params.story != null) p.story = npClean(params.story, 4000);
      if (params.goal != null) p.goal = Math.max(0, npNum(params.goal));
      if (params.accentColor != null) p.accentColor = npClean(params.accentColor, 20) || p.accentColor;
      if (params.coverImage != null) p.coverImage = npClean(params.coverImage, 500);
      if (params.published != null) p.published = npBool(params.published);
      if (Array.isArray(params.suggestedAmounts)) {
        const a = params.suggestedAmounts.map(npNum).filter((n) => n > 0);
        if (a.length) p.suggestedAmounts = a;
      }
      saveNonprofit();
      return { ok: true, result: { page: p } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("nonprofit", "donation-page-delete", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = npList(npMap(s, "donationPages"), npActor(ctx));
      const i = arr.findIndex((x) => x.id === params.id);
      if (i < 0) return { ok: false, error: "donation page not found" };
      arr.splice(i, 1); saveNonprofit();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // A donation arriving via the public page (Concord Coin carries value).
  registerLensAction("nonprofit", "donation-page-give", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const p = npList(npMap(s, "donationPages"), npActor(ctx)).find((x) => x.id === params.pageId);
      if (!p) return { ok: false, error: "donation page not found" };
      if (!p.published) return { ok: false, error: "donation page is not published" };
      const amount = npNum(params.amount);
      if (amount <= 0) return { ok: false, error: "donation amount must be positive" };
      const donation = { id: npId("don"), amount,
        donor: npClean(params.donor, 120) || "Anonymous",
        recurring: npBool(params.recurring), at: npIso() };
      p.donations.push(donation); p.raised += amount;
      saveNonprofit();
      return { ok: true, result: { donation, raised: p.raised,
        progressPct: p.goal > 0 ? Math.round((p.raised / p.goal) * 100) : 0 } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE: Volunteer management — sign-up, shift scheduling, hour tracking
  // ═══════════════════════════════════════════════════════════════════
  registerLensAction("nonprofit", "volunteer-signup", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const name = npClean(params.name, 160);
      if (!name) return { ok: false, error: "volunteer name required" };
      const vol = {
        id: npId("vol"), name,
        email: npClean(params.email, 160), phone: npClean(params.phone, 40),
        skills: Array.isArray(params.skills)
          ? params.skills.map((x) => npClean(x, 40)).filter(Boolean)
          : npClean(params.skills, 240).split(",").map((x) => x.trim()).filter(Boolean),
        availability: npClean(params.availability, 120),
        shifts: [], totalHours: 0, status: "active", signedUpAt: npIso(),
      };
      npList(npMap(s, "volunteers"), npActor(ctx)).push(vol);
      saveNonprofit();
      return { ok: true, result: { volunteer: vol } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("nonprofit", "volunteer-list", (ctx, _a, _p = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const volunteers = npList(npMap(s, "volunteers"), npActor(ctx));
      const totalHours = volunteers.reduce((n, v) => n + v.totalHours, 0);
      return { ok: true, result: { volunteers, count: volunteers.length,
        totalHours, estValue: Math.round(totalHours * 31.80) } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("nonprofit", "volunteer-delete", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = npList(npMap(s, "volunteers"), npActor(ctx));
      const i = arr.findIndex((x) => x.id === params.id);
      if (i < 0) return { ok: false, error: "volunteer not found" };
      arr.splice(i, 1); saveNonprofit();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // Schedule a shift for a volunteer.
  registerLensAction("nonprofit", "shift-schedule", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const v = npList(npMap(s, "volunteers"), npActor(ctx)).find((x) => x.id === params.volunteerId);
      if (!v) return { ok: false, error: "volunteer not found" };
      const role = npClean(params.role, 120);
      if (!role) return { ok: false, error: "shift role required" };
      const hours = npNum(params.hours);
      const shift = {
        id: npId("shf"), role,
        date: npClean(params.date, 30) || npIso().slice(0, 10),
        startTime: npClean(params.startTime, 12), endTime: npClean(params.endTime, 12),
        scheduledHours: hours > 0 ? hours : 0,
        loggedHours: 0, status: "scheduled", notes: npClean(params.notes, 500),
      };
      v.shifts.push(shift);
      saveNonprofit();
      return { ok: true, result: { shift, volunteer: v.name } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // Log hours against a scheduled shift (or ad-hoc).
  registerLensAction("nonprofit", "shift-log-hours", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const v = npList(npMap(s, "volunteers"), npActor(ctx)).find((x) => x.id === params.volunteerId);
      if (!v) return { ok: false, error: "volunteer not found" };
      const hours = npNum(params.hours);
      if (hours <= 0) return { ok: false, error: "hours must be positive" };
      let shift = v.shifts.find((x) => x.id === params.shiftId);
      if (!shift && params.shiftId) return { ok: false, error: "shift not found" };
      if (!shift) {
        shift = { id: npId("shf"), role: npClean(params.role, 120) || "General",
          date: npIso().slice(0, 10), startTime: "", endTime: "",
          scheduledHours: 0, loggedHours: 0, status: "completed", notes: "" };
        v.shifts.push(shift);
      }
      shift.loggedHours += hours;
      shift.status = "completed";
      v.totalHours += hours;
      saveNonprofit();
      return { ok: true, result: { shift, totalHours: v.totalHours,
        estValue: Math.round(v.totalHours * 31.80) } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE: Event / peer-to-peer fundraising pages
  // ═══════════════════════════════════════════════════════════════════
  registerLensAction("nonprofit", "event-create", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const name = npClean(params.name, 160);
      if (!name) return { ok: false, error: "event name required" };
      const event = {
        id: npId("evt"), name,
        description: npClean(params.description, 4000),
        date: npClean(params.date, 30) || null,
        goal: Math.max(0, npNum(params.goal)),
        ticketPrice: Math.max(0, npNum(params.ticketPrice)),
        type: npClean(params.type, 40) || "fundraiser",
        teams: [], status: "active", createdAt: npIso(),
      };
      npList(npMap(s, "events"), npActor(ctx)).push(event);
      saveNonprofit();
      return { ok: true, result: { event } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  function eventStats(e) {
    const raised = e.teams.reduce((n, t) => n + t.raised, 0);
    const donorCount = e.teams.reduce((n, t) => n + t.donations.length, 0);
    return { raised, donorCount, teamCount: e.teams.length,
      progressPct: e.goal > 0 ? Math.round((raised / e.goal) * 100) : 0 };
  }

  registerLensAction("nonprofit", "event-list", (ctx, _a, _p = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const events = npList(npMap(s, "events"), npActor(ctx)).map((e) => ({ ...e, ...eventStats(e) }));
      return { ok: true, result: { events, count: events.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("nonprofit", "event-delete", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = npList(npMap(s, "events"), npActor(ctx));
      const i = arr.findIndex((x) => x.id === params.id);
      if (i < 0) return { ok: false, error: "event not found" };
      arr.splice(i, 1); saveNonprofit();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // Peer-to-peer: a supporter creates a fundraising team/page under an event.
  registerLensAction("nonprofit", "p2p-team-create", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const e = npList(npMap(s, "events"), npActor(ctx)).find((x) => x.id === params.eventId);
      if (!e) return { ok: false, error: "event not found" };
      const captain = npClean(params.captain, 120);
      if (!captain) return { ok: false, error: "team captain name required" };
      const team = {
        id: npId("tm"), captain,
        teamName: npClean(params.teamName, 120) || `${captain}'s Team`,
        personalGoal: Math.max(0, npNum(params.personalGoal)) || 500,
        message: npClean(params.message, 2000),
        raised: 0, donations: [], createdAt: npIso(),
      };
      e.teams.push(team);
      saveNonprofit();
      return { ok: true, result: { team, event: e.name } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // A donation to a peer-to-peer team.
  registerLensAction("nonprofit", "p2p-donate", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const e = npList(npMap(s, "events"), npActor(ctx)).find((x) => x.id === params.eventId);
      if (!e) return { ok: false, error: "event not found" };
      const team = e.teams.find((t) => t.id === params.teamId);
      if (!team) return { ok: false, error: "team not found" };
      const amount = npNum(params.amount);
      if (amount <= 0) return { ok: false, error: "donation amount must be positive" };
      const donation = { id: npId("don"), amount,
        donor: npClean(params.donor, 120) || "Anonymous",
        message: npClean(params.message, 500), at: npIso() };
      team.donations.push(donation); team.raised += amount;
      saveNonprofit();
      return { ok: true, result: { donation, teamRaised: team.raised,
        eventRaised: e.teams.reduce((n, t) => n + t.raised, 0) } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // P2P leaderboard for an event.
  registerLensAction("nonprofit", "p2p-leaderboard", (ctx, _a, params = {}) => {
    try {
      const s = getNonprofitState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const e = npList(npMap(s, "events"), npActor(ctx)).find((x) => x.id === params.eventId);
      if (!e) return { ok: false, error: "event not found" };
      const board = [...e.teams]
        .map((t) => ({ id: t.id, teamName: t.teamName, captain: t.captain,
          raised: t.raised, personalGoal: t.personalGoal, donorCount: t.donations.length,
          progressPct: t.personalGoal > 0 ? Math.round((t.raised / t.personalGoal) * 100) : 0 }))
        .sort((a, b) => b.raised - a.raised)
        .map((t, i) => ({ rank: i + 1, ...t }));
      return { ok: true, result: { event: e.name, leaderboard: board,
        totalRaised: board.reduce((n, t) => n + t.raised, 0) } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
};
