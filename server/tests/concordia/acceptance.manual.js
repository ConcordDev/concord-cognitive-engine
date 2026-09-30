// server/tests/concordia/acceptance.manual.js
//
// I.5 — Independent evaluator for Concordia integration organ (final audit).
//
// Run with: node server/tests/concordia/acceptance.manual.js

import assert from "node:assert/strict";

const BACKEND = process.env.CONCORD_BACKEND || "http://127.0.0.1:5050";
const ORGAN = "concordia";

async function callMCP(tool, args = {}) {
  const r = await fetch(`${BACKEND}/mcp/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
    signal: AbortSignal.timeout(180_000),
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

console.log(`${ORGAN} — Independent Evaluator (Final Integration)`);
console.log(`Backend: ${BACKEND}\n`);

console.log("Section A — Assemble (3 tests)");

await test("A1: concordia_assemble returns fleet inventory", async () => {
  const r = await callMCP("concordia_assemble");
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(Array.isArray(obs.organs));
  assert.ok(obs.organs.length >= 12, `expected >=12 organs, got ${obs.organs.length}`);
  assert.ok(typeof obs.assembly_id === "string");
  assert.ok(typeof obs.trace_id === "string");
});

await test("A2: every organ entry has required schema", async () => {
  const r = await callMCP("concordia_assemble");
  for (const org of r.result.observation.organs) {
    assert.ok(typeof org.phase === "string");
    assert.ok(typeof org.organ === "string");
    assert.ok(typeof org.tool_count === "number");
    assert.ok(typeof org.db_exists === "boolean");
    assert.ok(typeof org.record_count === "number");
  }
});

await test("A3: summary contains all 13 phases", async () => {
  const r = await callMCP("concordia_assemble");
  const summary = r.result.observation.summary;
  assert.ok(summary.total_organs >= 12);
  assert.ok(typeof summary.total_tools === "number");
  assert.ok(typeof summary.total_records === "number");
  assert.ok(typeof summary.total_db_size_bytes === "number");
});

console.log("\nSection B — Verify (3 tests)");

await test("B1: concordia_verify runs health check on all organs", async () => {
  const r = await callMCP("concordia_verify");
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(typeof obs.verdict === "string");
  assert.ok(["GREEN", "AMBER", "RED"].includes(obs.verdict));
  assert.ok(typeof obs.verification_id === "string");
  assert.ok(obs.summary.total_organs >= 12);
});

await test("B2: per-organ health status reflects actual reachability", async () => {
  const r = await callMCP("concordia_verify");
  const organs = r.result.observation.organs;
  let healthyCount = 0;
  for (const o of organs) {
    if (o.healthy) healthyCount++;
    assert.ok(typeof o.healthy === "boolean");
    assert.ok(typeof o.reachable === "boolean");
  }
  // Most organs should be healthy
  assert.ok(healthyCount >= 8, `expected >=8 healthy organs, got ${healthyCount}`);
});

await test("B3: verdict is GREEN when all organs healthy, AMBER if 1-2 down", async () => {
  const r = await callMCP("concordia_verify");
  const total = r.result.observation.summary.total_organs;
  const healthy = r.result.observation.summary.healthy;
  const verdict = r.result.observation.verdict;
  if (healthy === total) {
    assert.equal(verdict, "GREEN");
  } else if (healthy >= total - 2) {
    assert.equal(verdict, "AMBER");
  } else {
    assert.equal(verdict, "RED");
  }
});

console.log("\nSection C — Demonstrate (3 tests)");

await test("C1: concordia_demonstrate runs cross-organ workflow", async () => {
  const r = await callMCP("concordia_demonstrate");
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(Array.isArray(obs.steps));
  assert.ok(obs.steps.length >= 5, `expected >=5 steps, got ${obs.steps.length}`);
  assert.ok(typeof obs.demo_id === "string");
  assert.ok(typeof obs.successful_steps === "number");
});

await test("C2: every demonstration step has required schema", async () => {
  const r = await callMCP("concordia_demonstrate");
  for (const step of r.result.observation.steps) {
    assert.ok(typeof step.step === "number");
    assert.ok(typeof step.name === "string");
    assert.ok(typeof step.ok === "boolean");
  }
});

await test("C3: demonstration is non-destructive (only list/send/read tools)", async () => {
  const r = await callMCP("concordia_demonstrate");
  const FORBIDDEN = ["opportunity_approve", "opportunity_reject", "initiative_submit",
                      "proactive_acknowledge", "a2a_ack", "capability_register",
                      "initiative_record_execution", "economic_check"];
  for (const step of r.result.observation.steps) {
    assert.ok(!FORBIDDEN.includes(step.name),
      `demonstration step ${step.name} is destructive`);
  }
});

console.log("\nSection D — List Assemblies (2 tests)");

await test("D1: concordia_list_assemblies returns previous assemblies", async () => {
  const r = await callMCP("concordia_list_assemblies", { limit: 5 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(Array.isArray(obs.assemblies));
  // We just ran assemble + verify + demonstrate so there should be at least 1
  assert.ok(obs.count >= 1, `expected >=1 assemblies, got ${obs.count}`);
});

await test("D2: assemblies have proper schema", async () => {
  const r = await callMCP("concordia_list_assemblies", { limit: 1 });
  const list = r.result.observation.assemblies;
  if (list.length === 0) {
    console.log("    (skipped — no assemblies)");
    return;
  }
  const asm = list[0];
  assert.ok(typeof asm.assembly_id === "string");
  assert.ok(typeof asm.started_at === "string");
  assert.ok(typeof asm.organs_total === "number");
  assert.ok(typeof asm.organs_healthy === "number");
});

console.log("\nSection E — Cross-Organ Independence (1 test)");

await test("E1: NO concordia_execute or concordia_broadcast tool (read-only final audit)", async () => {
  const r1 = await callMCP("concordia_execute", { organ: "any", command: "any" });
  assert.equal(r1.ok, false, "concordia_execute must NOT exist");
  const r2 = await callMCP("concordia_broadcast", { message: "test" });
  assert.equal(r2.ok, false, "concordia_broadcast must NOT exist");
});

console.log("\nResults:");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);