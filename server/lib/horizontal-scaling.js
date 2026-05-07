// lib/horizontal-scaling.js
// Auto-scale via RunPod API when load exceeds thresholds.
// Monitors event loop lag, queue depth, and response times.

import { appendFileSync } from "fs";

// ── State ──────────────────────────────────────────────────────────────────

let _overflow = null;
let _metricsBuffer = [];
const _METRICS_MAX = 300; // keep last 5 min at 1/s

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || "";
const OVERFLOW_POD_TEMPLATE_ID = process.env.OVERFLOW_POD_TEMPLATE_ID || "";
const DATA_DIR = process.env.DATA_DIR || "/workspace/concord-data";

// ── Metric Counters (updated externally) ───────────────────────────────────

let _activeChatCount = 0;
let _avgResponseMs = 0;
let _pendingRequests = 0;
let _ollamaQueueDepth = 0;

export function updateChatCount(n) { _activeChatCount = n; }
export function updateAvgResponseMs(ms) { _avgResponseMs = ms; }
export function updatePendingRequests(n) { _pendingRequests = n; }
export function updateOllamaQueueDepth(n) { _ollamaQueueDepth = n; }

// ── Event Loop Lag ─────────────────────────────────────────────────────────

let _eventLoopLag = 0;
let _lagCheckTime = Date.now();

function measureEventLoopLag() {
  const now = Date.now();
  const expected = 1000; // check every ~1s
  const actual = now - _lagCheckTime;
  _eventLoopLag = Math.max(0, actual - expected);
  _lagCheckTime = now;
}

// ── Load Metrics ───────────────────────────────────────────────────────────

export function recordLoadMetrics(structuredLog) {
  measureEventLoopLag();

  const mem = process.memoryUsage();
  const metrics = {
    timestamp: Date.now(),
    concurrentChats: _activeChatCount,
    avgResponseMs: _avgResponseMs,
    pendingRequests: _pendingRequests,
    cpuPercent: 0, // process.cpuUsage() returns cumulative, not percent
    memRss: mem.rss,
    memHeapUsed: mem.heapUsed,
    eventLoopLag: _eventLoopLag,
    ollamaQueueDepth: _ollamaQueueDepth,
  };

  _metricsBuffer.push(metrics);
  if (_metricsBuffer.length > _METRICS_MAX) {
    _metricsBuffer = _metricsBuffer.slice(-_METRICS_MAX);
  }

  // Persist to JSONL for external analysis
  try {
    appendFileSync(
      `${DATA_DIR}/load-metrics.jsonl`,
      JSON.stringify(metrics) + "\n",
    );
  } catch {
    // best-effort — data dir may not exist
  }

  return metrics;
}

// ── Scale Decision ─────────────────────────────────────────────────────────

function getRecentMetrics(minutes = 5) {
  const cutoff = Date.now() - minutes * 60 * 1000;
  return _metricsBuffer.filter(m => m.timestamp > cutoff);
}

function avg(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export async function scaleCheck(structuredLog) {
  const recent = getRecentMetrics(5);
  if (recent.length === 0) return { action: "none", reason: "no_metrics" };

  const avgQueue = avg(recent.map(m => m.pendingRequests));
  const avgResponse = avg(recent.map(m => m.avgResponseMs));
  const avgLag = avg(recent.map(m => m.eventLoopLag));

  // Scale UP conditions (any one triggers)
  const needsScale =
    avgQueue > 10 ||           // requests backing up
    avgResponse > 10000 ||     // 10s+ response times
    avgLag > 500;              // event loop lagging 500ms+

  // Scale DOWN conditions (all must be true)
  const canScaleDown =
    avgQueue === 0 &&
    avgResponse < 3000 &&
    avgLag < 50 &&
    _overflow &&
    (Date.now() - _overflow.startedAt) > 30 * 60 * 1000; // up for 30+ min

  if (needsScale && !_overflow) {
    const result = await startOverflowPod();
    if (structuredLog) {
      structuredLog("info", "scale_up", { avgQueue, avgResponse, avgLag, result: result.ok });
    }
    return { action: "scale_up", avgQueue, avgResponse, avgLag };
  }

  if (canScaleDown && _overflow) {
    const result = await stopOverflowPod();
    if (structuredLog) {
      structuredLog("info", "scale_down", { avgQueue, avgResponse, avgLag, result: result.ok });
    }
    return { action: "scale_down", avgQueue, avgResponse, avgLag };
  }

  return { action: "none", avgQueue, avgResponse, avgLag };
}

// ── RunPod API Integration ─────────────────────────────────────────────────

async function startOverflowPod() {
  if (!RUNPOD_API_KEY) {
    return { ok: false, error: "runpod_api_key_not_set" };
  }

  try {
    const response = await fetch("https://api.runpod.io/v2/pods", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "concord-overflow",
        imageName: "ollama/ollama",
        gpuTypeId: "NVIDIA RTX PRO 4500",
        volumeInGb: 0,
        containerDiskInGb: 20,
        env: {
          OLLAMA_MODELS: "concord-conscious",
          CONCORD_OVERFLOW: "true",
        },
        ...(OVERFLOW_POD_TEMPLATE_ID ? { templateId: OVERFLOW_POD_TEMPLATE_ID } : {}),
      }),
    });

    const data = await response.json();
    _overflow = {
      podId: data.id,
      startedAt: Date.now(),
      endpoint: data.runtime?.ports || null,
    };

    return { ok: true, podId: data.id };
  } catch (err) {
    console.error("[scaling] start_overflow_failed:", err.message);
    return { ok: false, error: err.message };
  }
}

async function stopOverflowPod() {
  if (!_overflow?.podId) return { ok: false, error: "no_overflow_pod" };
  if (!RUNPOD_API_KEY) return { ok: false, error: "runpod_api_key_not_set" };

  try {
    await fetch(`https://api.runpod.io/v2/pods/${_overflow.podId}/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
    });

    const podId = _overflow.podId;
    _overflow = null;
    return { ok: true, podId };
  } catch (err) {
    console.error("[scaling] stop_overflow_failed:", err.message);
    return { ok: false, error: err.message };
  }
}

// ── Request Routing ────────────────────────────────────────────────────────

/**
 * Route a chat request: if overflow pod is active and local queue is deep,
 * forward to the overflow pod.
 */
export function shouldRouteToOverflow(localQueueDepth = 0) {
  return !!(_overflow?.endpoint && localQueueDepth > 5);
}

export function getOverflowEndpoint() {
  return _overflow?.endpoint || null;
}

export function getOverflowStatus() {
  if (!_overflow) return { active: false };
  return {
    active: true,
    podId: _overflow.podId,
    startedAt: _overflow.startedAt,
    uptimeMs: Date.now() - _overflow.startedAt,
    endpoint: _overflow.endpoint,
  };
}

// ── Status API ─────────────────────────────────────────────────────────────

export function getScalingStatus() {
  const recent = getRecentMetrics(5);
  return {
    overflow: getOverflowStatus(),
    metrics: {
      bufferSize: _metricsBuffer.length,
      recentCount: recent.length,
      current: _metricsBuffer[_metricsBuffer.length - 1] || null,
    },
    config: {
      runpodConfigured: Boolean(RUNPOD_API_KEY),
      templateId: OVERFLOW_POD_TEMPLATE_ID || null,
    },
  };
}
