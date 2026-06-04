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

  // Append a case-status notification; honours active subscriptions so
  // the notification carries the channel + contact the citizen chose.
  function queueGovNotification(state, userId, { kind, subjectKind, subjectId, message }) {
    const list = ensureGovBucket(state, "notifications", userId);
    let channel = "in_app";
    let contact = "";
    if (state.notificationSubs instanceof Map) {
      const subs = state.notificationSubs.get(userId) || [];
      const sub = subs.find(x => x.subjectKind === subjectKind && x.subjectId === subjectId);
      if (sub) { channel = sub.channel; contact = sub.contact; }
    }
    const notification = {
      id: `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      kind, subjectKind, subjectId, message,
      channel, contact,
      read: false,
      createdAt: new Date().toISOString(),
    };
    list.push(notification);
    return notification;
  }

  // Deterministic non-cryptographic fingerprint for e-signature
  // tamper-evidence (FNV-1a over the canonicalised payload).
  function signatureFingerprint(input) {
    let h = 0x811c9dc5;
    const str = String(input);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return `sig-${h.toString(16).padStart(8, "0")}`;
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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
    queueGovNotification(s, userId, {
      kind: "status_update", subjectKind: "service_request", subjectId: req.id,
      message: `${req.referenceNumber} status changed to "${status.replace(/_/g, " ")}".`,
    });
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
    queueGovNotification(s, userId, {
      kind: "status_update", subjectKind: "permit", subjectId: permit.id,
      message: `Permit ${permit.recordNumber} was approved.`,
    });
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
    queueGovNotification(s, userId, {
      kind: "status_update", subjectKind: "permit", subjectId: permit.id,
      message: `Permit ${permit.recordNumber} was denied: ${permit.denialReason}`,
    });
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
    queueGovNotification(s, userId, {
      kind: "status_update", subjectKind: "permit", subjectId: permit.id,
      message: `Permit ${permit.recordNumber} has been issued — valid until ${permit.expiresAt.slice(0, 10)}.`,
    });
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

  // ─────────────────────────────────────────────────────────────
  // Parity backlog — 7 buildable civic-portal features.
  // All persist in globalThis._concordSTATE.governmentLens, per-user.
  // ─────────────────────────────────────────────────────────────

  // ── (1) Online payment processing — permit fees / fines ─────
  // No external gateway is wired (no key shipped); this is a real
  // in-platform payment ledger: a checkout intent is created, then
  // confirmed with a tokenized payment method. Records every cent.

  function findPayableAcrossBuckets(s, userId, kind, refId) {
    if (kind === "permit") {
      return ensureGovBucket(s, "permits", userId).find(p => p.id === refId) || null;
    }
    if (kind === "fine") {
      // fines live on violations the operator logged via the artifact
      // store; we keep a lightweight fine ledger keyed by refId.
      const fines = ensureGovBucket(s, "fines", userId);
      return fines.find(f => f.id === refId) || null;
    }
    return null;
  }

  registerLensAction("government", "fines-list", (ctx, _a, _p = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    return { ok: true, result: { fines: ensureGovBucket(s, "fines", userId) } };
  });

  registerLensAction("government", "fines-create", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const payerName = String(params.payerName || "").trim();
    const reason = String(params.reason || "").trim();
    const amountUsd = Math.round((Number(params.amountUsd) || 0) * 100) / 100;
    if (!payerName || !reason) return { ok: false, error: "payerName and reason required" };
    if (!(amountUsd > 0)) return { ok: false, error: "amountUsd must be positive" };
    const fine = {
      id: uidGov("fine"),
      payerName, reason, amountUsd,
      caseNumber: String(params.caseNumber || ""),
      paid: false,
      issuedAt: new Date().toISOString(),
    };
    ensureGovBucket(s, "fines", userId).push(fine);
    saveGovState();
    return { ok: true, result: { fine } };
  });

  registerLensAction("government", "payments-list", (ctx, _a, _p = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    return { ok: true, result: { payments: ensureGovBucket(s, "payments", userId).slice().reverse() } };
  });

  registerLensAction("government", "payments-checkout", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const kind = String(params.kind || "");
    const refId = String(params.refId || "");
    if (!["permit", "fine"].includes(kind)) return { ok: false, error: "kind must be permit or fine" };
    const target = findPayableAcrossBuckets(s, userId, kind, refId);
    if (!target) return { ok: false, error: `${kind} not found` };
    if (target.paid) return { ok: false, error: `${kind} already paid` };
    const amountUsd = kind === "permit"
      ? Math.max(0, Number(target.feeUsd) || 0)
      : Math.max(0, Number(target.amountUsd) || 0);
    if (!(amountUsd > 0)) return { ok: false, error: "nothing to pay (amount is zero)" };
    const intent = {
      id: uidGov("pay"),
      kind, refId,
      amountUsd,
      description: kind === "permit"
        ? `Permit fee — ${target.recordNumber || refId}`
        : `Fine — ${target.reason || refId}`,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    ensureGovBucket(s, "payments", userId).push(intent);
    saveGovState();
    return { ok: true, result: { payment: intent } };
  });

  registerLensAction("government", "payments-confirm", (ctx, _a, params = {}) => {
  try {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const paymentId = String(params.paymentId || "");
    const methodToken = String(params.methodToken || "").trim();
    const cardLast4 = String(params.cardLast4 || "").replace(/\D/g, "").slice(-4);
    if (!methodToken) return { ok: false, error: "methodToken required (tokenized payment method)" };
    if (cardLast4.length !== 4) return { ok: false, error: "cardLast4 must be 4 digits" };
    const payment = ensureGovBucket(s, "payments", userId).find(p => p.id === paymentId);
    if (!payment) return { ok: false, error: "payment not found" };
    if (payment.status === "succeeded") return { ok: false, error: "payment already confirmed" };
    const target = findPayableAcrossBuckets(s, userId, payment.kind, payment.refId);
    if (!target) return { ok: false, error: "payable record no longer exists" };
    payment.status = "succeeded";
    payment.confirmedAt = new Date().toISOString();
    payment.cardLast4 = cardLast4;
    payment.receiptNumber = `RCPT-${new Date().getFullYear()}-${payment.id.slice(-6).toUpperCase()}`;
    target.paid = true;
    target.paidAt = payment.confirmedAt;
    target.paymentId = payment.id;
    if (payment.kind === "permit" && target.status === "applied") target.status = "under_review";
    // case-status notification on payment
    queueGovNotification(s, userId, {
      kind: "payment_received",
      subjectKind: payment.kind, subjectId: payment.refId,
      message: `Payment of $${payment.amountUsd.toFixed(2)} received — receipt ${payment.receiptNumber}.`,
    });
    saveGovState();
    return { ok: true, result: { payment } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("government", "payments-refund", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const paymentId = String(params.paymentId || "");
    const reason = String(params.reason || "").trim();
    const payment = ensureGovBucket(s, "payments", userId).find(p => p.id === paymentId);
    if (!payment) return { ok: false, error: "payment not found" };
    if (payment.status !== "succeeded") return { ok: false, error: "only succeeded payments can be refunded" };
    payment.status = "refunded";
    payment.refundedAt = new Date().toISOString();
    payment.refundReason = reason || "no reason provided";
    const target = findPayableAcrossBuckets(s, userId, payment.kind, payment.refId);
    if (target) { target.paid = false; target.paymentId = null; }
    saveGovState();
    return { ok: true, result: { payment } };
  });

  // ── (2) Public meeting calendar + agenda / minutes ──────────

  registerLensAction("government", "meetings-list", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const upcoming = params.upcoming === true;
    let meetings = ensureGovBucket(s, "meetings", userId).slice();
    if (upcoming) {
      const now = Date.now();
      meetings = meetings.filter(m => new Date(m.scheduledAt).getTime() >= now);
    }
    meetings.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    return { ok: true, result: { meetings } };
  });

  registerLensAction("government", "meetings-schedule", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const title = String(params.title || "").trim();
    const body = String(params.body || "").trim();
    const scheduledAt = String(params.scheduledAt || "").trim();
    if (!title || !body || !scheduledAt) return { ok: false, error: "title, body, scheduledAt required" };
    if (Number.isNaN(new Date(scheduledAt).getTime())) return { ok: false, error: "scheduledAt must be a valid ISO date/time" };
    const allowedBodies = ["city_council", "planning_commission", "school_board", "zoning_board", "budget_committee", "public_hearing", "special_session", "other"];
    if (!allowedBodies.includes(body)) return { ok: false, error: `body must be one of: ${allowedBodies.join(", ")}` };
    const meeting = {
      id: uidGov("mtg"),
      title, body, scheduledAt,
      location: String(params.location || ""),
      virtualUrl: String(params.virtualUrl || ""),
      agenda: Array.isArray(params.agenda)
        ? params.agenda.map(a => String(a)).filter(Boolean)
        : [],
      minutes: "",
      status: "scheduled",
      createdAt: new Date().toISOString(),
    };
    ensureGovBucket(s, "meetings", userId).push(meeting);
    saveGovState();
    return { ok: true, result: { meeting } };
  });

  registerLensAction("government", "meetings-set-agenda", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const meeting = ensureGovBucket(s, "meetings", userId).find(m => m.id === id);
    if (!meeting) return { ok: false, error: "meeting not found" };
    if (!Array.isArray(params.agenda)) return { ok: false, error: "agenda must be an array of strings" };
    meeting.agenda = params.agenda.map(a => String(a)).filter(Boolean);
    saveGovState();
    return { ok: true, result: { meeting } };
  });

  registerLensAction("government", "meetings-publish-minutes", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const minutes = String(params.minutes || "").trim();
    if (!minutes) return { ok: false, error: "minutes text required" };
    const meeting = ensureGovBucket(s, "meetings", userId).find(m => m.id === id);
    if (!meeting) return { ok: false, error: "meeting not found" };
    meeting.minutes = minutes;
    meeting.status = "minutes_published";
    meeting.minutesPublishedAt = new Date().toISOString();
    saveGovState();
    return { ok: true, result: { meeting } };
  });

  registerLensAction("government", "meetings-delete", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const list = ensureGovBucket(s, "meetings", userId);
    const idx = list.findIndex(m => m.id === id);
    if (idx < 0) return { ok: false, error: "meeting not found" };
    list.splice(idx, 1);
    saveGovState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── (3) Voter registration / election info + polling place ──
  // Election dates pulled live from Google's free Civic Information
  // election list when GOOGLE_CIVIC_API_KEY is set; voter-registration
  // status is a real per-user record the citizen self-files.

  registerLensAction("government", "voter-registration-status", (ctx, _a, _p = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const reg = s.voterRegistrations instanceof Map ? s.voterRegistrations.get(userId) : null;
    return { ok: true, result: { registration: reg || null } };
  });

  registerLensAction("government", "voter-registration-submit", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const fullName = String(params.fullName || "").trim();
    const residentialAddress = String(params.residentialAddress || "").trim();
    const dateOfBirth = String(params.dateOfBirth || "").trim();
    const stateCode = String(params.stateCode || "").trim().toUpperCase();
    if (!fullName || !residentialAddress || !dateOfBirth) {
      return { ok: false, error: "fullName, residentialAddress, dateOfBirth required" };
    }
    if (stateCode.length !== 2) return { ok: false, error: "stateCode must be a 2-letter code" };
    if (Number.isNaN(new Date(dateOfBirth).getTime())) return { ok: false, error: "dateOfBirth must be a valid date" };
    const ageYears = (Date.now() - new Date(dateOfBirth).getTime()) / (365.25 * 86400000);
    if (ageYears < 18) return { ok: false, error: "registrant must be at least 18 years old" };
    if (!(s.voterRegistrations instanceof Map)) s.voterRegistrations = new Map();
    const registration = {
      id: uidGov("voter"),
      fullName, residentialAddress, dateOfBirth, stateCode,
      partyPreference: String(params.partyPreference || "unaffiliated"),
      mailInRequested: params.mailInRequested === true,
      status: "submitted",
      submittedAt: new Date().toISOString(),
    };
    s.voterRegistrations.set(userId, registration);
    saveGovState();
    return { ok: true, result: { registration } };
  });

  registerLensAction("government", "elections-upcoming", async (_ctx, _a, params = {}) => {
    const apiKey = process.env.GOOGLE_CIVIC_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        error: "GOOGLE_CIVIC_API_KEY env var required for live election dates (free signup at https://console.cloud.google.com — enable Civic Information API). Concord ships no hardcoded election calendar.",
      };
    }
    try {
      const url = `https://www.googleapis.com/civicinfo/v2/elections?key=${encodeURIComponent(apiKey)}`;
      const data = await fetchJsonGov(url);
      const elections = (data?.elections || []).map(e => ({
        id: e.id,
        name: e.name,
        electionDay: e.electionDay,
        ocdDivisionId: e.ocdDivisionId,
      }));
      const stateCode = String(params.stateCode || "").trim().toUpperCase();
      const filtered = stateCode
        ? elections.filter(e => String(e.ocdDivisionId || "").includes(`/state:${stateCode.toLowerCase()}`) || String(e.name || "").toUpperCase().includes(stateCode))
        : elections;
      return { ok: true, result: { elections: filtered, total: filtered.length, source: "Google Civic Information API" } };
    } catch (e) {
      return { ok: false, error: `election lookup failed: ${e instanceof Error ? e.message : "network"}` };
    }
  });

  registerLensAction("government", "polling-place-lookup", async (_ctx, _a, params = {}) => {
    const apiKey = process.env.GOOGLE_CIVIC_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        error: "GOOGLE_CIVIC_API_KEY env var required for polling-place lookup (free Civic Information API). No hardcoded polling data is shipped.",
      };
    }
    const address = String(params.address || "").trim();
    const electionId = String(params.electionId || "").trim();
    if (!address) return { ok: false, error: "address required" };
    try {
      let url = `https://www.googleapis.com/civicinfo/v2/voterinfo?key=${encodeURIComponent(apiKey)}&address=${encodeURIComponent(address)}`;
      if (electionId) url += `&electionId=${encodeURIComponent(electionId)}`;
      const data = await fetchJsonGov(url);
      const pollingLocations = (data?.pollingLocations || []).map(p => ({
        name: p.address?.locationName || "",
        line1: p.address?.line1 || "",
        city: p.address?.city || "",
        state: p.address?.state || "",
        zip: p.address?.zip || "",
        pollingHours: p.pollingHours || "",
        notes: p.notes || "",
      }));
      const earlyVoteSites = (data?.earlyVoteSites || []).map(p => ({
        name: p.address?.locationName || "",
        line1: p.address?.line1 || "",
        city: p.address?.city || "",
        state: p.address?.state || "",
      }));
      return {
        ok: true,
        result: {
          address,
          election: data?.election || null,
          pollingLocations,
          earlyVoteSites,
          source: "Google Civic Information API",
        },
      };
    } catch (e) {
      return { ok: false, error: `polling-place lookup failed: ${e instanceof Error ? e.message : "network"}` };
    }
  });

  // ── (5) Bill comment / call-your-rep advocacy actions ───────

  registerLensAction("government", "advocacy-list", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const billId = params.billId ? String(params.billId) : null;
    let actions = ensureGovBucket(s, "advocacyActions", userId).slice().reverse();
    if (billId) actions = actions.filter(a => a.billId === billId);
    return { ok: true, result: { actions } };
  });

  registerLensAction("government", "advocacy-record", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const billId = String(params.billId || "").trim();
    const billTitle = String(params.billTitle || "").trim();
    const stance = String(params.stance || "").trim();
    const channel = String(params.channel || "").trim();
    if (!billId) return { ok: false, error: "billId required" };
    if (!["support", "oppose", "comment"].includes(stance)) return { ok: false, error: "stance must be support, oppose, or comment" };
    if (!["comment", "call", "email", "letter"].includes(channel)) return { ok: false, error: "channel must be comment, call, email, or letter" };
    const message = String(params.message || "").trim();
    if ((channel === "comment" || channel === "email" || channel === "letter") && !message) {
      return { ok: false, error: "message required for comment/email/letter channels" };
    }
    const action = {
      id: uidGov("adv"),
      billId, billTitle, stance, channel, message,
      representative: String(params.representative || ""),
      bioguideId: String(params.bioguideId || ""),
      contactedAt: new Date().toISOString(),
    };
    ensureGovBucket(s, "advocacyActions", userId).push(action);
    saveGovState();
    return { ok: true, result: { action } };
  });

  registerLensAction("government", "advocacy-bill-tally", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const billId = String(params.billId || "").trim();
    if (!billId) return { ok: false, error: "billId required" };
    const actions = ensureGovBucket(s, "advocacyActions", userId).filter(a => a.billId === billId);
    const tally = { support: 0, oppose: 0, comment: 0 };
    for (const a of actions) tally[a.stance] = (tally[a.stance] || 0) + 1;
    return { ok: true, result: { billId, total: actions.length, tally } };
  });

  registerLensAction("government", "advocacy-delete", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const list = ensureGovBucket(s, "advocacyActions", userId);
    const idx = list.findIndex(a => a.id === id);
    if (idx < 0) return { ok: false, error: "advocacy action not found" };
    list.splice(idx, 1);
    saveGovState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── (6) Document / form library with e-signature ────────────

  registerLensAction("government", "documents-list", (ctx, _a, _p = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    return { ok: true, result: { documents: ensureGovBucket(s, "documents", userId) } };
  });

  registerLensAction("government", "documents-publish", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const title = String(params.title || "").trim();
    const category = String(params.category || "").trim();
    const bodyText = String(params.bodyText || "").trim();
    if (!title || !bodyText) return { ok: false, error: "title and bodyText required" };
    const allowed = ["application_form", "permit_form", "tax_form", "policy", "ordinance", "notice", "agreement", "other"];
    if (!allowed.includes(category)) return { ok: false, error: `category must be one of: ${allowed.join(", ")}` };
    const document = {
      id: uidGov("doc"),
      title, category, bodyText,
      fileUrl: String(params.fileUrl || ""),
      requiresSignature: params.requiresSignature !== false,
      signatures: [],
      publishedAt: new Date().toISOString(),
    };
    ensureGovBucket(s, "documents", userId).push(document);
    saveGovState();
    return { ok: true, result: { document } };
  });

  registerLensAction("government", "documents-sign", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const signerName = String(params.signerName || "").trim();
    const signerEmail = String(params.signerEmail || "").trim();
    const typedSignature = String(params.typedSignature || "").trim();
    const doc = ensureGovBucket(s, "documents", userId).find(d => d.id === id);
    if (!doc) return { ok: false, error: "document not found" };
    if (!doc.requiresSignature) return { ok: false, error: "this document does not require a signature" };
    if (!signerName || !signerEmail || !typedSignature) {
      return { ok: false, error: "signerName, signerEmail, typedSignature all required" };
    }
    if (typedSignature.trim().toLowerCase() !== signerName.trim().toLowerCase()) {
      return { ok: false, error: "typed signature must exactly match the signer's full name" };
    }
    const now = new Date().toISOString();
    // tamper-evident signature hash over the document body + signer + time
    const fingerprint = signatureFingerprint(`${doc.id}|${doc.bodyText}|${signerName}|${signerEmail}|${now}`);
    const signature = {
      id: uidGov("sig"),
      signerName, signerEmail,
      signedAt: now,
      fingerprint,
    };
    doc.signatures.push(signature);
    saveGovState();
    return { ok: true, result: { document: doc, signature } };
  });

  registerLensAction("government", "documents-delete", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const id = String(params.id || "");
    const list = ensureGovBucket(s, "documents", userId);
    const idx = list.findIndex(d => d.id === id);
    if (idx < 0) return { ok: false, error: "document not found" };
    list.splice(idx, 1);
    saveGovState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── (7) Case-status notifications ────────────────────────────

  registerLensAction("government", "notifications-list", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const unreadOnly = params.unreadOnly === true;
    let notifications = ensureGovBucket(s, "notifications", userId).slice().reverse();
    if (unreadOnly) notifications = notifications.filter(n => !n.read);
    const unreadCount = ensureGovBucket(s, "notifications", userId).filter(n => !n.read).length;
    return { ok: true, result: { notifications, unreadCount } };
  });

  registerLensAction("government", "notifications-subscribe", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const subjectKind = String(params.subjectKind || "");
    const subjectId = String(params.subjectId || "");
    const channel = String(params.channel || "email");
    if (!["permit", "service_request", "fine", "court_case"].includes(subjectKind)) {
      return { ok: false, error: "subjectKind must be permit, service_request, fine, or court_case" };
    }
    if (!subjectId) return { ok: false, error: "subjectId required" };
    if (!["email", "sms", "both"].includes(channel)) return { ok: false, error: "channel must be email, sms, or both" };
    const contact = String(params.contact || "").trim();
    if (!contact) return { ok: false, error: "contact (email/phone) required" };
    if (!(s.notificationSubs instanceof Map)) s.notificationSubs = new Map();
    if (!s.notificationSubs.has(userId)) s.notificationSubs.set(userId, []);
    const subs = s.notificationSubs.get(userId);
    const existing = subs.find(x => x.subjectKind === subjectKind && x.subjectId === subjectId);
    if (existing) {
      existing.channel = channel;
      existing.contact = contact;
      saveGovState();
      return { ok: true, result: { subscription: existing, updated: true } };
    }
    const subscription = {
      id: uidGov("sub"),
      subjectKind, subjectId, channel, contact,
      createdAt: new Date().toISOString(),
    };
    subs.push(subscription);
    saveGovState();
    return { ok: true, result: { subscription, updated: false } };
  });

  registerLensAction("government", "notifications-mark-read", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const list = ensureGovBucket(s, "notifications", userId);
    if (params.id) {
      const n = list.find(x => x.id === String(params.id));
      if (!n) return { ok: false, error: "notification not found" };
      n.read = true;
      saveGovState();
      return { ok: true, result: { id: n.id, read: true } };
    }
    // mark all
    let count = 0;
    for (const n of list) { if (!n.read) { n.read = true; count++; } }
    saveGovState();
    return { ok: true, result: { markedRead: count } };
  });

  // emit a case-status notification when a permit / SR / fine changes.
  registerLensAction("government", "notifications-emit", (ctx, _a, params = {}) => {
    const s = ensureGovState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = govActor(ctx);
    const subjectKind = String(params.subjectKind || "");
    const subjectId = String(params.subjectId || "");
    const message = String(params.message || "").trim();
    if (!["permit", "service_request", "fine", "court_case"].includes(subjectKind)) {
      return { ok: false, error: "subjectKind must be permit, service_request, fine, or court_case" };
    }
    if (!subjectId || !message) return { ok: false, error: "subjectId and message required" };
    const notification = queueGovNotification(s, userId, {
      kind: "status_update", subjectKind, subjectId, message,
    });
    saveGovState();
    return { ok: true, result: { notification } };
  });

  // ── Dashboard summary (CityGovShell data source) ────────────

  registerLensAction("government", "dashboard-summary", (ctx, _a, _p = {}) => {
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Civic dashboard action macros (deterministic; artifact-based) ──────────
  // Real compute over the dashboard artifact's data (the government lens persists
  // permits/cases/projects/budgets/documents in the artifact store). These surface
  // the dashboard buttons that previously hit no macro. Generic <pre>JSON</pre>
  // result panel renders them. No STATE / no network.
  const _num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const _arr = (v) => Array.isArray(v) ? v : [];

  registerLensAction("government", "budget_report", (ctx, artifact, _p = {}) => {
    const d = artifact.data || {};
    const lines = _arr(d.lineItems || d.expenses || d.allocations);
    const totalBudget = _num(d.budget ?? d.totalBudget ?? lines.reduce((s, l) => s + _num(l?.budgeted ?? l?.amount), 0));
    const spent = lines.reduce((s, l) => s + _num(l?.spent ?? l?.actual ?? 0), 0);
    const byCategory = {};
    for (const l of lines) { const c = String(l?.category || l?.name || "general"); byCategory[c] = (byCategory[c] || 0) + _num(l?.spent ?? l?.amount); }
    return { ok: true, result: { entity: artifact.title || "budget", totalBudget, spent, remaining: Math.round((totalBudget - spent) * 100) / 100, utilizationPct: totalBudget > 0 ? Math.round((spent / totalBudget) * 1000) / 10 : 0, lineCount: lines.length, byCategory } };
  });

  registerLensAction("government", "citizen_impact_report", (ctx, artifact, _p = {}) => {
    const d = artifact.data || {};
    const affected = _num(d.affectedPopulation ?? d.population ?? d.citizensImpacted);
    const areas = _arr(d.impactAreas || d.areas || d.neighborhoods).map((a) => a?.name || a);
    const severity = d.severity || (affected > 10000 ? "high" : affected > 1000 ? "moderate" : "low");
    return { ok: true, result: { subject: artifact.title || "initiative", affectedPopulation: affected, impactAreas: areas, areaCount: areas.length, severity, summary: `${artifact.title || "This action"} affects ~${affected.toLocaleString()} resident(s) across ${areas.length} area(s) [${severity}].` } };
  });

  registerLensAction("government", "compliance_check", (ctx, artifact, _p = {}) => {
    const d = artifact.data || {};
    const reqs = _arr(d.requirements || d.checklist || d.codes);
    const met = reqs.filter((r) => r?.met === true || r?.status === "met" || r?.compliant === true);
    const violations = reqs.filter((r) => !(r?.met === true || r?.status === "met" || r?.compliant === true)).map((r) => r?.name || r?.code || "requirement");
    const score = reqs.length ? Math.round((met.length / reqs.length) * 100) : 100;
    return { ok: true, result: { subject: artifact.title || "item", requirementCount: reqs.length, metCount: met.length, violations, compliancePct: score, compliant: violations.length === 0, verdict: score === 100 ? "compliant" : score >= 80 ? "minor_issues" : "non_compliant" } };
  });

  registerLensAction("government", "docket_report", (ctx, artifact, _p = {}) => {
    const d = artifact.data || {};
    const hearings = _arr(d.hearings || d.events).sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));
    const now = Date.now();
    const upcoming = hearings.filter((h) => new Date(h?.date || 0).getTime() >= now);
    return { ok: true, result: { caseId: d.caseId || artifact.title || "case", status: d.status || (hearings.length ? "active" : "filed"), hearingCount: hearings.length, nextHearing: upcoming[0]?.date || null, parties: _arr(d.parties).map((p) => p?.name || p), hearings: hearings.slice(0, 20) } };
  });

  registerLensAction("government", "export_record", (ctx, artifact, _p = {}) => {
    const d = artifact.data || {};
    const recordId = `REC-${String(artifact.id || artifact.title || "rec").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase()}`;
    const fields = Object.entries(d).filter(([, v]) => typeof v !== "object").map(([k, v]) => `${k}: ${v}`);
    return { ok: true, result: { recordId, recordType: artifact.type || "record", title: artifact.title || "Untitled", format: "text", fieldCount: fields.length, content: [`OFFICIAL RECORD  ${recordId}`, `Title: ${artifact.title || "Untitled"}`, ...fields].join("\n"), exportedAt: new Date().toISOString() } };
  });

  registerLensAction("government", "fee_collection_status", (ctx, artifact, _p = {}) => {
    const d = artifact.data || {};
    const fees = _arr(d.fees || d.charges);
    const totalDue = fees.reduce((s, f) => s + _num(f?.amount ?? f?.due), 0);
    const collected = fees.reduce((s, f) => s + _num(f?.paid ?? (f?.status === "paid" ? (f?.amount ?? f?.due) : 0)), 0);
    return { ok: true, result: { account: artifact.title || "account", feeCount: fees.length, totalDue, collected, outstanding: Math.round((totalDue - collected) * 100) / 100, collectionRatePct: totalDue > 0 ? Math.round((collected / totalDue) * 1000) / 10 : 100, status: collected >= totalDue ? "paid_in_full" : collected > 0 ? "partial" : "unpaid" } };
  });

  registerLensAction("government", "fine_calculation", (ctx, artifact, _p = {}) => {
    const d = artifact.data || {};
    const base = _num(d.baseFine ?? d.fineAmount ?? 100, 100);
    const daysPast = _num(d.daysPastDue ?? d.daysLate ?? 0);
    const lateRate = _num(d.lateFeeRate ?? 0.02, 0.02);
    const violations = _num(d.violationCount ?? _arr(d.violations).length ?? 1, 1);
    const lateFee = Math.round(base * lateRate * daysPast * 100) / 100;
    const total = Math.round((base * violations + lateFee) * 100) / 100;
    return { ok: true, result: { subject: artifact.title || "violation", baseFine: base, violationCount: violations, daysPastDue: daysPast, lateFee, total, breakdown: `${violations}×$${base} base + $${lateFee} late (${daysPast}d) = $${total}` } };
  });

  registerLensAction("government", "milestone_update", (ctx, artifact, _p = {}) => {
    const d = artifact.data || {};
    const milestones = _arr(d.milestones || d.phases);
    const cur = _num(d.currentMilestone ?? d.completedMilestones ?? 0);
    const next = Math.min(milestones.length, cur + 1);
    const done = milestones.length > 0 && next >= milestones.length;
    return { ok: true, result: { project: artifact.title || "project", currentMilestone: next, totalMilestones: milestones.length, currentName: milestones[next - 1]?.name || milestones[next - 1] || (milestones.length ? `Milestone ${next}` : null), status: done ? "complete" : milestones.length ? "in_progress" : "no_milestones", percentComplete: milestones.length ? Math.round((next / milestones.length) * 100) : 0 } };
  });

  registerLensAction("government", "permit_fee_estimate", (ctx, artifact, _p = {}) => {
    const d = artifact.data || {};
    const valuation = _num(d.valuation ?? d.projectValue ?? 0);
    const type = String(d.permitType || d.type || "general");
    const baseFee = { building: 250, electrical: 120, plumbing: 110, mechanical: 130, demolition: 200 }[type] || 100;
    const valuationFee = Math.round(valuation * 0.005 * 100) / 100; // 0.5% of valuation
    const planReview = Math.round(baseFee * 0.65 * 100) / 100;
    const total = Math.round((baseFee + valuationFee + planReview) * 100) / 100;
    return { ok: true, result: { permitType: type, valuation, baseFee, valuationFee, planReviewFee: planReview, totalEstimate: total, breakdown: `base $${baseFee} + valuation $${valuationFee} + plan review $${planReview} = $${total}` } };
  });

  registerLensAction("government", "permit_inspection_schedule", (ctx, artifact, _p = {}) => {
    const d = artifact.data || {};
    const stage = String(d.stage || d.lastInspection || "none");
    const sequence = ["footing", "foundation", "framing", "rough_in", "insulation", "final"];
    const idx = sequence.indexOf(stage);
    const nextStage = sequence[idx + 1] || sequence[0];
    const offsetDays = 3; // next available inspection slot
    const date = new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
    return { ok: true, result: { permit: artifact.title || "permit", currentStage: stage, nextInspection: nextStage, scheduledDate: date, inspectionId: `INSP-${Date.now().toString(36).toUpperCase()}`, remainingStages: sequence.slice(idx + 1) } };
  });

  registerLensAction("government", "redaction_review", (ctx, artifact, _p = {}) => {
    const d = artifact.data || {};
    const SENSITIVE = /ssn|social.?security|dob|birth|address|phone|email|account|medical|salary|password/i;
    const text = String(d.content || d.body || "");
    const fields = Object.keys(d).filter((k) => SENSITIVE.test(k));
    const inlineMatches = (text.match(/\b\d{3}-\d{2}-\d{4}\b|\b\d{16}\b|[\w.+-]+@[\w-]+\.\w+/g) || []).length;
    const flags = fields.length + inlineMatches;
    return { ok: true, result: { document: artifact.title || "document", sensitiveFields: fields, inlinePiiMatches: inlineMatches, redactionCount: flags, status: flags === 0 ? "clean" : "needs_redaction", recommendation: flags === 0 ? "Cleared for public release." : `Redact ${flags} item(s) before release.` } };
  });

  registerLensAction("government", "schedule_hearing", (ctx, artifact, _p = {}) => {
    const d = artifact.data || {};
    const caseType = String(d.caseType || d.type || "general");
    const leadDays = { criminal: 21, civil: 30, traffic: 14, zoning: 45, appeal: 60 }[caseType] || 28;
    const date = new Date(Date.now() + leadDays * 86400000).toISOString().slice(0, 10);
    return { ok: true, result: { caseType, hearingId: `HRG-${Date.now().toString(36).toUpperCase()}`, proposedDate: date, leadTimeDays: leadDays, location: d.courtroom || d.location || "Courtroom TBD", parties: _arr(d.parties).map((p) => p?.name || p) } };
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
