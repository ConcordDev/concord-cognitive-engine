// server/domains/observe.js
// Domain actions for the observe lens — Datadog-shape observability.
//
// Original 4 macros (serviceLog / incidentTrack / alertSummary / sloCheck)
// operate over the generic /api/lens artifact store.
//
// The 2026 parity backlog adds a full per-user telemetry platform:
//  - Live metrics ingestion + time-series query (metricIngest / metricQuery / metricList)
//  - Dashboards — composable widget grids with saved layouts
//  - Log search / query language — full-text + faceted search
//  - Distributed tracing / APM — span waterfall + service-map graph
//  - Alert rule editor — threshold/anomaly monitor CRUD + evaluation
//  - Synthetic monitoring — scheduled uptime / API checks
//  - Incident on-call paging + notification routing
//
// Persistent per-user data lives in globalThis._concordSTATE Maps keyed
// by userId. Every handler returns { ok, result?, error? } and never throws.

export default function registerObserveActions(registerLensAction) {
  // ---- per-user STATE -------------------------------------------------
  function getObserveState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.observeLens) STATE.observeLens = {};
    const s = STATE.observeLens;
    if (!(s.metrics instanceof Map)) s.metrics = new Map();      // userId -> Map<metricName, Array<{ts,value,tags}>>
    if (!(s.dashboards instanceof Map)) s.dashboards = new Map(); // userId -> Array<dashboard>
    if (!(s.logs instanceof Map)) s.logs = new Map();            // userId -> Array<logEntry>
    if (!(s.traces instanceof Map)) s.traces = new Map();        // userId -> Array<trace>
    if (!(s.monitors instanceof Map)) s.monitors = new Map();    // userId -> Array<monitor>
    if (!(s.synthetics instanceof Map)) s.synthetics = new Map();// userId -> Array<syntheticCheck>
    if (!(s.oncall instanceof Map)) s.oncall = new Map();        // userId -> { schedule, routes, pages }
    return s;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const oId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const oNow = () => new Date().toISOString();
  const actor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const clean = (v, max = 280) => String(v == null ? "" : v).trim().slice(0, max);
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  function listFor(map, userId) { if (!map.has(userId)) map.set(userId, []); return map.get(userId); }

  // ====================================================================
  // ORIGINAL ARTIFACT-STORE MACROS (unchanged)
  // ====================================================================

  /** serviceLog — summarise a service's recent log entries. */
  registerLensAction("observe", "serviceLog", (_ctx, artifact, params = {}) => {
    const entries = artifact.data?.entries || [];
    if (entries.length === 0) return { ok: true, result: { message: "No log entries.", count: 0 } };
    const win = parseInt(params.windowMinutes, 10) || 60;
    const cutoff = Date.now() - win * 60 * 1000;
    const recent = entries.filter((e) => new Date(e.ts || 0).getTime() >= cutoff);
    const byLevel = {};
    for (const e of recent) {
      const lvl = (e.level || "info").toUpperCase();
      byLevel[lvl] = (byLevel[lvl] || 0) + 1;
    }
    const errorRate = recent.length > 0 ? Math.round(((byLevel.ERROR || 0) / recent.length) * 10000) / 100 : 0;
    const topService = (() => {
      const c = {};
      for (const e of recent) { const s = e.service || "unknown"; c[s] = (c[s] || 0) + 1; }
      return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
    })();
    return { ok: true, result: { windowMinutes: win, count: recent.length, byLevel, errorRate, topService } };
  });

  /** incidentTrack — open an incident artifact entry. */
  registerLensAction("observe", "incidentTrack", (_ctx, artifact, params = {}) => {
    const incidents = artifact.data?.incidents || [];
    const sev = ["sev1", "sev2", "sev3", "sev4"].includes(params.severity) ? params.severity : "sev3";
    const incident = {
      id: `inc-${Date.now()}`,
      title: params.title || "Untitled incident",
      severity: sev,
      affectedService: params.affectedService || "unknown",
      status: "open",
      openedAt: new Date().toISOString(),
      timeline: [{ at: new Date().toISOString(), event: "opened" }],
    };
    incidents.push(incident);
    artifact.data = { ...artifact.data, incidents };
    return { ok: true, result: { incident, total: incidents.length } };
  });

  /** alertSummary — group alerts by service + severity. */
  registerLensAction("observe", "alertSummary", (_ctx, artifact, _params) => {
    const alerts = artifact.data?.alerts || [];
    if (alerts.length === 0) return { ok: true, result: { message: "No alerts in window.", total: 0 } };
    const now = Date.now();
    const firing = alerts.filter((a) => !a.resolved_at);
    const resolved = alerts.filter((a) => a.resolved_at);
    const meanResolveMin = resolved.length > 0
      ? Math.round(resolved.reduce((s, a) => s + (new Date(a.resolved_at).getTime() - new Date(a.fired_at).getTime()) / 60000, 0) / resolved.length)
      : null;
    const byService = {};
    for (const a of alerts) {
      const s = a.service || "unknown";
      if (!byService[s]) byService[s] = { firing: 0, resolved: 0 };
      if (a.resolved_at) byService[s].resolved++; else byService[s].firing++;
    }
    return {
      ok: true,
      result: { total: alerts.length, firingNow: firing.length, resolved: resolved.length, meanResolveMin, byService, generatedAt: new Date(now).toISOString() },
    };
  });

  /** sloCheck — check an SLO target against recent uptime. */
  registerLensAction("observe", "sloCheck", (_ctx, _artifact, params = {}) => {
    const target = parseFloat(params.targetPct) || 99.9;
    const actual = parseFloat(params.actualPct);
    if (!Number.isFinite(actual)) return { ok: false, reason: "actualPct required" };
    const windowDays = parseInt(params.windowDays, 10) || 30;
    const errorBudgetPct = (100 - target);
    const burnRate = (100 - actual) / errorBudgetPct;
    const status = actual >= target ? "healthy" : burnRate > 2 ? "critical" : burnRate > 1 ? "burning" : "watch";
    return {
      ok: true,
      result: {
        targetPct: target, actualPct: actual, windowDays,
        errorBudgetPct: Math.round(errorBudgetPct * 1000) / 1000,
        burnRate: Math.round(burnRate * 100) / 100,
        status,
        remainingBudgetMinutes: Math.max(0, Math.round((target - (100 - actual)) / 100 * windowDays * 24 * 60)),
      },
    };
  });

  // ====================================================================
  // FEATURE 1 — LIVE METRICS INGESTION + TIME-SERIES
  // ====================================================================

  /** metricIngest — push one or many time-series points. */
  registerLensAction("observe", "metricIngest", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const uid = actor(ctx);
      if (!s.metrics.has(uid)) s.metrics.set(uid, new Map());
      const userMetrics = s.metrics.get(uid);
      let points = [];
      if (Array.isArray(params.points)) points = params.points;
      else if (params.metric != null) points = [{ metric: params.metric, value: params.value, ts: params.ts, tags: params.tags }];
      if (points.length === 0) return { ok: false, error: "no points supplied" };
      let ingested = 0;
      for (const p of points) {
        const name = clean(p.metric || params.metric, 80);
        if (!name) continue;
        const value = num(p.value, NaN);
        if (!Number.isFinite(value)) continue;
        const ts = p.ts ? new Date(p.ts).getTime() || Date.now() : Date.now();
        if (!userMetrics.has(name)) userMetrics.set(name, []);
        const series = userMetrics.get(name);
        series.push({ ts, value, tags: p.tags && typeof p.tags === "object" ? p.tags : {} });
        // bounded ring buffer — keep last 5000 points per metric
        if (series.length > 5000) series.splice(0, series.length - 5000);
        ingested++;
      }
      save();
      return { ok: true, result: { ingested, metrics: [...userMetrics.keys()].length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /** metricList — list known metric names + point counts. */
  registerLensAction("observe", "metricList", (ctx) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userMetrics = s.metrics.get(actor(ctx));
      if (!userMetrics) return { ok: true, result: { metrics: [] } };
      const metrics = [...userMetrics.entries()].map(([name, series]) => ({
        name,
        points: series.length,
        latest: series.length ? series[series.length - 1].value : null,
        lastTs: series.length ? series[series.length - 1].ts : null,
      }));
      return { ok: true, result: { metrics } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /** metricQuery — time-series query with windowing + aggregation rollup. */
  registerLensAction("observe", "metricQuery", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const name = clean(params.metric, 80);
      if (!name) return { ok: false, error: "metric name required" };
      const userMetrics = s.metrics.get(actor(ctx));
      const series = userMetrics?.get(name) || [];
      const winMin = num(params.windowMinutes, 60);
      const cutoff = Date.now() - winMin * 60 * 1000;
      let pts = series.filter((p) => p.ts >= cutoff);
      // optional tag filter
      if (params.tagKey && params.tagValue != null) {
        pts = pts.filter((p) => String(p.tags?.[params.tagKey]) === String(params.tagValue));
      }
      const buckets = Math.max(1, Math.min(200, num(params.buckets, 30)));
      const span = Math.max(1, Date.now() - cutoff);
      const step = span / buckets;
      const agg = ["avg", "sum", "min", "max", "count", "last"].includes(params.agg) ? params.agg : "avg";
      const grid = [];
      for (let i = 0; i < buckets; i++) {
        const lo = cutoff + i * step;
        const hi = lo + step;
        const inBucket = pts.filter((p) => p.ts >= lo && p.ts < hi).map((p) => p.value);
        let v = null;
        if (inBucket.length) {
          if (agg === "sum") v = inBucket.reduce((a, b) => a + b, 0);
          else if (agg === "min") v = Math.min(...inBucket);
          else if (agg === "max") v = Math.max(...inBucket);
          else if (agg === "count") v = inBucket.length;
          else if (agg === "last") v = inBucket[inBucket.length - 1];
          else v = inBucket.reduce((a, b) => a + b, 0) / inBucket.length;
          v = Math.round(v * 1000) / 1000;
        }
        grid.push({ ts: Math.round(lo), label: new Date(lo).toISOString().slice(11, 16), value: v });
      }
      const vals = pts.map((p) => p.value);
      const stats = vals.length ? {
        count: vals.length,
        min: Math.min(...vals),
        max: Math.max(...vals),
        avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000,
        last: vals[vals.length - 1],
      } : { count: 0, min: null, max: null, avg: null, last: null };
      return { ok: true, result: { metric: name, agg, windowMinutes: winMin, series: grid, stats } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ====================================================================
  // FEATURE 2 — DASHBOARDS (composable widget grids, saved layouts)
  // ====================================================================

  /** dashboardSave — create or update a dashboard layout. */
  registerLensAction("observe", "dashboardSave", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const uid = actor(ctx);
      const list = listFor(s.dashboards, uid);
      const title = clean(params.title || "Untitled dashboard", 120);
      const widgets = Array.isArray(params.widgets) ? params.widgets.slice(0, 40).map((w) => ({
        id: clean(w.id || oId("wg"), 40),
        kind: ["timeseries", "query_value", "toplist", "slo", "alert_count", "log_stream", "trace_map", "note"]
          .includes(w.kind) ? w.kind : "note",
        title: clean(w.title || "", 80),
        metric: clean(w.metric || "", 80),
        agg: clean(w.agg || "avg", 12),
        x: num(w.x, 0), y: num(w.y, 0), w: num(w.w, 6), h: num(w.h, 4),
        text: clean(w.text || "", 400),
      })) : [];
      let dash = params.id ? list.find((d) => d.id === params.id) : null;
      if (dash) {
        dash.title = title;
        dash.widgets = widgets;
        dash.updatedAt = oNow();
      } else {
        dash = { id: oId("dash"), title, widgets, createdAt: oNow(), updatedAt: oNow() };
        list.push(dash);
      }
      save();
      return { ok: true, result: { dashboard: dash, total: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /** dashboardList — all saved dashboards for the user. */
  registerLensAction("observe", "dashboardList", (ctx) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const list = s.dashboards.get(actor(ctx)) || [];
      return { ok: true, result: { dashboards: list, total: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /** dashboardDelete — remove a dashboard. */
  registerLensAction("observe", "dashboardDelete", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const list = s.dashboards.get(actor(ctx)) || [];
      const idx = list.findIndex((d) => d.id === params.id);
      if (idx < 0) return { ok: false, error: "dashboard not found" };
      list.splice(idx, 1);
      save();
      return { ok: true, result: { deleted: params.id, total: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ====================================================================
  // FEATURE 3 — LOG SEARCH / QUERY LANGUAGE
  // ====================================================================

  /** logIngest — push log lines into the searchable per-user log store. */
  registerLensAction("observe", "logIngest", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const uid = actor(ctx);
      const store = listFor(s.logs, uid);
      let lines = [];
      if (Array.isArray(params.entries)) lines = params.entries;
      else if (params.message != null) lines = [params];
      if (lines.length === 0) return { ok: false, error: "no log entries supplied" };
      let ingested = 0;
      for (const l of lines) {
        const message = clean(l.message, 600);
        if (!message) continue;
        store.push({
          id: oId("log"),
          ts: l.ts ? (new Date(l.ts).getTime() || Date.now()) : Date.now(),
          level: clean(l.level || "info", 12).toLowerCase(),
          service: clean(l.service || "unknown", 60),
          message,
          tags: l.tags && typeof l.tags === "object" ? l.tags : {},
        });
        ingested++;
      }
      if (store.length > 20000) store.splice(0, store.length - 20000);
      save();
      return { ok: true, result: { ingested, total: store.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * logSearch — full-text + faceted log search.
   *   params.query     free-text substring (case-insensitive)
   *   params.level     filter by level
   *   params.service   filter by service
   *   params.windowMinutes  time window (default 1440)
   *   params.limit     max rows (default 200)
   * Supports a tiny query DSL: `level:error service:api timeout`.
   */
  registerLensAction("observe", "logSearch", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const store = s.logs.get(actor(ctx)) || [];
      const winMin = num(params.windowMinutes, 1440);
      const cutoff = Date.now() - winMin * 60 * 1000;
      let level = clean(params.level, 12).toLowerCase();
      let service = clean(params.service, 60);
      // DSL parse: pull `key:value` tokens out of the free-text query
      let text = clean(params.query, 200);
      const terms = [];
      for (const tok of text.split(/\s+/)) {
        const m = tok.match(/^(level|service):(.+)$/i);
        if (m) {
          if (m[1].toLowerCase() === "level") level = m[2].toLowerCase();
          else service = m[2];
        } else if (tok) terms.push(tok.toLowerCase());
      }
      let rows = store.filter((r) => r.ts >= cutoff);
      if (level) rows = rows.filter((r) => r.level === level);
      if (service) rows = rows.filter((r) => r.service.toLowerCase().includes(service.toLowerCase()));
      if (terms.length) rows = rows.filter((r) => {
        const hay = r.message.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
      rows.sort((a, b) => b.ts - a.ts);
      // facets over the matched set
      const facet = (key) => {
        const c = {};
        for (const r of rows) { const v = r[key] || "unknown"; c[v] = (c[v] || 0) + 1; }
        return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
      };
      const limit = Math.max(1, Math.min(1000, num(params.limit, 200)));
      return {
        ok: true,
        result: {
          matched: rows.length,
          results: rows.slice(0, limit),
          facets: { level: facet("level"), service: facet("service") },
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ====================================================================
  // FEATURE 4 — DISTRIBUTED TRACING / APM
  // ====================================================================

  /**
   * traceIngest — record a trace as a set of spans.
   *   params.spans = [{ id, parentId?, service, name, startMs, durationMs }]
   */
  registerLensAction("observe", "traceIngest", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const uid = actor(ctx);
      const store = listFor(s.traces, uid);
      const rawSpans = Array.isArray(params.spans) ? params.spans : [];
      if (rawSpans.length === 0) return { ok: false, error: "spans required" };
      const spans = rawSpans.slice(0, 200).map((sp) => ({
        id: clean(sp.id || oId("sp"), 40),
        parentId: sp.parentId ? clean(sp.parentId, 40) : null,
        service: clean(sp.service || "unknown", 60),
        name: clean(sp.name || "span", 80),
        startMs: num(sp.startMs, 0),
        durationMs: Math.max(0, num(sp.durationMs, 0)),
        error: !!sp.error,
      }));
      const traceId = clean(params.traceId || oId("trace"), 48);
      const totalMs = Math.max(...spans.map((sp) => sp.startMs + sp.durationMs), 0)
        - Math.min(...spans.map((sp) => sp.startMs), 0);
      const trace = {
        id: traceId,
        rootService: spans.find((sp) => !sp.parentId)?.service || spans[0].service,
        rootName: spans.find((sp) => !sp.parentId)?.name || spans[0].name,
        spanCount: spans.length,
        totalMs: Math.round(totalMs),
        hasError: spans.some((sp) => sp.error),
        ts: Date.now(),
        spans,
      };
      store.push(trace);
      if (store.length > 2000) store.splice(0, store.length - 2000);
      save();
      return { ok: true, result: { traceId, spanCount: spans.length, totalMs: trace.totalMs } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /** traceList — recent traces (waterfall summary). */
  registerLensAction("observe", "traceList", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const store = s.traces.get(actor(ctx)) || [];
      const limit = Math.max(1, Math.min(200, num(params.limit, 50)));
      let rows = [...store];
      if (params.errorsOnly) rows = rows.filter((t) => t.hasError);
      rows.sort((a, b) => b.ts - a.ts);
      const traces = rows.slice(0, limit).map((t) => ({
        id: t.id, rootService: t.rootService, rootName: t.rootName,
        spanCount: t.spanCount, totalMs: t.totalMs, hasError: t.hasError, ts: t.ts,
      }));
      return { ok: true, result: { traces, total: store.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /** traceDetail — full span waterfall for one trace. */
  registerLensAction("observe", "traceDetail", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const store = s.traces.get(actor(ctx)) || [];
      const t = store.find((x) => x.id === params.traceId);
      if (!t) return { ok: false, error: "trace not found" };
      const minStart = Math.min(...t.spans.map((sp) => sp.startMs), 0);
      const span = Math.max(1, t.totalMs);
      const waterfall = t.spans
        .slice()
        .sort((a, b) => a.startMs - b.startMs)
        .map((sp) => ({
          ...sp,
          offsetPct: Math.round(((sp.startMs - minStart) / span) * 10000) / 100,
          widthPct: Math.round((sp.durationMs / span) * 10000) / 100,
        }));
      return { ok: true, result: { trace: { ...t, waterfall } } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /** serviceMap — dependency graph derived from recorded trace spans. */
  registerLensAction("observe", "serviceMap", (ctx) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const store = s.traces.get(actor(ctx)) || [];
      const nodes = new Map();   // service -> { calls, errors, totalMs }
      const edges = new Map();   // "a->b" -> count
      for (const t of store) {
        const byId = new Map(t.spans.map((sp) => [sp.id, sp]));
        for (const sp of t.spans) {
          if (!nodes.has(sp.service)) nodes.set(sp.service, { service: sp.service, calls: 0, errors: 0, totalMs: 0 });
          const n = nodes.get(sp.service);
          n.calls++; n.totalMs += sp.durationMs; if (sp.error) n.errors++;
          if (sp.parentId && byId.has(sp.parentId)) {
            const parent = byId.get(sp.parentId);
            if (parent.service !== sp.service) {
              const key = `${parent.service}->${sp.service}`;
              edges.set(key, (edges.get(key) || 0) + 1);
            }
          }
        }
      }
      return {
        ok: true,
        result: {
          nodes: [...nodes.values()].map((n) => ({
            service: n.service, calls: n.calls, errors: n.errors,
            avgMs: n.calls ? Math.round(n.totalMs / n.calls) : 0,
          })),
          edges: [...edges.entries()].map(([k, count]) => {
            const [from, to] = k.split("->");
            return { from, to, count };
          }),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ====================================================================
  // FEATURE 5 — ALERT RULE EDITOR (threshold / anomaly monitors)
  // ====================================================================

  /** monitorSave — create or update a metric monitor. */
  registerLensAction("observe", "monitorSave", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const uid = actor(ctx);
      const list = listFor(s.monitors, uid);
      const metric = clean(params.metric, 80);
      if (!metric) return { ok: false, error: "metric required" };
      const op = [">", ">=", "<", "<=", "=="].includes(params.op) ? params.op : ">";
      const type = ["threshold", "anomaly"].includes(params.type) ? params.type : "threshold";
      const agg = ["avg", "sum", "min", "max", "last"].includes(params.agg) ? params.agg : "avg";
      let mon = params.id ? list.find((m) => m.id === params.id) : null;
      const fields = {
        name: clean(params.name || `${metric} ${op} ${params.threshold}`, 120),
        type, metric, op, agg,
        threshold: num(params.threshold, 0),
        windowMinutes: num(params.windowMinutes, 15),
        sigma: num(params.sigma, 3),            // anomaly band width
        severity: ["sev1", "sev2", "sev3", "sev4"].includes(params.severity) ? params.severity : "sev3",
        enabled: params.enabled !== false,
        notifyRoute: clean(params.notifyRoute || "", 60),
      };
      if (mon) {
        Object.assign(mon, fields);
        mon.updatedAt = oNow();
      } else {
        mon = { id: oId("mon"), ...fields, state: "ok", createdAt: oNow(), updatedAt: oNow(), lastEval: null };
        list.push(mon);
      }
      save();
      return { ok: true, result: { monitor: mon, total: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /** monitorList — all monitors for the user. */
  registerLensAction("observe", "monitorList", (ctx) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const list = s.monitors.get(actor(ctx)) || [];
      return { ok: true, result: { monitors: list, total: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /** monitorDelete — remove a monitor. */
  registerLensAction("observe", "monitorDelete", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const list = s.monitors.get(actor(ctx)) || [];
      const idx = list.findIndex((m) => m.id === params.id);
      if (idx < 0) return { ok: false, error: "monitor not found" };
      list.splice(idx, 1);
      save();
      return { ok: true, result: { deleted: params.id, total: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * monitorEvaluate — run every (or one) monitor against live metric data.
   * Threshold monitors compare the aggregate; anomaly monitors flag when
   * the latest aggregate falls outside mean ± sigma·stddev of the window.
   */
  registerLensAction("observe", "monitorEvaluate", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const uid = actor(ctx);
      const list = s.monitors.get(uid) || [];
      const userMetrics = s.metrics.get(uid) || new Map();
      const target = params.id ? list.filter((m) => m.id === params.id) : list.filter((m) => m.enabled);
      const evaluations = [];
      for (const mon of target) {
        const series = userMetrics.get(mon.metric) || [];
        const cutoff = Date.now() - mon.windowMinutes * 60 * 1000;
        const vals = series.filter((p) => p.ts >= cutoff).map((p) => p.value);
        let value = null, breached = false, reason = "no data";
        if (vals.length) {
          if (mon.agg === "sum") value = vals.reduce((a, b) => a + b, 0);
          else if (mon.agg === "min") value = Math.min(...vals);
          else if (mon.agg === "max") value = Math.max(...vals);
          else if (mon.agg === "last") value = vals[vals.length - 1];
          else value = vals.reduce((a, b) => a + b, 0) / vals.length;
          value = Math.round(value * 1000) / 1000;
          if (mon.type === "anomaly") {
            const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
            const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
            const std = Math.sqrt(variance);
            const upper = mean + mon.sigma * std;
            const lower = mean - mon.sigma * std;
            breached = value > upper || value < lower;
            reason = breached
              ? `${value} outside ${Math.round(lower * 100) / 100}…${Math.round(upper * 100) / 100} band`
              : "within anomaly band";
          } else {
            const t = mon.threshold;
            breached = mon.op === ">" ? value > t
              : mon.op === ">=" ? value >= t
              : mon.op === "<" ? value < t
              : mon.op === "<=" ? value <= t
              : value === t;
            reason = breached ? `${value} ${mon.op} ${t}` : `${value} within threshold`;
          }
        }
        const newState = breached ? "alert" : (vals.length ? "ok" : "no_data");
        mon.state = newState;
        mon.lastEval = oNow();
        mon.lastValue = value;
        evaluations.push({ id: mon.id, name: mon.name, state: newState, value, breached, reason, severity: mon.severity });
      }
      save();
      const alerting = evaluations.filter((e) => e.breached);
      return { ok: true, result: { evaluated: evaluations.length, alerting: alerting.length, evaluations } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ====================================================================
  // FEATURE 6 — SYNTHETIC MONITORING (scheduled uptime / API checks)
  // ====================================================================

  /** syntheticSave — create or update a synthetic uptime / API check. */
  registerLensAction("observe", "syntheticSave", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const uid = actor(ctx);
      const list = listFor(s.synthetics, uid);
      const url = clean(params.url, 400);
      if (!url) return { ok: false, error: "url required" };
      let chk = params.id ? list.find((c) => c.id === params.id) : null;
      const reqMethod = String(params.method || "GET").toUpperCase();
      const fields = {
        name: clean(params.name || url, 120),
        url,
        method: ["GET", "POST", "HEAD"].includes(reqMethod) ? reqMethod : "GET",
        intervalMinutes: Math.max(1, num(params.intervalMinutes, 5)),
        expectStatus: num(params.expectStatus, 200),
        expectSubstring: clean(params.expectSubstring || "", 200),
        timeoutMs: Math.max(500, num(params.timeoutMs, 10000)),
        enabled: params.enabled !== false,
      };
      if (chk) {
        Object.assign(chk, fields);
        chk.updatedAt = oNow();
      } else {
        chk = { id: oId("syn"), ...fields, status: "pending", lastRun: null, uptimePct: null, history: [], createdAt: oNow(), updatedAt: oNow() };
        list.push(chk);
      }
      save();
      return { ok: true, result: { check: chk, total: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /** syntheticList — all synthetic checks. */
  registerLensAction("observe", "syntheticList", (ctx) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const list = s.synthetics.get(actor(ctx)) || [];
      return { ok: true, result: { checks: list, total: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /** syntheticDelete — remove a synthetic check. */
  registerLensAction("observe", "syntheticDelete", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const list = s.synthetics.get(actor(ctx)) || [];
      const idx = list.findIndex((c) => c.id === params.id);
      if (idx < 0) return { ok: false, error: "check not found" };
      list.splice(idx, 1);
      save();
      return { ok: true, result: { deleted: params.id, total: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * syntheticRun — execute a synthetic check now. Performs a real HTTP
   * request and records latency / status into the check's history.
   */
  registerLensAction("observe", "syntheticRun", async (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const list = s.synthetics.get(actor(ctx)) || [];
      const chk = list.find((c) => c.id === params.id);
      if (!chk) return { ok: false, error: "check not found" };
      const started = Date.now();
      let ok = false, statusCode = 0, errText = null, latencyMs = 0;
      try {
        const ctl = new AbortController();
        const to = setTimeout(() => ctl.abort(), chk.timeoutMs);
        const res = await fetch(chk.url, { method: chk.method, signal: ctl.signal });
        clearTimeout(to);
        latencyMs = Date.now() - started;
        statusCode = res.status;
        let body = "";
        if (chk.expectSubstring) { try { body = await res.text(); } catch (_e) { body = ""; } }
        ok = res.status === chk.expectStatus
          && (!chk.expectSubstring || body.includes(chk.expectSubstring));
      } catch (e) {
        latencyMs = Date.now() - started;
        errText = e?.name === "AbortError" ? "timeout" : String(e?.message || e);
      }
      const run = { ts: started, ok, statusCode, latencyMs, error: errText };
      chk.history.push(run);
      if (chk.history.length > 200) chk.history.splice(0, chk.history.length - 200);
      chk.lastRun = oNow();
      chk.status = ok ? "up" : "down";
      const passes = chk.history.filter((h) => h.ok).length;
      chk.uptimePct = Math.round((passes / chk.history.length) * 10000) / 100;
      save();
      return { ok: true, result: { check: { id: chk.id, name: chk.name, status: chk.status, uptimePct: chk.uptimePct }, run } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ====================================================================
  // FEATURE 7 — INCIDENT ON-CALL PAGING + NOTIFICATION ROUTING
  // ====================================================================

  /** oncallSetup — define on-call schedule + notification routes. */
  registerLensAction("observe", "oncallSetup", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const uid = actor(ctx);
      const cur = s.oncall.get(uid) || { schedule: [], routes: [], pages: [] };
      if (Array.isArray(params.schedule)) {
        cur.schedule = params.schedule.slice(0, 50).map((sl) => ({
          person: clean(sl.person, 80),
          startsAt: clean(sl.startsAt || oNow(), 40),
          endsAt: clean(sl.endsAt || "", 40),
        })).filter((sl) => sl.person);
      }
      if (Array.isArray(params.routes)) {
        cur.routes = params.routes.slice(0, 30).map((r) => ({
          id: clean(r.id || oId("route"), 40),
          name: clean(r.name || "route", 60),
          channel: ["dm", "email", "webhook", "sms"].includes(r.channel) ? r.channel : "dm",
          target: clean(r.target, 200),
          minSeverity: ["sev1", "sev2", "sev3", "sev4"].includes(r.minSeverity) ? r.minSeverity : "sev3",
        })).filter((r) => r.target);
      }
      s.oncall.set(uid, cur);
      save();
      return { ok: true, result: { schedule: cur.schedule, routes: cur.routes } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /** oncallStatus — current on-call person + configured routes. */
  registerLensAction("observe", "oncallStatus", (ctx) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const cur = s.oncall.get(actor(ctx)) || { schedule: [], routes: [], pages: [] };
      const now = Date.now();
      const current = cur.schedule.find((sl) => {
        const start = Date.parse(sl.startsAt) || 0;
        const end = sl.endsAt ? (Date.parse(sl.endsAt) || Infinity) : Infinity;
        return now >= start && now <= end;
      }) || null;
      const recentPages = (cur.pages || []).slice(-20).reverse();
      return { ok: true, result: { current, schedule: cur.schedule, routes: cur.routes, recentPages } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * pageOnCall — page the on-call engineer. Severity-routes the page to
   * every matching notification route (sev1 reaches every route, sev4
   * only sev4-or-broader routes) and records it in the page log.
   */
  registerLensAction("observe", "pageOnCall", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const uid = actor(ctx);
      const cur = s.oncall.get(uid) || { schedule: [], routes: [], pages: [] };
      const sevRank = { sev1: 1, sev2: 2, sev3: 3, sev4: 4 };
      const severity = ["sev1", "sev2", "sev3", "sev4"].includes(params.severity) ? params.severity : "sev3";
      const summary = clean(params.summary || "Page", 280);
      const now = Date.now();
      const current = cur.schedule.find((sl) => {
        const start = Date.parse(sl.startsAt) || 0;
        const end = sl.endsAt ? (Date.parse(sl.endsAt) || Infinity) : Infinity;
        return now >= start && now <= end;
      }) || null;
      // a route fires if the incident is at least as severe as the route's floor
      const fired = (cur.routes || []).filter((r) => sevRank[severity] <= sevRank[r.minSeverity || "sev3"])
        .map((r) => ({ route: r.name, channel: r.channel, target: r.target }));
      const page = {
        id: oId("page"),
        severity, summary,
        incidentId: clean(params.incidentId || "", 48),
        pagedPerson: current?.person || "unassigned",
        routesFired: fired,
        ackedBy: null,
        at: oNow(),
      };
      if (!Array.isArray(cur.pages)) cur.pages = [];
      cur.pages.push(page);
      if (cur.pages.length > 500) cur.pages.splice(0, cur.pages.length - 500);
      s.oncall.set(uid, cur);
      save();
      return { ok: true, result: { page, routesNotified: fired.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /** acknowledgePage — acknowledge a paged incident. */
  registerLensAction("observe", "acknowledgePage", (ctx, _artifact, params = {}) => {
    try {
      const s = getObserveState();
      if (!s) return { ok: false, error: "state unavailable" };
      const uid = actor(ctx);
      const cur = s.oncall.get(uid);
      if (!cur || !Array.isArray(cur.pages)) return { ok: false, error: "no pages" };
      const page = cur.pages.find((p) => p.id === params.id);
      if (!page) return { ok: false, error: "page not found" };
      page.ackedBy = clean(params.ackedBy || uid, 80);
      page.ackedAt = oNow();
      save();
      return { ok: true, result: { page } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
