// server/domains/lock.js
// Domain actions for resource locking: deadlock detection via wait-for graphs,
// lock contention analysis, and fairness scoring.

export default function registerLockActions(registerLensAction) {
  /**
   * deadlockDetect
   * Build a wait-for graph from artifact.data.locks [{holder, waiting}],
   * detect cycles using DFS, and return deadlock sets.
   */
  registerLensAction("lock", "deadlockDetect", (ctx, artifact, params) => {
  try {
    const locks = artifact.data?.locks || [];
    if (locks.length === 0) {
      return { ok: true, result: { deadlocked: false, cycles: [], message: "No lock data provided." } };
    }

    // Build wait-for graph: waiting -> [holders it waits for]
    const graph = {};
    const allNodes = new Set();
    for (const lock of locks) {
      const { holder, waiting } = lock;
      if (!holder || !waiting) continue;
      const waiters = Array.isArray(waiting) ? waiting : [waiting];
      for (const waiter of waiters) {
        allNodes.add(holder);
        allNodes.add(waiter);
        if (!graph[waiter]) graph[waiter] = [];
        graph[waiter].push(holder);
      }
    }

    for (const node of allNodes) {
      if (!graph[node]) graph[node] = [];
    }

    if (allNodes.size === 0) {
      return { ok: true, result: { deadlocked: false, cycles: [], message: "No valid lock edges found." } };
    }

    // DFS-based cycle detection
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = {};
    const parent = {};
    const cycles = [];

    for (const node of allNodes) {
      color[node] = WHITE;
      parent[node] = null;
    }

    function dfs(node) {
      color[node] = GRAY;
      for (const neighbor of graph[node]) {
        if (color[neighbor] === GRAY) {
          // Back edge found — extract cycle
          const cycle = [neighbor];
          let cur = node;
          while (cur !== neighbor && cur != null) {
            cycle.push(cur);
            cur = parent[cur];
          }
          cycle.push(neighbor);
          cycle.reverse();
          cycles.push(cycle);
        } else if (color[neighbor] === WHITE) {
          parent[neighbor] = node;
          dfs(neighbor);
        }
      }
      color[node] = BLACK;
    }

    for (const node of allNodes) {
      if (color[node] === WHITE) dfs(node);
    }

    // Deduplicate cycles by normalizing (rotate smallest element first)
    const uniqueCycles = [];
    const seen = new Set();
    for (const cycle of cycles) {
      const body = cycle.slice(0, -1);
      if (body.length === 0) continue;
      const minVal = body.reduce((a, b) => (a < b ? a : b));
      const minIdx = body.indexOf(minVal);
      const normalized = [...body.slice(minIdx), ...body.slice(0, minIdx)];
      const key = normalized.join("->");
      if (!seen.has(key)) {
        seen.add(key);
        uniqueCycles.push([...normalized, normalized[0]]);
      }
    }

    // Collect all deadlocked nodes
    const deadlockedNodes = new Set();
    for (const cycle of uniqueCycles) {
      for (const node of cycle) deadlockedNodes.add(node);
    }

    // Build deadlock sets with suggested victims (node with fewest outgoing edges)
    const deadlockSets = uniqueCycles.map((cycle) => {
      const members = cycle.slice(0, -1);
      const victim = members.reduce((best, node) => {
        return (graph[node] || []).length <= (graph[best] || []).length ? node : best;
      }, members[0]);
      return { cycle, length: members.length, members, suggestedVictim: victim };
    });

    return {
      ok: true,
      result: {
        deadlocked: uniqueCycles.length > 0,
        cycleCount: uniqueCycles.length,
        deadlockSets,
        deadlockedNodes: [...deadlockedNodes],
        totalNodes: allNodes.size,
        totalEdges: locks.length,
        waitForGraph: Object.fromEntries(
          Object.entries(graph).filter(([, v]) => v.length > 0)
        ),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * contentionAnalysis
   * Compute contention ratios from lock acquisition data, identify hot locks,
   * and suggest granularity changes.
   * artifact.data.lockEvents = [{ resource, type: "acquire"|"release"|"wait", processId, durationMs? }]
   */
  registerLensAction("lock", "contentionAnalysis", (ctx, artifact, params) => {
  try {
    const events = artifact.data?.lockEvents || [];
    if (events.length === 0) {
      return { ok: true, result: { message: "No lock events to analyze." } };
    }

    // Aggregate per resource
    const stats = {};
    for (const ev of events) {
      const r = ev.resource || "unknown";
      if (!stats[r]) {
        stats[r] = {
          acquires: 0, waits: 0, releases: 0,
          totalWaitMs: 0, totalHoldMs: 0,
          waitDurations: [], holdDurations: [],
          processes: new Set(),
        };
      }
      const s = stats[r];
      s.processes.add(ev.processId);
      if (ev.type === "acquire") {
        s.acquires++;
        if (ev.durationMs != null) {
          s.totalHoldMs += ev.durationMs;
          s.holdDurations.push(ev.durationMs);
        }
      } else if (ev.type === "wait") {
        s.waits++;
        if (ev.durationMs != null) {
          s.totalWaitMs += ev.durationMs;
          s.waitDurations.push(ev.durationMs);
        }
      } else if (ev.type === "release") {
        s.releases++;
      }
    }

    function percentile(sorted, p) {
      if (sorted.length === 0) return 0;
      const idx = Math.floor(sorted.length * p);
      return sorted[Math.min(idx, sorted.length - 1)];
    }

    const resources = Object.entries(stats).map(([resource, s]) => {
      const contentionRatio = s.acquires > 0 ? s.waits / s.acquires : 0;
      const avgWaitMs = s.waitDurations.length > 0
        ? s.waitDurations.reduce((a, b) => a + b, 0) / s.waitDurations.length : 0;
      const avgHoldMs = s.holdDurations.length > 0
        ? s.holdDurations.reduce((a, b) => a + b, 0) / s.holdDurations.length : 0;
      const sortedWaits = [...s.waitDurations].sort((a, b) => a - b);
      const p95Wait = percentile(sortedWaits, 0.95);
      const maxWait = sortedWaits.length > 0 ? sortedWaits[sortedWaits.length - 1] : 0;

      // Hot lock score: weighted combination of contention ratio, process count, wait time
      const hotScore = Math.min(100, Math.round(
        contentionRatio * 40 +
        Math.min(s.processes.size, 10) * 4 +
        Math.min(avgWaitMs / 100, 20)
      ));

      return {
        resource,
        contentionRatio: Math.round(contentionRatio * 10000) / 10000,
        acquires: s.acquires,
        waits: s.waits,
        processCount: s.processes.size,
        avgWaitMs: Math.round(avgWaitMs * 100) / 100,
        maxWaitMs: Math.round(maxWait * 100) / 100,
        p95WaitMs: Math.round(p95Wait * 100) / 100,
        avgHoldMs: Math.round(avgHoldMs * 100) / 100,
        hotScore,
        isHotLock: hotScore >= 50,
      };
    });

    resources.sort((a, b) => b.hotScore - a.hotScore);

    const hotLocks = resources.filter((r) => r.isHotLock);

    // Granularity suggestions for hot locks
    const suggestions = hotLocks.map((lock) => {
      let recommendation, reason;
      if (lock.avgHoldMs > 100 && lock.contentionRatio > 0.5) {
        recommendation = "split_lock";
        reason = "High hold time with high contention — consider finer-grained locking";
      } else if (lock.processCount > 5 && lock.contentionRatio > 0.3) {
        recommendation = "reader_writer_lock";
        reason = "Many processes contending — use read/write locks if reads dominate";
      } else if (lock.avgHoldMs > 500) {
        recommendation = "reduce_critical_section";
        reason = "Very long hold times — minimize work inside critical section";
      } else {
        recommendation = "monitor";
        reason = "Elevated contention but within manageable bounds";
      }
      return { resource: lock.resource, recommendation, reason };
    });

    const totalWaits = resources.reduce((s, r) => s + r.waits, 0);
    const totalAcquires = resources.reduce((s, r) => s + r.acquires, 0);
    const overallContention = totalAcquires > 0 ? totalWaits / totalAcquires : 0;

    return {
      ok: true,
      result: {
        resources,
        hotLocks,
        suggestions,
        summary: {
          totalResources: resources.length,
          totalEvents: events.length,
          overallContentionRatio: Math.round(overallContention * 10000) / 10000,
          hotLockCount: hotLocks.length,
          contentionLevel: overallContention > 0.5 ? "severe" : overallContention > 0.2 ? "moderate" : "low",
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * fairnessScore
   * Measure wait time variance, detect starvation, and compute Jain's fairness
   * index: J = (sum(xi))^2 / (n * sum(xi^2)).
   * artifact.data.processWaits = [{ processId, resource, waitMs, attempts? }]
   */
  registerLensAction("lock", "fairnessScore", (ctx, artifact, params) => {
  try {
    const waits = artifact.data?.processWaits || [];
    if (waits.length === 0) {
      return { ok: true, result: { message: "No wait data to analyze." } };
    }

    // Per-process aggregation
    const byProcess = {};
    for (const w of waits) {
      const pid = w.processId;
      if (!byProcess[pid]) {
        byProcess[pid] = { totalWait: 0, count: 0, maxWait: 0, attempts: 0, resources: new Set() };
      }
      const s = byProcess[pid];
      s.totalWait += w.waitMs || 0;
      s.count++;
      s.maxWait = Math.max(s.maxWait, w.waitMs || 0);
      s.attempts += w.attempts || 1;
      s.resources.add(w.resource);
    }

    const processes = Object.entries(byProcess).map(([pid, s]) => ({
      processId: pid,
      totalWaitMs: s.totalWait,
      avgWaitMs: Math.round((s.totalWait / s.count) * 100) / 100,
      maxWaitMs: s.maxWait,
      lockRequests: s.count,
      totalAttempts: s.attempts,
      resourceCount: s.resources.size,
    }));

    // Jain's Fairness Index: J = (sum(xi))^2 / (n * sum(xi^2))
    const avgWaits = processes.map((p) => p.avgWaitMs);
    const n = avgWaits.length;
    const sumX = avgWaits.reduce((s, x) => s + x, 0);
    const sumXSq = avgWaits.reduce((s, x) => s + x * x, 0);
    const jainsIndex = n > 0 && sumXSq > 0
      ? (sumX * sumX) / (n * sumXSq)
      : 1;

    // Variance analysis
    const mean = sumX / n;
    const variance = avgWaits.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);
    const coeffOfVariation = mean > 0 ? stdDev / mean : 0;

    // Starvation detection: processes waiting > 3x mean
    const starvationThreshold = mean * 3;
    const starvedProcesses = processes.filter((p) => p.avgWaitMs > starvationThreshold);

    // Max/min ratio
    const positiveWaits = avgWaits.filter((w) => w > 0);
    const maxWait = Math.max(...avgWaits);
    const minWait = positiveWaits.length > 0 ? Math.min(...positiveWaits) : 0;
    const maxMinRatio = minWait > 0 ? maxWait / minWait : (maxWait > 0 ? Infinity : 1);

    // Per-resource Jain's index
    const byResource = {};
    for (const w of waits) {
      const r = w.resource || "unknown";
      if (!byResource[r]) byResource[r] = {};
      if (!byResource[r][w.processId]) byResource[r][w.processId] = [];
      byResource[r][w.processId].push(w.waitMs || 0);
    }

    const resourceFairness = Object.entries(byResource).map(([resource, procMap]) => {
      const procAvgs = Object.values(procMap).map(
        (arr) => arr.reduce((s, v) => s + v, 0) / arr.length
      );
      const rn = procAvgs.length;
      const rSum = procAvgs.reduce((s, v) => s + v, 0);
      const rSumSq = procAvgs.reduce((s, v) => s + v * v, 0);
      const rJains = rn > 0 && rSumSq > 0 ? (rSum * rSum) / (rn * rSumSq) : 1;
      return {
        resource,
        processCount: rn,
        jainsIndex: Math.round(rJains * 10000) / 10000,
        fair: rJains > 0.9,
      };
    });

    let fairnessLevel;
    if (jainsIndex > 0.95) fairnessLevel = "excellent";
    else if (jainsIndex > 0.85) fairnessLevel = "good";
    else if (jainsIndex > 0.7) fairnessLevel = "moderate";
    else fairnessLevel = "poor";

    processes.sort((a, b) => b.avgWaitMs - a.avgWaitMs);

    return {
      ok: true,
      result: {
        jainsIndex: Math.round(jainsIndex * 10000) / 10000,
        fairnessLevel,
        processes,
        starvation: {
          detected: starvedProcesses.length > 0,
          threshold: Math.round(starvationThreshold * 100) / 100,
          starvedProcesses: starvedProcesses.map((p) => ({
            processId: p.processId,
            avgWaitMs: p.avgWaitMs,
            ratioToMean: Math.round((p.avgWaitMs / mean) * 100) / 100,
          })),
        },
        waitDistribution: {
          mean: Math.round(mean * 100) / 100,
          stdDev: Math.round(stdDev * 100) / 100,
          coefficientOfVariation: Math.round(coeffOfVariation * 10000) / 10000,
          maxMinRatio: maxMinRatio === Infinity ? "Infinity" : Math.round(maxMinRatio * 100) / 100,
        },
        resourceFairness,
        summary: {
          totalProcesses: n,
          totalWaitEvents: waits.length,
          starvedCount: starvedProcesses.length,
          unfairResources: resourceFairness.filter((r) => !r.fair).length,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ═══════════════════════════════════════════════════════════════
  //  Concurrency lock-profiler features (JFR / lock-profiler parity)
  //  Persistent per-user lock-trace store lives in
  //  globalThis._concordSTATE.lockLens.traces — keyed by userId.
  //  Every handler is try/catch wrapped and returns { ok, result?, error? }.
  // ═══════════════════════════════════════════════════════════════

  function uidOf(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }

  function getLockState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.lockLens) {
      STATE.lockLens = { traces: new Map() }; // userId -> Array<traceEvent>
    }
    return STATE.lockLens;
  }
  function saveLockState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* noop */ }
    }
  }
  function tracesFor(ctx) {
    const ls = getLockState();
    if (!ls) return [];
    const id = uidOf(ctx);
    if (!ls.traces.has(id)) ls.traces.set(id, []);
    return ls.traces.get(id);
  }

  /**
   * recordLockEvent
   * Append a real lock-trace event to the per-user store. This is the
   * data source that feeds the live timeline / ordering / hotspot views.
   * params: { thread, lock, action: "acquire"|"release"|"wait", waitMs?,
   *           holdMs?, stack? (array of frames), ts? }
   */
  registerLensAction("lock", "recordLockEvent", (ctx, artifact, params) => {
    try {
      const p = params || {};
      const action = String(p.action || "").toLowerCase();
      if (!p.thread || !p.lock) {
        return { ok: false, error: "thread and lock are required" };
      }
      if (!["acquire", "release", "wait"].includes(action)) {
        return { ok: false, error: "action must be acquire, release or wait" };
      }
      const store = tracesFor(ctx);
      const ev = {
        id: `lt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        thread: String(p.thread),
        lock: String(p.lock),
        action,
        waitMs: Number.isFinite(+p.waitMs) ? +p.waitMs : 0,
        holdMs: Number.isFinite(+p.holdMs) ? +p.holdMs : 0,
        stack: Array.isArray(p.stack) ? p.stack.map(String).slice(0, 32) : [],
        ts: Number.isFinite(+p.ts) ? +p.ts : Date.now(),
      };
      store.push(ev);
      // Cap the per-user trace buffer.
      if (store.length > 5000) store.splice(0, store.length - 5000);
      saveLockState();
      return { ok: true, result: { recorded: ev, totalEvents: store.length } };
    } catch (e) {
      return { ok: false, error: e?.message || "recordLockEvent failed" };
    }
  });

  /**
   * clearLockTrace — empties the per-user lock-trace buffer.
   */
  registerLensAction("lock", "clearLockTrace", (ctx) => {
    try {
      const ls = getLockState();
      if (ls) ls.traces.set(uidOf(ctx), []);
      saveLockState();
      return { ok: true, result: { cleared: true } };
    } catch (e) {
      return { ok: false, error: e?.message || "clearLockTrace failed" };
    }
  });

  /**
   * holdTimeline  [M]
   * Live lock-hold timeline — reconstruct hold spans from the recorded
   * acquire→release trace so the UI can draw which thread held which
   * lock when. Falls back to artifact.data.trace if no stored trace.
   */
  registerLensAction("lock", "holdTimeline", (ctx, artifact, params) => {
    try {
      const stored = tracesFor(ctx);
      const supplied = Array.isArray(artifact?.data?.trace) ? artifact.data.trace : [];
      const events = (supplied.length > 0 ? supplied : stored)
        .slice()
        .sort((a, b) => (a.ts || 0) - (b.ts || 0));
      if (events.length === 0) {
        return { ok: true, result: { spans: [], lanes: [], message: "No lock trace recorded yet." } };
      }

      // Pair acquire→release per (thread, lock). Open acquires without a
      // matching release are treated as still-held to end-of-window.
      const open = new Map(); // `${thread}|${lock}` -> acquire event
      const spans = [];
      let lastTs = events[0].ts || 0;
      const waitSpans = [];
      for (const ev of events) {
        lastTs = Math.max(lastTs, ev.ts || 0);
        const key = `${ev.thread}|${ev.lock}`;
        if (ev.action === "acquire") {
          open.set(key, ev);
        } else if (ev.action === "release") {
          const acq = open.get(key);
          if (acq) {
            spans.push({
              thread: acq.thread, lock: acq.lock,
              start: acq.ts, end: ev.ts,
              durationMs: Math.max(0, (ev.ts || 0) - (acq.ts || 0)),
              closed: true,
            });
            open.delete(key);
          }
        } else if (ev.action === "wait") {
          waitSpans.push({
            thread: ev.thread, lock: ev.lock,
            start: ev.ts, end: (ev.ts || 0) + (ev.waitMs || 0),
            durationMs: ev.waitMs || 0,
          });
        }
      }
      for (const [, acq] of open) {
        spans.push({
          thread: acq.thread, lock: acq.lock,
          start: acq.ts, end: lastTs,
          durationMs: Math.max(0, lastTs - (acq.ts || 0)),
          closed: false,
        });
      }

      const lanes = [...new Set(events.map((e) => e.thread))].sort();
      const locks = [...new Set(events.map((e) => e.lock))].sort();
      const windowStart = events[0].ts || 0;
      const totalHeld = spans.reduce((s, x) => s + x.durationMs, 0);

      return {
        ok: true,
        result: {
          spans: spans.sort((a, b) => (a.start || 0) - (b.start || 0)),
          waitSpans,
          lanes, locks,
          windowStart, windowEnd: lastTs,
          windowMs: Math.max(0, lastTs - windowStart),
          totalHeldMs: totalHeld,
          openSpans: spans.filter((s) => !s.closed).length,
          eventCount: events.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "holdTimeline failed" };
    }
  });

  /**
   * orderingAnalysis  [M]
   * Lock-ordering analysis — detect potential (not-yet-realized)
   * deadlock from inconsistent acquisition order. Builds a per-thread
   * lock-acquisition sequence, derives the global lock-precedence graph
   * and reports any cycle (A-before-B in one thread, B-before-A in
   * another) as a deadlock-prone ordering inversion.
   */
  registerLensAction("lock", "orderingAnalysis", (ctx, artifact, params) => {
    try {
      const stored = tracesFor(ctx);
      const supplied = Array.isArray(artifact?.data?.trace) ? artifact.data.trace : [];
      const events = (supplied.length > 0 ? supplied : stored)
        .slice()
        .sort((a, b) => (a.ts || 0) - (b.ts || 0));

      // Per-thread current set of held locks + the precedence pairs we
      // observe (held lock -> newly acquired lock).
      const held = new Map(); // thread -> ordered array of held locks
      const precedence = new Map(); // `${a}>${b}` -> { from, to, threads:Set }
      for (const ev of events) {
        if (!held.has(ev.thread)) held.set(ev.thread, []);
        const stack = held.get(ev.thread);
        if (ev.action === "acquire") {
          for (const prior of stack) {
            if (prior === ev.lock) continue;
            const key = `${prior}>${ev.lock}`;
            if (!precedence.has(key)) {
              precedence.set(key, { from: prior, to: ev.lock, threads: new Set() });
            }
            precedence.get(key).threads.add(ev.thread);
          }
          stack.push(ev.lock);
        } else if (ev.action === "release") {
          const idx = stack.lastIndexOf(ev.lock);
          if (idx >= 0) stack.splice(idx, 1);
        }
      }

      // Detect inversions: both A>B and B>A observed.
      const edges = [...precedence.values()].map((e) => ({
        from: e.from, to: e.to, threads: [...e.threads],
      }));
      const edgeSet = new Set(edges.map((e) => `${e.from}>${e.to}`));
      const inversions = [];
      const seenInv = new Set();
      for (const e of edges) {
        const rev = `${e.to}>${e.from}`;
        if (edgeSet.has(rev)) {
          const pairKey = [e.from, e.to].sort().join("::");
          if (seenInv.has(pairKey)) continue;
          seenInv.add(pairKey);
          const revEdge = edges.find((x) => x.from === e.to && x.to === e.from);
          inversions.push({
            lockA: e.from, lockB: e.to,
            forwardThreads: e.threads,
            reverseThreads: revEdge ? revEdge.threads : [],
            severity: "deadlock-prone",
          });
        }
      }

      // DFS cycle detection over the precedence graph (catches indirect
      // ordering cycles spanning >2 locks).
      const adj = {};
      const nodes = new Set();
      for (const e of edges) {
        nodes.add(e.from); nodes.add(e.to);
        (adj[e.from] = adj[e.from] || []).push(e.to);
      }
      const color = {}, parent = {}, cycles = [];
      for (const n of nodes) color[n] = 0;
      function dfs(n) {
        color[n] = 1;
        for (const m of adj[n] || []) {
          if (color[m] === 1) {
            const cyc = [m];
            let cur = n;
            while (cur !== m && cur != null) { cyc.push(cur); cur = parent[cur]; }
            cyc.reverse();
            cycles.push(cyc);
          } else if (color[m] === 0) {
            parent[m] = n; dfs(m);
          }
        }
        color[n] = 2;
      }
      for (const n of nodes) if (color[n] === 0) dfs(n);

      let riskLevel = "safe";
      if (cycles.length > 0 || inversions.length > 0) riskLevel = "high";
      else if (edges.length > 0) riskLevel = "low";

      return {
        ok: true,
        result: {
          riskLevel,
          inversions,
          orderingCycles: cycles,
          precedenceEdges: edges,
          lockCount: nodes.size,
          threadsAnalyzed: held.size,
          eventCount: events.length,
          summary: inversions.length > 0
            ? `${inversions.length} ordering inversion(s) — potential deadlock if both paths run concurrently.`
            : edges.length > 0
              ? "Consistent lock ordering observed across all threads."
              : "Not enough nested-lock data to analyze ordering.",
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "orderingAnalysis failed" };
    }
  });

  /**
   * hotspotRanking  [S]
   * Contention hotspot ranking — rank locks by total wait time across
   * the recorded trace (waiters who lost the race + accumulated wait).
   */
  registerLensAction("lock", "hotspotRanking", (ctx, artifact, params) => {
    try {
      const stored = tracesFor(ctx);
      const supplied = Array.isArray(artifact?.data?.trace) ? artifact.data.trace : [];
      const events = supplied.length > 0 ? supplied : stored;
      if (events.length === 0) {
        return { ok: true, result: { hotspots: [], message: "No lock trace recorded yet." } };
      }

      const byLock = new Map();
      for (const ev of events) {
        if (!byLock.has(ev.lock)) {
          byLock.set(ev.lock, {
            lock: ev.lock, totalWaitMs: 0, totalHoldMs: 0,
            waitCount: 0, acquireCount: 0, waiters: new Set(), peakWaitMs: 0,
          });
        }
        const s = byLock.get(ev.lock);
        if (ev.action === "wait") {
          s.totalWaitMs += ev.waitMs || 0;
          s.waitCount++;
          s.waiters.add(ev.thread);
          s.peakWaitMs = Math.max(s.peakWaitMs, ev.waitMs || 0);
        } else if (ev.action === "acquire") {
          s.acquireCount++;
          s.totalHoldMs += ev.holdMs || 0;
        }
      }

      const grandWait = [...byLock.values()].reduce((s, x) => s + x.totalWaitMs, 0) || 1;
      const hotspots = [...byLock.values()]
        .map((s) => ({
          lock: s.lock,
          totalWaitMs: s.totalWaitMs,
          totalHoldMs: s.totalHoldMs,
          waitCount: s.waitCount,
          acquireCount: s.acquireCount,
          uniqueWaiters: s.waiters.size,
          peakWaitMs: s.peakWaitMs,
          avgWaitMs: s.waitCount > 0 ? Math.round((s.totalWaitMs / s.waitCount) * 100) / 100 : 0,
          waitShare: Math.round((s.totalWaitMs / grandWait) * 10000) / 100,
        }))
        .sort((a, b) => b.totalWaitMs - a.totalWaitMs)
        .map((h, i) => ({ rank: i + 1, ...h }));

      return {
        ok: true,
        result: {
          hotspots,
          worst: hotspots[0] || null,
          totalWaitMs: grandWait === 1 && hotspots.length === 0 ? 0 : grandWait,
          lockCount: hotspots.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "hotspotRanking failed" };
    }
  });

  /**
   * blameAttribution  [S]
   * Lock-acquisition stack traces / blame attribution — aggregate the
   * captured call-stacks per lock and attribute contention wait to the
   * acquisition site (top frame) responsible for it.
   */
  registerLensAction("lock", "blameAttribution", (ctx, artifact, params) => {
    try {
      const stored = tracesFor(ctx);
      const supplied = Array.isArray(artifact?.data?.trace) ? artifact.data.trace : [];
      const events = supplied.length > 0 ? supplied : stored;
      const withStacks = events.filter((e) => Array.isArray(e.stack) && e.stack.length > 0);
      if (withStacks.length === 0) {
        return {
          ok: true,
          result: { sites: [], message: "No stack traces captured. Record lock events with a stack array." },
        };
      }

      const bySite = new Map(); // top-frame -> blame record
      for (const ev of withStacks) {
        const site = ev.stack[0];
        if (!bySite.has(site)) {
          bySite.set(site, {
            site, fullStack: ev.stack.slice(0, 8),
            acquireCount: 0, waitCount: 0,
            totalWaitMs: 0, totalHoldMs: 0,
            locks: new Set(), threads: new Set(),
          });
        }
        const s = bySite.get(site);
        s.locks.add(ev.lock);
        s.threads.add(ev.thread);
        if (ev.action === "acquire") { s.acquireCount++; s.totalHoldMs += ev.holdMs || 0; }
        if (ev.action === "wait") { s.waitCount++; s.totalWaitMs += ev.waitMs || 0; }
      }

      const sites = [...bySite.values()]
        .map((s) => ({
          site: s.site,
          fullStack: s.fullStack,
          acquireCount: s.acquireCount,
          waitCount: s.waitCount,
          totalWaitMs: s.totalWaitMs,
          totalHoldMs: s.totalHoldMs,
          blameMs: s.totalWaitMs + s.totalHoldMs,
          locks: [...s.locks],
          threads: [...s.threads],
        }))
        .sort((a, b) => b.blameMs - a.blameMs)
        .map((s, i) => ({ rank: i + 1, ...s }));

      return {
        ok: true,
        result: {
          sites,
          topOffender: sites[0] || null,
          stackedEvents: withStacks.length,
          uncapturedEvents: events.length - withStacks.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "blameAttribution failed" };
    }
  });

  /**
   * amdahlProjection  [M]
   * Throughput-under-contention modeling / Amdahl projection.
   * Estimates the serial fraction from observed lock contention, then
   * projects speedup and throughput across processor counts using
   * Amdahl's law  S(n) = 1 / (f + (1-f)/n)  and the Universal
   * Scalability Law (USL) which also penalizes coherency cost.
   * params: { serialFraction?, coherency?, maxProcessors?, baseThroughput? }
   */
  registerLensAction("lock", "amdahlProjection", (ctx, artifact, params) => {
    try {
      const p = params || {};
      // Derive a serial fraction from the recorded trace if not supplied:
      // serial ≈ heldTime / wallClock (time the system spent under a lock).
      let f = Number.isFinite(+p.serialFraction) ? +p.serialFraction : null;
      let derivedFrom = "supplied";
      if (f == null) {
        const stored = tracesFor(ctx);
        const supplied = Array.isArray(artifact?.data?.trace) ? artifact.data.trace : [];
        const events = supplied.length > 0 ? supplied : stored;
        if (events.length > 0) {
          const sorted = events.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
          const wall = Math.max(1, (sorted[sorted.length - 1].ts || 0) - (sorted[0].ts || 0));
          const held = events.reduce((s, e) => s + (e.action === "acquire" ? (e.holdMs || 0) : 0), 0);
          const waited = events.reduce((s, e) => s + (e.action === "wait" ? (e.waitMs || 0) : 0), 0);
          f = Math.min(0.99, Math.max(0.001, (held + waited) / (wall + waited)));
          derivedFrom = "trace";
        } else {
          f = 0.1;
          derivedFrom = "default";
        }
      }
      f = Math.min(0.999, Math.max(0, f));

      const coherency = Math.min(0.5, Math.max(0, Number.isFinite(+p.coherency) ? +p.coherency : 0.01));
      const maxN = Math.min(256, Math.max(2, Math.round(+p.maxProcessors || 64)));
      const baseTput = Math.max(1, Number.isFinite(+p.baseThroughput) ? +p.baseThroughput : 1000);

      const curve = [];
      let peakUslN = 1, peakUslSpeedup = 1;
      const counts = [1, 2, 4, 8, 16, 32, 64, 128, 256].filter((n) => n <= maxN);
      if (!counts.includes(maxN)) counts.push(maxN);
      for (const n of counts.sort((a, b) => a - b)) {
        // Amdahl: ignores coherency cost.
        const amdahl = 1 / (f + (1 - f) / n);
        // USL: contention (serial) + coherency (n*(n-1) cost).
        const usl = n / (1 + f * (n - 1) + coherency * n * (n - 1));
        if (usl > peakUslSpeedup) { peakUslSpeedup = usl; peakUslN = n; }
        curve.push({
          processors: n,
          amdahlSpeedup: Math.round(amdahl * 1000) / 1000,
          uslSpeedup: Math.round(usl * 1000) / 1000,
          amdahlThroughput: Math.round(amdahl * baseTput),
          uslThroughput: Math.round(usl * baseTput),
          efficiency: Math.round((usl / n) * 1000) / 1000,
        });
      }

      const amdahlCeiling = f > 0 ? Math.round((1 / f) * 100) / 100 : Infinity;

      return {
        ok: true,
        result: {
          serialFraction: Math.round(f * 10000) / 10000,
          serialFractionSource: derivedFrom,
          coherencyCost: coherency,
          baseThroughput: baseTput,
          amdahlCeiling: amdahlCeiling === Infinity ? "unbounded" : amdahlCeiling,
          uslPeak: { processors: peakUslN, speedup: Math.round(peakUslSpeedup * 1000) / 1000 },
          curve,
          verdict: f > 0.5
            ? "Severe serialization — adding cores yields little; reduce lock-held time."
            : f > 0.2
              ? "Moderate contention — scalability flattens past the USL peak."
              : "Low contention — scales near-linearly until coherency cost dominates.",
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "amdahlProjection failed" };
    }
  });
}
