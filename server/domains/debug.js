// server/domains/debug.js
// Domain actions for debugging: log pattern analysis, error clustering,
// stack trace parsing, and performance bottleneck detection.
//
// Plus a Sentry/Datadog-style observability suite backed by per-user
// state Maps: an issue inbox (ingest + group runtime exceptions with
// occurrences, breadcrumbs, assignment + resolution workflow), a
// distributed trace viewer (span waterfall), alert rules (threshold
// breach detection), time-series metric charts, and release tracking.

export default function registerDebugActions(registerLensAction) {
  // ─── Per-user observability state ───────────────────────────────
  function getDebugState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.debugLens) STATE.debugLens = {};
    const d = STATE.debugLens;
    if (!(d.issues instanceof Map)) d.issues = new Map();        // userId -> Array<issue>
    if (!(d.traces instanceof Map)) d.traces = new Map();        // userId -> Array<trace>
    if (!(d.alertRules instanceof Map)) d.alertRules = new Map();// userId -> Array<rule>
    if (!(d.metrics instanceof Map)) d.metrics = new Map();      // userId -> Array<sample>
    if (!(d.releases instanceof Map)) d.releases = new Map();    // userId -> Array<release>
    return d;
  }
  function saveDebug() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const dbgId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const dbgActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const dbgClean = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);
  const dbgNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const dbgList = (m, userId) => { if (!m.has(userId)) m.set(userId, []); return m.get(userId); };

  // Normalize an exception to a stable fingerprint so repeat
  // occurrences group into one issue.
  function fingerprint(type, message, culprit) {
    const norm = (s) => String(s || "")
      .replace(/0x[0-9a-fA-F]+/g, "<ADDR>")
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
      .replace(/\b\d+\b/g, "<N>")
      .replace(/['"][^'"]{0,80}['"]/g, "<STR>")
      .trim()
      .toLowerCase();
    return `${norm(type)}|${norm(message).slice(0, 120)}|${norm(culprit).slice(0, 80)}`;
  }

  const ISSUE_STATES = ["open", "resolved", "ignored"];
  const ALERT_OPS = [">", ">=", "<", "<=", "=="];

  // ─── FEATURE: Live error stream / issue inbox ───────────────────
  // Ingest a runtime exception; groups by fingerprint into an issue
  // with occurrence count, breadcrumb trail, and release tag.
  registerLensAction("debug", "issue-ingest", (ctx, _a, params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      const type = dbgClean(params.type, 80) || "Error";
      const message = dbgClean(params.message, 600);
      if (!message) return { ok: false, error: "message required" };
      const culprit = dbgClean(params.culprit, 200) || null;
      const level = ["error", "warning", "fatal", "info"].includes(params.level) ? params.level : "error";
      const release = dbgClean(params.release, 60) || null;
      const stack = dbgClean(params.stack, 4000) || null;
      const breadcrumbs = Array.isArray(params.breadcrumbs)
        ? params.breadcrumbs.slice(0, 30).map((b) => ({
            at: dbgClean(b.at, 40) || new Date().toISOString(),
            category: dbgClean(b.category, 40) || "log",
            message: dbgClean(b.message, 300),
            level: ["debug", "info", "warning", "error"].includes(b.level) ? b.level : "info",
          }))
        : [];
      const fp = fingerprint(type, message, culprit);
      const list = dbgList(s.issues, dbgActor(ctx));
      const now = new Date().toISOString();
      let issue = list.find((i) => i.fingerprint === fp);
      if (issue) {
        issue.count += 1;
        issue.lastSeen = now;
        if (release) issue.releases = [...new Set([...(issue.releases || []), release])].slice(-10);
        // Latest occurrence's breadcrumb trail wins; keep last 30.
        if (breadcrumbs.length) issue.breadcrumbs = breadcrumbs;
        if (stack) issue.stack = stack;
        issue.occurrenceTimes = [...(issue.occurrenceTimes || []), now].slice(-200);
        // A new occurrence reopens a resolved issue (regression).
        if (issue.status === "resolved") { issue.status = "open"; issue.regressed = true; }
      } else {
        issue = {
          id: dbgId("issue"),
          fingerprint: fp,
          type, message, culprit, level, stack,
          status: "open",
          assignee: null,
          regressed: false,
          count: 1,
          breadcrumbs,
          releases: release ? [release] : [],
          firstSeen: now,
          lastSeen: now,
          occurrenceTimes: [now],
        };
        list.push(issue);
      }
      saveDebug();
      return { ok: true, result: { issue, isNew: issue.count === 1 } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // List/filter issues for the inbox view.
  registerLensAction("debug", "issue-list", (ctx, _a, params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      let list = [...dbgList(s.issues, dbgActor(ctx))];
      if (ISSUE_STATES.includes(params.status)) list = list.filter((i) => i.status === params.status);
      if (params.level) list = list.filter((i) => i.level === params.level);
      if (params.release) list = list.filter((i) => (i.releases || []).includes(params.release));
      const q = dbgClean(params.query, 120).toLowerCase();
      if (q) {list = list.filter((i) =>
        i.message.toLowerCase().includes(q) ||
        (i.type || "").toLowerCase().includes(q) ||
        (i.culprit || "").toLowerCase().includes(q));}
      const sort = params.sort === "first" ? "firstSeen" : params.sort === "count" ? "count" : "lastSeen";
      list.sort((a, b) => sort === "count"
        ? b.count - a.count
        : String(b[sort]).localeCompare(String(a[sort])));
      const all = dbgList(s.issues, dbgActor(ctx));
      return {
        ok: true,
        result: {
          issues: list.map((i) => ({ ...i, occurrenceTimes: undefined, stack: undefined })),
          count: list.length,
          summary: {
            open: all.filter((i) => i.status === "open").length,
            resolved: all.filter((i) => i.status === "resolved").length,
            ignored: all.filter((i) => i.status === "ignored").length,
            totalOccurrences: all.reduce((n, i) => n + i.count, 0),
          },
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Full detail for one issue (stack, breadcrumbs, occurrence timeline).
  registerLensAction("debug", "issue-detail", (ctx, _a, params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      const issue = dbgList(s.issues, dbgActor(ctx)).find((i) => i.id === params.id);
      if (!issue) return { ok: false, error: "issue not found" };
      // Bucket occurrences into a sparkline (hourly, last 24h).
      const times = (issue.occurrenceTimes || []).map((t) => new Date(t).getTime()).filter((n) => !isNaN(n));
      const now = Date.now();
      const sparkline = [];
      for (let h = 23; h >= 0; h--) {
        const start = now - (h + 1) * 3600000;
        const end = now - h * 3600000;
        sparkline.push({
          hour: new Date(start).toISOString(),
          count: times.filter((t) => t >= start && t < end).length,
        });
      }
      return { ok: true, result: { issue, sparkline } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ─── FEATURE: Issue assignment + resolution workflow ────────────
  registerLensAction("debug", "issue-update", (ctx, _a, params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      const issue = dbgList(s.issues, dbgActor(ctx)).find((i) => i.id === params.id);
      if (!issue) return { ok: false, error: "issue not found" };
      if (params.status != null) {
        if (!ISSUE_STATES.includes(params.status)) return { ok: false, error: "invalid status" };
        issue.status = params.status;
        if (params.status === "resolved" || params.status === "ignored") issue.regressed = false;
      }
      if (params.assignee !== undefined) issue.assignee = dbgClean(params.assignee, 80) || null;
      saveDebug();
      return { ok: true, result: { issue } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("debug", "issue-delete", (ctx, _a, params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      const arr = dbgList(s.issues, dbgActor(ctx));
      const i = arr.findIndex((x) => x.id === params.id);
      if (i < 0) return { ok: false, error: "issue not found" };
      arr.splice(i, 1);
      saveDebug();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ─── FEATURE: Distributed trace viewer (span waterfall) ─────────
  // Record a trace as a flat list of spans; computes a waterfall
  // layout (offset + depth) for the viewer.
  registerLensAction("debug", "trace-record", (ctx, _a, params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      const rawSpans = Array.isArray(params.spans) ? params.spans : [];
      if (rawSpans.length === 0) return { ok: false, error: "spans required" };
      const spans = rawSpans.slice(0, 500).map((sp, idx) => ({
        spanId: dbgClean(sp.spanId, 60) || `span_${idx}`,
        parentId: dbgClean(sp.parentId, 60) || null,
        name: dbgClean(sp.name, 200) || "span",
        service: dbgClean(sp.service, 80) || "unknown",
        startMs: dbgNum(sp.startMs) ?? 0,
        endMs: dbgNum(sp.endMs) ?? 0,
        status: ["ok", "error"].includes(sp.status) ? sp.status : "ok",
      }));
      const t0 = Math.min(...spans.map((sp) => sp.startMs));
      const t1 = Math.max(...spans.map((sp) => sp.endMs));
      const total = Math.max(1, t1 - t0);
      // Depth from parent chain.
      const byId = new Map(spans.map((sp) => [sp.spanId, sp]));
      const depthOf = (sp, guard = 0) => {
        if (!sp.parentId || guard > 50) return 0;
        const parent = byId.get(sp.parentId);
        return parent ? 1 + depthOf(parent, guard + 1) : 0;
      };
      const layout = spans.map((sp) => {
        const dur = Math.max(0, sp.endMs - sp.startMs);
        return {
          ...sp,
          durationMs: Math.round(dur * 100) / 100,
          offsetPct: Math.round(((sp.startMs - t0) / total) * 10000) / 100,
          widthPct: Math.round((dur / total) * 10000) / 100,
          depth: depthOf(sp),
        };
      }).sort((a, b) => a.startMs - b.startMs || a.depth - b.depth);
      const trace = {
        id: dbgId("trace"),
        name: dbgClean(params.name, 200) || layout[0]?.name || "request",
        spanCount: layout.length,
        totalDurationMs: Math.round(total * 100) / 100,
        errorCount: layout.filter((sp) => sp.status === "error").length,
        rootService: layout[0]?.service || "unknown",
        spans: layout,
        recordedAt: new Date().toISOString(),
      };
      const list = dbgList(s.traces, dbgActor(ctx));
      list.unshift(trace);
      if (list.length > 100) list.length = 100;
      saveDebug();
      return { ok: true, result: { trace } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("debug", "trace-list", (ctx, _a, _params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      const list = dbgList(s.traces, dbgActor(ctx));
      return {
        ok: true,
        result: {
          traces: list.map((t) => ({
            id: t.id, name: t.name, spanCount: t.spanCount,
            totalDurationMs: t.totalDurationMs, errorCount: t.errorCount,
            rootService: t.rootService, recordedAt: t.recordedAt,
          })),
          count: list.length,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("debug", "trace-detail", (ctx, _a, params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      const trace = dbgList(s.traces, dbgActor(ctx)).find((t) => t.id === params.id);
      if (!trace) return { ok: false, error: "trace not found" };
      // Per-service rollup for the waterfall summary.
      const byService = {};
      for (const sp of trace.spans) {
        if (!byService[sp.service]) byService[sp.service] = { service: sp.service, spans: 0, totalMs: 0, errors: 0 };
        byService[sp.service].spans += 1;
        byService[sp.service].totalMs += sp.durationMs;
        if (sp.status === "error") byService[sp.service].errors += 1;
      }
      return {
        ok: true,
        result: {
          trace,
          serviceBreakdown: Object.values(byService)
            .map((v) => ({ ...v, totalMs: Math.round(v.totalMs * 100) / 100 }))
            .sort((a, b) => b.totalMs - a.totalMs),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ─── FEATURE: Time-series metric charts ─────────────────────────
  // Record a metric sample (CPU/memory/latency/etc).
  registerLensAction("debug", "metric-record", (ctx, _a, params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      const metric = dbgClean(params.metric, 60);
      const value = dbgNum(params.value);
      if (!metric) return { ok: false, error: "metric name required" };
      if (value == null) return { ok: false, error: "numeric value required" };
      const sample = {
        metric,
        value,
        unit: dbgClean(params.unit, 20) || "",
        at: dbgClean(params.at, 40) || new Date().toISOString(),
      };
      const list = dbgList(s.metrics, dbgActor(ctx));
      list.push(sample);
      // Keep last 5000 samples per user.
      if (list.length > 5000) list.splice(0, list.length - 5000);
      saveDebug();
      // Evaluate alert rules on the freshly recorded value.
      const breaches = evaluateRules(s, dbgActor(ctx), metric, value);
      return { ok: true, result: { sample, breaches } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Query a metric as a time-series, optionally bucketed.
  registerLensAction("debug", "metric-series", (ctx, _a, params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      const all = dbgList(s.metrics, dbgActor(ctx));
      const names = [...new Set(all.map((m) => m.metric))];
      const metric = dbgClean(params.metric, 60);
      if (!metric) return { ok: true, result: { series: [], points: [], metrics: names } };
      let pts = all
        .filter((m) => m.metric === metric)
        .map((m) => ({ t: new Date(m.at).getTime(), value: m.value, unit: m.unit }))
        .filter((m) => !isNaN(m.t))
        .sort((a, b) => a.t - b.t);
      const windowMin = dbgNum(params.windowMinutes);
      if (windowMin) {
        const cutoff = Date.now() - windowMin * 60000;
        pts = pts.filter((p) => p.t >= cutoff);
      }
      // Optional bucketing to a fixed point count.
      const buckets = Math.min(200, Math.max(0, dbgNum(params.buckets) || 0));
      let points = pts.map((p) => ({ at: new Date(p.t).toISOString(), value: p.value }));
      if (buckets > 0 && pts.length > buckets) {
        const lo = pts[0].t, hi = pts[pts.length - 1].t;
        const size = Math.max(1, (hi - lo) / buckets);
        points = [];
        for (let i = 0; i < buckets; i++) {
          const bs = lo + i * size, be = bs + size;
          const inB = pts.filter((p) => p.t >= bs && p.t < be);
          if (inB.length) {
            points.push({
              at: new Date(bs).toISOString(),
              value: Math.round((inB.reduce((n, p) => n + p.value, 0) / inB.length) * 100) / 100,
              max: Math.max(...inB.map((p) => p.value)),
              min: Math.min(...inB.map((p) => p.value)),
            });
          }
        }
      }
      const vals = pts.map((p) => p.value);
      const stats = vals.length
        ? {
            count: vals.length,
            avg: Math.round((vals.reduce((n, v) => n + v, 0) / vals.length) * 100) / 100,
            min: Math.min(...vals),
            max: Math.max(...vals),
            latest: vals[vals.length - 1],
          }
        : { count: 0, avg: 0, min: 0, max: 0, latest: 0 };
      return { ok: true, result: { metric, points, stats, metrics: names } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ─── FEATURE: Alert rules ───────────────────────────────────────
  function evaluateRules(s, userId, metric, value) {
    const rules = dbgList(s.alertRules, userId).filter((r) => r.metric === metric && r.enabled);
    const breaches = [];
    for (const rule of rules) {
      let breached = false;
      switch (rule.op) {
        case ">": breached = value > rule.threshold; break;
        case ">=": breached = value >= rule.threshold; break;
        case "<": breached = value < rule.threshold; break;
        case "<=": breached = value <= rule.threshold; break;
        case "==": breached = value === rule.threshold; break;
        default: breached = false;
      }
      const now = new Date().toISOString();
      if (breached) {
        rule.triggerCount = (rule.triggerCount || 0) + 1;
        rule.lastTriggeredAt = now;
        rule.lastValue = value;
        rule.state = "alerting";
        breaches.push({
          ruleId: rule.id, name: rule.name, metric, value,
          op: rule.op, threshold: rule.threshold, severity: rule.severity, at: now,
        });
      } else if (rule.state === "alerting") {
        rule.state = "ok";
        rule.lastValue = value;
      }
    }
    if (breaches.length) saveDebug();
    return breaches;
  }

  registerLensAction("debug", "alert-create", (ctx, _a, params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      const name = dbgClean(params.name, 120);
      const metric = dbgClean(params.metric, 60);
      const threshold = dbgNum(params.threshold);
      if (!name) return { ok: false, error: "rule name required" };
      if (!metric) return { ok: false, error: "metric required" };
      if (threshold == null) return { ok: false, error: "numeric threshold required" };
      if (!ALERT_OPS.includes(params.op)) return { ok: false, error: "op must be one of " + ALERT_OPS.join(" ") };
      const rule = {
        id: dbgId("alert"),
        name, metric, op: params.op, threshold,
        severity: ["critical", "warning", "info"].includes(params.severity) ? params.severity : "warning",
        enabled: params.enabled !== false,
        state: "ok",
        triggerCount: 0,
        lastTriggeredAt: null,
        lastValue: null,
        createdAt: new Date().toISOString(),
      };
      dbgList(s.alertRules, dbgActor(ctx)).push(rule);
      saveDebug();
      return { ok: true, result: { rule } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("debug", "alert-list", (ctx, _a, _params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      const rules = dbgList(s.alertRules, dbgActor(ctx));
      return {
        ok: true,
        result: {
          rules,
          count: rules.length,
          alerting: rules.filter((r) => r.state === "alerting").length,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("debug", "alert-update", (ctx, _a, params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      const rule = dbgList(s.alertRules, dbgActor(ctx)).find((r) => r.id === params.id);
      if (!rule) return { ok: false, error: "rule not found" };
      if (params.name != null) rule.name = dbgClean(params.name, 120) || rule.name;
      if (params.threshold != null) {
        const t = dbgNum(params.threshold);
        if (t != null) rule.threshold = t;
      }
      if (params.op != null && ALERT_OPS.includes(params.op)) rule.op = params.op;
      if (params.severity != null && ["critical", "warning", "info"].includes(params.severity)) rule.severity = params.severity;
      if (params.enabled != null) rule.enabled = !!params.enabled;
      saveDebug();
      return { ok: true, result: { rule } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("debug", "alert-delete", (ctx, _a, params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      const arr = dbgList(s.alertRules, dbgActor(ctx));
      const i = arr.findIndex((r) => r.id === params.id);
      if (i < 0) return { ok: false, error: "rule not found" };
      arr.splice(i, 1);
      saveDebug();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ─── FEATURE: Release tracking ──────────────────────────────────
  // Register a deploy/version; ties errors to a release.
  registerLensAction("debug", "release-create", (ctx, _a, params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      const version = dbgClean(params.version, 60);
      if (!version) return { ok: false, error: "version required" };
      const list = dbgList(s.releases, dbgActor(ctx));
      if (list.some((r) => r.version === version)) return { ok: false, error: "release already tracked" };
      const release = {
        id: dbgId("rel"),
        version,
        environment: dbgClean(params.environment, 40) || "production",
        notes: dbgClean(params.notes, 1000) || "",
        deployedBy: dbgClean(params.deployedBy, 80) || dbgActor(ctx),
        deployedAt: dbgClean(params.deployedAt, 40) || new Date().toISOString(),
      };
      list.push(release);
      saveDebug();
      return { ok: true, result: { release } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // List releases, each annotated with the issues tied to it.
  registerLensAction("debug", "release-list", (ctx, _a, _params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      const userId = dbgActor(ctx);
      const releases = dbgList(s.releases, userId);
      const issues = dbgList(s.issues, userId);
      const annotated = [...releases]
        .sort((a, b) => String(b.deployedAt).localeCompare(String(a.deployedAt)))
        .map((rel) => {
          const tied = issues.filter((i) => (i.releases || []).includes(rel.version));
          return {
            ...rel,
            issueCount: tied.length,
            occurrenceCount: tied.reduce((n, i) => n + i.count, 0),
            newIssues: tied.filter((i) => (i.releases || [])[0] === rel.version).length,
            regressions: tied.filter((i) => i.regressed).length,
            openIssues: tied.filter((i) => i.status === "open").length,
            crashFree: tied.length === 0,
          };
        });
      return { ok: true, result: { releases: annotated, count: annotated.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("debug", "release-delete", (ctx, _a, params = {}) => {
    const s = getDebugState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    try {
      const arr = dbgList(s.releases, dbgActor(ctx));
      const i = arr.findIndex((r) => r.id === params.id);
      if (i < 0) return { ok: false, error: "release not found" };
      arr.splice(i, 1);
      saveDebug();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * logAnalysis
   * Parse and analyze application logs for patterns, error rates, and anomalies.
   * artifact.data.logs = [{ timestamp, level, message, source?, context? }]
   */
  registerLensAction("debug", "logAnalysis", (ctx, artifact, _params) => {
  try {
    const logs = artifact.data?.logs || [];
    if (logs.length === 0) return { ok: true, result: { message: "No logs to analyze." } };

    // Level distribution
    const levelCounts = {};
    for (const log of logs) {
      const level = (log.level || "info").toLowerCase();
      levelCounts[level] = (levelCounts[level] || 0) + 1;
    }

    // Error rate over time (bucket into windows)
    const sorted = [...logs]
      .map(l => ({ ...l, ts: new Date(l.timestamp).getTime() }))
      .filter(l => !isNaN(l.ts))
      .sort((a, b) => a.ts - b.ts);

    const timespan = sorted.length > 1 ? sorted[sorted.length - 1].ts - sorted[0].ts : 0;
    const bucketCount = Math.min(20, Math.max(1, Math.ceil(timespan / 60000))); // 1-min buckets
    const bucketSize = timespan > 0 ? timespan / bucketCount : 1;
    const errorTimeline = [];

    for (let i = 0; i < bucketCount; i++) {
      const start = sorted[0].ts + i * bucketSize;
      const end = start + bucketSize;
      const bucket = sorted.filter(l => l.ts >= start && l.ts < end);
      const errors = bucket.filter(l => ["error", "fatal", "critical"].includes((l.level || "").toLowerCase()));
      errorTimeline.push({
        bucket: i,
        start: new Date(start).toISOString(),
        total: bucket.length,
        errors: errors.length,
        errorRate: bucket.length > 0 ? Math.round((errors.length / bucket.length) * 10000) / 100 : 0,
      });
    }

    // Error spike detection
    const avgErrorRate = errorTimeline.length > 0
      ? errorTimeline.reduce((s, b) => s + b.errorRate, 0) / errorTimeline.length
      : 0;
    const spikes = errorTimeline.filter(b => b.errorRate > avgErrorRate * 2 && b.errors > 2);

    // Message pattern extraction (simple n-gram frequency)
    const patterns = {};
    for (const log of logs) {
      if (!log.message) continue;
      // Normalize: remove numbers, UUIDs, timestamps, hashes
      const normalized = log.message
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
        .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/g, "<TIMESTAMP>")
        .replace(/\b\d+\.\d+\.\d+\.\d+\b/g, "<IP>")
        .replace(/\b[0-9a-f]{32,}\b/gi, "<HASH>")
        .replace(/\b\d{3,}\b/g, "<NUM>")
        .trim();

      patterns[normalized] = (patterns[normalized] || 0) + 1;
    }

    const topPatterns = Object.entries(patterns)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([pattern, count]) => ({ pattern: pattern.slice(0, 150), count, percentage: Math.round((count / logs.length) * 10000) / 100 }));

    // Source hotspots
    const sourceCounts = {};
    const sourceErrors = {};
    for (const log of logs) {
      const src = log.source || "unknown";
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
      if (["error", "fatal", "critical"].includes((log.level || "").toLowerCase())) {
        sourceErrors[src] = (sourceErrors[src] || 0) + 1;
      }
    }
    const sourceHotspots = Object.entries(sourceErrors)
      .map(([source, errors]) => ({
        source, errors, total: sourceCounts[source] || errors,
        errorRate: Math.round((errors / (sourceCounts[source] || errors)) * 10000) / 100,
      }))
      .sort((a, b) => b.errors - a.errors)
      .slice(0, 10);

    // Log volume rate (logs per second)
    const logsPerSecond = timespan > 0 ? Math.round((logs.length / (timespan / 1000)) * 100) / 100 : logs.length;

    return {
      ok: true, result: {
        totalLogs: logs.length,
        levelDistribution: levelCounts,
        errorRate: Math.round((((levelCounts.error || 0) + (levelCounts.fatal || 0) + (levelCounts.critical || 0)) / logs.length) * 10000) / 100,
        logsPerSecond,
        errorTimeline,
        spikes: spikes.length > 0 ? spikes : "none_detected",
        topPatterns,
        sourceHotspots,
        timespan: { start: sorted[0] ? new Date(sorted[0].ts).toISOString() : null, end: sorted.length > 0 ? new Date(sorted[sorted.length - 1].ts).toISOString() : null },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * errorCluster
   * Cluster errors by similarity to identify unique error classes.
   * artifact.data.errors = [{ message, stack?, count?, firstSeen?, lastSeen?, source? }]
   */
  registerLensAction("debug", "errorCluster", (ctx, artifact, _params) => {
  try {
    const errors = artifact.data?.errors || [];
    if (errors.length === 0) return { ok: true, result: { message: "No errors to cluster." } };

    // Normalize error messages for grouping
    function normalize(msg) {
      return (msg || "")
        .replace(/0x[0-9a-fA-F]+/g, "<ADDR>")
        .replace(/\b\d+\b/g, "<N>")
        .replace(/['"][^'"]{0,100}['"]/g, "<STR>")
        .replace(/at .*:\d+:\d+/g, "at <LOC>")
        .replace(/\/[^\s]+/g, "<PATH>")
        .trim()
        .substring(0, 200);
    }

    // Jaccard similarity between two sets of tokens
    function similarity(a, b) {
      const setA = new Set(a.toLowerCase().split(/\s+/));
      const setB = new Set(b.toLowerCase().split(/\s+/));
      const intersection = [...setA].filter(x => setB.has(x)).length;
      const union = new Set([...setA, ...setB]).size;
      return union > 0 ? intersection / union : 0;
    }

    // Agglomerative clustering
    const items = errors.map((e, i) => ({
      ...e, id: i, normalized: normalize(e.message), cluster: i,
    }));

    const threshold = 0.5; // similarity threshold for merging
    let merged = true;
    let iterations = 0;
    while (merged && iterations < 50) {
      merged = false;
      iterations++;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          if (items[i].cluster === items[j].cluster) continue;
          const sim = similarity(items[i].normalized, items[j].normalized);
          if (sim >= threshold) {
            // Merge j's cluster into i's
            const oldCluster = items[j].cluster;
            const newCluster = items[i].cluster;
            items.forEach(item => { if (item.cluster === oldCluster) item.cluster = newCluster; });
            merged = true;
          }
        }
      }
    }

    // Build cluster summaries
    const clusterMap = {};
    for (const item of items) {
      if (!clusterMap[item.cluster]) clusterMap[item.cluster] = [];
      clusterMap[item.cluster].push(item);
    }

    const clusters = Object.entries(clusterMap).map(([clusterId, members]) => {
      // Pick the most common message as representative
      const msgFreq = {};
      for (const m of members) {
        const key = m.normalized;
        msgFreq[key] = (msgFreq[key] || 0) + (m.count || 1);
      }
      const representative = Object.entries(msgFreq).sort((a, b) => b[1] - a[1])[0][0];

      const totalCount = members.reduce((s, m) => s + (m.count || 1), 0);
      const sources = [...new Set(members.map(m => m.source).filter(Boolean))];

      // Extract common stack frame (if available)
      const stacks = members.map(m => m.stack).filter(Boolean);
      let commonFrame = null;
      if (stacks.length > 0) {
        const frames = stacks[0].split('\n').slice(0, 5);
        for (const frame of frames) {
          const trimmed = frame.trim();
          if (stacks.every(s => s.includes(trimmed)) && trimmed.startsWith("at ")) {
            commonFrame = trimmed;
            break;
          }
        }
      }

      return {
        clusterId: parseInt(clusterId),
        representative,
        memberCount: members.length,
        totalOccurrences: totalCount,
        sources,
        commonFrame,
        firstSeen: members.map(m => m.firstSeen).filter(Boolean).sort()[0] || null,
        lastSeen: members.map(m => m.lastSeen).filter(Boolean).sort().pop() || null,
        severity: totalCount > 100 ? "critical" : totalCount > 10 ? "high" : totalCount > 3 ? "medium" : "low",
      };
    }).sort((a, b) => b.totalOccurrences - a.totalOccurrences);

    return {
      ok: true, result: {
        clusters,
        totalErrors: errors.length,
        uniqueClusters: clusters.length,
        deduplicationRatio: errors.length > 0 ? Math.round((1 - clusters.length / errors.length) * 10000) / 100 : 0,
        topCluster: clusters[0],
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * performanceProfile
   * Analyze performance traces to find bottlenecks.
   * artifact.data.traces = [{ name, startMs, endMs, parent?, metadata? }]
   */
  registerLensAction("debug", "performanceProfile", (ctx, artifact, _params) => {
  try {
    const traces = artifact.data?.traces || [];
    if (traces.length === 0) return { ok: true, result: { message: "No traces." } };

    const r = v => Math.round(v * 100) / 100;

    // Compute durations
    const spans = traces.map(t => ({
      ...t,
      duration: (t.endMs || 0) - (t.startMs || 0),
    }));

    // Aggregate by name
    const aggregated = {};
    for (const span of spans) {
      const name = span.name || "unknown";
      if (!aggregated[name]) aggregated[name] = { totalDuration: 0, count: 0, min: Infinity, max: 0, durations: [] };
      aggregated[name].totalDuration += span.duration;
      aggregated[name].count++;
      aggregated[name].min = Math.min(aggregated[name].min, span.duration);
      aggregated[name].max = Math.max(aggregated[name].max, span.duration);
      aggregated[name].durations.push(span.duration);
    }

    const profiles = Object.entries(aggregated).map(([name, data]) => {
      const sorted = data.durations.sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const p99 = sorted[Math.floor(sorted.length * 0.99)];
      const avg = data.totalDuration / data.count;
      const stdDev = Math.sqrt(data.durations.reduce((s, d) => s + Math.pow(d - avg, 2), 0) / data.count);

      return {
        name, invocations: data.count,
        totalMs: r(data.totalDuration),
        avgMs: r(avg), minMs: r(data.min), maxMs: r(data.max),
        p50Ms: r(p50), p95Ms: r(p95), p99Ms: r(p99),
        stdDevMs: r(stdDev),
        percentOfTotal: 0, // filled below
      };
    });

    const totalTime = profiles.reduce((s, p) => s + p.totalMs, 0);
    for (const p of profiles) {
      p.percentOfTotal = totalTime > 0 ? r((p.totalMs / totalTime) * 100) : 0;
    }

    profiles.sort((a, b) => b.totalMs - a.totalMs);

    // Build call tree if parent info available
    const callTree = {};
    for (const span of spans) {
      const parent = span.parent || "__root__";
      if (!callTree[parent]) callTree[parent] = [];
      callTree[parent].push({ name: span.name, duration: span.duration });
    }

    // Self-time computation (time not spent in children)
    const selfTime = {};
    for (const span of spans) {
      const children = spans.filter(s => s.parent === span.name);
      const childTime = children.reduce((s, c) => s + c.duration, 0);
      const self = Math.max(0, span.duration - childTime);
      selfTime[span.name] = (selfTime[span.name] || 0) + self;
    }

    const bottlenecks = Object.entries(selfTime)
      .map(([name, self]) => ({ name, selfTimeMs: r(self), percentSelfTime: totalTime > 0 ? r((self / totalTime) * 100) : 0 }))
      .sort((a, b) => b.selfTimeMs - a.selfTimeMs)
      .slice(0, 10);

    // Detect slow outliers (spans > 2x their average)
    const slowOutliers = spans
      .filter(s => {
        const agg = aggregated[s.name];
        return agg && s.duration > (agg.totalDuration / agg.count) * 2 && s.duration > 10;
      })
      .map(s => ({ name: s.name, durationMs: r(s.duration), avgMs: r(aggregated[s.name].totalDuration / aggregated[s.name].count) }))
      .slice(0, 10);

    return {
      ok: true, result: {
        profiles: profiles.slice(0, 20),
        bottlenecks,
        slowOutliers,
        totalTraces: traces.length,
        totalDurationMs: r(totalTime),
        uniqueOperations: profiles.length,
        hotPath: profiles.slice(0, 3).map(p => p.name),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * stackTraceAnalysis
   * Parse and analyze stack traces to extract root causes and common frames.
   * artifact.data.stackTraces = [{ error, stack, timestamp?, context? }]
   */
  registerLensAction("debug", "stackTraceAnalysis", (ctx, artifact, _params) => {
  try {
    const traces = artifact.data?.stackTraces || [];
    if (traces.length === 0) return { ok: true, result: { message: "No stack traces." } };

    const parsed = traces.map(t => {
      const lines = (t.stack || "").split("\n").map(l => l.trim()).filter(Boolean);
      const errorLine = lines[0] || t.error || "Unknown error";

      // Parse frames
      const frames = lines.slice(1).map(line => {
        // JS-style: "at functionName (file:line:col)" or "at file:line:col"
        const jsMatch = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);
        if (jsMatch) {
          return { fn: jsMatch[1] || "<anonymous>", file: jsMatch[2], line: parseInt(jsMatch[3]), col: parseInt(jsMatch[4]), raw: line };
        }
        // Python-style: 'File "file.py", line N, in function'
        const pyMatch = line.match(/File "(.+?)", line (\d+), in (.+)/);
        if (pyMatch) {
          return { fn: pyMatch[3], file: pyMatch[1], line: parseInt(pyMatch[2]), raw: line };
        }
        return { fn: null, file: null, line: null, raw: line };
      }).filter(f => f.fn || f.file);

      // Classify error type
      const errorType = errorLine.match(/^(\w+Error|\w+Exception)/)?.[1] || "Unknown";

      // Identify user code vs library code
      const userFrames = frames.filter(f => f.file && !f.file.includes("node_modules") && !f.file.includes("site-packages") && !f.file.includes("/lib/"));
      const libraryFrames = frames.filter(f => f.file && (f.file.includes("node_modules") || f.file.includes("site-packages")));

      return {
        error: errorLine, errorType,
        totalFrames: frames.length,
        topUserFrame: userFrames[0] || null,
        topLibraryFrame: libraryFrames[0] || null,
        userFrameCount: userFrames.length,
        libraryFrameCount: libraryFrames.length,
        frames: frames.slice(0, 10),
        timestamp: t.timestamp,
        context: t.context,
      };
    });

    // Find common frames across traces
    const frameFrequency = {};
    for (const p of parsed) {
      const seen = new Set();
      for (const f of p.frames) {
        const key = `${f.file || "?"}:${f.fn || "?"}`;
        if (!seen.has(key)) {
          frameFrequency[key] = (frameFrequency[key] || 0) + 1;
          seen.add(key);
        }
      }
    }

    const commonFrames = Object.entries(frameFrequency)
      .filter(([, count]) => count >= 2)
      .map(([frame, count]) => ({ frame, occurrences: count, percentage: Math.round((count / traces.length) * 100) }))
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 10);

    // Error type distribution
    const errorTypes = {};
    for (const p of parsed) {
      errorTypes[p.errorType] = (errorTypes[p.errorType] || 0) + 1;
    }

    // Root cause candidates (most common top user frames)
    const rootCauses = {};
    for (const p of parsed) {
      if (p.topUserFrame) {
        const key = `${p.topUserFrame.file}:${p.topUserFrame.line} (${p.topUserFrame.fn})`;
        if (!rootCauses[key]) rootCauses[key] = { location: key, errors: [], count: 0 };
        rootCauses[key].count++;
        if (rootCauses[key].errors.length < 3) rootCauses[key].errors.push(p.error);
      }
    }
    const topRootCauses = Object.values(rootCauses).sort((a, b) => b.count - a.count).slice(0, 5);

    return {
      ok: true, result: {
        totalTraces: traces.length,
        errorTypeDistribution: errorTypes,
        parsedTraces: parsed.slice(0, 10),
        commonFrames,
        rootCauseCandidates: topRootCauses,
        userVsLibrary: {
          avgUserFrames: Math.round(parsed.reduce((s, p) => s + p.userFrameCount, 0) / parsed.length * 10) / 10,
          avgLibraryFrames: Math.round(parsed.reduce((s, p) => s + p.libraryFrameCount, 0) / parsed.length * 10) / 10,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
