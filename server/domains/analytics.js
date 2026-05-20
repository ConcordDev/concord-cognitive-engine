// server/domains/analytics.js
// Domain actions for analytics: funnel analysis, cohort analysis,
// metric aggregation, anomaly detection, trend forecasting.

export default function registerAnalyticsActions(registerLensAction) {
  registerLensAction("analytics", "funnelAnalysis", (ctx, artifact, _params) => {
    const stages = artifact.data?.stages || [];
    if (stages.length < 2) return { ok: true, result: { message: "Add at least 2 funnel stages with counts." } };
    const analyzed = stages.map((s, i) => {
      const count = parseInt(s.count) || 0;
      const prevCount = i > 0 ? (parseInt(stages[i - 1].count) || 1) : count;
      const dropoff = i > 0 ? Math.round((1 - count / prevCount) * 100) : 0;
      const conversionFromTop = stages[0].count > 0 ? Math.round((count / parseInt(stages[0].count)) * 100) : 0;
      return { stage: s.name || `Stage ${i + 1}`, count, dropoff, conversionFromTop };
    });
    const worstDropoff = analyzed.slice(1).sort((a, b) => b.dropoff - a.dropoff)[0];
    return { ok: true, result: { stages: analyzed, overallConversion: analyzed[analyzed.length - 1]?.conversionFromTop || 0, worstDropoff: worstDropoff?.stage, worstDropoffRate: worstDropoff?.dropoff } };
  });

  registerLensAction("analytics", "cohortAnalysis", (ctx, artifact, _params) => {
    const cohorts = artifact.data?.cohorts || [];
    if (cohorts.length === 0) return { ok: true, result: { message: "Add cohort data with retention periods." } };
    const analyzed = cohorts.map(c => {
      const initial = parseInt(c.initialUsers) || 0;
      const periods = (c.retention || []).map((r, i) => ({
        period: i + 1, retained: parseInt(r) || 0, rate: initial > 0 ? Math.round((parseInt(r) / initial) * 100) : 0,
      }));
      return { cohort: c.name || c.period, initialUsers: initial, retentionCurve: periods, avgRetention: periods.length > 0 ? Math.round(periods.reduce((s, p) => s + p.rate, 0) / periods.length) : 0 };
    });
    return { ok: true, result: { cohorts: analyzed, bestCohort: analyzed.sort((a, b) => b.avgRetention - a.avgRetention)[0]?.cohort } };
  });

  registerLensAction("analytics", "detectAnomalies", (ctx, artifact, _params) => {
    const dataPoints = artifact.data?.dataPoints || [];
    if (dataPoints.length < 5) return { ok: true, result: { message: "Need at least 5 data points for anomaly detection." } };
    const values = dataPoints.map(d => parseFloat(d.value) || 0);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const stdDev = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length);
    const threshold = 2; // 2 standard deviations
    const anomalies = dataPoints.map((d, i) => {
      const val = parseFloat(d.value) || 0;
      const zScore = stdDev > 0 ? (val - mean) / stdDev : 0;
      return { date: d.date || d.label || `Point ${i}`, value: val, zScore: Math.round(zScore * 100) / 100, isAnomaly: Math.abs(zScore) > threshold, direction: zScore > 0 ? "high" : "low" };
    }).filter(a => a.isAnomaly);
    return { ok: true, result: { mean: Math.round(mean * 100) / 100, stdDev: Math.round(stdDev * 100) / 100, totalPoints: dataPoints.length, anomaliesFound: anomalies.length, anomalies, threshold: `${threshold} std deviations` } };
  });

  registerLensAction("analytics", "trendForecast", (ctx, artifact, _params) => {
    const dataPoints = artifact.data?.dataPoints || [];
    if (dataPoints.length < 3) return { ok: true, result: { message: "Need at least 3 data points for forecasting." } };
    const values = dataPoints.map(d => parseFloat(d.value) || 0);
    const n = values.length;
    // Simple linear regression
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (i - xMean) * (values[i] - yMean); den += Math.pow(i - xMean, 2); }
    const slope = den !== 0 ? num / den : 0;
    const intercept = yMean - slope * xMean;
    const forecast = [1, 2, 3, 5, 7].map(p => ({ periodsAhead: p, predicted: Math.round((slope * (n - 1 + p) + intercept) * 100) / 100 }));
    const trend = slope > 0.01 ? "upward" : slope < -0.01 ? "downward" : "flat";
    return { ok: true, result: { trend, slope: Math.round(slope * 1000) / 1000, dataPoints: n, lastValue: values[n - 1], forecast, confidence: n >= 10 ? "moderate" : "low" } };
  });

  // ─── Mixpanel / Amplitude-shape event analytics (per-user, STATE) ────
  // Event-based model: track events, then compute funnels, retention,
  // segmentation and saved reports over the stored event log.

  function getAnalyticsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.analyticsLens) STATE.analyticsLens = {};
    const s = STATE.analyticsLens;
    if (!(s.events instanceof Map)) s.events = new Map();   // userId -> Array<event>
    if (!(s.funnels instanceof Map)) s.funnels = new Map(); // userId -> Array<funnel def>
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
  const EVENT_CAP = 50000;

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
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const steps = Array.isArray(params.steps) ? params.steps.map((x) => anClean(x, 80)).filter(Boolean) : [];
    if (steps.length < 2) return { ok: false, error: "funnel needs at least 2 event steps" };
    return { ok: true, result: computeFunnel(anEvents(s, anActor(ctx)), steps) };
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
    const s = getAnalyticsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const log = anEvents(s, anActor(ctx));
    const funnels = anFunnels(s, anActor(ctx)).map((f) => ({ ...f, result: computeFunnel(log, f.steps) }));
    return { ok: true, result: { funnels, count: funnels.length } };
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
        eventTypes: new Set(log.map((e) => e.name)).size,
      },
    };
  });
}
