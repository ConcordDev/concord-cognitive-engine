// server/domains/commandcenter.js
// Domain actions for operations command center: situation reporting,
// incident correlation, and escalation engine.

export default function registerCommandCenterActions(registerLensAction) {
  /**
   * situationReport
   * Generate a situation report from multiple data feeds.
   * Aggregate status, identify critical items, compute readiness score.
   * artifact.data.feeds = [{ source, status, items: [{ id, severity, description, timestamp?, resolved? }], metrics?: {} }]
   */
  registerLensAction("command-center", "situationReport", (ctx, artifact, _params) => {
    const feeds = artifact.data?.feeds || [];
    if (feeds.length === 0) {
      return { ok: true, result: { message: "No data feeds provided." } };
    }

    const severityWeights = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

    // Aggregate all items across feeds
    const allItems = [];
    const feedSummaries = [];

    for (const feed of feeds) {
      const items = feed.items || [];
      const resolved = items.filter(i => i.resolved);
      const unresolved = items.filter(i => !i.resolved);

      // Compute feed health score (0-100)
      const criticalCount = unresolved.filter(i => (i.severity || "medium") === "critical").length;
      const highCount = unresolved.filter(i => (i.severity || "medium") === "high").length;
      const feedHealth = Math.max(0, 100 - criticalCount * 25 - highCount * 10 - unresolved.length * 2);

      feedSummaries.push({
        source: feed.source || "unknown",
        status: feed.status || "unknown",
        totalItems: items.length,
        unresolvedCount: unresolved.length,
        resolvedCount: resolved.length,
        health: Math.round(feedHealth),
        severityBreakdown: {
          critical: unresolved.filter(i => i.severity === "critical").length,
          high: unresolved.filter(i => i.severity === "high").length,
          medium: unresolved.filter(i => (i.severity || "medium") === "medium").length,
          low: unresolved.filter(i => i.severity === "low").length,
        },
      });

      for (const item of items) {
        allItems.push({ ...item, source: feed.source });
      }
    }

    // Identify critical items (unresolved critical/high severity)
    const criticalItems = allItems
      .filter(i => !i.resolved && (i.severity === "critical" || i.severity === "high"))
      .sort((a, b) => (severityWeights[b.severity] || 0) - (severityWeights[a.severity] || 0))
      .slice(0, 20);

    // Compute overall readiness score
    const totalUnresolved = allItems.filter(i => !i.resolved).length;
    const weightedSeverity = allItems
      .filter(i => !i.resolved)
      .reduce((s, i) => s + (severityWeights[i.severity] || 2), 0);
    const maxPossibleWeight = allItems.length * 4;
    const readinessScore = maxPossibleWeight > 0
      ? Math.round(Math.max(0, (1 - weightedSeverity / maxPossibleWeight)) * 100)
      : 100;

    // Compute operational tempo (items per hour if timestamps available)
    const timestamped = allItems.filter(i => i.timestamp);
    let tempo = null;
    if (timestamped.length >= 2) {
      const times = timestamped.map(i => new Date(i.timestamp).getTime()).sort((a, b) => a - b);
      const spanHours = (times[times.length - 1] - times[0]) / 3600000;
      if (spanHours > 0) {
        tempo = {
          itemsPerHour: Math.round((timestamped.length / spanHours) * 100) / 100,
          spanHours: Math.round(spanHours * 100) / 100,
          newest: new Date(times[times.length - 1]).toISOString(),
          oldest: new Date(times[0]).toISOString(),
        };
      }
    }

    // Overall status determination
    const overallStatus =
      criticalItems.some(i => i.severity === "critical") ? "RED" :
      criticalItems.length > 0 ? "AMBER" :
      totalUnresolved > allItems.length * 0.3 ? "YELLOW" : "GREEN";

    // Feed cross-correlation: identify sources with shared items (by description similarity)
    const crossSourceIssues = [];
    for (let i = 0; i < feedSummaries.length; i++) {
      for (let j = i + 1; j < feedSummaries.length; j++) {
        const itemsA = allItems.filter(it => it.source === feedSummaries[i].source && !it.resolved);
        const itemsB = allItems.filter(it => it.source === feedSummaries[j].source && !it.resolved);
        let overlaps = 0;
        for (const a of itemsA) {
          for (const b of itemsB) {
            const descA = (a.description || "").toLowerCase().split(/\s+/);
            const descB = (b.description || "").toLowerCase().split(/\s+/);
            const setA = new Set(descA);
            const common = descB.filter(w => setA.has(w) && w.length > 3).length;
            if (common >= 3) overlaps++;
          }
        }
        if (overlaps > 0) {
          crossSourceIssues.push({
            sources: [feedSummaries[i].source, feedSummaries[j].source],
            potentialOverlaps: overlaps,
          });
        }
      }
    }

    return {
      ok: true,
      result: {
        overallStatus,
        readinessScore,
        readinessLabel: readinessScore >= 80 ? "fully-operational" : readinessScore >= 60 ? "degraded" : readinessScore >= 40 ? "impaired" : "critical",
        feedCount: feeds.length,
        feeds: feedSummaries,
        criticalItems: { count: criticalItems.length, items: criticalItems },
        totals: {
          allItems: allItems.length,
          unresolved: totalUnresolved,
          resolved: allItems.length - totalUnresolved,
          resolutionRate: allItems.length > 0 ? Math.round((1 - totalUnresolved / allItems.length) * 10000) / 100 : 100,
        },
        tempo,
        crossSourceIssues,
        generatedAt: new Date().toISOString(),
      },
    };
  });

  /**
   * incidentCorrelation
   * Correlate incidents across systems using time-window matching,
   * shared attributes, and correlation coefficient computation.
   * artifact.data.incidents = [{ id, source, timestamp, attributes: {}, severity?, description? }]
   * params.timeWindowMs (default 300000 = 5 min), params.minCorrelation (default 0.5)
   */
  registerLensAction("command-center", "incidentCorrelation", (ctx, artifact, params) => {
    const incidents = artifact.data?.incidents || [];
    if (incidents.length < 2) {
      return { ok: true, result: { message: "Need at least 2 incidents for correlation." } };
    }

    const timeWindowMs = params.timeWindowMs || 300000;
    const minCorrelation = params.minCorrelation || 0.5;

    // Parse timestamps
    const parsed = incidents.map((inc, idx) => ({
      ...inc,
      _idx: idx,
      _time: inc.timestamp ? new Date(inc.timestamp).getTime() : 0,
      _attrs: inc.attributes || {},
    }));

    // Compute pairwise correlation scores
    const correlations = [];

    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        const a = parsed[i];
        const b = parsed[j];

        // Time proximity score (1.0 if same time, decays with distance)
        let timeScore = 0;
        if (a._time && b._time) {
          const timeDelta = Math.abs(a._time - b._time);
          timeScore = timeDelta <= timeWindowMs ? 1 - (timeDelta / timeWindowMs) : 0;
        }

        // Attribute overlap score (Jaccard-like)
        const keysA = Object.keys(a._attrs);
        const keysB = Object.keys(b._attrs);
        const allKeys = new Set([...keysA, ...keysB]);
        let sharedValues = 0;
        const totalKeys = allKeys.size;
        const matchedAttrs = [];

        for (const key of allKeys) {
          if (key in a._attrs && key in b._attrs) {
            const va = String(a._attrs[key]).toLowerCase();
            const vb = String(b._attrs[key]).toLowerCase();
            if (va === vb) {
              sharedValues++;
              matchedAttrs.push(key);
            }
          }
        }
        const attrScore = totalKeys > 0 ? sharedValues / totalKeys : 0;

        // Source correlation: different sources indicate cross-system correlation
        const crossSource = (a.source || "") !== (b.source || "") ? 0.2 : 0;

        // Severity proximity
        const sevMap = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
        const sevA = sevMap[a.severity] ?? 2;
        const sevB = sevMap[b.severity] ?? 2;
        const sevScore = 1 - Math.abs(sevA - sevB) / 4;

        // Description similarity (term overlap)
        let descScore = 0;
        if (a.description && b.description) {
          const wordsA = new Set(a.description.toLowerCase().split(/\s+/).filter(w => w.length > 3));
          const wordsB = new Set(b.description.toLowerCase().split(/\s+/).filter(w => w.length > 3));
          const union = new Set([...wordsA, ...wordsB]);
          let intersection = 0;
          for (const w of wordsA) if (wordsB.has(w)) intersection++;
          descScore = union.size > 0 ? intersection / union.size : 0;
        }

        // Weighted composite correlation
        const correlation = timeScore * 0.35 + attrScore * 0.30 + descScore * 0.15 + sevScore * 0.10 + crossSource;
        const clampedCorrelation = Math.min(1, Math.round(correlation * 1000) / 1000);

        if (clampedCorrelation >= minCorrelation) {
          correlations.push({
            incidentA: a.id || a._idx,
            incidentB: b.id || b._idx,
            sourceA: a.source,
            sourceB: b.source,
            correlation: clampedCorrelation,
            factors: {
              timeProximity: Math.round(timeScore * 1000) / 1000,
              attributeOverlap: Math.round(attrScore * 1000) / 1000,
              descriptionSimilarity: Math.round(descScore * 1000) / 1000,
              severitySimilarity: Math.round(sevScore * 1000) / 1000,
              crossSource: crossSource > 0,
            },
            matchedAttributes: matchedAttrs,
            timeDeltaMs: a._time && b._time ? Math.abs(a._time - b._time) : null,
          });
        }
      }
    }

    correlations.sort((a, b) => b.correlation - a.correlation);

    // Build correlation clusters using union-find
    const parent = {};
    function find(x) {
      if (!(x in parent)) parent[x] = x;
      if (parent[x] !== x) parent[x] = find(parent[x]);
      return parent[x];
    }
    function union(x, y) {
      const px = find(x), py = find(y);
      if (px !== py) parent[px] = py;
    }

    for (const c of correlations) {
      union(String(c.incidentA), String(c.incidentB));
    }

    const clusters = {};
    for (const inc of parsed) {
      const id = String(inc.id || inc._idx);
      const root = find(id);
      if (!clusters[root]) clusters[root] = [];
      clusters[root].push(id);
    }
    const correlatedClusters = Object.values(clusters).filter(c => c.length > 1);

    return {
      ok: true,
      result: {
        totalIncidents: incidents.length,
        correlationsFound: correlations.length,
        correlations: correlations.slice(0, 50),
        clusters: correlatedClusters.map((members, idx) => ({
          clusterId: idx,
          memberCount: members.length,
          members,
        })),
        uncorrelatedCount: Object.values(clusters).filter(c => c.length === 1).length,
        parameters: { timeWindowMs, minCorrelation },
      },
    };
  });

  /**
   * escalationEngine
   * Determine escalation path based on severity scoring, SLA timers,
   * and automatic escalation threshold checking.
   * artifact.data.incident = { id, severity, createdAt, description?, assignee?, slaMinutes?, acknowledged? }
   * artifact.data.escalationPolicy = [{ level, responders: [], slaMinutes, conditions? }]
   */
  registerLensAction("command-center", "escalationEngine", (ctx, artifact, params) => {
    const incident = artifact.data?.incident || {};
    const policy = artifact.data?.escalationPolicy || [];
    const now = params.currentTime ? new Date(params.currentTime).getTime() : Date.now();

    const severityWeights = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    const severity = incident.severity || "medium";
    const sevWeight = severityWeights[severity] ?? 2;
    const createdAt = incident.createdAt ? new Date(incident.createdAt).getTime() : now;
    const elapsedMs = now - createdAt;
    const elapsedMinutes = elapsedMs / 60000;

    // Default SLA if not specified
    const slaMinutes = incident.slaMinutes || (severity === "critical" ? 15 : severity === "high" ? 30 : severity === "medium" ? 60 : 240);
    const slaRemainingMinutes = slaMinutes - elapsedMinutes;
    const slaPercentUsed = Math.round((elapsedMinutes / slaMinutes) * 10000) / 100;
    const slaBreached = slaRemainingMinutes <= 0;

    // Compute urgency score (0-100)
    let urgencyScore = sevWeight * 20; // base from severity
    if (slaBreached) urgencyScore += 20;
    else if (slaPercentUsed > 75) urgencyScore += 15;
    else if (slaPercentUsed > 50) urgencyScore += 10;
    if (!incident.acknowledged) urgencyScore += 10;

    // Impact multiplier
    const affectedSystems = incident.affectedSystems || 1;
    const affectedUsers = incident.affectedUsers || 0;
    const impactMultiplier = 1 + Math.log2(Math.max(1, affectedSystems)) * 0.1 + Math.log10(Math.max(1, affectedUsers)) * 0.05;
    urgencyScore = Math.min(100, Math.round(urgencyScore * impactMultiplier));

    // Determine current escalation level
    let currentLevel = 0;
    const escalationPath = [];

    if (policy.length > 0) {
      for (let i = 0; i < policy.length; i++) {
        const level = policy[i];
        const levelSla = level.slaMinutes || (slaMinutes * (i + 1));
        const shouldEscalate =
          elapsedMinutes > levelSla ||
          (level.conditions?.minSeverity && sevWeight >= (severityWeights[level.conditions.minSeverity] ?? 0)) ||
          (level.conditions?.slaBreached && slaBreached);

        escalationPath.push({
          level: level.level || i + 1,
          responders: level.responders || [],
          slaMinutes: levelSla,
          triggered: shouldEscalate,
          triggerReason: shouldEscalate
            ? (elapsedMinutes > levelSla ? "SLA exceeded" : "Condition met")
            : null,
        });

        if (shouldEscalate) currentLevel = i + 1;
      }
    } else {
      // Auto-generate escalation levels based on severity
      const levels = [
        { level: 1, label: "On-call engineer", threshold: 0 },
        { level: 2, label: "Team lead", threshold: slaMinutes * 0.5 },
        { level: 3, label: "Engineering manager", threshold: slaMinutes * 1.0 },
        { level: 4, label: "VP/Director", threshold: slaMinutes * 1.5 },
      ];
      for (const l of levels) {
        const triggered = elapsedMinutes >= l.threshold;
        escalationPath.push({
          level: l.level,
          label: l.label,
          thresholdMinutes: Math.round(l.threshold),
          triggered,
        });
        if (triggered) currentLevel = l.level;
      }
    }

    // Compute recommended actions
    const actions = [];
    if (!incident.acknowledged) actions.push("Acknowledge incident immediately");
    if (slaBreached) actions.push("SLA breached - escalate to next level");
    if (slaPercentUsed > 75 && !slaBreached) actions.push("SLA at risk - prepare escalation");
    if (sevWeight >= 3) actions.push("Page on-call and secondary responders");
    if (affectedUsers > 100) actions.push("Prepare customer communication");
    if (currentLevel >= 3) actions.push("Schedule incident bridge call");

    return {
      ok: true,
      result: {
        incidentId: incident.id,
        severity,
        urgencyScore,
        urgencyLabel: urgencyScore >= 80 ? "critical" : urgencyScore >= 60 ? "high" : urgencyScore >= 40 ? "medium" : "low",
        sla: {
          totalMinutes: slaMinutes,
          elapsedMinutes: Math.round(elapsedMinutes * 100) / 100,
          remainingMinutes: Math.round(slaRemainingMinutes * 100) / 100,
          percentUsed: slaPercentUsed,
          breached: slaBreached,
        },
        escalation: {
          currentLevel,
          maxLevel: escalationPath.length,
          path: escalationPath,
        },
        acknowledgment: {
          acknowledged: !!incident.acknowledged,
          assignee: incident.assignee || null,
        },
        recommendedActions: actions,
      },
    };
  });
}
