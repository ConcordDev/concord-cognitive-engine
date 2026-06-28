// server/domains/analytics.js
// Domain actions for analytics: funnel analysis, cohort analysis,
// metric aggregation, anomaly detection, trend forecasting.

export default function registerAnalyticsActions(registerLensAction) {
  // Fail-CLOSED numeric coercion. parseFloat("1e999")/parseFloat("Infinity")
  // both return Infinity (truthy → a bare `|| 0` does NOT catch them), which
  // then poisons mean/stdDev/slope/forecast to Infinity → JSON-serialised as
  // `null` and rendered blank in the component (a silent fail-OPEN over a
  // poisoned numeric). finNum collapses any non-finite (Infinity/-Infinity/NaN)
  // to 0 so every computed value stays a real finite number.
  const finNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const finInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
  // Round but never emit Infinity/NaN (defence-in-depth; finNum already gates inputs).
  const safeRound = (v, p = 100) => { const n = v * p; return Number.isFinite(n) ? Math.round(n) / p : 0; };

  registerLensAction("analytics", "funnelAnalysis", (ctx, artifact, _params) => {
    try {
      const stages = Array.isArray(artifact.data?.stages) ? artifact.data.stages : [];
      if (stages.length < 2) return { ok: true, result: { message: "Add at least 2 funnel stages with counts." } };
      const topCount = finInt(stages[0]?.count);
      const analyzed = stages.map((s, i) => {
        const count = finInt(s?.count);
        const prevCount = i > 0 ? (finInt(stages[i - 1]?.count) || 1) : count;
        const dropoff = i > 0 && prevCount > 0 ? Math.round((1 - count / prevCount) * 100) : 0;
        const conversionFromTop = topCount > 0 ? Math.round((count / topCount) * 100) : 0;
        return { stage: (s?.name != null ? String(s.name) : "") || `Stage ${i + 1}`, count, dropoff, conversionFromTop };
      });
      const worstDropoff = analyzed.slice(1).sort((a, b) => b.dropoff - a.dropoff)[0];
      return { ok: true, result: { stages: analyzed, overallConversion: analyzed[analyzed.length - 1]?.conversionFromTop || 0, worstDropoff: worstDropoff?.stage, worstDropoffRate: worstDropoff?.dropoff } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  registerLensAction("analytics", "cohortAnalysis", (ctx, artifact, _params) => {
    try {
      const cohorts = Array.isArray(artifact.data?.cohorts) ? artifact.data.cohorts : [];
      if (cohorts.length === 0) return { ok: true, result: { message: "Add cohort data with retention periods." } };
      const analyzed = cohorts.map(c => {
        const initial = finInt(c?.initialUsers);
        const retention = Array.isArray(c?.retention) ? c.retention : [];
        const periods = retention.map((r, i) => ({
          period: i + 1, retained: finInt(r), rate: initial > 0 ? Math.round((finInt(r) / initial) * 100) : 0,
        }));
        return { cohort: (c?.name != null ? String(c.name) : (c?.period != null ? String(c.period) : "")) || "(unnamed)", initialUsers: initial, retentionCurve: periods, avgRetention: periods.length > 0 ? Math.round(periods.reduce((s, p) => s + p.rate, 0) / periods.length) : 0 };
      });
      return { ok: true, result: { cohorts: analyzed, bestCohort: [...analyzed].sort((a, b) => b.avgRetention - a.avgRetention)[0]?.cohort } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  registerLensAction("analytics", "detectAnomalies", (ctx, artifact, _params) => {
    try {
      const dataPoints = Array.isArray(artifact.data?.dataPoints) ? artifact.data.dataPoints : [];
      if (dataPoints.length < 5) return { ok: true, result: { message: "Need at least 5 data points for anomaly detection." } };
      const values = dataPoints.map(d => finNum(d?.value));
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const stdDev = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length);
      const threshold = 2; // 2 standard deviations
      const anomalies = dataPoints.map((d, i) => {
        const val = finNum(d?.value);
        const zScore = stdDev > 0 ? (val - mean) / stdDev : 0;
        return { date: (d?.date != null ? String(d.date) : (d?.label != null ? String(d.label) : `Point ${i}`)), value: val, zScore: safeRound(zScore), isAnomaly: Math.abs(zScore) > threshold, direction: zScore > 0 ? "high" : "low" };
      }).filter(a => a.isAnomaly);
      return { ok: true, result: { mean: safeRound(mean), stdDev: safeRound(stdDev), totalPoints: dataPoints.length, anomaliesFound: anomalies.length, anomalies, threshold: `${threshold} std deviations` } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  registerLensAction("analytics", "trendForecast", (ctx, artifact, _params) => {
    try {
      const dataPoints = Array.isArray(artifact.data?.dataPoints) ? artifact.data.dataPoints : [];
      if (dataPoints.length < 3) return { ok: true, result: { message: "Need at least 3 data points for forecasting." } };
      const values = dataPoints.map(d => finNum(d?.value));
      const n = values.length;
      // Simple linear regression
      const xMean = (n - 1) / 2;
      const yMean = values.reduce((s, v) => s + v, 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) { num += (i - xMean) * (values[i] - yMean); den += Math.pow(i - xMean, 2); }
      const slope = den !== 0 ? num / den : 0;
      const intercept = yMean - slope * xMean;
      const forecast = [1, 2, 3, 5, 7].map(p => ({ periodsAhead: p, predicted: safeRound(slope * (n - 1 + p) + intercept) }));
      const trend = slope > 0.01 ? "upward" : slope < -0.01 ? "downward" : "flat";
      return { ok: true, result: { trend, slope: safeRound(slope, 1000), dataPoints: n, lastValue: values[n - 1], forecast, confidence: n >= 10 ? "moderate" : "low" } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  // ─── Mixpanel / Amplitude-shape event analytics (per-user, STATE) ────
  // Event-based model: track events, then compute funnels, retention,
  // segmentation and saved reports over the stored event log.

  function getAnalyticsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.analyticsLens) STATE.analyticsLens = {};
    const s = STATE.analyticsLens;
    if (!(s.events instanceof Map)) s.events = new Map();       // userId -> Array<event>
    if (!(s.funnels instanceof Map)) s.funnels = new Map();     // userId -> Array<funnel def>
    if (!(s.dashboards instanceof Map)) s.dashboards = new Map(); // userId -> Array<dashboard def>
    if (!(s.alerts instanceof Map)) s.alerts = new Map();       // userId -> Array<alert def>
    if (!(s.cohorts instanceof Map)) s.cohorts = new Map();     // userId -> Array<behavioral cohort def>
    return s;
  }
  function saveAnalytics() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const anId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const anNow = () => new Date().toISOString();
  const anActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const anClean = (v, max = 120) => String(v == null ? "" : v).trim().slice(0, max);
  const anEvents = (s, userId) => { if (!s.events.has(userId)) s.events.set(userId, []); return s.events.get(userId); };
  const anFunnels = (s, userId) => { if (!s.funnels.has(userId)) s.funnels.set(userId, []); return s.funnels.get(userId); };
  const anDashboards = (s, userId) => { if (!s.dashboards.has(userId)) s.dashboards.set(userId, []); return s.dashboards.get(userId); };
  const anAlerts = (s, userId) => { if (!s.alerts.has(userId)) s.alerts.set(userId, []); return s.alerts.get(userId); };
  const anCohorts = (s, userId) => { if (!s.cohorts.has(userId)) s.cohorts.set(userId, []); return s.cohorts.get(userId); };
  const EVENT_CAP = 50000;

  // Parse an ISO date / null into a YYYY-MM-DD bound; returns null if invalid.
  const anDateBound = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };
  // Apply a from/to date window + property filters to an event log.
  // filters: Array<{ key, op ('eq'|'neq'|'contains'|'gt'|'lt'), value }>
  function applyEventFilters(log, params = {}) {
    const from = anDateBound(params.from);
    const to = anDateBound(params.to);
    let out = log;
    if (from) out = out.filter((e) => e.at.slice(0, 10) >= from);
    if (to) out = out.filter((e) => e.at.slice(0, 10) <= to);
    const filters = Array.isArray(params.filters) ? params.filters : [];
    for (const f of filters) {
      const key = anClean(f.key, 40);
      const op = anClean(f.op, 12) || "eq";
      if (!key) continue;
      if (key === "__event_name__") {
        const val = anClean(f.value, 80);
        out = out.filter((e) => e.name === val);
        continue;
      }
      out = out.filter((e) => {
        const pv = e.properties?.[key];
        if (op === "neq") return String(pv ?? "") !== String(f.value ?? "");
        if (op === "contains") return String(pv ?? "").toLowerCase().includes(String(f.value ?? "").toLowerCase());
        if (op === "gt") return (parseFloat(pv) || 0) > (parseFloat(f.value) || 0);
        if (op === "lt") return (parseFloat(pv) || 0) < (parseFloat(f.value) || 0);
        return String(pv ?? "") === String(f.value ?? "");
      });
    }
    return out;
  }

  registerLensAction("analytics", "event-track", (ctx, _a, params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = anClean(params.name, 80);
    if (!name) return { ok: false, error: "event name required" };
    const props = {};
    if (params.properties && typeof params.properties === "object") {
      for (const [k, v] of Object.entries(params.properties).slice(0, 20)) {
        props[anClean(k, 40)] = typeof v === "number" ? v : anClean(v, 200);
      }
    }
    const event = {
      id: anId("ev"),
      name,
      distinctId: anClean(params.distinctId, 80) || "anon",
      properties: props,
      at: params.at && !Number.isNaN(new Date(params.at).getTime()) ? new Date(params.at).toISOString() : anNow(),
    };
    const log = anEvents(s, anActor(ctx));
    log.push(event);
    if (log.length > EVENT_CAP) log.splice(0, log.length - EVENT_CAP);
    saveAnalytics();
    return { ok: true, result: { event, total: log.length } };
  });

  registerLensAction("analytics", "event-list", (ctx, _a, params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let log = [...anEvents(s, anActor(ctx))];
    if (params.name) log = log.filter((e) => e.name === params.name);
    if (params.distinctId) log = log.filter((e) => e.distinctId === params.distinctId);
    log.sort((a, b) => b.at.localeCompare(a.at));
    return { ok: true, result: { events: log.slice(0, 100), total: log.length } };
  });

  registerLensAction("analytics", "event-stats", (ctx, _a, _params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const log = anEvents(s, anActor(ctx));
    const byName = {};
    const users = new Set();
    for (const e of log) {
      byName[e.name] = (byName[e.name] || 0) + 1;
      users.add(e.distinctId);
    }
    const topEvents = Object.entries(byName).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    return {
      ok: true,
      result: {
        totalEvents: log.length,
        uniqueUsers: users.size,
        distinctEventTypes: topEvents.length,
        topEvents: topEvents.slice(0, 15),
      },
    };
  });

  // funnel-compute — conversion through ordered event steps. A user
  // counts toward step i only if they fired step 0..i in time order.
  function computeFunnel(log, steps) {
    const byUser = {};
    for (const e of log) {
      (byUser[e.distinctId] = byUser[e.distinctId] || []).push(e);
    }
    const stepCounts = steps.map(() => 0);
    let totalStarters = 0;
    for (const events of Object.values(byUser)) {
      events.sort((a, b) => a.at.localeCompare(b.at));
      let stepIdx = 0;
      let lastAt = "";
      for (const e of events) {
        if (e.name === steps[stepIdx] && e.at >= lastAt) {
          lastAt = e.at;
          stepIdx++;
          if (stepIdx > steps.length) break;
        }
      }
      if (stepIdx >= 1) totalStarters++;
      for (let i = 0; i < stepIdx && i < steps.length; i++) stepCounts[i]++;
    }
    const first = stepCounts[0] || 0;
    return {
      steps: steps.map((name, i) => ({
        step: i + 1, event: name, count: stepCounts[i],
        conversionFromStart: first > 0 ? Math.round((stepCounts[i] / first) * 1000) / 10 : 0,
        conversionFromPrev: i === 0 ? 100 : (stepCounts[i - 1] > 0 ? Math.round((stepCounts[i] / stepCounts[i - 1]) * 1000) / 10 : 0),
      })),
      totalStarters,
      overallConversion: first > 0 ? Math.round((stepCounts[stepCounts.length - 1] / first) * 1000) / 10 : 0,
    };
  }

  registerLensAction("analytics", "funnel-build", (ctx, _a, params = {}) => {
  try {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const steps = Array.isArray(params.steps) ? params.steps.map((x) => anClean(x, 80)).filter(Boolean) : [];
    if (steps.length < 2) return { ok: false, error: "funnel needs at least 2 event steps" };
    return { ok: true, result: computeFunnel(anEvents(s, anActor(ctx)), steps) };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("analytics", "funnel-save", (ctx, _a, params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = anClean(params.name, 100);
    const steps = Array.isArray(params.steps) ? params.steps.map((x) => anClean(x, 80)).filter(Boolean) : [];
    if (!name || steps.length < 2) return { ok: false, error: "name + 2+ steps required" };
    const funnel = { id: anId("fn"), name, steps, createdAt: anNow() };
    anFunnels(s, anActor(ctx)).push(funnel);
    saveAnalytics();
    return { ok: true, result: { funnel } };
  });

  registerLensAction("analytics", "funnel-list", (ctx, _a, _params = {}) => {
  try {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const log = anEvents(s, anActor(ctx));
    const funnels = anFunnels(s, anActor(ctx)).map((f) => ({ ...f, result: computeFunnel(log, f.steps) }));
    return { ok: true, result: { funnels, count: funnels.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("analytics", "funnel-delete", (ctx, _a, params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = anFunnels(s, anActor(ctx));
    const i = arr.findIndex((f) => f.id === params.id);
    if (i < 0) return { ok: false, error: "funnel not found" };
    arr.splice(i, 1);
    saveAnalytics();
    return { ok: true, result: { deleted: params.id } };
  });

  // segment — break an event's volume down by a property value.
  registerLensAction("analytics", "segment", (ctx, _a, params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const eventName = anClean(params.eventName, 80);
    const propKey = anClean(params.propertyKey, 40);
    if (!eventName || !propKey) return { ok: false, error: "eventName + propertyKey required" };
    const log = anEvents(s, anActor(ctx)).filter((e) => e.name === eventName);
    const buckets = {};
    for (const e of log) {
      const v = String(e.properties?.[propKey] ?? "(not set)");
      buckets[v] = (buckets[v] || 0) + 1;
    }
    const segments = Object.entries(buckets)
      .map(([value, count]) => ({ value, count, pct: log.length > 0 ? Math.round((count / log.length) * 1000) / 10 : 0 }))
      .sort((a, b) => b.count - a.count);
    return { ok: true, result: { eventName, propertyKey: propKey, total: log.length, segments } };
  });

  // retention — of users who did cohortEvent on a day, how many did
  // returnEvent on each of the following days (up to 7).
  registerLensAction("analytics", "retention-report", (ctx, _a, params = {}) => {
  try {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const cohortEvent = anClean(params.cohortEvent, 80);
    const returnEvent = anClean(params.returnEvent, 80) || cohortEvent;
    if (!cohortEvent) return { ok: false, error: "cohortEvent required" };
    const log = anEvents(s, anActor(ctx));
    const cohortByUser = {};
    const returnDaysByUser = {};
    for (const e of log) {
      const day = e.at.slice(0, 10);
      if (e.name === cohortEvent && (!cohortByUser[e.distinctId] || day < cohortByUser[e.distinctId])) {
        cohortByUser[e.distinctId] = day;
      }
      if (e.name === returnEvent) {
        (returnDaysByUser[e.distinctId] = returnDaysByUser[e.distinctId] || new Set()).add(day);
      }
    }
    const cohortSize = Object.keys(cohortByUser).length;
    const dayMs = 86400000;
    const retention = [];
    for (let d = 0; d <= 7; d++) {
      let retained = 0;
      for (const [user, startDay] of Object.entries(cohortByUser)) {
        const target = new Date(new Date(startDay).getTime() + d * dayMs).toISOString().slice(0, 10);
        if (returnDaysByUser[user]?.has(target)) retained++;
      }
      retention.push({ day: d, retained, pct: cohortSize > 0 ? Math.round((retained / cohortSize) * 1000) / 10 : 0 });
    }
    return { ok: true, result: { cohortEvent, returnEvent, cohortSize, retention } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("analytics", "analytics-dashboard", (ctx, _a, _params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = anActor(ctx);
    const log = anEvents(s, userId);
    const users = new Set(log.map((e) => e.distinctId));
    const today = new Date().toISOString().slice(0, 10);
    return {
      ok: true,
      result: {
        totalEvents: log.length,
        uniqueUsers: users.size,
        eventsToday: log.filter((e) => e.at.slice(0, 10) === today).length,
        savedFunnels: anFunnels(s, userId).length,
        savedDashboards: anDashboards(s, userId).length,
        savedAlerts: anAlerts(s, userId).length,
        behavioralCohorts: anCohorts(s, userId).length,
        eventTypes: new Set(log.map((e) => e.name)).size,
      },
    };
  });

  // ─── [M] Custom report builder — saved dashboards + widget layout ────
  // A dashboard is { id, name, widgets: [{ id, kind, title, config, x,y,w,h }] }.
  // kind ∈ metric|trend|funnel|segment|topEvents — each computed live.
  const WIDGET_KINDS = new Set(["metric", "trend", "funnel", "segment", "topEvents", "retention"]);

  function computeWidget(log, w) {
    const cfg = w.config || {};
    const scoped = applyEventFilters(log, cfg);
    if (w.kind === "metric") {
      const name = anClean(cfg.eventName, 80);
      const matched = name ? scoped.filter((e) => e.name === name) : scoped;
      const metric = anClean(cfg.metric, 16) || "count";
      if (metric === "unique") return { value: new Set(matched.map((e) => e.distinctId)).size };
      return { value: matched.length };
    }
    if (w.kind === "trend") {
      const name = anClean(cfg.eventName, 80);
      const matched = name ? scoped.filter((e) => e.name === name) : scoped;
      const byDay = {};
      for (const e of matched) { const d = e.at.slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; }
      return { series: Object.entries(byDay).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)) };
    }
    if (w.kind === "topEvents") {
      const byName = {};
      for (const e of scoped) byName[e.name] = (byName[e.name] || 0) + 1;
      return { rows: Object.entries(byName).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10) };
    }
    if (w.kind === "funnel") {
      const steps = Array.isArray(cfg.steps) ? cfg.steps.map((x) => anClean(x, 80)).filter(Boolean) : [];
      if (steps.length < 2) return { message: "funnel widget needs 2+ steps" };
      return computeFunnel(scoped, steps);
    }
    if (w.kind === "segment") {
      const eventName = anClean(cfg.eventName, 80);
      const propKey = anClean(cfg.propertyKey, 40);
      if (!eventName || !propKey) return { message: "segment widget needs eventName + propertyKey" };
      const matched = scoped.filter((e) => e.name === eventName);
      const buckets = {};
      for (const e of matched) { const v = String(e.properties?.[propKey] ?? "(not set)"); buckets[v] = (buckets[v] || 0) + 1; }
      return { segments: Object.entries(buckets).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count) };
    }
    return { message: "unknown widget kind" };
  }

  function sanitizeWidgets(input) {
    const arr = Array.isArray(input) ? input : [];
    return arr.slice(0, 24).map((w, i) => ({
      id: anClean(w.id, 40) || anId("wg"),
      kind: WIDGET_KINDS.has(w.kind) ? w.kind : "metric",
      title: anClean(w.title, 80) || `Widget ${i + 1}`,
      config: (w.config && typeof w.config === "object") ? w.config : {},
      x: Math.max(0, parseInt(w.x) || 0),
      y: Math.max(0, parseInt(w.y) || 0),
      w: Math.min(12, Math.max(1, parseInt(w.w) || 4)),
      h: Math.min(12, Math.max(1, parseInt(w.h) || 3)),
    }));
  }

  registerLensAction("analytics", "dashboard-save", (ctx, _a, params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = anClean(params.name, 100);
    if (!name) return { ok: false, error: "dashboard name required" };
    const arr = anDashboards(s, anActor(ctx));
    const widgets = sanitizeWidgets(params.widgets);
    if (params.id) {
      const d = arr.find((x) => x.id === params.id);
      if (!d) return { ok: false, error: "dashboard not found" };
      d.name = name; d.widgets = widgets; d.updatedAt = anNow();
      saveAnalytics();
      return { ok: true, result: { dashboard: d } };
    }
    const dashboard = { id: anId("db"), name, widgets, createdAt: anNow(), updatedAt: anNow() };
    arr.push(dashboard);
    saveAnalytics();
    return { ok: true, result: { dashboard } };
  });

  registerLensAction("analytics", "dashboard-list", (ctx, _a, _params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = anDashboards(s, anActor(ctx));
    return { ok: true, result: { dashboards: arr.map((d) => ({ id: d.id, name: d.name, widgetCount: d.widgets.length, createdAt: d.createdAt, updatedAt: d.updatedAt })), count: arr.length } };
  });

  registerLensAction("analytics", "dashboard-get", (ctx, _a, params = {}) => {
  try {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const d = anDashboards(s, anActor(ctx)).find((x) => x.id === params.id);
    if (!d) return { ok: false, error: "dashboard not found" };
    const log = anEvents(s, anActor(ctx));
    const widgets = d.widgets.map((w) => ({ ...w, data: computeWidget(log, w) }));
    return { ok: true, result: { dashboard: { ...d, widgets } } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("analytics", "dashboard-delete", (ctx, _a, params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = anDashboards(s, anActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "dashboard not found" };
    arr.splice(i, 1);
    saveAnalytics();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── [M] User-path / flow analysis — Sankey of common journeys ──────
  // Builds a directed graph of step-to-step transitions across each
  // user's time-ordered event sequence. Optional anchorEvent pins the
  // journey to begin at that event.
  registerLensAction("analytics", "path-analysis", (ctx, _a, params = {}) => {
  try {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const log = applyEventFilters(anEvents(s, anActor(ctx)), params);
    if (log.length === 0) return { ok: true, result: { nodes: [], links: [], journeys: 0, message: "no data yet" } };
    const anchor = anClean(params.anchorEvent, 80);
    const maxSteps = Math.min(8, Math.max(2, parseInt(params.maxSteps) || 5));
    const byUser = {};
    for (const e of log) (byUser[e.distinctId] = byUser[e.distinctId] || []).push(e);
    const linkMap = new Map(); // "src→dst" -> count
    const nodeSet = new Set();
    let journeys = 0;
    for (const events of Object.values(byUser)) {
      events.sort((a, b) => a.at.localeCompare(b.at));
      let seq = events.map((e) => e.name);
      if (anchor) {
        const idx = seq.indexOf(anchor);
        if (idx < 0) continue;
        seq = seq.slice(idx);
      }
      seq = seq.slice(0, maxSteps);
      if (seq.length < 2) continue;
      journeys++;
      for (let i = 0; i < seq.length - 1; i++) {
        const src = `${i}:${seq[i]}`;
        const dst = `${i + 1}:${seq[i + 1]}`;
        nodeSet.add(src); nodeSet.add(dst);
        const key = src + ">>" + dst;
        const existing = linkMap.get(key);
        if (existing) existing.value++;
        else linkMap.set(key, { source: src, target: dst, value: 1 });
      }
    }
    const nodes = [...nodeSet].map((id) => {
      const sep = id.indexOf(":");
      return { id, depth: parseInt(id.slice(0, sep), 10), event: id.slice(sep + 1) };
    }).sort((a, b) => a.depth - b.depth);
    const links = [...linkMap.values()].sort((a, b) => b.value - a.value);
    return { ok: true, result: { nodes, links, journeys, anchorEvent: anchor || null } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── [S] Multi-dimensional property breakdown ──────────────────────
  // Break an event's volume down across up to 2 property dimensions,
  // honouring the shared date-range + filter params.
  registerLensAction("analytics", "breakdown", (ctx, _a, params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const eventName = anClean(params.eventName, 80);
    const dims = Array.isArray(params.dimensions)
      ? params.dimensions.map((d) => anClean(d, 40)).filter(Boolean).slice(0, 2)
      : [];
    if (!eventName) return { ok: false, error: "eventName required" };
    if (dims.length === 0) return { ok: false, error: "at least 1 dimension required" };
    let log = applyEventFilters(anEvents(s, anActor(ctx)), params).filter((e) => e.name === eventName);
    const metric = anClean(params.metric, 16) || "count";
    const buckets = new Map(); // dimKey -> { keys, count, users:Set }
    for (const e of log) {
      const keys = dims.map((d) => String(e.properties?.[d] ?? "(not set)"));
      const k = keys.join("");
      let b = buckets.get(k);
      if (!b) { b = { keys, count: 0, users: new Set() }; buckets.set(k, b); }
      b.count++; b.users.add(e.distinctId);
    }
    const rows = [...buckets.values()].map((b) => {
      const value = metric === "unique" ? b.users.size : b.count;
      return { dimensions: b.keys, count: b.count, uniqueUsers: b.users.size, value };
    }).sort((a, b) => b.value - a.value);
    const grand = metric === "unique" ? new Set(log.map((e) => e.distinctId)).size : log.length;
    return { ok: true, result: { eventName, dimensions: dims, metric, total: grand, rows } };
  });

  // ─── [M] Live event stream / debugger view ─────────────────────────
  // Returns the most recent events newest-first, optionally only those
  // newer than a `since` ISO timestamp (cursor for incremental polling).
  registerLensAction("analytics", "event-stream", (ctx, _a, params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let log = [...anEvents(s, anActor(ctx))];
    const since = params.since && !Number.isNaN(new Date(params.since).getTime())
      ? new Date(params.since).toISOString() : null;
    if (since) log = log.filter((e) => e.at > since);
    if (params.name) log = log.filter((e) => e.name === anClean(params.name, 80));
    if (params.distinctId) log = log.filter((e) => e.distinctId === anClean(params.distinctId, 80));
    log.sort((a, b) => b.at.localeCompare(a.at));
    const limit = Math.min(200, Math.max(1, parseInt(params.limit) || 50));
    const slice = log.slice(0, limit);
    return {
      ok: true,
      result: {
        events: slice,
        returned: slice.length,
        matched: log.length,
        cursor: slice.length > 0 ? slice[0].at : (since || anNow()),
      },
    };
  });

  // ─── [S] Alerts on metric thresholds or anomalies ──────────────────
  // An alert is { id, name, eventName, metric, kind ('threshold'|'anomaly'),
  // op ('gt'|'lt'), threshold, window (days) }. alert-evaluate computes
  // the live value and reports whether the alert is firing.
  function evaluateAlert(log, a) {
    const windowDays = Math.min(90, Math.max(1, parseInt(a.window) || 7));
    const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);
    const scoped = log.filter((e) => e.at.slice(0, 10) >= cutoff && (!a.eventName || e.name === a.eventName));
    let value;
    if (a.metric === "unique") value = new Set(scoped.map((e) => e.distinctId)).size;
    else value = scoped.length;
    let firing = false, detail = "";
    if (a.kind === "anomaly") {
      // per-day series z-score on the latest day
      const byDay = {};
      for (const e of scoped) { const d = e.at.slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; }
      const days = Object.keys(byDay).sort();
      if (days.length >= 5) {
        const vals = days.map((d) => byDay[d]);
        const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
        const sd = Math.sqrt(vals.reduce((x, y) => x + Math.pow(y - mean, 2), 0) / vals.length);
        const last = vals[vals.length - 1];
        const z = sd > 0 ? (last - mean) / sd : 0;
        firing = Math.abs(z) > 2;
        value = last;
        detail = `latest day z-score ${Math.round(z * 100) / 100}`;
      } else {
        detail = "needs 5+ days of data";
      }
    } else {
      const t = parseFloat(a.threshold) || 0;
      firing = a.op === "lt" ? value < t : value > t;
      detail = `${value} ${a.op === "lt" ? "<" : ">"} ${t} → ${firing ? "fired" : "ok"}`;
    }
    return { value, firing, detail };
  }

  registerLensAction("analytics", "alert-save", (ctx, _a, params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = anClean(params.name, 100);
    if (!name) return { ok: false, error: "alert name required" };
    const kind = params.kind === "anomaly" ? "anomaly" : "threshold";
    const op = params.op === "lt" ? "lt" : "gt";
    const metric = params.metric === "unique" ? "unique" : "count";
    if (kind === "threshold" && params.threshold == null) return { ok: false, error: "threshold required for threshold alert" };
    const arr = anAlerts(s, anActor(ctx));
    const def = {
      name, kind, op, metric,
      eventName: anClean(params.eventName, 80) || "",
      threshold: parseFloat(params.threshold) || 0,
      window: Math.min(90, Math.max(1, parseInt(params.window) || 7)),
    };
    if (params.id) {
      const a = arr.find((x) => x.id === params.id);
      if (!a) return { ok: false, error: "alert not found" };
      Object.assign(a, def, { updatedAt: anNow() });
      saveAnalytics();
      return { ok: true, result: { alert: a } };
    }
    const alert = { id: anId("al"), ...def, createdAt: anNow(), updatedAt: anNow() };
    arr.push(alert);
    saveAnalytics();
    return { ok: true, result: { alert } };
  });

  registerLensAction("analytics", "alert-list", (ctx, _a, _params = {}) => {
  try {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const log = anEvents(s, anActor(ctx));
    const alerts = anAlerts(s, anActor(ctx)).map((a) => ({ ...a, ...evaluateAlert(log, a) }));
    return { ok: true, result: { alerts, count: alerts.length, firing: alerts.filter((a) => a.firing).length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("analytics", "alert-evaluate", (ctx, _a, params = {}) => {
  try {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const a = anAlerts(s, anActor(ctx)).find((x) => x.id === params.id);
    if (!a) return { ok: false, error: "alert not found" };
    return { ok: true, result: { alert: { ...a, ...evaluateAlert(anEvents(s, anActor(ctx)), a) } } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("analytics", "alert-delete", (ctx, _a, params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = anAlerts(s, anActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "alert not found" };
    arr.splice(i, 1);
    saveAnalytics();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── [M] Behavioral cohort builder — users who did X but not Y ──────
  // A cohort def is { id, name, includes: [eventName], excludes: [eventName] }.
  // cohort-compute resolves the matching distinctIds against the event log.
  function computeCohort(log, def) {
    const byUser = {};
    for (const e of log) (byUser[e.distinctId] = byUser[e.distinctId] || new Set()).add(e.name);
    const includes = Array.isArray(def.includes) ? def.includes.map((x) => anClean(x, 80)).filter(Boolean) : [];
    const excludes = Array.isArray(def.excludes) ? def.excludes.map((x) => anClean(x, 80)).filter(Boolean) : [];
    const members = [];
    for (const [user, names] of Object.entries(byUser)) {
      const hasAllIncludes = includes.every((n) => names.has(n));
      const hasAnyExclude = excludes.some((n) => names.has(n));
      if (hasAllIncludes && !hasAnyExclude) members.push(user);
    }
    const totalUsers = Object.keys(byUser).length;
    return {
      includes, excludes,
      members: members.sort(),
      size: members.length,
      totalUsers,
      pct: totalUsers > 0 ? Math.round((members.length / totalUsers) * 1000) / 10 : 0,
    };
  }

  registerLensAction("analytics", "cohort-build", (ctx, _a, params = {}) => {
  try {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const includes = Array.isArray(params.includes) ? params.includes.map((x) => anClean(x, 80)).filter(Boolean) : [];
    const excludes = Array.isArray(params.excludes) ? params.excludes.map((x) => anClean(x, 80)).filter(Boolean) : [];
    if (includes.length === 0 && excludes.length === 0) return { ok: false, error: "cohort needs at least one include or exclude event" };
    const log = applyEventFilters(anEvents(s, anActor(ctx)), params);
    return { ok: true, result: computeCohort(log, { includes, excludes }) };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("analytics", "cohort-save", (ctx, _a, params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = anClean(params.name, 100);
    const includes = Array.isArray(params.includes) ? params.includes.map((x) => anClean(x, 80)).filter(Boolean) : [];
    const excludes = Array.isArray(params.excludes) ? params.excludes.map((x) => anClean(x, 80)).filter(Boolean) : [];
    if (!name) return { ok: false, error: "cohort name required" };
    if (includes.length === 0 && excludes.length === 0) return { ok: false, error: "cohort needs at least one include or exclude event" };
    const arr = anCohorts(s, anActor(ctx));
    if (params.id) {
      const c = arr.find((x) => x.id === params.id);
      if (!c) return { ok: false, error: "cohort not found" };
      c.name = name; c.includes = includes; c.excludes = excludes; c.updatedAt = anNow();
      saveAnalytics();
      return { ok: true, result: { cohort: c } };
    }
    const cohort = { id: anId("co"), name, includes, excludes, createdAt: anNow(), updatedAt: anNow() };
    arr.push(cohort);
    saveAnalytics();
    return { ok: true, result: { cohort } };
  });

  registerLensAction("analytics", "cohort-list", (ctx, _a, _params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const log = anEvents(s, anActor(ctx));
    const cohorts = anCohorts(s, anActor(ctx)).map((c) => ({ ...c, result: computeCohort(log, c) }));
    return { ok: true, result: { cohorts, count: cohorts.length } };
  });

  registerLensAction("analytics", "cohort-delete", (ctx, _a, params = {}) => {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = anCohorts(s, anActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "cohort not found" };
    arr.splice(i, 1);
    saveAnalytics();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── [S] Date-range comparison across reports ──────────────────────
  // Compare an event metric between two date windows (current vs prior),
  // returning per-window value, absolute delta and pct change.
  registerLensAction("analytics", "range-compare", (ctx, _a, params = {}) => {
  try {
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const a = params.current || {};
    const b = params.previous || {};
    const aFrom = anDateBound(a.from), aTo = anDateBound(a.to);
    const bFrom = anDateBound(b.from), bTo = anDateBound(b.to);
    if (!aFrom || !aTo || !bFrom || !bTo) return { ok: false, error: "current and previous each need {from,to}" };
    const eventName = anClean(params.eventName, 80);
    const metric = anClean(params.metric, 16) || "count";
    const log = anEvents(s, anActor(ctx));
    const measure = (from, to) => {
      const scoped = log.filter((e) => {
        const d = e.at.slice(0, 10);
        return d >= from && d <= to && (!eventName || e.name === eventName);
      });
      return metric === "unique" ? new Set(scoped.map((e) => e.distinctId)).size : scoped.length;
    };
    const curVal = measure(aFrom, aTo);
    const prevVal = measure(bFrom, bTo);
    const delta = curVal - prevVal;
    const pctChange = prevVal > 0 ? Math.round((delta / prevVal) * 1000) / 10 : (curVal > 0 ? 100 : 0);
    return {
      ok: true,
      result: {
        eventName: eventName || "(all events)",
        metric,
        current: { from: aFrom, to: aTo, value: curVal },
        previous: { from: bFrom, to: bTo, value: prevVal },
        delta,
        pctChange,
        direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── World + Global structural analytics (REAL, DB-backed) ──────────
  // Aggregate genuine per-world / cross-world facts from the live SQLite
  // tables (worlds, world_events, world_buildings, world_visits, dtus).
  // Every count is a real query; absent tables degrade to honest zeros and
  // a `hasData:false`/empty shape — NEVER fabricated rows.
  const anTableExists = (db, name) => {
    try {
      return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    } catch (_e) { return false; }
  };
  const anCount = (db, sql, ...args) => {
    try {
      const row = db.prepare(sql).get(...args);
      const v = row ? Object.values(row)[0] : 0;
      return Number.isFinite(Number(v)) ? Number(v) : 0;
    } catch (_e) { return 0; }
  };

  // world-summary — real analytics for a single world. Counts active
  // presence (open visits), buildings, world events, and world-tagged DTUs.
  registerLensAction("analytics", "world-summary", (ctx, _a, params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "db unavailable" };
      const worldId = anClean(params.worldId || params.world_id, 120);
      if (!worldId) return { ok: false, error: "worldId required" };

      const hasWorlds = anTableExists(db, "worlds");
      const hasEvents = anTableExists(db, "world_events");
      const hasBuildings = anTableExists(db, "world_buildings");
      const hasVisits = anTableExists(db, "world_visits");
      const hasDtus = anTableExists(db, "dtus");

      let worldName = null;
      let population = 0;
      let totalVisits = 0;
      let npcCount = 0;
      let status = null;
      if (hasWorlds) {
        try {
          const w = db.prepare(
            "SELECT name, population, total_visits, npc_count, status FROM worlds WHERE id = ?"
          ).get(worldId);
          if (w) {
            worldName = w.name ?? null;
            population = Number(w.population) || 0;
            totalVisits = Number(w.total_visits) || 0;
            npcCount = Number(w.npc_count) || 0;
            status = w.status ?? null;
          }
        } catch (_e) { /* column drift — degrade to zeros */ }
      }
      const found = worldName !== null || status !== null;

      const buildingCount = hasBuildings
        ? anCount(db, "SELECT COUNT(*) AS c FROM world_buildings WHERE world_id = ?", worldId) : 0;
      const standingBuildings = hasBuildings
        ? anCount(db, "SELECT COUNT(*) AS c FROM world_buildings WHERE world_id = ? AND state = 'standing'", worldId) : 0;
      const eventCount = hasEvents
        ? anCount(db, "SELECT COUNT(*) AS c FROM world_events WHERE world_id = ?", worldId) : 0;
      // Players currently present = visits with no departed_at.
      const activePresence = hasVisits
        ? anCount(db, "SELECT COUNT(*) AS c FROM world_visits WHERE world_id = ? AND departed_at IS NULL", worldId) : 0;
      const uniqueVisitors = hasVisits
        ? anCount(db, "SELECT COUNT(DISTINCT user_id) AS c FROM world_visits WHERE world_id = ?", worldId) : 0;
      const taggedDtus = hasDtus
        ? anCount(db, "SELECT COUNT(*) AS c FROM dtus WHERE world_id = ?", worldId) : 0;

      const infraCoverage = buildingCount > 0
        ? Math.round((standingBuildings / buildingCount) * 100) : 0;

      return {
        ok: true,
        result: {
          worldId,
          worldName,
          found,
          status,
          population,
          npcCount,
          buildingCount,
          standingBuildings,
          infraCoverage,
          eventCount,
          activePresence,
          uniqueVisitors,
          totalVisits,
          taggedDtus,
        },
      };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  // global-summary — real cross-world / platform aggregate. Total worlds,
  // total buildings, total events, total/public DTUs, and the most-active
  // worlds by building count.
  registerLensAction("analytics", "global-summary", (ctx, _a, _params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "db unavailable" };

      const hasWorlds = anTableExists(db, "worlds");
      const hasEvents = anTableExists(db, "world_events");
      const hasBuildings = anTableExists(db, "world_buildings");
      const hasVisits = anTableExists(db, "world_visits");
      const hasDtus = anTableExists(db, "dtus");
      const hasCitations = anTableExists(db, "dtu_citations");

      const totalWorlds = hasWorlds
        ? anCount(db, "SELECT COUNT(*) AS c FROM worlds") : 0;
      const activeWorlds = hasWorlds
        ? anCount(db, "SELECT COUNT(*) AS c FROM worlds WHERE status = 'active'") : 0;
      const totalBuildings = hasBuildings
        ? anCount(db, "SELECT COUNT(*) AS c FROM world_buildings") : 0;
      const totalEvents = hasEvents
        ? anCount(db, "SELECT COUNT(*) AS c FROM world_events") : 0;
      const totalDtus = hasDtus
        ? anCount(db, "SELECT COUNT(*) AS c FROM dtus") : 0;
      const publicDtus = hasDtus
        ? anCount(db, "SELECT COUNT(*) AS c FROM dtus WHERE visibility IN ('public','marketplace')") : 0;
      const activeUsers = hasVisits
        ? anCount(db, "SELECT COUNT(DISTINCT user_id) AS c FROM world_visits") : 0;
      const totalCitations = hasCitations
        ? anCount(db, "SELECT COALESCE(SUM(citation_count),0) AS c FROM dtu_citations") : 0;

      let topWorlds = [];
      if (hasWorlds) {
        try {
          topWorlds = db.prepare(
            "SELECT id, name, population, npc_count FROM worlds ORDER BY population DESC, npc_count DESC LIMIT 5"
          ).all().map((w) => ({
            worldId: w.id,
            name: w.name ?? null,
            population: Number(w.population) || 0,
            npcCount: Number(w.npc_count) || 0,
          }));
        } catch (_e) { topWorlds = []; }
      }

      return {
        ok: true,
        result: {
          totalWorlds,
          activeWorlds,
          totalBuildings,
          totalEvents,
          totalDtus,
          publicDtus,
          activeUsers,
          totalCitations,
          topWorlds,
        },
      };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });
}
