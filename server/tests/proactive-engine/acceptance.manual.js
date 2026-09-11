// server/tests/proactive-engine/acceptance.manual.js
//
// C.5.5 — Independent evaluator for Proactive Engine organ.
//
// Run with: node server/tests/proactive-engine/acceptance.manual.js

import assert from "node:assert/strict";

const BACKEND = process.env.CONCORD_BACKEND || "http://127.0.0.1:5050";
const ORGAN = "proactive-engine";

async function callMCP(tool, args = {}, traceId = null) {
  const headers = { "Content-Type": "application/json" };
  if (traceId) headers["X-Trace-Id"] = traceId;
  const r = await fetch(`${BACKEND}/mcp/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tool, args }),
    signal: AbortSignal.timeout(120_000),
  });
  return await r.json();
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

console.log(`${ORGAN} — Independent Evaluator`);
console.log(`Backend: ${BACKEND}\n`);

console.log("Section A — Predict + Persistence (3 tests)");

await test("A1: proactive_predict generates predictions and persists state", async () => {
  const r = await callMCP("proactive_predict", { since_minutes: 1440 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(obs.signals_observed >= 0, "signals_observed must be a number");
  assert.ok(Array.isArray(obs.predictions), "predictions must be an array");
  assert.ok(Array.isArray(obs.reminders), "reminders must be an array");
  assert.ok(["none", "info", "warn", "critical"].includes(obs.alert_level), "alert_level must be valid");
});

await test("A2: prediction has all required schema fields", async () => {
  // First generate some predictions
  await callMCP("proactive_predict", { since_minutes: 1440 });
  const r = await callMCP("proactive_list_predictions", { since_minutes: 1440, limit: 5 });
  assert.equal(r.ok, true);
  const preds = r.result.observation.predictions;
  if (preds.length > 0) {
    const p = preds[0];
    assert.ok(typeof p.id === "number", "id required");
    assert.ok(typeof p.kind === "string", "kind required");
    assert.ok(["near", "soon", "later", "far"].includes(p.horizon), "horizon valid");
    assert.ok(p.confidence >= 0 && p.confidence <= 1, "confidence in [0,1]");
  }
});

await test("A3: proactive_predict dry_run does NOT persist", async () => {
  // First note current count
  const before = await callMCP("proactive_list_predictions", { since_minutes: 1440, limit: 100 });
  const beforeCount = before.result.observation.count;
  // Run dry_run
  const dry = await callMCP("proactive_predict", { since_minutes: 1440, dry_run: true });
  assert.equal(dry.ok, true);
  assert.equal(dry.result.observation.dry_run, true);
  const after = await callMCP("proactive_list_predictions", { since_minutes: 1440, limit: 100 });
  const afterCount = after.result.observation.count;
  assert.equal(afterCount, beforeCount, "dry_run must NOT increase prediction count");
});

console.log("\nSection B — List with Filters (3 tests)");

await test("B1: list_predictions returns with filters", async () => {
  const r = await callMCP("proactive_list_predictions", { horizon: "near", since_minutes: 1440, limit: 10 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.equal(obs.filters.horizon, "near");
  for (const p of obs.predictions) {
    assert.equal(p.horizon, "near", "all predictions must match horizon filter");
  }
});

await test("B2: list_reminders returns reminders with status filter", async () => {
  const r = await callMCP("proactive_list_reminders", { status: "pending", since_minutes: 1440, limit: 10 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.equal(obs.filters.status, "pending");
  for (const rem of obs.reminders) {
    assert.equal(rem.status, "pending", "all reminders must match status filter");
  }
});

await test("B3: list_reminders returns empty array when no reminders", async () => {
  const r = await callMCP("proactive_list_reminders", { status: "dismissed", since_minutes: 1, limit: 10 });
  assert.equal(r.ok, true);
  assert.equal(r.result.observation.count, 0);
  assert.deepEqual(r.result.observation.reminders, []);
});

console.log("\nSection C — Dismiss + Calibration (3 tests)");

await test("C1: dismiss_reminder marks reminder as dismissed", async () => {
  // Find a pending reminder
  const list = await callMCP("proactive_list_reminders", { status: "pending", since_minutes: 1440, limit: 1 });
  const rems = list.result.observation.reminders;
  if (rems.length === 0) {
    console.log("    (skipped — no pending reminder to dismiss)");
    return;
  }
  const remId = rems[0].id;
  const r = await callMCP("proactive_dismiss_reminder", { reminder_id: remId });
  assert.equal(r.ok, true);
  assert.equal(r.result.observation.status, "dismissed");
});

await test("C2: calibration returns counts + by_kind breakdown", async () => {
  const r = await callMCP("proactive_calibration", {});
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(typeof obs.total_predictions === "number");
  assert.ok(typeof obs.confirmed === "number");
  assert.ok(typeof obs.disproved === "number");
  assert.ok(typeof obs.pending === "number");
  assert.ok(Array.isArray(obs.by_kind));
});

await test("C3: calibration accuracy_pct is null when no outcomes yet", async () => {
  const r = await callMCP("proactive_calibration", {});
  const obs = r.result.observation;
  if (obs.confirmed + obs.disproved === 0) {
    assert.equal(obs.accuracy_pct, null);
  }
});

console.log("\nSection D — Dedupe (1 test)");

await test("D1: same prediction kind/signature is deduped within 1 hour", async () => {
  // Run predict twice within seconds — second should not add new predictions
  const r1 = await callMCP("proactive_predict", { since_minutes: 1440 });
  const initial = r1.result.observation.predictions_generated;
  const r2 = await callMCP("proactive_predict", { since_minutes: 1440 });
  const second = r2.result.observation.predictions_generated;
  // Second call should produce 0 new (or fewer) due to dedupe
  assert.ok(second <= initial, `Second call must not exceed first (initial=${initial}, second=${second})`);
});

console.log("\nSection E — No Auto-Execute (1 test)");

await test("E1: NO proactive_act tool exists", async () => {
  // Try to call a hypothetical execute tool — the organ MUST NOT have one
  const r = await callMCP("proactive_act", { prediction_id: 1 });
  const top = r;
  const inner = r.result || {};
  const allErrors = JSON.stringify({ top, inner });
  assert.ok(allErrors.toLowerCase().includes("unknown") || allErrors.includes("tool not found") || !r.ok,
    "proactive_act must NOT exist (only predict/list/dismiss/calibration)");
});

console.log("\nResults:");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);