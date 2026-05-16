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
  registerLensAction("government", "representatives-find", (_ctx, _artifact, params = {}) => {
    const address = String(params.address || "").trim();
    if (!address) return { ok: false, error: "address required" };
    const seed = hashStringGov(address);
    const partyA = seed % 2 === 0 ? "D" : "R";
    const partyB = seed % 3 === 0 ? "R" : "D";
    const representatives = [
      { name: `Sen. ${SAMPLE_NAMES[seed % SAMPLE_NAMES.length]}`, party: partyA, office: "U.S. Senate", level: "federal", phone: "(202) 224-0000", website: "https://senate.gov", termEnd: "2030-01-03" },
      { name: `Sen. ${SAMPLE_NAMES[(seed >> 2) % SAMPLE_NAMES.length]}`, party: partyB, office: "U.S. Senate", level: "federal", phone: "(202) 224-0001", website: "https://senate.gov", termEnd: "2028-01-03" },
      { name: `Rep. ${SAMPLE_NAMES[(seed >> 4) % SAMPLE_NAMES.length]}`, party: partyA, office: "U.S. House", level: "federal", district: String((seed % 50) + 1), phone: "(202) 225-0000", website: "https://house.gov", termEnd: "2027-01-03" },
      { name: `${SAMPLE_NAMES[(seed >> 6) % SAMPLE_NAMES.length]}`, party: partyB, office: "State Senate", level: "state", district: String((seed % 40) + 1), phone: "(916) 651-4000" },
      { name: `${SAMPLE_NAMES[(seed >> 8) % SAMPLE_NAMES.length]}`, party: partyA, office: "State Assembly", level: "state", district: String((seed % 80) + 1), phone: "(916) 319-2000" },
      { name: `${SAMPLE_NAMES[(seed >> 10) % SAMPLE_NAMES.length]}`, party: "I", office: "Mayor", level: "local", website: "https://cityhall.example" },
      { name: `${SAMPLE_NAMES[(seed >> 12) % SAMPLE_NAMES.length]}`, party: partyB, office: "City Council", level: "local", district: String((seed % 11) + 1) },
    ];
    return { ok: true, result: { representatives, address, source: "synthetic-demo" } };
  });

  /**
   * bills-list — recent congressional bills filtered by topic.
   */
  registerLensAction("government", "bills-list", (_ctx, _artifact, params = {}) => {
    const topic = String(params.topic || "").toLowerCase();
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 25));
    let bills = SAMPLE_BILLS;
    if (topic) {
      bills = bills.filter(b => b.title.toLowerCase().includes(topic) || (b.subjects || []).some(s => s.toLowerCase().includes(topic)));
    }
    return { ok: true, result: { bills: bills.slice(0, limit), topic, total: bills.length } };
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

const SAMPLE_NAMES = [
  "Patricia Johnson", "Michael Chen", "Sarah Rodriguez", "David Kim", "Maria Garcia",
  "James Wilson", "Linda Thompson", "Robert Lee", "Jennifer Martinez", "William Brown",
  "Emily Davis", "Christopher Miller", "Jessica Anderson", "Daniel Taylor", "Ashley Moore",
  "Matthew White", "Amanda Harris", "Andrew Martin", "Stephanie Jackson", "Joseph Wright",
];

const SAMPLE_BILLS = [
  { id: "hr1234-119", number: "H.R. 1234", congress: 119, title: "American Climate Resilience Act of 2026", summary: "Establishes federal grants for state-level climate adaptation infrastructure including sea-level rise barriers, wildfire mitigation, and drought-resistant water systems.", introducedDate: "2026-02-14", latestActionDate: "2026-04-22", latestActionText: "Reported by Committee on Energy and Commerce", status: "committee", sponsor: { name: "Rep. Sarah Chen", party: "D", state: "CA" }, cosponsors: 47, subjects: ["climate", "infrastructure", "environment"], url: "https://congress.gov/bill/119th-congress/house-bill/1234" },
  { id: "s567-119", number: "S. 567", congress: 119, title: "AI Accountability and Transparency Act", summary: "Requires federal agencies using generative AI to publish model cards, training-data summaries, and bias-audit results before deployment.", introducedDate: "2026-01-30", latestActionDate: "2026-05-01", latestActionText: "Passed Senate by voice vote", status: "passed_chamber", sponsor: { name: "Sen. Mark Patel", party: "I", state: "VT" }, cosponsors: 22, subjects: ["AI", "technology", "transparency"], url: "https://congress.gov/bill/119th-congress/senate-bill/567" },
  { id: "hr2890-119", number: "H.R. 2890", congress: 119, title: "Universal Childcare Benefit Act", summary: "Establishes a refundable monthly tax credit of up to $1,500 per child under 5 for working families earning <$200K.", introducedDate: "2026-03-08", latestActionDate: "2026-04-15", latestActionText: "Referred to Subcommittee on Health", status: "committee", sponsor: { name: "Rep. Linda Martinez", party: "D", state: "TX" }, cosponsors: 89, subjects: ["healthcare", "family", "tax", "education"] },
  { id: "hr3001-119", number: "H.R. 3001", congress: 119, title: "Right to Repair Consumer Electronics Act", summary: "Requires manufacturers of consumer electronics to provide parts, tools, and repair documentation to independent shops at non-discriminatory pricing.", introducedDate: "2026-04-02", latestActionDate: "2026-04-02", latestActionText: "Introduced", status: "introduced", sponsor: { name: "Rep. James Wilson", party: "D", state: "OR" }, cosponsors: 31, subjects: ["technology", "consumer protection"] },
  { id: "s892-119", number: "S. 892", congress: 119, title: "Healthcare Price Transparency Enforcement Act", summary: "Imposes civil penalties up to $50K per facility per day for hospitals failing to publish machine-readable pricing files for top 300 shoppable services.", introducedDate: "2026-02-25", latestActionDate: "2026-05-10", latestActionText: "Signed by President", status: "signed", sponsor: { name: "Sen. Patricia Johnson", party: "R", state: "FL" }, cosponsors: 18, subjects: ["healthcare", "transparency"] },
  { id: "hr4567-119", number: "H.R. 4567", congress: 119, title: "Voting Rights Restoration Act of 2026", summary: "Requires states to provide online voter registration, automatic registration on DMV interactions, and mandatory mail-ballot postage prepay.", introducedDate: "2026-04-20", latestActionDate: "2026-05-08", latestActionText: "Hearing held by Subcommittee on Elections", status: "committee", sponsor: { name: "Rep. Robert Lee", party: "D", state: "NY" }, cosponsors: 56, subjects: ["voting", "elections", "civil rights"] },
  { id: "s1234-119", number: "S. 1234", congress: 119, title: "Federal Workforce Telework Modernization Act", summary: "Codifies a 60% telework floor for federal positions deemed telework-eligible by agency CIOs.", introducedDate: "2026-03-15", latestActionDate: "2026-04-30", latestActionText: "Failed cloture vote 47-53", status: "failed", sponsor: { name: "Sen. Maria Garcia", party: "D", state: "NM" }, cosponsors: 12, subjects: ["federal workforce", "labor"] },
  { id: "hr5012-119", number: "H.R. 5012", congress: 119, title: "Crypto Tax Simplification Act", summary: "Excludes crypto transactions under $200 from reporting requirements; allows long-term capital gains treatment after 12 months held.", introducedDate: "2026-05-01", latestActionDate: "2026-05-01", latestActionText: "Introduced", status: "introduced", sponsor: { name: "Rep. Andrew Martin", party: "R", state: "WY" }, cosponsors: 8, subjects: ["crypto", "tax", "technology"] },
];
