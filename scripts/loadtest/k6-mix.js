// Concord — realistic load-test harness (k6)
// ---------------------------------------------------------------------------
// Simulates the REAL traffic shape of Concord: read-heavy browsing + a large
// pool of held-open WebSocket connections, plus OPT-IN Concordia writes and
// chat (LLM) so you can measure each ceiling independently.
//
// The point is to find the KNEE — the concurrency at which p95 latency or the
// error rate climbs off the floor. That converts "should handle thousands"
// into a number you can trust.
//
// Run:
//   BASE_URL=https://concord-os.org k6 run scripts/loadtest/k6-mix.js
//
// Find-the-knee ramp (default): browse + websocket ramp 50→2000 VUs.
// Tune everything via env (see CONFIG below). Safe by default — NO writes to
// your DB and NO GPU spend unless you explicitly enable the authed scenarios.
//
// Enable write scenarios (needs a token pool — see setup-users.mjs):
//   ENABLE_CONCORDIA=1 ENABLE_CHAT=1 TOKENS_FILE=tokens.json k6 run ... \
//     --env ...
// ---------------------------------------------------------------------------

import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// ── CONFIG (all env-overridable) ───────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:5050';
const WS_URL = (__ENV.WS_URL || BASE_URL).replace(/^http/, 'ws');

// Peak VUs for each scenario's ramp. Lower these on a small box.
const BROWSE_PEAK = Number(__ENV.BROWSE_PEAK || 2000);   // read-heavy users
const WS_PEAK = Number(__ENV.WS_PEAK || 2000);           // held-open connections
const CONCORDIA_PEAK = Number(__ENV.CONCORDIA_PEAK || 200); // authed writers
const CHAT_PEAK = Number(__ENV.CHAT_PEAK || 30);         // LLM sessions (heavy)

const ENABLE_CONCORDIA = __ENV.ENABLE_CONCORDIA === '1';
const ENABLE_CHAT = __ENV.ENABLE_CHAT === '1';
const RAMP = __ENV.RAMP || 'normal'; // 'normal' | 'soak' | 'spike'

// Token pool for authed scenarios — produced by setup-users.mjs.
// Format: JSON array of { token, userId } objects. Empty if file absent.
const TOKENS = new SharedArray('tokens', function () {
  const f = __ENV.TOKENS_FILE;
  if (!f) return [];
  try { return JSON.parse(open(f)); } catch (_e) { return []; }
});

// ── Custom metrics ─────────────────────────────────────────────────────────
const readLatency = new Trend('concord_read_latency', true);
const readErrors = new Rate('concord_read_errors');
const wsConnected = new Counter('concord_ws_connected');
const wsFailed = new Counter('concord_ws_failed');
const writeLatency = new Trend('concord_write_latency', true);
const writeErrors = new Rate('concord_write_errors');
const chatLatency = new Trend('concord_chat_latency', true);
const chatErrors = new Rate('concord_chat_errors');

// ── Real public-read endpoints (verified against server.js publicReadPaths) ─
const READ_ENDPOINTS = [
  '/health',
  '/ready',
  '/api/status',
  '/api/lenses',
  '/api/achievements/catalog',
  '/api/auctions/active',
  '/api/tournaments/active',
  '/api/worlds/spectator-counts',
  '/api/cross-world/feed',
  '/api/diseases/catalog',
];

// Ramp profiles ------------------------------------------------------------
function rampStages(peak) {
  if (RAMP === 'soak') {
    // Hold at half-peak for 20m — surfaces leaks / WAL growth / heap creep.
    return [
      { duration: '2m', target: Math.floor(peak / 2) },
      { duration: '20m', target: Math.floor(peak / 2) },
      { duration: '1m', target: 0 },
    ];
  }
  if (RAMP === 'spike') {
    // Slam to peak fast — tests the cold-start / burst path.
    return [
      { duration: '30s', target: peak },
      { duration: '2m', target: peak },
      { duration: '30s', target: 0 },
    ];
  }
  // 'normal' — staircase to find the knee.
  return [
    { duration: '1m', target: Math.floor(peak * 0.1) },
    { duration: '2m', target: Math.floor(peak * 0.25) },
    { duration: '2m', target: Math.floor(peak * 0.5) },
    { duration: '2m', target: Math.floor(peak * 0.75) },
    { duration: '3m', target: peak },
    { duration: '1m', target: 0 },
  ];
}

// ── Scenarios ───────────────────────────────────────────────────────────────
const scenarios = {
  browse: {
    executor: 'ramping-vus',
    exec: 'browse',
    startVUs: 0,
    stages: rampStages(BROWSE_PEAK),
    gracefulRampDown: '20s',
  },
  websocket: {
    executor: 'ramping-vus',
    exec: 'websocketHold',
    startVUs: 0,
    stages: rampStages(WS_PEAK),
    gracefulRampDown: '20s',
  },
};

if (ENABLE_CONCORDIA && TOKENS.length > 0) {
  scenarios.concordia = {
    executor: 'ramping-vus',
    exec: 'concordiaWrite',
    startVUs: 0,
    stages: rampStages(CONCORDIA_PEAK),
    gracefulRampDown: '20s',
  };
}
if (ENABLE_CHAT && TOKENS.length > 0) {
  scenarios.chat = {
    executor: 'ramping-vus',
    exec: 'chatSession',
    startVUs: 0,
    stages: rampStages(CHAT_PEAK),
    gracefulRampDown: '30s',
  };
}

export const options = {
  scenarios,
  // The KNEE thresholds. If these fail, you've found your real ceiling.
  thresholds: {
    concord_read_latency: ['p(95)<500', 'p(99)<1500'],
    concord_read_errors: ['rate<0.01'],
    concord_write_latency: ['p(95)<2000'],
    concord_write_errors: ['rate<0.02'],
    // Chat is LLM-bound — generous bound; we mostly want the error rate.
    concord_chat_errors: ['rate<0.05'],
  },
  // Don't let one slow request stall the whole VU.
  noConnectionReuse: false,
  discardResponseBodies: false,
};

// ── browse: read-heavy anonymous user ────────────────────────────────────────
export function browse() {
  // Each iteration hits 3 random read endpoints, like a user navigating.
  for (let i = 0; i < 3; i++) {
    const path = READ_ENDPOINTS[Math.floor(Math.random() * READ_ENDPOINTS.length)];
    const res = http.get(`${BASE_URL}${path}`, {
      tags: { scenario: 'browse', endpoint: path },
      timeout: '10s',
    });
    readLatency.add(res.timings.duration);
    readErrors.add(res.status >= 400 || res.status === 0);
    check(res, { 'read 2xx/3xx': (r) => r.status >= 200 && r.status < 400 });
    sleep(Math.random() * 0.5);
  }
  // Think-time between page loads — realistic users aren't a tight loop.
  sleep(1 + Math.random() * 2);
}

// ── websocketHold: open a Socket.IO connection and hold it ───────────────────
// Exercises the connection/FD ceiling — the vector that crashed at ~200 before
// the ulimit fix. Uses the engine.io v4 websocket handshake.
export function websocketHold() {
  const url = `${WS_URL}/socket.io/?EIO=4&transport=websocket`;
  const res = ws.connect(url, { tags: { scenario: 'websocket' } }, function (socket) {
    socket.on('open', function () {
      // engine.io: server sends "0{...}" open packet; we reply "40" to
      // connect the default namespace. Then hold for a held-connection test.
      socket.setTimeout(function () { socket.close(); }, 30000); // hold 30s
    });
    socket.on('message', function (msg) {
      if (typeof msg === 'string') {
        if (msg.startsWith('0')) socket.send('40');      // open → connect ns
        else if (msg === '2') socket.send('3');          // ping → pong (keepalive)
        else if (msg.startsWith('40')) wsConnected.add(1); // ns connected ok
      }
    });
    socket.on('error', function () { wsFailed.add(1); });
  });
  check(res, { 'ws handshake 101': (r) => r && r.status === 101 });
  if (!res || res.status !== 101) wsFailed.add(1);
}

// ── concordiaWrite: authed lens-run write (OPT-IN) ───────────────────────────
// Represents Concordia play — the SQLite single-writer pressure test.
// Uses a benign, idempotent read-ish macro by default; override the domain/
// name via env to target a true write path you're comfortable load-testing.
export function concordiaWrite() {
  const cred = TOKENS[Math.floor(Math.random() * TOKENS.length)];
  const domain = __ENV.CONCORDIA_DOMAIN || 'discovery';
  const name = __ENV.CONCORDIA_MACRO || 'trending';
  const res = http.post(
    `${BASE_URL}/api/lens/run`,
    JSON.stringify({ domain, name, input: {} }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cred.token}` },
      tags: { scenario: 'concordia' },
      timeout: '15s',
    }
  );
  writeLatency.add(res.timings.duration);
  writeErrors.add(res.status >= 400 || res.status === 0);
  check(res, { 'lens-run ok': (r) => r.status === 200 });
  sleep(2 + Math.random() * 3);
}

// ── chatSession: authed LLM chat (OPT-IN, heavy) ─────────────────────────────
export function chatSession() {
  const cred = TOKENS[Math.floor(Math.random() * TOKENS.length)];
  const res = http.post(
    `${BASE_URL}/api/chat/messages`,
    JSON.stringify({ message: 'Load test: summarize what Concord is in one sentence.', conversationId: null }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cred.token}` },
      tags: { scenario: 'chat' },
      timeout: '60s',
    }
  );
  chatLatency.add(res.timings.duration);
  chatErrors.add(res.status >= 400 || res.status === 0);
  check(res, { 'chat ok': (r) => r.status === 200 });
  sleep(5 + Math.random() * 10); // users read the reply before sending again
}

// ── Summary ──────────────────────────────────────────────────────────────────
export function handleSummary(data) {
  const m = data.metrics;
  const g = (name, stat) => {
    const v = m[name] && m[name].values ? m[name].values[stat] : undefined;
    return v === undefined ? 'n/a' : (typeof v === 'number' ? v.toFixed(1) : v);
  };
  const lines = [
    '',
    '═══════════════════════════════════════════════════════════════',
    '  CONCORD LOAD TEST — RESULTS',
    '═══════════════════════════════════════════════════════════════',
    `  Reads      p50=${g('concord_read_latency', 'med')}ms  p95=${g('concord_read_latency', 'p(95)')}ms  p99=${g('concord_read_latency', 'p(99)')}ms`,
    `  Read errs  ${(Number(g('concord_read_errors', 'rate')) * 100 || 0).toFixed(2)}%`,
    `  WS conns   ok=${g('concord_ws_connected', 'count')}  failed=${g('concord_ws_failed', 'count')}`,
    `  Writes     p50=${g('concord_write_latency', 'med')}ms  p95=${g('concord_write_latency', 'p(95)')}ms`,
    `  Chat       p50=${g('concord_chat_latency', 'med')}ms  p95=${g('concord_chat_latency', 'p(95)')}ms`,
    `  HTTP reqs  ${g('http_reqs', 'count')} total  (${g('http_reqs', 'rate')}/s)`,
    '═══════════════════════════════════════════════════════════════',
    '  The KNEE = where p95 climbs off the floor as VUs rise. Watch the',
    '  per-stage output above; the stage before p95 jumps is your ceiling.',
    '═══════════════════════════════════════════════════════════════',
    '',
  ];
  return {
    stdout: lines.join('\n'),
    'loadtest-summary.json': JSON.stringify(data, null, 2),
  };
}
