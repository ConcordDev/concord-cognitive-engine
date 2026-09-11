// server/tests/incident-engine/acceptance.manual.js
//
// B.5 — Independent evaluator for Incident Engine organ.
//
// Run with: node server/tests/incident-engine/acceptance.manual.js

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const BACKEND = process.env.CONCORD_BACKEND || "http://127.0.0.1:5050";
const DB_PATH = `${process.env.HOME}/.local/share/concord/incident-engine.db`;
const BROWSER_ORGAN_DB = `${process.env.HOME}/.local/share/concord/browser_organ.db`;

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
    signal: AbortSignal.timeout(60000),
  });
  return await r.json();
}

function dbCount(table) {
  const out = execFileSync("sqlite3", [DB_PATH, `SELECT COUNT(*) FROM ${table};`]).toString().trim();
  return parseInt(out, 10);
}

console.log("B.5 — Incident Engine independent evaluator\n");

console.log("Section A — Classification (3 tests)\n");

await test("A1: incident_classify returns known class for concord_backend_down", async () => {
  const r = await callMCP("incident_classify", { signal: { source: "concord_health", ok: false } });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.equal(obs.incident_class, "concord_backend_down");
  assert.equal(obs.severity, "critical");
  assert.equal(obs.escalate_to, "operator");
})();

await test("A2: incident_classify returns recovery for browser_organ_observation_stale", async () => {
  const r = await callMCP("incident_classify", {
    signal: { kind: "browser_organ_observation_stale", age_seconds: 2400 }
  });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.equal(obs.incident_class, "browser_organ_observation_stale");
  assert.equal(obs.recovery_action, "re_run_browser_organ");
})();

await test("A3: incident_classify returns unknown_class for unrecognized signal", async () => {
  const r = await callMCP("incident_classify", {
    signal: { source: "never_seen", kind: "totally_novel_pattern" }
  });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.equal(obs.incident_class, "unknown_class");
  // unknown_class always escalates to operator (per classify logic)
  assert.equal(obs.escalate_to, "operator");
})();

console.log("\nSection B — incident_active + history (2 tests)\n");

await test("B1: incident_active returns currently-active incidents (active or recovering)", async () => {
  const r = await callMCP("incident_active", {});
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(Array.isArray(obs.incidents));
  // Each incident should have the expected schema
  for (const inc of obs.incidents) {
    assert.ok(inc.id);
    assert.ok(inc.incident_class);
    assert.ok(["active", "recovering", "resolved", "escalated", "observed"].includes(inc.status));
  }
})();

await test("B2: incident_history returns recent incidents", async () => {
  const r = await callMCP("incident_history", { since_minutes: 60, limit: 20 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(obs.history.length >= 1);
  // Check ordering (newest first)
  for (let i = 1; i < obs.history.length; i++) {
    assert.ok(obs.history[i-1].detected_at >= obs.history[i].detected_at, "not sorted by detected_at DESC");
  }
})();

console.log("\nSection C — Recovery flow (3 tests)\n");

await test("C1: incident_recover with dry_run does not execute real action", async () => {
  // Find an existing incident (or create one via classify)
  const r = await callMCP("incident_recover", {
    incident_id: 1,  // any ID, dry_run is the focus
    recovery_action: "re_run_browser_organ",
    dry_run: true,
  });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.equal(obs.dry_run, true);
  assert.equal(obs.ok, true);
  assert.match(obs.detail, /dry_run_no_action/);
})();

await test("C2: incident_recover with real incident_id transitions through states", async () => {
  // Create a synthetic browser_organ_observation_stale by backdating browser_organ DB
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  execFileSync("sqlite3", [BROWSER_ORGAN_DB, `UPDATE observations SET observed_at = '${twoHoursAgo}';`]);

  // Clear dedupe
  execFileSync("sqlite3", [DB_PATH,
    "DELETE FROM incident_state WHERE incident_class = 'browser_organ_observation_stale';"]);

  // Run incident_watch to create an incident
  const w = await callMCP("incident_watch", { since_minutes: 180 });
  assert.equal(w.ok, true);
  const results = w.result.observation.results;
  const stale = results.find(r => r.incident_class === "browser_organ_observation_stale");
  assert.ok(stale, "browser_organ_observation_stale incident should be created");
  assert.equal(stale.status, "resolved", `expected resolved, got ${stale.status}`);
  assert.equal(stale.outcome, "recovery_succeeded");
  // Verify recovery action recorded
  const recovery_action = stale.actions.find(a => a.action === "re_run_browser_organ");
  assert.ok(recovery_action);
  assert.equal(recovery_action.ok, true);
})();

await test("C3: recovery_succeeded produces incident_actions row", async () => {
  const before = dbCount("incident_actions");
  // Trigger another recovery via classify + watch cycle
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  execFileSync("sqlite3", [BROWSER_ORGAN_DB, `UPDATE observations SET observed_at = '${twoHoursAgo}';`]);
  execFileSync("sqlite3", [DB_PATH,
    "DELETE FROM incident_state WHERE incident_class = 'browser_organ_observation_stale';"]);
  await callMCP("incident_watch", { since_minutes: 180 });
  // Wait a moment for write
  await new Promise(r => setTimeout(r, 200));
  const after = dbCount("incident_actions");
  assert.ok(after > before, `incident_actions should grow: ${before} -> ${after}`);
})();

console.log("\nSection D — Dedupe (1 test)\n");

await test("D1: same incident_class from same source is deduped within 5 min", async () => {
  // Force backdated stale
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  execFileSync("sqlite3", [BROWSER_ORGAN_DB, `UPDATE observations SET observed_at = '${twoHoursAgo}';`]);
  execFileSync("sqlite3", [DB_PATH,
    "DELETE FROM incident_state WHERE incident_class = 'browser_organ_observation_stale';"]);
  const r1 = await callMCP("incident_watch", { since_minutes: 180 });
  const r2 = await callMCP("incident_watch", { since_minutes: 180 });
  // First call should resolve the stale incident
  const r1_stale = r1.result.observation.results.find(r => r.incident_class === "browser_organ_observation_stale");
  assert.ok(r1_stale);
  assert.equal(r1_stale.status, "resolved");
  // Second call: signal was observed (browser_organ is still stale), but dedupe suppresses.
  // The signal may or may not appear in results depending on dedupe, but if it does
  // it should be deduped.
  const r2_stale = r2.result.observation.results.find(r => r.incident_class === "browser_organ_observation_stale");
  if (r2_stale) {
    assert.equal(r2_stale.status, "deduped");
  }
  // Either way: dedupe is working (no second resolution)
  const all_stale = execFileSync("sqlite3", [DB_PATH,
    "SELECT id, status FROM incident_state WHERE incident_class = 'browser_organ_observation_stale';"]).toString();
  const resolved_count = (all_stale.match(/resolved/g) || []).length;
  assert.equal(resolved_count, 1, "should have exactly 1 resolved incident");
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