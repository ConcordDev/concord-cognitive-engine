#!/usr/bin/env node
/**
 * Concord — Synthetic Load Test
 *
 * Simulates N concurrent users hammering the macro layer for the
 * Phase 1-6 surfaces. Reports p50/p95/p99 latency, throughput, and
 * any rate-limit blocks observed.
 *
 * Usage:
 *   BASE_URL=http://localhost:5050 \
 *   AUTH_TOKEN=<jwt> \
 *   USERS=50 DURATION_S=60 \
 *   node monitoring/synthetic/load-test.js
 *
 * Sends a mixture of read + write traffic across the macro endpoints
 * shipped in phases 1-6. Reports a structured summary at the end.
 *
 * Heartbeats run on their own clock and aren't load-tested here —
 * monitor `concord_heartbeat_skipped_total` separately while the test
 * runs to confirm the substrate stays under tick budget.
 */

const BASE_URL    = process.env.BASE_URL    || "http://localhost:5050";
const AUTH_TOKEN  = process.env.AUTH_TOKEN  || null;
const USERS       = parseInt(process.env.USERS || "20", 10);
const DURATION_S  = parseInt(process.env.DURATION_S || "30", 10);
const REQUESTS_PER_USER_PER_S = parseFloat(process.env.RPS_PER_USER || "1.0");

// Mix of macros to invoke. Weight = relative frequency.
const MACROS = [
  { domain: "discovery",        name: "search",            input: { query: "kael" },         weight: 6 },
  { domain: "discovery",        name: "facets",            input: {},                        weight: 2 },
  { domain: "discovery",        name: "trending",          input: { limit: 10 },             weight: 2 },
  { domain: "beats",            name: "list",              input: {},                        weight: 4 },
  { domain: "land_claims",      name: "list_for_user",     input: {},                        weight: 2 },
  { domain: "land_claims",      name: "claim_at",          input: { worldId: "concordia-hub", x: 50, z: 50 }, weight: 3 },
  { domain: "glyph_spells",     name: "list_components",   input: {},                        weight: 2 },
  { domain: "knowledge_trade",  name: "mentorship_list_for_student", input: {},              weight: 2 },
  { domain: "forge_marketplace",name: "list_for_user",     input: {},                        weight: 2 },
];

const totalWeight = MACROS.reduce((s, m) => s + m.weight, 0);

function pickMacro() {
  let r = Math.random() * totalWeight;
  for (const m of MACROS) {
    r -= m.weight;
    if (r <= 0) return m;
  }
  return MACROS[0];
}

const stats = {
  total: 0, ok: 0, fail: 0, rateLimited: 0,
  durations: [],
  byDomain: new Map(),
};

function recordDuration(domain, name, ms, ok, rateLimited = false) {
  stats.total++;
  if (ok) stats.ok++; else stats.fail++;
  if (rateLimited) stats.rateLimited++;
  stats.durations.push(ms);
  const key = `${domain}.${name}`;
  const slot = stats.byDomain.get(key) || { n: 0, ok: 0, fail: 0, durs: [] };
  slot.n++;
  if (ok) slot.ok++; else slot.fail++;
  slot.durs.push(ms);
  stats.byDomain.set(key, slot);
}

async function fireOne() {
  const m = pickMacro();
  const start = Date.now();
  try {
    const headers = { "content-type": "application/json" };
    if (AUTH_TOKEN) headers["authorization"] = `Bearer ${AUTH_TOKEN}`;
    const res = await fetch(`${BASE_URL}/api/lens/run`, {
      method: "POST", headers,
      body: JSON.stringify({ domain: m.domain, name: m.name, input: m.input }),
    });
    const ms = Date.now() - start;
    if (res.status === 429) {
      recordDuration(m.domain, m.name, ms, false, true);
      return;
    }
    recordDuration(m.domain, m.name, ms, res.ok);
  } catch (_err) {
    recordDuration(m.domain, m.name, Date.now() - start, false);
  }
}

async function userLoop(userIdx, deadline) {
  const interval = 1000 / REQUESTS_PER_USER_PER_S;
  while (Date.now() < deadline) {
    await fireOne();
    // Jitter to avoid coordinated bursts.
    const jittered = interval * (0.5 + Math.random());
    await new Promise(r => setTimeout(r, jittered));
  }
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

async function main() {
  console.log(`Load test — ${USERS} users × ${REQUESTS_PER_USER_PER_S} rps × ${DURATION_S}s = ~${USERS * REQUESTS_PER_USER_PER_S * DURATION_S} total requests`);
  console.log(`Target: ${BASE_URL}`);
  console.log("");

  const deadline = Date.now() + DURATION_S * 1000;
  const users = Array.from({ length: USERS }, (_, i) => userLoop(i, deadline));
  await Promise.all(users);

  // Summary
  const p50 = percentile(stats.durations, 0.50);
  const p95 = percentile(stats.durations, 0.95);
  const p99 = percentile(stats.durations, 0.99);
  const throughput = stats.total / DURATION_S;

  console.log("=== Load Test Summary ===");
  console.log(`Total requests:    ${stats.total}`);
  console.log(`Throughput:        ${throughput.toFixed(1)} req/s`);
  console.log(`OK:                ${stats.ok}`);
  console.log(`Failed:            ${stats.fail}`);
  console.log(`Rate-limited (429): ${stats.rateLimited}`);
  console.log(`Latency p50/p95/p99: ${p50}ms / ${p95}ms / ${p99}ms`);
  console.log("");
  console.log("=== Per-domain ===");
  for (const [key, slot] of stats.byDomain) {
    const p95k = percentile(slot.durs, 0.95);
    console.log(`${key.padEnd(40)} n=${slot.n.toString().padEnd(6)} ok=${slot.ok} fail=${slot.fail} p95=${p95k}ms`);
  }
  console.log("");
  if (stats.fail / Math.max(1, stats.total) > 0.05) {
    console.error(`FAIL: error rate ${((stats.fail / stats.total) * 100).toFixed(1)}% > 5%`);
    process.exit(1);
  }
  if (p95 > 2000) {
    console.error(`WARN: p95 ${p95}ms > 2000ms`);
    process.exit(2);
  }
  console.log("PASS: error rate < 5%, p95 < 2000ms");
}

main().catch(err => {
  console.error("load-test crashed:", err);
  process.exit(1);
});
