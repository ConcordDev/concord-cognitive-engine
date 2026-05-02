// load-tests/smoke.k6.js
// Smoke gate — runs on every PR, completes in ~2 minutes.
// Verifies basic availability at low load before full suite.
// Usage: k6 run load-tests/smoke.k6.js

import http from "k6/http";
import { check } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 5 },
    { duration: "90s", target: 5 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    "http_req_duration": ["p(95)<8000"],
    "http_req_failed": ["rate<0.05"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export default function () {
  const health = http.get(`${BASE_URL}/api/health`);
  check(health, { "health ok": (r) => r.status === 200 });

  const traces = http.get(`${BASE_URL}/api/inference/traces?limit=5`);
  check(traces, { "traces ok": (r) => r.status === 200 || r.status === 401 });
}
