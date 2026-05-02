// server/lib/monitoring/slo.js
// Phase 12: Service Level Objectives for Concord.
// Defines targets, measurements, and error budgets.
// Wire into Prometheus metrics and alert rules.

import { addListener } from "../inference/tracer.js";

// ── SLO definitions ────────────────────────────────────────────────────────────

export const CONCORD_SLOS = Object.freeze({
  chat_response_latency: {
    id: "chat_response_latency",
    description: "Chat response — time to first response token",
    target: "p95 < 5000ms",
    targetMs: 5000,
    percentile: 95,
    errorBudgetPercent: 5,
    metricName: "concord_chat_latency_ms",
    labels: { service: "chat" },
  },
  inference_availability: {
    id: "inference_availability",
    description: "Inference calls that return successfully",
    target: "99.5% uptime",
    targetRate: 0.995,
    errorBudgetPercent: 0.5,
    metricName: "concord_inference_success_rate",
    labels: { service: "inference" },
  },
  refusal_gate_correctness: {
    id: "refusal_gate_correctness",
    description: "Known-harmful patterns blocked by governance gate",
    target: "100% block rate",
    targetRate: 1.0,
    errorBudgetPercent: 0,
    metricName: "concord_refusal_gate_block_rate",
    labels: { service: "governance" },
  },
  royalty_cascade_completion: {
    id: "royalty_cascade_completion",
    description: "Royalty cascade completes within 30s",
    target: "p99 < 30000ms",
    targetMs: 30000,
    percentile: 99,
    errorBudgetPercent: 1,
    metricName: "concord_royalty_cascade_latency_ms",
    labels: { service: "economy" },
  },
  voice_round_trip: {
    id: "voice_round_trip",
    description: "Voice session: input to output audio",
    target: "p95 < 700ms",
    targetMs: 700,
    percentile: 95,
    errorBudgetPercent: 5,
    metricName: "concord_voice_round_trip_ms",
    labels: { service: "voice" },
  },
  thread_checkpoint_write: {
    id: "thread_checkpoint_write",
    description: "Agent thread checkpoint write latency",
    target: "p99 < 500ms",
    targetMs: 500,
    percentile: 99,
    errorBudgetPercent: 1,
    metricName: "concord_thread_checkpoint_ms",
    labels: { service: "agents" },
  },
  sandbox_creation: {
    id: "sandbox_creation",
    description: "Sandbox workspace creation time",
    target: "p95 < 5000ms",
    targetMs: 5000,
    percentile: 95,
    errorBudgetPercent: 5,
    metricName: "concord_sandbox_creation_ms",
    labels: { service: "sandboxes" },
  },
});

// ── In-memory SLO tracker ─────────────────────────────────────────────────────

export class SLOTracker {
  constructor() {
    this._windows = new Map(); // sloId → circular buffer of { ts, value, ok }
    this._windowSize = 1000;   // samples kept in memory per SLO

    for (const id of Object.keys(CONCORD_SLOS)) {
      this._windows.set(id, []);
    }
  }

  record(sloId, value, ok) {
    if (!this._windows.has(sloId)) return;
    const buf = this._windows.get(sloId);
    buf.push({ ts: Date.now(), value, ok });
    if (buf.length > this._windowSize) buf.shift();
  }

  getStatus(sloId) {
    const slo = CONCORD_SLOS[sloId];
    if (!slo) return null;
    const buf = this._windows.get(sloId) || [];
    if (buf.length === 0) return { sloId, status: "no_data", slo };

    const total = buf.length;
    const good = buf.filter(s => s.ok).length;
    const successRate = good / total;

    // Latency percentile
    let p95 = null;
    if (slo.percentile) {
      const latencies = buf.map(s => s.value).sort((a, b) => a - b);
      const idx = Math.floor(latencies.length * (slo.percentile / 100));
      p95 = latencies[Math.min(idx, latencies.length - 1)];
    }

    const targetMet = slo.targetMs
      ? (p95 !== null ? p95 <= slo.targetMs : true)
      : successRate >= (slo.targetRate || 0.99);

    return {
      sloId,
      slo,
      samples: total,
      successRate: (successRate * 100).toFixed(2) + "%",
      p95LatencyMs: p95,
      targetMet,
      status: targetMet ? "ok" : "breached",
      errorBudgetConsumed: targetMet ? 0 : ((slo.errorBudgetPercent || 1) * (1 - successRate)).toFixed(2),
    };
  }

  getAllStatuses() {
    return Object.keys(CONCORD_SLOS).map(id => this.getStatus(id));
  }
}

export const sloTracker = new SLOTracker();

// ── Wire inference spans → SLO tracker ────────────────────────────────────────

let _wired = false;
export function wireInferenceToSLO() {
  if (_wired) return;
  _wired = true;

  addListener((span) => {
    if (span.type === "finish") {
      const latency = span.data?.latencyMs;
      if (latency !== undefined) {
        sloTracker.record("chat_response_latency", latency, latency <= CONCORD_SLOS.chat_response_latency.targetMs);
      }
      sloTracker.record("inference_availability", 1, true);
    }
    if (span.type === "failure") {
      sloTracker.record("inference_availability", 0, false);
    }
  });
}

// ── HTTP handler helper ───────────────────────────────────────────────────────

export function getSLODashboard() {
  const statuses = sloTracker.getAllStatuses();
  const breached = statuses.filter(s => s.status === "breached");
  return {
    ok: breached.length === 0,
    breachedCount: breached.length,
    slos: statuses,
    generatedAt: new Date().toISOString(),
  };
}
