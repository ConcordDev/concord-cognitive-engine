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
    if (!STATE.insLens) STATE.insLens = { policies: new Map(), claims: new Map() };
    return STATE.insLens;
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

  registerLensAction("insurance", "quotes-compare", (_ctx, _artifact, params = {}) => {
    const kind = String(params.kind || "auto");
    const zip = String(params.zip || "");
    const coverage = ["minimum", "standard", "premium"].includes(params.coverage) ? params.coverage : "standard";
    const seed = hashStringIns(zip + kind + coverage);
    const carriers = [
      { name: "Geico", base: 0.85, rating: 4.2, sat: 8.1, score: 78 },
      { name: "Progressive", base: 0.92, rating: 4.0, sat: 7.8, score: 82 },
      { name: "State Farm", base: 1.05, rating: 4.4, sat: 8.4, score: 88 },
      { name: "Allstate", base: 1.12, rating: 4.1, sat: 7.6, score: 85 },
      { name: "USAA", base: 0.78, rating: 4.8, sat: 9.2, score: 92 },
      { name: "Liberty Mutual", base: 1.08, rating: 3.9, sat: 7.3, score: 80 },
      { name: "Farmers", base: 1.15, rating: 4.0, sat: 7.5, score: 78 },
      { name: "Nationwide", base: 1.02, rating: 4.1, sat: 7.9, score: 83 },
    ];
    const basePremium = (kind === "auto" ? 1800 : kind === "home" ? 2400 : kind === "renters" ? 200 : kind === "life" ? 600 : 850)
      * (coverage === "minimum" ? 0.6 : coverage === "premium" ? 1.5 : 1.0)
      * (0.85 + (seed % 30) / 100);
    const quotes = carriers.map((c, i) => ({
      carrier: c.name,
      annualPremium: Math.round(basePremium * c.base * (1 + ((seed + i) % 13 - 6) / 50)),
      deductible: coverage === "minimum" ? 1500 : coverage === "premium" ? 250 : 500,
      coverageScore: c.score, rating: c.rating, claimsSatisfaction: c.sat,
      highlights: c.name === "USAA" ? ["Military families only", "Highest customer satisfaction in category"]
                : c.name === "Geico" ? ["15-minute quote process", "Strong digital app"]
                : c.name === "State Farm" ? ["Largest agent network", "Strong claims handling"]
                : c.name === "Progressive" ? ["Name Your Price tool", "Snapshot usage-based discount"]
                : ["Standard coverage"],
    }));
    return { ok: true, result: { quotes, kind, zip, coverage } };
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
};

function hashStringIns(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
