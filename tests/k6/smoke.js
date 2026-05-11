// tests/k6/smoke.js
//
// Sprint 18 — k6 smoke load test. 50 VUs for 2 minutes against critical
// endpoints. Asserts p95 latency + error rate thresholds.
//
// Run:  k6 run tests/k6/smoke.js
// Heavy: k6 run --vus 500 --duration 10m tests/k6/smoke.js

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '2m',
  thresholds: {
    // Real Fortune-500 thresholds. Tighten as the platform matures.
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    http_req_failed:   ['rate<0.01'],
    checks:            ['rate>0.99'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:5050';

export default function () {
  // Health.
  let r = http.get(`${BASE}/health`);
  check(r, { 'health 200': (res) => res.status === 200 });
  sleep(0.1);

  // Public read-domain macros (no auth needed).
  r = http.post(
    `${BASE}/api/lens/run`,
    JSON.stringify({ domain: 'lens', name: 'list', input: {} }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(r, { 'lens.list 200': (res) => res.status === 200 });
  sleep(0.2);

  r = http.post(
    `${BASE}/api/lens/run`,
    JSON.stringify({ domain: 'system', name: 'health', input: {} }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(r, { 'system.health 200': (res) => res.status === 200 });
  sleep(0.2);
}
