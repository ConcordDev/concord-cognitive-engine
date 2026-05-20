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
   * budget-breakdown — Federal budget rollup from USAspending.gov, the
   * official Treasury-published outlay dataset. Free, no key required.
   * State / local budgets are not centrally aggregated by any single
   * free API and must be wired per-jurisdiction (state DoF open-data
   * portals, OpenGov / Tyler Civic Marketplace for cities). Per
   * "everything must be real" directive: no hardcoded budget tables.
   */
  registerLensAction("government", "budget-breakdown", async (_ctx, _artifact, params = {}) => {
    const scope = ["federal", "state", "local"].includes(params.scope) ? params.scope : "federal";
    const year = Math.max(2020, Math.min(2030, Number(params.year) || new Date().getFullYear() - 1));
    if (scope !== "federal") {
      return {
        ok: false,
        error: `${scope} budget data is not centrally aggregated. Wire your state's open-data portal (e.g. CA: data.ca.gov / NY: data.ny.gov) or OpenGov/Tyler Civic for local. Concord does not ship hardcoded budget tables.`,
        meta: { scope, year },
      };
    }
    // USAspending.gov v2: spending by category, fiscal year.
    // Endpoint returns budget functions (Treasury OMB Function Code).
    const url = `https://api.usaspending.gov/api/v2/spending/`;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "budget_function",
          filters: { fy: String(year) },
        }),
      });
      if (!r.ok) throw new Error(`usaspending ${r.status}`);
      const data = await r.json();
      const results = data?.results || [];
      const totalDollars = results.reduce((s, c) => s + (Number(c.amount) || 0), 0);
      const totalBillions = totalDollars / 1e9;
      const categories = results.map((c) => ({
        name: c.name,
        amountBillions: (Number(c.amount) || 0) / 1e9,
        pctOfTotal: totalDollars > 0 ? (Number(c.amount) / totalDollars) * 100 : 0,
      })).sort((a, b) => b.amountBillions - a.amountBillions);
      return {
        ok: true,
        result: {
          scope: "federal", year, totalBillions, categories,
          source: "usaspending.gov",
        },
      };
    } catch (e) {
      return { ok: false, error: `usaspending unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Full-app parity: SeeClickFix 311 + Accela Civic 2026 ─────────

  function uidGov(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function govActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function ensureGovState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.governmentLens) STATE.governmentLens = {};
    return STATE.governmentLens;
  }
  function saveGovState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function ensureGovBucket(state, key, userId) {
    if (!state[key]) state[key] = new Map();
    if (!state[key].has(userId)) state[key].set(userId, []);
    return state[key].get(userId);
  }

  // ── Departments ──────────────────────────────────────────────

  registerLensAction("government", "departments-list", (ctx, _a, _p = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const depts = ensureGovBucket(s, "departments", userId);
    return { ok: true, result: { departments: depts } };
  });

  registerLensAction("government", "departments-add", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const dept = {
      id: uidGov("dept"), name,
      shortCode: String(params.shortCode || "").toUpperCase().slice(0, 8),
      email: String(params.email || ""),
      phone: String(params.phone || ""),
      head: String(params.head || ""),
      categories: Array.isArray(params.categories) ? params.categories : [],
      createdAt: new Date().toISOString(),
    };
    ensureGovBucket(s, "departments", userId).push(dept);
    saveGovState();
    return { ok: true, result: { department: dept } };
  });

  registerLensAction("government", "departments-delete", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const list = ensureGovBucket(s, "departments", userId);
    const idx = list.findIndex(d => d.id === id);
    if (idx < 0) return { ok: false, error: "department not found" };
    list.splice(idx, 1);
    saveGovState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── 311 service requests ─────────────────────────────────────

  const SR_CATEGORIES = ["pothole", "streetlight_out", "graffiti", "trash_missed", "tree_down", "noise_complaint", "abandoned_vehicle", "sidewalk_damage", "traffic_signal", "water_leak", "illegal_dumping", "park_maintenance", "animal_control", "other"];

  registerLensAction("government", "service-requests-list", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const status = params.status ? String(params.status) : null;
    const category = params.category ? String(params.category) : null;
    const all = ensureGovBucket(s, "serviceRequests", userId);
    let requests = all;
    if (status) requests = requests.filter(r => r.status === status);
    if (category) requests = requests.filter(r => r.category === category);
    return { ok: true, result: { requests: requests.slice().reverse(), total: all.length } };
  });

  registerLensAction("government", "service-requests-create", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const category = String(params.category || "").trim();
    const description = String(params.description || "").trim();
    if (!SR_CATEGORIES.includes(category)) return { ok: false, error: `category must be one of: ${SR_CATEGORIES.join(", ")}` };
    if (!description) return { ok: false, error: "description required" };
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "lat and lng required" };
    // Auto-route by routing rules
    const rules = ensureGovBucket(s, "routingRules", userId);
    const matchedRule = rules.find(r => r.category === category);
    const all = ensureGovBucket(s, "serviceRequests", userId);
    const seqNum = (all.length + 1).toString().padStart(6, "0");
    const request = {
      id: uidGov("sr"),
      referenceNumber: `SR-${seqNum}`,
      category, description, lat, lng,
      address: String(params.address || ""),
      reporterName: String(params.reporterName || ""),
      reporterEmail: String(params.reporterEmail || ""),
      reporterPhone: String(params.reporterPhone || ""),
      photoUrls: Array.isArray(params.photoUrls) ? params.photoUrls : [],
      assignedDepartmentId: matchedRule?.departmentId || null,
      status: matchedRule ? "assigned" : "submitted",
      priority: ["low", "medium", "high", "urgent"].includes(params.priority) ? params.priority : "medium",
      createdAt: new Date().toISOString(),
      updates: [],
    };
    all.push(request);
    saveGovState();
    return { ok: true, result: { request } };
  });

  registerLensAction("government", "service-requests-assign", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const departmentId = String(params.departmentId || "");
    const dept = ensureGovBucket(s, "departments", userId).find(d => d.id === departmentId);
    if (!dept) return { ok: false, error: "department not found" };
    const req = ensureGovBucket(s, "serviceRequests", userId).find(r => r.id === id);
    if (!req) return { ok: false, error: "request not found" };
    req.assignedDepartmentId = departmentId;
    req.assignedDepartmentName = dept.name;
    req.status = "assigned";
    req.updates.push({ kind: "assigned", departmentId, departmentName: dept.name, at: new Date().toISOString() });
    saveGovState();
    return { ok: true, result: { request: req } };
  });

  registerLensAction("government", "service-requests-update-status", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const status = String(params.status || "");
    if (!["submitted", "assigned", "in_progress", "needs_more_info", "closed_resolved", "closed_duplicate", "closed_invalid"].includes(status)) {
      return { ok: false, error: "invalid status" };
    }
    const req = ensureGovBucket(s, "serviceRequests", userId).find(r => r.id === id);
    if (!req) return { ok: false, error: "request not found" };
    req.status = status;
    req.updates.push({ kind: status, note: String(params.note || ""), at: new Date().toISOString() });
    if (status.startsWith("closed_")) {
      req.closedAt = new Date().toISOString();
      req.resolution = String(params.note || "");
    }
    saveGovState();
    return { ok: true, result: { request: req } };
  });

  // ── Routing rules (auto-assign 311 requests by category) ────

  registerLensAction("government", "routing-rules-list", (ctx, _a, _p = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const rules = ensureGovBucket(s, "routingRules", userId);
    return { ok: true, result: { rules } };
  });

  registerLensAction("government", "routing-rules-set", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const category = String(params.category || "");
    const departmentId = String(params.departmentId || "");
    if (!SR_CATEGORIES.includes(category)) return { ok: false, error: "invalid category" };
    if (!departmentId) return { ok: false, error: "departmentId required" };
    const dept = ensureGovBucket(s, "departments", userId).find(d => d.id === departmentId);
    if (!dept) return { ok: false, error: "department not found" };
    const rules = ensureGovBucket(s, "routingRules", userId);
    const existing = rules.find(r => r.category === category);
    if (existing) {
      existing.departmentId = departmentId;
      existing.departmentName = dept.name;
    } else {
      rules.push({ id: uidGov("rule"), category, departmentId, departmentName: dept.name, createdAt: new Date().toISOString() });
    }
    saveGovState();
    return { ok: true, result: { rules } };
  });

  registerLensAction("government", "routing-rules-delete", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const list = ensureGovBucket(s, "routingRules", userId);
    const idx = list.findIndex(r => r.id === id);
    if (idx < 0) return { ok: false, error: "rule not found" };
    list.splice(idx, 1);
    saveGovState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Permits + licensing (Accela-shape) ──────────────────────

  registerLensAction("government", "permits-list", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const status = params.status ? String(params.status) : null;
    const all = ensureGovBucket(s, "permits", userId);
    const permits = status ? all.filter(p => p.status === status) : all;
    return { ok: true, result: { permits } };
  });

  registerLensAction("government", "permits-apply", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const applicantName = String(params.applicantName || "").trim();
    const applicantEmail = String(params.applicantEmail || "").trim();
    const kind = String(params.kind || "").trim();
    const description = String(params.description || "").trim();
    if (!applicantName || !applicantEmail || !kind) return { ok: false, error: "applicantName, applicantEmail, kind required" };
    const all = ensureGovBucket(s, "permits", userId);
    const seqNum = (all.length + 1).toString().padStart(6, "0");
    const permit = {
      id: uidGov("permit"),
      recordNumber: `PMT-${new Date().getFullYear()}-${seqNum}`,
      kind, description,
      applicantName, applicantEmail,
      applicantPhone: String(params.applicantPhone || ""),
      siteAddress: String(params.siteAddress || ""),
      feeUsd: Math.max(0, Number(params.feeUsd) || 0),
      paid: false,
      status: "applied",
      inspectionIds: [],
      submittedAt: new Date().toISOString(),
    };
    all.push(permit);
    saveGovState();
    return { ok: true, result: { permit } };
  });

  registerLensAction("government", "permits-pay-fee", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const permit = ensureGovBucket(s, "permits", userId).find(p => p.id === id);
    if (!permit) return { ok: false, error: "permit not found" };
    if (permit.paid) return { ok: false, error: "fee already paid" };
    permit.paid = true;
    permit.paidAt = new Date().toISOString();
    if (permit.status === "applied") permit.status = "under_review";
    saveGovState();
    return { ok: true, result: { permit } };
  });

  registerLensAction("government", "permits-approve", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const permit = ensureGovBucket(s, "permits", userId).find(p => p.id === id);
    if (!permit) return { ok: false, error: "permit not found" };
    if (!permit.paid) return { ok: false, error: "fee must be paid before approval" };
    permit.status = "approved";
    permit.approvedAt = new Date().toISOString();
    saveGovState();
    return { ok: true, result: { permit } };
  });

  registerLensAction("government", "permits-deny", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const reason = String(params.reason || "").trim();
    const permit = ensureGovBucket(s, "permits", userId).find(p => p.id === id);
    if (!permit) return { ok: false, error: "permit not found" };
    permit.status = "denied";
    permit.deniedAt = new Date().toISOString();
    permit.denialReason = reason || "no reason provided";
    saveGovState();
    return { ok: true, result: { permit } };
  });

  registerLensAction("government", "permits-issue", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const permit = ensureGovBucket(s, "permits", userId).find(p => p.id === id);
    if (!permit) return { ok: false, error: "permit not found" };
    if (permit.status !== "approved") return { ok: false, error: "permit must be approved before issuance" };
    permit.status = "issued";
    permit.issuedAt = new Date().toISOString();
    const expiresDays = Math.max(1, Number(params.validForDays) || 365);
    permit.expiresAt = new Date(Date.now() + expiresDays * 86400000).toISOString();
    saveGovState();
    return { ok: true, result: { permit } };
  });

  // ── Inspections (linked to permits) ─────────────────────────

  registerLensAction("government", "inspections-list", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const permitId = params.permitId ? String(params.permitId) : null;
    const all = ensureGovBucket(s, "inspections", userId);
    const items = permitId ? all.filter(i => i.permitId === permitId) : all;
    return { ok: true, result: { inspections: items } };
  });

  registerLensAction("government", "inspections-schedule", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const permitId = String(params.permitId || "");
    const kind = String(params.kind || "").trim();
    const date = String(params.date || "").slice(0, 10);
    if (!permitId || !kind || !date) return { ok: false, error: "permitId, kind, date required" };
    const permit = ensureGovBucket(s, "permits", userId).find(p => p.id === permitId);
    if (!permit) return { ok: false, error: "permit not found" };
    const inspection = {
      id: uidGov("insp"), permitId, kind, date,
      inspectorName: String(params.inspectorName || ""),
      timeSlot: String(params.timeSlot || "morning"),
      status: "scheduled",
      result: null,
      notes: "",
      createdAt: new Date().toISOString(),
    };
    ensureGovBucket(s, "inspections", userId).push(inspection);
    permit.inspectionIds.push(inspection.id);
    saveGovState();
    return { ok: true, result: { inspection } };
  });

  registerLensAction("government", "inspections-complete", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const result = String(params.result || "");
    if (!["pass", "fail", "needs_followup"].includes(result)) return { ok: false, error: "result must be pass/fail/needs_followup" };
    const insp = ensureGovBucket(s, "inspections", userId).find(i => i.id === id);
    if (!insp) return { ok: false, error: "inspection not found" };
    insp.status = "completed";
    insp.result = result;
    insp.notes = String(params.notes || "");
    insp.completedAt = new Date().toISOString();
    saveGovState();
    return { ok: true, result: { inspection: insp } };
  });

  // ── Assets (streetlights, hydrants, signs, road segments) ────

  registerLensAction("government", "assets-list", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const kind = params.kind ? String(params.kind) : null;
    const all = ensureGovBucket(s, "assets", userId);
    const items = kind ? all.filter(a => a.kind === kind) : all;
    return { ok: true, result: { assets: items } };
  });

  registerLensAction("government", "assets-add", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const kind = String(params.kind || "").trim();
    const allowed = ["streetlight", "hydrant", "sign", "road_segment", "park_bench", "bus_stop", "trash_can", "traffic_signal", "manhole"];
    if (!allowed.includes(kind)) return { ok: false, error: `kind must be one of: ${allowed.join(", ")}` };
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "lat and lng required" };
    const asset = {
      id: uidGov("asset"), kind,
      label: String(params.label || ""),
      lat, lng,
      installedAt: params.installedAt || null,
      lastInspectedAt: null,
      condition: ["good", "fair", "poor", "broken"].includes(params.condition) ? params.condition : "good",
      maintenanceLog: [],
      addedAt: new Date().toISOString(),
    };
    ensureGovBucket(s, "assets", userId).push(asset);
    saveGovState();
    return { ok: true, result: { asset } };
  });

  registerLensAction("government", "assets-log-maintenance", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const work = String(params.work || "").trim();
    if (!work) return { ok: false, error: "work description required" };
    const asset = ensureGovBucket(s, "assets", userId).find(a => a.id === id);
    if (!asset) return { ok: false, error: "asset not found" };
    asset.maintenanceLog.push({
      id: uidGov("mlog"), work,
      crew: String(params.crew || ""),
      condition: ["good", "fair", "poor", "broken"].includes(params.condition) ? params.condition : asset.condition,
      at: new Date().toISOString(),
    });
    if (params.condition) asset.condition = params.condition;
    asset.lastInspectedAt = new Date().toISOString();
    saveGovState();
    return { ok: true, result: { asset } };
  });

  registerLensAction("government", "assets-delete", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const list = ensureGovBucket(s, "assets", userId);
    const idx = list.findIndex(a => a.id === id);
    if (idx < 0) return { ok: false, error: "asset not found" };
    list.splice(idx, 1);
    saveGovState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Open data datasets (real data.gov CKAN search) ──────────

  registerLensAction("government", "open-data-search", async (_ctx, _a, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    try {
      const url = `https://catalog.data.gov/api/3/action/package_search?q=${encodeURIComponent(query)}&rows=20`;
      const data = await fetchJsonGov(url);
      const results = (data?.result?.results || []).map(r => ({
        id: r.id, name: r.name, title: r.title,
        organization: r.organization?.title || "",
        notes: r.notes ? String(r.notes).slice(0, 300) : "",
        resourceCount: (r.resources || []).length,
        firstResourceUrl: r.resources?.[0]?.url || null,
        firstResourceFormat: r.resources?.[0]?.format || null,
        lastModified: r.metadata_modified || null,
      }));
      return {
        ok: true,
        result: {
          query, total: data?.result?.count || 0,
          results,
          source: "data.gov CKAN API",
        },
      };
    } catch (e) {
      return { ok: false, error: `data.gov unreachable: ${e instanceof Error ? e.message : "network"}` };
    }
  });

  // ── Dashboard summary (CityGovShell data source) ────────────

  registerLensAction("government", "dashboard-summary", (ctx, _a, _p = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const requests = ensureGovBucket(s, "serviceRequests", userId);
    const permits = ensureGovBucket(s, "permits", userId);
    const inspections = ensureGovBucket(s, "inspections", userId);
    const departments = ensureGovBucket(s, "departments", userId);
    const assets = ensureGovBucket(s, "assets", userId);
    const today = Date.now();
    const day = 86400000;
    const openRequests = requests.filter(r => !r.status.startsWith("closed_"));
    const closed30d = requests.filter(r => r.closedAt && (today - new Date(r.closedAt).getTime()) < 30 * day);
    // Resolution time
    const resolved = requests.filter(r => r.closedAt);
    const avgResolutionDays = resolved.length > 0
      ? Math.round((resolved.reduce((sum, r) => sum + (new Date(r.closedAt).getTime() - new Date(r.createdAt).getTime()), 0) / resolved.length / day) * 10) / 10
      : 0;
    // Permits by status
    const permitStatusCounts = {};
    for (const p of permits) permitStatusCounts[p.status] = (permitStatusCounts[p.status] || 0) + 1;
    return {
      ok: true,
      result: {
        totalServiceRequests: requests.length,
        openRequests: openRequests.length,
        closed30d: closed30d.length,
        avgResolutionDays,
        permitCount: permits.length,
        permitStatusCounts,
        scheduledInspections: inspections.filter(i => i.status === "scheduled").length,
        departmentCount: departments.length,
        assetCount: assets.length,
        brokenAssets: assets.filter(a => a.condition === "broken" || a.condition === "poor").length,
      },
    };
  });
};

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
