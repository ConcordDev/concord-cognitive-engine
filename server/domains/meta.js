// server/domains/meta.js
// Domain actions for meta-cognitive/system introspection: system reflection,
// action analytics, and artifact quality metrics.

export default function registerMetaActions(registerLensAction) {
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
}
