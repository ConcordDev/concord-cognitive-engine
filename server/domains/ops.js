// server/domains/ops.js
// Domain actions for the ops lens — PagerDuty shape.
//
// Original 4 macros (pageOnCall / runbookLookup / postmortemDraft /
// escalationCheck) compute over the generic artifact store.
//
// 2026 parity — a real incident-management substrate. Per-user persistent
// state on globalThis._concordSTATE.opsLens covers the full backlog vs
// PagerDuty: live incident lifecycle, alert ingestion, multi-step
// escalation policies, on-call calendar + overrides, notification
// dispatch, service directory + dependency mapping, MTTA/MTTR analytics,
// and a public status page.
//
// REGISTRATION (saved-class fix, 2026-06): this file used to register through
// the legacy `registerLensAction(domain, action, (ctx, artifact, params))`
// convention AND was NEVER imported by server.js — so every `ops.*` macro
// (incidentCreate / alertIngest / serviceGraph / analytics / statusPage / …)
// was invisible to runMacro and to POST /api/lens/run → every call hit
// `unknown_macro`, leaving the lens components (IncidentConsole, OpsActionPanel)
// dead-wired even though both were fully built front-to-back. It is now wired
// through the canonical `register` (MACROS) registry — `registerOpsActions(register)`
// in server.js — so the macros are reachable BOTH via POST /api/lens/run AND
// via runMacro (which the contract engine + macro-assassin + behavior-smoke
// harness drive).
//
// To keep the verified handler bodies below byte-for-byte identical, the
// default export adapts the canonical 2-arg `(ctx, input)` signature back to
// the legacy `(ctx, artifact, params)` shape via the `registerLensAction` shim
// — `params` (and `artifact.data`) carry the input, identical to what
// `/api/lens/run` would have built. Handlers return a `{ ok, result }` envelope
// (the dispatcher's `_unwrapLensEnvelope` strips the `result` layer so the
// frontend reads `r.data.result.<field>`).
//
// All persistence is per-user in globalThis._concordSTATE.opsLens. No
// fake/seed data — every value is real user input or a deterministic
// computation over it.
//
// Fail-CLOSED numeric guard: every macro that accepts a numeric input
// (minutesOpen / limit / sinceDays / tier / afterMinutes) calls
// `badNumericField` BEFORE using it, rejecting NaN/Infinity/1e308/negative
// instead of silently clamping them to an accepted result (the macro-assassin's
// V2 vector probes exactly this).

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) BEFORE use.
// An absent/null/undefined field is fine (the macro uses its default). Returns
// null when clean, else the offending key. Copied from server/domains/literary.js.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input == null || input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) return k;
  }
  return null;
}

export default function registerOpsActions(register) {
  // Legacy-convention shim: adapt canonical register(ctx, input) → the verified
  // (ctx, artifact, params) handler bodies below, unchanged. `params` carries
  // the input; `artifact.data` mirrors it for the two macros that read it.
  const registerLensAction = (domain, action, handler) =>
    register(domain, action, (ctx, input = {}) => {
      const inp = input && typeof input === "object" ? input : {};
      const artifact = inp.artifact && typeof inp.artifact === "object"
        ? inp.artifact
        : { id: null, domain, type: "domain_action", data: inp, meta: {} };
      return handler(ctx, artifact, inp);
    });
  // ───────────────────────── persistent state ─────────────────────────
  function getOpsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.opsLens) {
      STATE.opsLens = {
        incidents: new Map(),    // userId -> Array<incident>
        services: new Map(),     // userId -> Array<service>
        policies: new Map(),     // userId -> Array<escalationPolicy>
        shifts: new Map(),       // userId -> Array<onCallShift>
        overrides: new Map(),    // userId -> Array<shiftOverride>
        notifications: new Map(),// userId -> Array<notification>
        alerts: new Map(),       // userId -> Array<rawAlert>
        seq: new Map(),          // userId -> { inc, svc, pol, shf, ovr, ntf, alt }
      };
    }
    const s = STATE.opsLens;
    for (const k of ["incidents","services","policies","shifts","overrides","notifications","alerts","seq"]) {
      if (!s[k]) s[k] = new Map();
    }
    return s;
  }
  function saveOpsState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function actId(ctx) {
    return ctx?.actor?.userId || ctx?.userId || "anon";
  }
  function ensureList(map, userId) {
    if (!map.has(userId)) map.set(userId, []);
    return map.get(userId);
  }
  function ensureSeq(s, userId) {
    if (!s.seq.has(userId)) s.seq.set(userId, { inc: 1, svc: 1, pol: 1, shf: 1, ovr: 1, ntf: 1, alt: 1 });
    const seq = s.seq.get(userId);
    for (const k of ["inc","svc","pol","shf","ovr","ntf","alt"]) {
      if (!Number.isFinite(seq[k])) seq[k] = 1;
    }
    return seq;
  }
  function nowIso() { return new Date().toISOString(); }
  function nextId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  const SEVERITIES = ["sev1", "sev2", "sev3", "sev4"];
  const SEV_THRESHOLD_MIN = { sev1: 5, sev2: 15, sev3: 60, sev4: 240 };
  // valid incident state machine transitions
  const INCIDENT_TRANSITIONS = {
    triggered:    ["acknowledged", "resolved"],
    acknowledged: ["resolved", "triggered"],
    resolved:     ["triggered"],            // re-open
  };

  // ─────────────────────── legacy artifact macros ─────────────────────

  /**
   * pageOnCall — return the current on-call person for a rotation.
   *   artifact.data.rotation = [{ user, startHour, endHour }] (24h cycle)
   *   params.now (ISO, default now)
   */
  registerLensAction("ops", "pageOnCall", (_ctx, artifact, params = {}) => {
    const rotation = artifact?.data?.rotation || params.rotation || [];
    if (rotation.length === 0) return { ok: true, result: { message: "No rotation defined.", current: null } };
    const now = params.now ? new Date(params.now) : new Date();
    const hour = now.getUTCHours();
    const slot = rotation.find((r) => {
      const sh = parseInt(r.startHour, 10);
      const eh = parseInt(r.endHour, 10);
      if (sh <= eh) return hour >= sh && hour < eh;
      return hour >= sh || hour < eh;
    }) || rotation[0];
    return {
      ok: true,
      result: { atUtc: now.toISOString(), currentUtcHour: hour, current: slot.user, slot, rotationSize: rotation.length },
    };
  });

  /**
   * runbookLookup — find runbook entries matching an alert signature.
   */
  registerLensAction("ops", "runbookLookup", (_ctx, artifact, params = {}) => {
    const runbooks = artifact?.data?.runbooks || params.runbooks || [];
    const alert = (params.alert || "").toLowerCase();
    if (!alert) return { ok: false, error: "alert required" };
    const matches = runbooks.filter((r) => alert.includes(String(r.alertPattern || "").toLowerCase()));
    if (matches.length === 0) return { ok: true, result: { matches: 0, suggestion: "no runbook — log + escalate" } };
    return {
      ok: true,
      result: {
        matches: matches.length,
        topMatch: matches[0],
        allMatches: matches.map((m) => ({ alertPattern: m.alertPattern, owner: m.owner, stepCount: (m.steps || []).length })),
      },
    };
  });

  /**
   * postmortemDraft — generate a 5-section post-mortem skeleton.
   */
  registerLensAction("ops", "postmortemDraft", (_ctx, _artifact, params = {}) => {
    const title = params.title || "Incident post-mortem";
    const incidentId = params.incidentId || `inc-${Date.now()}`;
    const startedAt = params.startedAt || new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const resolvedAt = params.resolvedAt || new Date().toISOString();
    const durationMin = Math.round((new Date(resolvedAt).getTime() - new Date(startedAt).getTime()) / 60000);
    return {
      ok: true,
      result: {
        title, incidentId,
        severity: params.severity || "sev3",
        affected: params.affected || "unspecified",
        startedAt, resolvedAt, durationMin,
        sections: [
          { name: "summary", placeholder: "1-2 sentence summary of what happened, when, who was paged, scope of impact." },
          { name: "timeline", placeholder: "UTC timestamps of: detect → page → mitigate → resolve. Include the human pager + their action at each step." },
          { name: "impact", placeholder: "Quantify user impact (requests dropped, $ revenue, customers affected). State explicit zero if nothing." },
          { name: "root_cause", placeholder: "5-whys; root cause + contributing factors. Don't conflate triggering event with cause." },
          { name: "action_items", placeholder: "Owners + due dates. Prefer 1-2 high-leverage AIs over 10 small ones. Each AI must prevent THIS class of incident, not a one-off." },
        ],
      },
    };
  });

  /**
   * escalationCheck — check if an incident has breached escalation thresholds.
   */
  registerLensAction("ops", "escalationCheck", (_ctx, _artifact, params = {}) => {
    const badNum = badNumericField(params, ["minutesOpen"]);
    if (badNum) return { ok: false, error: `invalid_${badNum}` };
    const sev = params.severity || "sev3";
    const minutesOpen = parseFloat(params.minutesOpen) || 0;
    const threshold = SEV_THRESHOLD_MIN[sev] ?? 60;
    const breached = minutesOpen >= threshold;
    return {
      ok: true,
      result: {
        severity: sev,
        minutesOpen,
        thresholdMinutes: threshold,
        breached,
        recommendation: breached
          ? `Escalate now — ${sev} has been open ${minutesOpen}m (threshold ${threshold}m). Page the engineering lead.`
          : `Within window (${minutesOpen}m of ${threshold}m). Continue triage; re-check in ${Math.max(1, Math.round((threshold - minutesOpen) / 2))}m.`,
      },
    };
  });

  // ════════════════════ Live incident lifecycle [L] ════════════════════

  /**
   * incidentCreate — open a new incident with the triggered state.
   *   params: title, severity, serviceId?, source?, summary?
   */
  registerLensAction("ops", "incidentCreate", (ctx, _artifact, params = {}) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = actId(ctx);
      const title = String(params.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      const severity = SEVERITIES.includes(params.severity) ? params.severity : "sev3";
      const seq = ensureSeq(s, userId);
      const list = ensureList(s.incidents, userId);
      const incident = {
        id: nextId("inc"),
        number: seq.inc++,
        title,
        severity,
        status: "triggered",
        serviceId: params.serviceId || null,
        source: params.source || "manual",
        summary: params.summary || "",
        createdAt: nowIso(),
        acknowledgedAt: null,
        resolvedAt: null,
        assignee: params.assignee || null,
        escalationLevel: 0,
        timeline: [{ at: nowIso(), event: "triggered", by: userId, note: params.summary || "" }],
      };
      list.unshift(incident);
      saveOpsState();
      return { ok: true, result: { incident } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * incidentTransition — drive the incident state machine.
   *   params: incidentId, to (acknowledged|resolved|triggered), note?
   */
  registerLensAction("ops", "incidentTransition", (ctx, _artifact, params = {}) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = actId(ctx);
      const list = ensureList(s.incidents, userId);
      const inc = list.find((i) => i.id === params.incidentId);
      if (!inc) return { ok: false, error: "incident not found" };
      const to = params.to;
      const allowed = INCIDENT_TRANSITIONS[inc.status] || [];
      if (!allowed.includes(to)) {
        return { ok: false, error: `invalid transition ${inc.status} → ${to}` };
      }
      inc.status = to;
      if (to === "acknowledged" && !inc.acknowledgedAt) inc.acknowledgedAt = nowIso();
      if (to === "resolved") inc.resolvedAt = nowIso();
      if (to === "triggered" && inc.status === "triggered") { inc.resolvedAt = null; }
      inc.timeline.push({ at: nowIso(), event: to, by: userId, note: params.note || "" });
      saveOpsState();
      return { ok: true, result: { incident: inc } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * incidentList — list incidents, optionally filtered by status/severity.
   */
  registerLensAction("ops", "incidentList", (ctx, _artifact, params = {}) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = actId(ctx);
      let list = [...ensureList(s.incidents, userId)];
      if (params.status) list = list.filter((i) => i.status === params.status);
      if (params.severity) list = list.filter((i) => i.severity === params.severity);
      const open = list.filter((i) => i.status !== "resolved").length;
      return { ok: true, result: { incidents: list, total: list.length, open } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * incidentNote — append a freeform note to an incident timeline.
   */
  registerLensAction("ops", "incidentNote", (ctx, _artifact, params = {}) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = actId(ctx);
      const inc = ensureList(s.incidents, userId).find((i) => i.id === params.incidentId);
      if (!inc) return { ok: false, error: "incident not found" };
      const note = String(params.note || "").trim();
      if (!note) return { ok: false, error: "note required" };
      inc.timeline.push({ at: nowIso(), event: "note", by: userId, note });
      saveOpsState();
      return { ok: true, result: { incident: inc } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ═════════════════════ Alert ingestion [M] ═══════════════════════════

  /**
   * alertIngest — receive an inbound alert and (optionally) auto-create an
   * incident, mapping it to a service if a name match is found.
   *   params: signature, message?, severity?, sourceSystem?, autoCreate?
   */
  registerLensAction("ops", "alertIngest", (ctx, _artifact, params = {}) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = actId(ctx);
      const signature = String(params.signature || "").trim();
      if (!signature) return { ok: false, error: "signature required" };
      const seq = ensureSeq(s, userId);
      const severity = SEVERITIES.includes(params.severity) ? params.severity : "sev3";
      // dependency map: which service does this alert affect?
      const services = ensureList(s.services, userId);
      const matched = services.find((svc) =>
        signature.toLowerCase().includes(String(svc.name || "").toLowerCase()) ||
        (svc.alertKeys || []).some((k) => signature.toLowerCase().includes(String(k).toLowerCase()))
      );
      const alert = {
        id: nextId("alt"),
        number: seq.alt++,
        signature,
        message: params.message || "",
        severity,
        sourceSystem: params.sourceSystem || "webhook",
        serviceId: matched?.id || null,
        serviceName: matched?.name || null,
        receivedAt: nowIso(),
        incidentId: null,
      };
      const alerts = ensureList(s.alerts, userId);
      alerts.unshift(alert);
      let incident = null;
      if (params.autoCreate) {
        const incList = ensureList(s.incidents, userId);
        incident = {
          id: nextId("inc"),
          number: seq.inc++,
          title: params.message || signature,
          severity,
          status: "triggered",
          serviceId: matched?.id || null,
          source: `alert:${alert.sourceSystem}`,
          summary: `Auto-created from alert ${signature}`,
          createdAt: nowIso(),
          acknowledgedAt: null,
          resolvedAt: null,
          assignee: null,
          escalationLevel: 0,
          timeline: [{ at: nowIso(), event: "triggered", by: "alert-ingest", note: signature }],
        };
        incList.unshift(incident);
        alert.incidentId = incident.id;
      }
      saveOpsState();
      return { ok: true, result: { alert, incident, mappedService: matched?.name || null } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * alertList — recent ingested alerts.
   */
  registerLensAction("ops", "alertList", (ctx, _artifact, params = {}) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const badNum = badNumericField(params, ["limit"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const userId = actId(ctx);
      const limit = Math.max(1, Math.min(200, parseInt(params.limit, 10) || 50));
      const alerts = ensureList(s.alerts, userId).slice(0, limit);
      return { ok: true, result: { alerts, total: ensureList(s.alerts, userId).length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ═════════════ Multi-step escalation policies [M] ════════════════════

  /**
   * policyCreate — define a tiered notify chain.
   *   params: name, tiers = [{ afterMinutes, target, channel }]
   */
  registerLensAction("ops", "policyCreate", (ctx, _artifact, params = {}) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = actId(ctx);
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "name required" };
      const rawTiers = Array.isArray(params.tiers) ? params.tiers : [];
      if (rawTiers.length === 0) return { ok: false, error: "at least one tier required" };
      for (const t of rawTiers) {
        const badTier = badNumericField(t || {}, ["afterMinutes"]);
        if (badTier) return { ok: false, error: `invalid_tier_${badTier}` };
      }
      const tiers = rawTiers.map((t, i) => ({
        level: i + 1,
        afterMinutes: Math.max(0, parseFloat(t.afterMinutes) || 0),
        target: String(t.target || "").trim() || `responder-${i + 1}`,
        channel: ["email", "sms", "push"].includes(t.channel) ? t.channel : "push",
      }));
      const seq = ensureSeq(s, userId);
      const policy = { id: nextId("pol"), number: seq.pol++, name, tiers, createdAt: nowIso() };
      ensureList(s.policies, userId).unshift(policy);
      saveOpsState();
      return { ok: true, result: { policy } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * policyList — all escalation policies.
   */
  registerLensAction("ops", "policyList", (ctx) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const policies = ensureList(s.policies, actId(ctx));
      return { ok: true, result: { policies, total: policies.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * policyEvaluate — given a policy + minutes open, resolve which tier is
   * currently active and which tiers have already fired.
   *   params: policyId, minutesOpen
   */
  registerLensAction("ops", "policyEvaluate", (ctx, _artifact, params = {}) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = actId(ctx);
      const badNum = badNumericField(params, ["minutesOpen"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const policy = ensureList(s.policies, userId).find((p) => p.id === params.policyId);
      if (!policy) return { ok: false, error: "policy not found" };
      const minutesOpen = Math.max(0, parseFloat(params.minutesOpen) || 0);
      const fired = policy.tiers.filter((t) => minutesOpen >= t.afterMinutes);
      const pending = policy.tiers.filter((t) => minutesOpen < t.afterMinutes);
      const currentTier = fired.length ? fired[fired.length - 1] : null;
      const nextTier = pending.length ? pending[0] : null;
      return {
        ok: true,
        result: {
          policyName: policy.name,
          minutesOpen,
          currentTier,
          nextTier,
          nextTierInMinutes: nextTier ? Math.round(nextTier.afterMinutes - minutesOpen) : null,
          firedCount: fired.length,
          fullyEscalated: pending.length === 0,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ══════════ On-call calendar + overrides [S] ═════════════════════════

  /**
   * shiftCreate — add an on-call shift to the calendar.
   *   params: responder, startsAt (ISO), endsAt (ISO), policyId?
   */
  registerLensAction("ops", "shiftCreate", (ctx, _artifact, params = {}) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = actId(ctx);
      const responder = String(params.responder || "").trim();
      if (!responder) return { ok: false, error: "responder required" };
      const startsAt = params.startsAt ? new Date(params.startsAt) : null;
      const endsAt = params.endsAt ? new Date(params.endsAt) : null;
      if (!startsAt || isNaN(startsAt) || !endsAt || isNaN(endsAt)) {
        return { ok: false, error: "valid startsAt and endsAt required" };
      }
      if (endsAt <= startsAt) return { ok: false, error: "endsAt must be after startsAt" };
      const seq = ensureSeq(s, userId);
      const shift = {
        id: nextId("shf"), number: seq.shf++, responder,
        startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
        policyId: params.policyId || null, createdAt: nowIso(),
      };
      ensureList(s.shifts, userId).push(shift);
      saveOpsState();
      return { ok: true, result: { shift } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * shiftOverride — record a shift swap / override for a window.
   *   params: shiftId?, responder, startsAt, endsAt, reason?
   */
  registerLensAction("ops", "shiftOverride", (ctx, _artifact, params = {}) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = actId(ctx);
      const responder = String(params.responder || "").trim();
      if (!responder) return { ok: false, error: "responder required" };
      const startsAt = params.startsAt ? new Date(params.startsAt) : null;
      const endsAt = params.endsAt ? new Date(params.endsAt) : null;
      if (!startsAt || isNaN(startsAt) || !endsAt || isNaN(endsAt)) {
        return { ok: false, error: "valid startsAt and endsAt required" };
      }
      const seq = ensureSeq(s, userId);
      const override = {
        id: nextId("ovr"), number: seq.ovr++, shiftId: params.shiftId || null,
        responder, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
        reason: params.reason || "swap", createdAt: nowIso(),
      };
      ensureList(s.overrides, userId).push(override);
      saveOpsState();
      return { ok: true, result: { override } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * calendarView — resolve effective coverage over a window, surfacing the
   * current on-call (overrides win) and any gaps.
   *   params: from (ISO), to (ISO)
   */
  registerLensAction("ops", "calendarView", (ctx, _artifact, params = {}) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = actId(ctx);
      const from = params.from ? new Date(params.from) : new Date(Date.now() - 7 * 86400000);
      const to = params.to ? new Date(params.to) : new Date(Date.now() + 7 * 86400000);
      if (isNaN(from) || isNaN(to)) return { ok: false, error: "invalid from/to" };
      const shifts = ensureList(s.shifts, userId)
        .filter((sh) => new Date(sh.endsAt) > from && new Date(sh.startsAt) < to)
        .map((sh) => ({ ...sh, kind: "shift" }))
        .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
      const overrides = ensureList(s.overrides, userId)
        .filter((o) => new Date(o.endsAt) > from && new Date(o.startsAt) < to)
        .map((o) => ({ ...o, kind: "override" }))
        .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
      // detect coverage gaps between consecutive shifts
      const gaps = [];
      for (let i = 0; i < shifts.length - 1; i++) {
        const gapStart = new Date(shifts[i].endsAt);
        const gapEnd = new Date(shifts[i + 1].startsAt);
        if (gapEnd > gapStart) {
          gaps.push({
            from: gapStart.toISOString(), to: gapEnd.toISOString(),
            minutes: Math.round((gapEnd - gapStart) / 60000),
          });
        }
      }
      // current on-call: override wins over base shift
      const now = Date.now();
      const activeOverride = overrides.find((o) => new Date(o.startsAt).getTime() <= now && new Date(o.endsAt).getTime() > now);
      const activeShift = shifts.find((sh) => new Date(sh.startsAt).getTime() <= now && new Date(sh.endsAt).getTime() > now);
      const currentOnCall = activeOverride?.responder || activeShift?.responder || null;
      return {
        ok: true,
        result: {
          window: { from: from.toISOString(), to: to.toISOString() },
          shifts, overrides, gaps,
          currentOnCall,
          currentOnCallSource: activeOverride ? "override" : activeShift ? "shift" : "none",
          hasGaps: gaps.length > 0,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ══════════════════ Notification dispatch [M] ════════════════════════

  /**
   * notifyDispatch — record a paging notification on an escalation breach.
   * Concord does not have external email/SMS gateways wired, so this
   * persists the dispatch as a queued notification record (auditable,
   * idempotent on idempotencyKey).
   *   params: incidentId, target, channel (email|sms|push), message, tier?
   */
  registerLensAction("ops", "notifyDispatch", (ctx, _artifact, params = {}) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const badNum = badNumericField(params, ["tier"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const userId = actId(ctx);
      const target = String(params.target || "").trim();
      if (!target) return { ok: false, error: "target required" };
      const channel = ["email", "sms", "push"].includes(params.channel) ? params.channel : "push";
      const list = ensureList(s.notifications, userId);
      const idemKey = params.idempotencyKey || `${params.incidentId || "none"}:${target}:${channel}:${params.tier || 0}`;
      const existing = list.find((n) => n.idempotencyKey === idemKey);
      if (existing) return { ok: true, result: { notification: existing, deduped: true } };
      const seq = ensureSeq(s, userId);
      const notification = {
        id: nextId("ntf"), number: seq.ntf++,
        incidentId: params.incidentId || null,
        target, channel, tier: params.tier || 0,
        message: params.message || "Escalation breach — page",
        status: "queued",
        idempotencyKey: idemKey,
        dispatchedAt: nowIso(),
      };
      list.unshift(notification);
      // link into the incident timeline if present
      if (params.incidentId) {
        const inc = ensureList(s.incidents, userId).find((i) => i.id === params.incidentId);
        if (inc) inc.timeline.push({ at: nowIso(), event: "notified", by: "notify-dispatch", note: `${channel} → ${target}` });
      }
      saveOpsState();
      return { ok: true, result: { notification, deduped: false } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * notifyList — dispatched notifications log.
   */
  registerLensAction("ops", "notifyList", (ctx, _artifact, params = {}) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = actId(ctx);
      let list = [...ensureList(s.notifications, userId)];
      if (params.incidentId) list = list.filter((n) => n.incidentId === params.incidentId);
      return { ok: true, result: { notifications: list, total: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ════════════ Service directory + dependency mapping [M] ═════════════

  /**
   * serviceCreate — register a service in the directory.
   *   params: name, owner?, dependsOn = [serviceId], alertKeys = [string], tier?
   */
  registerLensAction("ops", "serviceCreate", (ctx, _artifact, params = {}) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = actId(ctx);
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "name required" };
      const seq = ensureSeq(s, userId);
      const service = {
        id: nextId("svc"), number: seq.svc++, name,
        owner: params.owner || null,
        dependsOn: Array.isArray(params.dependsOn) ? params.dependsOn.filter(Boolean) : [],
        alertKeys: Array.isArray(params.alertKeys) ? params.alertKeys.filter(Boolean) : [],
        tier: ["critical", "high", "standard"].includes(params.tier) ? params.tier : "standard",
        policyId: params.policyId || null,
        createdAt: nowIso(),
      };
      ensureList(s.services, userId).push(service);
      saveOpsState();
      return { ok: true, result: { service } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * serviceList — directory listing.
   */
  registerLensAction("ops", "serviceList", (ctx) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const services = ensureList(s.services, actId(ctx));
      return { ok: true, result: { services, total: services.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * serviceGraph — build the dependency graph (nodes + edges) and resolve,
   * for an optional rootServiceId, the downstream blast radius.
   *   params: rootServiceId?
   */
  registerLensAction("ops", "serviceGraph", (ctx, _artifact, params = {}) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = actId(ctx);
      const services = ensureList(s.services, userId);
      const byId = new Map(services.map((svc) => [svc.id, svc]));
      const nodes = services.map((svc) => ({ id: svc.id, name: svc.name, tier: svc.tier, owner: svc.owner }));
      const edges = [];
      for (const svc of services) {
        for (const dep of svc.dependsOn) {
          if (byId.has(dep)) edges.push({ from: svc.id, to: dep });
        }
      }
      // open incidents affecting each service
      const openInc = ensureList(s.incidents, userId).filter((i) => i.status !== "resolved");
      const incidentsByService = {};
      for (const inc of openInc) {
        if (inc.serviceId) {
          incidentsByService[inc.serviceId] = (incidentsByService[inc.serviceId] || 0) + 1;
        }
      }
      let blastRadius = null;
      if (params.rootServiceId && byId.has(params.rootServiceId)) {
        // services that (transitively) depend on the root
        const dependents = new Set();
        const stack = [params.rootServiceId];
        while (stack.length) {
          const cur = stack.pop();
          for (const svc of services) {
            if (svc.dependsOn.includes(cur) && !dependents.has(svc.id)) {
              dependents.add(svc.id);
              stack.push(svc.id);
            }
          }
        }
        blastRadius = {
          rootServiceId: params.rootServiceId,
          rootName: byId.get(params.rootServiceId).name,
          impactedCount: dependents.size,
          impacted: [...dependents].map((id) => byId.get(id).name),
        };
      }
      return { ok: true, result: { nodes, edges, incidentsByService, blastRadius, serviceCount: services.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ═══════════════════ MTTA / MTTR analytics [S] ═══════════════════════

  /**
   * analytics — compute MTTA, MTTR and incident counts over resolved
   * incidents (and a per-severity / per-week breakdown for charting).
   *   params: sinceDays?
   */
  registerLensAction("ops", "analytics", (ctx, _artifact, params = {}) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const badNum = badNumericField(params, ["sinceDays"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const userId = actId(ctx);
      const sinceDays = Math.max(1, parseInt(params.sinceDays, 10) || 90);
      const cutoff = Date.now() - sinceDays * 86400000;
      const all = ensureList(s.incidents, userId).filter((i) => new Date(i.createdAt).getTime() >= cutoff);
      const resolved = all.filter((i) => i.status === "resolved" && i.resolvedAt);
      const ackd = all.filter((i) => i.acknowledgedAt);
      // MTTA: created → acknowledged
      const ttaList = ackd.map((i) => (new Date(i.acknowledgedAt) - new Date(i.createdAt)) / 60000).filter((m) => m >= 0);
      // MTTR: created → resolved
      const ttrList = resolved.map((i) => (new Date(i.resolvedAt) - new Date(i.createdAt)) / 60000).filter((m) => m >= 0);
      const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0);
      const bySeverity = {};
      for (const sev of SEVERITIES) {
        const sevAll = all.filter((i) => i.severity === sev);
        const sevRes = resolved.filter((i) => i.severity === sev);
        bySeverity[sev] = {
          total: sevAll.length,
          resolved: sevRes.length,
          mttrMin: avg(sevRes.map((i) => (new Date(i.resolvedAt) - new Date(i.createdAt)) / 60000)),
        };
      }
      // weekly trend (count of created incidents per ISO week)
      const weekBuckets = {};
      for (const inc of all) {
        const d = new Date(inc.createdAt);
        const wk = `${d.getUTCFullYear()}-W${String(Math.ceil(((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7)).padStart(2, "0")}`;
        weekBuckets[wk] = (weekBuckets[wk] || 0) + 1;
      }
      return {
        ok: true,
        result: {
          windowDays: sinceDays,
          totalIncidents: all.length,
          openIncidents: all.filter((i) => i.status !== "resolved").length,
          resolvedIncidents: resolved.length,
          mttaMinutes: avg(ttaList),
          mttrMinutes: avg(ttrList),
          bySeverity,
          weeklyTrend: Object.entries(weekBuckets).sort().map(([week, count]) => ({ week, count })),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ═══════════════════════ Status page [M] ════════════════════════════

  /**
   * statusPage — render a public status surface: derive each registered
   * service's health from open incidents, plus an overall posture and the
   * recent incident feed.
   */
  registerLensAction("ops", "statusPage", (ctx) => {
    try {
      const s = getOpsState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = actId(ctx);
      const services = ensureList(s.services, userId);
      const incidents = ensureList(s.incidents, userId);
      const openInc = incidents.filter((i) => i.status !== "resolved");
      const SEV_RANK = { sev1: 4, sev2: 3, sev3: 2, sev4: 1 };
      const componentStatus = services.map((svc) => {
        const svcOpen = openInc.filter((i) => i.serviceId === svc.id);
        let status = "operational";
        if (svcOpen.length) {
          const worst = Math.max(...svcOpen.map((i) => SEV_RANK[i.severity] || 1));
          status = worst >= 4 ? "major_outage" : worst >= 3 ? "partial_outage" : "degraded";
        }
        return { id: svc.id, name: svc.name, tier: svc.tier, status, openIncidents: svcOpen.length };
      });
      let overall = "all_systems_operational";
      if (componentStatus.some((c) => c.status === "major_outage")) overall = "major_outage";
      else if (componentStatus.some((c) => c.status === "partial_outage")) overall = "partial_outage";
      else if (componentStatus.some((c) => c.status === "degraded")) overall = "degraded_performance";
      const recentIncidents = incidents.slice(0, 10).map((i) => ({
        id: i.id, number: i.number, title: i.title, severity: i.severity,
        status: i.status, createdAt: i.createdAt, resolvedAt: i.resolvedAt,
      }));
      // 90-day uptime estimate per component from resolved incident downtime
      const ninetyDayMs = 90 * 86400000;
      const components = componentStatus.map((c) => {
        const downtimeMin = incidents
          .filter((i) => i.serviceId === c.id && i.resolvedAt)
          .reduce((sum, i) => sum + Math.max(0, (new Date(i.resolvedAt) - new Date(i.createdAt)) / 60000), 0);
        const uptimePct = Math.max(0, Math.round((1 - (downtimeMin * 60000) / ninetyDayMs) * 10000) / 100);
        return { ...c, uptime90dPct: uptimePct };
      });
      return {
        ok: true,
        result: {
          overall,
          components,
          recentIncidents,
          activeIncidentCount: openInc.length,
          generatedAt: nowIso(),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
