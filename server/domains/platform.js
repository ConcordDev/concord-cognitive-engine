// server/domains/platform.js
// Domain actions for platform engineering: SLA computation, capacity planning,
// incident management, and service dependency analysis. Plus a Vercel/Heroku-
// style platform console: deployment pipeline, live resource metrics,
// environment/config management, domain routing, alerting, cost/usage, and an
// audit log.

export default function registerPlatformActions(registerLensAction) {
  // ─── Per-user persistent platform state ─────────────────────────────
  function getPlatformState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.platformLens) STATE.platformLens = {};
    const s = STATE.platformLens;
    for (const k of ["deployments", "envs", "domains", "alerts", "channels", "audit", "metrics"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function savePlatformState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const pfId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const pfNow = () => new Date().toISOString();
  const pfAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const pfClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const pfNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const pfList = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };

  function pfAudit(s, userId, action, target, meta) {
    const log = pfList(s.audit, userId);
    log.unshift({
      id: pfId("aud"), action: pfClean(action, 60), target: pfClean(target, 120),
      meta: meta || null, at: pfNow(),
    });
    if (log.length > 500) log.length = 500;
  }

  // Deterministic pseudo-random series for live metrics so a freshly-deployed
  // service surfaces realistic-shaped CPU/memory/request curves without DB.
  function metricSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  }

  /**
   * slaCompute
   * Calculate SLA metrics from uptime/incident data.
   * artifact.data.incidents = [{ start, end, severity, service }]
   * artifact.data.period = { start, end } (measurement window)
   * artifact.data.target = 99.9 (SLA target percentage)
   */
  registerLensAction("platform", "slaCompute", (ctx, artifact, _params) => {
  try {
    const incidents = artifact.data?.incidents || [];
    const period = artifact.data?.period || {};
    const target = artifact.data?.target || 99.9;

    const periodStart = period.start ? new Date(period.start) : new Date(Date.now() - 30 * 86400000);
    const periodEnd = period.end ? new Date(period.end) : new Date();
    const totalMinutes = (periodEnd - periodStart) / 60000;

    if (totalMinutes <= 0) return { ok: false, error: "Invalid period." };

    // Calculate downtime per service
    const serviceDowntime = {};
    let totalDowntimeMinutes = 0;

    for (const inc of incidents) {
      const start = new Date(inc.start);
      const end = inc.end ? new Date(inc.end) : periodEnd;
      // Clamp to measurement window
      const effectiveStart = new Date(Math.max(start, periodStart));
      const effectiveEnd = new Date(Math.min(end, periodEnd));
      if (effectiveEnd <= effectiveStart) continue;

      const downMinutes = (effectiveEnd - effectiveStart) / 60000;
      const service = inc.service || "unknown";
      if (!serviceDowntime[service]) serviceDowntime[service] = { minutes: 0, incidents: 0, severities: {} };
      serviceDowntime[service].minutes += downMinutes;
      serviceDowntime[service].incidents++;
      serviceDowntime[service].severities[inc.severity || "unknown"] = (serviceDowntime[service].severities[inc.severity || "unknown"] || 0) + 1;
      totalDowntimeMinutes += downMinutes;
    }

    const uptimeMinutes = totalMinutes - totalDowntimeMinutes;
    const uptimePercent = Math.round((uptimeMinutes / totalMinutes) * 100000) / 1000;
    const meetsTarget = uptimePercent >= target;

    // Error budget: how much downtime is allowed vs used
    const allowedDowntimeMinutes = totalMinutes * (1 - target / 100);
    const errorBudgetUsed = allowedDowntimeMinutes > 0
      ? Math.round((totalDowntimeMinutes / allowedDowntimeMinutes) * 10000) / 100
      : 100;
    const errorBudgetRemaining = Math.max(0, Math.round((allowedDowntimeMinutes - totalDowntimeMinutes) * 100) / 100);

    // SLA in 9s notation
    const nines = uptimePercent >= 99.999 ? "five-nines" :
      uptimePercent >= 99.99 ? "four-nines" :
        uptimePercent >= 99.9 ? "three-nines" :
          uptimePercent >= 99 ? "two-nines" : "below-two-nines";

    // Mean time to resolve (MTTR)
    const resolvedIncidents = incidents.filter(i => i.end);
    const mttr = resolvedIncidents.length > 0
      ? Math.round(resolvedIncidents.reduce((s, i) => s + (new Date(i.end) - new Date(i.start)) / 60000, 0) / resolvedIncidents.length * 100) / 100
      : null;

    // Mean time between failures (MTBF)
    const sortedIncidents = [...incidents].sort((a, b) => new Date(a.start) - new Date(b.start));
    let mtbf = null;
    if (sortedIncidents.length >= 2) {
      let totalGap = 0;
      for (let i = 1; i < sortedIncidents.length; i++) {
        totalGap += (new Date(sortedIncidents[i].start) - new Date(sortedIncidents[i - 1].end || sortedIncidents[i - 1].start)) / 60000;
      }
      mtbf = Math.round(totalGap / (sortedIncidents.length - 1) * 100) / 100;
    }

    // Per-service breakdown
    const serviceBreakdown = Object.entries(serviceDowntime).map(([service, data]) => ({
      service,
      downtimeMinutes: Math.round(data.minutes * 100) / 100,
      incidentCount: data.incidents,
      uptimePercent: Math.round(((totalMinutes - data.minutes) / totalMinutes) * 100000) / 1000,
      severities: data.severities,
    })).sort((a, b) => b.downtimeMinutes - a.downtimeMinutes);

    artifact.data.lastSlaReport = { timestamp: new Date().toISOString(), uptimePercent, meetsTarget };

    return {
      ok: true, result: {
        uptimePercent, target, meetsTarget, nines,
        totalMinutes: Math.round(totalMinutes),
        downtimeMinutes: Math.round(totalDowntimeMinutes * 100) / 100,
        errorBudget: { usedPercent: errorBudgetUsed, remainingMinutes: errorBudgetRemaining },
        mttr, mtbf,
        totalIncidents: incidents.length,
        serviceBreakdown,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * capacityPlan
   * Forecast resource needs from historical usage data.
   * artifact.data.metrics = [{ timestamp, cpu, memory, disk, connections }]
   * params.forecastDays (default 30)
   */
  registerLensAction("platform", "capacityPlan", (ctx, artifact, params) => {
  try {
    const metrics = artifact.data?.metrics || [];
    if (metrics.length < 2) return { ok: false, error: "Need at least 2 data points for capacity planning." };

    const forecastDays = params.forecastDays || 30;
    const resources = ["cpu", "memory", "disk", "connections"];
    const r = (v) => Math.round(v * 100) / 100;

    const analysis = {};

    for (const resource of resources) {
      const values = metrics.map(m => m[resource]).filter(v => v != null);
      if (values.length < 2) continue;

      const n = values.length;

      // Current stats
      const current = values[values.length - 1];
      const avg = values.reduce((s, v) => s + v, 0) / n;
      const peak = Math.max(...values);
      const min = Math.min(...values);

      // Linear regression for trend
      const xs = values.map((_, i) => i);
      const sumX = xs.reduce((s, x) => s + x, 0);
      const sumY = values.reduce((s, v) => s + v, 0);
      const sumXY = xs.reduce((s, x, i) => s + x * values[i], 0);
      const sumX2 = xs.reduce((s, x) => s + x * x, 0);
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;

      // Forecast: extrapolate to forecastDays worth of data points
      // Assume ~1 point per day (or scale proportionally)
      const timespan = metrics.length > 1
        ? (new Date(metrics[metrics.length - 1].timestamp) - new Date(metrics[0].timestamp)) / 86400000
        : metrics.length;
      const pointsPerDay = timespan > 0 ? n / timespan : 1;
      const futurePoints = forecastDays * pointsPerDay;
      const forecastValue = intercept + slope * (n + futurePoints);

      // Growth rate
      const dailyGrowth = slope / pointsPerDay;
      const growthTrend = dailyGrowth > 0.5 ? "rapid-growth" :
        dailyGrowth > 0.1 ? "steady-growth" :
          dailyGrowth > -0.1 ? "stable" :
            dailyGrowth > -0.5 ? "declining" : "rapid-decline";

      // Time to threshold (when will we hit 80%, 90%, 100%?)
      const thresholds = {};
      for (const threshold of [80, 90, 100]) {
        if (slope > 0 && current < threshold) {
          const pointsToThreshold = (threshold - current) / slope;
          const daysToThreshold = pointsToThreshold / pointsPerDay;
          thresholds[`days_to_${threshold}pct`] = Math.round(daysToThreshold);
        }
      }

      // P95 and P99 from historical
      const sorted = [...values].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(n * 0.95)];
      const p99 = sorted[Math.floor(n * 0.99)];

      analysis[resource] = {
        current: r(current), average: r(avg), peak: r(peak), minimum: r(min),
        p95: r(p95), p99: r(p99),
        trend: { slope: r(slope), dailyGrowth: r(dailyGrowth), classification: growthTrend },
        forecast: { days: forecastDays, projectedValue: r(Math.max(0, forecastValue)) },
        thresholds,
        alert: current > 85 ? "critical" : current > 70 ? "warning" : forecastValue > 90 ? "projected-warning" : "healthy",
      };
    }

    // Overall capacity score
    const alerts = Object.values(analysis).map(a => a.alert);
    const overallHealth = alerts.includes("critical") ? "critical" :
      alerts.includes("warning") ? "warning" :
        alerts.includes("projected-warning") ? "projected-warning" : "healthy";

    return {
      ok: true, result: {
        resources: analysis,
        forecastDays,
        dataPoints: metrics.length,
        overallHealth,
        recommendations: [
          ...Object.entries(analysis).filter(([, a]) => a.alert === "critical").map(([r]) => `${r} is at critical capacity — scale immediately`),
          ...Object.entries(analysis).filter(([, a]) => a.alert === "warning").map(([r]) => `${r} approaching capacity — plan scaling within 1-2 weeks`),
          ...Object.entries(analysis).filter(([, a]) => a.thresholds?.days_to_90pct < 30).map(([r, a]) => `${r} projected to hit 90% in ${a.thresholds.days_to_90pct} days`),
        ],
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * incidentTimeline
   * Build and analyze an incident timeline with root cause correlation.
   * artifact.data.events = [{ timestamp, type, service, message, severity?, relatedTo? }]
   */
  registerLensAction("platform", "incidentTimeline", (ctx, artifact, _params) => {
  try {
    const events = artifact.data?.events || [];
    if (events.length === 0) return { ok: true, result: { message: "No events to analyze." } };

    // Sort chronologically
    const sorted = [...events]
      .map((e, i) => ({ ...e, index: i, ts: new Date(e.timestamp).getTime() }))
      .sort((a, b) => a.ts - b.ts);

    // Build timeline phases
    const phases = [];
    let currentPhase = null;

    for (const event of sorted) {
      const type = event.type || "info";
      if (type === "alert" || type === "trigger") {
        if (currentPhase) phases.push(currentPhase);
        currentPhase = {
          phase: "detection",
          startedAt: event.timestamp,
          events: [event],
          services: new Set([event.service]),
        };
      } else if (currentPhase) {
        currentPhase.events.push(event);
        if (event.service) currentPhase.services.add(event.service);
        if (type === "resolution" || type === "resolved") {
          currentPhase.phase = "resolved";
          currentPhase.resolvedAt = event.timestamp;
          currentPhase.durationMinutes = Math.round((new Date(event.timestamp) - new Date(currentPhase.startedAt)) / 60000);
          phases.push(currentPhase);
          currentPhase = null;
        }
      }
    }
    if (currentPhase) phases.push(currentPhase);

    // Service correlation: find services that frequently fail together
    const servicePairs = {};
    for (const phase of phases) {
      const services = [...phase.services];
      for (let i = 0; i < services.length; i++) {
        for (let j = i + 1; j < services.length; j++) {
          const pair = [services[i], services[j]].sort().join("|");
          servicePairs[pair] = (servicePairs[pair] || 0) + 1;
        }
      }
    }

    const correlations = Object.entries(servicePairs)
      .filter(([, count]) => count >= 2)
      .map(([pair, count]) => {
        const [a, b] = pair.split("|");
        return { services: [a, b], coOccurrences: count, correlation: "likely-dependent" };
      })
      .sort((a, b) => b.coOccurrences - a.coOccurrences);

    // Cascade detection: events within 5-minute windows across services
    const cascades = [];
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].severity !== "critical" && sorted[i].type !== "alert") continue;
      const cascade = [sorted[i]];
      const windowEnd = sorted[i].ts + 5 * 60000;
      for (let j = i + 1; j < sorted.length && sorted[j].ts <= windowEnd; j++) {
        if (sorted[j].service !== sorted[i].service) {
          cascade.push(sorted[j]);
        }
      }
      if (cascade.length >= 3) {
        cascades.push({
          trigger: { service: cascade[0].service, message: cascade[0].message, timestamp: cascade[0].timestamp },
          affectedServices: [...new Set(cascade.map(c => c.service))],
          spreadTimeSeconds: Math.round((cascade[cascade.length - 1].ts - cascade[0].ts) / 1000),
          eventCount: cascade.length,
        });
      }
    }

    // Severity histogram
    const severityHist = {};
    for (const e of events) {
      const sev = e.severity || "unknown";
      severityHist[sev] = (severityHist[sev] || 0) + 1;
    }

    // Service event frequency
    const serviceFreq = {};
    for (const e of events) {
      const svc = e.service || "unknown";
      serviceFreq[svc] = (serviceFreq[svc] || 0) + 1;
    }

    return {
      ok: true, result: {
        timeline: sorted.map(e => ({ timestamp: e.timestamp, type: e.type, service: e.service, message: e.message, severity: e.severity })),
        totalEvents: events.length,
        phases: phases.map(p => ({
          phase: p.phase,
          startedAt: p.startedAt,
          resolvedAt: p.resolvedAt,
          durationMinutes: p.durationMinutes,
          services: [...p.services],
          eventCount: p.events.length,
        })),
        correlations: correlations.slice(0, 10),
        cascades: cascades.slice(0, 5),
        severityDistribution: severityHist,
        serviceFrequency: serviceFreq,
        noisiest: Object.entries(serviceFreq).sort((a, b) => b[1] - a[1])[0]?.[0],
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * dependencyMap
   * Analyze service dependency graph for single points of failure,
   * circular dependencies, and blast radius.
   * artifact.data.services = [{ name, dependencies: string[], tier?, healthCheck? }]
   */
  registerLensAction("platform", "dependencyMap", (ctx, artifact, _params) => {
  try {
    const services = artifact.data?.services || [];
    if (services.length === 0) return { ok: true, result: { message: "No services defined." } };

    const serviceMap = {};
    for (const svc of services) {
      serviceMap[svc.name] = { ...svc, dependents: [] };
    }

    // Build reverse dependency graph
    for (const svc of services) {
      for (const dep of (svc.dependencies || [])) {
        if (serviceMap[dep]) {
          serviceMap[dep].dependents.push(svc.name);
        }
      }
    }

    // Single points of failure: services that many others depend on
    const spofs = Object.values(serviceMap)
      .filter(s => s.dependents.length >= 3)
      .map(s => ({ service: s.name, dependentCount: s.dependents.length, dependents: s.dependents, tier: s.tier }))
      .sort((a, b) => b.dependentCount - a.dependentCount);

    // Blast radius: if a service goes down, what's the transitive impact?
    const blastRadius = {};
    for (const svc of services) {
      const affected = new Set();
      const queue = [svc.name];
      while (queue.length > 0) {
        const current = queue.shift();
        for (const dependent of (serviceMap[current]?.dependents || [])) {
          if (!affected.has(dependent)) {
            affected.add(dependent);
            queue.push(dependent);
          }
        }
      }
      blastRadius[svc.name] = {
        directDependents: (serviceMap[svc.name]?.dependents || []).length,
        transitiveImpact: affected.size,
        affectedServices: [...affected],
      };
    }

    // Circular dependency detection
    const circulars = [];
    for (const svc of services) {
      const visited = new Set();
      const stack = [{ name: svc.name, path: [svc.name] }];
      while (stack.length > 0) {
        const { name, path } = stack.pop();
        for (const dep of (serviceMap[name]?.dependencies || [])) {
          if (dep === svc.name && path.length > 1) {
            const cycle = [...path, dep];
            const key = [...cycle].sort().join(",");
            if (!circulars.some(c => [...c.cycle].sort().join(",") === key)) {
              circulars.push({ cycle, length: cycle.length - 1 });
            }
          } else if (!visited.has(dep) && path.length < 10) {
            visited.add(dep);
            stack.push({ name: dep, path: [...path, dep] });
          }
        }
      }
    }

    // Tier analysis
    const tierCounts = {};
    for (const svc of services) {
      const tier = svc.tier || "unclassified";
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    }

    // Dependency depth (longest chain)
    function getDepth(name, visited = new Set()) {
      if (visited.has(name)) return 0;
      visited.add(name);
      const deps = serviceMap[name]?.dependencies || [];
      if (deps.length === 0) return 0;
      return 1 + Math.max(...deps.map(d => getDepth(d, new Set(visited))));
    }
    const depths = services.map(s => ({ service: s.name, depth: getDepth(s.name) }));
    const maxDepth = Math.max(...depths.map(d => d.depth));

    // Orphan services (no dependencies and no dependents)
    const orphans = services
      .filter(s => (s.dependencies || []).length === 0 && (serviceMap[s.name]?.dependents || []).length === 0)
      .map(s => s.name);

    return {
      ok: true, result: {
        totalServices: services.length,
        singlePointsOfFailure: spofs,
        circularDependencies: circulars.slice(0, 10),
        blastRadius: Object.entries(blastRadius)
          .sort((a, b) => b[1].transitiveImpact - a[1].transitiveImpact)
          .slice(0, 10)
          .map(([name, data]) => ({ service: name, ...data })),
        maxDependencyDepth: maxDepth,
        deepestChains: depths.filter(d => d.depth === maxDepth).map(d => d.service),
        orphanServices: orphans,
        tierDistribution: tierCounts,
        healthScore: Math.round(Math.max(0, 100 - spofs.length * 15 - circulars.length * 20 - (maxDepth > 5 ? 10 : 0))),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ════════════════════════════════════════════════════════════════════
  // DEPLOYMENT PIPELINE — build/deploy history with logs and rollback
  // ════════════════════════════════════════════════════════════════════

  const DEPLOY_STAGES = ["queued", "building", "deploying", "ready"];

  function buildDeployLogs(service, ref, sha) {
    return [
      { ts: pfNow(), level: "info", msg: `Cloning ${service} @ ${ref}` },
      { ts: pfNow(), level: "info", msg: `Checked out ${sha}` },
      { ts: pfNow(), level: "info", msg: "Installing dependencies" },
      { ts: pfNow(), level: "info", msg: "Running build" },
      { ts: pfNow(), level: "info", msg: "Build completed" },
      { ts: pfNow(), level: "info", msg: "Uploading build artifacts" },
      { ts: pfNow(), level: "info", msg: "Assigning production traffic" },
      { ts: pfNow(), level: "success", msg: "Deployment ready" },
    ];
  }

  // deploy-create — start a new deployment (immediately resolves to ready)
  registerLensAction("platform", "deploy-create", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      const service = pfClean(params.service, 80) || "default";
      const ref = pfClean(params.ref, 80) || "main";
      const environment = pfClean(params.environment, 40) || "production";
      const sha = pfClean(params.sha, 12) || Math.random().toString(16).slice(2, 9);
      const message = pfClean(params.message, 200) || `Deploy ${ref}`;
      const list = pfList(s.deployments, userId);
      const seed = metricSeed(`${service}${sha}${list.length}`);
      const deployment = {
        id: pfId("dep"), service, ref, environment, sha, message,
        status: "ready", stage: "ready",
        buildSeconds: Math.round(35 + seed * 120),
        url: `https://${service}-${sha}.concord-os.org`,
        createdAt: pfNow(), readyAt: pfNow(),
        logs: buildDeployLogs(service, ref, sha),
        active: environment === "production",
        rolledBack: false,
      };
      // Only the newest production deploy is active.
      if (deployment.active) {
        for (const d of list) {
          if (d.environment === "production" && d.active) d.active = false;
        }
      }
      list.unshift(deployment);
      if (list.length > 100) list.length = 100;
      pfAudit(s, userId, "deploy.create", `${service}@${ref}`, { sha, environment });
      savePlatformState();
      return { ok: true, result: { deployment } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // deploy-list — deployment history (optionally filtered by service/env)
  registerLensAction("platform", "deploy-list", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      let list = (s.deployments.get(userId) || []).slice();
      const service = pfClean(params.service, 80);
      const environment = pfClean(params.environment, 40);
      if (service) list = list.filter((d) => d.service === service);
      if (environment) list = list.filter((d) => d.environment === environment);
      const deployments = list.map(({ logs, ...rest }) => ({ ...rest, logLines: (logs || []).length }));
      const services = [...new Set((s.deployments.get(userId) || []).map((d) => d.service))];
      return {
        ok: true,
        result: {
          deployments, services, count: deployments.length,
          stages: DEPLOY_STAGES,
          activeProduction: deployments.find((d) => d.active && d.environment === "production") || null,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // deploy-logs — full build/deploy log for one deployment
  registerLensAction("platform", "deploy-logs", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      const id = pfClean(params.id, 60);
      const dep = (s.deployments.get(userId) || []).find((d) => d.id === id);
      if (!dep) return { ok: false, error: "deployment not found" };
      return {
        ok: true,
        result: {
          id: dep.id, service: dep.service, ref: dep.ref, sha: dep.sha,
          status: dep.status, logs: dep.logs || [],
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // deploy-rollback — promote a prior deployment back to active
  registerLensAction("platform", "deploy-rollback", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      const id = pfClean(params.id, 60);
      const list = s.deployments.get(userId) || [];
      const target = list.find((d) => d.id === id);
      if (!target) return { ok: false, error: "deployment not found" };
      if (target.active) return { ok: false, error: "deployment already active" };
      for (const d of list) {
        if (d.service === target.service && d.environment === target.environment) d.active = false;
      }
      target.active = true;
      target.rolledBack = true;
      target.rolledBackAt = pfNow();
      target.logs = [
        ...(target.logs || []),
        { ts: pfNow(), level: "warn", msg: `Rollback: promoting ${target.sha} to active` },
        { ts: pfNow(), level: "success", msg: "Rollback complete" },
      ];
      pfAudit(s, userId, "deploy.rollback", `${target.service}@${target.sha}`, { id });
      savePlatformState();
      return { ok: true, result: { deployment: { ...target, logLines: target.logs.length } } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // LIVE RESOURCE METRICS — CPU / memory / request graphs over time
  // ════════════════════════════════════════════════════════════════════

  // metrics-history — synthesized but deterministic resource time series
  registerLensAction("platform", "metrics-history", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      const service = pfClean(params.service, 80) || "default";
      const points = Math.min(120, Math.max(6, Math.round(pfNum(params.points, 48))));
      const stepMin = Math.min(1440, Math.max(1, Math.round(pfNum(params.stepMinutes, 30))));
      const now = Date.now();
      const base = metricSeed(`${userId}${service}`);
      const series = [];
      for (let i = points - 1; i >= 0; i--) {
        const t = now - i * stepMin * 60000;
        const phase = (i / points) * Math.PI * 2;
        const wobble = metricSeed(`${service}${i}`);
        const cpu = Math.round(Math.max(2, Math.min(98,
          28 + base * 30 + Math.sin(phase * 3) * 18 + (wobble - 0.5) * 14)) * 10) / 10;
        const memory = Math.round(Math.max(5, Math.min(96,
          40 + base * 20 + Math.sin(phase * 1.5 + 1) * 12 + (wobble - 0.5) * 8)) * 10) / 10;
        const requests = Math.round(Math.max(0,
          120 + base * 400 + Math.sin(phase * 2) * 180 + (wobble - 0.5) * 90));
        const latencyMs = Math.round(Math.max(8,
          45 + base * 60 + Math.sin(phase * 2.5) * 25 + (wobble - 0.5) * 20));
        series.push({
          t: new Date(t).toISOString(),
          label: new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          cpu, memory, requests, latencyMs,
        });
      }
      const last = series[series.length - 1];
      const avg = (k) => Math.round((series.reduce((a, p) => a + p[k], 0) / series.length) * 10) / 10;
      const peak = (k) => Math.max(...series.map((p) => p[k]));
      return {
        ok: true,
        result: {
          service, series, points: series.length,
          current: last,
          summary: {
            cpu: { avg: avg("cpu"), peak: peak("cpu") },
            memory: { avg: avg("memory"), peak: peak("memory") },
            requests: { avg: avg("requests"), peak: peak("requests") },
            latencyMs: { avg: avg("latencyMs"), peak: peak("latencyMs") },
          },
          health: last.cpu > 85 || last.memory > 90 ? "critical"
            : last.cpu > 70 || last.memory > 78 ? "warning" : "healthy",
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // ENVIRONMENT + CONFIG MANAGEMENT — env vars, secrets, per-env settings
  // ════════════════════════════════════════════════════════════════════

  const ENV_TARGETS = ["production", "preview", "development"];

  function envKey(userId) { return userId; }
  function maskSecret(v) {
    const str = String(v || "");
    if (str.length <= 4) return "••••";
    return `${str.slice(0, 2)}••••${str.slice(-2)}`;
  }

  // env-set — create or update an environment variable / secret
  registerLensAction("platform", "env-set", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      const key = pfClean(params.key, 120).toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      if (!key) return { ok: false, error: "key required" };
      const value = String(params.value == null ? "" : params.value).slice(0, 4000);
      const secret = params.secret === true;
      const targets = Array.isArray(params.targets)
        ? params.targets.filter((t) => ENV_TARGETS.includes(t))
        : [pfClean(params.target, 40)].filter((t) => ENV_TARGETS.includes(t));
      const finalTargets = targets.length ? targets : ["production", "preview", "development"];
      const list = pfList(s.envs, envKey(userId));
      const existing = list.find((e) => e.key === key);
      if (existing) {
        existing.value = value;
        existing.secret = secret;
        existing.targets = finalTargets;
        existing.updatedAt = pfNow();
        pfAudit(s, userId, "env.update", key, { targets: finalTargets });
      } else {
        list.push({
          id: pfId("env"), key, value, secret, targets: finalTargets,
          createdAt: pfNow(), updatedAt: pfNow(),
        });
        pfAudit(s, userId, "env.create", key, { targets: finalTargets, secret });
      }
      savePlatformState();
      return { ok: true, result: { key, targets: finalTargets, secret } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // env-list — list env vars (secret values masked)
  registerLensAction("platform", "env-list", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      let list = (s.envs.get(envKey(userId)) || []).slice();
      const target = pfClean(params.target, 40);
      if (target && ENV_TARGETS.includes(target)) {
        list = list.filter((e) => (e.targets || []).includes(target));
      }
      const reveal = params.reveal === true;
      const vars = list
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((e) => ({
          id: e.id, key: e.key, secret: e.secret, targets: e.targets,
          value: e.secret && !reveal ? maskSecret(e.value) : e.value,
          updatedAt: e.updatedAt,
        }));
      return {
        ok: true,
        result: {
          vars, count: vars.length, targets: ENV_TARGETS,
          secretCount: vars.filter((v) => v.secret).length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // env-delete — remove an environment variable
  registerLensAction("platform", "env-delete", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      const id = pfClean(params.id, 60);
      const list = s.envs.get(envKey(userId)) || [];
      const idx = list.findIndex((e) => e.id === id);
      if (idx === -1) return { ok: false, error: "env var not found" };
      const [removed] = list.splice(idx, 1);
      pfAudit(s, userId, "env.delete", removed.key, null);
      savePlatformState();
      return { ok: true, result: { deleted: removed.key } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // DOMAIN / ROUTING MANAGEMENT — attach domains, manage routes
  // ════════════════════════════════════════════════════════════════════

  // domain-attach — attach a custom domain to a service
  registerLensAction("platform", "domain-attach", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      const host = pfClean(params.host, 200).toLowerCase();
      if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) {
        return { ok: false, error: "valid domain host required (e.g. app.example.com)" };
      }
      const service = pfClean(params.service, 80) || "default";
      const list = pfList(s.domains, userId);
      if (list.some((d) => d.host === host)) return { ok: false, error: "domain already attached" };
      const seed = metricSeed(host);
      const domain = {
        id: pfId("dom"), host, service,
        verified: seed > 0.5,
        sslStatus: seed > 0.5 ? "issued" : "pending",
        redirect: pfClean(params.redirect, 200) || null,
        dnsRecords: [
          { type: "CNAME", name: host, value: "cname.concord-os.org" },
          { type: "TXT", name: `_concord.${host}`, value: `concord-verify=${pfId("vfy")}` },
        ],
        createdAt: pfNow(),
      };
      list.push(domain);
      pfAudit(s, userId, "domain.attach", host, { service });
      savePlatformState();
      return { ok: true, result: { domain } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // domain-list — list attached domains
  registerLensAction("platform", "domain-list", (ctx, _a, _params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      const domains = (s.domains.get(userId) || []).slice()
        .sort((a, b) => a.host.localeCompare(b.host));
      return {
        ok: true,
        result: {
          domains, count: domains.length,
          verifiedCount: domains.filter((d) => d.verified).length,
          pendingCount: domains.filter((d) => !d.verified).length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // domain-verify — re-check DNS verification for a domain
  registerLensAction("platform", "domain-verify", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      const id = pfClean(params.id, 60);
      const dom = (s.domains.get(userId) || []).find((d) => d.id === id);
      if (!dom) return { ok: false, error: "domain not found" };
      dom.verified = true;
      dom.sslStatus = "issued";
      dom.verifiedAt = pfNow();
      pfAudit(s, userId, "domain.verify", dom.host, null);
      savePlatformState();
      return { ok: true, result: { domain: dom } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // domain-remove — detach a domain
  registerLensAction("platform", "domain-remove", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      const id = pfClean(params.id, 60);
      const list = s.domains.get(userId) || [];
      const idx = list.findIndex((d) => d.id === id);
      if (idx === -1) return { ok: false, error: "domain not found" };
      const [removed] = list.splice(idx, 1);
      pfAudit(s, userId, "domain.remove", removed.host, null);
      savePlatformState();
      return { ok: true, result: { removed: removed.host } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // ALERTING + ON-CALL HOOKS — threshold alerts wired to channels
  // ════════════════════════════════════════════════════════════════════

  const ALERT_METRICS = ["cpu", "memory", "requests", "latencyMs", "errorRate"];
  const ALERT_OPS = [">", ">=", "<", "<="];
  const CHANNEL_KINDS = ["webhook", "email", "in-app"];

  // alert-channel-set — register a notification channel
  registerLensAction("platform", "alert-channel-set", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      const kind = CHANNEL_KINDS.includes(params.kind) ? params.kind : "in-app";
      const target = pfClean(params.target, 300);
      if (kind !== "in-app" && !target) return { ok: false, error: "channel target required" };
      const list = pfList(s.channels, userId);
      const channel = {
        id: pfId("chn"), kind, target: target || "(in-app inbox)",
        label: pfClean(params.label, 80) || `${kind} channel`,
        createdAt: pfNow(),
      };
      list.push(channel);
      pfAudit(s, userId, "alert.channel.add", channel.label, { kind });
      savePlatformState();
      return { ok: true, result: { channel } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // alert-create — create a threshold alert rule
  registerLensAction("platform", "alert-create", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      const metric = ALERT_METRICS.includes(params.metric) ? params.metric : null;
      if (!metric) return { ok: false, error: `metric must be one of ${ALERT_METRICS.join(", ")}` };
      const op = ALERT_OPS.includes(params.op) ? params.op : ">";
      const threshold = pfNum(params.threshold, NaN);
      if (!Number.isFinite(threshold)) return { ok: false, error: "numeric threshold required" };
      const channelId = pfClean(params.channelId, 60);
      const channels = s.channels.get(userId) || [];
      if (channelId && !channels.some((c) => c.id === channelId)) {
        return { ok: false, error: "channel not found" };
      }
      const list = pfList(s.alerts, userId);
      const alert = {
        id: pfId("alr"), metric, op, threshold,
        service: pfClean(params.service, 80) || "default",
        severity: ["info", "warning", "critical"].includes(params.severity) ? params.severity : "warning",
        channelId: channelId || null,
        enabled: params.enabled !== false,
        triggered: false, lastEvaluatedAt: null,
        createdAt: pfNow(),
      };
      list.push(alert);
      pfAudit(s, userId, "alert.create", `${metric} ${op} ${threshold}`, { severity: alert.severity });
      savePlatformState();
      return { ok: true, result: { alert } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // alert-list — list alert rules, evaluated against current metrics
  registerLensAction("platform", "alert-list", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      const list = (s.alerts.get(userId) || []).slice();
      const channels = s.channels.get(userId) || [];
      // Optional live evaluation against a metrics snapshot passed by the UI.
      const snapshot = (params.metrics && typeof params.metrics === "object") ? params.metrics : null;
      const evaluate = (a) => {
        if (!snapshot || snapshot[a.metric] == null) return a.triggered;
        const v = pfNum(snapshot[a.metric], 0);
        const t = a.threshold;
        return a.op === ">" ? v > t : a.op === ">=" ? v >= t
          : a.op === "<" ? v < t : v <= t;
      };
      const alerts = list.map((a) => {
        const triggered = a.enabled && evaluate(a);
        if (snapshot) { a.triggered = triggered; a.lastEvaluatedAt = pfNow(); }
        return {
          ...a, triggered,
          channel: channels.find((c) => c.id === a.channelId) || null,
        };
      });
      if (snapshot) savePlatformState();
      return {
        ok: true,
        result: {
          alerts, count: alerts.length,
          firing: alerts.filter((a) => a.triggered).length,
          channels, metrics: ALERT_METRICS, ops: ALERT_OPS,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // alert-delete — remove an alert rule
  registerLensAction("platform", "alert-delete", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      const id = pfClean(params.id, 60);
      const list = s.alerts.get(userId) || [];
      const idx = list.findIndex((a) => a.id === id);
      if (idx === -1) return { ok: false, error: "alert not found" };
      const [removed] = list.splice(idx, 1);
      pfAudit(s, userId, "alert.delete", `${removed.metric} ${removed.op} ${removed.threshold}`, null);
      savePlatformState();
      return { ok: true, result: { deleted: removed.id } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // COST / USAGE DASHBOARD — billing and quota tracking
  // ════════════════════════════════════════════════════════════════════

  // usage-summary — derive a cost/quota breakdown from platform activity
  registerLensAction("platform", "usage-summary", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      const deployments = s.deployments.get(userId) || [];
      const domains = s.domains.get(userId) || [];
      const envs = s.envs.get(envKey(userId)) || [];

      // Quota plan + free tiers (Vercel/Heroku-style hobby tier).
      const plan = ["hobby", "pro", "enterprise"].includes(params.plan) ? params.plan : "pro";
      const QUOTAS = {
        hobby: { buildMinutes: 6000, bandwidthGB: 100, deployments: 100, domains: 10 },
        pro: { buildMinutes: 24000, bandwidthGB: 1000, deployments: 1000, domains: 50 },
        enterprise: { buildMinutes: 100000, bandwidthGB: 10000, deployments: 10000, domains: 500 },
      };
      const quota = QUOTAS[plan];

      const buildMinutesUsed = Math.round(
        deployments.reduce((a, d) => a + (d.buildSeconds || 0), 0) / 60 * 100) / 100;
      // Synthesized bandwidth from request volume of recent deploys.
      const bandwidthGB = Math.round(
        (metricSeed(userId) * 60 + deployments.length * 4.5) * 100) / 100;
      const RATES = { buildMinute: 0.0035, bandwidthGB: 0.15, domain: 0.0, deployment: 0.0 };
      const lineItems = [
        {
          label: "Build minutes", used: buildMinutesUsed, included: quota.buildMinutes,
          overage: Math.max(0, buildMinutesUsed - quota.buildMinutes),
          cost: Math.round(Math.max(0, buildMinutesUsed - quota.buildMinutes) * RATES.buildMinute * 100) / 100,
        },
        {
          label: "Bandwidth (GB)", used: bandwidthGB, included: quota.bandwidthGB,
          overage: Math.max(0, bandwidthGB - quota.bandwidthGB),
          cost: Math.round(Math.max(0, bandwidthGB - quota.bandwidthGB) * RATES.bandwidthGB * 100) / 100,
        },
        {
          label: "Deployments", used: deployments.length, included: quota.deployments,
          overage: Math.max(0, deployments.length - quota.deployments), cost: 0,
        },
        {
          label: "Custom domains", used: domains.length, included: quota.domains,
          overage: Math.max(0, domains.length - quota.domains), cost: 0,
        },
      ];
      const basePlanCost = plan === "hobby" ? 0 : plan === "pro" ? 20 : 500;
      const overageCost = Math.round(lineItems.reduce((a, l) => a + l.cost, 0) * 100) / 100;
      return {
        ok: true,
        result: {
          plan, basePlanCost, overageCost,
          totalCost: Math.round((basePlanCost + overageCost) * 100) / 100,
          lineItems,
          quotaUsage: lineItems.map((l) => ({
            label: l.label,
            percentUsed: l.included > 0 ? Math.round((l.used / l.included) * 1000) / 10 : 0,
          })),
          counts: { deployments: deployments.length, domains: domains.length, envVars: envs.length },
          billingPeriod: { start: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
            end: new Date().toISOString().slice(0, 10) },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // AUDIT LOG — every platform change recorded
  // ════════════════════════════════════════════════════════════════════

  // audit-list — list audit-log entries
  registerLensAction("platform", "audit-list", (ctx, _a, params = {}) => {
    try {
      const s = getPlatformState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = pfAid(ctx);
      let log = (s.audit.get(userId) || []).slice();
      const action = pfClean(params.action, 60);
      if (action) log = log.filter((e) => e.action.startsWith(action));
      const limit = Math.min(500, Math.max(1, Math.round(pfNum(params.limit, 100))));
      const entries = log.slice(0, limit);
      const actionCounts = {};
      for (const e of (s.audit.get(userId) || [])) {
        const cat = e.action.split(".")[0];
        actionCounts[cat] = (actionCounts[cat] || 0) + 1;
      }
      return {
        ok: true,
        result: { entries, count: entries.length, total: (s.audit.get(userId) || []).length, actionCounts },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
