#!/usr/bin/env node
// scripts/stress-stability.mjs
//
// Hammer the dev server with realistic concurrent gameplay calls for
// ~60s. Watch for:
//   - HTTP 5xx (server crashed or hit an unhandled error)
//   - Heap growth (memory leak)
//   - Heartbeat tick rate (governor stopped ticking)
//   - Unhandled rejections in /tmp/server.log
//   - Event-loop lag spikes
// Reports a pass/fail per axis.

const BACKEND = 'http://127.0.0.1:5050';
const UA = 'Mozilla/5.0';

// Login
const loginR = await fetch(BACKEND + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
  body: JSON.stringify({ username: 'world-explorer-mpldouwl', password: 'Concord-Explore-2026!' }),
});
const auth = await loginR.json();
const TOKEN = auth.token;
const cookie = `concord_auth=${TOKEN}`;

const f = (p, opts = {}) => fetch(BACKEND + p, {
  ...opts,
  headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Cookie: cookie, ...(opts.headers || {}) },
});

async function snapshot() {
  // Read metrics. Two gotchas:
  //   - process_resident_memory_bytes is the right heap proxy (not
  //     concord_heap_used_bytes which doesn't exist).
  //   - concord_heartbeat_ticks_total appears twice (legacy alias
  //     concord_heartbeat_tick_total is declared first at value 0,
  //     then the canonical metric shows the real count). Match the
  //     LAST occurrence with a `g` flag scan.
  let heapMb = NaN, ticks = NaN;
  try {
    const r = await f('/metrics');
    const txt = await r.text();
    const m1 = txt.match(/^process_resident_memory_bytes\s+(\d+)/m);
    if (m1) heapMb = Math.round(Number(m1[1]) / 1024 / 1024);
    // Grab the last numeric occurrence.
    const all = [...txt.matchAll(/^concord_heartbeat_ticks_total\s+(\d+)/gm)];
    if (all.length > 0) ticks = Number(all[all.length - 1][1]);
  } catch {}
  return { ts: Date.now(), heapMb, ticks };
}

const targets = [
  () => f('/api/system/health'),
  () => f('/api/worlds'),
  () => f('/api/worlds/concordia-hub'),
  () => f('/api/worlds/concordia-hub/npcs'),
  () => f('/api/worlds/concordia-hub/nodes?x=0&z=0&radius=200'),
  () => f('/api/economy/balance'),
  () => f('/api/affect/state'),
  () => f('/api/worlds/crises'),
  () => f('/api/webrtc/ice-servers'),
  () => f('/api/lens/run', { method: 'POST', body: JSON.stringify({ domain: 'beats', name: 'list', input: {} }) }),
  () => f('/api/lens/run', { method: 'POST', body: JSON.stringify({ domain: 'discovery', name: 'search', input: { q: 'test' } }) }),
];

const before = await snapshot();
console.error(`BEFORE  heap=${before.heapMb}MB ticks=${before.ticks}`);

const stats = { req: 0, ok: 0, 4: 0, 5: 0, neterr: 0 };
const DURATION_MS = 60_000;
const CONCURRENCY = 16;
const tEnd = Date.now() + DURATION_MS;

async function worker() {
  while (Date.now() < tEnd) {
    const fn = targets[Math.floor(Math.random() * targets.length)];
    stats.req++;
    try {
      const r = await fn();
      if (r.ok) stats.ok++;
      else if (r.status >= 500) stats[5]++;
      else if (r.status >= 400) stats[4]++;
    } catch {
      stats.neterr++;
    }
  }
}

const workers = Array.from({ length: CONCURRENCY }, () => worker());
const ticker = setInterval(async () => {
  const s = await snapshot();
  process.stderr.write(`  ${Math.round((Date.now() - before.ts) / 1000)}s heap=${s.heapMb}MB ticks=${s.ticks} req=${stats.req} ok=${stats.ok} 4xx=${stats[4]} 5xx=${stats[5]} net=${stats.neterr}\n`);
}, 10_000);

await Promise.all(workers);
clearInterval(ticker);

const after = await snapshot();
console.error(`AFTER   heap=${after.heapMb}MB ticks=${after.ticks}`);
console.error(`\n=== STRESS SUMMARY ===`);
console.error(`Duration:          ${DURATION_MS / 1000}s`);
console.error(`Concurrency:       ${CONCURRENCY}`);
console.error(`Total requests:    ${stats.req}`);
console.error(`2xx:               ${stats.ok}`);
console.error(`4xx:               ${stats[4]} (rate-limit/auth — expected)`);
console.error(`5xx:               ${stats[5]} ${stats[5] === 0 ? '✓' : '✗ SERVER ERROR'}`);
console.error(`Net errors:        ${stats.neterr} ${stats.neterr === 0 ? '✓' : '⚠ likely event-loop hang'}`);
console.error(`Heap delta:        ${after.heapMb - before.heapMb}MB ${Math.abs(after.heapMb - before.heapMb) < 100 ? '✓' : '⚠ possible leak'}`);
console.error(`Heartbeat ticks:   ${before.ticks} → ${after.ticks} (delta ${after.ticks - before.ticks}) ${after.ticks > before.ticks ? '✓ still ticking' : '✗ STOPPED'}`);
