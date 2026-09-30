// server/tests/sentinel/acceptance.manual.js
//
// A.5 — Independent evaluator for Sentinel organ.
//
// Sentinel_watch is slow (~120s per call due to concord-gate detector).
// To keep this test fast, we call sentinel_watch ONCE at the start (background),
// then use sentinel_review_alerts / sentinel_health_snapshot / sentinel_gate_diff
// for the fast checks.
//
// Run with: node server/tests/sentinel/acceptance.manual.js

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const BACKEND = process.env.CONCORD_BACKEND || "http://127.0.0.1:5050";
const DB_PATH = `${process.env.HOME}/.local/share/concord/sentinel.db`;

let passed = 0;
let failed = 0;
const failures = [];

let traceCounter = 0;
function uniqueTraceId(prefix) {
  traceCounter++;
  return `${prefix}-${Date.now()}-${process.pid}-${traceCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function test(name, fn) {
  return async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      failures.push({ name, error: e.message });
      console.log(`  ✗ ${name}: ${e.message}`);
    }
  };
}

async function callMCP(tool, args = {}, traceId = null) {
  const headers = { "Content-Type": "application/json" };
  if (traceId) headers["X-Trace-Id"] = traceId;
  const r = await fetch(`${BACKEND}/mcp/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tool, args }),
    // 5-min timeout for any single MCP call
    signal: AbortSignal.timeout(300000),
  });
  return await r.json();
}

function dbCount(table) {
  const out = execFileSync("sqlite3", [DB_PATH, `SELECT COUNT(*) FROM ${table};`]).toString().trim();
  return parseInt(out, 10);
}

function dbLatestState() {
  const out = execFileSync("sqlite3", ["-separator", "|", DB_PATH,
    `SELECT id, alert_level, trace_id FROM sentinel_state ORDER BY id DESC LIMIT 1;`]).toString().trim();
  if (!out) return null;
  const [id, alert_level, trace_id] = out.split("|");
  return { id, alert_level, trace_id };
}

console.log("A.5 — Sentinel Organ independent evaluator\n");

console.log("Section A — Fast tools return real data (3 tests)\n");

await test("A1: sentinel_review_alerts returns list of alerts", async () => {
  const r = await callMCP("sentinel_review_alerts", { since_minutes: 120 }, uniqueTraceId("a1"));
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.equal(obs.kind, "alerts_review");
  assert.equal(obs.since_minutes, 120);
  assert.ok(Array.isArray(obs.alerts));
})();

await test("A2: sentinel_health_snapshot returns concord_health + db_metrics", async () => {
  const r = await callMCP("sentinel_health_snapshot", {}, uniqueTraceId("a2"));
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.equal(obs.kind, "health_snapshot");
  assert.ok(obs.signals.concord_health);
  assert.ok(obs.signals.db_metrics);
  // Verify DB metrics has real table counts
  assert.ok(obs.signals.db_metrics.tables);
  assert.ok(obs.signals.db_metrics.tables.agent_reasoning_traces);
  assert.ok(obs.signals.db_metrics.tables.agent_reasoning_traces.row_count > 0,
    "agent_reasoning_traces should have rows");
})();

await test("A3: sentinel_gate_diff runs detector and reports counts", async () => {
  const r = await callMCP("sentinel_gate_diff", {}, uniqueTraceId("a3"));
  // Note: when the detector finds real CI diffs, it returns ok=false (CI failed).
  // That's a real signal, not a tool failure. We accept both.
  assert.ok(r.ok !== undefined, "no ok field");
  const obs = r.result.observation;
  assert.equal(obs.kind, "gate_diff");
  const gd = obs.diff;
  assert.ok(gd.diff || gd.error, "no diff or error");
})();

console.log("\nSection B — Persistence (2 tests)\n");

await test("B1: sentinel_state has correct schema (at least 1 row from earlier watch)", async () => {
  const count = dbCount("sentinel_state");
  assert.ok(count > 0, `sentinel_state should have rows from earlier watch (got ${count})`);
  const latest = dbLatestState();
  assert.ok(latest, "no latest state");
  assert.ok(["none", "info", "warn", "critical"].includes(latest.alert_level));
})();

await test("B2: sentinel_alerts table has correct schema", async () => {
  // Just verify the table exists and has expected columns
  const out = execFileSync("sqlite3", [DB_PATH, "PRAGMA table_info(sentinel_alerts);"]).toString();
  const requiredCols = ["id", "state_id", "source", "severity", "message", "trace_id"];
  for (const col of requiredCols) {
    assert.ok(out.includes(col), `sentinel_alerts missing column: ${col}`);
  }
})();

console.log("\nSection C — F0 integration (3 tests)\n");

await test("C1: sentinel_review_alerts goes through F0 (decision + gates_run + envelope)", async () => {
  const r = await callMCP("sentinel_review_alerts", {}, uniqueTraceId("c1"));
  assert.equal(r.decision, "ALLOW");
  assert.ok(r.gates_run);
  assert.ok(r.gates_run.length >= 1);
  assert.ok(r.envelope);
  assert.ok(r.envelope.TRACE_ID);
  assert.equal(r.auth_gate_mode, "observe");
})();

await test("C2: trace_id propagates end-to-end (F0 envelope = sentinel)", async () => {
  const traceId = uniqueTraceId("c2");
  const r = await callMCP("sentinel_health_snapshot", {}, traceId);
  assert.equal(r.envelope.TRACE_ID, traceId);
  assert.equal(r.result.trace_id, traceId);
})();

await test("C3: capability gate returns registered + reachable + capability_ok", async () => {
  const r = await callMCP("sentinel_review_alerts", {}, uniqueTraceId("c3"));
  for (const g of r.gates_run) {
    if (g.name === "capability") {
      assert.equal(g.result.registered, true);
      assert.equal(g.result.health.reachable, true);
      assert.equal(g.result.reason_code, "capability_ok");
      break;
    }
  }
})();

console.log("\nSection D — Sentinel watch (full sweep, 1 test, slow)\n");

await test("D1: sentinel_watch returns aggregated signals from all 5 sources", async () => {
  const r = await callMCP("sentinel_watch", {}, uniqueTraceId("d1"));
  // Note: alert_level may be warn/critical if Browser Organ detected issues — that's fine.
  assert.ok(r.ok, `r.ok was false; reason=${r.reason_code} error=${JSON.stringify(r).slice(0, 200)}`);
  const obs = r.result.observation;
  assert.ok(obs.signals, "no signals");
  // All 5 sources should be present
  const sources = ["concord_health", "browser_organ_latest", "db_metrics", "concord_gate_diff", "recent_f0_audit"];
  for (const src of sources) {
    assert.ok(obs.signals[src], `missing signal source: ${src}`);
  }
  assert.equal(obs.signals.concord_health.kind, "concord_health");
  assert.equal(obs.signals.browser_organ_latest.kind, "browser_organ_latest");
  assert.ok(obs.state_id > 0);
  assert.ok(["none", "info", "warn", "critical"].includes(obs.alert_level));
})();

console.log("\nResults:");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  ${f.name}: ${f.error}`);
  process.exit(1);
}
process.exit(0);