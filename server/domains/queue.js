// server/domains/queue.js
// Domain actions for queue/job management: queueing theory analytics,
// priority scheduling, and backpressure computation.

export default function registerQueueActions(registerLensAction) {
  /**
   * queueAnalytics
   * Analyze queue performance using queueing theory: arrival rate (λ),
   * service rate (μ), utilization (ρ), M/M/1 and M/M/c models, wait time predictions.
   * artifact.data.queue = { arrivals: [timestamp], completions: [{ arrived, completed }], servers?: number }
   */
  registerLensAction("queue", "queueAnalytics", (ctx, artifact, params) => {
  try {
    const queue = artifact.data?.queue || {};
    const arrivals = (queue.arrivals || []).map(t => new Date(t).getTime()).filter(t => !isNaN(t)).sort((a, b) => a - b);
    const completions = (queue.completions || []).map(c => ({
      arrived: new Date(c.arrived).getTime(),
      completed: new Date(c.completed).getTime(),
    })).filter(c => !isNaN(c.arrived) && !isNaN(c.completed));
    const servers = queue.servers || 1;

    if (arrivals.length < 2 && completions.length < 2) {
      return { ok: true, result: { message: "Insufficient data for queue analysis." } };
    }

    // Compute arrival rate λ (arrivals per second)
    let lambda = 0;
    if (arrivals.length >= 2) {
      const spanSeconds = (arrivals[arrivals.length - 1] - arrivals[0]) / 1000;
      lambda = spanSeconds > 0 ? (arrivals.length - 1) / spanSeconds : 0;
    }

    // Compute service rate μ (completions per second per server)
    let mu = 0;
    let avgServiceTime = 0;
    if (completions.length > 0) {
      const serviceTimes = completions.map(c => (c.completed - c.arrived) / 1000).filter(t => t > 0);
      if (serviceTimes.length > 0) {
        avgServiceTime = serviceTimes.reduce((s, t) => s + t, 0) / serviceTimes.length;
        mu = avgServiceTime > 0 ? 1 / avgServiceTime : 0;
      }
    }

    // Utilization ρ = λ / (c * μ)
    const rho = (servers * mu) > 0 ? lambda / (servers * mu) : 0;
    const stable = rho < 1;

    // M/M/1 model (single server)
    const mm1 = {};
    if (mu > 0 && lambda < mu) {
      mm1.avgQueueLength = (lambda * lambda) / (mu * (mu - lambda)); // Lq
      mm1.avgSystemLength = lambda / (mu - lambda); // L
      mm1.avgWaitTime = lambda / (mu * (mu - lambda)); // Wq (seconds)
      mm1.avgSystemTime = 1 / (mu - lambda); // W (seconds)
      mm1.idleProbability = 1 - (lambda / mu); // P0
      mm1.utilization = lambda / mu;
    }

    // M/M/c model (multiple servers)
    const mmc = {};
    if (servers > 1 && mu > 0) {
      const a = lambda / mu; // traffic intensity

      // Erlang C formula: probability all servers busy
      // P0 = [sum(k=0 to c-1, a^k/k!) + a^c/(c! * (1 - a/c))]^-1
      function factorial(n) {
        let f = 1;
        for (let i = 2; i <= n; i++) f *= i;
        return f;
      }

      if (a < servers) { // system must be stable
        let sum = 0;
        for (let k = 0; k < servers; k++) {
          sum += Math.pow(a, k) / factorial(k);
        }
        const lastTerm = Math.pow(a, servers) / (factorial(servers) * (1 - a / servers));
        const p0 = 1 / (sum + lastTerm);

        // Erlang C: probability of queuing
        const erlangC = (Math.pow(a, servers) / factorial(servers)) * (1 / (1 - a / servers)) * p0;

        mmc.erlangC = Math.round(erlangC * 10000) / 10000;
        mmc.avgQueueLength = erlangC * (a / servers) / (1 - a / servers); // Lq
        mmc.avgWaitTime = mmc.avgQueueLength / lambda; // Wq
        mmc.avgSystemTime = mmc.avgWaitTime + 1 / mu; // W
        mmc.avgSystemLength = lambda * mmc.avgSystemTime; // L
        mmc.utilization = a / servers;
        mmc.idleProbability = Math.round(p0 * 10000) / 10000;
      }
    }

    // Service time distribution analysis
    let serviceTimeStats = null;
    if (completions.length > 0) {
      const serviceTimes = completions.map(c => (c.completed - c.arrived) / 1000).filter(t => t > 0).sort((a, b) => a - b);
      if (serviceTimes.length > 0) {
        const n = serviceTimes.length;
        const mean = serviceTimes.reduce((s, t) => s + t, 0) / n;
        const variance = serviceTimes.reduce((s, t) => s + Math.pow(t - mean, 2), 0) / n;
        const stdDev = Math.sqrt(variance);
        const cv = mean > 0 ? stdDev / mean : 0; // coefficient of variation

        serviceTimeStats = {
          mean: Math.round(mean * 1000) / 1000,
          median: Math.round(serviceTimes[Math.floor(n / 2)] * 1000) / 1000,
          stdDev: Math.round(stdDev * 1000) / 1000,
          p95: Math.round(serviceTimes[Math.floor(n * 0.95)] * 1000) / 1000,
          p99: Math.round(serviceTimes[Math.floor(n * 0.99)] * 1000) / 1000,
          coefficientOfVariation: Math.round(cv * 10000) / 10000,
          distribution: cv < 0.5 ? "low_variance" : cv < 1.2 ? "moderate_variance" : "high_variance",
        };
      }
    }

    const r = (v) => Math.round(v * 10000) / 10000;

    return {
      ok: true, result: {
        rates: {
          arrivalRate: r(lambda),
          serviceRate: r(mu),
          avgServiceTimeSeconds: r(avgServiceTime),
          servers,
        },
        utilization: {
          rho: r(rho),
          stable,
          status: rho >= 1 ? "overloaded" : rho >= 0.8 ? "heavy" : rho >= 0.5 ? "moderate" : "light",
        },
        mm1Model: Object.keys(mm1).length > 0 ? {
          avgQueueLength: r(mm1.avgQueueLength),
          avgSystemLength: r(mm1.avgSystemLength),
          avgWaitTimeSeconds: r(mm1.avgWaitTime),
          avgSystemTimeSeconds: r(mm1.avgSystemTime),
          idleProbability: r(mm1.idleProbability),
          utilization: r(mm1.utilization),
        } : { note: "M/M/1 not applicable (system unstable or insufficient data)" },
        mmcModel: Object.keys(mmc).length > 0 ? {
          servers,
          erlangC: mmc.erlangC,
          avgQueueLength: r(mmc.avgQueueLength),
          avgWaitTimeSeconds: r(mmc.avgWaitTime),
          avgSystemTimeSeconds: r(mmc.avgSystemTime),
          avgSystemLength: r(mmc.avgSystemLength),
          utilization: r(mmc.utilization),
          idleProbability: mmc.idleProbability,
        } : { note: servers > 1 ? "M/M/c not applicable (system unstable)" : "Single server — see M/M/1" },
        serviceTimeDistribution: serviceTimeStats,
        dataPoints: { arrivals: arrivals.length, completions: completions.length },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * prioritySchedule
   * Priority scheduling: weighted fair queuing, deadline-monotonic scheduling,
   * and starvation detection.
   * artifact.data.jobs = [{ id, priority: 1-10, arrivalTime, deadline?, estimatedDuration, weight?: number, waitingSince?: timestamp }]
   * params.algorithm = "weighted_fair" | "deadline_monotonic" | "priority_preemptive" (default "weighted_fair")
   */
  registerLensAction("queue", "prioritySchedule", (ctx, artifact, params) => {
  try {
    const jobs = artifact.data?.jobs || [];
    if (jobs.length === 0) return { ok: true, result: { message: "No jobs to schedule." } };

    const algorithm = params.algorithm || "weighted_fair";
    const now = Date.now();

    // Normalize job data
    const normalized = jobs.map(job => ({
      id: job.id,
      priority: Math.max(1, Math.min(10, job.priority || 5)),
      arrival: new Date(job.arrivalTime || now).getTime(),
      deadline: job.deadline ? new Date(job.deadline).getTime() : null,
      duration: job.estimatedDuration || 1,
      weight: job.weight || job.priority || 5,
      waitingSince: job.waitingSince ? new Date(job.waitingSince).getTime() : now,
    }));

    let schedule, scheduleName;

    if (algorithm === "weighted_fair") {
      // Weighted Fair Queuing: virtual time = actual_time / weight
      // Higher weight = more service share
      const totalWeight = normalized.reduce((s, j) => s + j.weight, 0);

      const scheduled = normalized.map(job => {
        const share = job.weight / totalWeight;
        const virtualFinishTime = job.arrival + (job.duration / share);
        return { ...job, share: Math.round(share * 10000) / 100, virtualFinishTime };
      });

      // Sort by virtual finish time (earlier virtual finish = scheduled first)
      scheduled.sort((a, b) => a.virtualFinishTime - b.virtualFinishTime);

      let currentTime = Math.min(...scheduled.map(j => j.arrival));
      schedule = scheduled.map((job, idx) => {
        const startTime = Math.max(currentTime, job.arrival);
        const endTime = startTime + job.duration;
        currentTime = endTime;
        return {
          order: idx + 1,
          id: job.id,
          priority: job.priority,
          weight: job.weight,
          sharePercent: job.share,
          startTime,
          endTime,
          waitTime: startTime - job.arrival,
          meetsDeadline: job.deadline ? endTime <= job.deadline : null,
        };
      });
      scheduleName = "Weighted Fair Queuing";

    } else if (algorithm === "deadline_monotonic") {
      // Deadline-Monotonic: sort by deadline (earliest deadline first)
      const withDeadlines = normalized.filter(j => j.deadline);
      const withoutDeadlines = normalized.filter(j => !j.deadline);

      // EDF (Earliest Deadline First) ordering
      withDeadlines.sort((a, b) => a.deadline - b.deadline);
      const ordered = [...withDeadlines, ...withoutDeadlines];

      let currentTime = Math.min(...ordered.map(j => j.arrival));
      schedule = ordered.map((job, idx) => {
        const startTime = Math.max(currentTime, job.arrival);
        const endTime = startTime + job.duration;
        currentTime = endTime;
        const slackTime = job.deadline ? job.deadline - endTime : null;
        return {
          order: idx + 1,
          id: job.id,
          priority: job.priority,
          deadline: job.deadline ? new Date(job.deadline).toISOString() : null,
          startTime,
          endTime,
          waitTime: startTime - job.arrival,
          meetsDeadline: job.deadline ? endTime <= job.deadline : null,
          slackMs: slackTime,
        };
      });
      scheduleName = "Deadline-Monotonic (EDF)";

    } else {
      // Priority preemptive: highest priority first
      const sorted = [...normalized].sort((a, b) => b.priority - a.priority || a.arrival - b.arrival);

      let currentTime = Math.min(...sorted.map(j => j.arrival));
      schedule = sorted.map((job, idx) => {
        const startTime = Math.max(currentTime, job.arrival);
        const endTime = startTime + job.duration;
        currentTime = endTime;
        return {
          order: idx + 1,
          id: job.id,
          priority: job.priority,
          startTime,
          endTime,
          waitTime: startTime - job.arrival,
          meetsDeadline: job.deadline ? endTime <= job.deadline : null,
        };
      });
      scheduleName = "Priority Preemptive";
    }

    // Starvation detection: jobs waiting too long relative to their fair share
    const avgWait = schedule.reduce((s, j) => s + j.waitTime, 0) / schedule.length;
    const starvationThreshold = avgWait * 3;
    const starvedJobs = schedule.filter(j => j.waitTime > starvationThreshold);

    // Fairness analysis
    const waitTimes = schedule.map(j => j.waitTime);
    const waitMean = waitTimes.reduce((s, w) => s + w, 0) / waitTimes.length;
    const waitVariance = waitTimes.reduce((s, w) => s + Math.pow(w - waitMean, 2), 0) / waitTimes.length;

    // Jain's fairness index on normalized wait times
    const sumWait = waitTimes.reduce((s, w) => s + w, 0);
    const sumWaitSq = waitTimes.reduce((s, w) => s + w * w, 0);
    const jainsFairness = sumWaitSq > 0
      ? Math.round(((sumWait * sumWait) / (waitTimes.length * sumWaitSq)) * 10000) / 10000
      : 1;

    // Deadline analysis
    const deadlineJobs = schedule.filter(j => j.meetsDeadline !== null);
    const missedDeadlines = deadlineJobs.filter(j => j.meetsDeadline === false);

    return {
      ok: true, result: {
        algorithm: scheduleName,
        schedule,
        starvation: {
          detected: starvedJobs.length > 0,
          starvedJobs: starvedJobs.map(j => ({ id: j.id, waitTime: j.waitTime, threshold: Math.round(starvationThreshold) })),
          threshold: Math.round(starvationThreshold),
        },
        fairness: {
          jainsIndex: jainsFairness,
          level: jainsFairness > 0.9 ? "fair" : jainsFairness > 0.7 ? "moderate" : "unfair",
          avgWaitTime: Math.round(waitMean),
          waitTimeStdDev: Math.round(Math.sqrt(waitVariance)),
        },
        deadlines: {
          total: deadlineJobs.length,
          met: deadlineJobs.length - missedDeadlines.length,
          missed: missedDeadlines.length,
          missedJobs: missedDeadlines.map(j => j.id),
        },
        metrics: {
          totalJobs: jobs.length,
          makespan: schedule.length > 0 ? Math.max(...schedule.map(j => j.endTime)) - Math.min(...schedule.map(j => j.startTime)) : 0,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * backpressure
   * Compute backpressure signals: queue depth monitoring, rate limiting
   * calculations, and adaptive throttling thresholds.
   * artifact.data.metrics = { queueDepth: number, maxCapacity: number, ingressRate: number, egressRate: number, history?: [{ timestamp, depth, ingressRate, egressRate }] }
   */
  registerLensAction("queue", "backpressure", (ctx, artifact, params) => {
  try {
    const metrics = artifact.data?.metrics || {};
    const depth = metrics.queueDepth || 0;
    const capacity = metrics.maxCapacity || 1000;
    const ingressRate = metrics.ingressRate || 0;
    const egressRate = metrics.egressRate || 0;
    const history = metrics.history || [];

    // Current fill ratio
    const fillRatio = capacity > 0 ? depth / capacity : 0;

    // Time to overflow (if ingress > egress)
    const netRate = ingressRate - egressRate;
    const timeToOverflow = netRate > 0 && capacity > depth
      ? Math.round(((capacity - depth) / netRate) * 100) / 100
      : null;

    // Time to drain (if egress > ingress)
    const timeToDrain = netRate < 0 && depth > 0
      ? Math.round((depth / Math.abs(netRate)) * 100) / 100
      : null;

    // Backpressure signal: 0 = no pressure, 1 = full pressure
    // Using exponential curve for sensitivity at high fill ratios
    const backpressureSignal = Math.min(1, Math.pow(fillRatio, 2));

    // Rate limit calculation: target ingress rate to maintain fill ratio below threshold
    const targetFillRatio = params.targetFillRatio || 0.7;
    const targetDepth = capacity * targetFillRatio;
    let recommendedIngressRate;
    if (depth > targetDepth) {
      // Need to reduce ingress to drain
      recommendedIngressRate = Math.max(0, egressRate * 0.8);
    } else {
      // Can accept at egress rate plus margin
      const headroom = (targetDepth - depth) / Math.max(1, capacity);
      recommendedIngressRate = egressRate * (1 + headroom);
    }

    // Adaptive throttling thresholds (3 tiers)
    const throttlingTiers = [
      { tier: "none", fillThreshold: 0.5, ingressMultiplier: 1.0, description: "No throttling" },
      { tier: "light", fillThreshold: 0.7, ingressMultiplier: 0.75, description: "Reduce ingress to 75%" },
      { tier: "moderate", fillThreshold: 0.85, ingressMultiplier: 0.5, description: "Reduce ingress to 50%" },
      { tier: "heavy", fillThreshold: 0.95, ingressMultiplier: 0.1, description: "Near-complete throttle (10%)" },
    ];

    const activeTier = throttlingTiers.reduce((active, tier) => {
      return fillRatio >= tier.fillThreshold ? tier : active;
    }, throttlingTiers[0]);

    const throttledRate = Math.round(ingressRate * activeTier.ingressMultiplier * 100) / 100;

    // Trend analysis from history
    let trend = "stable";
    let depthTrend = null;
    if (history.length >= 3) {
      const recentDepths = history.slice(-10).map(h => h.depth);
      const firstHalf = recentDepths.slice(0, Math.floor(recentDepths.length / 2));
      const secondHalf = recentDepths.slice(Math.floor(recentDepths.length / 2));
      const firstAvg = firstHalf.reduce((s, d) => s + d, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, d) => s + d, 0) / secondHalf.length;

      if (secondAvg > firstAvg * 1.2) trend = "increasing";
      else if (secondAvg < firstAvg * 0.8) trend = "decreasing";

      // Rate of change (depth units per history point)
      const slope = (secondAvg - firstAvg) / Math.max(1, recentDepths.length / 2);
      depthTrend = {
        direction: trend,
        slope: Math.round(slope * 100) / 100,
        recentAvgDepth: Math.round(secondAvg * 100) / 100,
        previousAvgDepth: Math.round(firstAvg * 100) / 100,
      };
    }

    // Health assessment
    let health;
    if (fillRatio >= 0.95) health = "critical";
    else if (fillRatio >= 0.8) health = "warning";
    else if (fillRatio >= 0.5) health = "caution";
    else health = "healthy";

    return {
      ok: true, result: {
        currentState: {
          queueDepth: depth,
          maxCapacity: capacity,
          fillRatio: Math.round(fillRatio * 10000) / 100,
          ingressRate,
          egressRate,
          netRate: Math.round(netRate * 100) / 100,
          health,
        },
        backpressure: {
          signal: Math.round(backpressureSignal * 10000) / 10000,
          level: backpressureSignal > 0.8 ? "critical" : backpressureSignal > 0.5 ? "high" : backpressureSignal > 0.2 ? "moderate" : "low",
          timeToOverflow: timeToOverflow ? `${timeToOverflow}s` : "N/A (draining or stable)",
          timeToDrain: timeToDrain ? `${timeToDrain}s` : "N/A (filling or stable)",
        },
        throttling: {
          activeTier: activeTier.tier,
          description: activeTier.description,
          currentIngressRate: ingressRate,
          throttledIngressRate: throttledRate,
          recommendedIngressRate: Math.round(recommendedIngressRate * 100) / 100,
          tiers: throttlingTiers,
        },
        trend: depthTrend || { direction: "insufficient_data" },
        recommendations: [
          ...(fillRatio > 0.9 ? ["Queue critically full — apply heavy backpressure immediately"] : []),
          ...(netRate > 0 && timeToOverflow && timeToOverflow < 60 ? [`Queue will overflow in ~${timeToOverflow}s — scale consumers or throttle producers`] : []),
          ...(trend === "increasing" ? ["Queue depth trending upward — consider adding consumers"] : []),
          ...(egressRate > 0 && ingressRate / egressRate > 2 ? ["Ingress rate is 2x+ egress rate — significant imbalance"] : []),
        ],
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ───────────────────────────────────────────────────────────────────────
  // Real in-memory job-queue substrate (RabbitMQ / BullMQ-style console).
  // Per-user, persisted via globalThis._concordSTATE. Enqueue, process,
  // retry, dead-letter, scheduling, priorities, workers, pause/resume.
  // ───────────────────────────────────────────────────────────────────────

  const DEFAULT_QUEUES = ["ingest", "autocrawl", "terminal"];
  const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };
  const MAX_ATTEMPTS = 3;
  const MAX_JOBS_PER_USER = 5000;
  const MAX_EVENTS = 400;

  function getQueueState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.queueLens) {
      STATE.queueLens = {
        jobs: new Map(),     // userId -> Map<jobId, job>
        queues: new Map(),   // userId -> Map<queueName, { paused, concurrency }>
        workers: new Map(),  // userId -> Map<workerId, worker>
        events: new Map(),   // userId -> Array<event>
        throughput: new Map(), // userId -> Array<{ ts, processed, failed }>
      };
    }
    return STATE.queueLens;
  }
  function saveQueueState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function qActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function qId(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function qNow() { return Date.now(); }
  function qIso(t) { return new Date(t).toISOString(); }

  function userJobs(s, userId) {
    if (!s.jobs.has(userId)) s.jobs.set(userId, new Map());
    return s.jobs.get(userId);
  }
  function userQueues(s, userId) {
    if (!s.queues.has(userId)) {
      const m = new Map();
      for (const q of DEFAULT_QUEUES) m.set(q, { paused: false, concurrency: 3 });
      s.queues.set(userId, m);
    }
    return s.queues.get(userId);
  }
  function userWorkers(s, userId) {
    if (!s.workers.has(userId)) s.workers.set(userId, new Map());
    return s.workers.get(userId);
  }
  function userEvents(s, userId) {
    if (!s.events.has(userId)) s.events.set(userId, []);
    return s.events.get(userId);
  }
  function userThroughput(s, userId) {
    if (!s.throughput.has(userId)) s.throughput.set(userId, []);
    return s.throughput.get(userId);
  }
  function logEvent(s, userId, kind, message, jobId) {
    const evs = userEvents(s, userId);
    evs.push({ id: qId("ev"), kind, message, jobId: jobId || null, at: qIso(qNow()) });
    if (evs.length > MAX_EVENTS) evs.splice(0, evs.length - MAX_EVENTS);
  }
  function ensureQueueRow(s, userId, name) {
    const qs = userQueues(s, userId);
    if (!qs.has(name)) qs.set(name, { paused: false, concurrency: 3 });
    return qs.get(name);
  }
  function jobPublicShape(j) {
    return {
      id: j.id, queue: j.queue, name: j.name, status: j.status,
      priority: j.priority, payload: j.payload, attempts: j.attempts,
      maxAttempts: j.maxAttempts, error: j.error, result: j.result,
      createdAt: j.createdAt, updatedAt: j.updatedAt,
      runAt: j.runAt, startedAt: j.startedAt, finishedAt: j.finishedAt,
      workerId: j.workerId, durationMs: j.durationMs,
    };
  }

  /**
   * enqueue — add a job to a named queue.
   * params: { queue, name, payload?, priority?, delayMs?, maxAttempts? }
   */
  registerLensAction("queue", "enqueue", (ctx, _artifact, params = {}) => {
    try {
      const s = getQueueState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = qActor(ctx);
      const jobs = userJobs(s, userId);
      if (jobs.size >= MAX_JOBS_PER_USER) return { ok: false, error: `job limit reached (${MAX_JOBS_PER_USER})` };
      const queue = String(params.queue || "ingest").trim().slice(0, 40) || "ingest";
      const name = String(params.name || "job").trim().slice(0, 80) || "job";
      const priority = ["high", "normal", "low"].includes(params.priority) ? params.priority : "normal";
      const delayMs = Math.max(0, Math.min(Number(params.delayMs) || 0, 7 * 24 * 3600 * 1000));
      const maxAttempts = Math.max(1, Math.min(Number(params.maxAttempts) || MAX_ATTEMPTS, 10));
      const now = qNow();
      const runAt = now + delayMs;
      const job = {
        id: qId("job"), queue, name, priority,
        payload: params.payload && typeof params.payload === "object" ? params.payload : {},
        status: delayMs > 0 ? "delayed" : "pending",
        attempts: 0, maxAttempts,
        error: null, result: null,
        createdAt: qIso(now), updatedAt: qIso(now),
        runAt: qIso(runAt), startedAt: null, finishedAt: null,
        workerId: null, durationMs: null,
      };
      jobs.set(job.id, job);
      ensureQueueRow(s, userId, queue);
      logEvent(s, userId, delayMs > 0 ? "scheduled" : "enqueued", `${name} → ${queue}`, job.id);
      saveQueueState();
      return { ok: true, result: { job: jobPublicShape(job) } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /**
   * list — list jobs, optionally filtered by queue/status.
   * params: { queue?, status?, limit? }
   */
  registerLensAction("queue", "list", (ctx, _artifact, params = {}) => {
    try {
      const s = getQueueState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = qActor(ctx);
      const jobs = userJobs(s, userId);
      const now = qNow();
      // Promote any delayed jobs whose runAt has passed.
      for (const j of jobs.values()) {
        if (j.status === "delayed" && Date.parse(j.runAt) <= now) {
          j.status = "pending";
          j.updatedAt = qIso(now);
          logEvent(s, userId, "ready", `${j.name} delayed→pending`, j.id);
        }
      }
      const limit = Math.max(1, Math.min(Number(params.limit) || 200, 1000));
      let arr = Array.from(jobs.values());
      if (params.queue) arr = arr.filter(j => j.queue === params.queue);
      if (params.status) arr = arr.filter(j => j.status === params.status);
      arr.sort((a, b) => {
        const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (pr !== 0) return pr;
        return Date.parse(a.createdAt) - Date.parse(b.createdAt);
      });
      const total = arr.length;
      return { ok: true, result: { jobs: arr.slice(0, limit).map(jobPublicShape), total } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /**
   * job-detail — inspect a single job (payload, error, attempt history).
   * params: { jobId }
   */
  registerLensAction("queue", "job-detail", (ctx, _artifact, params = {}) => {
    try {
      const s = getQueueState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = qActor(ctx);
      const job = userJobs(s, userId).get(String(params.jobId || ""));
      if (!job) return { ok: false, error: "job not found" };
      const history = userEvents(s, userId).filter(e => e.jobId === job.id);
      return { ok: true, result: { job: jobPublicShape(job), history } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /**
   * process — pick and run the next eligible job (or a specific one).
   * Real processing: simulates work outcome deterministically from payload.
   * params: { jobId? , queue?, fail? }
   */
  registerLensAction("queue", "process", (ctx, _artifact, params = {}) => {
    try {
      const s = getQueueState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = qActor(ctx);
      const jobs = userJobs(s, userId);
      const now = qNow();
      let job;
      if (params.jobId) {
        job = jobs.get(String(params.jobId));
        if (!job) return { ok: false, error: "job not found" };
        if (!["pending", "delayed", "failed"].includes(job.status)) {
          return { ok: false, error: `job not runnable (status: ${job.status})` };
        }
      } else {
        const qs = userQueues(s, userId);
        const eligible = Array.from(jobs.values()).filter(j => {
          if (j.status !== "pending" && !(j.status === "delayed" && Date.parse(j.runAt) <= now)) return false;
          if (params.queue && j.queue !== params.queue) return false;
          const row = qs.get(j.queue);
          return !(row && row.paused);
        });
        eligible.sort((a, b) => {
          const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
          if (pr !== 0) return pr;
          return Date.parse(a.createdAt) - Date.parse(b.createdAt);
        });
        job = eligible[0];
        if (!job) return { ok: true, result: { processed: null, message: "no eligible jobs" } };
      }
      job.status = "active";
      job.attempts += 1;
      job.startedAt = qIso(now);
      job.workerId = job.workerId || "inline";
      job.updatedAt = qIso(now);
      // Outcome: explicit fail flag, or payload.shouldFail, else success.
      const shouldFail = params.fail === true || job.payload?.shouldFail === true;
      const finished = qNow();
      job.durationMs = Math.max(1, finished - now);
      job.finishedAt = qIso(finished);
      if (shouldFail) {
        job.error = String(job.payload?.failReason || params.failReason || "processing failed");
        if (job.attempts >= job.maxAttempts) {
          job.status = "dead";
          logEvent(s, userId, "dead-letter", `${job.name} → dead-letter (${job.attempts} attempts)`, job.id);
        } else {
          job.status = "failed";
          logEvent(s, userId, "failed", `${job.name} failed (attempt ${job.attempts}/${job.maxAttempts})`, job.id);
        }
      } else {
        job.status = "completed";
        job.error = null;
        job.result = { ok: true, output: `processed ${job.name}`, at: job.finishedAt };
        logEvent(s, userId, "completed", `${job.name} completed in ${job.durationMs}ms`, job.id);
      }
      // Record throughput sample.
      const tp = userThroughput(s, userId);
      tp.push({ ts: finished, processed: shouldFail ? 0 : 1, failed: shouldFail ? 1 : 0, latency: job.durationMs });
      if (tp.length > 500) tp.splice(0, tp.length - 500);
      saveQueueState();
      return { ok: true, result: { processed: jobPublicShape(job) } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /**
   * retry — requeue a failed or dead job back to pending.
   * params: { jobId, resetAttempts? }
   */
  registerLensAction("queue", "retry", (ctx, _artifact, params = {}) => {
    try {
      const s = getQueueState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = qActor(ctx);
      const job = userJobs(s, userId).get(String(params.jobId || ""));
      if (!job) return { ok: false, error: "job not found" };
      if (!["failed", "dead"].includes(job.status)) {
        return { ok: false, error: `only failed/dead jobs can be retried (status: ${job.status})` };
      }
      if (params.resetAttempts === true) job.attempts = 0;
      job.status = "pending";
      job.error = null;
      job.startedAt = null;
      job.finishedAt = null;
      job.durationMs = null;
      job.runAt = qIso(qNow());
      job.updatedAt = qIso(qNow());
      logEvent(s, userId, "retried", `${job.name} requeued`, job.id);
      saveQueueState();
      return { ok: true, result: { job: jobPublicShape(job) } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /**
   * dead-letter — list dead-lettered jobs and optionally bulk-act.
   * params: { action?: "list"|"retry-all"|"purge", queue? }
   */
  registerLensAction("queue", "dead-letter", (ctx, _artifact, params = {}) => {
    try {
      const s = getQueueState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = qActor(ctx);
      const jobs = userJobs(s, userId);
      const action = params.action || "list";
      let dead = Array.from(jobs.values()).filter(j => j.status === "dead" || j.status === "failed");
      if (params.queue) dead = dead.filter(j => j.queue === params.queue);
      if (action === "retry-all") {
        let count = 0;
        for (const j of dead) {
          j.status = "pending"; j.error = null; j.attempts = 0;
          j.startedAt = null; j.finishedAt = null; j.durationMs = null;
          j.runAt = qIso(qNow()); j.updatedAt = qIso(qNow());
          count++;
        }
        logEvent(s, userId, "bulk-retry", `requeued ${count} dead/failed jobs`);
        saveQueueState();
        return { ok: true, result: { retried: count } };
      }
      if (action === "purge") {
        let count = 0;
        for (const j of dead) { jobs.delete(j.id); count++; }
        logEvent(s, userId, "bulk-purge", `purged ${count} dead/failed jobs`);
        saveQueueState();
        return { ok: true, result: { purged: count } };
      }
      return { ok: true, result: { jobs: dead.map(jobPublicShape), total: dead.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /**
   * remove — delete a job from the queue entirely.
   * params: { jobId }
   */
  registerLensAction("queue", "remove", (ctx, _artifact, params = {}) => {
    try {
      const s = getQueueState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = qActor(ctx);
      const jobs = userJobs(s, userId);
      const jobId = String(params.jobId || "");
      const job = jobs.get(jobId);
      if (!job) return { ok: false, error: "job not found" };
      jobs.delete(jobId);
      logEvent(s, userId, "removed", `${job.name} removed`, jobId);
      saveQueueState();
      return { ok: true, result: { removed: jobId } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /**
   * scheduled — list delayed/future-dated jobs.
   * params: { queue? }
   */
  registerLensAction("queue", "scheduled", (ctx, _artifact, params = {}) => {
    try {
      const s = getQueueState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = qActor(ctx);
      const now = qNow();
      let arr = Array.from(userJobs(s, userId).values()).filter(j => j.status === "delayed");
      if (params.queue) arr = arr.filter(j => j.queue === params.queue);
      arr.sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt));
      return {
        ok: true, result: {
          jobs: arr.map(j => ({ ...jobPublicShape(j), etaMs: Math.max(0, Date.parse(j.runAt) - now) })),
          total: arr.length,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /**
   * pause / resume a queue, and set concurrency.
   * params: { queue, paused?, concurrency? }
   */
  registerLensAction("queue", "control", (ctx, _artifact, params = {}) => {
    try {
      const s = getQueueState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = qActor(ctx);
      const name = String(params.queue || "").trim();
      if (!name) return { ok: false, error: "queue required" };
      const row = ensureQueueRow(s, userId, name);
      if (typeof params.paused === "boolean") row.paused = params.paused;
      if (params.concurrency != null) {
        const c = Number(params.concurrency);
        if (Number.isFinite(c) && c >= 1 && c <= 64) row.concurrency = Math.floor(c);
      }
      logEvent(s, userId, "control", `${name}: ${row.paused ? "paused" : "running"} · concurrency ${row.concurrency}`);
      saveQueueState();
      return { ok: true, result: { queue: name, ...row } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /**
   * queues — list all queues with live counts + paused/concurrency state.
   */
  registerLensAction("queue", "queues", (ctx, _artifact, _params = {}) => {
    try {
      const s = getQueueState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = qActor(ctx);
      const jobs = Array.from(userJobs(s, userId).values());
      const qs = userQueues(s, userId);
      const names = new Set([...qs.keys(), ...jobs.map(j => j.queue)]);
      const queues = Array.from(names).map(name => {
        const row = qs.get(name) || { paused: false, concurrency: 3 };
        const qj = jobs.filter(j => j.queue === name);
        const byStatus = {};
        for (const j of qj) byStatus[j.status] = (byStatus[j.status] || 0) + 1;
        return {
          name, paused: row.paused, concurrency: row.concurrency,
          depth: qj.filter(j => ["pending", "delayed", "failed"].includes(j.status)).length,
          counts: {
            pending: byStatus.pending || 0,
            delayed: byStatus.delayed || 0,
            active: byStatus.active || 0,
            completed: byStatus.completed || 0,
            failed: byStatus.failed || 0,
            dead: byStatus.dead || 0,
          },
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
      return { ok: true, result: { queues } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /**
   * workers — register/heartbeat a worker, or list workers.
   * params: { action?: "list"|"register"|"heartbeat"|"stop", workerId?, name?, queue? }
   */
  registerLensAction("queue", "workers", (ctx, _artifact, params = {}) => {
    try {
      const s = getQueueState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = qActor(ctx);
      const workers = userWorkers(s, userId);
      const action = params.action || "list";
      const now = qNow();
      if (action === "register") {
        const w = {
          id: qId("wk"),
          name: String(params.name || "worker").slice(0, 60),
          queue: String(params.queue || "*").slice(0, 40),
          status: "idle", currentJob: null,
          startedAt: qIso(now), lastSeen: qIso(now), processed: 0,
        };
        workers.set(w.id, w);
        logEvent(s, userId, "worker", `worker ${w.name} registered`);
        saveQueueState();
        return { ok: true, result: { worker: w } };
      }
      if (action === "heartbeat" || action === "stop") {
        const w = workers.get(String(params.workerId || ""));
        if (!w) return { ok: false, error: "worker not found" };
        w.lastSeen = qIso(now);
        if (action === "stop") { w.status = "stopped"; w.currentJob = null; }
        saveQueueState();
        return { ok: true, result: { worker: w } };
      }
      // list — also mark stale workers (no heartbeat in 60s) as offline.
      const jobs = Array.from(userJobs(s, userId).values());
      const list = Array.from(workers.values()).map(w => {
        const stale = now - Date.parse(w.lastSeen) > 60_000;
        const activeJob = jobs.find(j => j.status === "active" && j.workerId === w.id);
        return {
          ...w,
          status: w.status === "stopped" ? "stopped" : stale ? "offline" : activeJob ? "busy" : "idle",
          currentJob: activeJob ? activeJob.id : null,
        };
      });
      return { ok: true, result: { workers: list, total: list.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /**
   * metrics — aggregate dashboard metrics + throughput/latency time-series + alerts.
   */
  registerLensAction("queue", "metrics", (ctx, _artifact, _params = {}) => {
    try {
      const s = getQueueState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = qActor(ctx);
      const jobs = Array.from(userJobs(s, userId).values());
      const now = qNow();
      const byStatus = { pending: 0, delayed: 0, active: 0, completed: 0, failed: 0, dead: 0 };
      const byPriority = { high: 0, normal: 0, low: 0 };
      for (const j of jobs) {
        byStatus[j.status] = (byStatus[j.status] || 0) + 1;
        if (["pending", "delayed"].includes(j.status)) byPriority[j.priority] = (byPriority[j.priority] || 0) + 1;
      }
      const depth = byStatus.pending + byStatus.delayed + byStatus.failed;
      // Throughput series: bucket the last hour into 12 × 5-min slots.
      const tp = userThroughput(s, userId);
      const slotMs = 5 * 60 * 1000;
      const series = [];
      for (let i = 11; i >= 0; i--) {
        const start = now - (i + 1) * slotMs;
        const end = now - i * slotMs;
        const inSlot = tp.filter(t => t.ts > start && t.ts <= end);
        const processed = inSlot.reduce((a, t) => a + t.processed, 0);
        const failed = inSlot.reduce((a, t) => a + t.failed, 0);
        const lat = inSlot.length ? inSlot.reduce((a, t) => a + (t.latency || 0), 0) / inSlot.length : 0;
        series.push({
          slot: new Date(end).toISOString().slice(11, 16),
          processed, failed,
          latencyMs: Math.round(lat),
        });
      }
      const recentDone = tp.filter(t => now - t.ts < 24 * 3600 * 1000);
      const completed24h = recentDone.reduce((a, t) => a + t.processed, 0);
      const failed24h = recentDone.reduce((a, t) => a + t.failed, 0);
      const last10 = tp.slice(-10);
      const avgLatency = last10.length
        ? Math.round(last10.reduce((a, t) => a + (t.latency || 0), 0) / last10.length)
        : 0;
      const lastHour = tp.filter(t => now - t.ts < 3600 * 1000);
      const ratePerMin = Math.round((lastHour.reduce((a, t) => a + t.processed, 0) / 60) * 10) / 10;
      // Alerts: queue depth + stalled jobs.
      const alerts = [];
      if (depth > 200) alerts.push({ level: "critical", message: `Queue depth ${depth} exceeds 200` });
      else if (depth > 80) alerts.push({ level: "warning", message: `Queue depth ${depth} is elevated` });
      const stalled = jobs.filter(j => j.status === "active" && now - Date.parse(j.startedAt || j.updatedAt) > 120_000);
      if (stalled.length) alerts.push({ level: "warning", message: `${stalled.length} job(s) stalled >2min`, jobs: stalled.map(j => j.id) });
      if (byStatus.dead > 0) alerts.push({ level: "warning", message: `${byStatus.dead} job(s) in dead-letter queue` });
      return {
        ok: true, result: {
          totals: { ...byStatus, depth, all: jobs.length },
          byPriority,
          throughput: { series, completed24h, failed24h, ratePerMin, avgLatencyMs: avgLatency },
          alerts,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /**
   * events — recent queue activity feed.
   * params: { limit? }
   */
  registerLensAction("queue", "events", (ctx, _artifact, params = {}) => {
    try {
      const s = getQueueState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = qActor(ctx);
      const limit = Math.max(1, Math.min(Number(params.limit) || 30, MAX_EVENTS));
      const evs = userEvents(s, userId).slice(-limit).reverse();
      return { ok: true, result: { events: evs, total: evs.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /**
   * clear-completed — remove all completed jobs.
   */
  registerLensAction("queue", "clear-completed", (ctx, _artifact, _params = {}) => {
    try {
      const s = getQueueState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = qActor(ctx);
      const jobs = userJobs(s, userId);
      let count = 0;
      for (const [id, j] of jobs) {
        if (j.status === "completed") { jobs.delete(id); count++; }
      }
      if (count) logEvent(s, userId, "cleared", `cleared ${count} completed jobs`);
      saveQueueState();
      return { ok: true, result: { cleared: count } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
}
