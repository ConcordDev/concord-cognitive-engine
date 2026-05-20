export default function registerInsuranceActions(registerLensAction) {
  registerLensAction("insurance", "coverageGap", (ctx, artifact, _params) => {
    const policies = artifact.data?.policies || [artifact.data];
    const coverageTypes = ['health', 'auto', 'home', 'life', 'liability', 'umbrella'];
    const coveredTypes = new Set(policies.map(p => (p.type || '').toLowerCase()));
    const gaps = coverageTypes.filter(t => !coveredTypes.has(t));
    const expiringSoon = policies.filter(p => {
      if (!p.expiryDate) return false;
      const daysLeft = (new Date(p.expiryDate) - new Date()) / (1000 * 60 * 60 * 24);
      return daysLeft >= 0 && daysLeft <= 30;
    });
    return { ok: true, result: { coveredTypes: [...coveredTypes], gaps, gapCount: gaps.length, expiringSoon, totalPolicies: policies.length } };
  });

  registerLensAction("insurance", "commissionSummary", (ctx, artifact, _params) => {
    const policies = artifact.data?.policies || [artifact.data];
    let totalPremium = 0;
    let totalCommission = 0;
    const byTier = {};

    for (const policy of policies) {
      const premium = parseFloat(policy.premium) || 0;
      const rate = parseFloat(policy.commissionRate || policy.rate) || 0;
      const tier = policy.tier || policy.type || "standard";
      const commission = Math.round(premium * (rate / 100) * 100) / 100;

      totalPremium += premium;
      totalCommission += commission;

      if (!byTier[tier]) byTier[tier] = { count: 0, premium: 0, commission: 0 };
      byTier[tier].count++;
      byTier[tier].premium += premium;
      byTier[tier].commission += commission;
    }

    const tiers = Object.entries(byTier).map(([name, data]) => ({
      tier: name,
      policyCount: data.count,
      totalPremium: Math.round(data.premium * 100) / 100,
      totalCommission: Math.round(data.commission * 100) / 100,
      avgRate: data.premium > 0 ? Math.round((data.commission / data.premium) * 10000) / 100 : 0,
    }));

    return {
      ok: true,
      result: {
        agent: artifact.title,
        totalPolicies: policies.length,
        totalPremium: Math.round(totalPremium * 100) / 100,
        totalCommission: Math.round(totalCommission * 100) / 100,
        effectiveRate: totalPremium > 0 ? Math.round((totalCommission / totalPremium) * 10000) / 100 : 0,
        byTier: tiers,
      },
    };
  });

  registerLensAction("insurance", "lossRatioReport", (ctx, artifact, _params) => {
    const policies = artifact.data?.policies || [];
    const claims = artifact.data?.claims || [];

    const premiumsCollected = policies.reduce((s, p) => s + (parseFloat(p.premium) || 0), 0);
    const claimsPaid = claims
      .filter(c => c.status === "paid" || c.status === "closed")
      .reduce((s, c) => s + (parseFloat(c.amount) || parseFloat(c.paidAmount) || 0), 0);
    const totalClaims = claims.length;

    const lossRatio = premiumsCollected > 0 ? Math.round((claimsPaid / premiumsCollected) * 10000) / 100 : 0;
    const frequency = policies.length > 0 ? Math.round((totalClaims / policies.length) * 1000) / 1000 : 0;
    const severity = totalClaims > 0 ? Math.round((claimsPaid / totalClaims) * 100) / 100 : 0;

    let assessment = "profitable";
    if (lossRatio > 100) assessment = "unprofitable";
    else if (lossRatio > 75) assessment = "marginal";
    else if (lossRatio > 60) assessment = "acceptable";

    return {
      ok: true,
      result: {
        generatedAt: new Date().toISOString(),
        premiumsCollected: Math.round(premiumsCollected * 100) / 100,
        claimsPaid: Math.round(claimsPaid * 100) / 100,
        lossRatio,
        claimFrequency: frequency,
        averageSeverity: severity,
        totalPolicies: policies.length,
        totalClaims,
        assessment,
      },
    };
  });

  registerLensAction("insurance", "renewalAlert", (ctx, artifact, _params) => {
    const policies = artifact.data?.policies || [artifact.data];
    const now = new Date();
    const msPerDay = 86400000;
    const buckets = { within30: [], within60: [], within90: [], current: [] };

    for (const policy of policies) {
      const expiry = policy.expiryDate || policy.renewalDate || policy.endDate;
      if (!expiry) continue;
      const expiryDate = new Date(expiry);
      const daysUntil = Math.ceil((expiryDate - now) / msPerDay);
      if (daysUntil < 0) continue; // already expired

      const entry = {
        policyNumber: policy.policyNumber || policy.id,
        holder: policy.holder || policy.insuredName || "",
        type: policy.type || "general",
        expiryDate: expiryDate.toISOString().split("T")[0],
        daysUntilRenewal: daysUntil,
        premium: parseFloat(policy.premium) || 0,
      };

      if (daysUntil <= 30) buckets.within30.push(entry);
      else if (daysUntil <= 60) buckets.within60.push(entry);
      else if (daysUntil <= 90) buckets.within90.push(entry);
      else buckets.current.push(entry);
    }

    // Sort each bucket by soonest first
    for (const key of Object.keys(buckets)) buckets[key].sort((a, b) => a.daysUntilRenewal - b.daysUntilRenewal);

    const urgent = buckets.within30;
    const totalUpcoming = buckets.within30.length + buckets.within60.length + buckets.within90.length;
    const premiumAtRisk = [...buckets.within30, ...buckets.within60, ...buckets.within90]
      .reduce((s, p) => s + p.premium, 0);

    return {
      ok: true,
      result: {
        checkedAt: now.toISOString(),
        totalPolicies: policies.length,
        totalUpcomingRenewals: totalUpcoming,
        premiumAtRisk: Math.round(premiumAtRisk * 100) / 100,
        within30Days: buckets.within30,
        within60Days: buckets.within60,
        within90Days: buckets.within90,
        urgentCount: urgent.length,
      },
    };
  });

  registerLensAction("insurance", "premiumHistory", (ctx, artifact, _params) => {
    const renewals = artifact.data?.renewalHistory || [];
    if (renewals.length < 2) return { ok: true, result: { history: renewals, trend: 'insufficient_data' } };
    const sorted = [...renewals].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    let totalChange = 0;
    const changes = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1].premium || 0;
      const curr = sorted[i].premium || 0;
      const change = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
      totalChange += change;
      changes.push({ period: sorted[i].date, previousPremium: prev, currentPremium: curr, changePercent: Math.round(change * 10) / 10 });
    }
    const avgChange = changes.length > 0 ? Math.round((totalChange / changes.length) * 10) / 10 : 0;
    return { ok: true, result: { policyNumber: artifact.data?.policyNumber, history: changes, averageChangePercent: avgChange, trend: avgChange > 2 ? 'increasing' : avgChange < -2 ? 'decreasing' : 'stable' } };
  });

  registerLensAction("insurance", "claimStatus", (ctx, artifact, _params) => {
    const claims = artifact.data?.claims || [artifact.data];
    const now = new Date();
    const byStatus = {};
    const aging = { under30: 0, between30_60: 0, between60_90: 0, over90: 0 };
    claims.forEach(c => {
      const status = c.status || 'unknown';
      byStatus[status] = (byStatus[status] || 0) + 1;
      if (c.dateOfLoss) {
        const age = (now - new Date(c.dateOfLoss)) / (1000 * 60 * 60 * 24);
        if (age <= 30) aging.under30++;
        else if (age <= 60) aging.between30_60++;
        else if (age <= 90) aging.between60_90++;
        else aging.over90++;
      }
    });
    const totalAmount = claims.reduce((s, c) => s + (c.amount || 0), 0);
    return { ok: true, result: { byStatus, aging, totalClaims: claims.length, totalAmount, openClaims: claims.filter(c => !['closed', 'paid', 'denied'].includes(c.status)).length } };
  });

  registerLensAction("insurance", "riskScore", (ctx, artifact, params) => {
    const probability = artifact.data?.probability || params.probability || 3;
    const impact = artifact.data?.impact || params.impact || 3;
    const score = probability * impact;
    const maxScore = 25;
    const normalizedScore = Math.round((score / maxScore) * 100);
    const mitigations = artifact.data?.mitigations || [];
    const mitigatedScore = Math.max(1, score - mitigations.length);
    return {
      ok: true,
      result: {
        risk: artifact.title,
        probability,
        impact,
        rawScore: score,
        normalizedScore,
        mitigations: mitigations.length,
        mitigatedScore,
        level: score >= 15 ? 'critical' : score >= 10 ? 'high' : score >= 5 ? 'medium' : 'low',
      },
    };
  });

  // ─── Parity-sprint macros ──

  function getInsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.insLens) STATE.insLens = {};
    const s = STATE.insLens;
    for (const k of [
      "policies", "claims", "documents", "payments", "agents",
      "reminders", "beneficiaries", "assets",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveInsState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }

  registerLensAction("insurance", "policy-list", (ctx, _artifact, _params = {}) => {
    const state = getInsState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    return { ok: true, result: { policies: state.policies.get(userId) || [] } };
  });

  registerLensAction("insurance", "policy-add", (ctx, _artifact, params = {}) => {
    const state = getInsState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const carrier = String(params.carrier || "").trim();
    const policyNumber = String(params.policyNumber || "").trim();
    if (!carrier || !policyNumber) return { ok: false, error: "carrier and policyNumber required" };
    if (!state.policies.has(userId)) state.policies.set(userId, []);
    const policy = {
      id: `pol_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      carrier, policyNumber,
      kind: ["auto", "home", "health", "life", "umbrella", "renters", "pet", "travel", "business"].includes(params.kind) ? params.kind : "auto",
      annualPremium: Math.max(0, Number(params.annualPremium) || 0),
      deductible: Math.max(0, Number(params.deductible) || 0),
      liabilityLimit: params.liabilityLimit ? Number(params.liabilityLimit) : undefined,
      effectiveDate: params.effectiveDate || new Date().toISOString().slice(0, 10),
      renewalDate: params.renewalDate || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
      status: "active", documents: 0,
      createdAt: new Date().toISOString(),
    };
    state.policies.get(userId).push(policy);
    saveInsState();
    return { ok: true, result: { policy } };
  });

  registerLensAction("insurance", "claim-list", (ctx, _artifact, _params = {}) => {
    const state = getInsState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const all = state.claims.get(userId) || [];
    const enriched = all.map(c => ({
      ...c,
      daysSinceSubmit: c.submittedDate ? Math.floor((Date.now() - new Date(c.submittedDate).getTime()) / 86400000) : undefined,
    }));
    return { ok: true, result: { claims: [...enriched].reverse() } };
  });

  registerLensAction("insurance", "claim-file", (ctx, _artifact, params = {}) => {
    const state = getInsState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const carrier = String(params.carrier || "").trim();
    const description = String(params.description || "").trim();
    if (!carrier || !description) return { ok: false, error: "carrier and description required" };
    if (!state.claims.has(userId)) state.claims.set(userId, []);
    const claim = {
      id: `clm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      policyId: String(params.policyId || ""),
      carrier, description,
      kind: ["collision", "comprehensive", "property", "health", "life", "liability", "other"].includes(params.kind) ? params.kind : "other",
      incidentDate: params.incidentDate || new Date().toISOString().slice(0, 10),
      submittedDate: new Date().toISOString().slice(0, 10),
      status: "submitted",
      claimAmount: Math.max(0, Number(params.claimAmount) || 0),
      documents: 0,
    };
    state.claims.get(userId).push(claim);
    saveInsState();
    return { ok: true, result: { claim } };
  });

  // Insurance premium quotes require live carrier broker APIs (Insurify,
  // The Zebra, Compare.com) which are paid + per-state-licensed. Per the
  // "everything must be real" directive, we no longer synthesize fake
  // quotes from a hardcoded carrier-rate table.
  registerLensAction("insurance", "quotes-compare", (_ctx, _artifact, params = {}) => {
    const kind = String(params.kind || "auto");
    const zip = String(params.zip || "");
    const coverage = ["minimum", "standard", "premium"].includes(params.coverage) ? params.coverage : "standard";
    return {
      ok: false,
      error: "Insurance quotes require a live carrier broker API. Set INSURIFY_API_KEY or ZEBRA_API_KEY to enable real quote comparison. Concord does not provide simulated premium quotes.",
      meta: { kind, zip, coverage },
    };
  });

  registerLensAction("insurance", "coverage-analyze", (ctx, _artifact, _params = {}) => {
    const state = getInsState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const policies = state.policies.get(userId) || [];
    const kinds = new Set(policies.filter(p => p.status === "active").map(p => p.kind));
    const gaps = [];
    if (!kinds.has("auto")) {
      gaps.push({ area: "Auto liability", current: "None", recommended: "100/300/100 minimum", riskLevel: "critical", monthlyCostToFix: 120, rationale: "Required by law in most states; single at-fault accident can wipe out savings." });
    }
    if (!kinds.has("renters") && !kinds.has("home")) {
      gaps.push({ area: "Home/renters", current: "None", recommended: "$300k contents + $300k liability", riskLevel: "critical", monthlyCostToFix: 25, rationale: "Average $25/mo for renters; covers theft, fire, and visitor injury liability." });
    }
    if (!kinds.has("life") && policies.some(p => p.kind === "home")) {
      gaps.push({ area: "Term life", current: "None", recommended: "10× annual income", riskLevel: "moderate", monthlyCostToFix: 40, rationale: "If you have a mortgage and dependents, 20-year term covers worst-case." });
    }
    if (!kinds.has("umbrella") && (kinds.has("auto") || kinds.has("home"))) {
      gaps.push({ area: "Umbrella liability", current: "None", recommended: "$1M coverage", riskLevel: "moderate", monthlyCostToFix: 25, rationale: "Tops up auto+home liability for the cost of a daily coffee. High-leverage protection." });
    }
    const autoPolicy = policies.find(p => p.kind === "auto" && p.status === "active");
    if (autoPolicy && (autoPolicy.liabilityLimit || 100000) < 100000) {
      gaps.push({ area: "Auto liability limits", current: `${(autoPolicy.liabilityLimit || 0) / 1000}k`, recommended: "100/300/100", riskLevel: "moderate", monthlyCostToFix: 15, rationale: "State minimums leave you exposed in a serious accident." });
    }
    const score = Math.max(0, 100 - gaps.reduce((s, g) => s + (g.riskLevel === "critical" ? 25 : g.riskLevel === "moderate" ? 12 : 5), 0));
    return { ok: true, result: { gaps, score, policyCount: policies.length, activePolicies: policies.filter(p => p.status === "active").length } };
  });

  // ─── Insurance policy-wallet 2026 parity ────────────────────────────
  // Extends the policy/claim CRUD with documents, premium payments,
  // agents, reminders, beneficiaries, covered assets and ID cards.

  const insId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const insNow = () => new Date().toISOString();
  const insAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const insListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const insNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const insClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const insDay = (v) => insClean(v, 10).slice(0, 10);
  const findPolicy = (s, userId, policyId) => (s.policies.get(userId) || []).find((p) => p.id === policyId) || null;
  const findClaim = (s, userId, claimId) => (s.claims.get(userId) || []).find((c) => c.id === claimId) || null;
  const INS_DAY = 86400000;

  function dueState(dateStr) {
    if (!dateStr) return "none";
    const t = new Date(dateStr + "T00:00:00Z").getTime();
    if (isNaN(t)) return "none";
    const days = Math.floor((t - Date.now()) / INS_DAY);
    if (days < 0) return "overdue";
    if (days <= 30) return "due_soon";
    return "scheduled";
  }

  // ── Policy management (extend) ──────────────────────────────────────
  registerLensAction("insurance", "policy-update", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const policy = findPolicy(s, insAid(ctx), params.id);
    if (!policy) return { ok: false, error: "policy not found" };
    if (params.annualPremium != null) policy.annualPremium = Math.max(0, insNum(params.annualPremium));
    if (params.deductible != null) policy.deductible = Math.max(0, insNum(params.deductible));
    if (params.renewalDate != null) policy.renewalDate = insDay(params.renewalDate) || policy.renewalDate;
    if (params.status != null && ["active", "lapsed", "cancelled", "pending"].includes(params.status)) {
      policy.status = params.status;
    }
    if (params.liabilityLimit != null) policy.liabilityLimit = insNum(params.liabilityLimit);
    saveInsState();
    return { ok: true, result: { policy } };
  });

  registerLensAction("insurance", "policy-delete", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.policies.get(insAid(ctx)) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "policy not found" };
    arr.splice(i, 1);
    s.documents.delete(params.id);
    s.payments.delete(params.id);
    saveInsState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("insurance", "policy-detail", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = insAid(ctx);
    const policy = findPolicy(s, userId, params.id);
    if (!policy) return { ok: false, error: "policy not found" };
    const payments = s.payments.get(policy.id) || [];
    return {
      ok: true,
      result: {
        policy,
        documents: s.documents.get(policy.id) || [],
        payments,
        paidToDate: Math.round(payments.reduce((a, p) => a + insNum(p.amount), 0) * 100) / 100,
        claims: (s.claims.get(userId) || []).filter((c) => c.policyId === policy.id),
        renewalStatus: dueState(policy.renewalDate),
      },
    };
  });

  // ── Policy documents ────────────────────────────────────────────────
  registerLensAction("insurance", "policy-document-add", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const policy = findPolicy(s, insAid(ctx), params.policyId);
    if (!policy) return { ok: false, error: "policy not found" };
    const title = insClean(params.title, 120);
    if (!title) return { ok: false, error: "title required" };
    const doc = {
      id: insId("doc"), policyId: policy.id, title,
      kind: insClean(params.kind, 40).toLowerCase() || "other",
      url: insClean(params.url, 500) || null,
      createdAt: insNow(),
    };
    insListB(s.documents, policy.id).push(doc);
    policy.documents = s.documents.get(policy.id).length;
    saveInsState();
    return { ok: true, result: { document: doc } };
  });

  registerLensAction("insurance", "policy-document-list", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPolicy(s, insAid(ctx), params.policyId)) return { ok: false, error: "policy not found" };
    return { ok: true, result: { documents: (s.documents.get(String(params.policyId)) || []).slice().reverse() } };
  });

  // ── Premium payments ────────────────────────────────────────────────
  registerLensAction("insurance", "payment-log", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const policy = findPolicy(s, insAid(ctx), params.policyId);
    if (!policy) return { ok: false, error: "policy not found" };
    const amount = insNum(params.amount);
    if (amount <= 0) return { ok: false, error: "amount must be > 0" };
    const payment = {
      id: insId("pay"), policyId: policy.id,
      amount: Math.round(amount * 100) / 100,
      date: insDay(params.date) || insDay(insNow()),
      method: insClean(params.method, 40) || null,
      createdAt: insNow(),
    };
    insListB(s.payments, policy.id).push(payment);
    saveInsState();
    return { ok: true, result: { payment } };
  });

  registerLensAction("insurance", "payment-list", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPolicy(s, insAid(ctx), params.policyId)) return { ok: false, error: "policy not found" };
    const payments = (s.payments.get(String(params.policyId)) || [])
      .slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return {
      ok: true,
      result: { payments, totalPaid: Math.round(payments.reduce((a, p) => a + insNum(p.amount), 0) * 100) / 100 },
    };
  });

  registerLensAction("insurance", "premium-schedule", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const policy = findPolicy(s, insAid(ctx), params.policyId);
    if (!policy) return { ok: false, error: "policy not found" };
    const freq = ["monthly", "quarterly", "semiannual", "annual"].includes(params.frequency)
      ? params.frequency : "monthly";
    const perYear = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 }[freq];
    const installment = Math.round((policy.annualPremium / perYear) * 100) / 100;
    const payments = s.payments.get(policy.id) || [];
    const last = payments.length
      ? payments.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0].date
      : policy.effectiveDate;
    const intervalDays = Math.round(365 / perYear);
    const nextDue = insDay(new Date(new Date(last).getTime() + intervalDays * INS_DAY).toISOString());
    return {
      ok: true,
      result: {
        frequency: freq, installment, perYear,
        annualPremium: policy.annualPremium,
        lastPaymentDate: last, nextDueDate: nextDue, nextDueStatus: dueState(nextDue),
      },
    };
  });

  // ── Claims (extend) ─────────────────────────────────────────────────
  registerLensAction("insurance", "claim-update", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const claim = findClaim(s, insAid(ctx), params.id);
    if (!claim) return { ok: false, error: "claim not found" };
    if (params.status != null && ["submitted", "under_review", "approved", "denied", "paid", "closed"].includes(params.status)) {
      claim.status = params.status;
    }
    if (params.payoutAmount != null) claim.payoutAmount = Math.max(0, insNum(params.payoutAmount));
    if (params.adjuster != null) claim.adjuster = insClean(params.adjuster, 120) || null;
    if (params.note != null) {
      claim.notes = claim.notes || [];
      claim.notes.push({ text: insClean(params.note, 300), at: insNow() });
    }
    saveInsState();
    return { ok: true, result: { claim } };
  });

  registerLensAction("insurance", "claim-detail", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const claim = findClaim(s, insAid(ctx), params.id);
    if (!claim) return { ok: false, error: "claim not found" };
    return {
      ok: true,
      result: {
        claim: {
          ...claim,
          daysSinceSubmit: claim.submittedDate
            ? Math.floor((Date.now() - new Date(claim.submittedDate).getTime()) / INS_DAY) : null,
        },
      },
    };
  });

  registerLensAction("insurance", "claim-delete", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.claims.get(insAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "claim not found" };
    arr.splice(i, 1);
    saveInsState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Agents / contacts ───────────────────────────────────────────────
  registerLensAction("insurance", "agent-add", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = insClean(params.name, 120);
    if (!name) return { ok: false, error: "name required" };
    const agent = {
      id: insId("agt"), name,
      agency: insClean(params.agency, 120) || null,
      phone: insClean(params.phone, 40) || null,
      email: insClean(params.email, 120) || null,
      role: insClean(params.role, 40).toLowerCase() || "agent",
      createdAt: insNow(),
    };
    insListB(s.agents, insAid(ctx)).push(agent);
    saveInsState();
    return { ok: true, result: { agent } };
  });

  registerLensAction("insurance", "agent-list", (ctx, _a, _params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { agents: s.agents.get(insAid(ctx)) || [] } };
  });

  // ── Reminders ───────────────────────────────────────────────────────
  registerLensAction("insurance", "reminder-create", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = insClean(params.title, 120);
    if (!title) return { ok: false, error: "title required" };
    const rem = {
      id: insId("rem"), title,
      kind: ["renewal", "payment", "inspection", "review", "general"].includes(params.kind)
        ? params.kind : "general",
      policyId: params.policyId ? String(params.policyId) : null,
      dueDate: insDay(params.dueDate) || null,
      done: false, createdAt: insNow(),
    };
    insListB(s.reminders, insAid(ctx)).push(rem);
    saveInsState();
    return { ok: true, result: { reminder: rem } };
  });

  registerLensAction("insurance", "reminder-list", (ctx, _a, _params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const reminders = (s.reminders.get(insAid(ctx)) || [])
      .map((r) => ({ ...r, status: r.done ? "done" : dueState(r.dueDate) }))
      .sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
    return {
      ok: true,
      result: {
        reminders,
        overdue: reminders.filter((r) => r.status === "overdue").length,
        dueSoon: reminders.filter((r) => r.status === "due_soon").length,
      },
    };
  });

  registerLensAction("insurance", "reminder-complete", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rem = (s.reminders.get(insAid(ctx)) || []).find((r) => r.id === params.id);
    if (!rem) return { ok: false, error: "reminder not found" };
    rem.done = !(params.reopen === true);
    saveInsState();
    return { ok: true, result: { reminder: rem } };
  });

  // ── Beneficiaries ───────────────────────────────────────────────────
  registerLensAction("insurance", "beneficiary-add", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const policy = findPolicy(s, insAid(ctx), params.policyId);
    if (!policy) return { ok: false, error: "policy not found" };
    const name = insClean(params.name, 120);
    if (!name) return { ok: false, error: "beneficiary name required" };
    const bene = {
      id: insId("ben"), policyId: policy.id, name,
      relationship: insClean(params.relationship, 60) || null,
      sharePct: Math.max(0, Math.min(100, Math.round(insNum(params.sharePct, 100)))),
      isPrimary: params.isPrimary !== false,
      createdAt: insNow(),
    };
    insListB(s.beneficiaries, policy.id).push(bene);
    saveInsState();
    return { ok: true, result: { beneficiary: bene } };
  });

  registerLensAction("insurance", "beneficiary-list", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPolicy(s, insAid(ctx), params.policyId)) return { ok: false, error: "policy not found" };
    const beneficiaries = s.beneficiaries.get(String(params.policyId)) || [];
    const totalShare = beneficiaries.reduce((a, b) => a + insNum(b.sharePct), 0);
    return {
      ok: true,
      result: { beneficiaries, totalShare, balanced: totalShare === 100 || beneficiaries.length === 0 },
    };
  });

  // ── Covered assets ──────────────────────────────────────────────────
  registerLensAction("insurance", "asset-add", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = insClean(params.name, 120);
    if (!name) return { ok: false, error: "asset name required" };
    const asset = {
      id: insId("ast"), name,
      kind: ["vehicle", "property", "valuable", "electronics", "jewelry", "other"]
        .includes(String(params.kind).toLowerCase()) ? String(params.kind).toLowerCase() : "other",
      value: Math.max(0, insNum(params.value)),
      policyId: params.policyId ? String(params.policyId) : null,
      serialNumber: insClean(params.serialNumber, 60) || null,
      createdAt: insNow(),
    };
    insListB(s.assets, insAid(ctx)).push(asset);
    saveInsState();
    return { ok: true, result: { asset } };
  });

  registerLensAction("insurance", "asset-list", (ctx, _a, _params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const assets = s.assets.get(insAid(ctx)) || [];
    return {
      ok: true,
      result: { assets, totalValue: Math.round(assets.reduce((a, x) => a + insNum(x.value), 0) * 100) / 100 },
    };
  });

  // ── ID card ─────────────────────────────────────────────────────────
  registerLensAction("insurance", "id-card", (ctx, _a, params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const policy = findPolicy(s, insAid(ctx), params.policyId);
    if (!policy) return { ok: false, error: "policy not found" };
    return {
      ok: true,
      result: {
        card: {
          carrier: policy.carrier,
          policyNumber: policy.policyNumber,
          kind: policy.kind,
          effectiveDate: policy.effectiveDate,
          renewalDate: policy.renewalDate,
          status: policy.status,
          deductible: policy.deductible,
          liabilityLimit: policy.liabilityLimit ?? null,
        },
      },
    };
  });

  // ── Renewals + coverage summary ─────────────────────────────────────
  registerLensAction("insurance", "renewals-due", (ctx, _a, _params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const due = (s.policies.get(insAid(ctx)) || [])
      .map((p) => ({ id: p.id, carrier: p.carrier, kind: p.kind, renewalDate: p.renewalDate, status: dueState(p.renewalDate) }))
      .filter((p) => p.status === "overdue" || p.status === "due_soon")
      .sort((a, b) => String(a.renewalDate).localeCompare(String(b.renewalDate)));
    return { ok: true, result: { due, count: due.length } };
  });

  registerLensAction("insurance", "coverage-summary", (ctx, _a, _params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const policies = (s.policies.get(insAid(ctx)) || []);
    const byKind = {};
    let totalPremium = 0;
    for (const p of policies) {
      byKind[p.kind] = (byKind[p.kind] || 0) + 1;
      if (p.status === "active") totalPremium += insNum(p.annualPremium);
    }
    return {
      ok: true,
      result: {
        policies: policies.length,
        activePolicies: policies.filter((p) => p.status === "active").length,
        totalAnnualPremium: Math.round(totalPremium * 100) / 100,
        monthlyPremium: Math.round((totalPremium / 12) * 100) / 100,
        byKind,
      },
    };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("insurance", "insurance-dashboard", (ctx, _a, _params = {}) => {
    const s = getInsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = insAid(ctx);
    const policies = s.policies.get(userId) || [];
    const claims = s.claims.get(userId) || [];
    let totalPremium = 0;
    for (const p of policies) if (p.status === "active") totalPremium += insNum(p.annualPremium);
    const reminders = s.reminders.get(userId) || [];
    return {
      ok: true,
      result: {
        activePolicies: policies.filter((p) => p.status === "active").length,
        totalPolicies: policies.length,
        openClaims: claims.filter((c) => !["paid", "closed", "denied"].includes(c.status)).length,
        annualPremium: Math.round(totalPremium * 100) / 100,
        renewalsDue: policies.filter((p) => ["overdue", "due_soon"].includes(dueState(p.renewalDate))).length,
        openReminders: reminders.filter((r) => !r.done).length,
        coveredAssetValue: Math.round((s.assets.get(userId) || []).reduce((a, x) => a + insNum(x.value), 0) * 100) / 100,
      },
    };
  });
};
