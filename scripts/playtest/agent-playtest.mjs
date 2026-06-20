#!/usr/bin/env node
// scripts/playtest/agent-playtest.mjs
//
// Instrument 2 (headless API tier) — drives the REAL server through the keystone
// journeys as a synthetic player and judges LIVENESS (liveness.mjs) + collects
// the no-silent-fallback log. Run it against a booted dev server:
//
//   CONCORD_BASE_URL=http://localhost:5050 node scripts/playtest/agent-playtest.mjs [--ci]
//
// Most of the gap lives at this layer — no pixels needed (the visual/LLaVA
// render-parity tier is separate). The pure liveness framework + journey defs
// are unit-tested headlessly in server/tests/playtest-liveness.test.js; this is
// the thin real-world driver. Degrades gracefully when a capability is absent.

import { runJourneys } from "./liveness.mjs";
import { KEYSTONE_JOURNEYS } from "./journeys.mjs";

const BASE = process.env.CONCORD_BASE_URL || "http://localhost:5050";
const WORLD = process.env.CONCORD_PLAYTEST_WORLD || "concordia-hub";
const ci = process.argv.includes("--ci");
// A browser-like UA so the server's botGuardMiddleware admits the register/login
// calls (authenticated calls bypass it; this is only needed pre-token).
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function api(method, path, body, token) {
  const headers = { "content-type": "application/json", "user-agent": UA };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body == null ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, ok: res.ok, ...(json && typeof json === "object" ? json : { data: json }) };
}

async function register() {
  const u = `playtest_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
  // Real public endpoint is /api/auth/register (not /signup).
  const r = await api("POST", "/api/auth/register", { username: u, password: "Playtest-pw-123!", email: `${u}@playtest.local`, dateOfBirth: "1990-01-01" });
  return r.token || r.accessToken || r.user?.token || r.data?.token || null;
}

// Optional socket.io event collection — degrades to [] if the client isn't installed.
async function makeEventSink(token) {
  const events = [];
  try {
    const { io } = await import("socket.io-client");
    const sock = io(BASE, { auth: { token }, transports: ["websocket"], reconnection: false });
    sock.onAny((name) => events.push({ name }));
    return { events: () => events.slice(), close: () => sock.close() };
  } catch {
    return { events: () => events, close: () => {} };
  }
}

async function driverFor() {
  const token = await register();
  const sink = await makeEventSink(token);
  return {
    async call(domain, name, input) {
      // /api/lens/run returns { ok, result } — unwrap result for the caller.
      const r = await api("POST", "/api/lens/run", { domain, name, input }, token);
      return r && r.result !== undefined ? { ok: r.ok !== false, ...r.result } : r;
    },
    async http(method, path, body) { return api(method, path, body, token); },
    async snapshot() {
      // No /world-state endpoint; compose from the real surfaces:
      //   NPC positions ← GET /api/worlds/:world/npcs ; pit water ← terrain.water_depth macro.
      const npcRes = await api("GET", `/api/worlds/${WORLD}/npcs`, null, token);
      const npcs = (npcRes.npcs || npcRes.result?.npcs || []).map((n) => ({
        id: n.id, x: n.position?.x ?? n.x ?? 0, z: n.position?.z ?? n.z ?? 0,
      }));
      const wd = await api("POST", "/api/lens/run", { domain: "terrain", name: "water_depth", input: { x: 10, z: 10, worldId: WORLD } }, token);
      const water = wd.result?.waterDepth ?? wd.waterDepth ?? 0;
      return { npcs, pit: { water_height: water }, wallet: { cc: 0 } };
    },
    events() { return sink.events(); },
    async tick(n = 1) {
      // Two tick modes. Hydrology advances on demand via terrain.flow_tick (instant).
      // NPC/creature liveness only advances on the real heartbeat (governor 15s,
      // NPC routine ~75s, creature flock ~60s), so the world-alive journey needs
      // REAL elapsed time — set CONCORD_PLAYTEST_REALTIME_TICK=1 for it.
      if (process.env.CONCORD_PLAYTEST_REALTIME_TICK === "1") {
        const ms = Math.min(n * 15000, Number(process.env.CONCORD_PLAYTEST_MAX_WAIT_MS) || 150000);
        await new Promise((res) => setTimeout(res, ms));
        return;
      }
      let advanced = false;
      try {
        const r = await api("POST", "/api/lens/run", { domain: "terrain", name: "flow_tick", input: { worldId: WORLD, steps: n } }, token);
        advanced = r.ok !== false;
      } catch { /* no flow_tick */ }
      if (!advanced) await new Promise((res) => setTimeout(res, Math.min(n * 15000, 60000)));
    },
    drainFallbacks() { return []; }, // server logs fallbacks; CI parses them from the run log
    _close: () => sink.close(),
  };
}

(async () => {
  let report;
  try {
    // Register ONCE and reuse the driver across journeys. runJourneys calls the
    // factory per journey; registering per journey bursts /api/auth/register and
    // trips its per-IP rate-limit (so journeys 2+ get no token and falsely fail).
    // One synthetic player running all journeys is also the realistic shape.
    const sharedDriver = await driverFor();
    // Run one journey at a time when CONCORD_PLAYTEST_ONLY=<journey.id> is set
    // (deliberate, examined-per-journey runs), else all keystones.
    const only = process.env.CONCORD_PLAYTEST_ONLY;
    const journeys = only ? KEYSTONE_JOURNEYS.filter((j) => j.id === only) : KEYSTONE_JOURNEYS;
    if (only && journeys.length === 0) {
      console.error(`[agent-playtest] no journey with id="${only}" (have: ${KEYSTONE_JOURNEYS.map((j) => j.id).join(", ")})`);
      process.exit(ci ? 1 : 0);
      return;
    }
    report = await runJourneys(journeys, () => sharedDriver);
  } catch (e) {
    console.error(`[agent-playtest] could not reach server at ${BASE}: ${e?.message || e}`);
    process.exit(ci ? 1 : 0);
    return;
  }
  console.log(`\n=== Agent Playtest (headless API) — ${report.alive}/${report.total} journeys alive ===`);
  for (const j of report.journeys) {
    console.log(`\n  ${j.alive ? "✓" : "✗"} ${j.label} — ${j.summary}`);
    for (const s of j.steps) {
      for (const c of s.checks) if (!c.ok) console.log(`      ✗ [${s.step}] ${c.assertion}${c.detail ? " — " + c.detail : ""}`);
    }
  }
  console.log("");
  if (ci && report.alive < report.total) process.exit(1);
})();
