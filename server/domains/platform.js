// server/domains/platform.js
// Domain actions for platform engineering: SLA computation, capacity planning,
// incident management, and service dependency analysis.

export default function registerPlatformActions(registerLensAction) {
  /**
   * slaCompute
   * Calculate SLA metrics from uptime/incident data.
   * artifact.data.incidents = [{ start, end, severity, service }]
   * artifact.data.period = { start, end } (measurement window)
   * artifact.data.target = 99.9 (SLA target percentage)
   */
  registerLensAction("platform", "slaCompute", (ctx, artifact, _params) => {
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
  });

  /**
   * capacityPlan
   * Forecast resource needs from historical usage data.
   * artifact.data.metrics = [{ timestamp, cpu, memory, disk, connections }]
   * params.forecastDays (default 30)
   */
  registerLensAction("platform", "capacityPlan", (ctx, artifact, params) => {
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
  });

  /**
   * incidentTimeline
   * Build and analyze an incident timeline with root cause correlation.
   * artifact.data.events = [{ timestamp, type, service, message, severity?, relatedTo? }]
   */
  registerLensAction("platform", "incidentTimeline", (ctx, artifact, _params) => {
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
  });

  /**
   * dependencyMap
   * Analyze service dependency graph for single points of failure,
   * circular dependencies, and blast radius.
   * artifact.data.services = [{ name, dependencies: string[], tier?, healthCheck? }]
   */
  registerLensAction("platform", "dependencyMap", (ctx, artifact, _params) => {
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
  });
}
