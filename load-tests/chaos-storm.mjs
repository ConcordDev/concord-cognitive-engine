#!/usr/bin/env node
// load-tests/chaos-storm.mjs
//
// Dependency-free combinatorial load harness. Hammers a running Concord with a
// worst-case mix (macro calls + DTU reads + CAD + health) at a chosen concurrency
// and reports, per endpoint: p50/p95/p99 latency, error rate, 503 (load-shed)
// rate — plus the load-bearing signal: /api/system/health latency SAMPLED
// DURING the storm (idle it's ~2ms; if the event loop is starved it balloons).
//
// Usage:
//   node load-tests/chaos-storm.mjs                 # 200 concurrent, 15s, localhost
//   CONC=500 DUR=30 BASE=http://127.0.0.1:5050 node load-tests/chaos-storm.mjs
//   AUTH=1 node load-tests/chaos-storm.mjs          # log in first (needs ~/.zuko/remaining-work/_audit_user.txt)
//
// Exit non-zero if health p95 during the storm exceeds CONCORD_CHAOS_HEALTH_P95_MS
// (default 500) — so it can gate CI once the perf work lands.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE || "http://127.0.0.1:5050";
const CONC = Number(process.env.CONC || 200);
const DUR_MS = Number(process.env.DUR || 15) * 1000;
const HEALTH_P95_GATE = Number(process.env.CONCORD_CHAOS_HEALTH_P95_MS || 500);
const WANT_AUTH = process.env.AUTH === "1";

const pct = (arr, p) => {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  return +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(0);
};

// Worst-case combinatorial mix. Weighted by how a real chaotic session looks.
const REQUESTS = [
  { w: 4, name: "macro:dtu.list", fn: () => post("/api/lens/run", { domain: "dtu", name: "list", input: { limit: 50 } }) },
  { w: 2, name: "macro:dtu.stats", fn: () => post("/api/lens/run", { domain: "dtu", name: "stats", input: {} }) },
  { w: 2, name: "macro:accounting.trialBalance", fn: () => post("/api/lens/run", { domain: "accounting", name: "trialBalance", input: {} }) },
  { w: 2, name: "macro:goals.list", fn: () => post("/api/lens/run", { domain: "goals", name: "list", input: {} }) },
  { w: 2, name: "macro:astronomy.apod", fn: () => post("/api/lens/run", { domain: "astronomy", name: "apod", input: {} }) },
  { w: 3, name: "GET:/api/dtus", fn: () => get("/api/dtus?limit=30") },
  { w: 1, name: "macro:weather.current", fn: () => post("/api/lens/run", { domain: "weather", name: "current", input: { city: "Denver" } }) },
];
const BAG = REQUESTS.flatMap((r) => Array(r.w).fill(r));

let COOKIE = "";
let TOKEN = "";

async function get(p, timeoutMs = 30000) {
  const s = performance.now();
  try {
    const r = await fetch(BASE + p, { headers: hdrs(), signal: AbortSignal.timeout(timeoutMs) });
    await r.arrayBuffer();
    return { ms: performance.now() - s, status: r.status };
  } catch (e) { return { ms: performance.now() - s, status: 0, err: e.name }; }
}
async function post(p, body, timeoutMs = 30000) {
  const s = performance.now();
  try {
    const r = await fetch(BASE + p, { method: "POST", headers: { ...hdrs(), "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    await r.arrayBuffer();
    return { ms: performance.now() - s, status: r.status };
  } catch (e) { return { ms: performance.now() - s, status: 0, err: e.name }; }
}
function hdrs() {
  const h = {};
  if (COOKIE) h.Cookie = COOKIE;
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

async function login() {
  const f = path.join(os.homedir(), ".zuko/remaining-work/_audit_user.txt");
  const c = Object.fromEntries(fs.readFileSync(f, "utf8").trim().split("\n").map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: c.USER, password: c.PASS }),
  });
  const j = await r.json().catch(() => ({}));
  TOKEN = j.token || "";
  const sc = r.headers.get("set-cookie");
  if (sc) COOKIE = sc.split(/,(?=[^;]+=)/).map((x) => x.split(";")[0].trim()).join("; ");
  return { status: r.status, ok: j.ok, hasToken: !!TOKEN, hasCookie: !!COOKIE };
}

async function main() {
  console.log(`chaos-storm → ${BASE}  ·  ${CONC} concurrent  ·  ${DUR_MS / 1000}s  ·  auth=${WANT_AUTH}`);
  if (WANT_AUTH) console.log("login:", JSON.stringify(await login()));

  // baseline
  const base = [];
  for (let i = 0; i < 20; i++) { base.push((await get("/api/system/health")).ms); await sleep(20); }
  console.log(`baseline health: p50 ${pct(base, 0.5)}ms  p95 ${pct(base, 0.95)}ms`);

  // storm
  const perEndpoint = {};
  const healthDuring = [];
  let running = true;
  const t0 = performance.now();

  const worker = async () => {
    while (running) {
      const r = BAG[(Math.random() * BAG.length) | 0];
      const res = await r.fn();
      (perEndpoint[r.name] ||= []).push(res);
    }
  };
  const healthSampler = (async () => {
    while (running) { healthDuring.push((await get("/api/system/health", 10000))); await sleep(100); }
  })();

  const workers = Array.from({ length: CONC }, () => worker());
  await sleep(DUR_MS);
  running = false;
  await Promise.all([...workers, healthSampler]);
  const wall = ((performance.now() - t0) / 1000).toFixed(1);

  // recovery
  await sleep(1500);
  const after = [];
  for (let i = 0; i < 20; i++) { after.push((await get("/api/system/health")).ms); await sleep(20); }

  // report
  console.log(`\n─── ${wall}s storm, ${CONC} concurrent ───`);
  let totalReq = 0;
  for (const [name, arr] of Object.entries(perEndpoint).sort()) {
    totalReq += arr.length;
    const ok = arr.filter((x) => x.status >= 200 && x.status < 400).length;
    const shed = arr.filter((x) => x.status === 503).length;
    const err = arr.filter((x) => x.status === 0).length;
    console.log(
      `  ${name.padEnd(32)} n=${String(arr.length).padStart(5)}  ok=${((ok / arr.length) * 100).toFixed(0)}%  503=${shed}  err=${err}  ` +
      `p50=${String(pct(arr.map((x) => x.ms), 0.5)).padStart(5)}ms  p95=${String(pct(arr.map((x) => x.ms), 0.95)).padStart(6)}ms  p99=${pct(arr.map((x) => x.ms), 0.99)}ms`,
    );
  }
  const hMs = healthDuring.map((x) => x.ms);
  const hp95 = pct(hMs, 0.95);
  console.log(
    `\n  HEALTH during storm             n=${String(healthDuring.length).padStart(5)}  ` +
    `served=${healthDuring.filter((x) => x.status === 200).length}  503=${healthDuring.filter((x) => x.status === 503).length}  ` +
    `p50=${pct(hMs, 0.5)}ms  p95=${hp95}ms  p99=${pct(hMs, 0.99)}ms  max=${pct(hMs, 1)}ms`,
  );
  console.log(`  throughput: ${(totalReq / Number(wall)).toFixed(0)} req/s over ${totalReq} requests`);
  console.log(`  recovery: health p95 ${pct(after, 0.95)}ms\n`);

  // Absolute thresholds — idle p95 is too noisy on a shared box for a ratio.
  const b = pct(base, 0.95) || 1;
  const verdict =
    hp95 == null ? "health unreachable under load"
    : hp95 > 1500 ? "EVENT LOOP STARVED (health p95 >1.5s under load)"
    : hp95 > 400 ? "degraded (health p95 400ms–1.5s under load)"
    : "stayed responsive (health p95 <400ms under load)";
  console.log(`VERDICT: health p95  ${b}ms idle → ${hp95}ms under load  →  ${verdict}`);

  const out = { base: pct(base, 0.95), healthP95UnderLoad: hp95, verdict, concurrency: CONC, throughputRps: +(totalReq / Number(wall)).toFixed(0), recoveredP95: pct(after, 0.95) };
  const dir = path.join(os.homedir(), ".zuko/remaining-work");
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "concord-chaos-storm.json"), JSON.stringify(out, null, 2) + "\n"); } catch {}

  process.exit(hp95 != null && hp95 > HEALTH_P95_GATE ? 1 : 0);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
main().catch((e) => { console.error(e); process.exit(2); });
