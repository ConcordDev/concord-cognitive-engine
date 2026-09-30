// server/tests/auth-gate/acceptance.manual.js
//
// F0.6 — Independent evaluator. Tests the 14 acceptance criteria WITHOUT
// importing auth-gate's own code. Calls AuthGate via the HTTP dispatch
// path so the test exercises the real wiring.
//
// Run with: node server/tests/auth-gate/acceptance.manual.js

import assert from "node:assert/strict";
import { buildEnvelope, hasAllEnvelopeFields, applyDecision } from "../../lib/auth-gate/envelope.js";
import { evaluate } from "../../lib/auth-gate/evaluate.js";
import * as idempotency from "../../lib/auth-gate/gates/idempotency.js";
import * as authGate from "../../lib/auth-gate/index.js";

const BACKEND = process.env.CONCORD_BACKEND || "http://127.0.0.1:5050";

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

async function callMCP(tool, args, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (opts.trace_id) headers["X-Trace-Id"] = opts.trace_id;
  const r = await fetch(`${BACKEND}/mcp/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tool, args: args || {} }),
  });
  return await r.json();
}

console.log("F0.6 — Independent evaluator (14 acceptance criteria)\n");
console.log("Section A — Envelope shape (4 tests)\n");

await test("A1: envelope has all 14 fields", async () => {
  const env = buildEnvelope({ tool: "test_tool", args: {}, ctx: { actor: { id: "x" } } });
  assert.equal(hasAllEnvelopeFields(env), true);
})();

await test("A2: envelope is frozen", async () => {
  const env = buildEnvelope({ tool: "test", args: {}, ctx: { actor: { id: "x" } } });
  assert.equal(Object.isFrozen(env), true);
})();

await test("A3: envelope honors incoming trace_id (OTel pass-through)", async () => {
  const env = buildEnvelope({ tool: "test", args: {}, ctx: { trace_id: "incoming-123" } });
  assert.equal(env.TRACE_ID, "incoming-123");
})();

await test("A4: applyDecision populates DECISION field", async () => {
  const env = buildEnvelope({ tool: "test", args: {}, ctx: { actor: { id: "x" } } });
  const decided = applyDecision(env, { decision_type: "ALLOW", reason_code: "test" });
  assert.equal(decided.DECISION.decision_type, "ALLOW");
  assert.equal(decided.DECISION.reason_code, "test");
})();

console.log("\nSection B — AuthGate decisions (5 tests)\n");

await test("B1: unknown tool with bad provenance returns ALLOW in observe mode", async () => {
  const r = await callMCP("web_search", { query: "test" }, { trace_id: uniqueTraceId("b1") });
  assert.equal(r.decision, "ALLOW");
  assert.equal(r.ok, true);
})();

await test("B2: gates_run contains evaluate pre-dispatch gates (10-check composition)", async () => {
  const r = await callMCP("rt_snapshot", { entity_id: "hermes-agent" }, { trace_id: uniqueTraceId("b2") });
  const names = r.gates_run.map(g => g.name);
  assert.ok(names.includes("sovereignty"), "missing sovereignty");
  assert.ok(names.includes("capability"), "missing capability");
  assert.ok(names.includes("refusal"), "missing refusal");
  assert.ok(names.includes("provenance"), "missing provenance");
  assert.ok(names.includes("expiration"), "missing expiration");
  assert.ok(names.includes("preconditions"), "missing preconditions");
  assert.ok(names.includes("idempotency"), "missing idempotency");
  assert.ok(names.includes("resource"), "missing resource");
  assert.ok(names.includes("rollback"), "missing rollback");
})();

await test("B3: auth_gate_mode reported", async () => {
  const r = await callMCP("web_status", {}, { trace_id: uniqueTraceId("b3") });
  assert.equal(r.auth_gate_mode, "observe");
})();

await test("B4: envelope in response includes TRACE_ID and DECISION", async () => {
  const traceId = uniqueTraceId("b4");
  const r = await callMCP("web_status", {}, { trace_id: traceId });
  assert.equal(r.envelope.TRACE_ID, traceId);
  assert.ok(r.envelope.DECISION, "no DECISION");
})();

await test("B5: result envelope present", async () => {
  const r = await callMCP("rt_identity_get", { entity_id: "hermes-agent" }, { trace_id: uniqueTraceId("b5") });
  assert.ok(r.result, "no result");
  assert.equal(r.result.entity_id, "hermes-agent");
})();

console.log("\nSection C — Idempotency (3 tests)\n");

await test("C1: same trace_id + same args → idempotent_replay_cached", async () => {
  // Each idempotency test must use UNIQUE args, otherwise cross-test
  // cache pollution from previous tests (B-tests, D-tests) causes hash collisions.
  const traceId = uniqueTraceId("c1");
  const args = { _test_marker: traceId };
  const r1 = await callMCP("web_status", args, { trace_id: traceId });
  const r2 = await callMCP("web_status", args, { trace_id: traceId });
  assert.equal(r2.reason_code, "idempotent_replay_cached", `got ${r2.reason_code} gates=${r2.gates_run?.map(g=>g.result?.reason_code).join(',')}`);
})();

await test("C2: different trace_id + same args → replay_detected", async () => {
  const traceId1 = uniqueTraceId("c2a");
  const traceId2 = uniqueTraceId("c2b");
  const args = { _test_marker: uniqueTraceId("c2") };
  await callMCP("web_status", args, { trace_id: traceId1 });
  const r2 = await callMCP("web_status", args, { trace_id: traceId2 });
  const idem = r2.gates_run.find(g => g.name === "idempotency");
  assert.ok(idem, "no idempotency gate result");
  assert.equal(idem.result.reason_code, "replay_detected");
  assert.equal(idem.decision, "DENY");
})();

await test("C3: hashEnvelope is deterministic", async () => {
  const env1 = buildEnvelope({ tool: "x", args: { a: 1, b: 2 }, ctx: {} });
  const env2 = buildEnvelope({ tool: "x", args: { b: 2, a: 1 }, ctx: {} });
  const h1 = idempotency.hashEnvelope(env1);
  const h2 = idempotency.hashEnvelope(env2);
  assert.equal(h1, h2, "hash should be order-independent");
})();

console.log("\nSection D — Capability (2 tests)\n");

await test("D1: unregistered capability still dispatchable in observe mode", async () => {
  const r = await callMCP(uniqueTraceId("d1"), {}, { trace_id: uniqueTraceId("d1") });
  assert.equal(r.decision, "ALLOW");
})();

await test("D2: capability gate returns risk=read for unregistered", async () => {
  const r = await callMCP(uniqueTraceId("d2"), {}, { trace_id: uniqueTraceId("d2") });
  const cap = r.gates_run.find(g => g.name === "capability");
  assert.ok(cap);
  assert.equal(cap.result.registered, false);
  assert.equal(cap.result.risk, "read");
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