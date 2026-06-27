// server/domains/insurance.js
//
// insurance lens — two surfaces on one domain:
//   • /lenses/insurance       — real-world policy/claim/agency-management
//                               workbench (policy-list, coverageGap, FNOL…).
//   • /lenses/death-insurance — sparks-only inheritance pacts
//                               (pact-write/list/revoke/claim/notifications…).
//
// REGISTRATION (saved-class fix): this file used to register through the
// legacy `registerLensAction(domain, action, (ctx, artifact, params))`
// convention AND was NEVER imported by server.js — so every `insurance.*`
// macro it defines (both lenses' entire backends) was invisible to runMacro
// and to POST /api/lens/run → every call hit unknown_macro. It is now wired
// through the canonical `register` (MACROS) registry —
// `registerInsuranceActions(register)` in server.js — so the macros are
// reachable both via POST /api/lens/run AND via runMacro (which the contract
// engine + macro-assassin drive).
//
// To keep the file's verified handler bodies byte-for-byte identical we adapt
// the canonical 2-arg `(ctx, input)` signature back to the legacy
// `(ctx, artifact, params)` shape via the `registerLensAction` shim below:
//   • `params` is the input (so `lensRun('insurance','pact-write', {...})`
//     reads the same fields it always did);
//   • `artifact` is `input.artifact` when the caller passes one (the
//     real-world analytical macros — coverageGap/lossRatioReport/… — are
//     invoked as `callMacro(name, { artifact })`), else a virtual artifact
//     wrapping the input. Identical to what `/api/lens/run` would have built.
//
// Persistence is STATE-backed (globalThis._concordSTATE) keyed by
// ctx.actor.userId, surviving restart via the debounced state-saver and
// staying per-user. Handlers return a `{ ok, result }` envelope (the
// dispatcher's `_unwrapLensEnvelope` strips the `result` layer so the
// frontend reads `r.data.result.<field>`).
//
// Fail-CLOSED numeric guard: every macro that WRITES from a numeric input
// (premium / coverage / payout / sparks) calls `badNumericField` BEFORE the
// write, rejecting NaN/Infinity/1e308/negative instead of clamping them to a
// silently-accepted row (the macro-assassin's V2 vector probes exactly this).

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) BEFORE writing.
// An absent/null field is fine (the macro uses its default). Returns null when
// clean, else the offending key. Copied from server/domains/literary.js.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input == null || input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) return k;
  }
  return null;
}

export default function registerInsuranceActions(register) {
  // Legacy-convention shim: adapt canonical register(ctx, input) → the
  // verified (ctx, artifact, params) handler bodies below, unchanged.
  const registerLensAction = (domain, action, handler) =>
    register(domain, action, (ctx, input = {}) => {
      const inp = input && typeof input === "object" ? input : {};
      const artifact = inp.artifact && typeof inp.artifact === "object"
        ? inp.artifact
        : { id: null, domain, type: "domain_action", data: inp, meta: {} };
      return handler(ctx, artifact, inp);
    });

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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
    const badNum = badNumericField(params, ["annualPremium", "deductible", "liabilityLimit"]);
    if (badNum) return { ok: false, error: `invalid_${badNum}` };
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
    const badNum = badNumericField(params, ["claimAmount"]);
    if (badNum) return { ok: false, error: `invalid_${badNum}` };
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
    const badNum = badNumericField(params, ["amount"]);
    if (badNum) return { ok: false, error: `invalid_${badNum}` };
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

  // ════════════════════════════════════════════════════════════════════
  // Inheritance-pact parity backlog (death-insurance lens)
  //
  // The /lenses/death-insurance lens writes sparks-denominated inheritance
  // pacts. The base write/revoke/list loop is SQLite-backed in server.js;
  // these macros add the feature-parity backlog — multi-beneficiary split,
  // renewal / auto-renew, recurring premium schedule, beneficiary
  // acceptance handshake, fired-payout history, and expiry/fire alerts.
  //
  // Currency: ⚡ Sparks ONLY. CC is insulated per the no-pay-to-win
  // invariant — no CC is read or written by any pact macro.
  //
  // State is STATE-backed (globalThis._concordSTATE) keyed by ctx.userId so
  // it survives restart via the debounced state-saver and stays per-user.
  // ════════════════════════════════════════════════════════════════════

  function getPactState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.inheritPacts) STATE.inheritPacts = {};
    const s = STATE.inheritPacts;
    // pacts: Map<userId, pact[]>  — pacts the user wrote
    // payouts: Map<userId, payout[]> — fired-payout history (insured side)
    if (!(s.pacts instanceof Map)) s.pacts = new Map();
    if (!(s.payouts instanceof Map)) s.payouts = new Map();
    return s;
  }
  const pactUid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const pactBucket = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const pactNow = () => Math.floor(Date.now() / 1000);
  const PACT_DAY = 86400;
  const PACT_NEW = "pct_";
  const pactId = () => PACT_NEW + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  const pactInt = (v, d = 0) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : d; };
  const pactStr = (v, max = 120) => String(v == null ? "" : v).trim().slice(0, max);

  // Normalise a free-form beneficiary list into [{userId, sharePct, accepted}]
  function normaliseBeneficiaries(raw, fallbackUserId) {
    let list = [];
    if (Array.isArray(raw) && raw.length) {
      list = raw
        .map((b) => ({
          userId: pactStr(b?.userId ?? b?.beneficiaryUserId ?? b, 80),
          sharePct: Math.max(0, Math.min(100, Number(b?.sharePct ?? b?.share ?? 0))),
        }))
        .filter((b) => b.userId);
    } else if (fallbackUserId) {
      list = [{ userId: pactStr(fallbackUserId, 80), sharePct: 100 }];
    }
    // De-dupe by userId (keep first), then re-balance shares to sum 100.
    const seen = new Set();
    list = list.filter((b) => (seen.has(b.userId) ? false : (seen.add(b.userId), true)));
    const total = list.reduce((a, b) => a + b.sharePct, 0);
    if (total <= 0 && list.length) {
      const even = Math.floor(100 / list.length);
      list.forEach((b, i) => { b.sharePct = i === list.length - 1 ? 100 - even * (list.length - 1) : even; });
    } else if (total !== 100 && list.length) {
      let acc = 0;
      list.forEach((b, i) => {
        if (i === list.length - 1) { b.sharePct = 100 - acc; }
        else { b.sharePct = Math.round((b.sharePct / total) * 100); acc += b.sharePct; }
      });
    }
    return list.map((b) => ({ userId: b.userId, sharePct: b.sharePct, accepted: false, respondedAt: null }));
  }

  function pactStatus(p) {
    if (p.status === "revoked") return "revoked";
    if (p.status === "fired") return "fired";
    if (p.expiresAt && p.expiresAt < pactNow()) return "expired";
    return "active";
  }

  // ── #1 Write a pact (multi-beneficiary split + recurring premium) ────
  registerLensAction("insurance", "pact-write", (ctx, _a, params = {}) => {
    const s = getPactState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pactUid(ctx);
    // Fail-CLOSED: reject poisoned numeric input (NaN/Infinity/1e308/negative)
    // BEFORE any write, rather than clamping it into a silently-accepted pact.
    const badNum = badNumericField(params, ["payoutSparks", "premiumSparks", "durationDays"]);
    if (badNum) return { ok: false, error: `invalid_${badNum}` };
    const payoutSparks = pactInt(params.payoutSparks);
    const premiumSparks = pactInt(params.premiumSparks);
    if (payoutSparks <= 0) return { ok: false, error: "payoutSparks must be > 0" };
    if (premiumSparks <= 0) return { ok: false, error: "premiumSparks must be > 0" };
    const durationDays = Math.max(1, pactInt(params.durationDays, 30));

    const beneficiaries = normaliseBeneficiaries(params.beneficiaries, params.beneficiaryUserId);
    if (!beneficiaries.length) return { ok: false, error: "at least one beneficiary required" };
    // Suicide-pact prevention: insured cannot be a beneficiary of their own pact.
    if (beneficiaries.some((b) => b.userId === userId)) {
      return { ok: false, error: "self_pact_blocked: beneficiary cannot equal insured" };
    }

    const freq = ["upfront", "weekly", "monthly"].includes(params.premiumFrequency)
      ? params.premiumFrequency : "upfront";
    const now = pactNow();
    const intervalDays = freq === "weekly" ? 7 : freq === "monthly" ? 30 : 0;
    const pact = {
      id: pactId(),
      insuredUserId: userId,
      beneficiaries,
      payoutSparks,
      premiumSparks,
      premiumFrequency: freq,
      autoRenew: params.autoRenew === true,
      requireHandshake: params.requireHandshake !== false,
      writtenAt: now,
      durationDays,
      expiresAt: now + durationDays * PACT_DAY,
      // payout cannot fire within 24h of write — anti-abuse guard
      armsAt: now + PACT_DAY,
      status: "active",
      renewCount: 0,
      premiumPaidSparks: freq === "upfront" ? premiumSparks : 0,
      nextPremiumDueAt: freq === "upfront" ? null : now + intervalDays * PACT_DAY,
    };
    pactBucket(s.pacts, userId).push(pact);
    saveInsState();
    return { ok: true, result: { pact } };
  });

  // ── List pacts (written + beneficiary-of) ───────────────────────────
  registerLensAction("insurance", "pact-list", (ctx, _a, _params = {}) => {
  try {
    const s = getPactState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pactUid(ctx);
    const decorate = (p) => ({ ...p, status: pactStatus(p), armed: pactNow() >= p.armsAt });

    const written = (s.pacts.get(userId) || []).map(decorate);
    const beneficiaryOf = [];
    for (const [insured, arr] of s.pacts) {
      if (insured === userId) continue;
      for (const p of arr) {
        const mine = p.beneficiaries.find((b) => b.userId === userId);
        if (!mine) continue;
        beneficiaryOf.push({
          ...decorate(p),
          myShare: { sharePct: mine.sharePct, accepted: mine.accepted, respondedAt: mine.respondedAt },
        });
      }
    }
    return {
      ok: true,
      result: {
        written: written.slice().reverse(),
        beneficiaryOf: beneficiaryOf.slice().reverse(),
        count: written.length + beneficiaryOf.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Revoke a pact (insured only) ────────────────────────────────────
  registerLensAction("insurance", "pact-revoke", (ctx, _a, params = {}) => {
    const s = getPactState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pact = (s.pacts.get(pactUid(ctx)) || []).find((p) => p.id === params.pactId);
    if (!pact) return { ok: false, error: "pact not found" };
    if (pactStatus(pact) !== "active") return { ok: false, error: "only active pacts can be revoked" };
    pact.status = "revoked";
    pact.revokedAt = pactNow();
    saveInsState();
    return { ok: true, result: { pactId: pact.id, status: "revoked" } };
  });

  // ── #2 Renewal / auto-renew ─────────────────────────────────────────
  registerLensAction("insurance", "pact-renew", (ctx, _a, params = {}) => {
    const s = getPactState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pact = (s.pacts.get(pactUid(ctx)) || []).find((p) => p.id === params.pactId);
    if (!pact) return { ok: false, error: "pact not found" };
    const badNum = badNumericField(params, ["durationDays"]);
    if (badNum) return { ok: false, error: `invalid_${badNum}` };
    const st = pactStatus(pact);
    if (st === "revoked" || st === "fired") return { ok: false, error: `cannot renew a ${st} pact` };
    const extraDays = Math.max(1, pactInt(params.durationDays, pact.durationDays));
    const base = st === "expired" ? pactNow() : pact.expiresAt;
    pact.expiresAt = base + extraDays * PACT_DAY;
    pact.durationDays = extraDays;
    pact.status = "active";
    pact.renewCount = (pact.renewCount || 0) + 1;
    pact.lastRenewedAt = pactNow();
    if (params.autoRenew != null) pact.autoRenew = params.autoRenew === true;
    saveInsState();
    return { ok: true, result: { pact: { ...pact, status: pactStatus(pact) } } };
  });

  registerLensAction("insurance", "pact-set-auto-renew", (ctx, _a, params = {}) => {
    const s = getPactState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pact = (s.pacts.get(pactUid(ctx)) || []).find((p) => p.id === params.pactId);
    if (!pact) return { ok: false, error: "pact not found" };
    pact.autoRenew = params.autoRenew === true;
    saveInsState();
    return { ok: true, result: { pactId: pact.id, autoRenew: pact.autoRenew } };
  });

  // ── #3 Recurring premium payment schedule ───────────────────────────
  registerLensAction("insurance", "pact-pay-premium", (ctx, _a, params = {}) => {
    const s = getPactState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pact = (s.pacts.get(pactUid(ctx)) || []).find((p) => p.id === params.pactId);
    if (!pact) return { ok: false, error: "pact not found" };
    if (pact.premiumFrequency === "upfront") return { ok: false, error: "this pact has an upfront premium" };
    if (pactStatus(pact) !== "active") return { ok: false, error: "pact is not active" };
    pact.premiumPaidSparks = (pact.premiumPaidSparks || 0) + pact.premiumSparks;
    pact.premiumInstallments = pact.premiumInstallments || [];
    pact.premiumInstallments.push({ amountSparks: pact.premiumSparks, paidAt: pactNow() });
    const intervalDays = pact.premiumFrequency === "weekly" ? 7 : 30;
    pact.nextPremiumDueAt = pactNow() + intervalDays * PACT_DAY;
    saveInsState();
    return {
      ok: true,
      result: {
        pactId: pact.id,
        premiumPaidSparks: pact.premiumPaidSparks,
        nextPremiumDueAt: pact.nextPremiumDueAt,
        installments: pact.premiumInstallments.length,
      },
    };
  });

  registerLensAction("insurance", "pact-premium-schedule", (ctx, _a, params = {}) => {
    const s = getPactState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pact = (s.pacts.get(pactUid(ctx)) || []).find((p) => p.id === params.pactId);
    if (!pact) return { ok: false, error: "pact not found" };
    const intervalDays = pact.premiumFrequency === "weekly" ? 7
      : pact.premiumFrequency === "monthly" ? 30 : 0;
    const installments = pact.premiumInstallments || [];
    return {
      ok: true,
      result: {
        pactId: pact.id,
        premiumFrequency: pact.premiumFrequency,
        installmentSparks: pact.premiumSparks,
        intervalDays,
        premiumPaidSparks: pact.premiumPaidSparks || (pact.premiumFrequency === "upfront" ? pact.premiumSparks : 0),
        installments,
        nextPremiumDueAt: pact.nextPremiumDueAt,
        nextPremiumOverdue: pact.nextPremiumDueAt != null && pact.nextPremiumDueAt < pactNow(),
      },
    };
  });

  // ── #4 Beneficiary acceptance handshake ─────────────────────────────
  function findPactByIdAnyOwner(s, pactId) {
    for (const arr of s.pacts.values()) {
      const p = arr.find((x) => x.id === pactId);
      if (p) return p;
    }
    return null;
  }

  registerLensAction("insurance", "pact-respond", (ctx, _a, params = {}) => {
    const s = getPactState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pactUid(ctx);
    const pact = findPactByIdAnyOwner(s, params.pactId);
    if (!pact) return { ok: false, error: "pact not found" };
    const mine = pact.beneficiaries.find((b) => b.userId === userId);
    if (!mine) return { ok: false, error: "you are not a beneficiary of this pact" };
    const accept = params.accept !== false;
    mine.accepted = accept;
    mine.respondedAt = pactNow();
    saveInsState();
    return {
      ok: true,
      result: {
        pactId: pact.id,
        accepted: mine.accepted,
        allAccepted: pact.beneficiaries.every((b) => b.accepted),
      },
    };
  });

  // ── #5 Fired-payout history log ─────────────────────────────────────
  // Records a pact firing (insured fell in Concordia) and splits the
  // sparks payout across all (accepted, when handshake required)
  // beneficiaries by share percentage. Idempotent on pactId.
  registerLensAction("insurance", "pact-record-payout", (ctx, _a, params = {}) => {
  try {
    const s = getPactState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pactUid(ctx);
    const pact = (s.pacts.get(userId) || []).find((p) => p.id === params.pactId);
    if (!pact) return { ok: false, error: "pact not found" };
    if (pact.status === "fired") return { ok: false, error: "pact already fired" };
    const st = pactStatus(pact);
    if (st === "revoked") return { ok: false, error: "cannot fire a revoked pact" };
    if (st === "expired") return { ok: false, error: "cannot fire an expired pact" };
    if (pactNow() < pact.armsAt) return { ok: false, error: "payout cannot fire within 24h of write" };

    const eligible = pact.beneficiaries.filter((b) => !pact.requireHandshake || b.accepted);
    if (!eligible.length) {
      return { ok: false, error: "no beneficiary has accepted the handshake" };
    }
    const eligibleShare = eligible.reduce((a, b) => a + b.sharePct, 0) || 1;
    let acc = 0;
    const splits = eligible.map((b, i) => {
      const sparks = i === eligible.length - 1
        ? pact.payoutSparks - acc
        : Math.round((b.sharePct / eligibleShare) * pact.payoutSparks);
      acc += sparks;
      return { userId: b.userId, sharePct: b.sharePct, sparks };
    });
    const payout = {
      id: pactId(),
      pactId: pact.id,
      cause: pactStr(params.cause, 80) || "fell in Concordia",
      firedAt: pactNow(),
      totalSparks: pact.payoutSparks,
      splits,
    };
    pact.status = "fired";
    pact.firedAt = payout.firedAt;
    pactBucket(s.payouts, userId).push(payout);
    saveInsState();
    return { ok: true, result: { payout } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("insurance", "pact-payout-history", (ctx, _a, _params = {}) => {
    const s = getPactState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pactUid(ctx);
    // Payouts from pacts the user wrote.
    const paidOut = (s.payouts.get(userId) || []).slice().reverse();
    // Payouts the user received a split from.
    const received = [];
    for (const [insured, arr] of s.payouts) {
      for (const po of arr) {
        const split = po.splits.find((sp) => sp.userId === userId);
        if (split) received.push({ ...po, insuredUserId: insured, mySparks: split.sparks, mySharePct: split.sharePct });
      }
    }
    return {
      ok: true,
      result: {
        paidOut,
        received: received.slice().reverse(),
        totalPaidOutSparks: paidOut.reduce((a, p) => a + p.totalSparks, 0),
        totalReceivedSparks: received.reduce((a, p) => a + p.mySparks, 0),
      },
    };
  });

  // ── #6 Expiry / fire / premium-due notifications ────────────────────
  registerLensAction("insurance", "pact-notifications", (ctx, _a, params = {}) => {
  try {
    const s = getPactState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pactUid(ctx);
    const badNum = badNumericField(params, ["windowDays"]);
    if (badNum) return { ok: false, error: `invalid_${badNum}` };
    const windowDays = Math.max(1, pactInt(params.windowDays, 7));
    const now = pactNow();
    const horizon = now + windowDays * PACT_DAY;
    const notes = [];

    const written = s.pacts.get(userId) || [];
    for (const p of written) {
      const st = pactStatus(p);
      if (st === "active" && p.expiresAt <= horizon) {
        notes.push({
          kind: "expiring", pactId: p.id, severity: p.expiresAt - now < PACT_DAY ? "high" : "medium",
          at: p.expiresAt, autoRenew: p.autoRenew,
          message: `Pact ${p.id} ${p.autoRenew ? "will auto-renew" : "expires"} ${new Date(p.expiresAt * 1000).toLocaleDateString()}`,
        });
      }
      if (st === "active" && p.premiumFrequency !== "upfront" && p.nextPremiumDueAt != null && p.nextPremiumDueAt <= horizon) {
        notes.push({
          kind: "premium_due", pactId: p.id,
          severity: p.nextPremiumDueAt < now ? "high" : "medium",
          at: p.nextPremiumDueAt,
          message: `${p.premiumSparks} ⚡ ${p.premiumFrequency} premium ${p.nextPremiumDueAt < now ? "overdue" : "due"} on pact ${p.id}`,
        });
      }
      if (st === "active" && p.requireHandshake && p.beneficiaries.some((b) => !b.accepted)) {
        const pending = p.beneficiaries.filter((b) => !b.accepted).length;
        notes.push({
          kind: "handshake_pending", pactId: p.id, severity: "low", at: p.writtenAt,
          message: `${pending} beneficiar${pending === 1 ? "y" : "ies"} have not yet accepted pact ${p.id}`,
        });
      }
    }
    // Pacts where the caller is a beneficiary and has not responded.
    for (const [insured, arr] of s.pacts) {
      if (insured === userId) continue;
      for (const p of arr) {
        if (pactStatus(p) !== "active") continue;
        const mine = p.beneficiaries.find((b) => b.userId === userId);
        if (mine && !mine.accepted && mine.respondedAt == null) {
          notes.push({
            kind: "handshake_request", pactId: p.id, severity: "medium", at: p.writtenAt,
            message: `${insured} named you beneficiary of a ${p.payoutSparks} ⚡ pact — accept or decline`,
          });
        }
      }
    }
    // Payouts that fired in the window.
    for (const [insured, arr] of s.payouts) {
      for (const po of arr) {
        if (po.firedAt < now - windowDays * PACT_DAY) continue;
        if (insured === userId) {
          notes.push({ kind: "fired", pactId: po.pactId, severity: "high", at: po.firedAt,
            message: `Pact ${po.pactId} fired — ${po.totalSparks} ⚡ paid out` });
        }
        const split = po.splits.find((sp) => sp.userId === userId);
        if (split && insured !== userId) {
          notes.push({ kind: "payout_received", pactId: po.pactId, severity: "high", at: po.firedAt,
            message: `You inherited ${split.sparks} ⚡ from ${insured}` });
        }
      }
    }
    notes.sort((a, b) => b.at - a.at);
    return {
      ok: true,
      result: {
        notifications: notes,
        count: notes.length,
        unreadHigh: notes.filter((n) => n.severity === "high").length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ════════════════════════════════════════════════════════════════════
  // Feature-parity backlog — Applied Epic / EZLynx agency-management
  // gaps. All STATE-backed per ctx.userId; no synthetic data — every
  // value is real user input or computed from real input/platform state.
  // ════════════════════════════════════════════════════════════════════

  function getAmsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.insAms) STATE.insAms = {};
    const s = STATE.insAms;
    for (const k of [
      "carriers", "renewalPipeline", "fnol", "statements",
      "certificates", "envelopes",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }

  // ── #1 Carrier rating / quote bridge ────────────────────────────────
  // The user maintains their OWN carrier roster + appointment terms.
  // Comparative rating against a carrier roster is a real computation;
  // it requires NO external API because the inputs are the user's own
  // appointed carriers and the prospect risk profile they enter.
  registerLensAction("insurance", "carrier-add", (ctx, _a, params = {}) => {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = insClean(params.name, 120);
    if (!name) return { ok: false, error: "carrier name required" };
    const carrier = {
      id: insId("car"), name,
      amBestRating: insClean(params.amBestRating, 8) || null,
      naicNumber: insClean(params.naicNumber, 20) || null,
      appointed: params.appointed !== false,
      lines: Array.isArray(params.lines)
        ? params.lines.map((l) => insClean(l, 30).toLowerCase()).filter(Boolean).slice(0, 12)
        : [],
      baseCommissionPct: Math.max(0, Math.min(100, insNum(params.baseCommissionPct))),
      // user-provided relative rate index for their book (1.0 = market avg)
      rateIndex: params.rateIndex != null ? Math.max(0.1, insNum(params.rateIndex, 1)) : 1,
      claimsServiceScore: Math.max(0, Math.min(10, insNum(params.claimsServiceScore))),
      createdAt: insNow(),
    };
    insListB(s.carriers, insAid(ctx)).push(carrier);
    saveInsState();
    return { ok: true, result: { carrier } };
  });

  registerLensAction("insurance", "carrier-list", (ctx, _a, _params = {}) => {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { carriers: s.carriers.get(insAid(ctx)) || [] } };
  });

  registerLensAction("insurance", "carrier-delete", (ctx, _a, params = {}) => {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.carriers.get(insAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "carrier not found" };
    arr.splice(i, 1);
    saveInsState();
    return { ok: true, result: { deleted: params.id } };
  });

  // Comparative rate run: scores each appointed carrier that writes the
  // requested line against the prospect's own base premium estimate.
  registerLensAction("insurance", "carrier-rate", (ctx, _a, params = {}) => {
  try {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const line = insClean(params.line, 30).toLowerCase();
    if (!line) return { ok: false, error: "line required (auto, home, life…)" };
    const badNum = badNumericField(params, ["basePremium", "riskFactor"]);
    if (badNum) return { ok: false, error: `invalid_${badNum}` };
    const basePremium = Math.max(0, insNum(params.basePremium));
    if (basePremium <= 0) return { ok: false, error: "basePremium must be > 0 — your underwriting estimate" };
    const riskFactor = Math.max(0.5, Math.min(3, insNum(params.riskFactor, 1)));
    const carriers = (s.carriers.get(insAid(ctx)) || [])
      .filter((c) => c.appointed && (c.lines.length === 0 || c.lines.includes(line)));
    if (!carriers.length) {
      return {
        ok: false,
        error: "No appointed carrier writes this line. Add carriers with carrier-add first.",
      };
    }
    const rows = carriers.map((c) => {
      const annualPremium = Math.round(basePremium * (c.rateIndex || 1) * riskFactor * 100) / 100;
      const commission = Math.round(annualPremium * ((c.baseCommissionPct || 0) / 100) * 100) / 100;
      // composite fit: price weight 0.6, service 0.25, rating present 0.15
      const priceScore = 100 - Math.min(100, ((c.rateIndex || 1) - 0.6) * 120);
      const serviceScore = (c.claimsServiceScore || 0) * 10;
      const ratingScore = c.amBestRating ? 100 : 50;
      const fitScore = Math.round(
        Math.max(0, priceScore) * 0.6 + serviceScore * 0.25 + ratingScore * 0.15,
      );
      return {
        carrierId: c.id, carrier: c.name, amBestRating: c.amBestRating,
        annualPremium, commission,
        commissionPct: c.baseCommissionPct || 0,
        claimsServiceScore: c.claimsServiceScore || 0,
        fitScore,
      };
    }).sort((a, b) => a.annualPremium - b.annualPremium);
    const cheapest = rows[0]?.annualPremium || 0;
    const dearest = rows[rows.length - 1]?.annualPremium || 0;
    const bestFit = [...rows].sort((a, b) => b.fitScore - a.fitScore)[0] || null;
    return {
      ok: true,
      result: {
        line, basePremium, riskFactor,
        quotes: rows,
        cheapest, spread: Math.round((dearest - cheapest) * 100) / 100,
        bestPrice: rows[0] || null,
        bestFit,
        carrierCount: rows.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── #2 Policy renewal automation ────────────────────────────────────
  // Builds a renewal pipeline from the user's real policies, generating
  // a renewal-quote shell + reminder schedule per upcoming expiry.
  registerLensAction("insurance", "renewal-pipeline-build", (ctx, _a, params = {}) => {
  try {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ins = getInsState(); if (!ins) return { ok: false, error: "STATE unavailable" };
    const userId = insAid(ctx);
    const horizonDays = Math.max(1, Math.min(365, insNum(params.horizonDays, 90)));
    const horizon = Date.now() + horizonDays * INS_DAY;
    const policies = (ins.policies.get(userId) || []).filter((p) => p.status === "active");
    const pipeline = [];
    for (const p of policies) {
      if (!p.renewalDate) continue;
      const t = new Date(p.renewalDate + "T00:00:00Z").getTime();
      if (isNaN(t) || t > horizon) continue;
      const daysUntil = Math.floor((t - Date.now()) / INS_DAY);
      // proposed renewal premium: carry the current premium; rate change
      // is applied only when the user supplies one (no fabricated uplift).
      const ratePct = insNum(params.defaultRateChangePct, 0);
      const proposedPremium = Math.round(p.annualPremium * (1 + ratePct / 100) * 100) / 100;
      pipeline.push({
        id: insId("rnw"),
        policyId: p.id, carrier: p.carrier, kind: p.kind,
        policyNumber: p.policyNumber,
        currentPremium: p.annualPremium,
        proposedPremium,
        rateChangePct: ratePct,
        renewalDate: p.renewalDate,
        daysUntil,
        stage: daysUntil < 0 ? "lapsed" : "to_quote",
        remarketing: false,
        reminders: [
          { at: insDay(new Date(t - 45 * INS_DAY).toISOString()), label: "Begin renewal review" },
          { at: insDay(new Date(t - 21 * INS_DAY).toISOString()), label: "Send renewal proposal" },
          { at: insDay(new Date(t - 7 * INS_DAY).toISOString()), label: "Confirm renewal / bind" },
        ],
        createdAt: insNow(),
      });
    }
    s.renewalPipeline.set(userId, pipeline);
    saveInsState();
    return {
      ok: true,
      result: {
        pipeline: pipeline.sort((a, b) => a.daysUntil - b.daysUntil),
        count: pipeline.length,
        premiumAtRisk: Math.round(pipeline.reduce((a, r) => a + r.currentPremium, 0) * 100) / 100,
        lapsed: pipeline.filter((r) => r.stage === "lapsed").length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("insurance", "renewal-pipeline-list", (ctx, _a, _params = {}) => {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pipeline = (s.renewalPipeline.get(insAid(ctx)) || [])
      .slice().sort((a, b) => a.daysUntil - b.daysUntil);
    const byStage = {};
    for (const r of pipeline) byStage[r.stage] = (byStage[r.stage] || 0) + 1;
    return { ok: true, result: { pipeline, count: pipeline.length, byStage } };
  });

  registerLensAction("insurance", "renewal-advance", (ctx, _a, params = {}) => {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.renewalPipeline.get(insAid(ctx)) || [];
    const item = arr.find((r) => r.id === params.id);
    if (!item) return { ok: false, error: "renewal item not found" };
    const stages = ["to_quote", "quoted", "proposed", "bound", "lapsed"];
    if (params.stage != null && stages.includes(params.stage)) {
      item.stage = params.stage;
    } else {
      const i = stages.indexOf(item.stage);
      item.stage = stages[Math.min(i + 1, 3)];
    }
    if (params.proposedPremium != null) {
      item.proposedPremium = Math.max(0, insNum(params.proposedPremium));
      item.rateChangePct = item.currentPremium > 0
        ? Math.round(((item.proposedPremium - item.currentPremium) / item.currentPremium) * 1000) / 10
        : 0;
    }
    if (params.remarketing != null) item.remarketing = params.remarketing === true;
    saveInsState();
    return { ok: true, result: { renewal: item } };
  });

  // ── #3 Claims FNOL intake + adjuster routing ────────────────────────
  registerLensAction("insurance", "fnol-intake", (ctx, _a, params = {}) => {
  try {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ins = getInsState(); if (!ins) return { ok: false, error: "STATE unavailable" };
    const userId = insAid(ctx);
    const description = insClean(params.description, 600);
    if (!description) return { ok: false, error: "loss description required" };
    const lossType = insClean(params.lossType, 40).toLowerCase() || "other";
    const policy = params.policyId ? findPolicy(ins, userId, params.policyId) : null;
    const estLoss = Math.max(0, insNum(params.estimatedLoss));
    // Severity tier drives routing: catastrophic / large / standard / fast-track.
    const injuries = params.injuries === true;
    let severity = "standard";
    if (injuries || estLoss >= 100000) severity = "catastrophic";
    else if (estLoss >= 25000) severity = "large_loss";
    else if (estLoss > 0 && estLoss < 2500) severity = "fast_track";
    const queue = { catastrophic: "major_loss_unit", large_loss: "complex_claims",
      fast_track: "express_claims", standard: "general_claims" }[severity];
    // Adjuster assignment routes to a user-defined adjuster list if given.
    const pool = Array.isArray(params.adjusters)
      ? params.adjusters.map((x) => insClean(x, 80)).filter(Boolean) : [];
    const fnolList = ins.claims.get(userId) || [];
    const assigned = pool.length ? pool[fnolList.length % pool.length] : null;
    const fnol = {
      id: insId("fnol"),
      policyId: policy ? policy.id : (params.policyId ? String(params.policyId) : null),
      carrier: policy ? policy.carrier : insClean(params.carrier, 120) || null,
      description, lossType,
      lossDate: insDay(params.lossDate) || insDay(insNow()),
      reportedAt: insNow(),
      location: insClean(params.location, 200) || null,
      injuries,
      estimatedLoss: estLoss,
      severity, routedTo: queue,
      assignedAdjuster: assigned,
      reservesSet: 0,
      sla: { contactByHours: severity === "catastrophic" ? 4 : severity === "fast_track" ? 48 : 24 },
      status: "open",
      timeline: [{ at: insNow(), event: "FNOL received", actor: "intake" }],
    };
    if (assigned) fnol.timeline.push({ at: insNow(), event: `Routed to ${assigned} (${queue})`, actor: "router" });
    insListB(s.fnol, userId).push(fnol);
    saveInsState();
    return { ok: true, result: { fnol } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("insurance", "fnol-list", (ctx, _a, _params = {}) => {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const fnol = (s.fnol.get(insAid(ctx)) || []).slice().reverse();
    const byQueue = {};
    for (const f of fnol) byQueue[f.routedTo] = (byQueue[f.routedTo] || 0) + 1;
    return {
      ok: true,
      result: {
        fnol, count: fnol.length, byQueue,
        open: fnol.filter((f) => f.status === "open").length,
        totalReserves: Math.round(fnol.reduce((a, f) => a + insNum(f.reservesSet), 0) * 100) / 100,
      },
    };
  });

  registerLensAction("insurance", "fnol-update", (ctx, _a, params = {}) => {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const fnol = (s.fnol.get(insAid(ctx)) || []).find((f) => f.id === params.id);
    if (!fnol) return { ok: false, error: "FNOL not found" };
    if (params.assignedAdjuster != null) {
      fnol.assignedAdjuster = insClean(params.assignedAdjuster, 80) || null;
      fnol.timeline.push({ at: insNow(), event: `Adjuster set: ${fnol.assignedAdjuster}`, actor: "router" });
    }
    if (params.reservesSet != null) {
      fnol.reservesSet = Math.max(0, insNum(params.reservesSet));
      fnol.timeline.push({ at: insNow(), event: `Reserves set to ${fnol.reservesSet}`, actor: "adjuster" });
    }
    if (params.status != null && ["open", "investigating", "estimating", "settled", "closed", "denied"].includes(params.status)) {
      fnol.status = params.status;
      fnol.timeline.push({ at: insNow(), event: `Status → ${params.status}`, actor: "adjuster" });
    }
    saveInsState();
    return { ok: true, result: { fnol } };
  });

  // ── #4 Commission reconciliation against carrier statements ─────────
  registerLensAction("insurance", "statement-import", (ctx, _a, params = {}) => {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const carrier = insClean(params.carrier, 120);
    if (!carrier) return { ok: false, error: "carrier required" };
    const lines = Array.isArray(params.lines) ? params.lines : [];
    if (!lines.length) return { ok: false, error: "statement lines required" };
    const norm = lines.map((l) => ({
      policyNumber: insClean(l.policyNumber, 60),
      premium: Math.max(0, insNum(l.premium)),
      commission: Math.max(0, insNum(l.commission)),
    })).filter((l) => l.policyNumber);
    const statement = {
      id: insId("stmt"), carrier,
      period: insClean(params.period, 30) || insDay(insNow()).slice(0, 7),
      lines: norm,
      statedTotal: Math.round(norm.reduce((a, l) => a + l.commission, 0) * 100) / 100,
      importedAt: insNow(),
      reconciled: false,
    };
    insListB(s.statements, insAid(ctx)).push(statement);
    saveInsState();
    return { ok: true, result: { statement } };
  });

  registerLensAction("insurance", "statement-list", (ctx, _a, _params = {}) => {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return {
      ok: true,
      result: { statements: (s.statements.get(insAid(ctx)) || []).slice().reverse() },
    };
  });

  // Reconcile a statement against the user's expected commission, computed
  // from their real policies (annualPremium × policy-level commission rate
  // supplied per policy or via params.expectedRatePct).
  registerLensAction("insurance", "statement-reconcile", (ctx, _a, params = {}) => {
  try {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ins = getInsState(); if (!ins) return { ok: false, error: "STATE unavailable" };
    const userId = insAid(ctx);
    const statement = (s.statements.get(userId) || []).find((st) => st.id === params.statementId);
    if (!statement) return { ok: false, error: "statement not found" };
    const ratePct = Math.max(0, Math.min(100, insNum(params.expectedRatePct, 0)));
    const policies = ins.policies.get(userId) || [];
    const polByNumber = new Map(policies.map((p) => [p.policyNumber, p]));
    const matchedRows = [], unmatchedRows = [], discrepancyRows = [];
    let statedTotal = 0, expectedTotal = 0;
    for (const line of statement.lines) {
      const pol = polByNumber.get(line.policyNumber);
      if (!pol) {
        unmatchedRows.push({ ...line, reason: "no_policy_on_file" });
        continue;
      }
      // statedTotal/expectedTotal compare only matched lines — an unmatched
      // line has no expected counterpart so it would skew the net variance.
      statedTotal += line.commission;
      const expected = Math.round(
        (pol.annualPremium || line.premium) * (ratePct / 100) * 100,
      ) / 100;
      expectedTotal += expected;
      const variance = Math.round((line.commission - expected) * 100) / 100;
      const row = {
        policyNumber: line.policyNumber, carrier: statement.carrier,
        statedCommission: line.commission, expectedCommission: expected, variance,
      };
      matchedRows.push(row);
      if (Math.abs(variance) >= 0.01) discrepancyRows.push(row);
    }
    const summary = {
      ratePct,
      matched: matchedRows.length,
      unmatched: unmatchedRows.length,
      discrepancies: discrepancyRows.length,
      statedTotal: Math.round(statedTotal * 100) / 100,
      expectedTotal: Math.round(expectedTotal * 100) / 100,
      netVariance: Math.round((statedTotal - expectedTotal) * 100) / 100,
    };
    statement.reconciled = true;
    statement.reconciledAt = insNow();
    statement.reconciliation = summary;
    saveInsState();
    return {
      ok: true,
      result: {
        statementId: statement.id,
        ...summary,
        matchedRows, unmatchedRows, discrepancyRows,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── #5 Certificate of insurance / ACORD form export ─────────────────
  registerLensAction("insurance", "certificate-issue", (ctx, _a, params = {}) => {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ins = getInsState(); if (!ins) return { ok: false, error: "STATE unavailable" };
    const userId = insAid(ctx);
    const policy = findPolicy(ins, userId, params.policyId);
    if (!policy) return { ok: false, error: "policy not found" };
    const holder = insClean(params.certificateHolder, 200);
    if (!holder) return { ok: false, error: "certificateHolder required" };
    const form = ["ACORD_25", "ACORD_27", "ACORD_28"].includes(params.formType)
      ? params.formType : "ACORD_25";
    const cert = {
      id: insId("coi"),
      formType: form,
      policyId: policy.id, policyNumber: policy.policyNumber,
      carrier: policy.carrier, lineOfBusiness: policy.kind,
      insured: insClean(params.insuredName, 200) || null,
      certificateHolder: holder,
      description: insClean(params.description, 400) || null,
      coverages: {
        effectiveDate: policy.effectiveDate,
        expiryDate: policy.renewalDate,
        eachOccurrence: policy.liabilityLimit ?? null,
        deductible: policy.deductible ?? null,
      },
      additionalInsured: params.additionalInsured === true,
      issuedAt: insNow(),
      revoked: false,
    };
    insListB(s.certificates, userId).push(cert);
    saveInsState();
    return { ok: true, result: { certificate: cert } };
  });

  registerLensAction("insurance", "certificate-list", (ctx, _a, _params = {}) => {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return {
      ok: true,
      result: { certificates: (s.certificates.get(insAid(ctx)) || []).slice().reverse() },
    };
  });

  // Render an ACORD-shaped plain-text form from a real certificate record.
  registerLensAction("insurance", "certificate-export", (ctx, _a, params = {}) => {
  try {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const cert = (s.certificates.get(insAid(ctx)) || []).find((c) => c.id === params.id);
    if (!cert) return { ok: false, error: "certificate not found" };
    const L = [];
    L.push(`${cert.formType.replace("_", " ")} — CERTIFICATE OF LIABILITY INSURANCE`);
    L.push(`Issued: ${cert.issuedAt}`);
    L.push("");
    L.push(`INSURED: ${cert.insured || "(not specified)"}`);
    L.push(`CARRIER: ${cert.carrier}`);
    L.push(`POLICY NUMBER: ${cert.policyNumber}`);
    L.push(`LINE OF BUSINESS: ${cert.lineOfBusiness}`);
    L.push(`POLICY EFFECTIVE: ${cert.coverages.effectiveDate}  EXPIRES: ${cert.coverages.expiryDate}`);
    if (cert.coverages.eachOccurrence != null) L.push(`EACH OCCURRENCE LIMIT: ${cert.coverages.eachOccurrence}`);
    if (cert.coverages.deductible != null) L.push(`DEDUCTIBLE: ${cert.coverages.deductible}`);
    L.push("");
    L.push(`CERTIFICATE HOLDER: ${cert.certificateHolder}`);
    if (cert.additionalInsured) L.push("CERTIFICATE HOLDER IS NAMED AS ADDITIONAL INSURED.");
    if (cert.description) L.push(`DESCRIPTION OF OPERATIONS: ${cert.description}`);
    L.push("");
    L.push("Should the above-described policy be cancelled before the expiration date,");
    L.push("notice will be delivered in accordance with the policy provisions.");
    return {
      ok: true,
      result: {
        certificateId: cert.id, formType: cert.formType,
        text: L.join("\n"),
        filename: `${cert.formType}_${cert.policyNumber}.txt`,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("insurance", "certificate-revoke", (ctx, _a, params = {}) => {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const cert = (s.certificates.get(insAid(ctx)) || []).find((c) => c.id === params.id);
    if (!cert) return { ok: false, error: "certificate not found" };
    cert.revoked = true;
    cert.revokedAt = insNow();
    saveInsState();
    return { ok: true, result: { certificateId: cert.id, revoked: true } };
  });

  // ── #6 Producer / book-of-business performance leaderboard ──────────
  registerLensAction("insurance", "book-of-business", (ctx, _a, _params = {}) => {
  try {
    const ins = getInsState(); if (!ins) return { ok: false, error: "STATE unavailable" };
    const userId = insAid(ctx);
    const policies = ins.policies.get(userId) || [];
    const claims = ins.claims.get(userId) || [];
    const active = policies.filter((p) => p.status === "active");
    const writtenPremium = Math.round(active.reduce((a, p) => a + insNum(p.annualPremium), 0) * 100) / 100;
    const byKind = {};
    for (const p of active) {
      if (!byKind[p.kind]) byKind[p.kind] = { count: 0, premium: 0 };
      byKind[p.kind].count++;
      byKind[p.kind].premium += insNum(p.annualPremium);
    }
    const lines = Object.entries(byKind).map(([kind, v]) => ({
      kind, policies: v.count,
      premium: Math.round(v.premium * 100) / 100,
      sharePct: writtenPremium > 0 ? Math.round((v.premium / writtenPremium) * 1000) / 10 : 0,
    })).sort((a, b) => b.premium - a.premium);
    const paidClaims = claims.filter((c) => ["paid", "closed"].includes(c.status));
    const incurred = paidClaims.reduce((a, c) => a + insNum(c.payoutAmount || c.claimAmount), 0);
    return {
      ok: true,
      result: {
        totalPolicies: policies.length,
        activePolicies: active.length,
        writtenPremium,
        avgPremium: active.length ? Math.round((writtenPremium / active.length) * 100) / 100 : 0,
        lossRatio: writtenPremium > 0 ? Math.round((incurred / writtenPremium) * 1000) / 10 : 0,
        retentionRate: policies.length
          ? Math.round((active.length / policies.length) * 1000) / 10 : 0,
        lineMix: lines,
        topLine: lines[0] || null,
        openClaims: claims.filter((c) => !["paid", "closed", "denied"].includes(c.status)).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // Producer leaderboard: ranks the user's own carriers by premium placed
  // and commission earned — a real book metric, no fabricated peers.
  registerLensAction("insurance", "producer-leaderboard", (ctx, _a, params = {}) => {
  try {
    const ins = getInsState(); if (!ins) return { ok: false, error: "STATE unavailable" };
    const userId = insAid(ctx);
    const dim = ["carrier", "kind"].includes(params.dimension) ? params.dimension : "carrier";
    const policies = (ins.policies.get(userId) || []).filter((p) => p.status === "active");
    const ratePct = Math.max(0, Math.min(100, insNum(params.commissionRatePct, 0)));
    const groups = {};
    for (const p of policies) {
      const key = dim === "carrier" ? p.carrier : p.kind;
      if (!groups[key]) groups[key] = { name: key, policies: 0, premium: 0 };
      groups[key].policies++;
      groups[key].premium += insNum(p.annualPremium);
    }
    const rows = Object.values(groups).map((g) => ({
      name: g.name, policies: g.policies,
      premium: Math.round(g.premium * 100) / 100,
      estCommission: Math.round(g.premium * (ratePct / 100) * 100) / 100,
    })).sort((a, b) => b.premium - a.premium)
      .map((r, i) => ({ rank: i + 1, ...r }));
    return {
      ok: true,
      result: {
        dimension: dim, leaderboard: rows,
        totalPremium: Math.round(rows.reduce((a, r) => a + r.premium, 0) * 100) / 100,
        totalEstCommission: Math.round(rows.reduce((a, r) => a + r.estCommission, 0) * 100) / 100,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── #7 Document e-signature + binder issuance ───────────────────────
  registerLensAction("insurance", "esign-create", (ctx, _a, params = {}) => {
  try {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ins = getInsState(); if (!ins) return { ok: false, error: "STATE unavailable" };
    const userId = insAid(ctx);
    const title = insClean(params.title, 160);
    if (!title) return { ok: false, error: "document title required" };
    const signers = (Array.isArray(params.signers) ? params.signers : [])
      .map((sg) => ({
        name: insClean(sg.name, 120),
        email: insClean(sg.email, 160) || null,
        role: insClean(sg.role, 40).toLowerCase() || "signer",
        signed: false, signedAt: null,
      }))
      .filter((sg) => sg.name);
    if (!signers.length) return { ok: false, error: "at least one signer required" };
    const policy = params.policyId ? findPolicy(ins, userId, params.policyId) : null;
    const envelope = {
      id: insId("env"),
      title,
      docType: insClean(params.docType, 40).toLowerCase() || "application",
      policyId: policy ? policy.id : null,
      signers,
      status: "sent",
      binderIssued: false,
      createdAt: insNow(),
      audit: [{ at: insNow(), event: "Envelope sent for signature" }],
    };
    insListB(s.envelopes, userId).push(envelope);
    saveInsState();
    return { ok: true, result: { envelope } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("insurance", "esign-list", (ctx, _a, _params = {}) => {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return {
      ok: true,
      result: { envelopes: (s.envelopes.get(insAid(ctx)) || []).slice().reverse() },
    };
  });

  registerLensAction("insurance", "esign-sign", (ctx, _a, params = {}) => {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const env = (s.envelopes.get(insAid(ctx)) || []).find((e) => e.id === params.id);
    if (!env) return { ok: false, error: "envelope not found" };
    if (env.status === "voided") return { ok: false, error: "envelope is voided" };
    const signerName = insClean(params.signerName, 120);
    const signer = env.signers.find((sg) => sg.name === signerName);
    if (!signer) return { ok: false, error: "signer not found on envelope" };
    if (signer.signed) return { ok: false, error: "signer has already signed" };
    signer.signed = true;
    signer.signedAt = insNow();
    env.audit.push({ at: insNow(), event: `${signer.name} signed` });
    if (env.signers.every((sg) => sg.signed)) {
      env.status = "completed";
      env.completedAt = insNow();
      env.audit.push({ at: insNow(), event: "All parties signed — envelope completed" });
    }
    saveInsState();
    return {
      ok: true,
      result: {
        envelopeId: env.id, status: env.status,
        signedCount: env.signers.filter((sg) => sg.signed).length,
        totalSigners: env.signers.length,
      },
    };
  });

  // Binder: a temporary proof of coverage. Issuable only once an
  // application envelope is fully signed.
  registerLensAction("insurance", "binder-issue", (ctx, _a, params = {}) => {
    const s = getAmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const env = (s.envelopes.get(insAid(ctx)) || []).find((e) => e.id === params.envelopeId);
    if (!env) return { ok: false, error: "envelope not found" };
    if (env.status !== "completed") {
      return { ok: false, error: "all signers must sign before a binder can issue" };
    }
    if (env.binderIssued) return { ok: false, error: "binder already issued" };
    const termDays = Math.max(1, Math.min(90, insNum(params.termDays, 30)));
    const binder = {
      id: insId("bnd"),
      envelopeId: env.id,
      carrier: insClean(params.carrier, 120) || null,
      coverageSummary: insClean(params.coverageSummary, 400) || env.title,
      effectiveDate: insDay(params.effectiveDate) || insDay(insNow()),
      expiryDate: insDay(new Date(Date.now() + termDays * INS_DAY).toISOString()),
      termDays,
      issuedAt: insNow(),
    };
    env.binderIssued = true;
    env.binder = binder;
    env.audit.push({ at: insNow(), event: `Binder issued — ${termDays}-day term` });
    saveInsState();
    return { ok: true, result: { binder } };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("insurance", "insurance-dashboard", (ctx, _a, _params = {}) => {
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
};
