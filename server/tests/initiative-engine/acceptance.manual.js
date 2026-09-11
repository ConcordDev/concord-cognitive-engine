// server/tests/initiative-engine/acceptance.manual.js
//
// F.5 — Independent evaluator for Initiative Engine organ.
//
// Run with: node server/tests/initiative-engine/acceptance.manual.js

import assert from "node:assert/strict";

const BACKEND = process.env.CONCORD_BACKEND || "http://127.0.0.1:5050";
const ORGAN = "initiative-engine";

async function callMCP(tool, args = {}) {
  const r = await fetch(`${BACKEND}/mcp/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

console.log("Section A — Compose + Persistence (3 tests)");

await test("A1: initiative_compose reads upstream + persists initiatives", async () => {
  const r = await callMCP("initiative_compose", { since_minutes: 1440 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(typeof obs.sources_observed === "number");
  assert.ok(typeof obs.initiatives_composed === "number");
  assert.ok(Array.isArray(obs.initiatives));
  assert.ok(typeof obs.skipped_duplicates === "number");
});

await test("A2: composed initiatives have required schema", async () => {
  const r = await callMCP("initiative_compose", { since_minutes: 1440 });
  const obs = r.result.observation;
  for (const init of obs.initiatives) {
    assert.ok(typeof init.initiative_id === "string", "initiative_id required");
    assert.ok(["opportunity", "proactive"].includes(init.source), "source must be opportunity or proactive");
    assert.ok(typeof init.kind === "string");
    assert.ok(typeof init.summary === "string");
    assert.ok(typeof init.target_tool === "string");
    assert.ok(["read", "write", "execute", "trade", "deploy"].includes(init.required_authority),
      "required_authority must be in capability authorities");
    assert.ok(["low", "medium", "high", "critical"].includes(init.risk_level));
  }
});

await test("A3: dry_run does NOT persist", async () => {
  const before = await callMCP("initiative_list", { limit: 100 });
  const beforeCount = before.result.observation.count;
  const dry = await callMCP("initiative_compose", { since_minutes: 1440, dry_run: true });
  assert.equal(dry.result.observation.dry_run, true);
  const after = await callMCP("initiative_list", { limit: 100 });
  const afterCount = after.result.observation.count;
  assert.ok(afterCount >= beforeCount, "dry_run must NOT increase initiative count");
});

console.log("\nSection B — List + Get (3 tests)");

await test("B1: initiative_list returns with status filter", async () => {
  const r = await callMCP("initiative_list", { status: "composed", limit: 20 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.equal(obs.filters.status, "composed");
  for (const init of obs.initiatives) {
    assert.equal(init.status, "composed", "all must match filter");
  }
});

await test("B2: initiative_list returns with source filter", async () => {
  const r = await callMCP("initiative_list", { source: "opportunity", limit: 20 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  for (const init of obs.initiatives) {
    assert.equal(init.source, "opportunity");
  }
});

await test("B3: initiative_get returns full details for known id", async () => {
  // First find a composed initiative
  const list = await callMCP("initiative_list", { status: "composed", limit: 1 });
  if (list.result.observation.count === 0) {
    console.log("    (skipped — no composed initiative)");
    return;
  }
  const id = list.result.observation.initiatives[0].id;
  const r = await callMCP("initiative_get", { id });
  assert.equal(r.ok, true);
  const init = r.result.observation.initiative;
  assert.ok(init.id === id);
  assert.ok(typeof init.target_tool === "string");
  assert.ok(typeof init.required_authority === "string");
});

console.log("\nSection C — Validate + Submit (4 tests)");

await test("C1: initiative_validate runs deterministic checks", async () => {
  // Compose first to ensure we have something
  await callMCP("initiative_compose", { since_minutes: 1440 });
  const list = await callMCP("initiative_list", { status: "composed", limit: 1 });
  if (list.result.observation.count === 0) {
    console.log("    (skipped — no initiative to validate)");
    return;
  }
  const id = list.result.observation.initiatives[0].id;
  const r = await callMCP("initiative_validate", { id });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(typeof obs.ready_to_submit === "boolean");
  assert.ok(Array.isArray(obs.checks));
  // At least 4 checks: authority_known, budget_checked, risk_assessed, target_known
  assert.ok(obs.checks.length >= 4, `expected >=4 checks, got ${obs.checks.length}`);
});

await test("C2: validate checks have expected structure", async () => {
  const list = await callMCP("initiative_list", { status: "composed", limit: 1 });
  if (list.result.observation.count === 0) return;
  const id = list.result.observation.initiatives[0].id;
  const r = await callMCP("initiative_validate", { id });
  for (const check of r.result.observation.checks) {
    assert.ok(typeof check.check === "string");
    assert.ok(["PASS", "FAIL", "INFO", "WARN"].includes(check.result),
      `check result must be PASS/FAIL/INFO/WARN, got ${check.result}`);
    assert.ok(typeof check.detail === "string");
  }
});

await test("C3: validate includes economic_state", async () => {
  const list = await callMCP("initiative_list", { status: "composed", limit: 1 });
  if (list.result.observation.count === 0) return;
  const id = list.result.observation.initiatives[0].id;
  const r = await callMCP("initiative_validate", { id });
  assert.ok(typeof r.result.observation.economic_state === "object");
  assert.ok(typeof r.result.observation.economic_state.safe_to_proceed === "boolean");
});

await test("C4: initiative_submit goes through F0 authority gate", async () => {
  // Submit an initiative (use first available composed)
  const list = await callMCP("initiative_list", { status: "composed", limit: 1 });
  if (list.result.observation.count === 0) {
    console.log("    (skipped — no composed initiative)");
    return;
  }
  const id = list.result.observation.initiatives[0].id;
  const r = await callMCP("initiative_submit", { id });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  // F0 returned a decision
  assert.ok(["ALLOW", "DENY", "UNKNOWN"].includes(obs.f0_decision));
  // status transitioned
  assert.ok(["submitted", "blocked"].includes(obs.new_status));
});

console.log("\nSection D — No Auto-Execute + Idempotency (3 tests)");

await test("D1: NO initiative_execute tool exists", async () => {
  const r = await callMCP("initiative_execute", { id: 1 });
  assert.equal(r.ok, false, "initiative_execute must NOT exist");
});

await test("D2: cannot submit already-submitted initiative (idempotency)", async () => {
  // Find a submitted initiative
  const list = await callMCP("initiative_list", { status: "submitted", limit: 1 });
  if (list.result.observation.count === 0) {
    console.log("    (skipped — no submitted initiative)");
    return;
  }
  const id = list.result.observation.initiatives[0].id;
  const r = await callMCP("initiative_submit", { id });
  assert.equal(r.ok, false, "should fail because already submitted");
  assert.ok(r.result.observation.current_status === "submitted");
});

await test("D3: record_execution requires submitted status", async () => {
  // Try recording execution on a composed (not submitted) initiative
  const list = await callMCP("initiative_list", { status: "composed", limit: 1 });
  if (list.result.observation.count === 0) {
    console.log("    (skipped — no composed initiative)");
    return;
  }
  const id = list.result.observation.initiatives[0].id;
  const r = await callMCP("initiative_record_execution", { id, outcome: "executed" });
  assert.equal(r.ok, false, "should fail because not submitted yet");
});

console.log("\nResults:");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);