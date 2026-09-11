// server/tests/trace-fabric/acceptance.manual.js
//
// F3.4 — Independent evaluator for Trace Fabric organ.
//
// Run with: node server/tests/trace-fabric/acceptance.manual.js

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const BACKEND = process.env.CONCORD_BACKEND || "http://127.0.0.1:5050";
const DB_PATH = `${process.env.HOME}/.local/share/concord/trace-fabric.db`;

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
    signal: AbortSignal.timeout(30000),
  });
  return await r.json();
}

function dbCount(table) {
  const out = execFileSync("sqlite3", [DB_PATH, `SELECT COUNT(*) FROM ${table};`]).toString().trim();
  return parseInt(out, 10);
}

function dbQuery(sql) {
  return execFileSync("sqlite3", ["-separator", "|", DB_PATH, sql]).toString().trim();
}

console.log("F3.4 — Trace Fabric Organ independent evaluator\n");

console.log("Section A — Tools return real data (4 tests)\n");

await test("A1: trace_lookup returns events for a known trace_id", async () => {
  const traceId = uniqueTraceId("a1");
  await callMCP("browser_check_incidents", {}, traceId);
  // Allow async write to complete
  await new Promise(r => setTimeout(r, 500));
  const r = await callMCP("trace_lookup", { trace_id: traceId });
  assert.equal(r.ok, true);
  const events = r.result.observation.events;
  assert.ok(events.length >= 1, `expected at least 1 event, got ${events.length}`);
})();

await test("A2: trace_recent returns recent distinct trace_ids", async () => {
  const r = await callMCP("trace_recent", { since_minutes: 5, limit: 5 });
  assert.equal(r.ok, true);
  const traces = r.result.observation.traces;
  assert.ok(Array.isArray(traces));
  assert.ok(traces.length >= 1);
  // Each trace should have trace_id, event_count
  for (const t of traces) {
    assert.ok(t.trace_id);
    assert.ok(t.event_count >= 1);
  }
})();

await test("A3: trace_tool_history returns events for browser_check_incidents", async () => {
  const r = await callMCP("trace_tool_history", { tool_name: "browser_check_incidents", since_minutes: 60, limit: 5 });
  assert.equal(r.ok, true);
  const events = r.result.observation.events;
  assert.ok(events.length >= 1);
  for (const e of events) {
    assert.equal(e.tool_name, "browser_check_incidents");
  }
})();

await test("A4: trace_record writes a custom event", async () => {
  const traceId = uniqueTraceId("a4");
  const r = await callMCP("trace_record", {
    source: "test",
    source_event: "test_event",
    tool_name: "test_tool",
    payload: { foo: "bar" },
  }, traceId);
  assert.equal(r.ok, true);
  assert.ok(r.result.observation.event_id > 0);
})();

console.log("\nSection B — F0 integration (3 tests)\n");

await test("B1: F0 dispatch writes tool_call_started + tool_call_completed events", async () => {
  const traceId = uniqueTraceId("b1");
  await callMCP("browser_check_incidents", {}, traceId);
  await new Promise(r => setTimeout(r, 500));
  const r = await callMCP("trace_lookup", { trace_id: traceId });
  const events = r.result.observation.events;
  const eventTypes = events.map(e => e.source_event);
  assert.ok(eventTypes.includes("tool_call_started"), `missing tool_call_started: ${eventTypes.join(",")}`);
  assert.ok(eventTypes.includes("tool_call_completed"), `missing tool_call_completed: ${eventTypes.join(",")}`);
})();

await test("B2: tool_call_completed event has duration_ms", async () => {
  const traceId = uniqueTraceId("b2");
  await callMCP("browser_check_incidents", {}, traceId);
  await new Promise(r => setTimeout(r, 500));
  const r = await callMCP("trace_lookup", { trace_id: traceId });
  const events = r.result.observation.events;
  const completed = events.find(e => e.source_event === "tool_call_completed");
  assert.ok(completed, "no tool_call_completed event");
  assert.ok(completed.duration_ms !== null && completed.duration_ms >= 0, `duration_ms was ${completed.duration_ms}`);
})();

await test("B3: trace_backfill populates from browser_organ + sentinel DBs", async () => {
  const before = dbCount("trace_correlation");
  const r = await callMCP("trace_backfill", {});
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  // Either backfill was useful (browser_organ > 0 or sentinel > 0) or no new events
  assert.ok(obs.browser_organ.backfilled !== undefined);
  assert.ok(obs.sentinel.backfilled !== undefined);
  // Total events should not decrease
  const after = dbCount("trace_correlation");
  assert.ok(after >= before, `events went down: ${before} -> ${after}`);
})();

console.log("\nSection C — Persistence + integration (2 tests)\n");

await test("C1: trace_correlation table has expected schema", async () => {
  const out = dbQuery("PRAGMA table_info(trace_correlation);");
  for (const col of ["id", "trace_id", "source", "source_event", "tool_name", "observed_at", "payload_json"]) {
    assert.ok(out.includes(col), `missing column: ${col}`);
  }
})();

await test("C2: trace_root_cause returns first event for a known trace", async () => {
  const traceId = uniqueTraceId("c2");
  await callMCP("browser_check_incidents", {}, traceId);
  await new Promise(r => setTimeout(r, 500));
  const r = await callMCP("trace_root_cause", { trace_id: traceId });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.equal(obs.found, true);
  assert.ok(obs.first_event);
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