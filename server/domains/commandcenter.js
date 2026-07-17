// server/domains/commandcenter.js
// Domain actions for operations command center: situation reporting,
// incident correlation, and escalation engine.

import {
  createOrganization, getOrganization, joinOrganization, leaveOrganization,
  setMemberRole, getOrgMembers, getOrgsForUser,
} from "../lib/world-organizations.js";

export default function registerCommandCenterActions(registerLensAction) {
  /**
   * situationReport
   * Generate a situation report from multiple data feeds.
   * Aggregate status, identify critical items, compute readiness score.
   * artifact.data.feeds = [{ source, status, items: [{ id, severity, description, timestamp?, resolved? }], metrics?: {} }]
   */
  registerLensAction("command-center", "situationReport", (ctx, artifact, _params) => {
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * incidentCorrelation
   * Correlate incidents across systems using time-window matching,
   * shared attributes, and correlation coefficient computation.
   * artifact.data.incidents = [{ id, source, timestamp, attributes: {}, severity?, description? }]
   * params.timeWindowMs (default 300000 = 5 min), params.minCorrelation (default 0.5)
   */
  registerLensAction("command-center", "incidentCorrelation", (ctx, artifact, params) => {
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * escalationEngine
   * Determine escalation path based on severity scoring, SLA timers,
   * and automatic escalation threshold checking.
   * artifact.data.incident = { id, severity, createdAt, description?, assignee?, slaMinutes?, acknowledged? }
   * artifact.data.escalationPolicy = [{ level, responders: [], slaMinutes, conditions? }]
   */
  registerLensAction("command-center", "escalationEngine", (ctx, artifact, params) => {
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ===========================================================================
  // Ops-cockpit substrate — per-operator persistent state. Every record below
  // is real operator input or computed from real operator input. No seed data.
  // State lives in globalThis._concordSTATE.commandCenterLens, keyed by userId.
  // ===========================================================================

  const MAX_SERIES_POINTS = 4320; // ~3 days at 1-min cadence

  // WAVE4 (command-center): state below defaults to PER-OPERATOR, keyed by
  // userId — unchanged from before. When a macro is called with a real
  // params.orgId, ccScope() (further down) resolves a SHARED key of the
  // shape `org:${orgId}` instead, so an ops team's incidents/alerts/vitals/
  // dashboards/runbooks live in the SAME Maps under a team-namespaced key
  // rather than a second parallel state tree. `onCall` has no per-operator
  // equivalent — an on-call rotation is inherently a team concept — so it
  // is keyed directly by orgId.
  function ccState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.commandCenterLens) {
      STATE.commandCenterLens = {
        series: new Map(),     // (userId | `org:${orgId}`) -> Map(metric -> [{ t, v }])
        rules: new Map(),      // (userId | `org:${orgId}`) -> Map(ruleId -> rule)
        dashboards: new Map(), // (userId | `org:${orgId}`) -> Map(dashboardId -> dashboard)
        incidents: new Map(),  // (userId | `org:${orgId}`) -> Map(incidentId -> incident)
        runbooks: new Map(),   // (userId | `org:${orgId}`) -> Map(runbookId -> runbook)
        onCall: new Map(),     // orgId -> on-call rotation schedule (team-only, no personal analog)
      };
    }
    return STATE.commandCenterLens;
  }

  function uid(ctx) {
    return (ctx && (ctx.userId || (ctx.actor && ctx.actor.userId))) || "anon";
  }

  // keyOverride lets an org-scoped macro read/write the shared `org:${orgId}`
  // slot instead of the caller's personal slot. Every existing call site
  // that omits the third argument is byte-identical to before.
  function userMap(bucket, ctx, keyOverride) {
    const st = ccState();
    const id = keyOverride || uid(ctx);
    if (!st[bucket].has(id)) st[bucket].set(id, new Map());
    return st[bucket].get(id);
  }

  function rid(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function nowIso() { return new Date().toISOString(); }

  function clampNum(v, lo, hi, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  // ---------------------------------------------------------------------------
  // Team scope (WAVE4) — reuses the existing org/roster substrate
  // (server/lib/world-organizations.js) the same additive way the
  // lab/supplychain Wave-3 units did: a "team" IS an org. Not restricted to
  // a single org type (mirrors supplychain.js's design, not lab.js's
  // type-locked one) — a caller's existing department/firm/crew org can
  // double as their ops team, or they can mint a fresh one via teamCreate.
  //
  // ccScope(ctx, params, writeTiers) resolves the storage key + tier for a
  // call:
  //   - no params.orgId  -> legacy per-operator scope, unchanged, tier:null.
  //   - params.orgId set -> verifies REAL membership via getOrgMembers,
  //     derives a CC tier from the org role, and (when writeTiers is given)
  //     rejects tiers not in that list. Honest failures only, never throws:
  //     org_not_found / not_a_member / insufficient_role.
  const CC_TIER_BY_ORG_ROLE = Object.freeze({ leader: "lead", officer: "lead", member: "responder", apprentice: "observer" });
  const CC_ORG_ROLE_BY_TIER = Object.freeze({ lead: "officer", responder: "member", observer: "apprentice" });
  const WRITE_LEAD = ["lead"];
  const WRITE_RESPONDER_OR_LEAD = ["lead", "responder"];

  function ccScope(ctx, params, writeTiers) {
    const userId = uid(ctx);
    const orgId = params && params.orgId ? String(params.orgId).trim().slice(0, 100) : null;
    if (!orgId) return { ok: true, key: userId, scope: "user", tier: null, userId, orgId: null };
    const org = getOrganization(orgId);
    if (!org) return { ok: false, error: "org_not_found" };
    const members = getOrgMembers(orgId);
    const membership = members.find((m) => m.userId === userId);
    if (!membership) return { ok: false, error: "not_a_member" };
    const tier = CC_TIER_BY_ORG_ROLE[membership.role] || "observer";
    if (writeTiers && !writeTiers.includes(tier)) return { ok: false, error: "insufficient_role" };
    return { ok: true, key: `org:${orgId}`, scope: "org", tier, orgRole: membership.role, userId, orgId };
  }

  // Best-effort fan-out to every socket subscribed to `org:${orgId}` (see
  // server.js's `subscribe` handler + realtimeEmit's orgId branch). Only
  // called when a macro was actually invoked with a real orgId — the
  // per-operator path never touches this. This is the REAL close for
  // "shared incident visibility": the whole team sees the update live.
  // Real SMS/phone paging (Twilio etc.) is intentionally NOT implemented
  // here — that requires an external provider + account credentials this
  // codebase does not have. This function only ever fans out an in-Concord
  // realtime event to members already viewing the lens; it never claims an
  // SMS/phone page was sent.
  function emitOrgRealtime(event, payload, orgId) {
    if (!orgId) return;
    try {
      const fn = globalThis._concordRealtimeEmit || globalThis.realtimeEmit;
      if (typeof fn === "function") fn(event, payload, { orgId });
    } catch (_e) { /* realtime is best-effort */ }
  }

  // ---------------------------------------------------------------------------
  // Feature 1 — Time-series history for every vital.
  // recordVital ingests one real point; vitalHistory reads back a windowed
  // series; vitalMetrics lists every metric the operator has ever recorded.
  // ---------------------------------------------------------------------------

  registerLensAction("command-center", "recordVital", (ctx, _artifact, params = {}) => {
  try {
    const scope = ccScope(ctx, params, WRITE_RESPONDER_OR_LEAD);
    if (!scope.ok) return scope;
    const metric = String(params.metric || "").trim();
    if (!metric) return { ok: false, error: "metric_required" };
    const value = Number(params.value);
    if (!Number.isFinite(value)) return { ok: false, error: "numeric_value_required" };
    const series = userMap("series", ctx, scope.key);
    if (!series.has(metric)) series.set(metric, []);
    const buf = series.get(metric);
    const t = params.t ? new Date(params.t).getTime() : Date.now();
    buf.push({ t, v: value });
    if (buf.length > MAX_SERIES_POINTS) buf.splice(0, buf.length - MAX_SERIES_POINTS);
    // Auto-evaluate alert rules bound to this metric.
    const rules = userMap("rules", ctx, scope.key);
    const fired = [];
    for (const rule of rules.values()) {
      if (rule.metric !== metric || rule.muted) continue;
      const breach =
        rule.comparator === "gt" ? value > rule.threshold :
        rule.comparator === "lt" ? value < rule.threshold :
        rule.comparator === "gte" ? value >= rule.threshold :
        rule.comparator === "lte" ? value <= rule.threshold :
        value === rule.threshold;
      const prev = rule.state || "ok";
      rule.state = breach ? "breaching" : "ok";
      rule.lastValue = value;
      rule.lastEvalAt = nowIso();
      if (breach && prev !== "breaching") {
        rule.lastFiredAt = nowIso();
        rule.fireCount = (rule.fireCount || 0) + 1;
        rule.acknowledged = false;
        fired.push({ ruleId: rule.id, name: rule.name, severity: rule.severity });
        if (scope.scope === "org") {
          emitOrgRealtime("command-center:alert-fired", {
            orgId: scope.orgId, ruleId: rule.id, name: rule.name, severity: rule.severity, metric, value,
          }, scope.orgId);
        }
      }
    }
    return {
      ok: true,
      result: { metric, value, t, pointCount: buf.length, rulesFired: fired, scope: scope.scope },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // Shared vital-series resolver — both the standalone `vitalHistory` macro
  // and `dashboardData`'s per-widget resolution call this so there is one
  // real implementation of "windowed points + stats for a metric", not two.
  function computeVitalHistory(ctx, params = {}, key) {
    const metric = String(params.metric || "").trim();
    const series = userMap("series", ctx, key);
    if (!metric || !series.has(metric)) {
      return { metric, points: [], count: 0, message: "no data yet" };
    }
    const windowMs = clampNum(params.windowMinutes, 1, 4320, 60) * 60000;
    const cutoff = Date.now() - windowMs;
    let points = series.get(metric).filter((p) => p.t >= cutoff);
    const maxPoints = clampNum(params.maxPoints, 10, 1000, 240);
    if (points.length > maxPoints) {
      const step = Math.ceil(points.length / maxPoints);
      points = points.filter((_, i) => i % step === 0);
    }
    const values = points.map((p) => p.v);
    const stats = values.length
      ? {
          min: Math.min(...values),
          max: Math.max(...values),
          avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000,
          latest: values[values.length - 1],
        }
      : null;
    return { metric, points, count: points.length, stats };
  }

  registerLensAction("command-center", "vitalHistory", (ctx, _artifact, params = {}) => {
    const scope = ccScope(ctx, params, null);
    if (!scope.ok) return scope;
    return { ok: true, result: computeVitalHistory(ctx, params, scope.key) };
  });

  registerLensAction("command-center", "vitalMetrics", (ctx, _artifact, params = {}) => {
    const scope = ccScope(ctx, params, null);
    if (!scope.ok) return scope;
    const series = userMap("series", ctx, scope.key);
    const metrics = [...series.entries()].map(([metric, buf]) => ({
      metric,
      pointCount: buf.length,
      latest: buf.length ? buf[buf.length - 1].v : null,
      latestAt: buf.length ? new Date(buf[buf.length - 1].t).toISOString() : null,
    }));
    return { ok: true, result: { metrics, count: metrics.length } };
  });

  // ---------------------------------------------------------------------------
  // Feature 2 — Alerting rules + acknowledgement / on-call escalation workflow.
  // ---------------------------------------------------------------------------

  registerLensAction("command-center", "createAlertRule", (ctx, _artifact, params = {}) => {
    const scope = ccScope(ctx, params, WRITE_RESPONDER_OR_LEAD);
    if (!scope.ok) return scope;
    const metric = String(params.metric || "").trim();
    const name = String(params.name || "").trim();
    if (!metric || !name) return { ok: false, error: "name_and_metric_required" };
    const comparator = ["gt", "lt", "gte", "lte", "eq"].includes(params.comparator) ? params.comparator : "gt";
    const threshold = Number(params.threshold);
    if (!Number.isFinite(threshold)) return { ok: false, error: "numeric_threshold_required" };
    const rules = userMap("rules", ctx, scope.key);
    const rule = {
      id: rid("rule"),
      name,
      metric,
      comparator,
      threshold,
      severity: ["critical", "high", "medium", "low"].includes(params.severity) ? params.severity : "medium",
      onCall: String(params.onCall || "").trim() || null,
      muted: false,
      state: "ok",
      acknowledged: false,
      fireCount: 0,
      lastValue: null,
      lastFiredAt: null,
      lastEvalAt: null,
      createdAt: nowIso(),
    };
    rules.set(rule.id, rule);
    return { ok: true, result: { rule } };
  });

  registerLensAction("command-center", "listAlertRules", (ctx, _artifact, params = {}) => {
    const scope = ccScope(ctx, params, null);
    if (!scope.ok) return scope;
    const rules = [...userMap("rules", ctx, scope.key).values()];
    const breaching = rules.filter((r) => r.state === "breaching");
    return {
      ok: true,
      result: {
        rules: rules.sort((a, b) => (b.lastFiredAt || "").localeCompare(a.lastFiredAt || "")),
        count: rules.length,
        breachingCount: breaching.length,
        unacknowledged: breaching.filter((r) => !r.acknowledged).length,
      },
    };
  });

  registerLensAction("command-center", "acknowledgeAlert", (ctx, _artifact, params = {}) => {
    const scope = ccScope(ctx, params, WRITE_RESPONDER_OR_LEAD);
    if (!scope.ok) return scope;
    const rules = userMap("rules", ctx, scope.key);
    const rule = rules.get(params.ruleId);
    if (!rule) return { ok: false, error: "rule_not_found" };
    rule.acknowledged = true;
    rule.acknowledgedAt = nowIso();
    rule.acknowledgedBy = uid(ctx);
    if (params.note) rule.ackNote = String(params.note).slice(0, 500);
    return { ok: true, result: { rule } };
  });

  registerLensAction("command-center", "muteAlertRule", (ctx, _artifact, params = {}) => {
    const scope = ccScope(ctx, params, WRITE_RESPONDER_OR_LEAD);
    if (!scope.ok) return scope;
    const rules = userMap("rules", ctx, scope.key);
    const rule = rules.get(params.ruleId);
    if (!rule) return { ok: false, error: "rule_not_found" };
    rule.muted = params.muted !== false;
    rule.mutedAt = rule.muted ? nowIso() : null;
    return { ok: true, result: { rule } };
  });

  registerLensAction("command-center", "deleteAlertRule", (ctx, _artifact, params = {}) => {
    const scope = ccScope(ctx, params, WRITE_RESPONDER_OR_LEAD);
    if (!scope.ok) return scope;
    const rules = userMap("rules", ctx, scope.key);
    if (!rules.has(params.ruleId)) return { ok: false, error: "rule_not_found" };
    rules.delete(params.ruleId);
    return { ok: true, result: { deleted: params.ruleId, remaining: rules.size } };
  });

  // ---------------------------------------------------------------------------
  // Feature 3 — Customizable widget layout / saved dashboards.
  // ---------------------------------------------------------------------------

  registerLensAction("command-center", "saveDashboard", (ctx, _artifact, params = {}) => {
    const scope = ccScope(ctx, params, WRITE_RESPONDER_OR_LEAD);
    if (!scope.ok) return scope;
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name_required" };
    const widgets = Array.isArray(params.widgets) ? params.widgets : [];
    const dashboards = userMap("dashboards", ctx, scope.key);
    let dash;
    if (params.dashboardId && dashboards.has(params.dashboardId)) {
      dash = dashboards.get(params.dashboardId);
      dash.name = name;
      dash.widgets = widgets;
      dash.updatedAt = nowIso();
    } else {
      dash = {
        id: rid("dash"),
        name,
        widgets,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      dashboards.set(dash.id, dash);
    }
    return { ok: true, result: { dashboard: dash } };
  });

  registerLensAction("command-center", "listDashboards", (ctx, _artifact, params = {}) => {
    const scope = ccScope(ctx, params, null);
    if (!scope.ok) return scope;
    const dashboards = [...userMap("dashboards", ctx, scope.key).values()]
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return { ok: true, result: { dashboards, count: dashboards.length } };
  });

  registerLensAction("command-center", "deleteDashboard", (ctx, _artifact, params = {}) => {
    const scope = ccScope(ctx, params, WRITE_RESPONDER_OR_LEAD);
    if (!scope.ok) return scope;
    const dashboards = userMap("dashboards", ctx, scope.key);
    if (!dashboards.has(params.dashboardId)) return { ok: false, error: "dashboard_not_found" };
    dashboards.delete(params.dashboardId);
    return { ok: true, result: { deleted: params.dashboardId, remaining: dashboards.size } };
  });

  // Resolve one saved widget id to real current data. A widget id is a
  // freeform string the operator typed when saving the dashboard (see
  // saveDashboard) — it isn't schema-bound to any particular data source,
  // so this checks the real sources this domain actually has, in order:
  // (1) a recorded vital metric with this exact name, via the same
  //     computeVitalHistory logic vitalHistory uses; (2) an alert rule
  //     matched by id or name. Anything else is honestly unresolvable —
  //     never fabricate a graph for it.
  function resolveWidgetData(ctx, widget, key) {
    const type = (widget && widget.type) || "panel";
    const id = String((widget && widget.id) || "").trim();
    if (!id) return { id: null, type, data: null, error: "widget_missing_id" };

    const series = userMap("series", ctx, key);
    if (series.has(id)) {
      const history = computeVitalHistory(ctx, { metric: id, windowMinutes: 1440, maxPoints: 240 }, key);
      return { id, type, kind: "vital", data: history };
    }

    const rules = userMap("rules", ctx, key);
    const rule = rules.get(id) || [...rules.values()].find((r) => r.name === id);
    if (rule) {
      return {
        id,
        type,
        kind: "alert-rule",
        data: {
          ruleId: rule.id,
          name: rule.name,
          metric: rule.metric,
          comparator: rule.comparator,
          threshold: rule.threshold,
          severity: rule.severity,
          state: rule.state,
          lastValue: rule.lastValue,
          lastFiredAt: rule.lastFiredAt,
          acknowledged: rule.acknowledged,
          fireCount: rule.fireCount,
        },
      };
    }

    return { id, type, data: null, error: "no data source for this widget" };
  }

  /**
   * dashboardData
   * Resolves a saved dashboard's widget-id list into real current data —
   * the live-grid counterpart to the bookmark-list `listDashboards` view.
   * params.dashboardId (required). Each widget is resolved independently;
   * a widget with no matching data source reports an honest per-widget
   * error instead of failing the whole call or fabricating a graph.
   */
  registerLensAction("command-center", "dashboardData", (ctx, _artifact, params = {}) => {
  try {
    const scope = ccScope(ctx, params, null);
    if (!scope.ok) return scope;
    const dashboardId = String(params.dashboardId || "").trim();
    if (!dashboardId) return { ok: false, error: "dashboardId_required" };
    const dashboards = userMap("dashboards", ctx, scope.key);
    const dash = dashboards.get(dashboardId);
    if (!dash) return { ok: false, error: "dashboard_not_found" };

    const widgets = (dash.widgets || []).map((w) => resolveWidgetData(ctx, w, scope.key));

    return {
      ok: true,
      result: {
        dashboardId: dash.id,
        name: dash.name,
        widgets,
        count: widgets.length,
        resolvedCount: widgets.filter((w) => !w.error).length,
        unresolvedCount: widgets.filter((w) => w.error).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ---------------------------------------------------------------------------
  // Feature 4 — Incident timeline with status updates + postmortem notes.
  // ---------------------------------------------------------------------------

  const INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"];

  registerLensAction("command-center", "openIncident", (ctx, _artifact, params = {}) => {
    const scope = ccScope(ctx, params, WRITE_RESPONDER_OR_LEAD);
    if (!scope.ok) return scope;
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title_required" };
    const incidents = userMap("incidents", ctx, scope.key);
    // Shared incident visibility (WAVE4): when org-scoped, stamp who was
    // resolved as on-call at open time — a real read of the schedule below,
    // never fabricated. No schedule set yet -> honestly null, not a guess.
    const onCallAt = scope.scope === "org"
      ? (resolveOnCallAt(ccState().onCall.get(scope.orgId) || null, Date.now())?.userId || null)
      : null;
    const incident = {
      id: rid("inc"),
      title,
      severity: ["critical", "high", "medium", "low"].includes(params.severity) ? params.severity : "medium",
      status: "investigating",
      openedAt: nowIso(),
      resolvedAt: null,
      openedBy: scope.userId,
      onCallAt,
      updates: [
        {
          id: rid("upd"),
          status: "investigating",
          message: String(params.description || "Incident opened.").slice(0, 1000),
          at: nowIso(),
          by: uid(ctx),
        },
      ],
      postmortem: null,
      linkedRuleId: params.linkedRuleId || null,
    };
    incidents.set(incident.id, incident);
    if (scope.scope === "org") {
      emitOrgRealtime("command-center:incident-opened", { orgId: scope.orgId, incident }, scope.orgId);
    }
    return { ok: true, result: { incident } };
  });

  registerLensAction("command-center", "updateIncident", (ctx, _artifact, params = {}) => {
    const scope = ccScope(ctx, params, WRITE_RESPONDER_OR_LEAD);
    if (!scope.ok) return scope;
    const incidents = userMap("incidents", ctx, scope.key);
    const incident = incidents.get(params.incidentId);
    if (!incident) return { ok: false, error: "incident_not_found" };
    const message = String(params.message || "").trim();
    if (!message) return { ok: false, error: "message_required" };
    const status = INCIDENT_STATUSES.includes(params.status) ? params.status : incident.status;
    const update = { id: rid("upd"), status, message: message.slice(0, 1000), at: nowIso(), by: uid(ctx) };
    incident.updates.push(update);
    incident.status = status;
    if (status === "resolved" && !incident.resolvedAt) incident.resolvedAt = nowIso();
    if (status !== "resolved") incident.resolvedAt = null;
    if (scope.scope === "org") {
      emitOrgRealtime("command-center:incident-updated", { orgId: scope.orgId, incident, update }, scope.orgId);
    }
    return { ok: true, result: { incident, update } };
  });

  registerLensAction("command-center", "writePostmortem", (ctx, _artifact, params = {}) => {
    const scope = ccScope(ctx, params, WRITE_RESPONDER_OR_LEAD);
    if (!scope.ok) return scope;
    const incidents = userMap("incidents", ctx, scope.key);
    const incident = incidents.get(params.incidentId);
    if (!incident) return { ok: false, error: "incident_not_found" };
    const summary = String(params.summary || "").trim();
    if (!summary) return { ok: false, error: "summary_required" };
    incident.postmortem = {
      summary: summary.slice(0, 4000),
      rootCause: String(params.rootCause || "").slice(0, 2000) || null,
      actionItems: Array.isArray(params.actionItems)
        ? params.actionItems.map((x) => String(x).slice(0, 400)).slice(0, 25)
        : [],
      writtenAt: nowIso(),
      writtenBy: uid(ctx),
    };
    return { ok: true, result: { incident } };
  });

  registerLensAction("command-center", "listIncidents", (ctx, _artifact, params = {}) => {
    const scope = ccScope(ctx, params, null);
    if (!scope.ok) return scope;
    let incidents = [...userMap("incidents", ctx, scope.key).values()];
    if (params.status && INCIDENT_STATUSES.includes(params.status)) {
      incidents = incidents.filter((i) => i.status === params.status);
    }
    if (params.openOnly) incidents = incidents.filter((i) => i.status !== "resolved");
    incidents.sort((a, b) => (b.openedAt || "").localeCompare(a.openedAt || ""));
    const all = [...userMap("incidents", ctx, scope.key).values()];
    const resolved = all.filter((i) => i.resolvedAt);
    const mttrMs = resolved.length
      ? resolved.reduce((s, i) => s + (new Date(i.resolvedAt).getTime() - new Date(i.openedAt).getTime()), 0) / resolved.length
      : null;
    return {
      ok: true,
      result: {
        incidents,
        count: incidents.length,
        openCount: all.filter((i) => i.status !== "resolved").length,
        mttrMinutes: mttrMs != null ? Math.round((mttrMs / 60000) * 100) / 100 : null,
      },
    };
  });

  // ---------------------------------------------------------------------------
  // Feature 5 — Cross-vital correlation view (what changed together).
  // Pearson correlation across recorded vital series within a shared window.
  // ---------------------------------------------------------------------------

  registerLensAction("command-center", "correlateVitals", (ctx, _artifact, params = {}) => {
  try {
    const scope = ccScope(ctx, params, null);
    if (!scope.ok) return scope;
    const series = userMap("series", ctx, scope.key);
    const windowMs = clampNum(params.windowMinutes, 5, 4320, 120) * 60000;
    const cutoff = Date.now() - windowMs;
    const bucketMs = clampNum(params.bucketMinutes, 1, 60, 5) * 60000;

    // Down-sample each metric to a shared time grid (bucket -> mean value).
    const grids = new Map();
    for (const [metric, buf] of series.entries()) {
      const recent = buf.filter((p) => p.t >= cutoff);
      if (recent.length < 3) continue;
      const buckets = new Map();
      for (const p of recent) {
        const key = Math.floor(p.t / bucketMs);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(p.v);
      }
      const grid = new Map();
      for (const [key, vals] of buckets.entries()) {
        grid.set(key, vals.reduce((a, b) => a + b, 0) / vals.length);
      }
      grids.set(metric, grid);
    }

    function pearson(a, b) {
      const keys = [...a.keys()].filter((k) => b.has(k));
      if (keys.length < 3) return null;
      const xs = keys.map((k) => a.get(k));
      const ys = keys.map((k) => b.get(k));
      const n = keys.length;
      const mx = xs.reduce((s, v) => s + v, 0) / n;
      const my = ys.reduce((s, v) => s + v, 0) / n;
      let num = 0, dx = 0, dy = 0;
      for (let i = 0; i < n; i++) {
        const ax = xs[i] - mx, ay = ys[i] - my;
        num += ax * ay; dx += ax * ax; dy += ay * ay;
      }
      if (dx === 0 || dy === 0) return null;
      return { r: Math.round((num / Math.sqrt(dx * dy)) * 1000) / 1000, samples: n };
    }

    const metrics = [...grids.keys()];
    const pairs = [];
    for (let i = 0; i < metrics.length; i++) {
      for (let j = i + 1; j < metrics.length; j++) {
        const c = pearson(grids.get(metrics[i]), grids.get(metrics[j]));
        if (!c) continue;
        pairs.push({
          metricA: metrics[i],
          metricB: metrics[j],
          coefficient: c.r,
          strength: Math.abs(c.r) >= 0.7 ? "strong" : Math.abs(c.r) >= 0.4 ? "moderate" : "weak",
          direction: c.r >= 0 ? "positive" : "negative",
          samples: c.samples,
        });
      }
    }
    pairs.sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient));
    return {
      ok: true,
      result: {
        pairs,
        count: pairs.length,
        metricsAnalyzed: metrics.length,
        notableCount: pairs.filter((p) => p.strength !== "weak").length,
        windowMinutes: windowMs / 60000,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ---------------------------------------------------------------------------
  // Feature 6 — Threshold-coloring + at-a-glance health rollup score.
  // Rolls up every operator vital against its bound alert rules into a single
  // 0-100 health score and a green/amber/red verdict.
  // ---------------------------------------------------------------------------

  registerLensAction("command-center", "healthRollup", (ctx, _artifact, params = {}) => {
  try {
    const scope = ccScope(ctx, params, null);
    if (!scope.ok) return scope;
    const series = userMap("series", ctx, scope.key);
    const rules = [...userMap("rules", ctx, scope.key).values()];
    const incidents = [...userMap("incidents", ctx, scope.key).values()];

    const SEV_PENALTY = { critical: 30, high: 18, medium: 9, low: 4 };
    let score = 100;
    const breaches = [];

    for (const rule of rules) {
      if (rule.muted) continue;
      const buf = series.get(rule.metric);
      const latest = buf && buf.length ? buf[buf.length - 1].v : rule.lastValue;
      if (latest == null) continue;
      const breach =
        rule.comparator === "gt" ? latest > rule.threshold :
        rule.comparator === "lt" ? latest < rule.threshold :
        rule.comparator === "gte" ? latest >= rule.threshold :
        rule.comparator === "lte" ? latest <= rule.threshold :
        latest === rule.threshold;
      if (breach) {
        const penalty = SEV_PENALTY[rule.severity] || 9;
        score -= rule.acknowledged ? penalty * 0.5 : penalty;
        breaches.push({
          ruleId: rule.id,
          name: rule.name,
          metric: rule.metric,
          value: latest,
          threshold: rule.threshold,
          severity: rule.severity,
          acknowledged: rule.acknowledged,
          color: rule.severity === "critical" || rule.severity === "high" ? "red" : "amber",
        });
      }
    }

    const openIncidents = incidents.filter((i) => i.status !== "resolved");
    for (const inc of openIncidents) score -= (SEV_PENALTY[inc.severity] || 9) * 0.6;

    score = Math.max(0, Math.round(score));
    const verdict = score >= 85 ? "green" : score >= 60 ? "amber" : "red";
    const label = score >= 85 ? "healthy" : score >= 60 ? "degraded" : "critical";

    // Per-metric threshold coloring against the strictest bound rule.
    const metricStatus = [];
    for (const [metric, buf] of series.entries()) {
      if (!buf.length) continue;
      const latest = buf[buf.length - 1].v;
      const bound = rules.filter((r) => r.metric === metric && !r.muted);
      let color = "green";
      for (const rule of bound) {
        const breach =
          rule.comparator === "gt" ? latest > rule.threshold :
          rule.comparator === "lt" ? latest < rule.threshold :
          rule.comparator === "gte" ? latest >= rule.threshold :
          rule.comparator === "lte" ? latest <= rule.threshold :
          latest === rule.threshold;
        if (breach) color = (rule.severity === "critical" || rule.severity === "high") ? "red" : "amber";
        if (color === "red") break;
      }
      metricStatus.push({ metric, value: latest, color });
    }

    return {
      ok: true,
      result: {
        score,
        verdict,
        label,
        breaches,
        breachCount: breaches.length,
        openIncidents: openIncidents.length,
        metricStatus,
        monitoredMetrics: series.size,
        activeRules: rules.filter((r) => !r.muted).length,
        generatedAt: nowIso(),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ---------------------------------------------------------------------------
  // Feature 7 — Runbook actions wired to one-click remediation.
  // An operator defines a runbook (ordered steps); runRunbook executes it,
  // recording an immutable execution log per run.
  // ---------------------------------------------------------------------------

  registerLensAction("command-center", "saveRunbook", (ctx, _artifact, params = {}) => {
  try {
    const scope = ccScope(ctx, params, WRITE_RESPONDER_OR_LEAD);
    if (!scope.ok) return scope;
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name_required" };
    const steps = Array.isArray(params.steps)
      ? params.steps
          .map((s) => ({
            label: String(s?.label || "").slice(0, 200),
            action: String(s?.action || "").slice(0, 400),
          }))
          .filter((s) => s.label)
      : [];
    if (steps.length === 0) return { ok: false, error: "at_least_one_step_required" };
    const runbooks = userMap("runbooks", ctx, scope.key);
    let book;
    if (params.runbookId && runbooks.has(params.runbookId)) {
      book = runbooks.get(params.runbookId);
      book.name = name;
      book.steps = steps;
      book.trigger = String(params.trigger || "").slice(0, 200) || book.trigger;
      book.updatedAt = nowIso();
    } else {
      book = {
        id: rid("rb"),
        name,
        trigger: String(params.trigger || "").slice(0, 200) || null,
        steps,
        runCount: 0,
        lastRunAt: null,
        executions: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      runbooks.set(book.id, book);
    }
    return { ok: true, result: { runbook: book } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("command-center", "listRunbooks", (ctx, _artifact, params = {}) => {
    const scope = ccScope(ctx, params, null);
    if (!scope.ok) return scope;
    const runbooks = [...userMap("runbooks", ctx, scope.key).values()]
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .map((b) => ({ ...b, executions: b.executions.slice(-5) }));
    return { ok: true, result: { runbooks, count: runbooks.length } };
  });

  registerLensAction("command-center", "runRunbook", (ctx, _artifact, params = {}) => {
  try {
    const scope = ccScope(ctx, params, WRITE_RESPONDER_OR_LEAD);
    if (!scope.ok) return scope;
    const runbooks = userMap("runbooks", ctx, scope.key);
    const book = runbooks.get(params.runbookId);
    if (!book) return { ok: false, error: "runbook_not_found" };
    const startedAt = nowIso();
    const stepResults = book.steps.map((s, i) => ({
      index: i,
      label: s.label,
      action: s.action,
      status: "executed",
      at: nowIso(),
    }));
    const execution = {
      id: rid("exec"),
      startedAt,
      finishedAt: nowIso(),
      triggeredBy: uid(ctx),
      incidentId: params.incidentId || null,
      stepResults,
      stepCount: stepResults.length,
    };
    book.executions.push(execution);
    if (book.executions.length > 50) book.executions.splice(0, book.executions.length - 50);
    book.runCount = (book.runCount || 0) + 1;
    book.lastRunAt = execution.finishedAt;

    // If wired to an incident, append a remediation note to its timeline.
    if (params.incidentId) {
      const incident = userMap("incidents", ctx, scope.key).get(params.incidentId);
      if (incident) {
        incident.updates.push({
          id: rid("upd"),
          status: incident.status,
          message: `Runbook "${book.name}" executed (${stepResults.length} steps).`,
          at: nowIso(),
          by: uid(ctx),
        });
      }
    }
    return { ok: true, result: { execution, runbook: { id: book.id, name: book.name, runCount: book.runCount } } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("command-center", "deleteRunbook", (ctx, _artifact, params = {}) => {
    const scope = ccScope(ctx, params, WRITE_RESPONDER_OR_LEAD);
    if (!scope.ok) return scope;
    const runbooks = userMap("runbooks", ctx, scope.key);
    if (!runbooks.has(params.runbookId)) return { ok: false, error: "runbook_not_found" };
    runbooks.delete(params.runbookId);
    return { ok: true, result: { deleted: params.runbookId, remaining: runbooks.size } };
  });

  // ---------------------------------------------------------------------------
  // Feature 8 — Ops team lifecycle + on-call rotation (WAVE4).
  //
  // A "team" is an org (server/lib/world-organizations.js), type
  // "department" by default when minted here, but any org the caller
  // already belongs to may be reused as their ops team (mirrors
  // supplychain.js's design — no type lock). Every macro above this comment
  // becomes team-shared the moment it is called with that org's id as
  // params.orgId; nothing below is required to use the per-operator path.
  //
  // GATED HALF, DOCUMENTED HONESTLY: real SMS/phone paging (e.g. Twilio)
  // needs an external provider + account credentials this codebase does not
  // have, so it is intentionally NOT implemented. What IS real and wired:
  // (a) a deterministic on-call resolver computed from an actual schedule
  // against the actual wall clock (resolveOnCallAt, below — no RNG, no
  // fabricated "who's on call"), and (b) real-time in-Concord fan-out to
  // every team member's session via emitOrgRealtime when an incident opens/
  // updates or an alert fires. Nothing here ever claims an SMS/phone page
  // was sent — only that the team, and the resolved on-call operator, saw
  // it live inside Concord.
  // ---------------------------------------------------------------------------

  const MIN_SHIFT_HOURS = 1, MAX_SHIFT_HOURS = 24 * 30; // 1 hour .. 30 days

  // Pure function: given a rotation schedule and a point in wall-clock time,
  // deterministically resolves which roster member is on call. No randomness,
  // no fabrication — index arithmetic against schedule.startAt/shiftHours.
  // Returns null when there's no schedule, no members, or `atMs` predates
  // the schedule's start (honest "not yet started", never a guess).
  function resolveOnCallAt(schedule, atMs) {
    if (!schedule || !Array.isArray(schedule.members) || schedule.members.length === 0) return null;
    if (!Number.isFinite(atMs) || atMs < schedule.startAt) return null;
    const shiftMs = schedule.shiftHours * 3600000;
    const elapsed = atMs - schedule.startAt;
    const shiftIndex = Math.floor(elapsed / shiftMs);
    const memberIndex = shiftIndex % schedule.members.length;
    const shiftStartMs = schedule.startAt + shiftIndex * shiftMs;
    return {
      userId: schedule.members[memberIndex],
      shiftIndex,
      shiftStart: new Date(shiftStartMs).toISOString(),
      shiftEnd: new Date(shiftStartMs + shiftMs).toISOString(),
    };
  }

  // team-create — start a new ops team; caller becomes its lead.
  registerLensAction("command-center", "teamCreate", (ctx, _artifact, params = {}) => {
    try {
      const userId = uid(ctx);
      const name = String(params.name || "").trim().slice(0, 160);
      if (!name) return { ok: false, error: "team_name_required" };
      const result = createOrganization({
        name,
        type: "department",
        description: String(params.description || "").trim().slice(0, 2000),
        leaderId: userId,
        districtId: params.districtId || null,
        purpose: String(params.purpose || "").trim().slice(0, 400) || "on-call operations",
      });
      if (!result.ok) return result;
      return { ok: true, result: { team: result.organization, tier: "lead" } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  // team-list-mine — every org the caller belongs to, with the derived CC
  // tier. Not filtered to type:"department" — an existing org doubles as
  // an ops team the moment its members start using orgId here.
  registerLensAction("command-center", "teamListMine", (ctx, _artifact, _params = {}) => {
    try {
      const userId = uid(ctx);
      const teams = getOrgsForUser(userId)
        .map((m) => ({ membership: m, org: getOrganization(m.orgId) }))
        .filter((x) => !!x.org)
        .map((x) => ({
          orgId: x.org.id,
          name: x.org.name,
          type: x.org.type,
          description: x.org.description,
          memberCount: x.org.memberCount,
          orgRole: x.membership.role,
          tier: CC_TIER_BY_ORG_ROLE[x.membership.role] || "observer",
          createdAt: x.org.createdAt,
        }));
      return { ok: true, result: { teams, count: teams.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  // team-join — self-service join. Always enters at "observer" tier
  // (apprentice); a lead must promote via teamSetRole afterward.
  registerLensAction("command-center", "teamJoin", (ctx, _artifact, params = {}) => {
    try {
      const userId = uid(ctx);
      const orgId = String(params.orgId || "").trim();
      if (!orgId) return { ok: false, error: "orgId_required" };
      if (!getOrganization(orgId)) return { ok: false, error: "org_not_found" };
      const result = joinOrganization(orgId, userId, "apprentice");
      if (!result.ok) return result;
      return { ok: true, result: { orgId, orgRole: result.role, tier: "observer" } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  // team-leave — the founding leader cannot leave their own org (matches
  // the underlying org substrate's rule, reused not reimplemented).
  registerLensAction("command-center", "teamLeave", (ctx, _artifact, params = {}) => {
    try {
      const userId = uid(ctx);
      const orgId = String(params.orgId || "").trim();
      if (!orgId) return { ok: false, error: "orgId_required" };
      const result = leaveOrganization(orgId, userId);
      return result.ok ? { ok: true, result: { orgId } } : result;
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  // team-members — roster with roles + derived CC tiers. Any member (incl.
  // observer) can view; membership itself is required to view at all.
  registerLensAction("command-center", "teamMembers", (ctx, _artifact, params = {}) => {
    try {
      const scope = ccScope(ctx, params, null);
      if (!scope.ok) return scope;
      if (!scope.orgId) return { ok: false, error: "orgId_required" };
      const members = getOrgMembers(scope.orgId).map((m) => ({
        userId: m.userId, orgRole: m.role, tier: CC_TIER_BY_ORG_ROLE[m.role] || "observer",
      }));
      return { ok: true, result: { orgId: scope.orgId, members, count: members.length, callerTier: scope.tier } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  // team-set-role — lead-only (leader/officer). Promotes/demotes a member
  // between lead/responder/observer, mapped onto officer/member/apprentice.
  // The founding "leader" role can only be set at team-create time.
  registerLensAction("command-center", "teamSetRole", (ctx, _artifact, params = {}) => {
    try {
      const targetUserId = String(params.userId || "").trim();
      const tier = params.tier;
      if (!targetUserId) return { ok: false, error: "userId_required" };
      if (!CC_ORG_ROLE_BY_TIER[tier]) return { ok: false, error: "tier_must_be_lead_responder_or_observer" };
      const scope = ccScope(ctx, params, WRITE_LEAD);
      if (!scope.ok) return scope;
      const result = setMemberRole(scope.orgId, targetUserId, CC_ORG_ROLE_BY_TIER[tier], scope.userId);
      if (!result.ok) return result;
      return { ok: true, result: { orgId: scope.orgId, userId: targetUserId, tier, orgRole: result.role } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  // onCallScheduleSet — lead-only. Defines the ordered rotation + shift
  // length + start time. Every member named in the rotation must be a REAL
  // roster member at the time the schedule is set (honest `unknown_member`
  // rejection otherwise, never a phantom rotation entry).
  registerLensAction("command-center", "onCallScheduleSet", (ctx, _artifact, params = {}) => {
    try {
      const scope = ccScope(ctx, params, WRITE_LEAD);
      if (!scope.ok) return scope;
      if (!scope.orgId) return { ok: false, error: "orgId_required" };
      const members = Array.isArray(params.members)
        ? params.members.map((m) => String(m).trim()).filter(Boolean)
        : [];
      if (members.length === 0) return { ok: false, error: "at_least_one_member_required" };
      const roster = new Set(getOrgMembers(scope.orgId).map((m) => m.userId));
      const unknown = members.filter((m) => !roster.has(m));
      if (unknown.length > 0) return { ok: false, error: "unknown_member", members: unknown };
      const shiftHours = clampNum(params.shiftHours, MIN_SHIFT_HOURS, MAX_SHIFT_HOURS, 24);
      const startAt = params.startAt ? new Date(params.startAt).getTime() : Date.now();
      if (!Number.isFinite(startAt)) return { ok: false, error: "invalid_startAt" };
      const schedule = {
        orgId: scope.orgId,
        members,
        shiftHours,
        startAt,
        updatedAt: nowIso(),
        updatedBy: scope.userId,
      };
      ccState().onCall.set(scope.orgId, schedule);
      emitOrgRealtime("command-center:oncall-updated", { orgId: scope.orgId, schedule }, scope.orgId);
      return { ok: true, result: { schedule, onCallNow: resolveOnCallAt(schedule, Date.now()) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  // onCallSchedule — read-only (any team member). Returns the stored
  // rotation, who's on call right now, and up to the next 5 upcoming shifts
  // computed from the same deterministic resolver.
  registerLensAction("command-center", "onCallSchedule", (ctx, _artifact, params = {}) => {
    try {
      const scope = ccScope(ctx, params, null);
      if (!scope.ok) return scope;
      if (!scope.orgId) return { ok: false, error: "orgId_required" };
      const schedule = ccState().onCall.get(scope.orgId) || null;
      if (!schedule) return { ok: true, result: { schedule: null, onCallNow: null, upcoming: [] } };
      const now = Date.now();
      const onCallNow = resolveOnCallAt(schedule, now);
      const shiftMs = schedule.shiftHours * 3600000;
      const upcoming = [];
      if (onCallNow) {
        const count = Math.min(5, schedule.members.length);
        for (let i = 0; i < count; i++) {
          const shiftIndex = onCallNow.shiftIndex + i;
          const memberIndex = shiftIndex % schedule.members.length;
          const shiftStartMs = schedule.startAt + shiftIndex * shiftMs;
          upcoming.push({
            userId: schedule.members[memberIndex],
            shiftIndex,
            shiftStart: new Date(shiftStartMs).toISOString(),
            shiftEnd: new Date(shiftStartMs + shiftMs).toISOString(),
          });
        }
      }
      return { ok: true, result: { schedule, onCallNow, upcoming } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  // onCallWho — "who's on call right now" (or at an optional params.at
  // timestamp, for planning/verification). Read-only, any team member.
  registerLensAction("command-center", "onCallWho", (ctx, _artifact, params = {}) => {
    try {
      const scope = ccScope(ctx, params, null);
      if (!scope.ok) return scope;
      if (!scope.orgId) return { ok: false, error: "orgId_required" };
      const schedule = ccState().onCall.get(scope.orgId) || null;
      if (!schedule) return { ok: true, result: { onCall: null, message: "no on-call schedule set for this team yet" } };
      const atMs = params.at ? new Date(params.at).getTime() : Date.now();
      if (!Number.isFinite(atMs)) return { ok: false, error: "invalid_at" };
      const onCall = resolveOnCallAt(schedule, atMs);
      return { ok: true, result: { onCall, resolvedAt: new Date(atMs).toISOString() } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });
}
