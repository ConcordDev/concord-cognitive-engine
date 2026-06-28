// server/domains/sentinel.js
//
// Sentinel lens — threat-console overlay (CrowdStrike Falcon analog).
//
// The base `shield` / `intel` / `semantic` macro domains (registered in
// server.js) are read-and-scan only. This domain adds the operator
// workflow layer that a real threat console needs:
//
//   • Threat triage         — case state machine over scanned threats
//   • Continuous monitoring — scheduled-scan configs + alert generation
//   • Threat timeline       — append-only history of triage/alert events
//   • Metrics charts        — time-bucketed series for ChartKit
//   • Intel correlation     — link an intel finding to an open case
//   • Scan scope + rules    — persisted scan-scope / rule configuration
//   • Saved queries         — semantic-search query book + result export
//
// All state is per-user, persisted on globalThis._concordSTATE Maps so it
// survives across macro calls within a process. Handlers never throw —
// every path returns { ok: boolean, result?, error? }.
//
// REGISTRATION (saved-class fix, 2026-06): this file used to register through
// the legacy `registerLensAction(domain, action, (ctx, artifact, params), spec)`
// convention AND was NEVER imported by server.js — so every `sentinel.*` macro
// (triage.* / monitor.* / alerts.* / metrics.series / intel.* / scan.* / query.*)
// was invisible to runMacro and to POST /api/lens/run → every call hit
// `unknown_macro`, leaving the lens components (SentinelTriage / SentinelMonitors /
// SentinelMetrics / SentinelIntel / SentinelScanConfig / SentinelSemantic)
// dead-wired. It is now wired through the canonical `register` (MACROS) registry
// — `registerSentinelActions(register)` in server.js — so the macros are reachable
// BOTH via POST /api/lens/run AND via runMacro (which the contract engine +
// macro-assassin + behavior-smoke harness drive).
//
// To keep the verified handler bodies below byte-for-byte identical, the default
// export adapts the canonical 2-arg `(ctx, input)` signature back to the legacy
// `(ctx, artifact, params)` shape via the `registerLensAction` shim — `params`
// (and `artifact.data`) carry the input, identical to what `/api/lens/run` would
// have built. Handlers return a `{ ok, result }` envelope (the dispatcher's
// `_unwrapLensEnvelope` strips the `result` layer so the frontend reads
// `r.data.result.<field>`). All state is per-user (no publicReadDomains entry —
// every read is keyed by the caller's own ctx.actor.userId).
//
// Fail-CLOSED numeric guard: macros that take a numeric input (intervalMinutes /
// relevance / days / limit) call `badNumericField` BEFORE using it, rejecting
// NaN/Infinity/1e308/negative with `invalid_<field>` instead of silently clamping
// the poison to an accepted value (the macro-assassin's V2 vector probes exactly
// this). Copied from server/domains/literary.js.

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) BEFORE using it.
// An absent/null field is fine (the macro uses its default). Returns null when
// clean, else the offending key.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input == null || input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) return k;
  }
  return null;
}

function getState() {
  const g = globalThis;
  if (!g._concordSTATE) g._concordSTATE = {};
  const s = g._concordSTATE;
  if (!s.sentinelCases) s.sentinelCases = new Map();        // userId -> Map(caseId -> case)
  if (!s.sentinelMonitors) s.sentinelMonitors = new Map();  // userId -> Map(monitorId -> monitor)
  if (!s.sentinelTimeline) s.sentinelTimeline = new Map();  // userId -> [events]
  if (!s.sentinelScanConfig) s.sentinelScanConfig = new Map(); // userId -> config
  if (!s.sentinelQueries) s.sentinelQueries = new Map();    // userId -> Map(queryId -> saved query)
  if (!s.sentinelAlerts) s.sentinelAlerts = new Map();      // userId -> [alerts]
  return s;
}

function userId(ctx, params) {
  return (
    ctx?.actor?.userId ||
    ctx?.userId ||
    params?.userId ||
    'anonymous'
  );
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function userMap(map, id) {
  if (!map.has(id)) map.set(id, new Map());
  return map.get(id);
}

function userList(map, id) {
  if (!map.has(id)) map.set(id, []);
  return map.get(id);
}

function pushTimeline(s, id, event) {
  const list = userList(s.sentinelTimeline, id);
  list.unshift({
    id: uid('tl'),
    at: new Date().toISOString(),
    ...event,
  });
  // keep the most recent 500 events
  if (list.length > 500) list.length = 500;
}

const SEVERITY_RANK = { critical: 5, high: 4, medium: 3, low: 2, info: 1, unknown: 0 };
const TRIAGE_STATES = ['open', 'investigating', 'contained', 'resolved', 'dismissed'];

function normalizeSeverity(sev) {
  const v = String(sev || 'unknown').toLowerCase();
  return SEVERITY_RANK[v] != null ? v : 'unknown';
}

export default function registerSentinelActions(register) {
  // Legacy-convention shim: adapt canonical register(ctx, input) → the
  // verified (ctx, artifact, params) handler bodies below, unchanged.
  const registerLensAction = (domain, action, handler, spec) =>
    register(domain, action, (ctx, input = {}) => {
      const inp = input && typeof input === 'object' ? input : {};
      const artifact = inp.artifact && typeof inp.artifact === 'object'
        ? inp.artifact
        : { id: null, domain, type: 'domain_action', data: inp, meta: {} };
      return handler(ctx, artifact, inp);
    }, spec);

  // ── Threat triage ──────────────────────────────────────────────────────

  /**
   * triage.open — promote a scanned/observed threat into a tracked case.
   * Idempotent on threatId: re-opening returns the existing case.
   */
  registerLensAction('sentinel', 'triage.open', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      const threatId = p.threatId || p.id;
      if (!threatId) return { ok: false, error: 'threatId required' };
      const s = getState();
      const cases = userMap(s.sentinelCases, id);
      const existing = [...cases.values()].find((c) => c.threatId === threatId);
      if (existing) return { ok: true, result: { case: existing, created: false } };
      const now = new Date().toISOString();
      const c = {
        caseId: uid('case'),
        threatId,
        title: p.title || p.description || `Threat ${threatId}`,
        severity: normalizeSeverity(p.severity),
        state: 'open',
        assignee: p.assignee || null,
        description: p.description || '',
        vector: p.vector || null,
        notes: [],
        correlatedIntel: [],
        createdAt: now,
        updatedAt: now,
      };
      cases.set(c.caseId, c);
      pushTimeline(s, id, { kind: 'case_opened', caseId: c.caseId, severity: c.severity, label: c.title, tone: 'bad' });
      return { ok: true, result: { case: c, created: true } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Open a triage case for a detected threat.' });

  /** triage.list — all triage cases for the user, newest first, optional state filter. */
  registerLensAction('sentinel', 'triage.list', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      const s = getState();
      const cases = [...userMap(s.sentinelCases, id).values()];
      let filtered = cases;
      if (p.state && TRIAGE_STATES.includes(p.state)) {
        filtered = cases.filter((c) => c.state === p.state);
      }
      filtered.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      const byState = {};
      for (const st of TRIAGE_STATES) byState[st] = cases.filter((c) => c.state === st).length;
      return { ok: true, result: { cases: filtered, total: cases.length, byState } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'List triage cases with state counts.' });

  /** triage.detail — full case incl. notes + correlated intel. */
  registerLensAction('sentinel', 'triage.detail', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      const caseId = p.caseId || p.id;
      if (!caseId) return { ok: false, error: 'caseId required' };
      const c = userMap(getState().sentinelCases, id).get(caseId);
      if (!c) return { ok: false, error: 'case not found' };
      return { ok: true, result: { case: c } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Get full triage case detail.' });

  /** triage.update — transition state, assign, add a note. */
  registerLensAction('sentinel', 'triage.update', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      const caseId = p.caseId || p.id;
      if (!caseId) return { ok: false, error: 'caseId required' };
      const s = getState();
      const c = userMap(s.sentinelCases, id).get(caseId);
      if (!c) return { ok: false, error: 'case not found' };
      const changes = [];
      if (p.state) {
        if (!TRIAGE_STATES.includes(p.state)) {
          return { ok: false, error: `state must be one of ${TRIAGE_STATES.join(', ')}` };
        }
        if (p.state !== c.state) { changes.push(`state ${c.state}→${p.state}`); c.state = p.state; }
      }
      if (p.assignee !== undefined && p.assignee !== c.assignee) {
        changes.push(`assignee→${p.assignee || 'unassigned'}`);
        c.assignee = p.assignee || null;
      }
      if (p.severity) {
        const sev = normalizeSeverity(p.severity);
        if (sev !== c.severity) { changes.push(`severity ${c.severity}→${sev}`); c.severity = sev; }
      }
      if (p.note) {
        c.notes.unshift({ id: uid('note'), at: new Date().toISOString(), text: String(p.note), by: id });
        changes.push('note added');
      }
      c.updatedAt = new Date().toISOString();
      const tone = c.state === 'resolved' ? 'good' : c.state === 'dismissed' ? 'default' : 'warn';
      pushTimeline(s, id, { kind: 'case_updated', caseId, label: `${c.title}: ${changes.join(', ') || 'touched'}`, tone });
      return { ok: true, result: { case: c, changes } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Update triage case state, assignee, severity, or notes.' });

  // ── Continuous monitoring + alerts ─────────────────────────────────────

  /** monitor.create — register a scheduled scan that emits alerts. */
  registerLensAction('sentinel', 'monitor.create', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const badNum = badNumericField(p, ['intervalMinutes']);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const id = userId(ctx, params);
      const s = getState();
      const monitors = userMap(s.sentinelMonitors, id);
      const intervalMin = Math.max(5, Math.min(1440, Number(p.intervalMinutes) || 60));
      const m = {
        monitorId: uid('mon'),
        name: p.name || `Monitor ${monitors.size + 1}`,
        scope: p.scope || 'all',
        minSeverity: normalizeSeverity(p.minSeverity || 'medium'),
        intervalMinutes: intervalMin,
        enabled: p.enabled !== false,
        runCount: 0,
        alertCount: 0,
        lastRunAt: null,
        nextRunAt: new Date(Date.now() + intervalMin * 60_000).toISOString(),
        createdAt: new Date().toISOString(),
      };
      monitors.set(m.monitorId, m);
      pushTimeline(s, id, { kind: 'monitor_created', label: `Monitor "${m.name}" created`, tone: 'info' });
      return { ok: true, result: { monitor: m } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Create a continuous-monitoring scheduled scan.' });

  /** monitor.list — all monitors for the user. */
  registerLensAction('sentinel', 'monitor.list', (ctx, artifact, params) => {
    try {
      const id = userId(ctx, params);
      const monitors = [...userMap(getState().sentinelMonitors, id).values()];
      monitors.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return { ok: true, result: { monitors, active: monitors.filter((m) => m.enabled).length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'List continuous-monitoring configs.' });

  /** monitor.toggle — enable / disable a monitor. */
  registerLensAction('sentinel', 'monitor.toggle', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      const m = userMap(getState().sentinelMonitors, id).get(p.monitorId || p.id);
      if (!m) return { ok: false, error: 'monitor not found' };
      m.enabled = p.enabled !== undefined ? !!p.enabled : !m.enabled;
      return { ok: true, result: { monitor: m } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Enable or disable a monitor.' });

  /** monitor.delete — remove a monitor. */
  registerLensAction('sentinel', 'monitor.delete', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      const monitors = userMap(getState().sentinelMonitors, id);
      const had = monitors.delete(p.monitorId || p.id);
      return { ok: true, result: { deleted: had } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Delete a monitor.' });

  /**
   * monitor.run — execute a monitor pass. The caller supplies the current
   * threat list (real data from the `shield.threats` macro); this macro
   * diffs it against severity threshold and previously-seen threats, then
   * generates alerts for genuinely new findings.
   */
  registerLensAction('sentinel', 'monitor.run', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      const s = getState();
      const m = userMap(s.sentinelMonitors, id).get(p.monitorId || p.id);
      if (!m) return { ok: false, error: 'monitor not found' };
      const threats = Array.isArray(p.threats) ? p.threats : [];
      const threshold = SEVERITY_RANK[m.minSeverity] || 0;
      const alerts = userList(s.sentinelAlerts, id);
      const seen = new Set(alerts.map((a) => a.threatId));
      const fresh = [];
      for (const t of threats) {
        const sev = normalizeSeverity(t.severity);
        if ((SEVERITY_RANK[sev] || 0) < threshold) continue;
        const tid = t.id || t.threatId;
        if (!tid || seen.has(tid)) continue;
        const alert = {
          alertId: uid('alert'),
          monitorId: m.monitorId,
          monitorName: m.name,
          threatId: tid,
          severity: sev,
          description: t.description || t.subtype || 'Threat detected',
          at: new Date().toISOString(),
          acknowledged: false,
        };
        alerts.unshift(alert);
        fresh.push(alert);
        seen.add(tid);
      }
      if (alerts.length > 300) alerts.length = 300;
      m.runCount += 1;
      m.alertCount += fresh.length;
      m.lastRunAt = new Date().toISOString();
      m.nextRunAt = new Date(Date.now() + m.intervalMinutes * 60_000).toISOString();
      if (fresh.length) {
        pushTimeline(s, id, {
          kind: 'monitor_alert',
          label: `${m.name}: ${fresh.length} new alert${fresh.length > 1 ? 's' : ''}`,
          tone: 'bad',
        });
      }
      return { ok: true, result: { newAlerts: fresh, newCount: fresh.length, scanned: threats.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Run a monitor pass against a supplied threat list and emit alerts.' });

  /** alerts.list — all alerts for the user, newest first. */
  registerLensAction('sentinel', 'alerts.list', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      const alerts = [...userList(getState().sentinelAlerts, id)];
      const unack = alerts.filter((a) => !a.acknowledged);
      const list = p.unacknowledgedOnly ? unack : alerts;
      return { ok: true, result: { alerts: list, total: alerts.length, unacknowledged: unack.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'List monitoring alerts.' });

  /** alerts.acknowledge — mark one or all alerts acknowledged. */
  registerLensAction('sentinel', 'alerts.acknowledge', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      const alerts = userList(getState().sentinelAlerts, id);
      let count = 0;
      if (p.all) {
        for (const a of alerts) if (!a.acknowledged) { a.acknowledged = true; count += 1; }
      } else {
        const a = alerts.find((x) => x.alertId === (p.alertId || p.id));
        if (!a) return { ok: false, error: 'alert not found' };
        if (!a.acknowledged) { a.acknowledged = true; count = 1; }
      }
      return { ok: true, result: { acknowledged: count } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Acknowledge one or all alerts.' });

  // ── Threat timeline / history ──────────────────────────────────────────

  /** timeline.list — append-only history of triage + monitoring events. */
  registerLensAction('sentinel', 'timeline.list', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const badNum = badNumericField(p, ['limit']);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const id = userId(ctx, params);
      let events = [...userList(getState().sentinelTimeline, id)];
      if (p.kind) events = events.filter((e) => e.kind === p.kind);
      const limit = Math.max(1, Math.min(500, Number(p.limit) || 100));
      return { ok: true, result: { events: events.slice(0, limit), total: events.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Get the sentinel threat/triage event timeline.' });

  /** timeline.record — explicitly log an external observation onto the timeline. */
  registerLensAction('sentinel', 'timeline.record', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      if (!p.label) return { ok: false, error: 'label required' };
      const s = getState();
      pushTimeline(s, id, {
        kind: p.kind || 'observation',
        label: String(p.label),
        tone: p.tone || 'info',
        detail: p.detail || null,
      });
      return { ok: true, result: { recorded: true } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Record a custom observation onto the threat timeline.' });

  // ── Shield metrics charts ──────────────────────────────────────────────

  /**
   * metrics.series — time-bucketed counts derived from the local timeline,
   * shaped for ChartKit. Pure computation over already-recorded events.
   */
  registerLensAction('sentinel', 'metrics.series', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const badNum = badNumericField(p, ['days']);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const id = userId(ctx, params);
      const s = getState();
      const events = userList(s.sentinelTimeline, id);
      const days = Math.max(1, Math.min(90, Number(p.days) || 14));
      const now = Date.now();
      const dayMs = 86_400_000;
      const buckets = [];
      for (let i = days - 1; i >= 0; i--) {
        const start = now - i * dayMs;
        const d = new Date(start);
        const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
        buckets.push({ day: label, start, end: start + dayMs, opened: 0, resolved: 0, alerts: 0 });
      }
      for (const e of events) {
        const t = Date.parse(e.at);
        if (!Number.isFinite(t)) continue;
        const b = buckets.find((x) => t >= x.start && t < x.end);
        if (!b) continue;
        if (e.kind === 'case_opened') b.opened += 1;
        else if (e.kind === 'monitor_alert') b.alerts += 1;
        else if (e.kind === 'case_updated' && /→resolved/.test(e.label || '')) b.resolved += 1;
      }
      const cases = [...userMap(s.sentinelCases, id).values()];
      const severityBreakdown = ['critical', 'high', 'medium', 'low', 'info'].map((sev) => ({
        severity: sev,
        count: cases.filter((c) => c.severity === sev).length,
      }));
      const chart = buckets.map(({ day, opened, resolved, alerts }) => ({ day, opened, resolved, alerts }));
      return { ok: true, result: { chart, severityBreakdown, openCases: cases.filter((c) => !['resolved', 'dismissed'].includes(c.state)).length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Time-bucketed threat metrics shaped for charting.' });

  // ── Intel correlation ──────────────────────────────────────────────────

  /** intel.correlate — attach an intel finding to an open triage case. */
  registerLensAction('sentinel', 'intel.correlate', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      const caseId = p.caseId;
      if (!caseId) return { ok: false, error: 'caseId required' };
      if (!p.intelDomain || !p.summary) return { ok: false, error: 'intelDomain and summary required' };
      const badNum = badNumericField(p, ['relevance']);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const s = getState();
      const c = userMap(s.sentinelCases, id).get(caseId);
      if (!c) return { ok: false, error: 'case not found' };
      const link = {
        id: uid('intel'),
        intelDomain: String(p.intelDomain),
        summary: String(p.summary),
        relevance: Math.max(0, Math.min(1, Number(p.relevance) || 0.5)),
        linkedAt: new Date().toISOString(),
      };
      c.correlatedIntel.unshift(link);
      c.updatedAt = link.linkedAt;
      pushTimeline(s, id, { kind: 'intel_correlated', caseId, label: `Intel "${p.intelDomain}" linked to ${c.title}`, tone: 'info' });
      return { ok: true, result: { case: c, link } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Correlate an intel finding to a triage case.' });

  /** intel.uncorrelate — remove an intel link from a case. */
  registerLensAction('sentinel', 'intel.uncorrelate', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      const c = userMap(getState().sentinelCases, id).get(p.caseId);
      if (!c) return { ok: false, error: 'case not found' };
      const before = c.correlatedIntel.length;
      c.correlatedIntel = c.correlatedIntel.filter((l) => l.id !== p.linkId);
      return { ok: true, result: { case: c, removed: before - c.correlatedIntel.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Remove an intel correlation from a case.' });

  // ── Configurable scan scope + rules ────────────────────────────────────

  const DEFAULT_SCAN_CONFIG = () => ({
    scopes: ['files', 'corpus', 'network'],
    activeScopes: ['files', 'corpus'],
    rules: [],
    autoTriageMinSeverity: 'high',
    updatedAt: new Date().toISOString(),
  });

  /** scan.config.get — read the persisted scan-scope + rule configuration. */
  registerLensAction('sentinel', 'scan.config.get', (ctx, artifact, params) => {
    try {
      const id = userId(ctx, params);
      const s = getState();
      if (!s.sentinelScanConfig.has(id)) s.sentinelScanConfig.set(id, DEFAULT_SCAN_CONFIG());
      return { ok: true, result: { config: s.sentinelScanConfig.get(id) } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Get the sentinel scan-scope + rule configuration.' });

  /** scan.config.set — update active scopes / auto-triage threshold. */
  registerLensAction('sentinel', 'scan.config.set', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      const s = getState();
      if (!s.sentinelScanConfig.has(id)) s.sentinelScanConfig.set(id, DEFAULT_SCAN_CONFIG());
      const cfg = s.sentinelScanConfig.get(id);
      if (Array.isArray(p.activeScopes)) {
        cfg.activeScopes = p.activeScopes.filter((x) => cfg.scopes.includes(x));
      }
      if (p.autoTriageMinSeverity) {
        cfg.autoTriageMinSeverity = normalizeSeverity(p.autoTriageMinSeverity);
      }
      cfg.updatedAt = new Date().toISOString();
      return { ok: true, result: { config: cfg } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Update the sentinel scan-scope configuration.' });

  /** scan.rule.add — add a custom detection rule (pattern + severity). */
  registerLensAction('sentinel', 'scan.rule.add', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      if (!p.pattern) return { ok: false, error: 'pattern required' };
      const s = getState();
      if (!s.sentinelScanConfig.has(id)) s.sentinelScanConfig.set(id, DEFAULT_SCAN_CONFIG());
      const cfg = s.sentinelScanConfig.get(id);
      const rule = {
        ruleId: uid('rule'),
        name: p.name || `Rule ${cfg.rules.length + 1}`,
        pattern: String(p.pattern),
        severity: normalizeSeverity(p.severity || 'medium'),
        enabled: p.enabled !== false,
        createdAt: new Date().toISOString(),
      };
      cfg.rules.unshift(rule);
      cfg.updatedAt = rule.createdAt;
      return { ok: true, result: { rule, config: cfg } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Add a custom scan detection rule.' });

  /** scan.rule.remove — delete a custom rule. */
  registerLensAction('sentinel', 'scan.rule.remove', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      const s = getState();
      const cfg = s.sentinelScanConfig.get(id);
      if (!cfg) return { ok: false, error: 'no config' };
      const before = cfg.rules.length;
      cfg.rules = cfg.rules.filter((r) => r.ruleId !== (p.ruleId || p.id));
      cfg.updatedAt = new Date().toISOString();
      return { ok: true, result: { config: cfg, removed: before - cfg.rules.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Remove a custom scan rule.' });

  /**
   * scan.evaluate — run the user's custom rules against supplied content.
   * Pure computation: each enabled rule's pattern is a substring/regex test.
   */
  registerLensAction('sentinel', 'scan.evaluate', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      const content = String(p.content || '');
      if (!content) return { ok: false, error: 'content required' };
      const cfg = getState().sentinelScanConfig.get(id);
      const rules = (cfg?.rules || []).filter((r) => r.enabled);
      const matches = [];
      for (const r of rules) {
        let hit = false;
        try {
          hit = new RegExp(r.pattern, 'i').test(content);
        } catch {
          hit = content.toLowerCase().includes(r.pattern.toLowerCase());
        }
        if (hit) matches.push({ ruleId: r.ruleId, name: r.name, severity: r.severity });
      }
      matches.sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
      return { ok: true, result: { matches, matchCount: matches.length, rulesEvaluated: rules.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Evaluate custom scan rules against content.' });

  // ── Semantic-search saved queries + export ─────────────────────────────

  /** query.save — persist a semantic-search query to the query book. */
  registerLensAction('sentinel', 'query.save', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      if (!p.query) return { ok: false, error: 'query required' };
      const s = getState();
      const queries = userMap(s.sentinelQueries, id);
      const q = {
        queryId: uid('q'),
        name: p.name || String(p.query).slice(0, 48),
        query: String(p.query),
        mode: ['similar', 'classify_intent', 'extract_entities'].includes(p.mode) ? p.mode : 'similar',
        runCount: 0,
        lastRunAt: null,
        createdAt: new Date().toISOString(),
      };
      queries.set(q.queryId, q);
      return { ok: true, result: { query: q } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Save a semantic-search query.' });

  /** query.list — the saved-query book. */
  registerLensAction('sentinel', 'query.list', (ctx, artifact, params) => {
    try {
      const id = userId(ctx, params);
      const queries = [...userMap(getState().sentinelQueries, id).values()];
      queries.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return { ok: true, result: { queries } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'List saved semantic-search queries.' });

  /** query.delete — remove a saved query. */
  registerLensAction('sentinel', 'query.delete', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      const had = userMap(getState().sentinelQueries, id).delete(p.queryId || p.id);
      return { ok: true, result: { deleted: had } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Delete a saved semantic-search query.' });

  /** query.touch — record that a saved query was executed. */
  registerLensAction('sentinel', 'query.touch', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const id = userId(ctx, params);
      const q = userMap(getState().sentinelQueries, id).get(p.queryId || p.id);
      if (!q) return { ok: false, error: 'query not found' };
      q.runCount += 1;
      q.lastRunAt = new Date().toISOString();
      return { ok: true, result: { query: q } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Mark a saved query as executed.' });

  /**
   * query.export — serialize a set of semantic-search results into a
   * portable CSV/JSON payload. Caller passes the real result rows.
   */
  registerLensAction('sentinel', 'query.export', (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const rows = Array.isArray(p.results) ? p.results : [];
      if (!rows.length) return { ok: false, error: 'results array required' };
      const format = p.format === 'csv' ? 'csv' : 'json';
      const generatedAt = new Date().toISOString();
      let payload;
      if (format === 'csv') {
        const cols = [...new Set(rows.flatMap((r) => Object.keys(r || {})))];
        const esc = (v) => {
          const sv = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
          return /[",\n]/.test(sv) ? `"${sv.replace(/"/g, '""')}"` : sv;
        };
        const lines = [cols.join(',')];
        for (const r of rows) lines.push(cols.map((c) => esc(r?.[c])).join(','));
        payload = lines.join('\n');
      } else {
        payload = JSON.stringify({ query: p.query || null, generatedAt, results: rows }, null, 2);
      }
      return {
        ok: true,
        result: {
          format,
          filename: `sentinel-query-${Date.now()}.${format}`,
          rowCount: rows.length,
          payload,
          generatedAt,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { description: 'Export semantic-search results as CSV or JSON.' });
}
