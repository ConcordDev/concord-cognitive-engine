// server/domains/meta.js
// Domain actions for meta-cognitive/system introspection: system reflection,
// action analytics, and artifact quality metrics.
//
// 2026 developer-portal / observability parity (Backstage + observability):
// service catalog, dependency-graph, live time-series metrics dashboards,
// health-check roll-up, change/deploy timeline, alert surface, macro explorer.

export default function registerMetaActions(registerLensAction) {
  // ─── persistent per-user introspection state ──────────────────────────
  function getMetaState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.metaLens) {
      STATE.metaLens = {
        services: new Map(),   // userId -> Map<serviceId, service>
        deploys: new Map(),    // userId -> Array<deployEvent>
        alerts: new Map(),     // userId -> Array<alert>
        metrics: new Map(),    // userId -> Array<metricSample>
        seq: new Map(),        // userId -> { svc, dep, alt }
      };
    }
    const s = STATE.metaLens;
    if (!s.services) s.services = new Map();
    if (!s.deploys) s.deploys = new Map();
    if (!s.alerts) s.alerts = new Map();
    if (!s.metrics) s.metrics = new Map();
    if (!s.seq) s.seq = new Map();
    return s;
  }
  function metaActor(ctx) {
    return ctx?.actor?.userId || ctx?.userId || "anon";
  }
  function metaSeq(s, userId, key) {
    if (!s.seq.has(userId)) s.seq.set(userId, { svc: 1, dep: 1, alt: 1 });
    const seq = s.seq.get(userId);
    if (!Number.isFinite(seq[key])) seq[key] = 1;
    return seq[key]++;
  }
  function metaSaveState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function metaList(map, userId) {
    if (!map.has(userId)) map.set(userId, []);
    return map.get(userId);
  }
  function metaMap(map, userId) {
    if (!map.has(userId)) map.set(userId, new Map());
    return map.get(userId);
  }
  // Roll a green/yellow/red status up — worst child wins.
  function rollupStatus(statuses) {
    if (statuses.includes("red") || statuses.includes("critical")) return "red";
    if (statuses.includes("yellow") || statuses.includes("warning") || statuses.includes("degraded")) return "yellow";
    if (statuses.length === 0) return "unknown";
    return "green";
  }

  /**
   * systemReflection
   * Analyze system performance patterns — compute response time percentiles,
   * error rate trends, and capacity utilization.
   * artifact.data.metrics = [{ timestamp, responseMs, success, cpuPercent?, memPercent?, endpoint? }]
   */
  registerLensAction("meta", "systemReflection", (ctx, artifact, params) => {
    const metrics = artifact.data?.metrics || [];
    if (metrics.length === 0) {
      return { ok: true, result: { message: "No system metrics to analyze." } };
    }

    const windowSize = params.windowSize || 10;
    const r = (v) => Math.round(v * 10000) / 10000;

    // --- Response time percentiles ---
    const responseTimes = metrics.map(m => parseFloat(m.responseMs) || 0).filter(v => v > 0);
    const sorted = [...responseTimes].sort((a, b) => a - b);
    const n = sorted.length;

    function percentile(arr, p) {
      if (arr.length === 0) return 0;
      const idx = Math.ceil(p * arr.length) - 1;
      return arr[Math.max(0, Math.min(idx, arr.length - 1))];
    }

    const p50 = percentile(sorted, 0.50);
    const p90 = percentile(sorted, 0.90);
    const p95 = percentile(sorted, 0.95);
    const p99 = percentile(sorted, 0.99);
    const mean = responseTimes.reduce((s, v) => s + v, 0) / n;
    const stdDev = Math.sqrt(responseTimes.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / n);

    // --- Error rate trends (sliding window) ---
    const chronological = [...metrics]
      .map(m => ({ ...m, ts: new Date(m.timestamp).getTime() }))
      .filter(m => !isNaN(m.ts))
      .sort((a, b) => a.ts - b.ts);

    const errorWindows = [];
    for (let i = 0; i <= chronological.length - windowSize; i++) {
      const window = chronological.slice(i, i + windowSize);
      const errors = window.filter(m => m.success === false).length;
      const rate = errors / windowSize;
      errorWindows.push({
        windowStart: i,
        errorRate: r(rate),
        avgResponseMs: r(window.reduce((s, m) => s + (parseFloat(m.responseMs) || 0), 0) / windowSize),
      });
    }

    // Detect error rate trend using linear regression on error windows
    let errorTrend = "stable";
    if (errorWindows.length >= 3) {
      const xs = errorWindows.map((_, i) => i);
      const ys = errorWindows.map(w => w.errorRate);
      const meanX = xs.reduce((s, v) => s + v, 0) / xs.length;
      const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;
      let ssXY = 0, ssXX = 0;
      for (let i = 0; i < xs.length; i++) {
        ssXY += (xs[i] - meanX) * (ys[i] - meanY);
        ssXX += (xs[i] - meanX) * (xs[i] - meanX);
      }
      const slope = ssXX > 0 ? ssXY / ssXX : 0;
      if (slope > 0.005) errorTrend = "increasing";
      else if (slope < -0.005) errorTrend = "decreasing";
    }

    // --- Capacity utilization ---
    const cpuValues = metrics.map(m => parseFloat(m.cpuPercent)).filter(v => !isNaN(v));
    const memValues = metrics.map(m => parseFloat(m.memPercent)).filter(v => !isNaN(v));

    const cpuStats = cpuValues.length > 0 ? {
      avg: r(cpuValues.reduce((s, v) => s + v, 0) / cpuValues.length),
      max: r(Math.max(...cpuValues)),
      p95: r(percentile([...cpuValues].sort((a, b) => a - b), 0.95)),
    } : null;

    const memStats = memValues.length > 0 ? {
      avg: r(memValues.reduce((s, v) => s + v, 0) / memValues.length),
      max: r(Math.max(...memValues)),
      p95: r(percentile([...memValues].sort((a, b) => a - b), 0.95)),
    } : null;

    // Capacity health classification
    const cpuHealth = cpuStats ? (cpuStats.p95 > 90 ? "critical" : cpuStats.p95 > 75 ? "warning" : "healthy") : "unknown";
    const memHealth = memStats ? (memStats.p95 > 90 ? "critical" : memStats.p95 > 75 ? "warning" : "healthy") : "unknown";

    // --- Endpoint breakdown ---
    const endpointMap = {};
    for (const m of metrics) {
      const ep = m.endpoint || "unknown";
      if (!endpointMap[ep]) endpointMap[ep] = { count: 0, errors: 0, totalMs: 0 };
      endpointMap[ep].count++;
      if (m.success === false) endpointMap[ep].errors++;
      endpointMap[ep].totalMs += parseFloat(m.responseMs) || 0;
    }
    const endpoints = Object.entries(endpointMap)
      .map(([name, data]) => ({
        name,
        requests: data.count,
        errorRate: r(data.errors / data.count),
        avgResponseMs: r(data.totalMs / data.count),
      }))
      .sort((a, b) => b.requests - a.requests);

    const totalErrors = metrics.filter(m => m.success === false).length;

    return {
      ok: true,
      result: {
        totalRequests: metrics.length,
        overallErrorRate: r(totalErrors / metrics.length),
        responseTime: {
          mean: r(mean), stdDev: r(stdDev),
          p50: r(p50), p90: r(p90), p95: r(p95), p99: r(p99),
          min: r(sorted[0]), max: r(sorted[n - 1]),
        },
        errorTrend,
        capacity: { cpu: cpuStats, memory: memStats, cpuHealth, memHealth },
        endpoints: endpoints.slice(0, 15),
        slidingWindows: errorWindows.length > 20
          ? errorWindows.filter((_, i) => i % Math.ceil(errorWindows.length / 20) === 0)
          : errorWindows,
      },
    };
  });

  /**
   * actionAnalytics
   * Analyze action usage patterns — frequency distributions, co-occurrence,
   * and user journey mapping.
   * artifact.data.actionLog = [{ userId, action, timestamp, durationMs?, metadata? }]
   */
  registerLensAction("meta", "actionAnalytics", (ctx, artifact, params) => {
    const actionLog = artifact.data?.actionLog || [];
    if (actionLog.length === 0) {
      return { ok: true, result: { message: "No action log data." } };
    }

    const sessionGapMs = (params.sessionGapMinutes || 30) * 60 * 1000;

    // --- Frequency distribution ---
    const actionFreq = {};
    for (const entry of actionLog) {
      const action = entry.action || "unknown";
      actionFreq[action] = (actionFreq[action] || 0) + 1;
    }
    const frequencyDist = Object.entries(actionFreq)
      .map(([action, count]) => ({
        action,
        count,
        percentage: Math.round((count / actionLog.length) * 10000) / 100,
      }))
      .sort((a, b) => b.count - a.count);

    // --- Co-occurrence matrix (actions within same session) ---
    const userTimelines = {};
    for (const entry of actionLog) {
      const uid = entry.userId || "anon";
      if (!userTimelines[uid]) userTimelines[uid] = [];
      userTimelines[uid].push({
        action: entry.action || "unknown",
        ts: new Date(entry.timestamp).getTime(),
        durationMs: entry.durationMs || 0,
      });
    }

    // Segment into sessions
    const allSessions = [];
    for (const uid of Object.keys(userTimelines)) {
      const events = userTimelines[uid].sort((a, b) => a.ts - b.ts);
      let session = [events[0]];
      for (let i = 1; i < events.length; i++) {
        if (events[i].ts - events[i - 1].ts > sessionGapMs) {
          allSessions.push({ userId: uid, events: session });
          session = [];
        }
        session.push(events[i]);
      }
      if (session.length > 0) allSessions.push({ userId: uid, events: session });
    }

    // Build co-occurrence counts
    const coOccurrence = {};
    for (const session of allSessions) {
      const actions = [...new Set(session.events.map(e => e.action))];
      for (let i = 0; i < actions.length; i++) {
        for (let j = i + 1; j < actions.length; j++) {
          const pair = [actions[i], actions[j]].sort().join(" + ");
          coOccurrence[pair] = (coOccurrence[pair] || 0) + 1;
        }
      }
    }

    const topCoOccurrences = Object.entries(coOccurrence)
      .map(([pair, count]) => ({ pair, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // --- User journey sequences (most common 2-step and 3-step transitions) ---
    const bigramCounts = {};
    const trigramCounts = {};
    for (const session of allSessions) {
      const seq = session.events.map(e => e.action);
      for (let i = 0; i < seq.length - 1; i++) {
        const bigram = `${seq[i]} -> ${seq[i + 1]}`;
        bigramCounts[bigram] = (bigramCounts[bigram] || 0) + 1;
        if (i < seq.length - 2) {
          const trigram = `${seq[i]} -> ${seq[i + 1]} -> ${seq[i + 2]}`;
          trigramCounts[trigram] = (trigramCounts[trigram] || 0) + 1;
        }
      }
    }

    const topTransitions = Object.entries(bigramCounts)
      .map(([transition, count]) => ({ transition, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topJourneys = Object.entries(trigramCounts)
      .map(([journey, count]) => ({ journey, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // --- Hourly distribution ---
    const hourly = new Array(24).fill(0);
    for (const entry of actionLog) {
      const date = new Date(entry.timestamp);
      if (!isNaN(date.getTime())) hourly[date.getHours()]++;
    }
    const peakHour = hourly.indexOf(Math.max(...hourly));

    return {
      ok: true,
      result: {
        totalActions: actionLog.length,
        uniqueActions: frequencyDist.length,
        uniqueUsers: Object.keys(userTimelines).length,
        totalSessions: allSessions.length,
        avgSessionLength: Math.round((allSessions.reduce((s, sess) => s + sess.events.length, 0) / allSessions.length) * 100) / 100,
        frequencyDistribution: frequencyDist.slice(0, 20),
        topCoOccurrences,
        topTransitions,
        topJourneys,
        hourlyDistribution: hourly,
        peakHour,
      },
    };
  });

  /**
   * qualityMetrics
   * Compute artifact quality metrics — completeness, consistency, freshness
   * scores with exponential decay.
   * artifact.data.fields = [{ name, value, updatedAt?, required?, expectedType? }]
   * params.freshnessHalfLifeDays — half-life for freshness decay (default 30)
   */
  registerLensAction("meta", "qualityMetrics", (ctx, artifact, params) => {
    const fields = artifact.data?.fields || [];
    if (fields.length === 0) {
      return { ok: true, result: { message: "No fields to evaluate." } };
    }

    const halfLifeDays = params.freshnessHalfLifeDays || 30;
    const now = params.referenceTime ? new Date(params.referenceTime).getTime() : Date.now();
    const decayLambda = Math.LN2 / (halfLifeDays * 86400000); // decay constant in ms

    // --- Completeness score ---
    const requiredFields = fields.filter(f => f.required !== false);
    const filledRequired = requiredFields.filter(f => f.value !== null && f.value !== undefined && f.value !== "");
    const allFilled = fields.filter(f => f.value !== null && f.value !== undefined && f.value !== "");

    const completenessRequired = requiredFields.length > 0
      ? filledRequired.length / requiredFields.length
      : 1;
    const completenessAll = fields.length > 0 ? allFilled.length / fields.length : 1;

    // --- Consistency score (type checking and format validation) ---
    let consistentCount = 0;
    const inconsistencies = [];
    for (const field of fields) {
      if (field.value === null || field.value === undefined) {
        consistentCount++;
        continue;
      }
      const expected = field.expectedType;
      if (!expected) {
        consistentCount++;
        continue;
      }

      let isConsistent;
      switch (expected) {
        case "number":
          isConsistent = typeof field.value === "number" || (typeof field.value === "string" && !isNaN(parseFloat(field.value)));
          break;
        case "string":
          isConsistent = typeof field.value === "string";
          break;
        case "boolean":
          isConsistent = typeof field.value === "boolean" || field.value === "true" || field.value === "false";
          break;
        case "date":
          isConsistent = !isNaN(new Date(field.value).getTime());
          break;
        case "email":
          isConsistent = typeof field.value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value);
          break;
        case "url":
          isConsistent = typeof field.value === "string" && /^https?:\/\/.+/.test(field.value);
          break;
        case "array":
          isConsistent = Array.isArray(field.value);
          break;
        default:
          isConsistent = typeof field.value === expected;
      }

      if (isConsistent) {
        consistentCount++;
      } else {
        inconsistencies.push({
          field: field.name,
          expected,
          actual: typeof field.value,
          value: String(field.value).substring(0, 50),
        });
      }
    }
    const consistencyScore = fields.length > 0 ? consistentCount / fields.length : 1;

    // --- Freshness score with exponential decay ---
    const freshnessScores = [];
    for (const field of fields) {
      if (!field.updatedAt) {
        freshnessScores.push({ name: field.name, freshness: 0, ageLabel: "unknown" });
        continue;
      }
      const updatedMs = new Date(field.updatedAt).getTime();
      if (isNaN(updatedMs)) {
        freshnessScores.push({ name: field.name, freshness: 0, ageLabel: "invalid_date" });
        continue;
      }
      const ageDays = (now - updatedMs) / 86400000;
      const freshness = Math.exp(-decayLambda * (now - updatedMs));
      let ageLabel;
      if (ageDays < 1) ageLabel = "fresh";
      else if (ageDays < 7) ageLabel = "recent";
      else if (ageDays < halfLifeDays) ageLabel = "aging";
      else ageLabel = "stale";

      freshnessScores.push({
        name: field.name,
        freshness: Math.round(freshness * 10000) / 10000,
        ageDays: Math.round(ageDays * 100) / 100,
        ageLabel,
      });
    }

    const avgFreshness = freshnessScores.length > 0
      ? freshnessScores.reduce((s, f) => s + f.freshness, 0) / freshnessScores.length
      : 0;

    // --- Overall quality score (weighted composite) ---
    const weights = { completeness: 0.4, consistency: 0.35, freshness: 0.25 };
    const overallScore = weights.completeness * completenessRequired
      + weights.consistency * consistencyScore
      + weights.freshness * avgFreshness;

    const qualityGrade = overallScore >= 0.9 ? "A" : overallScore >= 0.8 ? "B"
      : overallScore >= 0.7 ? "C" : overallScore >= 0.5 ? "D" : "F";

    return {
      ok: true,
      result: {
        totalFields: fields.length,
        completeness: {
          requiredFilled: filledRequired.length,
          requiredTotal: requiredFields.length,
          scoreRequired: Math.round(completenessRequired * 10000) / 10000,
          scoreAll: Math.round(completenessAll * 10000) / 10000,
        },
        consistency: {
          score: Math.round(consistencyScore * 10000) / 10000,
          consistentFields: consistentCount,
          inconsistencies: inconsistencies.slice(0, 20),
        },
        freshness: {
          avgScore: Math.round(avgFreshness * 10000) / 10000,
          halfLifeDays,
          fields: freshnessScores,
          staleCount: freshnessScores.filter(f => f.ageLabel === "stale").length,
        },
        overall: {
          score: Math.round(overallScore * 10000) / 10000,
          grade: qualityGrade,
          weights,
        },
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  2026 developer-portal / observability parity
  // ═══════════════════════════════════════════════════════════════════════

  // ─── Service catalog — register/list/update/remove subsystems ──────────
  registerLensAction("meta", "serviceRegister", (ctx, artifact, params) => {
    try {
      const s = getMetaState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = metaActor(ctx);
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "name required" };
      const svcMap = metaMap(s.services, userId);
      const id = `svc_${metaSeq(s, userId, "svc")}`;
      const now = Date.now();
      const service = {
        id,
        name,
        kind: String(params.kind || "service"), // service | lens | library | heartbeat | datastore
        owner: String(params.owner || "unassigned"),
        status: ["green", "yellow", "red"].includes(params.status) ? params.status : "green",
        description: String(params.description || ""),
        tier: Number.isFinite(params.tier) ? params.tier : 3, // 1 critical .. 3 standard
        dependsOn: Array.isArray(params.dependsOn)
          ? params.dependsOn.map((d) => String(d)).filter(Boolean)
          : [],
        repoPath: String(params.repoPath || ""),
        tags: Array.isArray(params.tags) ? params.tags.map((t) => String(t)) : [],
        createdAt: now,
        updatedAt: now,
      };
      svcMap.set(id, service);
      metaSaveState();
      return { ok: true, result: { service } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("meta", "serviceCatalog", (ctx, artifact, params) => {
    try {
      const s = getMetaState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = metaActor(ctx);
      const svcMap = metaMap(s.services, userId);
      let list = [...svcMap.values()];
      if (params.kind) list = list.filter((v) => v.kind === params.kind);
      if (params.owner) list = list.filter((v) => v.owner === params.owner);
      if (params.status) list = list.filter((v) => v.status === params.status);
      if (params.q) {
        const q = String(params.q).toLowerCase();
        list = list.filter((v) =>
          v.name.toLowerCase().includes(q) ||
          v.description.toLowerCase().includes(q) ||
          v.tags.some((t) => t.toLowerCase().includes(q)));
      }
      list.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
      const byKind = {};
      const byStatus = { green: 0, yellow: 0, red: 0, unknown: 0 };
      const byOwner = {};
      for (const v of list) {
        byKind[v.kind] = (byKind[v.kind] || 0) + 1;
        byStatus[v.status] = (byStatus[v.status] || 0) + 1;
        byOwner[v.owner] = (byOwner[v.owner] || 0) + 1;
      }
      return {
        ok: true,
        result: {
          services: list,
          total: list.length,
          byKind,
          byStatus,
          byOwner,
          owners: Object.keys(byOwner).sort(),
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("meta", "serviceUpdate", (ctx, artifact, params) => {
    try {
      const s = getMetaState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = metaActor(ctx);
      const svcMap = metaMap(s.services, userId);
      const svc = svcMap.get(String(params.id || ""));
      if (!svc) return { ok: false, error: "service not found" };
      for (const f of ["name", "kind", "owner", "description", "repoPath"]) {
        if (typeof params[f] === "string") svc[f] = params[f];
      }
      if (["green", "yellow", "red"].includes(params.status)) svc.status = params.status;
      if (Number.isFinite(params.tier)) svc.tier = params.tier;
      if (Array.isArray(params.dependsOn)) svc.dependsOn = params.dependsOn.map((d) => String(d));
      if (Array.isArray(params.tags)) svc.tags = params.tags.map((t) => String(t));
      svc.updatedAt = Date.now();
      metaSaveState();
      return { ok: true, result: { service: svc } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("meta", "serviceRemove", (ctx, artifact, params) => {
    try {
      const s = getMetaState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = metaActor(ctx);
      const svcMap = metaMap(s.services, userId);
      const removed = svcMap.delete(String(params.id || ""));
      if (!removed) return { ok: false, error: "service not found" };
      metaSaveState();
      return { ok: true, result: { removed: true, id: params.id } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── Dependency graph — nodes + edges over the service catalog ─────────
  registerLensAction("meta", "dependencyGraph", (ctx, artifact, params) => {
    try {
      const s = getMetaState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = metaActor(ctx);
      const svcMap = metaMap(s.services, userId);
      const services = [...svcMap.values()];
      const byName = new Map(services.map((v) => [v.name, v]));
      const nodes = services.map((v) => ({
        id: v.id,
        name: v.name,
        kind: v.kind,
        status: v.status,
        tier: v.tier,
      }));
      const edges = [];
      for (const v of services) {
        for (const dep of v.dependsOn) {
          const target = byName.get(dep) || svcMap.get(dep);
          if (target) edges.push({ from: v.id, to: target.id, fromName: v.name, toName: target.name });
        }
      }
      // fan-in / fan-out + dependency depth
      const fanOut = {};
      const fanIn = {};
      for (const v of services) { fanOut[v.id] = 0; fanIn[v.id] = 0; }
      for (const e of edges) { fanOut[e.from]++; fanIn[e.to]++; }
      // cycle detection (DFS)
      const adj = {};
      for (const v of services) adj[v.id] = [];
      for (const e of edges) adj[e.from].push(e.to);
      const cycles = [];
      const WHITE = 0, GRAY = 1, BLACK = 2;
      const color = {};
      for (const v of services) color[v.id] = WHITE;
      function dfs(node, stack) {
        color[node] = GRAY;
        stack.push(node);
        for (const nxt of adj[node]) {
          if (color[nxt] === GRAY) {
            const idx = stack.indexOf(nxt);
            cycles.push(stack.slice(idx).concat(nxt));
          } else if (color[nxt] === WHITE) {
            dfs(nxt, stack);
          }
        }
        stack.pop();
        color[node] = BLACK;
      }
      for (const v of services) if (color[v.id] === WHITE) dfs(v.id, []);
      const roots = services.filter((v) => fanIn[v.id] === 0).map((v) => v.id);
      const leaves = services.filter((v) => fanOut[v.id] === 0).map((v) => v.id);
      const orphans = services
        .filter((v) => fanIn[v.id] === 0 && fanOut[v.id] === 0)
        .map((v) => v.id);
      const mostDependedOn = [...services]
        .sort((a, b) => fanIn[b.id] - fanIn[a.id])
        .slice(0, 5)
        .map((v) => ({ id: v.id, name: v.name, dependents: fanIn[v.id] }));
      return {
        ok: true,
        result: {
          nodes,
          edges,
          stats: {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            cycleCount: cycles.length,
            rootCount: roots.length,
            leafCount: leaves.length,
            orphanCount: orphans.length,
          },
          cycles,
          roots,
          leaves,
          orphans,
          mostDependedOn,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── Live metrics dashboards — record + aggregate time-series samples ──
  registerLensAction("meta", "metricRecord", (ctx, artifact, params) => {
    try {
      const s = getMetaState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = metaActor(ctx);
      const series = String(params.series || "").trim();
      if (!series) return { ok: false, error: "series required" };
      const value = Number(params.value);
      if (!Number.isFinite(value)) return { ok: false, error: "value must be a number" };
      const list = metaList(s.metrics, userId);
      const sample = {
        series,
        value,
        at: Number.isFinite(params.at) ? params.at : Date.now(),
      };
      list.push(sample);
      // cap to 5000 samples per user — drop oldest
      if (list.length > 5000) list.splice(0, list.length - 5000);
      metaSaveState();
      return { ok: true, result: { sample, totalSamples: list.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("meta", "metricsDashboard", (ctx, artifact, params) => {
    try {
      const s = getMetaState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = metaActor(ctx);
      const all = metaList(s.metrics, userId);
      const windowMs = Number.isFinite(params.windowMs) ? params.windowMs : 3600000;
      const now = Date.now();
      const since = now - windowMs;
      const bucketCount = Math.min(Math.max(Number(params.buckets) || 24, 4), 120);
      const bucketMs = windowMs / bucketCount;
      const seriesNames = [...new Set(all.map((m) => m.series))].sort();
      const wanted = params.series
        ? [String(params.series)].filter((n) => seriesNames.includes(n))
        : seriesNames;
      const dashboards = [];
      for (const name of wanted) {
        const samples = all.filter((m) => m.series === name && m.at >= since);
        const buckets = [];
        for (let i = 0; i < bucketCount; i++) {
          const bStart = since + i * bucketMs;
          const bEnd = bStart + bucketMs;
          const inB = samples.filter((m) => m.at >= bStart && m.at < bEnd);
          const vals = inB.map((m) => m.value);
          buckets.push({
            t: Math.round(bStart),
            label: new Date(bStart).toISOString().slice(11, 16),
            count: vals.length,
            avg: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000 : 0,
            min: vals.length ? Math.min(...vals) : 0,
            max: vals.length ? Math.max(...vals) : 0,
          });
        }
        const vals = samples.map((m) => m.value);
        dashboards.push({
          series: name,
          buckets,
          summary: {
            sampleCount: vals.length,
            latest: samples.length ? samples[samples.length - 1].value : null,
            avg: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000 : 0,
            min: vals.length ? Math.min(...vals) : 0,
            max: vals.length ? Math.max(...vals) : 0,
          },
        });
      }
      return {
        ok: true,
        result: {
          dashboards,
          seriesNames,
          windowMs,
          bucketCount,
          totalSamples: all.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── Health-check aggregation — green/yellow/red roll-up ───────────────
  registerLensAction("meta", "healthRollup", (ctx, artifact, params) => {
    try {
      const s = getMetaState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = metaActor(ctx);
      const services = [...metaMap(s.services, userId).values()];
      const alerts = metaList(s.alerts, userId).filter((a) => !a.resolvedAt);
      // group services by kind, roll status up
      const groups = {};
      for (const v of services) {
        if (!groups[v.kind]) groups[v.kind] = { kind: v.kind, services: [], statuses: [] };
        groups[v.kind].services.push({ id: v.id, name: v.name, status: v.status, tier: v.tier });
        groups[v.kind].statuses.push(v.status);
      }
      const subsystems = Object.values(groups).map((g) => ({
        kind: g.kind,
        rollup: rollupStatus(g.statuses),
        total: g.services.length,
        green: g.statuses.filter((x) => x === "green").length,
        yellow: g.statuses.filter((x) => x === "yellow").length,
        red: g.statuses.filter((x) => x === "red").length,
        services: g.services,
      }));
      // alerts escalate the rollup
      const alertSeverities = alerts.map((a) =>
        a.severity === "critical" ? "red" : a.severity === "warning" ? "yellow" : "green");
      const overall = rollupStatus(
        subsystems.map((g) => g.rollup).concat(alertSeverities));
      return {
        ok: true,
        result: {
          overall,
          subsystems,
          subsystemCount: subsystems.length,
          serviceCount: services.length,
          openAlertCount: alerts.length,
          tally: {
            green: services.filter((v) => v.status === "green").length,
            yellow: services.filter((v) => v.status === "yellow").length,
            red: services.filter((v) => v.status === "red").length,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── Change/deploy timeline — record + list deploy events ──────────────
  registerLensAction("meta", "deployRecord", (ctx, artifact, params) => {
    try {
      const s = getMetaState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = metaActor(ctx);
      const title = String(params.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      const list = metaList(s.deploys, userId);
      const id = `dep_${metaSeq(s, userId, "dep")}`;
      const deploy = {
        id,
        title,
        kind: ["deploy", "migration", "config", "rollback", "incident", "feature"].includes(params.kind)
          ? params.kind : "deploy",
        service: String(params.service || ""),
        version: String(params.version || ""),
        author: String(params.author || metaActor(ctx)),
        notes: String(params.notes || ""),
        outcome: ["success", "failed", "partial"].includes(params.outcome) ? params.outcome : "success",
        at: Number.isFinite(params.at) ? params.at : Date.now(),
      };
      list.push(deploy);
      metaSaveState();
      return { ok: true, result: { deploy } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("meta", "deployTimeline", (ctx, artifact, params) => {
    try {
      const s = getMetaState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = metaActor(ctx);
      let list = [...metaList(s.deploys, userId)];
      if (params.kind) list = list.filter((d) => d.kind === params.kind);
      if (params.service) list = list.filter((d) => d.service === params.service);
      if (params.outcome) list = list.filter((d) => d.outcome === params.outcome);
      list.sort((a, b) => b.at - a.at);
      const limit = Number.isFinite(params.limit) ? params.limit : 100;
      const sliced = list.slice(0, limit);
      const byKind = {};
      const byOutcome = { success: 0, failed: 0, partial: 0 };
      for (const d of list) {
        byKind[d.kind] = (byKind[d.kind] || 0) + 1;
        byOutcome[d.outcome] = (byOutcome[d.outcome] || 0) + 1;
      }
      const failureRate = list.length
        ? Math.round((byOutcome.failed / list.length) * 10000) / 100
        : 0;
      return {
        ok: true,
        result: {
          deploys: sliced,
          total: list.length,
          byKind,
          byOutcome,
          failureRate,
          lastDeployAt: list.length ? list[0].at : null,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── Alert surface — raise / list / resolve alerts ─────────────────────
  registerLensAction("meta", "alertRaise", (ctx, artifact, params) => {
    try {
      const s = getMetaState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = metaActor(ctx);
      const title = String(params.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      const list = metaList(s.alerts, userId);
      const id = `alt_${metaSeq(s, userId, "alt")}`;
      const alert = {
        id,
        title,
        severity: ["info", "warning", "critical"].includes(params.severity)
          ? params.severity : "warning",
        source: String(params.source || "manual"),
        service: String(params.service || ""),
        description: String(params.description || ""),
        runbook: String(params.runbook || ""),
        raisedAt: Number.isFinite(params.at) ? params.at : Date.now(),
        resolvedAt: null,
      };
      list.push(alert);
      metaSaveState();
      return { ok: true, result: { alert } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("meta", "alertResolve", (ctx, artifact, params) => {
    try {
      const s = getMetaState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = metaActor(ctx);
      const list = metaList(s.alerts, userId);
      const alert = list.find((a) => a.id === String(params.id || ""));
      if (!alert) return { ok: false, error: "alert not found" };
      if (alert.resolvedAt) return { ok: false, error: "alert already resolved" };
      alert.resolvedAt = Date.now();
      alert.resolutionNote = String(params.note || "");
      metaSaveState();
      return { ok: true, result: { alert } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("meta", "alertSurface", (ctx, artifact, params) => {
    try {
      const s = getMetaState();
      if (!s) return { ok: false, error: "state unavailable" };
      const userId = metaActor(ctx);
      let list = [...metaList(s.alerts, userId)];
      const showResolved = params.includeResolved === true;
      if (!showResolved) list = list.filter((a) => !a.resolvedAt);
      if (params.severity) list = list.filter((a) => a.severity === params.severity);
      if (params.service) list = list.filter((a) => a.service === params.service);
      const sevRank = { critical: 0, warning: 1, info: 2 };
      list.sort((a, b) => (sevRank[a.severity] - sevRank[b.severity]) || b.raisedAt - a.raisedAt);
      const open = [...metaList(s.alerts, userId)].filter((a) => !a.resolvedAt);
      const tally = {
        critical: open.filter((a) => a.severity === "critical").length,
        warning: open.filter((a) => a.severity === "warning").length,
        info: open.filter((a) => a.severity === "info").length,
      };
      return {
        ok: true,
        result: {
          alerts: list,
          openCount: open.length,
          tally,
          worst: tally.critical > 0 ? "critical" : tally.warning > 0 ? "warning" : tally.info > 0 ? "info" : "clear",
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── API / macro explorer — searchable catalog with try-it-now ─────────
  registerLensAction("meta", "macroExplorer", (ctx, artifact, params) => {
    try {
      // globalThis._concordMACROS is a Map<domain, Map<name, fn>>.
      const macros = globalThis._concordMACROS;
      const catalog = [];
      function pushMacro(domain, name) {
        catalog.push({ key: `${domain}.${name}`, domain: String(domain), name: String(name) });
      }
      if (macros && typeof macros.forEach === "function") {
        macros.forEach((inner, domain) => {
          if (inner && typeof inner.forEach === "function") {
            inner.forEach((_fn, name) => pushMacro(domain, name));
          } else if (inner && typeof inner === "object") {
            for (const name of Object.keys(inner)) pushMacro(domain, name);
          } else {
            // flat shape — key is already "domain.name"
            const [d, ...rest] = String(domain).split(".");
            catalog.push({ key: String(domain), domain: d, name: rest.join(".") });
          }
        });
      } else if (macros && typeof macros === "object") {
        for (const domain of Object.keys(macros)) {
          const inner = macros[domain];
          if (inner && typeof inner === "object") {
            for (const name of Object.keys(inner)) pushMacro(domain, name);
          }
        }
      }
      let list = catalog;
      if (params.domain) list = list.filter((m) => m.domain === params.domain);
      if (params.q) {
        const q = String(params.q).toLowerCase();
        list = list.filter((m) => m.key.toLowerCase().includes(q));
      }
      list.sort((a, b) => a.key.localeCompare(b.key));
      const domains = {};
      for (const m of catalog) domains[m.domain] = (domains[m.domain] || 0) + 1;
      return {
        ok: true,
        result: {
          macros: list,
          total: list.length,
          totalAll: catalog.length,
          domains: Object.entries(domains)
            .map(([domain, count]) => ({ domain, count }))
            .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)),
          available: catalog.length > 0,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
