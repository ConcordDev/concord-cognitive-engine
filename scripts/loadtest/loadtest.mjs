#!/usr/bin/env node
// scripts/loadtest/loadtest.mjs
//
// Concurrent load tester for the Concord API. Measures real server capacity:
// throughput, latency percentiles, error breakdown — AND scrapes /metrics before/after
// to report heartbeat tick rate + SKIPPED ticks (the clog signal) and heap growth under
// load. Read-heavy + a write mix so it exercises the single SQLite writer.
//
// Usage (env-configurable):
//   BASE=http://localhost:5050 USERS=20 CONCURRENCY=50 DURATION_S=20 \
//   READ=0.6 COMPUTE=0.25 WRITE=0.15 node scripts/loadtest/loadtest.mjs
//
// Notes:
//  - Registers USERS distinct users (auth rate-limit is per IP+username, so distinct
//    usernames each get their own budget — one registration apiece is fine).
//  - To measure raw SERVER capacity (not the per-IP rate limiter), boot the server with
//    CONCORD_RATE_LIMIT_BYPASS=1 — otherwise a single-IP test just measures the limiter.
//    Keep every OTHER safety switch at its prod default.

const BASE = process.env.BASE || "http://localhost:5050";
const USERS = Number(process.env.USERS || 20);
const CONCURRENCY = Number(process.env.CONCURRENCY || 50);
const DURATION_S = Number(process.env.DURATION_S || 20);
const W_READ = Number(process.env.READ || 0.6);
const W_COMPUTE = Number(process.env.COMPUTE || 0.25);
const W_WRITE = Number(process.env.WRITE || 0.15);
const REQ_TIMEOUT_MS = Number(process.env.REQ_TIMEOUT_MS || 15000);
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 LoadTest";

const baseHeaders = { "Content-Type": "application/json", "Origin": "http://localhost:3000", "User-Agent": UA };

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

async function timedFetch(path, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(BASE + path, { ...opts, signal: ctrl.signal, headers: { ...baseHeaders, ...(opts.headers || {}) } });
    const text = await res.text();
    const ms = performance.now() - start;
    return { ok: res.ok, status: res.status, ms, body: text };
  } catch (e) {
    return { ok: false, status: 0, ms: performance.now() - start, body: String(e?.name === "AbortError" ? "timeout" : e?.message || e) };
  } finally { clearTimeout(t); }
}

async function scrapeMetrics() {
  const r = await timedFetch("/metrics");
  if (!r.ok) return {};
  const out = {};
  for (const m of ["concord_heartbeat_ticks_total", "concord_heartbeat_skipped_total", "concord_heartbeat_module_timeout_total"]) {
    const line = r.body.split("\n").find((l) => l.startsWith(m + " ") || l.startsWith(m + "{"));
    if (line) out[m] = Number(line.trim().split(/\s+/).pop());
  }
  const heap = r.body.split("\n").find((l) => l.includes('concord_process_memory_bytes{type="heapUsed"}'));
  if (heap) out.heapUsedMB = Math.round(Number(heap.trim().split(/\s+/).pop()) / 1048576);
  return out;
}

async function registerUser(i) {
  const stamp = Date.now().toString(36) + i;
  const r = await timedFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: `lt_${stamp}@ex.com`, password: "LoadTest1234!", username: `lt_${stamp}`.slice(0, 20), dateOfBirth: "1990-01-01" }),
  });
  try { const j = JSON.parse(r.body); return j?.token || null; } catch { return null; }
}

const ACTIONS = {
  read: (tok) => timedFetch("/api/dtus?limit=20", { headers: tok ? { Authorization: `Bearer ${tok}` } : {} }),
  compute: (tok) => timedFetch("/api/lens/run", {
    method: "POST",
    headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    body: JSON.stringify({ domain: "retail", action: "reorderCheck", input: { products: [{ sku: "A", onHand: 2, reorderPoint: 5, reorderQty: 10, dailyUsage: 1, leadTimeDays: 7 }] } }),
  }),
  write: (tok) => timedFetch("/api/dtus", {
    method: "POST",
    headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    body: JSON.stringify({ title: `LoadTest DTU ${Math.random().toString(36).slice(2, 8)}`, content: "load test payload", tags: ["loadtest"] }),
  }),
};

function pickAction() {
  const r = Math.random();
  if (r < W_READ) return "read";
  if (r < W_READ + W_COMPUTE) return "compute";
  return "write";
}

async function main() {
  console.log(`\n=== Concord load test ===\nTarget: ${BASE}\nUsers: ${USERS}  Concurrency: ${CONCURRENCY}  Duration: ${DURATION_S}s  Mix: read ${W_READ} / compute ${W_COMPUTE} / write ${W_WRITE}\n`);

  // Health gate
  const h = await timedFetch("/health");
  if (!h.ok) { console.error(`Server not healthy at ${BASE} (HTTP ${h.status}) — aborting.`); process.exit(1); }

  // Register users
  process.stdout.write(`Registering ${USERS} users... `);
  const tokens = (await Promise.all(Array.from({ length: USERS }, (_, i) => registerUser(i)))).filter(Boolean);
  console.log(`got ${tokens.length} tokens${tokens.length < USERS ? " (some registrations failed — rate limit? running with what we have)" : ""}`);
  if (tokens.length === 0) { console.error("No tokens — cannot run authed load. Aborting."); process.exit(1); }

  const before = await scrapeMetrics();
  const samples = []; const byStatus = {}; const byErr = {};
  let inflight = 0, done = 0, busy = 0, handlerErr = 0;
  const deadline = Date.now() + DURATION_S * 1000;

  async function worker(id) {
    while (Date.now() < deadline) {
      const tok = tokens[(id + done) % tokens.length];
      const kind = pickAction();
      inflight++;
      const r = await ACTIONS[kind](tok);
      inflight--; done++;
      samples.push(r.ms);
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      if (!r.ok) {
        const cls = r.status === 0 ? r.body : r.status === 429 ? "429_rate_limited" : r.status === 401 ? "401_auth" : `http_${r.status}`;
        byErr[cls] = (byErr[cls] || 0) + 1;
      }
      if (/SQLITE_BUSY|database is locked/i.test(r.body)) busy++;
      if (/handler_error/i.test(r.body)) handlerErr++;
    }
  }

  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  const elapsed = (Date.now() - t0) / 1000;
  const after = await scrapeMetrics();

  const sorted = samples.slice().sort((a, b) => a - b);
  const rps = (done / elapsed).toFixed(1);
  const errCount = Object.entries(byStatus).filter(([s]) => Number(s) === 0 || Number(s) >= 400).reduce((a, [, n]) => a + n, 0);
  const errPct = done ? ((errCount / done) * 100).toFixed(1) : "0";

  console.log(`\n--- Results (${elapsed.toFixed(1)}s, ${done} requests) ---`);
  console.log(`Throughput:      ${rps} req/s`);
  console.log(`Latency ms:      p50 ${pct(sorted, 50).toFixed(0)}  p90 ${pct(sorted, 90).toFixed(0)}  p95 ${pct(sorted, 95).toFixed(0)}  p99 ${pct(sorted, 99).toFixed(0)}  max ${(sorted[sorted.length - 1] || 0).toFixed(0)}`);
  console.log(`Errors:          ${errCount} (${errPct}%)  | SQLITE_BUSY: ${busy}  handler_error: ${handlerErr}`);
  console.log(`Status codes:    ${JSON.stringify(byStatus)}`);
  if (Object.keys(byErr).length) console.log(`Error classes:   ${JSON.stringify(byErr)}`);
  // Heartbeat health under load
  const ticks = (after.concord_heartbeat_ticks_total || 0) - (before.concord_heartbeat_ticks_total || 0);
  const skips = (after.concord_heartbeat_skipped_total || 0) - (before.concord_heartbeat_skipped_total || 0);
  const tmo = (after.concord_heartbeat_module_timeout_total || 0) - (before.concord_heartbeat_module_timeout_total || 0);
  console.log(`\n--- Heartbeat under load (${elapsed.toFixed(0)}s window) ---`);
  console.log(`Ticks fired:     ${ticks}  (expected ~${Math.floor(elapsed / 15)} at 15s cadence)`);
  console.log(`Ticks SKIPPED:   ${skips}  ${skips > 0 ? "⚠ tick overran 15s — the loop is clogging under load" : "✓ no clog"}`);
  console.log(`Module timeouts: ${tmo}`);
  console.log(`Heap: ${before.heapUsedMB ?? "?"}MB → ${after.heapUsedMB ?? "?"}MB`);
  console.log("");
}

main().catch((e) => { console.error("loadtest error:", e); process.exit(1); });
