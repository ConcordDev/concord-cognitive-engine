// server/tests/a2a-boundary/acceptance.manual.js
//
// G.5 — Independent evaluator for A2A Boundary organ.
//
// Run with: node server/tests/a2a-boundary/acceptance.manual.js

import assert from "node:assert/strict";
import crypto from "node:crypto";

const BACKEND = process.env.CONCORD_BACKEND || "http://127.0.0.1:5050";
const ORGAN = "a2a-boundary";

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

console.log("Section A — Send + Routes (3 tests)");

await test("A1: a2a_send uses internal channel for organ→organ", async () => {
  const r = await callMCP("a2a_send", {
    sender: "trace-fabric",
    recipient: "a2a-boundary",
    channel: "internal",
    payload: {
      type: "text",
      content: `[TEST] ${crypto.randomBytes(8).toString("hex")} — internal message`,
    },
    idempotency_key: `test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(typeof obs.message_id === "string");
  assert.equal(obs.status, "delivered", "internal channel should be delivered immediately");
});

await test("A2: a2a_send with unknown route but no address returns rejected", async () => {
  const r = await callMCP("a2a_send", {
    sender: "totally-unknown-sender",
    recipient: "totally-unknown-recipient",
    channel: "telegram",
    payload: { type: "text", content: "test" },
    // No address — should fail with route_unknown
  });
  assert.equal(r.ok, false, "should fail because no route and no address");
  assert.equal(r.result.observation.reason_code, "route_unknown");
});

await test("A3: a2a_list_routes returns default routes", async () => {
  const r = await callMCP("a2a_list_routes", { limit: 20 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(obs.count >= 1, "should have at least 1 default route");
  assert.ok(Array.isArray(obs.routes));
  // Check for operator route
  const hasOpRoute = obs.routes.some(r => r.recipient_pattern === "operator");
  assert.ok(hasOpRoute, "should have operator route");
});

console.log("\nSection B — List Messages + Get (3 tests)");

await test("B1: a2a_list_messages returns with status filter", async () => {
  const r = await callMCP("a2a_list_messages", { status: "delivered", limit: 10 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(Array.isArray(obs.messages));
});

await test("B2: a2a_get_message returns full details with deliveries", async () => {
  // First find a message
  const list = await callMCP("a2a_list_messages", { limit: 1 });
  if (list.result.observation.count === 0) {
    console.log("    (skipped — no messages)");
    return;
  }
  const id = list.result.observation.messages[0].id;
  const r = await callMCP("a2a_get_message", { id });
  assert.equal(r.ok, true);
  const msg = r.result.observation.message;
  assert.ok(msg.id === id);
  assert.ok(typeof msg.message_id === "string");
  assert.ok(Array.isArray(msg.deliveries), "delivery history required");
  assert.ok(msg.deliveries.length >= 1, "at least 1 delivery attempt");
});

await test("B3: a2a_list_messages filters by sender", async () => {
  const r = await callMCP("a2a_list_messages", { sender: "trace-fabric", limit: 10 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  for (const m of obs.messages) {
    assert.equal(m.sender, "trace-fabric");
  }
});

console.log("\nSection C — Idempotency + Ack (3 tests)");

await test("C1: same idempotency_key returns existing message", async () => {
  const idemKey = `test_idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  // First send
  const r1 = await callMCP("a2a_send", {
    sender: "trace-fabric",
    recipient: "a2a-boundary",
    channel: "internal",
    payload: { type: "text", content: `[IDEM-TEST] ${idemKey}` },
    idempotency_key: idemKey,
  });
  assert.equal(r1.ok, true);
  // Second send with same key
  const r2 = await callMCP("a2a_send", {
    sender: "trace-fabric",
    recipient: "a2a-boundary",
    channel: "internal",
    payload: { type: "text", content: `[IDEM-TEST] ${idemKey}` },
    idempotency_key: idemKey,
  });
  assert.equal(r2.ok, true);
  assert.equal(r2.result.observation.duplicate, true, "should mark as duplicate");
});

await test("C2: a2a_ack transitions delivered → acked", async () => {
  // Find a delivered internal message
  const list = await callMCP("a2a_list_messages", { status: "delivered", limit: 10 });
  const ackedCandidates = list.result.observation.messages.filter(m =>
    m.sender === "trace-fabric" && m.recipient === "a2a-boundary"
  );
  if (ackedCandidates.length === 0) {
    console.log("    (skipped — no delivered internal message to ack)");
    return;
  }
  const id = ackedCandidates[0].id;
  const r = await callMCP("a2a_ack", { id, reason: "test acknowledgment" });
  assert.equal(r.ok, true);
  assert.equal(r.result.observation.status, "acked");
});

await test("C3: cannot ack non-delivered message", async () => {
  // Find a pending or failed message (or send one with invalid transport)
  const list = await callMCP("a2a_list_messages", { status: "pending", limit: 1 });
  if (list.result.observation.count === 0) {
    console.log("    (skipped — no pending message)");
    return;
  }
  const id = list.result.observation.messages[0].id;
  const r = await callMCP("a2a_ack", { id });
  assert.equal(r.ok, false, "should fail because not delivered");
});

console.log("\nSection D — Check Delivery (2 tests)");

await test("D1: a2a_check_delivery retries pending messages", async () => {
  const r = await callMCP("a2a_check_delivery", { max_messages: 5 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(typeof obs.checked === "number");
  assert.ok(Array.isArray(obs.results));
});

await test("D2: max_messages parameter respected", async () => {
  const r = await callMCP("a2a_check_delivery", { max_messages: 1 });
  assert.equal(r.ok, true);
  assert.ok(r.result.observation.checked <= 1, "should not exceed max_messages");
});

console.log("\nSection E — No Silent Drops (1 test)");

await test("E1: every send produces a persistent record (no silent drops)", async () => {
  const before = await callMCP("a2a_list_messages", { limit: 200 });
  const beforeCount = before.result.observation.count;
  // Send 3 messages
  for (let i = 0; i < 3; i++) {
    await callMCP("a2a_send", {
      sender: "trace-fabric",
      recipient: "a2a-boundary",
      channel: "internal",
      payload: { type: "text", content: `[NO-DROP-TEST] ${i} ${Date.now()}` },
    });
  }
  const after = await callMCP("a2a_list_messages", { limit: 200 });
  const afterCount = after.result.observation.count;
  assert.ok(afterCount >= beforeCount + 3,
    `expected ${beforeCount + 3} messages, got ${afterCount}`);
});

console.log("\nResults:");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);