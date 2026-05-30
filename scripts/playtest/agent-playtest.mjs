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
const ci = process.argv.includes("--ci");

async function api(method, path, body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body == null ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, ok: res.ok, ...(json && typeof json === "object" ? json : { data: json }) };
}

async function register() {
  const u = `playtest_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
  const r = await api("POST", "/api/auth/signup", { username: u, password: "playtest-pw-123", email: `${u}@playtest.local` });
  return r.token || r.accessToken || r.data?.token || null;
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
    async call(domain, name, input) { return api("POST", "/api/lens/run", { domain, name, input }, token); },
    async http(method, path, body) { return api(method, path, body, token); },
    async snapshot() { return (await api("GET", "/api/players/me/world-state", null, token)) || {}; },
    events() { return sink.events(); },
    async tick(n = 1) {
      // Prefer a test-only fast-tick if the server exposes one; else wait real ticks (capped).
      const r = await api("POST", "/api/admin/test/tick", { ticks: n }, token);
      if (!r.ok) await new Promise((res) => setTimeout(res, Math.min(n * 15000, 60000)));
    },
    drainFallbacks() { return []; }, // server logs fallbacks; CI parses them from the run log
    _close: () => sink.close(),
  };
}

(async () => {
  let report;
  try { report = await runJourneys(KEYSTONE_JOURNEYS, () => driverFor()); }
  catch (e) {
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
