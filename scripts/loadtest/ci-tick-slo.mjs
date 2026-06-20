#!/usr/bin/env node
// scripts/loadtest/ci-tick-slo.mjs
//
// CI tick-SLO guard. Drives a short combined HTTP + world-sim load against an
// already-running server, then asserts the heartbeat did NOT clog. Protects the
// capacity contract: a change that makes governorTick overrun its interval, a
// heartbeat module exceed its timeout, or a world shard crash-loop fails the PR.
//
// WHY ONLY BINARY GATES: co-located server+load on a shared CI VM makes HTTP
// latency percentiles flaky (~1-in-3 false fails — see platinum-performance.yml
// k6-smoke notes). So the HARD gates are the binary clog/instability signals
// that only fire on a real regression:
//   - concord_heartbeat_skipped_total delta  (a prior tick still running when
//     the next fired = the loop is overrunning its interval)
//   - concord_heartbeat_module_timeout_total delta (a module blew its budget)
//   - per-world shard restartCount > 0       (a shard crash-looped under load)
//   - the governor must actually tick (ticks_total must advance — a frozen loop
//     is the worst regression and would otherwise pass vacuously)
// HTTP latency is REPORTED but never fails the gate.
//
//   BASE=http://localhost:5050 DURATION_S=45 USERS=12 \
//   WORLDS=tunya,crime,cyber node scripts/loadtest/ci-tick-slo.mjs

const BASE = process.env.BASE || "http://localhost:5050";
const DURATION_S = Number(process.env.DURATION_S || 45);
const USERS = Number(process.env.USERS || 12);
const WORLDS = (process.env.WORLDS || "tunya,crime,cyber,fantasy").split(",").map((s) => s.trim()).filter(Boolean);
const GOVERNOR_WAIT_S = Number(process.env.GOVERNOR_WAIT_S || 120);
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 CiTickSlo";
const H = { "Content-Type": "application/json", "Origin": "http://localhost:3000", "User-Agent": UA };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jfetch(p, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(BASE + p, { ...opts, signal: ctrl.signal, headers: { ...H, ...(opts.headers || {}) } });
    const body = await res.text();
    let json; try { json = JSON.parse(body); } catch { json = null; }
    return { ok: res.ok, status: res.status, json, body };
  } catch (e) { return { ok: false, status: 0, body: String(e?.name === "AbortError" ? "timeout" : e?.message || e) }; }
  finally { clearTimeout(t); }
}

async function metrics() {
  const r = await jfetch("/metrics");
  const out = {};
  if (!r.ok) return out;
  for (const m of ["concord_heartbeat_ticks_total", "concord_heartbeat_skipped_total", "concord_heartbeat_module_timeout_total"]) {
    const line = r.body.split("\n").find((l) => l.startsWith(m + " "));
    if (line) out[m] = Number(line.trim().split(/\s+/).pop());
  }
  return out;
}

async function register(i) {
  const s = Date.now().toString(36) + i;
  const r = await jfetch("/api/auth/register", { method: "POST", body: JSON.stringify({ email: `slo_${s}@ex.com`, password: "CiTickSlo1234!", username: `slo_${s}`.slice(0, 20), dateOfBirth: "1990-01-01" }) });
  return r.json?.token || null;
}

async function waitForGovernor() {
  const deadline = Date.now() + GOVERNOR_WAIT_S * 1000;
  const start = (await metrics()).concord_heartbeat_ticks_total ?? 0;
  while (Date.now() < deadline) {
    const t = (await metrics()).concord_heartbeat_ticks_total ?? 0;
    if (t > start) return true;
    await sleep(2000);
  }
  return false;
}

async function main() {
  console.log(`\n=== CI tick-SLO guard ===\nTarget: ${BASE}  Users: ${USERS}  Duration: ${DURATION_S}s  Worlds: ${WORLDS.join(", ")}\n`);

  const h = await jfetch("/health");
  if (!h.ok) { console.error(`::error::server not healthy at ${BASE} (HTTP ${h.status})`); process.exit(1); }

  process.stdout.write("Waiting for the governor heartbeat to advance... ");
  if (!(await waitForGovernor())) {
    console.error(`\n::error::governor heartbeat never advanced within ${GOVERNOR_WAIT_S}s — the tick loop is frozen`);
    process.exit(1);
  }
  console.log("ticking.");

  process.stdout.write(`Registering ${USERS} users... `);
  const tokens = (await Promise.all(Array.from({ length: USERS }, (_, i) => register(i)))).filter(Boolean);
  console.log(`${tokens.length} ready`);
  if (!tokens.length) { console.error("::error::no tokens — cannot drive load"); process.exit(1); }

  // Travel each user into a world (spawns shards when sharding is on).
  await Promise.all(tokens.map((tok, i) => jfetch("/api/worlds/travel", { method: "POST", headers: { Authorization: `Bearer ${tok}` }, body: JSON.stringify({ worldId: WORLDS[i % WORLDS.length] }) })));

  const before = await metrics();
  const lat = [];
  let reqs = 0, errs = 0;
  const deadline = Date.now() + DURATION_S * 1000;

  // Combined load: reads + lens-compute + world moves across all users.
  async function worker(tok, worldId) {
    const auth = { Authorization: `Bearer ${tok}` };
    let px = Math.random() * 100, pz = Math.random() * 100, i = 0;
    while (Date.now() < deadline) {
      i++;
      const t0 = performance.now();
      let r;
      const pick = i % 3;
      if (pick === 0) r = await jfetch("/api/dtus?limit=20", { headers: auth });
      else if (pick === 1) r = await jfetch("/api/lens/run", { method: "POST", headers: auth, body: JSON.stringify({ domain: "retail", action: "reorderCheck", input: { products: [{ sku: "A", onHand: 2, reorderPoint: 5, reorderQty: 10, dailyUsage: 1, leadTimeDays: 7 }] } }) });
      else { px += (Math.random() - 0.5) * 20; pz += (Math.random() - 0.5) * 20; r = await jfetch(`/api/worlds/${worldId}/move`, { method: "POST", headers: auth, body: JSON.stringify({ x: px, z: pz, y: 5 }) }); }
      lat.push(performance.now() - t0); reqs++;
      if (!r.ok && r.status !== 400 && r.status !== 422) errs++;
      await sleep(40);
    }
  }
  await Promise.all(tokens.map((tok, i) => worker(tok, WORLDS[i % WORLDS.length])));

  const after = await metrics();

  // Per-world shard restart check (only meaningful when sharding is on).
  let totalRestarts = 0, sharded = false;
  for (const w of WORLDS) {
    const r = await jfetch(`/api/worlds/${w}/health`);
    if (r.json?.sharded) sharded = true;
    if (typeof r.json?.restartCount === "number") totalRestarts += r.json.restartCount;
  }

  const ticks = (after.concord_heartbeat_ticks_total ?? 0) - (before.concord_heartbeat_ticks_total ?? 0);
  const skips = (after.concord_heartbeat_skipped_total ?? 0) - (before.concord_heartbeat_skipped_total ?? 0);
  const tmo = (after.concord_heartbeat_module_timeout_total ?? 0) - (before.concord_heartbeat_module_timeout_total ?? 0);
  const sorted = lat.slice().sort((a, b) => a - b);
  const p = (q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((q / 100) * sorted.length))] : 0;

  console.log(`\n--- Load (${DURATION_S}s) ---`);
  console.log(`Requests: ${reqs}  errors: ${errs}  | HTTP p50 ${p(50).toFixed(0)}ms p95 ${p(95).toFixed(0)}ms p99 ${p(99).toFixed(0)}ms (informational)`);
  console.log(`--- Heartbeat (hard gates) ---`);
  console.log(`Ticks fired:     ${ticks}`);
  console.log(`Ticks SKIPPED:   ${skips}`);
  console.log(`Module timeouts: ${tmo}`);
  console.log(`Shard restarts:  ${totalRestarts}  (sharded=${sharded})`);

  const failures = [];
  if (ticks <= 0) failures.push("governor did not tick during the load window (frozen loop)");
  if (skips > 0) failures.push(`${skips} heartbeat tick(s) skipped — governorTick is overrunning its interval (clog)`);
  if (tmo > 0) failures.push(`${tmo} heartbeat module timeout(s) — a module exceeded CONCORD_HEARTBEAT_MODULE_TIMEOUT_MS`);
  if (totalRestarts > 0) failures.push(`${totalRestarts} world-shard restart(s) — a shard crash-looped under load`);

  if (failures.length) {
    for (const f of failures) console.error(`::error::tick-SLO violation: ${f}`);
    process.exit(1);
  }
  console.log("\n✓ tick-SLO holds: no skips, no module timeouts, no shard restarts, governor live.\n");
}

main().catch((e) => { console.error("::error::ci-tick-slo crashed:", e?.message || e); process.exit(1); });
