/**
 * NPC / emergent / ambient prompt coalescer + adaptive backoff.
 *
 * Problem: background NPC/emergent/lore ticks hammer the same Mac-local 2B
 * Ollama lane as interactive chat (ConKay, player actions), filling
 * `_llmQueue` / Ollama slots and blocking the platform.
 *
 * This broker:
 *   1) Coalesces identical (env fingerprint + intent hash) generates inside a
 *      sliding window (~500ms default) onto ONE shared upstream promise.
 *   2) Caps background inflight (1–2) so ambient work cannot stampede.
 *   3) Tracks generate latency + queue depth; when p50/p95 or lag crosses
 *      threshold, pauses/skips non-critical background ticks.
 *   4) Never starves interactive — chat/ConKay/player callers bypass backoff
 *      and ride CRITICAL on the shared `_llmQueue` when bound.
 *
 * Thresholds chosen for Mac 2B (documented):
 *   - CONCORD_NPC_BACKOFF_P50_MS=500  (250ms is too tight on 2B cold/warm)
 *   - CONCORD_NPC_BACKOFF_P95_MS=2500
 *   - CONCORD_NPC_COALESCE_MS=500
 *   - CONCORD_NPC_MAX_INFLIGHT=2
 * Kill-switch: CONCORD_NPC_COALESCE=0
 *
 * Integrates with existing llm-queue.js via bindNpcCoalescerQueue() —
 * does NOT create a third parallel storm.
 */

import crypto from "node:crypto";
import { PRIORITY } from "./llm-queue.js";
import { getCurrentLagMs } from "./event-loop-pressure.js";

// ── Config (read live so tests can flip env mid-suite) ──────────────────────

export function getNpcCoalesceConfig() {
  const enabledRaw = process.env.CONCORD_NPC_COALESCE;
  // Default ON for background paths. Explicit "0"/"false"/"off" kills it.
  const enabled = !(
    enabledRaw === "0" ||
    enabledRaw === "false" ||
    enabledRaw === "off"
  );
  return {
    enabled,
    windowMs: Math.max(0, Number(process.env.CONCORD_NPC_COALESCE_MS ?? 500) || 500),
    maxInflight: Math.max(1, Number(process.env.CONCORD_NPC_MAX_INFLIGHT ?? 2) || 2),
    // 500ms p50 — 250ms was too tight on Mac 2B under even mild load.
    backoffP50Ms: Math.max(50, Number(process.env.CONCORD_NPC_BACKOFF_P50_MS ?? 500) || 500),
    backoffP95Ms: Math.max(100, Number(process.env.CONCORD_NPC_BACKOFF_P95_MS ?? 2500) || 2500),
    backoffQueueDepth: Math.max(1, Number(process.env.CONCORD_NPC_BACKOFF_QUEUE_DEPTH ?? 8) || 8),
    backoffLagMs: Math.max(50, Number(process.env.CONCORD_NPC_BACKOFF_LAG_MS ?? 250) || 250),
  };
}

/** CallerIds treated as interactive — never back off / never coalesce-skip. */
const INTERACTIVE_PREFIXES = [
  "chat",
  "chat-conscious",
  "conscious-chat",
  "conkay",
  "player",
  "interactive",
];

/** CallerIds treated as background NPC/emergent/ambient (default ON coalesce). */
const BACKGROUND_PREFIXES = [
  "world:npc",
  "world:emergent",
  "world:faction",
  "world:quest",
  "world:spawn",
  "world:substrate",
  "ambient",
  "lore",
  "district",
  "npc:",
  "emergent:",
  "autogen",
  "heartbeat",
];

// ── State ───────────────────────────────────────────────────────────────────

/** @type {Map<string, { promise: Promise<any>, createdAt: number }>} */
const _window = new Map();

let _inflight = 0;
/** @type {Array<() => void>} */
const _waiters = [];

/** @type {null | ((fn: Function, priority?: number) => Promise<any>)} */
let _enqueue = null;
/** @type {null | { getMetrics?: Function, PRIORITY?: object }} */
let _queueRef = null;

/** Ring buffer of recent background generate latencies (ms). */
const _latencies = [];
const LAT_CAP = 64;

const metrics = {
  upstream: 0,
  coalesced: 0,
  skippedBackoff: 0,
  interactiveBypass: 0,
  errors: 0,
  disabledPassthrough: 0,
};

// ── Bind shared LLM queue (call once from server.js after createLLMQueue) ──

/**
 * Bind the process-wide `_llmQueue` so background generates enqueue at LOW
 * and interactive bypasses enqueue at CRITICAL. Idempotent.
 * @param {{ enqueue: Function, getMetrics?: Function, PRIORITY?: object }} queue
 */
export function bindNpcCoalescerQueue(queue) {
  if (!queue || typeof queue.enqueue !== "function") {
    throw new Error("bindNpcCoalescerQueue: queue.enqueue required");
  }
  _queueRef = queue;
  _enqueue = (fn, priority) => queue.enqueue(fn, priority);
}

/** Test helper — clear binds + state between cases. */
export function _resetNpcCoalescerForTest() {
  _window.clear();
  _inflight = 0;
  _waiters.length = 0;
  _enqueue = null;
  _queueRef = null;
  _latencies.length = 0;
  metrics.upstream = 0;
  metrics.coalesced = 0;
  metrics.skippedBackoff = 0;
  metrics.interactiveBypass = 0;
  metrics.errors = 0;
  metrics.disabledPassthrough = 0;
}

// ── Classification ──────────────────────────────────────────────────────────

export function isInteractiveCaller(callerId = "") {
  const id = String(callerId || "").toLowerCase();
  if (!id) return false;
  return INTERACTIVE_PREFIXES.some((p) => id === p || id.startsWith(p));
}

export function isBackgroundCaller(callerId = "") {
  const id = String(callerId || "").toLowerCase();
  if (!id) return true; // unmarked generate() from NPC path → treat as background
  if (isInteractiveCaller(id)) return false;
  return BACKGROUND_PREFIXES.some((p) => id === p || id.startsWith(p));
}

export function hashIntent(prompt, intentKey) {
  const src = intentKey != null && intentKey !== ""
    ? String(intentKey)
    : String(prompt ?? "").slice(0, 768);
  return crypto.createHash("sha256").update(src).digest("hex").slice(0, 16);
}

export function makeCoalesceKey(envFingerprint, intentHash) {
  return `${envFingerprint || ""}::${intentHash}`;
}

// ── Latency / backoff ───────────────────────────────────────────────────────

function recordLatency(ms) {
  _latencies.push(ms);
  if (_latencies.length > LAT_CAP) _latencies.shift();
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function getLatencyStats() {
  if (!_latencies.length) {
    return { count: 0, p50: 0, p95: 0, max: 0 };
  }
  const sorted = [..._latencies].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
  };
}

/**
 * Should non-critical NPC/emergent work pause this tick?
 * Interactive callers must NEVER consult this to block themselves.
 *
 * Thresholds (defaults): p50≥500ms OR p95≥2500ms OR background inflight
 * queue/depth pressure OR event-loop lag≥250ms OR bound llm-queue depth high.
 */
export function shouldBackoffBackground() {
  const cfg = getNpcCoalesceConfig();
  const stats = getLatencyStats();
  const lagMs = (() => {
    try { return Number(getCurrentLagMs()) || 0; } catch { return 0; }
  })();

  let queueDepth = _inflight + _waiters.length;
  let llmQueued = 0;
  try {
    const m = _queueRef?.getMetrics?.();
    if (m) {
      llmQueued = Number(m.totalQueued) || 0;
      // Prefer low+normal queued as "background pileup" signal
      const by = m.byPriority || {};
      const lowQ = Number(by.low?.queued) || 0;
      const normalQ = Number(by.normal?.queued) || 0;
      queueDepth = Math.max(queueDepth, lowQ + normalQ);
    }
  } catch { /* metrics best-effort */ }

  if (stats.count >= 4 && stats.p50 >= cfg.backoffP50Ms) {
    return { backoff: true, reason: "p50", p50: stats.p50, threshold: cfg.backoffP50Ms };
  }
  if (stats.count >= 4 && stats.p95 >= cfg.backoffP95Ms) {
    return { backoff: true, reason: "p95", p95: stats.p95, threshold: cfg.backoffP95Ms };
  }
  if (queueDepth >= cfg.backoffQueueDepth) {
    return { backoff: true, reason: "queue_depth", queueDepth, threshold: cfg.backoffQueueDepth };
  }
  if (llmQueued >= cfg.backoffQueueDepth * 2) {
    return { backoff: true, reason: "llm_queue_depth", llmQueued, threshold: cfg.backoffQueueDepth * 2 };
  }
  if (lagMs >= cfg.backoffLagMs) {
    return { backoff: true, reason: "event_loop_lag", lagMs, threshold: cfg.backoffLagMs };
  }
  return { backoff: false, reason: null, p50: stats.p50, p95: stats.p95, queueDepth, lagMs };
}

// ── Inflight slot (background lane cap) ─────────────────────────────────────

function acquireSlot(maxInflight) {
  if (_inflight < maxInflight) {
    _inflight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    _waiters.push(() => {
      _inflight++;
      resolve();
    });
  });
}

function releaseSlot() {
  _inflight = Math.max(0, _inflight - 1);
  const next = _waiters.shift();
  if (next) next();
}

// ── Public broker ───────────────────────────────────────────────────────────

/**
 * Route a generate through the coalescer / backoff / shared queue.
 *
 * @param {object} opts
 * @param {string|any} opts.prompt
 * @param {() => Promise<any>} opts.generateFn  actual upstream call
 * @param {string} [opts.envFingerprint]  worldId / district / model lane key
 * @param {string} [opts.intentKey]  stable intent; defaults to prompt slice hash
 * @param {string} [opts.callerId]
 * @param {boolean} [opts.interactive]  force interactive (CRITICAL, no skip)
 * @param {boolean} [opts.critical]     alias of interactive
 * @returns {Promise<any>} shared result for coalesced waiters; null when skipped
 */
export async function coalesceNpcPrompt(opts = {}) {
  const {
    prompt,
    generateFn,
    envFingerprint = "",
    intentKey,
    callerId = "",
    interactive = false,
    critical = false,
  } = opts;

  if (typeof generateFn !== "function") {
    throw new Error("coalesceNpcPrompt: generateFn required");
  }

  const cfg = getNpcCoalesceConfig();
  const forceInteractive = !!(interactive || critical || isInteractiveCaller(callerId));

  // ── Interactive: never starve — bypass coalesce + backoff ───────────────
  if (forceInteractive) {
    metrics.interactiveBypass++;
    if (_enqueue) {
      return _enqueue(generateFn, PRIORITY.CRITICAL);
    }
    return generateFn();
  }

  // Kill-switch / disabled: still prefer LOW on the shared queue when bound
  if (!cfg.enabled) {
    metrics.disabledPassthrough++;
    if (_enqueue) return _enqueue(generateFn, PRIORITY.LOW);
    return generateFn();
  }

  // Adaptive backoff — skip non-critical background under load
  const decision = shouldBackoffBackground();
  if (decision.backoff) {
    metrics.skippedBackoff++;
    return null;
  }

  const intentHash = hashIntent(prompt, intentKey);
  const key = makeCoalesceKey(envFingerprint, intentHash);
  const now = Date.now();

  const existing = _window.get(key);
  if (existing && now - existing.createdAt <= cfg.windowMs) {
    metrics.coalesced++;
    return existing.promise;
  }

  const promise = (async () => {
    await acquireSlot(cfg.maxInflight);
    const start = Date.now();
    try {
      const run = _enqueue
        ? () => _enqueue(generateFn, PRIORITY.LOW)
        : generateFn;
      return await run();
    } catch (err) {
      metrics.errors++;
      throw err;
    } finally {
      recordLatency(Date.now() - start);
      releaseSlot();
    }
  })();

  _window.set(key, { promise, createdAt: now });
  metrics.upstream++;

  // Drop window entry after settle + window (keep Map bounded)
  const clear = () => {
    const cur = _window.get(key);
    if (cur && cur.promise === promise) _window.delete(key);
  };
  promise.then(clear, clear);
  if (cfg.windowMs > 0) {
    const t = setTimeout(clear, cfg.windowMs + 100);
    t.unref?.();
  }

  return promise;
}

export function getNpcCoalescerMetrics() {
  const cfg = getNpcCoalesceConfig();
  const stats = getLatencyStats();
  const total = metrics.upstream + metrics.coalesced;
  return {
    ...metrics,
    coalesceRatio: total > 0 ? metrics.coalesced / total : 0,
    inflight: _inflight,
    waiters: _waiters.length,
    windowSize: _window.size,
    queueBound: !!_enqueue,
    latency: stats,
    backoff: shouldBackoffBackground(),
    config: cfg,
    thresholdsDocumented: {
      backoffP50Ms: cfg.backoffP50Ms,
      note: "500ms p50 chosen for Mac local 2B; 250ms too tight under warm load",
    },
  };
}

export { PRIORITY as NPC_QUEUE_PRIORITY };
