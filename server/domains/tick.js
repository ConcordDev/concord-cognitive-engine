// server/domains/tick.js
// Domain actions for system tick/heartbeat: health pulse computation,
// load prediction, and rhythm/periodicity analysis.

export default function registerTickActions(registerLensAction) {
  /**
   * healthPulse
   * Compute system health from tick data: heartbeat regularity, jitter
   * analysis, and dead component detection.
   * artifact.data.ticks = [{ componentId, timestamp, healthy?: bool, metrics?: { cpu?, memory?, latency? } }]
   * params.expectedIntervalMs = expected heartbeat interval (default 5000)
   * params.deadThresholdMultiplier = multiplier for dead detection (default 3)
   */
  registerLensAction("tick", "healthPulse", (ctx, artifact, params) => {
  try {
    const ticks = artifact.data?.ticks || [];
    if (ticks.length === 0) return { ok: true, result: { message: "No tick data to analyze." } };

    const expectedInterval = params.expectedIntervalMs || 5000;
    const deadMultiplier = params.deadThresholdMultiplier || 3;
    const deadThreshold = expectedInterval * deadMultiplier;
    const now = Date.now();

    // Group ticks by component
    const componentTicks = {};
    for (const tick of ticks) {
      const id = tick.componentId || "unknown";
      if (!componentTicks[id]) componentTicks[id] = [];
      componentTicks[id].push({
        timestamp: new Date(tick.timestamp).getTime(),
        healthy: tick.healthy !== false,
        metrics: tick.metrics || {},
      });
    }

    const componentHealth = Object.entries(componentTicks).map(([componentId, tickList]) => {
      // Sort by timestamp
      const sorted = tickList.filter(t => !isNaN(t.timestamp)).sort((a, b) => a.timestamp - b.timestamp);
      if (sorted.length === 0) return { componentId, status: "no_data" };

      // Compute inter-tick intervals
      const intervals = [];
      for (let i = 1; i < sorted.length; i++) {
        intervals.push(sorted[i].timestamp - sorted[i - 1].timestamp);
      }

      // Interval statistics
      let meanInterval = expectedInterval;
      let jitter = 0;
      let jitterPercent = 0;
      if (intervals.length > 0) {
        meanInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;
        // Jitter = standard deviation of inter-arrival times
        const variance = intervals.reduce((s, v) => s + Math.pow(v - meanInterval, 2), 0) / intervals.length;
        jitter = Math.sqrt(variance);
        jitterPercent = meanInterval > 0 ? (jitter / meanInterval) * 100 : 0;
      }

      // Dead component detection
      const lastTick = sorted[sorted.length - 1].timestamp;
      const timeSinceLastTick = now - lastTick;
      const isDead = timeSinceLastTick > deadThreshold;

      // Missed heartbeats
      const missedBeats = intervals.filter(i => i > expectedInterval * 1.5).length;
      const missedBeatRate = intervals.length > 0 ? (missedBeats / intervals.length) * 100 : 0;

      // Health status from reported healthy flags
      const unhealthyTicks = sorted.filter(t => !t.healthy).length;
      const healthyRate = sorted.length > 0 ? ((sorted.length - unhealthyTicks) / sorted.length) * 100 : 0;

      // Aggregate metrics
      const metricSummary = {};
      const metricKeys = new Set();
      for (const tick of sorted) {
        for (const key of Object.keys(tick.metrics)) metricKeys.add(key);
      }
      for (const key of metricKeys) {
        const values = sorted.map(t => t.metrics[key]).filter(v => v != null && typeof v === "number");
        if (values.length > 0) {
          metricSummary[key] = {
            avg: Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100,
            min: Math.min(...values),
            max: Math.max(...values),
            latest: values[values.length - 1],
          };
        }
      }

      // Component health score (0-100)
      const regularityScore = Math.max(0, 100 - jitterPercent * 2);
      const missedBeatPenalty = Math.min(30, missedBeatRate * 3);
      const deadPenalty = isDead ? 40 : 0;
      const healthReportPenalty = Math.min(20, (100 - healthyRate) * 0.2);
      const healthScore = Math.round(Math.max(0, regularityScore - missedBeatPenalty - deadPenalty - healthReportPenalty) * 100) / 100;

      let status;
      if (isDead) status = "dead";
      else if (healthScore >= 80) status = "healthy";
      else if (healthScore >= 50) status = "degraded";
      else status = "critical";

      return {
        componentId,
        status,
        healthScore,
        heartbeat: {
          totalTicks: sorted.length,
          meanIntervalMs: Math.round(meanInterval),
          expectedIntervalMs: expectedInterval,
          jitterMs: Math.round(jitter * 100) / 100,
          jitterPercent: Math.round(jitterPercent * 100) / 100,
          missedBeats,
          missedBeatRate: Math.round(missedBeatRate * 100) / 100,
        },
        lastSeen: new Date(lastTick).toISOString(),
        timeSinceLastTickMs: timeSinceLastTick,
        isDead,
        healthyRate: Math.round(healthyRate * 100) / 100,
        metrics: metricSummary,
      };
    });

    // System-wide health
    const aliveComponents = componentHealth.filter(c => !c.isDead && c.status !== "no_data");
    const deadComponents = componentHealth.filter(c => c.isDead);
    const avgHealthScore = aliveComponents.length > 0
      ? aliveComponents.reduce((s, c) => s + c.healthScore, 0) / aliveComponents.length
      : 0;

    const systemStatus = deadComponents.length > 0 ? "degraded" :
      avgHealthScore >= 80 ? "healthy" :
      avgHealthScore >= 50 ? "degraded" : "critical";

    artifact.data.healthPulse = { timestamp: new Date().toISOString(), systemStatus, avgHealthScore: Math.round(avgHealthScore * 100) / 100 };

    return {
      ok: true, result: {
        systemStatus,
        avgHealthScore: Math.round(avgHealthScore * 100) / 100,
        components: componentHealth,
        summary: {
          totalComponents: componentHealth.length,
          healthy: componentHealth.filter(c => c.status === "healthy").length,
          degraded: componentHealth.filter(c => c.status === "degraded").length,
          critical: componentHealth.filter(c => c.status === "critical").length,
          dead: deadComponents.length,
        },
        deadComponents: deadComponents.map(c => ({ componentId: c.componentId, lastSeen: c.lastSeen, timeSinceMs: c.timeSinceLastTickMs })),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * loadPredict
   * Predict system load using exponential moving average of tick metrics
   * and capacity planning projections.
   * artifact.data.loadHistory = [{ timestamp, cpu, memory, connections?, requestRate? }]
   * params.forecastPeriods = number of future periods to predict (default 10)
   * params.alpha = EMA smoothing factor (default 0.3)
   */
  registerLensAction("tick", "loadPredict", (ctx, artifact, params) => {
  try {
    const history = artifact.data?.loadHistory || [];
    if (history.length < 3) return { ok: true, result: { message: "Need at least 3 data points for prediction." } };

    const alpha = params.alpha || 0.3;
    const forecastPeriods = params.forecastPeriods || 10;

    // Sort by timestamp
    const sorted = history
      .map(h => ({ ...h, ts: new Date(h.timestamp).getTime() }))
      .filter(h => !isNaN(h.ts))
      .sort((a, b) => a.ts - b.ts);

    // Identify metric keys
    const metricKeys = ["cpu", "memory", "connections", "requestRate"].filter(k =>
      sorted.some(h => h[k] != null && typeof h[k] === "number")
    );

    // Compute EMA for each metric
    const emaResults = {};
    for (const key of metricKeys) {
      const values = sorted.map(h => h[key] || 0);
      const ema = [values[0]];
      for (let i = 1; i < values.length; i++) {
        ema.push(alpha * values[i] + (1 - alpha) * ema[i - 1]);
      }

      // Double exponential smoothing (Holt's method) for trend
      const level = [values[0]];
      const trend = [values.length > 1 ? values[1] - values[0] : 0];
      for (let i = 1; i < values.length; i++) {
        const newLevel = alpha * values[i] + (1 - alpha) * (level[i - 1] + trend[i - 1]);
        const newTrend = alpha * (newLevel - level[i - 1]) + (1 - alpha) * trend[i - 1];
        level.push(newLevel);
        trend.push(newTrend);
      }

      // Forecast
      const lastLevel = level[level.length - 1];
      const lastTrend = trend[trend.length - 1];
      const forecast = [];
      for (let i = 1; i <= forecastPeriods; i++) {
        forecast.push(Math.round((lastLevel + lastTrend * i) * 100) / 100);
      }

      // Compute interval between data points
      const avgInterval = sorted.length > 1
        ? (sorted[sorted.length - 1].ts - sorted[0].ts) / (sorted.length - 1)
        : 60000;

      emaResults[key] = {
        currentEma: Math.round(ema[ema.length - 1] * 100) / 100,
        currentValue: values[values.length - 1],
        trend: Math.round(lastTrend * 1000) / 1000,
        trendDirection: lastTrend > 0.01 ? "increasing" : lastTrend < -0.01 ? "decreasing" : "stable",
        forecast,
        forecastInterval: `${Math.round(avgInterval / 1000)}s per period`,
      };
    }

    // Capacity planning
    const capacityThresholds = { cpu: 90, memory: 90, connections: params.maxConnections || 1000, requestRate: params.maxRequestRate || 10000 };
    const capacityProjections = {};
    for (const key of metricKeys) {
      const ema = emaResults[key];
      const threshold = capacityThresholds[key] || 100;
      if (ema.trend > 0) {
        const periodsToThreshold = (threshold - ema.currentEma) / ema.trend;
        capacityProjections[key] = {
          currentUsage: ema.currentEma,
          threshold,
          periodsUntilThreshold: Math.max(0, Math.round(periodsToThreshold)),
          willExceed: periodsToThreshold <= forecastPeriods,
          urgency: periodsToThreshold <= 3 ? "critical" : periodsToThreshold <= 10 ? "warning" : "ok",
        };
      } else {
        capacityProjections[key] = {
          currentUsage: ema.currentEma,
          threshold,
          periodsUntilThreshold: null,
          willExceed: false,
          urgency: "ok",
        };
      }
    }

    // Anomaly detection: values > 2 std dev from EMA
    const anomalies = [];
    for (const key of metricKeys) {
      const values = sorted.map(h => h[key] || 0);
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const stdDev = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length);
      const threshold = mean + 2 * stdDev;
      for (let i = 0; i < sorted.length; i++) {
        if (values[i] > threshold) {
          anomalies.push({ metric: key, timestamp: new Date(sorted[i].ts).toISOString(), value: values[i], threshold: Math.round(threshold * 100) / 100 });
        }
      }
    }

    return {
      ok: true, result: {
        predictions: emaResults,
        capacityPlanning: capacityProjections,
        anomalies: anomalies.slice(0, 20),
        parameters: { alpha, forecastPeriods },
        dataPoints: sorted.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * rhythmAnalysis
   * Analyze system rhythm: periodogram, detect dominant frequencies,
   * and identify phase drift.
   * artifact.data.timeSeries = [{ timestamp, value }]
   */
  registerLensAction("tick", "rhythmAnalysis", (ctx, artifact, params) => {
  try {
    const timeSeries = artifact.data?.timeSeries || [];
    if (timeSeries.length < 8) return { ok: true, result: { message: "Need at least 8 data points for rhythm analysis." } };

    // Sort and extract values with uniform resampling
    const sorted = timeSeries
      .map(p => ({ ts: new Date(p.timestamp).getTime(), value: p.value || 0 }))
      .filter(p => !isNaN(p.ts))
      .sort((a, b) => a.ts - b.ts);

    const values = sorted.map(p => p.value);
    const n = values.length;

    // Mean-center the signal
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const centered = values.map(v => v - mean);

    // Compute sample interval
    const totalDuration = sorted[n - 1].ts - sorted[0].ts;
    const sampleInterval = totalDuration / (n - 1);

    // Periodogram via DFT (for small n) — compute power spectrum
    // For efficiency, limit to first n/2 frequencies
    const maxFreqBins = Math.floor(n / 2);
    const periodogram = [];

    for (let k = 1; k <= maxFreqBins; k++) {
      // DFT at frequency k
      let realPart = 0, imagPart = 0;
      for (let t = 0; t < n; t++) {
        const angle = (2 * Math.PI * k * t) / n;
        realPart += centered[t] * Math.cos(angle);
        imagPart -= centered[t] * Math.sin(angle);
      }
      const power = (realPart * realPart + imagPart * imagPart) / (n * n);
      const frequency = k / (n * sampleInterval / 1000); // Hz
      const periodMs = (n * sampleInterval) / k;

      periodogram.push({
        bin: k,
        frequency: Math.round(frequency * 1e6) / 1e6,
        periodMs: Math.round(periodMs),
        periodHuman: periodMs >= 86400000 ? `${Math.round(periodMs / 86400000 * 10) / 10}d`
          : periodMs >= 3600000 ? `${Math.round(periodMs / 3600000 * 10) / 10}h`
          : periodMs >= 60000 ? `${Math.round(periodMs / 60000 * 10) / 10}m`
          : `${Math.round(periodMs / 1000 * 10) / 10}s`,
        power: Math.round(power * 1e6) / 1e6,
        phase: Math.round(Math.atan2(-imagPart, realPart) * 10000) / 10000,
      });
    }

    // Sort by power to find dominant frequencies
    const sortedByPower = [...periodogram].sort((a, b) => b.power - a.power);
    const dominantFrequencies = sortedByPower.slice(0, 5);

    // Total spectral power
    const totalPower = periodogram.reduce((s, p) => s + p.power, 0);

    // Spectral concentration: what fraction of power is in top 3 frequencies
    const topPower = sortedByPower.slice(0, 3).reduce((s, p) => s + p.power, 0);
    const spectralConcentration = totalPower > 0 ? topPower / totalPower : 0;

    // Phase drift detection: split signal into halves and compare dominant phase
    let phaseDrift = null;
    if (n >= 16) {
      const halfN = Math.floor(n / 2);
      const firstHalf = centered.slice(0, halfN);
      const secondHalf = centered.slice(halfN);

      // Find dominant frequency's phase in each half
      const domK = dominantFrequencies[0]?.bin || 1;

      function computePhase(signal, k) {
        let re = 0, im = 0;
        const len = signal.length;
        for (let t = 0; t < len; t++) {
          const angle = (2 * Math.PI * k * t) / len;
          re += signal[t] * Math.cos(angle);
          im -= signal[t] * Math.sin(angle);
        }
        return Math.atan2(-im, re);
      }

      const phase1 = computePhase(firstHalf, domK);
      const phase2 = computePhase(secondHalf, domK);
      let drift = phase2 - phase1;
      // Normalize to [-π, π]
      while (drift > Math.PI) drift -= 2 * Math.PI;
      while (drift < -Math.PI) drift += 2 * Math.PI;

      phaseDrift = {
        dominantFrequencyBin: domK,
        firstHalfPhase: Math.round(phase1 * 10000) / 10000,
        secondHalfPhase: Math.round(phase2 * 10000) / 10000,
        driftRadians: Math.round(drift * 10000) / 10000,
        driftDegrees: Math.round((drift * 180 / Math.PI) * 100) / 100,
        significant: Math.abs(drift) > Math.PI / 6, // > 30 degrees
      };
    }

    // Rhythm classification
    let rhythmType;
    if (spectralConcentration > 0.7) rhythmType = "strongly_periodic";
    else if (spectralConcentration > 0.4) rhythmType = "periodic_with_noise";
    else if (spectralConcentration > 0.2) rhythmType = "weakly_periodic";
    else rhythmType = "aperiodic";

    return {
      ok: true, result: {
        dominantFrequencies,
        periodogram: periodogram.slice(0, 30),
        spectralAnalysis: {
          totalPower: Math.round(totalPower * 1e6) / 1e6,
          spectralConcentration: Math.round(spectralConcentration * 10000) / 100,
          rhythmType,
          primaryPeriod: dominantFrequencies[0]?.periodHuman || "N/A",
          primaryPeriodMs: dominantFrequencies[0]?.periodMs || 0,
        },
        phaseDrift,
        signalStats: {
          mean: Math.round(mean * 10000) / 10000,
          sampleCount: n,
          totalDurationMs: totalDuration,
          sampleIntervalMs: Math.round(sampleInterval),
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ══════════════════════════════════════════════════════════════════════
  // Heartbeat-monitor substrate (Datadog / Better Uptime parity)
  //
  // The frontend polls the real `/api/perf/metrics` + `/api/events`
  // endpoints and feeds each observed sample to `recordSample`. Every
  // macro below computes over that real persisted history — no synthetic
  // data. State is per-user under globalThis._concordSTATE.tickLens.
  // ══════════════════════════════════════════════════════════════════════

  const TK_MAX_SAMPLES = 2880;        // ~12h of 15s ticks
  const TK_MAX_ALERTS = 200;
  const TK_GOVERNOR_INTERVAL = 15000; // documented governorTick cadence

  function getTickState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.tickLens) STATE.tickLens = {};
    const s = STATE.tickLens;
    for (const k of ["samples", "heartbeats", "alerts", "controls", "config"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveTickState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const tkAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const tkNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const tkClean = (v, max = 120) => String(v == null ? "" : v).trim().slice(0, max);
  const tkList = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };

  /**
   * recordSample
   * Persist one observed tick sample from `/api/perf/metrics`. The frontend
   * calls this every poll. Stores cumulative-counter deltas so later macros
   * can compute per-window latency / skip / uptime over real data.
   * params: { ticks, tickDurationMs, skippedTotal, uptimeSec, heartbeatsOk,
   *           errorCount, heartbeats:[{id,frequency,lastRunAt,errorCount,enabled}] }
   */
  registerLensAction("tick", "recordSample", (ctx, _a, params = {}) => {
    try {
      const s = getTickState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = tkAid(ctx);
      const samples = tkList(s.samples, uid);
      const now = Date.now();
      const prev = samples[samples.length - 1] || null;

      const ticks = tkNum(params.ticks, prev ? prev.ticks : 0);
      const skipped = tkNum(params.skippedTotal, prev ? prev.skipped : 0);
      const tickDurationMs = tkNum(params.tickDurationMs, 0);
      // Per-interval deltas — these are what the dashboards graph.
      const tickDelta = prev ? Math.max(0, ticks - prev.ticks) : 0;
      const skipDelta = prev ? Math.max(0, skipped - prev.skipped) : 0;
      const wallDelta = prev ? Math.max(1, now - prev.at) : TK_GOVERNOR_INTERVAL;

      const sample = {
        at: now,
        ticks,
        skipped,
        tickDurationMs,
        uptimeSec: tkNum(params.uptimeSec, 0),
        heartbeatsOk: params.heartbeatsOk !== false,
        errorCount: tkNum(params.errorCount, 0),
        tickDelta,
        skipDelta,
        wallDelta,
        // observed tick rate over the wall interval (Hz)
        rateHz: wallDelta > 0 ? tickDelta / (wallDelta / 1000) : 0,
      };
      samples.push(sample);
      if (samples.length > TK_MAX_SAMPLES) samples.splice(0, samples.length - TK_MAX_SAMPLES);

      // Per-heartbeat detail — store latest snapshot per module id.
      if (Array.isArray(params.heartbeats)) {
        const hbMap = s.heartbeats;
        for (const hb of params.heartbeats) {
          const id = tkClean(hb.id, 80);
          if (!id) continue;
          const existing = hbMap.get(id) || { id, firstSeen: now, errorDeltas: [] };
          const errCount = tkNum(hb.errorCount, 0);
          const errDelta = Math.max(0, errCount - tkNum(existing.errorCount, 0));
          hbMap.set(id, {
            id,
            frequency: tkNum(hb.frequency, existing.frequency || 0),
            lastRunAt: tkNum(hb.lastRunAt, existing.lastRunAt || 0),
            errorCount: errCount,
            enabled: hb.enabled !== false,
            firstSeen: existing.firstSeen || now,
            lastSampledAt: now,
            errorDeltas: [...(existing.errorDeltas || []), errDelta].slice(-120),
          });
          // Auto-alert: a heartbeat that just errored.
          if (errDelta > 0) {
            const alerts = tkList(s.alerts, uid);
            alerts.push({
              id: `alrt_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
              at: now, severity: "warning", kind: "heartbeat_error",
              subject: id,
              message: `Heartbeat "${id}" reported ${errDelta} new error${errDelta > 1 ? "s" : ""}.`,
              acknowledged: false,
            });
            if (alerts.length > TK_MAX_ALERTS) alerts.splice(0, alerts.length - TK_MAX_ALERTS);
          }
        }
      }

      // Auto-alert: tick rate flat-lined to 0 (governor frozen).
      if (prev && sample.tickDelta === 0 && wallDelta >= TK_GOVERNOR_INTERVAL * 2) {
        const alerts = tkList(s.alerts, uid);
        const lastFlat = alerts[alerts.length - 1];
        if (!lastFlat || lastFlat.kind !== "tick_stopped" || (now - lastFlat.at) > 60000) {
          alerts.push({
            id: `alrt_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            at: now, severity: "critical", kind: "tick_stopped",
            subject: "governorTick",
            message: `No ticks advanced in ${Math.round(wallDelta / 1000)}s — governor loop may be frozen.`,
            acknowledged: false,
          });
          if (alerts.length > TK_MAX_ALERTS) alerts.splice(0, alerts.length - TK_MAX_ALERTS);
        }
      }
      // Auto-alert: a tick block overran (skipped tick observed).
      if (skipDelta > 0) {
        const alerts = tkList(s.alerts, uid);
        alerts.push({
          id: `alrt_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          at: now, severity: "warning", kind: "tick_overrun",
          subject: "governorTick",
          message: `${skipDelta} tick${skipDelta > 1 ? "s" : ""} skipped — a previous tick is still running.`,
          acknowledged: false,
        });
        if (alerts.length > TK_MAX_ALERTS) alerts.splice(0, alerts.length - TK_MAX_ALERTS);
      }

      saveTickState();
      return {
        ok: true,
        result: {
          recorded: true,
          totalSamples: samples.length,
          sample,
          heartbeatsTracked: s.heartbeats.size,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * heartbeatList — Per-heartbeat detail (#1).
   * Returns every observed heartbeat module with frequency, last-run,
   * cumulative error count, error rate and a derived live/stale status.
   */
  registerLensAction("tick", "heartbeatList", (ctx, _a, _params = {}) => {
    try {
      const s = getTickState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const now = Date.now();
      const modules = [...s.heartbeats.values()].map((hb) => {
        const periodMs = (hb.frequency || 1) * TK_GOVERNOR_INTERVAL;
        const sinceRun = hb.lastRunAt ? now - hb.lastRunAt : null;
        // Stale = no run within 3 expected periods.
        const stale = sinceRun != null && sinceRun > periodMs * 3;
        const recentErrors = (hb.errorDeltas || []).reduce((a, b) => a + b, 0);
        let status;
        if (!hb.enabled) status = "paused";
        else if (stale) status = "stale";
        else if (recentErrors > 0) status = "erroring";
        else status = "healthy";
        return {
          id: hb.id,
          frequency: hb.frequency || 0,
          periodMs,
          periodHuman: periodMs >= 60000 ? `${Math.round(periodMs / 6000) / 10}m` : `${Math.round(periodMs / 1000)}s`,
          lastRunAt: hb.lastRunAt || null,
          sinceRunMs: sinceRun,
          errorCount: hb.errorCount || 0,
          recentErrors,
          enabled: hb.enabled !== false,
          status,
        };
      }).sort((a, b) => {
        const rank = { erroring: 0, stale: 1, paused: 2, healthy: 3 };
        return (rank[a.status] - rank[b.status]) || a.id.localeCompare(b.id);
      });
      return {
        ok: true,
        result: {
          modules,
          summary: {
            total: modules.length,
            healthy: modules.filter((m) => m.status === "healthy").length,
            erroring: modules.filter((m) => m.status === "erroring").length,
            stale: modules.filter((m) => m.status === "stale").length,
            paused: modules.filter((m) => m.status === "paused").length,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * skipReport — Skipped-tick / overrun visualization (#2).
   * Surfaces the concord_heartbeat_skipped_total counter as a per-window
   * series the frontend can chart, plus an overrun ratio.
   */
  registerLensAction("tick", "skipReport", (ctx, _a, params = {}) => {
    try {
      const s = getTickState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = tkAid(ctx);
      const all = s.samples.get(uid) || [];
      const windowMs = Math.max(60000, tkNum(params.windowMs, 3600000));
      const cutoff = Date.now() - windowMs;
      const win = all.filter((x) => x.at >= cutoff);
      if (win.length === 0) {
        return { ok: true, result: { message: "No samples in window.", series: [], totals: { ticks: 0, skipped: 0, overrunRatio: 0 } } };
      }
      const series = win.map((x) => ({
        at: x.at,
        ticks: x.tickDelta,
        skipped: x.skipDelta,
      }));
      const totalTicks = win.reduce((a, x) => a + x.tickDelta, 0);
      const totalSkipped = win.reduce((a, x) => a + x.skipDelta, 0);
      const denom = totalTicks + totalSkipped;
      return {
        ok: true,
        result: {
          windowMs,
          series,
          totals: {
            ticks: totalTicks,
            skipped: totalSkipped,
            overrunRatio: denom > 0 ? Math.round((totalSkipped / denom) * 10000) / 100 : 0,
          },
          peakSkipInterval: Math.max(0, ...win.map((x) => x.skipDelta)),
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * alerts — Alerting feed (#3). List / acknowledge / clear monitor alerts.
   * params.op = 'list' (default) | 'ack' (alertId) | 'clear' | 'config'
   */
  registerLensAction("tick", "alerts", (ctx, _a, params = {}) => {
    try {
      const s = getTickState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = tkAid(ctx);
      const op = tkClean(params.op || "list", 20);
      const alerts = tkList(s.alerts, uid);

      if (op === "ack") {
        const id = tkClean(params.alertId, 64);
        const a = alerts.find((x) => x.id === id);
        if (!a) return { ok: false, error: "alert not found" };
        a.acknowledged = true;
        saveTickState();
        return { ok: true, result: { acknowledged: id } };
      }
      if (op === "clear") {
        const before = alerts.length;
        s.alerts.set(uid, alerts.filter((x) => !x.acknowledged));
        saveTickState();
        return { ok: true, result: { cleared: before - (s.alerts.get(uid) || []).length } };
      }
      if (op === "config") {
        const cfg = s.config.get(uid) || { notifyOnStop: true, notifyOnError: true, notifyOnOverrun: true };
        if ("notifyOnStop" in params) cfg.notifyOnStop = params.notifyOnStop !== false;
        if ("notifyOnError" in params) cfg.notifyOnError = params.notifyOnError !== false;
        if ("notifyOnOverrun" in params) cfg.notifyOnOverrun = params.notifyOnOverrun !== false;
        s.config.set(uid, cfg);
        saveTickState();
        return { ok: true, result: { config: cfg } };
      }
      // list
      const sorted = [...alerts].sort((a, b) => b.at - a.at);
      return {
        ok: true,
        result: {
          alerts: sorted,
          unacknowledged: sorted.filter((a) => !a.acknowledged).length,
          bySeverity: {
            critical: sorted.filter((a) => a.severity === "critical").length,
            warning: sorted.filter((a) => a.severity === "warning").length,
          },
          config: s.config.get(uid) || { notifyOnStop: true, notifyOnError: true, notifyOnOverrun: true },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * stream — Time-range-filtered tick stream (#4 + #1 stream feed).
   * params.windowMs selects the range; returns real persisted samples.
   */
  registerLensAction("tick", "stream", (ctx, _a, params = {}) => {
    try {
      const s = getTickState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = tkAid(ctx);
      const all = s.samples.get(uid) || [];
      const windowMs = Math.max(60000, tkNum(params.windowMs, 900000));
      const cutoff = Date.now() - windowMs;
      const limit = Math.min(2000, Math.max(1, tkNum(params.limit, 600)));
      const win = all.filter((x) => x.at >= cutoff).slice(-limit);
      return {
        ok: true,
        result: {
          windowMs,
          samples: win.map((x) => ({
            at: x.at,
            tickDelta: x.tickDelta,
            rateHz: Math.round(x.rateHz * 1000) / 1000,
            tickDurationMs: x.tickDurationMs,
            skipDelta: x.skipDelta,
            errorCount: x.errorCount,
          })),
          windowOptions: [
            { label: "15m", ms: 900000 },
            { label: "1h", ms: 3600000 },
            { label: "6h", ms: 21600000 },
            { label: "12h", ms: 43200000 },
          ],
          count: win.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * latencyHistogram — Tick latency histogram (#5).
   * Buckets observed governorTick durations into a real histogram.
   */
  registerLensAction("tick", "latencyHistogram", (ctx, _a, params = {}) => {
    try {
      const s = getTickState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = tkAid(ctx);
      const all = s.samples.get(uid) || [];
      const windowMs = Math.max(60000, tkNum(params.windowMs, 3600000));
      const cutoff = Date.now() - windowMs;
      const durations = all
        .filter((x) => x.at >= cutoff && x.tickDurationMs > 0)
        .map((x) => x.tickDurationMs);
      if (durations.length === 0) {
        return { ok: true, result: { message: "No latency samples in window.", buckets: [], percentiles: {} } };
      }
      // Fixed buckets relative to the 15s governor budget.
      const edges = [0, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 15000, Infinity];
      const labels = ["<50ms", "50-100", "100-250", "250-500", "500ms-1s", "1-2.5s", "2.5-5s", "5-10s", "10-15s", ">15s"];
      const counts = new Array(labels.length).fill(0);
      for (const d of durations) {
        for (let i = 0; i < labels.length; i++) {
          if (d >= edges[i] && d < edges[i + 1]) { counts[i]++; break; }
        }
      }
      const buckets = labels.map((label, i) => ({
        label,
        count: counts[i],
        pct: Math.round((counts[i] / durations.length) * 1000) / 10,
        // Anything >15s exceeds the governor interval — flag it.
        overBudget: i === labels.length - 1,
      }));
      const sortedD = [...durations].sort((a, b) => a - b);
      const pct = (p) => sortedD[Math.min(sortedD.length - 1, Math.floor((p / 100) * sortedD.length))];
      return {
        ok: true,
        result: {
          windowMs,
          sampleCount: durations.length,
          buckets,
          percentiles: {
            p50: pct(50), p90: pct(90), p95: pct(95), p99: pct(99),
            min: sortedD[0], max: sortedD[sortedD.length - 1],
            mean: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
          },
          overBudgetCount: counts[labels.length - 1],
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * heartbeatControl — Pause / resume / manual-trigger controls (#6).
   * Records the operator's intent per heartbeat module. The intent is
   * surfaced back via heartbeatList (enabled flag) and exposed for the
   * server-side dispatcher to honour.
   * params: { moduleId, op: 'pause'|'resume'|'trigger' }
   */
  registerLensAction("tick", "heartbeatControl", (ctx, _a, params = {}) => {
    try {
      const s = getTickState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = tkAid(ctx);
      const moduleId = tkClean(params.moduleId, 80);
      const op = tkClean(params.op, 20);
      if (!moduleId) return { ok: false, error: "moduleId required" };
      if (!["pause", "resume", "trigger"].includes(op)) {
        return { ok: false, error: "op must be pause|resume|trigger" };
      }
      const now = Date.now();
      const controls = s.controls;
      const entry = controls.get(moduleId) || { moduleId, enabled: true, triggerRequests: 0, history: [] };
      if (op === "pause") entry.enabled = false;
      if (op === "resume") entry.enabled = true;
      if (op === "trigger") {
        entry.triggerRequests = (entry.triggerRequests || 0) + 1;
        entry.lastTriggerAt = now;
      }
      entry.history = [...(entry.history || []), { at: now, op, by: uid }].slice(-50);
      controls.set(moduleId, entry);
      // Mirror enable/disable into the observed heartbeat record so the
      // detail list reflects the new state immediately.
      const hb = s.heartbeats.get(moduleId);
      if (hb && op !== "trigger") hb.enabled = entry.enabled;
      saveTickState();
      return {
        ok: true,
        result: {
          moduleId,
          op,
          enabled: entry.enabled,
          triggerRequests: entry.triggerRequests || 0,
          lastTriggerAt: entry.lastTriggerAt || null,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * uptimeSLA — Historical uptime / SLA percentage over rolling windows (#7).
   * A window-tick is "up" if it advanced ≥1 tick within ~2 governor periods.
   */
  registerLensAction("tick", "uptimeSLA", (ctx, _a, _params = {}) => {
    try {
      const s = getTickState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = tkAid(ctx);
      const all = s.samples.get(uid) || [];
      if (all.length < 2) {
        return { ok: true, result: { message: "Need at least 2 samples for SLA.", windows: [] } };
      }
      const now = Date.now();
      const computeWindow = (label, ms) => {
        const cutoff = now - ms;
        const win = all.filter((x, i) => x.at >= cutoff && i > 0);
        if (win.length === 0) return { label, windowMs: ms, uptimePct: null, samples: 0 };
        const up = win.filter((x) => x.tickDelta > 0).length;
        // Downtime = wall time of intervals where no tick advanced.
        const downtimeMs = win.filter((x) => x.tickDelta === 0).reduce((a, x) => a + x.wallDelta, 0);
        return {
          label,
          windowMs: ms,
          samples: win.length,
          upSamples: up,
          uptimePct: Math.round((up / win.length) * 10000) / 100,
          downtimeMs,
          downtimeHuman: downtimeMs >= 60000 ? `${Math.round(downtimeMs / 6000) / 10}m` : `${Math.round(downtimeMs / 1000)}s`,
        };
      };
      const windows = [
        computeWindow("1h", 3600000),
        computeWindow("6h", 21600000),
        computeWindow("24h", 86400000),
      ];
      // SLA targets — surfaced so the UI can colour against a threshold.
      const target = 99.9;
      return {
        ok: true,
        result: {
          windows: windows.map((w) => ({
            ...w,
            meetsTarget: w.uptimePct != null ? w.uptimePct >= target : null,
          })),
          slaTarget: target,
          currentStatus: all[all.length - 1].tickDelta > 0 ? "operational" : "down",
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * heartbeatRegistry — Per-heartbeat detail source (#1 / #6 backing data).
   *
   * Surfaces the *real* registered heartbeat modules from the runtime
   * heartbeat-registry. Each module's `enabled` flag is the live
   * STATE.settings.disabledHeartbeats truth, merged with the operator's
   * own pause/resume intent stored by `heartbeatControl`. The frontend
   * feeds the returned `modules` array straight back into `recordSample`
   * as `heartbeats[]` so the detail / control views render real ids,
   * frequencies and derived governor-tick periods — never synthetic data.
   */
  registerLensAction("tick", "heartbeatRegistry", async (ctx, _a, _params = {}) => {
    try {
      let registered = [];
      try {
        const mod = await import("../emergent/heartbeat-registry.js");
        if (typeof mod.listHeartbeatModules === "function") {
          registered = mod.listHeartbeatModules() || [];
        }
      } catch (_e) {
        return { ok: false, error: "heartbeat-registry unavailable" };
      }
      const STATE = globalThis._concordSTATE;
      const disabled = new Set(
        (STATE && STATE.settings && Array.isArray(STATE.settings.disabledHeartbeats))
          ? STATE.settings.disabledHeartbeats
          : []
      );
      const s = getTickState();
      const controls = s ? s.controls : new Map();
      const now = Date.now();
      const modules = registered.map((m) => {
        const ctrl = controls.get(m.id);
        // neverDisable modules cannot be paused; otherwise operator
        // intent (heartbeatControl) overrides the global disabled set.
        let enabled = !disabled.has(m.id);
        if (ctrl && !m.neverDisable && typeof ctrl.enabled === "boolean") enabled = ctrl.enabled;
        const periodMs = (m.frequency || 1) * TK_GOVERNOR_INTERVAL;
        return {
          id: m.id,
          frequency: m.frequency || 1,
          neverDisable: !!m.neverDisable,
          periodMs,
          periodHuman: periodMs >= 60000
            ? `${Math.round(periodMs / 6000) / 10}m`
            : `${Math.round(periodMs / 1000)}s`,
          enabled,
          triggerRequests: ctrl ? (ctrl.triggerRequests || 0) : 0,
          lastTriggerAt: ctrl ? (ctrl.lastTriggerAt || null) : null,
        };
      }).sort((a, b) => a.frequency - b.frequency || a.id.localeCompare(b.id));
      return {
        ok: true,
        result: {
          modules,
          sampledAt: now,
          summary: {
            total: modules.length,
            enabled: modules.filter((m) => m.enabled).length,
            paused: modules.filter((m) => !m.enabled).length,
            neverDisable: modules.filter((m) => m.neverDisable).length,
            governorIntervalMs: TK_GOVERNOR_INTERVAL,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
