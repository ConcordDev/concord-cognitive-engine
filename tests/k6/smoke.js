// tests/k6/smoke.js
//
// Sprint 18 — k6 smoke load test. CI-tier smoke: a small VU pool for a
// short window against critical endpoints. Asserts server doesn't crash
// or hit pathological latency. The PR-gate thresholds are CI-realistic
// (single shared ubuntu-latest VM running both the server AND k6, no
// Ollama backend); they catch regressions without imposing a perf budget
// on every PR. For real load-testing (perf budget enforcement) override
// the env / args:
//
//   Smoke:    k6 run tests/k6/smoke.js
//   Standard: K6_PROFILE=standard k6 run tests/k6/smoke.js
//   Heavy:    K6_PROFILE=heavy    k6 run --vus 500 --duration 10m tests/k6/smoke.js

import http from 'k6/http';
import { check, sleep } from 'k6';

const PROFILE = __ENV.K6_PROFILE || 'smoke';

const PROFILES = {
  smoke: {
    vus: 10,
    duration: '30s',
    thresholds: {
      // CI-realistic — single shared VM, no Ollama. Catches crashes,
      // memory pressure, deadlocks, hard regressions. Not a perf gate.
      http_req_duration: ['p(95)<1500', 'p(99)<3000'],
      http_req_failed:   ['rate<0.02'],
      checks:            ['rate>0.95'],
    },
  },
  standard: {
    vus: 50,
    duration: '2m',
    thresholds: {
      // Real Fortune-500 thresholds for a dedicated perf box.
      http_req_duration: ['p(95)<500', 'p(99)<1500'],
      http_req_failed:   ['rate<0.01'],
      checks:            ['rate>0.99'],
    },
  },
  heavy: {
    vus: 500,
    duration: '10m',
    thresholds: {
      http_req_duration: ['p(95)<800', 'p(99)<2500'],
      http_req_failed:   ['rate<0.01'],
      checks:            ['rate>0.99'],
    },
  },
};

export const options = PROFILES[PROFILE] || PROFILES.smoke;

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
