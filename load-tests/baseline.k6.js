// load-tests/baseline.k6.js
// Phase 13: k6 load test for Concord baseline API performance.
// Usage: k6 run load-tests/baseline.k6.js
// Requires: k6 (https://k6.io) — install with: brew install k6 / apt install k6

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const errorRate = new Rate("errors");
const chatLatency = new Trend("chat_latency_ms", true);
const inferenceLatency = new Trend("inference_latency_ms", true);

export const options = {
  // Ceiling raised 200 -> 500 (2026-08-02). None of the 4 endpoints this
  // script hits are LLM-calling (health/traces/costs/an auth-check) — the
  // real constraint on the deploy box is Ollama's ~9 vCPU budget (see
  // CLAUDE.md's LLM_CONCURRENCY note), which this test never touches, so
  // 200 was testing plain Express/SQLite request handling, not the box's
  // actual bottleneck. The front-door admission-control layer
  // (lib/request-admission.js) sheds load under measured event-loop lag
  // before this ceiling could cause an uncontrolled failure, so a real run
  // against it is the honest way to find where that shedding kicks in —
  // watch for `errors`/`http_req_failed` climbing as VUs approach 500 and
  // re-tune from there; this number is a starting point to gather real
  // data against, not a load estimate.
  stages: [
    { duration: "2m", target: 25 },   // ramp-up
    { duration: "5m", target: 100 },  // sustained moderate
    { duration: "5m", target: 500 },  // sustained heavy
    { duration: "5m", target: 500 },  // hold
    { duration: "5m", target: 100 },  // ramp-down
    { duration: "2m", target: 0 },    // cleanup
  ],
  thresholds: {
    "http_req_duration": ["p(95)<5000"],
    "http_req_failed": ["rate<0.01"],
    "chat_latency_ms": ["p(95)<5000"],
    "errors": ["rate<0.01"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const TEST_SESSION_ID = `k6_vu_${__VU}_${Date.now()}`;

export default function () {
  const headers = {
    "Content-Type": "application/json",
    "x-test-session": TEST_SESSION_ID,
  };

  // ── Health check ────────────────────────────────────────────────────────────
  const health = http.get(`${BASE_URL}/api/health`, { headers });
  check(health, {
    "health 200": (r) => r.status === 200,
  });
  errorRate.add(health.status !== 200);

  sleep(0.5);

  // ── Inference trace listing ─────────────────────────────────────────────────
  const traces = http.get(`${BASE_URL}/api/inference/traces?limit=10`, { headers });
  check(traces, {
    "traces 200": (r) => r.status === 200,
    "traces has ok": (r) => {
      try { return JSON.parse(r.body).ok === true; } catch { return false; }
    },
  });
  inferenceLatency.add(traces.timings.duration);
  errorRate.add(traces.status !== 200);

  sleep(1);

  // ── Cost endpoint ───────────────────────────────────────────────────────────
  const costs = http.get(`${BASE_URL}/api/inference/costs?days=7`, { headers });
  check(costs, {
    "costs 200": (r) => r.status === 200,
  });

  sleep(1);

  // ── Voice session create (unauthenticated — expect 401) ─────────────────────
  const voiceCreate = http.post(`${BASE_URL}/api/voice/session/create`, "{}", { headers });
  check(voiceCreate, {
    "voice session auth check": (r) => r.status === 401 || r.status === 200,
  });

  sleep(2);
}

export function handleSummary(data) {
  const passed = data.metrics.http_req_failed.values.rate < 0.01
    && data.metrics.http_req_duration.values["p(95)"] < 5000;

  return {
    "stdout": JSON.stringify({
      passed,
      p95LatencyMs: data.metrics.http_req_duration.values["p(95)"],
      errorRate: data.metrics.http_req_failed.values.rate,
      vus: data.metrics.vus_max.values.max,
      totalRequests: data.metrics.http_reqs.values.count,
    }, null, 2),
    "reports/production-integrity/load-test-results.json": JSON.stringify(data, null, 2),
  };
}
