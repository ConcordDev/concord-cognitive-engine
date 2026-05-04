/**
 * LLM Priority Queue
 *
 * Wraps all LLM calls (Ollama brains) behind a bounded priority queue.
 * User-facing requests take priority over background tasks (autogen, etc.).
 *
 * Priority levels (lower = higher priority):
 *   0 — CRITICAL: user-facing chat / ask responses
 *   1 — HIGH:     user-initiated lens/CRETI generation
 *   2 — NORMAL:   emergent dialogue sessions
 *   3 — LOW:      autogen pipeline, background enrichment
 *
 * Features:
 *   - Configurable concurrency cap (defaults to 2)
 *   - Queue depth limit with rejection for low-priority overflow
 *   - Per-priority metrics (queued, inflight, completed, rejected, avg latency)
 *   - Drain support for graceful shutdown
 */

export const PRIORITY = Object.freeze({
  CRITICAL: 0,
  HIGH:     1,
  NORMAL:   2,
  LOW:      3,
});

const PRIORITY_LABELS = ["critical", "high", "normal", "low"];

/**
 * Create an LLM queue instance.
 *
 * @param {Object} opts
 * @param {number} [opts.concurrency=2] - Max inflight LLM calls
 * @param {number} [opts.maxQueueDepth=200] - Max pending items; LOW priority rejected first
 * @param {Function} [opts.onReject] - Called when a request is rejected (priority, reason)
 * @returns {LLMQueue}
 */
export function createLLMQueue(opts = {}) {
  // Bumped default 2 → 32 for 32GB / RTX PRO 4500 deployments. The hard
  // ceiling is whatever Ollama can chew through (OLLAMA_NUM_PARALLEL).
  const concurrency = opts.concurrency || parseInt(process.env.LLM_CONCURRENCY || "32", 10);
  // Bumped default 200 → 1000 for 32GB-heap deployments. Override via opts
  // or env CONCORD_LLM_QUEUE_DEPTH.
  const maxQueueDepth = opts.maxQueueDepth || Number(process.env.CONCORD_LLM_QUEUE_DEPTH) || 1000;
  const onReject = opts.onReject || (() => {});

  // Priority buckets: array of arrays, index = priority level
  const buckets = [[], [], [], []];  // CRITICAL, HIGH, NORMAL, LOW
  let inflight = 0;
  let draining = false;

  const metrics = {
    enqueued:   [0, 0, 0, 0],
    completed:  [0, 0, 0, 0],
    rejected:   [0, 0, 0, 0],
    errors:     [0, 0, 0, 0],
    totalLatencyMs: [0, 0, 0, 0],
  };

  function totalQueued() {
    return buckets[0].length + buckets[1].length + buckets[2].length + buckets[3].length;
  }

  /**
   * Dequeue next item by priority order.
   */
  function dequeue() {
    for (let p = 0; p < buckets.length; p++) {
      if (buckets[p].length > 0) return buckets[p].shift();
    }
    return null;
  }

  /**
   * Process the queue — called when a slot opens.
   */
  function pump() {
    while (inflight < concurrency) {
      const item = dequeue();
      if (!item) break;

      inflight++;
      const start = Date.now();

      Promise.resolve()
        .then(() => item.fn())
        .then(result => {
          metrics.completed[item.priority]++;
          metrics.totalLatencyMs[item.priority] += Date.now() - start;
          item.resolve(result);
        })
        .catch(err => {
          metrics.errors[item.priority]++;
          metrics.totalLatencyMs[item.priority] += Date.now() - start;
          item.reject(err);
        })
        .finally(() => {
          inflight--;
          pump();
        });
    }
  }

  /**
   * Enqueue an LLM call.
   *
   * @param {Function} fn - Async function that performs the LLM call
   * @param {number} [priority=PRIORITY.NORMAL] - Priority level
   * @returns {Promise<*>} Resolves with the LLM call result
   */
  function enqueue(fn, priority = PRIORITY.NORMAL) {
    if (draining) {
      return Promise.reject(new Error("llm_queue_draining"));
    }

    const p = Math.max(0, Math.min(3, priority));

    // Check queue depth — shed LOW first, then NORMAL
    if (totalQueued() >= maxQueueDepth) {
      // Try shedding from lowest priority bucket
      for (let shed = 3; shed > p; shed--) {
        if (buckets[shed].length > 0) {
          const dropped = buckets[shed].pop();
          metrics.rejected[shed]++;
          dropped.reject(new Error("llm_queue_shed"));
          onReject(shed, "queue_full_shed");
          break;
        }
      }
      // If still full and this is LOW priority, reject it
      if (totalQueued() >= maxQueueDepth && p >= PRIORITY.LOW) {
        metrics.rejected[p]++;
        onReject(p, "queue_full");
        return Promise.reject(new Error("llm_queue_full"));
      }
    }

    return new Promise((resolve, reject) => {
      const item = { fn, priority: p, resolve, reject, enqueuedAt: Date.now() };
      buckets[p].push(item);
      metrics.enqueued[p]++;
      pump();
    });
  }

  /**
   * Wrap an existing LLM call function to go through the queue.
   *
   * @param {Function} callFn - Original LLM function (e.g., callOllama)
   * @param {number} [defaultPriority=PRIORITY.NORMAL]
   * @returns {Function} Queued version of the function
   */
  function wrap(callFn, defaultPriority = PRIORITY.NORMAL) {
    return function queuedCall(...args) {
      // Check if last arg is an options object with _priority
      const lastArg = args[args.length - 1];
      const priority = (lastArg && typeof lastArg === "object" && lastArg._priority !== undefined)
        ? lastArg._priority
        : defaultPriority;
      return enqueue(() => callFn(...args), priority);
    };
  }

  /**
   * Get queue metrics.
   */
  function getMetrics() {
    const result = {
      concurrency,
      maxQueueDepth,
      inflight,
      totalQueued: totalQueued(),
      draining,
      byPriority: {},
    };
    for (let p = 0; p < 4; p++) {
      const completed = metrics.completed[p] + metrics.errors[p];
      result.byPriority[PRIORITY_LABELS[p]] = {
        queued: buckets[p].length,
        enqueued: metrics.enqueued[p],
        completed: metrics.completed[p],
        errors: metrics.errors[p],
        rejected: metrics.rejected[p],
        avgLatencyMs: completed > 0 ? Math.round(metrics.totalLatencyMs[p] / completed) : 0,
      };
    }
    return result;
  }

  /**
   * Start draining — no new items accepted, wait for inflight to finish.
   * @returns {Promise<void>}
   */
  function drain() {
    draining = true;
    // Reject all queued items
    for (let p = 0; p < 4; p++) {
      while (buckets[p].length > 0) {
        const item = buckets[p].shift();
        metrics.rejected[p]++;
        item.reject(new Error("llm_queue_draining"));
      }
    }
    return new Promise(resolve => {
      const check = () => {
        if (inflight === 0) return resolve();
        setTimeout(check, 50);
      };
      check();
    });
  }

  /**
   * Get queue pressure as a 0-1 float.
   * 0 = empty, 0.75 = start shedding LOW, 0.9 = shed LOW+NORMAL, 1.0 = full.
   */
  function queuePressure() {
    return totalQueued() / maxQueueDepth;
  }

  /**
   * Proactive pressure-based rejection (call before enqueue for early shedding).
   * @param {number} priority
   * @returns {{ allowed: boolean, reason?: string }}
   */
  function checkPressure(priority) {
    const pressure = queuePressure();
    // At 75%+ depth, reject LOW priority
    if (pressure >= 0.75 && priority >= PRIORITY.LOW) {
      return { allowed: false, reason: "queue_pressure_high" };
    }
    // At 90%+ depth, reject LOW + NORMAL
    if (pressure >= 0.90 && priority >= PRIORITY.NORMAL) {
      return { allowed: false, reason: "queue_pressure_critical" };
    }
    return { allowed: true };
  }

  /**
   * Estimate where a freshly-enqueued request would land in the queue
   * + how long it would wait. Used for queue-aware UX so the chat UI
   * can render "You're #4 in queue, ~18s wait" instead of staring at
   * a silent spinner under load.
   *
   * @param {number} [priority=PRIORITY.NORMAL]
   * @returns {{ position: number, estimatedWaitMs: number, pressure: number, inflight: number }}
   */
  function estimatePosition(priority = PRIORITY.NORMAL) {
    // Position counts items ahead of this one in the same or higher
    // priority bucket — lower numeric priority drains first, so a
    // NORMAL request is held behind every CRITICAL + HIGH item.
    let ahead = 0;
    for (let p = 0; p <= priority; p++) {
      ahead += buckets[p].length;
    }
    const completedAcross = metrics.completed.reduce((s, n) => s + n, 0);
    const totalLatency = metrics.totalLatencyMs.reduce((s, n) => s + n, 0);
    const avgLatencyMs = completedAcross > 0
      ? Math.round(totalLatency / completedAcross)
      : 2000; // sensible default before any sample lands
    // Effective throughput = concurrency × (1000 / avgLatency) requests/sec.
    // Wait time = (ahead + inflight) / concurrency × avgLatency.
    const estimatedWaitMs = Math.max(
      0,
      Math.round(((ahead + inflight) / Math.max(1, concurrency)) * avgLatencyMs)
    );
    return {
      position: ahead + 1,
      estimatedWaitMs,
      pressure: queuePressure(),
      inflight,
    };
  }

  return { enqueue, wrap, getMetrics, drain, queuePressure, checkPressure, estimatePosition, PRIORITY };
}
