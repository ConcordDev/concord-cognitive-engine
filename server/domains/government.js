export default function registerGovernmentActions(registerLensAction) {
  registerLensAction("government", "permitTimeline", (ctx, artifact, _params) => {
    const applicationDate = artifact.data?.applicationDate ? new Date(artifact.data.applicationDate) : null;
    const approvalDate = artifact.data?.approvalDate ? new Date(artifact.data.approvalDate) : null;
    let processingDays = null;
    if (applicationDate && approvalDate) {
      processingDays = Math.ceil((approvalDate - applicationDate) / (1000 * 60 * 60 * 24));
    }
    const permitType = artifact.data?.type || 'general';
    const benchmarks = { building: 30, electrical: 14, plumbing: 14, grading: 21, business: 10, general: 21 };
    const benchmark = benchmarks[permitType] || 21;
    return { ok: true, result: { permitId: artifact.id, permitType, processingDays, benchmark, onTime: processingDays !== null ? processingDays <= benchmark : null } };
  });

  registerLensAction("government", "violationEscalation", (ctx, artifact, _params) => {
    const deadline = artifact.data?.complianceDeadline ? new Date(artifact.data.complianceDeadline) : null;
    const now = new Date();
    if (!deadline) return { ok: true, result: { escalated: false, message: "No compliance deadline set" } };
    const pastDeadline = now > deadline;
    const daysPast = pastDeadline ? Math.ceil((now - deadline) / (1000 * 60 * 60 * 24)) : 0;
    if (pastDeadline && artifact.meta?.status !== 'escalated') {
      artifact.meta = { ...artifact.meta, status: 'escalated' };
      artifact.data = { ...artifact.data, escalatedAt: now.toISOString(), daysPastDeadline: daysPast };
      artifact.updatedAt = now.toISOString();
    }
    return { ok: true, result: { violationId: artifact.id, escalated: pastDeadline, daysPast, currentStatus: artifact.meta?.status } };
  });

  registerLensAction("government", "resourceStaging", (ctx, artifact, params) => {
    const zones = artifact.data?.zones || [];
    const resources = artifact.data?.resources || [];
    const threatType = artifact.data?.type || params.threatType || 'general';
    const staging = zones.map(zone => {
      const assignedResources = resources.filter(r => r.zone === zone.id || !r.zone).map(r => ({
        name: r.name, type: r.type, quantity: r.quantity || 1,
      }));
      return { zone: zone.name || zone.id, population: zone.population || 0, riskLevel: zone.riskLevel || 'medium', resources: assignedResources };
    });
    return { ok: true, result: { threatType, staging, totalZones: zones.length, totalResources: resources.length, activationLevel: artifact.data?.activationLevel || 'standby' } };
  });

  registerLensAction("government", "retentionCheck", (ctx, artifact, _params) => {
    const retentionPeriod = artifact.data?.retentionPeriod || 7;
    const createdDate = artifact.data?.date ? new Date(artifact.data.date) : new Date(artifact.createdAt);
    const now = new Date();
    const yearsHeld = (now - createdDate) / (1000 * 60 * 60 * 24 * 365);
    const pastRetention = yearsHeld >= retentionPeriod;
    const classification = artifact.data?.classification || 'public';
    return {
      ok: true,
      result: {
        recordId: artifact.id,
        retentionPeriod,
        yearsHeld: Math.round(yearsHeld * 10) / 10,
        pastRetention,
        classification,
        recommendation: pastRetention ? 'eligible_for_disposition' : 'retain',
        yearsRemaining: Math.max(0, Math.round((retentionPeriod - yearsHeld) * 10) / 10),
      },
    };
  });

  // ─── Parity-sprint macros: USA.gov / ProPublica / Resistbot / NWS ─────

  function getGovState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.govLens) STATE.govLens = { foiaRequests: new Map() };
    return STATE.govLens;
  }
  function saveStateIfAvailable() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }

  /**
   * representatives-find — by ZIP / address. Returns federal + state +
   * local reps. Seeded demo data (real impl would call Google Civic API
   * or OpenStates).
   */
  registerLensAction("government", "representatives-find", async (_ctx, _artifact, params = {}) => {
    // Federal members of Congress via api.congress.gov — official source,
    // free with API key. The current member-by-address lookup isn't in
    // the Congress.gov API directly (Google Civic was the standard, now
    // sunset), so we accept state + optional district and return all
    // current Congress members for that state.
    const apiKey = process.env.CONGRESS_GOV_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "CONGRESS_GOV_API_KEY env var required (free signup at https://api.congress.gov/sign-up/)" };
    }
    const state = String(params.state || "").trim().toUpperCase();
    if (!state || state.length !== 2) {
      return { ok: false, error: "state required as 2-letter code (e.g. CA, NY, TX)" };
    }
    try {
      const url = `https://api.congress.gov/v3/member?currentMember=true&stateCode=${state}&limit=50&format=json&api_key=${encodeURIComponent(apiKey)}`;
      const r = await globalThis.fetch(url);
      if (!r.ok) return { ok: false, error: `congress.gov ${r.status}` };
      const data = await r.json();
      const members = Array.isArray(data?.members) ? data.members : [];
      const representatives = members.map((m) => {
        const term = (m.terms?.item || [])[0] || {};
        return {
          bioguideId: m.bioguideId,
          name: m.name || `${m.firstName || ""} ${m.lastName || ""}`.trim(),
          party: m.partyName === "Democratic" ? "D" : m.partyName === "Republican" ? "R" : (m.partyName || "I").charAt(0),
          partyName: m.partyName,
          state: m.state,
          district: m.district != null ? String(m.district) : null,
          office: term.chamber === "Senate" ? "U.S. Senate" : term.chamber === "House of Representatives" ? "U.S. House" : term.chamber || "Congress",
          level: "federal",
          termStart: term.startYear ? String(term.startYear) : null,
          termEnd: term.endYear ? String(term.endYear) : null,
          imageUrl: m.depiction?.imageUrl || null,
          url: m.url || null,
        };
      });
      return {
        ok: true,
        result: {
          representatives,
          state,
          total: data?.pagination?.count ?? representatives.length,
          source: "api.congress.gov (current Congress)",
          notes: "Returns all current US House + Senate members for the given state. State + local representatives require OpenStates API (separate integration).",
        },
      };
    } catch (e) {
      return { ok: false, error: `representatives lookup failed: ${e?.message || "network"}` };
    }
  });

  /**
   * bills-list — recent congressional bills, optionally filtered by topic.
   * Live from api.congress.gov (free with API key).
   */
  registerLensAction("government", "bills-list", async (_ctx, _artifact, params = {}) => {
    const apiKey = process.env.CONGRESS_GOV_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "CONGRESS_GOV_API_KEY env var required (free signup at https://api.congress.gov/sign-up/)" };
    }
    const topic = String(params.topic || "").trim();
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 25));
    const congress = Number(params.congress) || 119; // current Congress
    try {
      const url = `https://api.congress.gov/v3/bill/${congress}?limit=${limit}&sort=updateDate+desc&format=json&api_key=${encodeURIComponent(apiKey)}`;
      const r = await globalThis.fetch(url);
      if (!r.ok) return { ok: false, error: `congress.gov ${r.status}` };
      const data = await r.json();
      let bills = (data?.bills || []).map((b) => ({
        billId: `${b.type}${b.number}-${b.congress}`,
        congress: b.congress,
        type: b.type,
        number: b.number,
        title: b.title || `${b.type}${b.number}`,
        introducedDate: b.introducedDate || null,
        latestAction: b.latestAction?.text || null,
        latestActionDate: b.latestAction?.actionDate || null,
        originChamber: b.originChamber || null,
        url: b.url || null,
      }));
      if (topic) {
        const needle = topic.toLowerCase();
        bills = bills.filter((b) => b.title.toLowerCase().includes(needle));
      }
      return {
        ok: true,
        result: {
          bills: bills.slice(0, limit),
          topic: topic || null,
          congress,
          total: data?.pagination?.count ?? bills.length,
          source: `api.congress.gov (${congress}th Congress)`,
        },
      };
    } catch (e) {
      return { ok: false, error: `bills lookup failed: ${e?.message || "network"}` };
    }
  });

  /**
   * alerts-current — Civic alerts: NWS weather, emergency, public health.
   * Uses NWS api.weather.gov free endpoint (no auth).
   */
  registerLensAction("government", "alerts-current", async (_ctx, _artifact, params = {}) => {
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (!isFinite(lat) || !isFinite(lng)) return { ok: false, error: "lat, lng required" };
    try {
      const url = `https://api.weather.gov/alerts/active?point=${lat},${lng}`;
      const r = await fetchJsonGov(url, { "user-agent": "ConcordGovLens/1.0 (concord-os.org)" });
      const features = Array.isArray(r?.features) ? r.features : [];
      const alerts = features.slice(0, 20).map(f => {
        const p = f.properties || {};
        const sev = String(p.severity || "").toLowerCase();
        return {
          id: f.id || `alert_${Math.random().toString(36).slice(2, 10)}`,
          category: "weather",
          severity: ["extreme", "severe", "moderate", "minor"].includes(sev) ? sev : "moderate",
          title: p.event || p.headline || "Weather alert",
          summary: p.description || p.instruction || "",
          area: p.areaDesc || "",
          issuedAt: p.sent || new Date().toISOString(),
          expiresAt: p.expires,
          source: "NWS",
          url: p.uri,
        };
      });
      return { ok: true, result: { alerts, source: "NWS" } };
    } catch (e) {
      return { ok: true, result: { alerts: [], source: "fallback", error: e?.message } };
    }
  });

  /**
   * foia-list / -create
   */
  registerLensAction("government", "foia-list", (ctx, _artifact, _params = {}) => {
    const state = getGovState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    return { ok: true, result: { requests: state.foiaRequests.get(userId) || [] } };
  });

  registerLensAction("government", "foia-create", (ctx, _artifact, params = {}) => {
    const state = getGovState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const agency = String(params.agency || "").trim();
    const subject = String(params.subject || "").trim();
    const body = String(params.body || "").trim();
    if (!agency || !subject || !body) return { ok: false, error: "agency, subject, body all required" };
    if (!state.foiaRequests.has(userId)) state.foiaRequests.set(userId, []);
    const req = {
      id: `foia_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agency, subject, body,
      submittedAt: new Date().toISOString(),
      status: "draft",
    };
    state.foiaRequests.get(userId).push(req);
    saveStateIfAvailable();
    return { ok: true, result: { request: req } };
  });

  /**
   * budget-breakdown — Federal / state / local budget rollup.
   */
  registerLensAction("government", "budget-breakdown", (_ctx, _artifact, params = {}) => {
    const scope = ["federal", "state", "local"].includes(params.scope) ? params.scope : "federal";
    const year = Math.max(2020, Math.min(2030, Number(params.year) || 2026));
    if (scope === "federal") {
      const totalBillions = 6800;
      const cats = [
        { name: "Social Security", amountBillions: 1420, yoyChangePct: 4.2, color: "#3b82f6" },
        { name: "Medicare", amountBillions: 870, yoyChangePct: 5.8, color: "#06b6d4" },
        { name: "Defense", amountBillions: 920, yoyChangePct: 3.1, color: "#ef4444" },
        { name: "Medicaid", amountBillions: 620, yoyChangePct: 6.5, color: "#a855f7" },
        { name: "Interest on debt", amountBillions: 870, yoyChangePct: 18.3, color: "#f59e0b" },
        { name: "Income security", amountBillions: 410, yoyChangePct: 2.1, color: "#10b981" },
        { name: "Veterans benefits", amountBillions: 320, yoyChangePct: 4.7, color: "#14b8a6" },
        { name: "Education", amountBillions: 260, yoyChangePct: -1.2, color: "#f97316" },
        { name: "Transportation", amountBillions: 130, yoyChangePct: 2.8, color: "#ec4899" },
        { name: "Everything else", amountBillions: 980, yoyChangePct: 3.5, color: "#6366f1" },
      ];
      const enriched = cats.map(c => ({ ...c, pctOfTotal: (c.amountBillions / totalBillions) * 100 }));
      return { ok: true, result: { scope, year, totalBillions, categories: enriched } };
    }
    if (scope === "state") {
      const totalBillions = 320;
      const cats = [
        { name: "K-12 Education", amountBillions: 96, yoyChangePct: 3.5, color: "#f97316" },
        { name: "Medicaid", amountBillions: 78, yoyChangePct: 6.1, color: "#a855f7" },
        { name: "Higher Education", amountBillions: 38, yoyChangePct: 1.2, color: "#06b6d4" },
        { name: "Transportation", amountBillions: 28, yoyChangePct: 4.8, color: "#ec4899" },
        { name: "Corrections", amountBillions: 18, yoyChangePct: 0.4, color: "#ef4444" },
        { name: "Public assistance", amountBillions: 22, yoyChangePct: 2.9, color: "#10b981" },
        { name: "Everything else", amountBillions: 40, yoyChangePct: 3.0, color: "#6366f1" },
      ];
      const enriched = cats.map(c => ({ ...c, pctOfTotal: (c.amountBillions / totalBillions) * 100 }));
      return { ok: true, result: { scope, year, totalBillions, categories: enriched } };
    }
    // local
    const totalBillions = 8.5;
    const cats = [
      { name: "Police", amountBillions: 1.9, yoyChangePct: 2.1, color: "#ef4444" },
      { name: "Schools", amountBillions: 2.4, yoyChangePct: 3.4, color: "#f97316" },
      { name: "Fire & EMS", amountBillions: 0.9, yoyChangePct: 1.8, color: "#f59e0b" },
      { name: "Sanitation", amountBillions: 0.5, yoyChangePct: 4.0, color: "#10b981" },
      { name: "Parks & rec", amountBillions: 0.4, yoyChangePct: -1.0, color: "#22d3ee" },
      { name: "Streets & roads", amountBillions: 0.7, yoyChangePct: 5.2, color: "#a855f7" },
      { name: "Libraries", amountBillions: 0.15, yoyChangePct: 0.5, color: "#06b6d4" },
      { name: "Pensions", amountBillions: 1.0, yoyChangePct: 4.6, color: "#6366f1" },
      { name: "Everything else", amountBillions: 0.55, yoyChangePct: 2.7, color: "#9ca3af" },
    ];
    const enriched = cats.map(c => ({ ...c, pctOfTotal: (c.amountBillions / totalBillions) * 100 }));
    return { ok: true, result: { scope, year, totalBillions, categories: enriched } };
  });
};

function hashStringGov(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

async function fetchJsonGov(url, headers = {}) {
  if (typeof fetch !== "function") throw new Error("fetch unavailable");
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ac.signal, headers });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// Note: prior versions held SAMPLE_NAMES + SAMPLE_BILLS arrays used to
// synthesize fake representatives + bills. Per the "everything must be
// real" directive, those have been removed — both macros now hit
// api.congress.gov directly with CONGRESS_GOV_API_KEY.
