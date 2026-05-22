// server/domains/admin.js
// Domain actions for system administration: audit log analysis, permission matrix, system health scoring.

export default function registerAdminActions(registerLensAction) {
  /**
   * auditLog
   * Analyze audit log entries for anomalies — detect unusual access patterns
   * using time-gap analysis and frequency deviation.
   * artifact.data.entries: [{ timestamp, userId, action, resource, ip, success }]
   * params.windowMinutes — time window for frequency analysis (default 60)
   * params.stdDevThreshold — standard deviation threshold for anomaly flagging (default 2)
   */
  registerLensAction("admin", "auditLog", (ctx, artifact, params) => {
    const entries = artifact.data.entries || [];
    if (entries.length === 0) {
      return { ok: true, result: { message: "No audit log entries to analyze." } };
    }

    const windowMinutes = params.windowMinutes || 60;
    const stdDevThreshold = params.stdDevThreshold || 2;

    // Sort entries by timestamp
    const sorted = [...entries]
      .map(e => ({ ...e, ts: new Date(e.timestamp).getTime() }))
      .filter(e => !isNaN(e.ts))
      .sort((a, b) => a.ts - b.ts);

    // Time-gap analysis: detect unusually short or long gaps between actions per user
    const userActions = {};
    for (const entry of sorted) {
      if (!userActions[entry.userId]) userActions[entry.userId] = [];
      userActions[entry.userId].push(entry);
    }

    const anomalies = [];

    for (const [userId, actions] of Object.entries(userActions)) {
      if (actions.length < 2) continue;

      // Compute inter-action time gaps
      const gaps = [];
      for (let i = 1; i < actions.length; i++) {
        gaps.push(actions[i].ts - actions[i - 1].ts);
      }

      const meanGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      const variance = gaps.reduce((s, g) => s + Math.pow(g - meanGap, 2), 0) / gaps.length;
      const stdDev = Math.sqrt(variance);

      // Flag rapid-fire bursts (gaps significantly below mean)
      for (let i = 0; i < gaps.length; i++) {
        if (stdDev > 0 && (meanGap - gaps[i]) / stdDev > stdDevThreshold) {
          anomalies.push({
            type: "rapid-fire",
            userId,
            timestamp: new Date(actions[i + 1].ts).toISOString(),
            gapMs: gaps[i],
            meanGapMs: Math.round(meanGap),
            zScore: Math.round(((meanGap - gaps[i]) / stdDev) * 100) / 100,
            action: actions[i + 1].action,
            resource: actions[i + 1].resource,
          });
        }
        // Flag unusually long gaps (potential account takeover after dormancy)
        if (stdDev > 0 && (gaps[i] - meanGap) / stdDev > stdDevThreshold * 1.5) {
          anomalies.push({
            type: "long-dormancy-then-active",
            userId,
            timestamp: new Date(actions[i + 1].ts).toISOString(),
            gapMs: gaps[i],
            meanGapMs: Math.round(meanGap),
            zScore: Math.round(((gaps[i] - meanGap) / stdDev) * 100) / 100,
            action: actions[i + 1].action,
            resource: actions[i + 1].resource,
          });
        }
      }
    }

    // Frequency deviation per time window
    const windowMs = windowMinutes * 60 * 1000;
    const windowCounts = {};
    for (const entry of sorted) {
      const windowKey = Math.floor(entry.ts / windowMs);
      const userWindow = `${entry.userId}:${windowKey}`;
      windowCounts[userWindow] = (windowCounts[userWindow] || 0) + 1;
    }

    // Per-user frequency statistics
    const userFreqs = {};
    for (const [key, count] of Object.entries(windowCounts)) {
      const userId = key.split(":")[0];
      if (!userFreqs[userId]) userFreqs[userId] = [];
      userFreqs[userId].push(count);
    }

    for (const [userId, freqs] of Object.entries(userFreqs)) {
      const mean = freqs.reduce((s, f) => s + f, 0) / freqs.length;
      const stdDev = Math.sqrt(freqs.reduce((s, f) => s + Math.pow(f - mean, 2), 0) / freqs.length);

      for (const freq of freqs) {
        if (stdDev > 0 && (freq - mean) / stdDev > stdDevThreshold) {
          anomalies.push({
            type: "frequency-spike",
            userId,
            actionsInWindow: freq,
            meanPerWindow: Math.round(mean * 100) / 100,
            zScore: Math.round(((freq - mean) / stdDev) * 100) / 100,
            windowMinutes,
          });
        }
      }
    }

    // Failed access pattern detection
    const failedByUser = {};
    for (const entry of sorted) {
      if (entry.success === false) {
        if (!failedByUser[entry.userId]) failedByUser[entry.userId] = [];
        failedByUser[entry.userId].push(entry);
      }
    }

    const failedAccessAlerts = [];
    for (const [userId, failures] of Object.entries(failedByUser)) {
      const totalForUser = (userActions[userId] || []).length;
      const failureRate = totalForUser > 0 ? failures.length / totalForUser : 0;
      if (failures.length >= 3 && failureRate > 0.3) {
        failedAccessAlerts.push({
          userId,
          failedAttempts: failures.length,
          totalAttempts: totalForUser,
          failureRate: Math.round(failureRate * 10000) / 100,
          resources: [...new Set(failures.map(f => f.resource))],
        });
      }
    }

    // IP diversity check per user
    const userIps = {};
    for (const entry of sorted) {
      if (entry.ip) {
        if (!userIps[entry.userId]) userIps[entry.userId] = new Set();
        userIps[entry.userId].add(entry.ip);
      }
    }

    const ipAlerts = [];
    for (const [userId, ips] of Object.entries(userIps)) {
      if (ips.size > 5) {
        ipAlerts.push({ userId, uniqueIps: ips.size, ips: [...ips] });
      }
    }

    const result = {
      analyzedAt: new Date().toISOString(),
      totalEntries: entries.length,
      uniqueUsers: Object.keys(userActions).length,
      timeSpan: sorted.length > 1
        ? { from: new Date(sorted[0].ts).toISOString(), to: new Date(sorted[sorted.length - 1].ts).toISOString() }
        : null,
      anomalies,
      failedAccessAlerts,
      ipAlerts,
      summary: {
        totalAnomalies: anomalies.length,
        rapidFireCount: anomalies.filter(a => a.type === "rapid-fire").length,
        frequencySpikeCount: anomalies.filter(a => a.type === "frequency-spike").length,
        dormancyAlertCount: anomalies.filter(a => a.type === "long-dormancy-then-active").length,
        failedAccessAlertCount: failedAccessAlerts.length,
        suspiciousIpCount: ipAlerts.length,
      },
    };

    artifact.data.auditLogAnalysis = result;
    return { ok: true, result };
  });

  /**
   * permissionMatrix
   * Build and analyze a role-permission matrix — find over-privileged roles,
   * orphan permissions, separation-of-duty violations.
   * artifact.data.roles: [{ name, permissions: [string] }]
   * artifact.data.users: [{ userId, roles: [string] }]
   * artifact.data.sodRules: [{ name, conflicting: [perm1, perm2] }] — optional separation-of-duty rules
   */
  registerLensAction("admin", "permissionMatrix", (ctx, artifact, params) => {
    const roles = artifact.data.roles || [];
    const users = artifact.data.users || [];
    const sodRules = artifact.data.sodRules || [];

    // Build permission universe
    const allPermissions = new Set();
    const rolePermMap = {};
    for (const role of roles) {
      rolePermMap[role.name] = new Set(role.permissions || []);
      for (const perm of (role.permissions || [])) allPermissions.add(perm);
    }

    // Build role-permission matrix
    const permList = [...allPermissions].sort();
    const matrix = {};
    for (const role of roles) {
      matrix[role.name] = {};
      for (const perm of permList) {
        matrix[role.name][perm] = rolePermMap[role.name].has(perm);
      }
    }

    // Over-privileged roles: roles with more than 70% of all permissions
    const totalPerms = permList.length;
    const overPrivileged = roles
      .map(role => ({
        role: role.name,
        permCount: rolePermMap[role.name].size,
        ratio: totalPerms > 0 ? rolePermMap[role.name].size / totalPerms : 0,
      }))
      .filter(r => r.ratio > 0.7)
      .sort((a, b) => b.ratio - a.ratio)
      .map(r => ({ ...r, ratio: Math.round(r.ratio * 10000) / 100 }));

    // Orphan permissions: permissions not assigned to any role
    const assignedPerms = new Set();
    for (const role of roles) {
      for (const perm of (role.permissions || [])) assignedPerms.add(perm);
    }

    // Check if there are referenced permissions in users that don't exist
    const roleNames = new Set(roles.map(r => r.name));
    const unknownRoles = [];
    for (const user of users) {
      for (const role of (user.roles || [])) {
        if (!roleNames.has(role)) {
          unknownRoles.push({ userId: user.userId, role });
        }
      }
    }

    // Role redundancy: find roles that are subsets of other roles
    const redundantRoles = [];
    for (let i = 0; i < roles.length; i++) {
      for (let j = 0; j < roles.length; j++) {
        if (i === j) continue;
        const permsI = rolePermMap[roles[i].name];
        const permsJ = rolePermMap[roles[j].name];
        if (permsI.size > 0 && permsI.size < permsJ.size) {
          let isSubset = true;
          for (const perm of permsI) {
            if (!permsJ.has(perm)) { isSubset = false; break; }
          }
          if (isSubset) {
            redundantRoles.push({
              subset: roles[i].name,
              superset: roles[j].name,
              subsetSize: permsI.size,
              supersetSize: permsJ.size,
            });
          }
        }
      }
    }

    // Separation of duty violations per user
    const sodViolations = [];
    for (const user of users) {
      const userPerms = new Set();
      for (const roleName of (user.roles || [])) {
        if (rolePermMap[roleName]) {
          for (const perm of rolePermMap[roleName]) userPerms.add(perm);
        }
      }

      for (const rule of sodRules) {
        const conflicting = rule.conflicting || [];
        const held = conflicting.filter(p => userPerms.has(p));
        if (held.length >= 2) {
          sodViolations.push({
            userId: user.userId,
            rule: rule.name,
            conflictingPermissions: held,
            roles: user.roles,
          });
        }
      }
    }

    // Users with no roles
    const usersNoRoles = users.filter(u => !u.roles || u.roles.length === 0)
      .map(u => u.userId);

    const result = {
      analyzedAt: new Date().toISOString(),
      totalRoles: roles.length,
      totalPermissions: totalPerms,
      totalUsers: users.length,
      matrix,
      overPrivilegedRoles: overPrivileged,
      redundantRoles,
      unknownRoles,
      usersWithNoRoles: usersNoRoles,
      sodViolations,
      summary: {
        overPrivilegedCount: overPrivileged.length,
        redundantPairCount: redundantRoles.length,
        unknownRoleRefs: unknownRoles.length,
        sodViolationCount: sodViolations.length,
        usersWithNoRoles: usersNoRoles.length,
      },
    };

    artifact.data.permissionMatrix = result;
    return { ok: true, result };
  });

  /**
   * systemHealth
   * Compute system health score from metrics — CPU/memory/disk/latency/error-rate
   * weighted scoring with trend analysis.
   * artifact.data.metrics: [{ timestamp, cpu, memory, disk, latencyMs, errorRate }]
   * params.weights — optional { cpu, memory, disk, latency, errorRate } weight overrides
   * params.thresholds — optional { cpu, memory, disk, latency, errorRate } critical thresholds
   */
  registerLensAction("admin", "systemHealth", (ctx, artifact, params) => {
    const metrics = artifact.data.metrics || [];
    if (metrics.length === 0) {
      return { ok: true, result: { message: "No metrics data provided." } };
    }

    const weights = {
      cpu: 0.25,
      memory: 0.2,
      disk: 0.15,
      latency: 0.25,
      errorRate: 0.15,
      ...(params.weights || {}),
    };

    const thresholds = {
      cpu: 90,         // percentage
      memory: 90,      // percentage
      disk: 90,        // percentage
      latency: 1000,   // ms
      errorRate: 5,    // percentage
      ...(params.thresholds || {}),
    };

    const sorted = [...metrics]
      .map(m => ({ ...m, ts: new Date(m.timestamp).getTime() }))
      .filter(m => !isNaN(m.ts))
      .sort((a, b) => a.ts - b.ts);

    // Compute current values (average of last 10% or at least last entry)
    const recentCount = Math.max(1, Math.floor(sorted.length * 0.1));
    const recent = sorted.slice(-recentCount);

    const avg = (arr, key) => {
      const vals = arr.map(m => parseFloat(m[key])).filter(v => !isNaN(v));
      return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    };

    const current = {
      cpu: avg(recent, "cpu"),
      memory: avg(recent, "memory"),
      disk: avg(recent, "disk"),
      latency: avg(recent, "latencyMs"),
      errorRate: avg(recent, "errorRate"),
    };

    // Score each metric: 100 = perfect, 0 = at or beyond threshold
    const score = (value, threshold) => {
      if (value === null) return null;
      const ratio = value / threshold;
      if (ratio >= 1) return 0;
      // Exponential decay scoring — penalizes more as approaching threshold
      return Math.round(Math.max(0, (1 - Math.pow(ratio, 2)) * 100) * 100) / 100;
    };

    const scores = {
      cpu: score(current.cpu, thresholds.cpu),
      memory: score(current.memory, thresholds.memory),
      disk: score(current.disk, thresholds.disk),
      latency: score(current.latency, thresholds.latency),
      errorRate: score(current.errorRate, thresholds.errorRate),
    };

    // Weighted composite score
    let totalWeight = 0;
    let weightedSum = 0;
    for (const [key, s] of Object.entries(scores)) {
      if (s !== null) {
        weightedSum += s * (weights[key] || 0);
        totalWeight += weights[key] || 0;
      }
    }
    const compositeScore = totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 100) / 100
      : null;

    // Trend analysis using linear regression on each metric
    const computeTrend = (key) => {
      const points = sorted
        .map((m, i) => ({ x: i, y: parseFloat(m[key]) }))
        .filter(p => !isNaN(p.y));
      if (points.length < 2) return null;

      const n = points.length;
      const sumX = points.reduce((s, p) => s + p.x, 0);
      const sumY = points.reduce((s, p) => s + p.y, 0);
      const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
      const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
      const denom = n * sumX2 - sumX * sumX;
      if (Math.abs(denom) < 1e-12) return null;

      const slope = (n * sumXY - sumX * sumY) / denom;
      const direction = Math.abs(slope) < 0.01 ? "stable" : slope > 0 ? "increasing" : "decreasing";

      return {
        slope: Math.round(slope * 10000) / 10000,
        direction,
        concern: (key !== "latency" && key !== "errorRate")
          ? (direction === "increasing" ? "degrading" : "improving")
          : (direction === "increasing" ? "degrading" : "improving"),
      };
    };

    const trends = {
      cpu: computeTrend("cpu"),
      memory: computeTrend("memory"),
      disk: computeTrend("disk"),
      latency: computeTrend("latencyMs"),
      errorRate: computeTrend("errorRate"),
    };

    // Alerts for critical thresholds
    const alerts = [];
    if (current.cpu !== null && current.cpu >= thresholds.cpu) {
      alerts.push({ metric: "cpu", value: current.cpu, threshold: thresholds.cpu, severity: "critical" });
    }
    if (current.memory !== null && current.memory >= thresholds.memory) {
      alerts.push({ metric: "memory", value: current.memory, threshold: thresholds.memory, severity: "critical" });
    }
    if (current.disk !== null && current.disk >= thresholds.disk) {
      alerts.push({ metric: "disk", value: current.disk, threshold: thresholds.disk, severity: "critical" });
    }
    if (current.latency !== null && current.latency >= thresholds.latency) {
      alerts.push({ metric: "latency", value: current.latency, threshold: thresholds.latency, severity: "critical" });
    }
    if (current.errorRate !== null && current.errorRate >= thresholds.errorRate) {
      alerts.push({ metric: "errorRate", value: current.errorRate, threshold: thresholds.errorRate, severity: "critical" });
    }

    // Warning at 80% of threshold
    for (const [key, threshold] of Object.entries(thresholds)) {
      const val = key === "latency" ? current.latency : current[key];
      if (val !== null && val >= threshold * 0.8 && val < threshold) {
        alerts.push({ metric: key, value: val, threshold, severity: "warning" });
      }
    }

    const healthStatus = compositeScore >= 80 ? "healthy"
      : compositeScore >= 60 ? "degraded"
      : compositeScore >= 30 ? "unhealthy"
      : "critical";

    const result = {
      analyzedAt: new Date().toISOString(),
      dataPoints: sorted.length,
      compositeScore,
      healthStatus,
      currentValues: {
        cpu: current.cpu !== null ? Math.round(current.cpu * 100) / 100 : null,
        memory: current.memory !== null ? Math.round(current.memory * 100) / 100 : null,
        disk: current.disk !== null ? Math.round(current.disk * 100) / 100 : null,
        latencyMs: current.latency !== null ? Math.round(current.latency * 100) / 100 : null,
        errorRate: current.errorRate !== null ? Math.round(current.errorRate * 100) / 100 : null,
      },
      componentScores: scores,
      weights,
      trends,
      alerts,
    };

    artifact.data.systemHealth = result;
    return { ok: true, result };
  });

  // ===========================================================================
  // Ops-console backlog — Datadog / Grafana parity.
  // Persistent per-deployment ops state lives in globalThis._concordSTATE.adminLens.
  //  - Time-series ring buffers (history charts)
  //  - User-defined alert rules + thresholds
  //  - Per-user/per-tenant admin actions (suspend, role-change, quota)
  //  - Log search/tail buffer
  //  - Distributed-trace / request-waterfall store
  //  - Feature flags
  //  - Incident timeline + on-call acknowledgement
  // ===========================================================================

  /** Lazily provision the per-domain ops state container. */
  function adminState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.adminLens) {
      STATE.adminLens = {
        // metric -> [{ t, v }] ring buffer (one shared deployment-wide series)
        series: new Map(),
        alertRules: new Map(), // ruleId -> rule
        tenants: new Map(), // userId -> { suspended, role, quotaMb, notes, updatedAt }
        logBuffer: [], // [{ id, t, level, source, message }]
        traces: new Map(), // traceId -> { traceId, endpoint, t, totalMs, spans:[] }
        featureFlags: new Map(), // flagId -> flag
        incidents: new Map(), // incidentId -> incident
      };
    }
    return STATE.adminLens;
  }

  function rid(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function clampNum(v, lo, hi, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  const MAX_SERIES_POINTS = 2880; // ~48h at 1-min cadence
  const MAX_LOG_BUFFER = 5000;
  const MAX_TRACES = 1000;

  // ---------------------------------------------------------------------------
  // Feature 1 — Historical time-series charts with selectable ranges.
  // recordMetric ingests a point; metricHistory reads back a windowed,
  // optionally down-sampled series for any selected range.
  // ---------------------------------------------------------------------------

  /**
   * recordMetric — append one observation to a named time-series ring buffer.
   * params.metric (string), params.value (number), params.timestamp? (ISO/ms)
   */
  registerLensAction("admin", "recordMetric", (ctx, artifact, params) => {
    try {
      const metric = String((params && params.metric) || "").trim();
      if (!metric) return { ok: false, error: "metric is required" };
      const value = Number(params && params.value);
      if (!Number.isFinite(value)) return { ok: false, error: "value must be a number" };
      const t = params && params.timestamp ? new Date(params.timestamp).getTime() : Date.now();
      if (!Number.isFinite(t)) return { ok: false, error: "invalid timestamp" };

      const st = adminState();
      if (!st.series.has(metric)) st.series.set(metric, []);
      const buf = st.series.get(metric);
      buf.push({ t, v: value });
      buf.sort((a, b) => a.t - b.t);
      if (buf.length > MAX_SERIES_POINTS) buf.splice(0, buf.length - MAX_SERIES_POINTS);

      return { ok: true, result: { metric, points: buf.length, recordedAt: new Date(t).toISOString() } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  /**
   * metricHistory — read a windowed time-series for charting.
   * params.metric (string), params.rangeMinutes? (default 1440 = 24h),
   * params.buckets? (down-sample target point count, default 120)
   */
  registerLensAction("admin", "metricHistory", (ctx, artifact, params) => {
    try {
      const metric = String((params && params.metric) || "").trim();
      const st = adminState();
      const rangeMinutes = clampNum(params && params.rangeMinutes, 5, 2880, 1440);
      const buckets = clampNum(params && params.buckets, 10, 600, 120);

      if (metric) {
        const buf = st.series.get(metric) || [];
        const cutoff = Date.now() - rangeMinutes * 60 * 1000;
        const windowed = buf.filter((p) => p.t >= cutoff);
        const series = downsample(windowed, buckets);
        const values = series.map((p) => p.v);
        return {
          ok: true,
          result: {
            metric,
            rangeMinutes,
            points: series.length,
            rawPoints: windowed.length,
            series,
            stats: summarise(values),
          },
        };
      }

      // No metric => list available metrics with cardinality.
      const metrics = [...st.series.entries()].map(([name, buf]) => ({
        metric: name,
        points: buf.length,
        latest: buf.length ? buf[buf.length - 1].v : null,
        latestAt: buf.length ? new Date(buf[buf.length - 1].t).toISOString() : null,
      }));
      return { ok: true, result: { metrics, total: metrics.length } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  function downsample(points, target) {
    if (points.length <= target) {
      return points.map((p) => ({ t: new Date(p.t).toISOString(), v: Math.round(p.v * 1000) / 1000 }));
    }
    const out = [];
    const size = points.length / target;
    for (let i = 0; i < target; i++) {
      const slice = points.slice(Math.floor(i * size), Math.floor((i + 1) * size));
      if (!slice.length) continue;
      const avg = slice.reduce((s, p) => s + p.v, 0) / slice.length;
      out.push({ t: new Date(slice[slice.length - 1].t).toISOString(), v: Math.round(avg * 1000) / 1000 });
    }
    return out;
  }

  function summarise(values) {
    if (!values.length) return { count: 0, min: null, max: null, avg: null, p95: null };
    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return {
      count: sorted.length,
      min: Math.round(sorted[0] * 1000) / 1000,
      max: Math.round(sorted[sorted.length - 1] * 1000) / 1000,
      avg: Math.round((sum / sorted.length) * 1000) / 1000,
      p95: Math.round(sorted[p95Idx] * 1000) / 1000,
    };
  }

  // ---------------------------------------------------------------------------
  // Feature 2 — Alert rules + thresholds editable from the UI.
  // alertRuleUpsert / alertRuleDelete manage rules; alertEvaluate runs every
  // rule against the live metric series and returns firing/ok states.
  // ---------------------------------------------------------------------------

  const ALERT_COMPARATORS = [">", ">=", "<", "<=", "=="];
  const ALERT_SEVERITIES = ["info", "warning", "critical"];

  /**
   * alertRuleUpsert — create or update an alert rule.
   * params.rule: { id?, name, metric, comparator, threshold, severity?, windowMinutes?,
   *   aggregation? ('avg'|'max'|'min'|'last'), enabled? }
   */
  registerLensAction("admin", "alertRuleUpsert", (ctx, artifact, params) => {
    try {
      const input = (params && params.rule) || {};
      const name = String(input.name || "").trim();
      const metric = String(input.metric || "").trim();
      if (!name) return { ok: false, error: "rule.name is required" };
      if (!metric) return { ok: false, error: "rule.metric is required" };
      const comparator = ALERT_COMPARATORS.includes(input.comparator) ? input.comparator : ">";
      const threshold = Number(input.threshold);
      if (!Number.isFinite(threshold)) return { ok: false, error: "rule.threshold must be a number" };
      const severity = ALERT_SEVERITIES.includes(input.severity) ? input.severity : "warning";
      const aggregation = ["avg", "max", "min", "last"].includes(input.aggregation)
        ? input.aggregation
        : "avg";

      const st = adminState();
      const existing = input.id ? st.alertRules.get(input.id) : null;
      const id = existing ? existing.id : rid("alert");
      const rule = {
        id,
        name,
        metric,
        comparator,
        threshold,
        severity,
        aggregation,
        windowMinutes: clampNum(input.windowMinutes, 1, 1440, 15),
        enabled: input.enabled !== false,
        createdAt: existing ? existing.createdAt : nowIso(),
        updatedAt: nowIso(),
      };
      st.alertRules.set(id, rule);
      return { ok: true, result: { rule, totalRules: st.alertRules.size } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  /** alertRuleDelete — remove an alert rule. params.ruleId */
  registerLensAction("admin", "alertRuleDelete", (ctx, artifact, params) => {
    try {
      const ruleId = String((params && params.ruleId) || "");
      const st = adminState();
      if (!st.alertRules.has(ruleId)) return { ok: false, error: "rule not found" };
      st.alertRules.delete(ruleId);
      return { ok: true, result: { deleted: ruleId, totalRules: st.alertRules.size } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  /**
   * alertEvaluate — list every rule with its live firing state.
   * Evaluates each enabled rule against its metric's recent window.
   */
  registerLensAction("admin", "alertEvaluate", (ctx, artifact) => {
    try {
      const st = adminState();
      const rules = [...st.alertRules.values()];
      const evaluated = rules.map((rule) => {
        const buf = st.series.get(rule.metric) || [];
        const cutoff = Date.now() - rule.windowMinutes * 60 * 1000;
        const windowed = buf.filter((p) => p.t >= cutoff).map((p) => p.v);
        let observed = null;
        if (windowed.length) {
          if (rule.aggregation === "max") observed = Math.max(...windowed);
          else if (rule.aggregation === "min") observed = Math.min(...windowed);
          else if (rule.aggregation === "last") observed = windowed[windowed.length - 1];
          else observed = windowed.reduce((s, v) => s + v, 0) / windowed.length;
          observed = Math.round(observed * 1000) / 1000;
        }
        let firing = false;
        if (rule.enabled && observed !== null) {
          if (rule.comparator === ">") firing = observed > rule.threshold;
          else if (rule.comparator === ">=") firing = observed >= rule.threshold;
          else if (rule.comparator === "<") firing = observed < rule.threshold;
          else if (rule.comparator === "<=") firing = observed <= rule.threshold;
          else if (rule.comparator === "==") firing = observed === rule.threshold;
        }
        return {
          ...rule,
          observed,
          dataPoints: windowed.length,
          state: !rule.enabled ? "disabled" : observed === null ? "no-data" : firing ? "firing" : "ok",
        };
      });
      const firingCount = evaluated.filter((r) => r.state === "firing").length;
      return {
        ok: true,
        result: {
          evaluatedAt: nowIso(),
          rules: evaluated,
          summary: {
            total: evaluated.length,
            firing: firingCount,
            ok: evaluated.filter((r) => r.state === "ok").length,
            noData: evaluated.filter((r) => r.state === "no-data").length,
            disabled: evaluated.filter((r) => r.state === "disabled").length,
            criticalFiring: evaluated.filter((r) => r.state === "firing" && r.severity === "critical").length,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  // ---------------------------------------------------------------------------
  // Feature 3 — Per-user / per-tenant admin actions: suspend, role-change,
  // quota edit. tenantAction mutates; tenantList reads back the roster.
  // ---------------------------------------------------------------------------

  const TENANT_ROLES = ["member", "moderator", "admin", "owner"];

  function tenantRecord(st, userId) {
    if (!st.tenants.has(userId)) {
      st.tenants.set(userId, {
        userId,
        suspended: false,
        role: "member",
        quotaMb: 1024,
        notes: "",
        updatedAt: nowIso(),
        history: [],
      });
    }
    return st.tenants.get(userId);
  }

  /**
   * tenantAction — apply an admin action to a tenant.
   * params.userId, params.action ('suspend'|'unsuspend'|'role'|'quota'|'note'),
   * params.role? params.quotaMb? params.note?
   */
  registerLensAction("admin", "tenantAction", (ctx, artifact, params) => {
    try {
      const userId = String((params && params.userId) || "").trim();
      if (!userId) return { ok: false, error: "userId is required" };
      const action = String((params && params.action) || "").trim();
      const st = adminState();
      const rec = tenantRecord(st, userId);
      const actorId = (ctx && (ctx.userId || (ctx.actor && ctx.actor.userId))) || "system";
      let change;

      if (action === "suspend") {
        rec.suspended = true;
        change = "suspended account";
      } else if (action === "unsuspend") {
        rec.suspended = false;
        change = "reinstated account";
      } else if (action === "role") {
        const role = String((params && params.role) || "");
        if (!TENANT_ROLES.includes(role)) {
          return { ok: false, error: `role must be one of ${TENANT_ROLES.join(", ")}` };
        }
        const prev = rec.role;
        rec.role = role;
        change = `role ${prev} -> ${role}`;
      } else if (action === "quota") {
        rec.quotaMb = clampNum(params && params.quotaMb, 0, 1048576, rec.quotaMb);
        change = `quota set to ${rec.quotaMb} MB`;
      } else if (action === "note") {
        rec.notes = String((params && params.note) || "").slice(0, 500);
        change = "note updated";
      } else {
        return { ok: false, error: "action must be suspend|unsuspend|role|quota|note" };
      }

      rec.updatedAt = nowIso();
      rec.history.unshift({ at: nowIso(), actorId, change });
      if (rec.history.length > 50) rec.history.length = 50;
      return { ok: true, result: { tenant: { ...rec, history: rec.history.slice(0, 10) }, change } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  /** tenantList — list all managed tenants. params.filter? ('suspended'|'all') */
  registerLensAction("admin", "tenantList", (ctx, artifact, params) => {
    try {
      const st = adminState();
      const filter = String((params && params.filter) || "all");
      let tenants = [...st.tenants.values()];
      if (filter === "suspended") tenants = tenants.filter((t) => t.suspended);
      tenants = tenants
        .map((t) => ({ ...t, history: t.history.slice(0, 5) }))
        .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
      return {
        ok: true,
        result: {
          tenants,
          summary: {
            total: st.tenants.size,
            suspended: [...st.tenants.values()].filter((t) => t.suspended).length,
            admins: [...st.tenants.values()].filter((t) => t.role === "admin" || t.role === "owner")
              .length,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  // ---------------------------------------------------------------------------
  // Feature 4 — Log search / tail panel with severity filter.
  // logAppend ingests a log line; logSearch queries the ring buffer.
  // ---------------------------------------------------------------------------

  const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"];
  const LOG_RANK = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };

  /**
   * logAppend — append a structured log line to the tail buffer.
   * params.level, params.message, params.source?, params.timestamp?
   */
  registerLensAction("admin", "logAppend", (ctx, artifact, params) => {
    try {
      const level = LOG_LEVELS.includes(params && params.level) ? params.level : "info";
      const message = String((params && params.message) || "").trim();
      if (!message) return { ok: false, error: "message is required" };
      const t = params && params.timestamp ? new Date(params.timestamp).getTime() : Date.now();
      const st = adminState();
      const entry = {
        id: rid("log"),
        t: Number.isFinite(t) ? t : Date.now(),
        level,
        source: String((params && params.source) || "app").slice(0, 64),
        message: message.slice(0, 2000),
      };
      st.logBuffer.push(entry);
      st.logBuffer.sort((a, b) => a.t - b.t);
      if (st.logBuffer.length > MAX_LOG_BUFFER) {
        st.logBuffer.splice(0, st.logBuffer.length - MAX_LOG_BUFFER);
      }
      return { ok: true, result: { id: entry.id, bufferSize: st.logBuffer.length } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  /**
   * logSearch — query the log buffer.
   * params.minLevel? ('debug'..'fatal'), params.query? (substring),
   * params.source?, params.limit? (default 100)
   */
  registerLensAction("admin", "logSearch", (ctx, artifact, params) => {
    try {
      const st = adminState();
      const minLevel = LOG_LEVELS.includes(params && params.minLevel) ? params.minLevel : "debug";
      const minRank = LOG_RANK[minLevel];
      const query = String((params && params.query) || "").toLowerCase();
      const source = String((params && params.source) || "").toLowerCase();
      const limit = clampNum(params && params.limit, 1, 1000, 100);

      let rows = st.logBuffer.filter((r) => LOG_RANK[r.level] >= minRank);
      if (query) rows = rows.filter((r) => r.message.toLowerCase().includes(query));
      if (source) rows = rows.filter((r) => r.source.toLowerCase().includes(source));
      const total = rows.length;
      rows = rows.slice(-limit).reverse();

      const byLevel = {};
      for (const lvl of LOG_LEVELS) {
        byLevel[lvl] = st.logBuffer.filter((r) => r.level === lvl).length;
      }
      return {
        ok: true,
        result: {
          entries: rows.map((r) => ({ ...r, timestamp: new Date(r.t).toISOString() })),
          matched: total,
          returned: rows.length,
          bufferSize: st.logBuffer.length,
          byLevel,
          sources: [...new Set(st.logBuffer.map((r) => r.source))].sort(),
        },
      };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  // ---------------------------------------------------------------------------
  // Feature 5 — Distributed-trace / request-waterfall view for slow endpoints.
  // traceRecord ingests a request trace with spans; traceList reads back
  // the slowest traces and renders a waterfall-ready span layout.
  // ---------------------------------------------------------------------------

  /**
   * traceRecord — record a distributed request trace.
   * params.trace: { id?, endpoint, totalMs?, timestamp?, spans:[{name, startMs, durationMs, service?}] }
   */
  registerLensAction("admin", "traceRecord", (ctx, artifact, params) => {
    try {
      const input = (params && params.trace) || {};
      const endpoint = String(input.endpoint || "").trim();
      if (!endpoint) return { ok: false, error: "trace.endpoint is required" };
      const spansIn = Array.isArray(input.spans) ? input.spans : [];
      const spans = spansIn
        .map((s, i) => {
          const startMs = clampNum(s.startMs, 0, 600000, 0);
          const durationMs = clampNum(s.durationMs, 0, 600000, 0);
          return {
            id: rid("span"),
            order: i,
            name: String(s.name || `span_${i}`).slice(0, 120),
            service: String(s.service || "app").slice(0, 64),
            startMs,
            durationMs,
            endMs: startMs + durationMs,
          };
        })
        .sort((a, b) => a.startMs - b.startMs);

      const spanSpan = spans.length
        ? Math.max(...spans.map((s) => s.endMs))
        : 0;
      const totalMs = Number.isFinite(Number(input.totalMs))
        ? Number(input.totalMs)
        : spanSpan;
      const t = input.timestamp ? new Date(input.timestamp).getTime() : Date.now();
      const traceId = input.id || rid("trace");

      // Slowest span = critical-path bottleneck.
      const slowest = spans.reduce((m, s) => (!m || s.durationMs > m.durationMs ? s : m), null);

      const trace = {
        traceId,
        endpoint,
        timestamp: new Date(Number.isFinite(t) ? t : Date.now()).toISOString(),
        t: Number.isFinite(t) ? t : Date.now(),
        totalMs: Math.round(totalMs * 100) / 100,
        spanCount: spans.length,
        spans,
        bottleneck: slowest
          ? { name: slowest.name, service: slowest.service, durationMs: slowest.durationMs }
          : null,
      };
      const st = adminState();
      st.traces.set(traceId, trace);
      if (st.traces.size > MAX_TRACES) {
        const oldest = [...st.traces.values()].sort((a, b) => a.t - b.t)[0];
        if (oldest) st.traces.delete(oldest.traceId);
      }
      return { ok: true, result: { traceId, totalMs: trace.totalMs, spanCount: spans.length } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  /**
   * traceList — list traces, slowest-first, for the waterfall view.
   * params.minMs? (only traces slower than this), params.endpoint?, params.limit?
   */
  registerLensAction("admin", "traceList", (ctx, artifact, params) => {
    try {
      const st = adminState();
      const minMs = clampNum(params && params.minMs, 0, 600000, 0);
      const endpoint = String((params && params.endpoint) || "").toLowerCase();
      const limit = clampNum(params && params.limit, 1, 200, 50);

      let traces = [...st.traces.values()].filter((tr) => tr.totalMs >= minMs);
      if (endpoint) traces = traces.filter((tr) => tr.endpoint.toLowerCase().includes(endpoint));
      traces.sort((a, b) => b.totalMs - a.totalMs);
      const top = traces.slice(0, limit);

      const all = [...st.traces.values()];
      const durations = all.map((tr) => tr.totalMs).sort((a, b) => a - b);
      const p95 = durations.length
        ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]
        : null;
      return {
        ok: true,
        result: {
          traces: top,
          matched: traces.length,
          stats: {
            total: all.length,
            slowest: durations.length ? durations[durations.length - 1] : null,
            fastest: durations.length ? durations[0] : null,
            p95,
            avg: durations.length
              ? Math.round((durations.reduce((s, v) => s + v, 0) / durations.length) * 100) / 100
              : null,
          },
          endpoints: [...new Set(all.map((tr) => tr.endpoint))].sort(),
        },
      };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  // ---------------------------------------------------------------------------
  // Feature 6 — Feature-flag toggles surfaced in the UI.
  // featureFlagSet upserts/toggles a flag; featureFlagList reads them all.
  // ---------------------------------------------------------------------------

  /**
   * featureFlagSet — create, update, or toggle a feature flag.
   * params.flag: { id?, key, enabled?, description?, rolloutPct? } OR
   * params.toggle (flagId) to flip an existing flag.
   */
  registerLensAction("admin", "featureFlagSet", (ctx, artifact, params) => {
    try {
      const st = adminState();
      if (params && params.toggle) {
        const flag = st.featureFlags.get(String(params.toggle));
        if (!flag) return { ok: false, error: "flag not found" };
        flag.enabled = !flag.enabled;
        flag.updatedAt = nowIso();
        return { ok: true, result: { flag } };
      }
      const input = (params && params.flag) || {};
      const key = String(input.key || "").trim();
      if (!key) return { ok: false, error: "flag.key is required" };
      const existing = input.id ? st.featureFlags.get(input.id) : null;
      const id = existing ? existing.id : rid("flag");
      const flag = {
        id,
        key,
        enabled: input.enabled !== undefined ? !!input.enabled : existing ? existing.enabled : false,
        description: String(input.description || (existing && existing.description) || "").slice(0, 280),
        rolloutPct: clampNum(
          input.rolloutPct !== undefined ? input.rolloutPct : existing && existing.rolloutPct,
          0,
          100,
          100,
        ),
        createdAt: existing ? existing.createdAt : nowIso(),
        updatedAt: nowIso(),
      };
      st.featureFlags.set(id, flag);
      return { ok: true, result: { flag, totalFlags: st.featureFlags.size } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  /** featureFlagList — list all feature flags. */
  registerLensAction("admin", "featureFlagList", (ctx, artifact) => {
    try {
      const st = adminState();
      const flags = [...st.featureFlags.values()].sort((a, b) => a.key.localeCompare(b.key));
      return {
        ok: true,
        result: {
          flags,
          summary: {
            total: flags.length,
            enabled: flags.filter((f) => f.enabled).length,
            partialRollout: flags.filter((f) => f.enabled && f.rolloutPct < 100).length,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  // ---------------------------------------------------------------------------
  // Feature 7 — Incident timeline + on-call acknowledgement workflow.
  // incidentOpen creates; incidentUpdate adds timeline events / acks /
  // resolves; incidentList reads back the incident roster + timelines.
  // ---------------------------------------------------------------------------

  const INCIDENT_SEVERITIES = ["sev1", "sev2", "sev3", "sev4"];

  /**
   * incidentOpen — declare a new incident.
   * params.title, params.severity? ('sev1'..'sev4'), params.description?, params.service?
   */
  registerLensAction("admin", "incidentOpen", (ctx, artifact, params) => {
    try {
      const title = String((params && params.title) || "").trim();
      if (!title) return { ok: false, error: "title is required" };
      const severity = INCIDENT_SEVERITIES.includes(params && params.severity)
        ? params.severity
        : "sev3";
      const st = adminState();
      const id = rid("inc");
      const actorId = (ctx && (ctx.userId || (ctx.actor && ctx.actor.userId))) || "system";
      const incident = {
        id,
        title: title.slice(0, 200),
        severity,
        service: String((params && params.service) || "platform").slice(0, 80),
        description: String((params && params.description) || "").slice(0, 1000),
        status: "open", // open -> acknowledged -> resolved
        acknowledgedBy: null,
        acknowledgedAt: null,
        openedAt: nowIso(),
        resolvedAt: null,
        durationMs: null,
        timeline: [{ at: nowIso(), actorId, kind: "opened", note: `Incident declared (${severity})` }],
      };
      st.incidents.set(id, incident);
      return { ok: true, result: { incident } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  /**
   * incidentUpdate — advance an incident: acknowledge, note, or resolve.
   * params.incidentId, params.action ('acknowledge'|'note'|'resolve'), params.note?
   */
  registerLensAction("admin", "incidentUpdate", (ctx, artifact, params) => {
    try {
      const incidentId = String((params && params.incidentId) || "");
      const st = adminState();
      const incident = st.incidents.get(incidentId);
      if (!incident) return { ok: false, error: "incident not found" };
      const action = String((params && params.action) || "");
      const actorId = (ctx && (ctx.userId || (ctx.actor && ctx.actor.userId))) || "system";
      const note = String((params && params.note) || "").slice(0, 1000);

      if (action === "acknowledge") {
        if (incident.status === "resolved") return { ok: false, error: "incident already resolved" };
        incident.status = "acknowledged";
        incident.acknowledgedBy = actorId;
        incident.acknowledgedAt = nowIso();
        incident.timeline.push({
          at: nowIso(),
          actorId,
          kind: "acknowledged",
          note: note || "On-call engineer acknowledged",
        });
      } else if (action === "note") {
        if (!note) return { ok: false, error: "note text is required" };
        incident.timeline.push({ at: nowIso(), actorId, kind: "note", note });
      } else if (action === "resolve") {
        if (incident.status === "resolved") return { ok: false, error: "incident already resolved" };
        incident.status = "resolved";
        incident.resolvedAt = nowIso();
        incident.durationMs = new Date(incident.resolvedAt).getTime() - new Date(incident.openedAt).getTime();
        incident.timeline.push({
          at: nowIso(),
          actorId,
          kind: "resolved",
          note: note || "Incident resolved",
        });
      } else {
        return { ok: false, error: "action must be acknowledge|note|resolve" };
      }
      return { ok: true, result: { incident } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  /** incidentList — list incidents with timelines. params.status? ('open'|'active'|'resolved'|'all') */
  registerLensAction("admin", "incidentList", (ctx, artifact, params) => {
    try {
      const st = adminState();
      const filter = String((params && params.status) || "all");
      let incidents = [...st.incidents.values()];
      if (filter === "open") incidents = incidents.filter((i) => i.status === "open");
      else if (filter === "active") incidents = incidents.filter((i) => i.status !== "resolved");
      else if (filter === "resolved") incidents = incidents.filter((i) => i.status === "resolved");
      incidents.sort((a, b) => (b.openedAt > a.openedAt ? 1 : -1));

      const all = [...st.incidents.values()];
      const resolved = all.filter((i) => i.status === "resolved" && i.durationMs != null);
      const mttr = resolved.length
        ? Math.round(resolved.reduce((s, i) => s + i.durationMs, 0) / resolved.length)
        : null;
      return {
        ok: true,
        result: {
          incidents,
          summary: {
            total: all.length,
            open: all.filter((i) => i.status === "open").length,
            acknowledged: all.filter((i) => i.status === "acknowledged").length,
            resolved: resolved.length,
            unacknowledged: all.filter((i) => i.status === "open").length,
            mttrMs: mttr,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });
}
