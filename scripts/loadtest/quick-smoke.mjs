#!/usr/bin/env node
// Concord — zero-dependency load smoke test.
// ---------------------------------------------------------------------------
// No k6, no npm install. Pure Node http(s). Floods the public-read endpoints
// with N concurrent workers for D seconds and reports p50/p95/p99 + RPS +
// error rate. Use this for a fast "does it hold?" gut-check; use k6-mix.js for
// the full scenario mix + WebSocket ceiling + the ramp-to-knee.
//
//   node scripts/loadtest/quick-smoke.mjs --url https://concord-os.org -c 200 -d 30
//
// Flags:
//   --url   base URL              (default http://localhost:5050)
//   -c      concurrent workers    (default 100)
//   -d      duration seconds      (default 20)
//   --ramp  ramp workers up over the first N seconds (default 0 = instant)
// ---------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const BASE = (flag('--url', process.env.BASE_URL || 'http://localhost:5050')).replace(/\/$/, '');
const CONC = Number(flag('-c', '100'));
const DUR = Number(flag('-d', '20')) * 1000;
const RAMP = Number(flag('--ramp', '0')) * 1000;

const ENDPOINTS = [
  '/health',
  '/ready',
  '/api/status',
  '/api/lenses',
  '/api/achievements/catalog',
  '/api/auctions/active',
  '/api/tournaments/active',
  '/api/worlds/spectator-counts',
  '/api/cross-world/feed',
];

const agent = BASE.startsWith('https')
  ? new https.Agent({ keepAlive: true, maxSockets: CONC * 2 })
  : new http.Agent({ keepAlive: true, maxSockets: CONC * 2 });
const client = BASE.startsWith('https') ? https : http;

// ── metrics ──────────────────────────────────────────────────────────────────
const latencies = [];
let ok = 0, errs = 0, inflight = 0;
const errByCode = {};
const startedAt = Date.now();
let running = true;

function once() {
  return new Promise((resolve) => {
    const path = ENDPOINTS[(Math.random() * ENDPOINTS.length) | 0];
    const t0 = Date.now();
    inflight++;
    const req = client.get(BASE + path, { agent, timeout: 15000 }, (res) => {
      res.resume(); // drain
      res.on('end', () => {
        inflight--;
        const dt = Date.now() - t0;
        if (res.statusCode >= 200 && res.statusCode < 400) { ok++; latencies.push(dt); }
        else { errs++; errByCode[res.statusCode] = (errByCode[res.statusCode] || 0) + 1; }
        resolve();
      });
    });
    req.on('error', (e) => {
      inflight--; errs++;
      const code = e.code || 'ERR';
      errByCode[code] = (errByCode[code] || 0) + 1;
      resolve();
    });
    req.on('timeout', () => { req.destroy(); });
  });
}

async function worker() {
  while (running) await once();
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

// live progress
const ticker = setInterval(() => {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  const rps = (ok + errs) / ((Date.now() - startedAt) / 1000);
  process.stdout.write(
    `\r  ${elapsed}s  rps=${rps.toFixed(0)}  ok=${ok}  err=${errs}  inflight=${inflight}  p95=${pct(latencies, 95)}ms   `
  );
}, 1000);

async function main() {
  console.log(`\n  Concord quick-smoke → ${BASE}`);
  console.log(`  ${CONC} workers · ${DUR / 1000}s${RAMP ? ` · ${RAMP / 1000}s ramp` : ''}\n`);

  const workers = [];
  for (let i = 0; i < CONC; i++) {
    const delay = RAMP ? (i / CONC) * RAMP : 0;
    workers.push(new Promise((r) => setTimeout(() => worker().then(r), delay)));
  }
  setTimeout(() => { running = false; }, DUR);
  await Promise.all(workers);

  clearInterval(ticker);
  const secs = (Date.now() - startedAt) / 1000;
  const total = ok + errs;
  console.log('\n');
  console.log('  ═══════════════════════════════════════════════');
  console.log('   QUICK-SMOKE RESULTS');
  console.log('  ═══════════════════════════════════════════════');
  console.log(`   Requests   ${total} in ${secs.toFixed(1)}s  (${(total / secs).toFixed(0)} rps)`);
  console.log(`   Success    ${ok}  (${((ok / total) * 100 || 0).toFixed(2)}%)`);
  console.log(`   Errors     ${errs}  (${((errs / total) * 100 || 0).toFixed(2)}%)`);
  if (Object.keys(errByCode).length) console.log(`   Err codes  ${JSON.stringify(errByCode)}`);
  console.log(`   Latency    p50=${pct(latencies, 50)}ms  p95=${pct(latencies, 95)}ms  p99=${pct(latencies, 99)}ms  max=${pct(latencies, 100)}ms`);
  console.log('  ═══════════════════════════════════════════════');
  console.log('   Re-run with higher -c to find the knee (where p95 jumps).');
  console.log('   For WebSocket + write scenarios, use k6-mix.js.\n');

  // Non-zero exit if the error rate is bad — usable in CI / a gate.
  process.exit(errs / Math.max(1, total) > 0.05 ? 1 : 0);
}

main();
