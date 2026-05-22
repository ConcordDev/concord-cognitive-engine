// server/domains/privacy.js
//
// Privacy lens backend — consent & data-privacy management (OneTrust / Apple
// Privacy parity). The original four macros (dataInventory, consentAudit,
// impactAssessment, breachResponse) operate on artifact.data; the macros added
// below operate on real per-user state stored in globalThis._concordSTATE so a
// user can actually exercise the controls (DSAR, per-lens sharing, access log,
// data export, cookie banner config, retention policy, federation flow map).
export default function registerPrivacyActions(registerLensAction) {
  registerLensAction("privacy", "dataInventory", (ctx, artifact, _params) => { const items = artifact.data?.dataItems || []; if (items.length === 0) return { ok: true, result: { message: "Add data items to inventory." } }; const byCategory = {}; const sensitive = items.filter(i => i.sensitive || i.pii); for (const i of items) { const c = i.category || "other"; byCategory[c] = (byCategory[c] || 0) + 1; } return { ok: true, result: { totalItems: items.length, sensitiveItems: sensitive.length, categories: byCategory, riskLevel: sensitive.length > items.length * 0.5 ? "high" : sensitive.length > 0 ? "moderate" : "low", gdprRelevant: sensitive.length > 0, recommendations: sensitive.length > 0 ? ["Implement encryption at rest", "Review access controls", "Document data processing purposes", "Ensure deletion capability"] : ["Continue monitoring data collection"] } }; });
  registerLensAction("privacy", "consentAudit", (ctx, artifact, _params) => { const consents = artifact.data?.consents || []; const active = consents.filter(c => c.status === "active" || c.granted); const expired = consents.filter(c => c.expiry && new Date(c.expiry) < new Date()); const withdrawn = consents.filter(c => c.status === "withdrawn"); return { ok: true, result: { totalConsents: consents.length, active: active.length, expired: expired.length, withdrawn: withdrawn.length, complianceRate: consents.length > 0 ? Math.round((active.length / consents.length) * 100) : 100, issues: expired.map(c => ({ user: c.user || c.subject, expiredOn: c.expiry })), action: expired.length > 0 ? "Re-consent required for expired records" : "All consents current" } }; });
  registerLensAction("privacy", "impactAssessment", (ctx, artifact, _params) => { const data = artifact.data || {}; const dataTypes = data.dataTypes || []; const purposes = data.purposes || []; const hasMinors = data.involvesMinors || false; const crossBorder = data.crossBorderTransfer || false; const riskFactors = [dataTypes.length > 5 ? "large-data-scope" : null, hasMinors ? "involves-minors" : null, crossBorder ? "cross-border-transfer" : null, dataTypes.some(d => (d.type||d).toLowerCase().includes("health") || (d.type||d).toLowerCase().includes("biometric")) ? "special-category-data" : null].filter(Boolean); return { ok: true, result: { dataTypesCount: dataTypes.length, purposes: purposes.length, riskFactors, riskLevel: riskFactors.length >= 3 ? "high" : riskFactors.length >= 1 ? "moderate" : "low", dpiaRequired: riskFactors.length >= 2, mitigations: riskFactors.map(r => ({ risk: r, mitigation: r === "involves-minors" ? "Implement parental consent" : r === "cross-border-transfer" ? "Ensure adequacy decision or SCCs" : r === "special-category-data" ? "Explicit consent required" : "Review data minimization" })) } }; });
  registerLensAction("privacy", "breachResponse", (ctx, artifact, _params) => { const data = artifact.data || {}; const severity = (data.severity || "medium").toLowerCase(); const affected = parseInt(data.affectedUsers) || 0; const dataTypes = data.compromisedData || []; const timeline = { immediate: ["Contain the breach", "Preserve evidence", "Assess scope"], within24h: ["Notify DPO", "Document findings", "Begin remediation"], within72h: ["Notify supervisory authority (GDPR)", "Prepare user notification", "Implement fixes"], within30d: ["Full incident report", "Policy review", "Staff retraining"] }; return { ok: true, result: { severity, affectedUsers: affected, compromisedDataTypes: dataTypes, notificationRequired: affected > 0 && severity !== "low", regulatoryDeadline: "72 hours (GDPR)", timeline, priorityActions: timeline.immediate } }; });

  // ───────────────────────────────────────────────────────────────────────────
  // Per-user privacy substrate — DSAR, per-lens toggles, access log, export,
  // cookie banner, retention policy, federation flow map.
  // ───────────────────────────────────────────────────────────────────────────

  /** Lazily provision the per-domain state container. */
  function privacyState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.privacyLens) {
      STATE.privacyLens = {
        dsars: new Map(),        // userId -> Map<dsarId, request>
        lensSharing: new Map(),  // userId -> Map<lensId, { read, share }>
        accessLog: new Map(),    // userId -> Array<accessEvent>
        cookieConfig: new Map(), // userId -> bannerConfig
        retention: new Map(),    // userId -> Map<category, { windowDays, action }>
        flows: new Map(),        // userId -> Map<flowId, dataFlow>
      };
    }
    return STATE.privacyLens;
  }

  /** Persist the global STATE if the host wired a debounced saver. */
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }

  /** Resolve the calling user's id from ctx, defaulting to a shared bucket. */
  function uidOf(ctx) {
    return (ctx && (ctx.userId || (ctx.actor && ctx.actor.userId))) || "anon";
  }

  /** Per-user Map accessor that auto-creates the bucket. */
  function userMap(parent, uid) {
    if (!parent.has(uid)) parent.set(uid, new Map());
    return parent.get(uid);
  }

  const now = () => Date.now();
  const rid = (p) => `${p}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const clean = (v, max = 2000) => String(v == null ? "" : v).trim().slice(0, max);

  // The lenses a user can grant/revoke per-lens data access for. Kept as a
  // stable list so the UI can render a complete toggle grid.
  const SHAREABLE_LENSES = [
    "chat", "world", "music", "code", "marketplace", "atlas", "healthcare",
    "crypto", "message", "accounting", "research", "legal",
  ];

  // Default retention windows (days) per data category. 0 = keep forever.
  const RETENTION_CATEGORIES = [
    { category: "chat_history", defaultDays: 365 },
    { category: "world_activity", defaultDays: 180 },
    { category: "access_logs", defaultDays: 90 },
    { category: "dsar_records", defaultDays: 730 },
    { category: "search_queries", defaultDays: 30 },
    { category: "drafts", defaultDays: 0 },
  ];

  // ── DSAR — data subject access request handler ────────────────────────────
  // Submit / list / advance access, export, deletion or rectification requests.
  registerLensAction("privacy", "dsarSubmit", (ctx, _artifact, params) => {
    try {
      const uid = uidOf(ctx);
      const kind = clean(params?.kind || "access", 32).toLowerCase();
      const valid = ["access", "export", "deletion", "rectification"];
      if (!valid.includes(kind)) {
        return { ok: false, error: `kind must be one of ${valid.join(", ")}` };
      }
      const s = privacyState();
      const bucket = userMap(s.dsars, uid);
      const req = {
        id: rid("dsar"),
        kind,
        note: clean(params?.note || "", 1000),
        status: "received",
        submittedAt: now(),
        // GDPR: controller must respond within one month.
        dueAt: now() + 30 * 24 * 3600 * 1000,
        history: [{ status: "received", at: now() }],
        resolvedAt: null,
      };
      bucket.set(req.id, req);
      save();
      return { ok: true, result: { request: req, totalRequests: bucket.size } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("privacy", "dsarList", (ctx, _artifact, _params) => {
    try {
      const uid = uidOf(ctx);
      const s = privacyState();
      const bucket = userMap(s.dsars, uid);
      const requests = [...bucket.values()].sort((a, b) => b.submittedAt - a.submittedAt);
      const open = requests.filter(r => r.status !== "completed" && r.status !== "rejected");
      const overdue = open.filter(r => r.dueAt < now());
      return {
        ok: true,
        result: {
          requests,
          totalRequests: requests.length,
          openCount: open.length,
          overdueCount: overdue.length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("privacy", "dsarAdvance", (ctx, _artifact, params) => {
    try {
      const uid = uidOf(ctx);
      const dsarId = clean(params?.dsarId, 64);
      const next = clean(params?.status || "", 32).toLowerCase();
      const flow = ["received", "in_review", "completed", "rejected"];
      if (!flow.includes(next)) {
        return { ok: false, error: `status must be one of ${flow.join(", ")}` };
      }
      const s = privacyState();
      const bucket = userMap(s.dsars, uid);
      const req = bucket.get(dsarId);
      if (!req) return { ok: false, error: "request not found" };
      req.status = next;
      req.history.push({ status: next, at: now() });
      if (next === "completed" || next === "rejected") req.resolvedAt = now();
      save();
      return { ok: true, result: { request: req } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Per-lens data-sharing toggles ─────────────────────────────────────────
  registerLensAction("privacy", "lensSharingGet", (ctx, _artifact, _params) => {
    try {
      const uid = uidOf(ctx);
      const s = privacyState();
      const bucket = userMap(s.lensSharing, uid);
      const lenses = SHAREABLE_LENSES.map((lensId) => {
        const v = bucket.get(lensId) || { read: true, share: false };
        return { lensId, read: !!v.read, share: !!v.share };
      });
      return {
        ok: true,
        result: {
          lenses,
          readEnabled: lenses.filter(l => l.read).length,
          shareEnabled: lenses.filter(l => l.share).length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("privacy", "lensSharingSet", (ctx, _artifact, params) => {
    try {
      const uid = uidOf(ctx);
      const lensId = clean(params?.lensId, 48);
      if (!SHAREABLE_LENSES.includes(lensId)) {
        return { ok: false, error: "unknown lensId" };
      }
      const s = privacyState();
      const bucket = userMap(s.lensSharing, uid);
      const cur = bucket.get(lensId) || { read: true, share: false };
      const next = {
        read: params?.read === undefined ? cur.read : !!params.read,
        share: params?.share === undefined ? cur.share : !!params.share,
      };
      // Sharing implies read — can't share what you can't read.
      if (next.share) next.read = true;
      next.updatedAt = now();
      bucket.set(lensId, next);
      save();
      return { ok: true, result: { lensId, ...next } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Privacy activity log ──────────────────────────────────────────────────
  // recordAccess is also callable by other subsystems to append an event;
  // accessLog returns the recent timeline for the UI.
  registerLensAction("privacy", "recordAccess", (ctx, _artifact, params) => {
    try {
      const uid = uidOf(ctx);
      const s = privacyState();
      if (!s.accessLog.has(uid)) s.accessLog.set(uid, []);
      const log = s.accessLog.get(uid);
      const event = {
        id: rid("acc"),
        at: now(),
        actor: clean(params?.actor || "system", 64),
        actorKind: clean(params?.actorKind || "lens", 24),
        lensId: clean(params?.lensId || "", 48),
        dataCategory: clean(params?.dataCategory || "general", 48),
        operation: clean(params?.operation || "read", 24),
      };
      log.unshift(event);
      if (log.length > 500) log.length = 500;
      save();
      return { ok: true, result: { event, logSize: log.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("privacy", "accessLog", (ctx, _artifact, params) => {
    try {
      const uid = uidOf(ctx);
      const limit = Math.min(Math.max(parseInt(params?.limit) || 50, 1), 200);
      const s = privacyState();
      const log = s.accessLog.get(uid) || [];
      const events = log.slice(0, limit);
      const byActor = {};
      const byOperation = {};
      for (const e of log) {
        byActor[e.actor] = (byActor[e.actor] || 0) + 1;
        byOperation[e.operation] = (byOperation[e.operation] || 0) + 1;
      }
      return {
        ok: true,
        result: { events, totalEvents: log.length, byActor, byOperation },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Data export — "download my data" bundle ───────────────────────────────
  registerLensAction("privacy", "dataExport", (ctx, _artifact, _params) => {
    try {
      const uid = uidOf(ctx);
      const s = privacyState();
      const dsars = [...userMap(s.dsars, uid).values()];
      const lensSharing = [...userMap(s.lensSharing, uid).entries()]
        .map(([lensId, v]) => ({ lensId, ...v }));
      const accessLog = s.accessLog.get(uid) || [];
      const retention = [...userMap(s.retention, uid).entries()]
        .map(([category, v]) => ({ category, ...v }));
      const flows = [...userMap(s.flows, uid).values()];
      const cookieConfig = s.cookieConfig.get(uid) || null;
      const bundle = {
        spec: "concord-privacy-export/v1",
        userId: uid,
        generatedAt: now(),
        sections: { dsars, lensSharing, accessLog, retention, flows, cookieConfig },
      };
      const counts = {
        dsars: dsars.length,
        lensSharing: lensSharing.length,
        accessLog: accessLog.length,
        retention: retention.length,
        flows: flows.length,
      };
      const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);
      return {
        ok: true,
        result: {
          bundle,
          counts,
          totalRecords,
          // Size estimate so the UI can show a download weight before serializing.
          estimatedBytes: JSON.stringify(bundle).length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Cookie / tracker consent banner config ───────────────────────────────
  registerLensAction("privacy", "cookieConfigGet", (ctx, _artifact, _params) => {
    try {
      const uid = uidOf(ctx);
      const s = privacyState();
      const cfg = s.cookieConfig.get(uid) || {
        bannerEnabled: true,
        position: "bottom",
        defaultState: "opt_in",
        categories: {
          essential: { enabled: true, locked: true },
          functional: { enabled: false, locked: false },
          analytics: { enabled: false, locked: false },
          advertising: { enabled: false, locked: false },
        },
        consentString: null,
        updatedAt: null,
      };
      return { ok: true, result: { config: cfg } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("privacy", "cookieConfigSet", (ctx, _artifact, params) => {
    try {
      const uid = uidOf(ctx);
      const s = privacyState();
      const positions = ["top", "bottom", "modal"];
      const states = ["opt_in", "opt_out"];
      const incoming = params?.config || params || {};
      const incomingCats = incoming.categories || {};
      const cats = {};
      for (const c of ["essential", "functional", "analytics", "advertising"]) {
        const locked = c === "essential";
        const enabled = locked ? true : !!incomingCats[c]?.enabled;
        cats[c] = { enabled, locked };
      }
      // A reproducible consent string encodes the four-category decision.
      const consentString = ["essential", "functional", "analytics", "advertising"]
        .map(c => cats[c].enabled ? "1" : "0").join("");
      const cfg = {
        bannerEnabled: incoming.bannerEnabled === undefined ? true : !!incoming.bannerEnabled,
        position: positions.includes(incoming.position) ? incoming.position : "bottom",
        defaultState: states.includes(incoming.defaultState) ? incoming.defaultState : "opt_in",
        categories: cats,
        consentString,
        updatedAt: now(),
      };
      s.cookieConfig.set(uid, cfg);
      save();
      return { ok: true, result: { config: cfg } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Retention policy editor ───────────────────────────────────────────────
  registerLensAction("privacy", "retentionGet", (ctx, _artifact, _params) => {
    try {
      const uid = uidOf(ctx);
      const s = privacyState();
      const bucket = userMap(s.retention, uid);
      const policies = RETENTION_CATEGORIES.map(({ category, defaultDays }) => {
        const v = bucket.get(category);
        return {
          category,
          windowDays: v ? v.windowDays : defaultDays,
          action: v ? v.action : "delete",
          isDefault: !v,
        };
      });
      return { ok: true, result: { policies } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("privacy", "retentionSet", (ctx, _artifact, params) => {
    try {
      const uid = uidOf(ctx);
      const category = clean(params?.category, 48);
      if (!RETENTION_CATEGORIES.some(c => c.category === category)) {
        return { ok: false, error: "unknown retention category" };
      }
      const actions = ["delete", "anonymize", "archive"];
      const action = actions.includes(params?.action) ? params.action : "delete";
      let windowDays = parseInt(params?.windowDays);
      if (!Number.isFinite(windowDays) || windowDays < 0) windowDays = 0;
      windowDays = Math.min(windowDays, 3650); // cap at 10 years
      const s = privacyState();
      const bucket = userMap(s.retention, uid);
      const policy = { windowDays, action, updatedAt: now() };
      bucket.set(category, policy);
      save();
      return { ok: true, result: { category, ...policy } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Third-party data-flow map (federation) ───────────────────────────────
  registerLensAction("privacy", "flowRegister", (ctx, _artifact, params) => {
    try {
      const uid = uidOf(ctx);
      const destination = clean(params?.destination, 96);
      if (!destination) return { ok: false, error: "destination required" };
      const s = privacyState();
      const bucket = userMap(s.flows, uid);
      const flow = {
        id: rid("flow"),
        destination,
        destinationKind: clean(params?.destinationKind || "federation_peer", 32),
        dataCategory: clean(params?.dataCategory || "shadow_dtu", 48),
        direction: params?.direction === "inbound" ? "inbound" : "outbound",
        purpose: clean(params?.purpose || "knowledge federation", 240),
        active: params?.active === undefined ? true : !!params.active,
        registeredAt: now(),
      };
      bucket.set(flow.id, flow);
      save();
      return { ok: true, result: { flow, totalFlows: bucket.size } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("privacy", "flowMap", (ctx, _artifact, _params) => {
    try {
      const uid = uidOf(ctx);
      const s = privacyState();
      const bucket = userMap(s.flows, uid);
      const flows = [...bucket.values()].sort((a, b) => b.registeredAt - a.registeredAt);
      const outbound = flows.filter(f => f.direction === "outbound" && f.active);
      const inbound = flows.filter(f => f.direction === "inbound" && f.active);
      // Node/edge graph the frontend MapView / TreeDiagram can render directly.
      const nodes = [{ id: "you", label: "Your data", kind: "self" }];
      const edges = [];
      for (const f of flows) {
        const nodeId = `dest_${f.id}`;
        nodes.push({ id: nodeId, label: f.destination, kind: f.destinationKind });
        edges.push({
          from: f.direction === "outbound" ? "you" : nodeId,
          to: f.direction === "outbound" ? nodeId : "you",
          label: f.dataCategory,
          active: f.active,
        });
      }
      return {
        ok: true,
        result: {
          flows,
          graph: { nodes, edges },
          outboundCount: outbound.length,
          inboundCount: inbound.length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("privacy", "flowToggle", (ctx, _artifact, params) => {
    try {
      const uid = uidOf(ctx);
      const flowId = clean(params?.flowId, 64);
      const s = privacyState();
      const bucket = userMap(s.flows, uid);
      const flow = bucket.get(flowId);
      if (!flow) return { ok: false, error: "flow not found" };
      flow.active = params?.active === undefined ? !flow.active : !!params.active;
      flow.updatedAt = now();
      save();
      return { ok: true, result: { flow } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
