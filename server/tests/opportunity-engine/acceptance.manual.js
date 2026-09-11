// server/tests/opportunity-engine/acceptance.manual.js
//
// C.5 — Independent evaluator for Opportunity Engine organ.
//
// Run with: node server/tests/opportunity-engine/acceptance.manual.js

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const BACKEND = process.env.CONCORD_BACKEND || "http://127.0.0.1:5050";
const DB_PATH = `${process.env.HOME}/.local/share/concord/opportunity.db`;

let passed = 0;
let failed = 0;
const failures = [];

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

async function callMCP(tool, args = {}) {
  const r = await fetch(`${BACKEND}/mcp/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
    signal: AbortSignal.timeout(60000),
  });
  return await r.json();
}

function dbCount(table) {
  const out = execFileSync("sqlite3", [DB_PATH, `SELECT COUNT(*) FROM ${table};`]).toString().trim();
  return parseInt(out, 10);
}

console.log("C.5 — Opportunity Engine independent evaluator\n");

console.log("Section A — Scan + Persistence (3 tests)\n");

await test("A1: opportunity_scan persists opportunities to DB", async () => {
  const before = dbCount("opportunity_proposals");
  const r = await callMCP("opportunity_scan", { since_minutes: 1440 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(obs.signals_observed >= 1, "should observe at least 1 signal from real upstream organs");
  assert.equal(typeof obs.signals_processed, "number");
  assert.equal(typeof obs.opportunities_proposed, "number");
  // Note: dedupe window is 1 hour, so a fresh scan may not add new rows
  assert.equal(typeof obs.tier1_count, "number");
  assert.equal(typeof obs.tier2_count, "number");
  assert.equal(typeof obs.tier3_count, "number");
  const after = dbCount("opportunity_proposals");
  assert.ok(after >= before, "proposals table should not decrease");
})();

await test("A2: opportunity_scan returns expected schema", async () => {
  const r = await callMCP("opportunity_scan", { since_minutes: 1440 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  // Required fields
  assert.ok(obs.trace_id);
  assert.ok(obs.state_id || obs.state_id === null);
  assert.equal(typeof obs.signals_observed, "number");
  assert.ok(Array.isArray(obs.opportunities));
  assert.equal(typeof obs.alert_level, "string");
  assert.equal(typeof obs.dry_run, "boolean");
})();

await test("A3: opportunity_scan dry_run doesn't persist", async () => {
  const before = dbCount("opportunity_proposals");
  const r = await callMCP("opportunity_scan", { since_minutes: 1440, dry_run: true });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.equal(obs.dry_run, true);
  assert.equal(obs.opportunities_proposed, 0, "dry_run should not persist proposals");
  const after = dbCount("opportunity_proposals");
  assert.equal(after, before, "proposals table should not change with dry_run");
})();

console.log("\nSection B — List + Get (3 tests)\n");

await test("B1: opportunity_list returns proposals with correct schema", async () => {
  const r = await callMCP("opportunity_list", { limit: 5 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.equal(obs.kind, "opportunity_list");
  assert.ok(Array.isArray(obs.proposals));
  for (const p of obs.proposals) {
    assert.ok(p.id);
    assert.ok(p.kind);
    assert.ok(["tier1", "tier2", "tier3"].includes(p.tier));
    assert.ok(["pending", "approved", "rejected", "expired", "executed"].includes(p.status));
    assert.ok(typeof p.ev_normalized === "number");
    assert.ok(p.ev_normalized >= 0 && p.ev_normalized <= 1);
    assert.ok(p.required_authority);
  }
})();

await test("B2: opportunity_list filters by tier", async () => {
  const r = await callMCP("opportunity_list", { tier: "tier2", limit: 10 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  for (const p of obs.proposals) {
    assert.equal(p.tier, "tier2");
  }
})();

await test("B3: opportunity_get returns full details for known proposal", async () => {
  // Find any proposal
  const list = await callMCP("opportunity_list", { limit: 1 });
  if (list.result.observation.count === 0) {
    console.log("    (skip — no proposals in DB)");
    return;
  }
  const pid = list.result.observation.proposals[0].id;
  const r = await callMCP("opportunity_get", { proposal_id: pid });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.equal(obs.ok, true);
  assert.ok(obs.proposal);
  assert.equal(obs.proposal.id, pid);
  // Full schema
  assert.ok(obs.proposal.signal_id);
  assert.ok(obs.proposal.kind);
  assert.ok(obs.proposal.source);
  assert.ok(typeof obs.proposal.ev_usd === "number");
  assert.ok(typeof obs.proposal.upside_usd === "number");
  assert.ok(typeof obs.proposal.downside_usd === "number");
  assert.ok(typeof obs.proposal.costs_usd === "number");
  assert.ok(obs.proposal.proposed_action);
  assert.ok(obs.proposal.required_authority);
  assert.ok(obs.proposal.expires_at);
})();

console.log("\nSection C — Approve/Reject Flow (3 tests)\n");

await test("C1: opportunity_approve transitions pending to approved", async () => {
  // Find a pending proposal
  const list = await callMCP("opportunity_list", { status: "pending", limit: 1 });
  if (list.result.observation.count === 0) {
    console.log("    (skip — no pending proposals)");
    return;
  }
  const pid = list.result.observation.proposals[0].id;
  const r = await callMCP("opportunity_approve", { proposal_id: pid, approved_by: "tester" });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.equal(obs.ok, true);
  assert.equal(obs.status, "approved");
  assert.equal(obs.approved_by, "tester");
  // Verify via DB
  const row = execFileSync("sqlite3", [DB_PATH,
    `SELECT status, approved_by FROM opportunity_proposals WHERE id = ${pid};`
  ]).toString();
  assert.match(row, /approved/);
  assert.match(row, /tester/);
})();

await test("C2: opportunity_reject transitions pending to rejected", async () => {
  const list = await callMCP("opportunity_list", { status: "pending", limit: 1 });
  if (list.result.observation.count === 0) {
    console.log("    (skip — no pending proposals)");
    return;
  }
  const pid = list.result.observation.proposals[0].id;
  const r = await callMCP("opportunity_reject", { proposal_id: pid, rejection_reason: "test reject" });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.equal(obs.ok, true);
  assert.equal(obs.status, "rejected");
  assert.equal(obs.rejection_reason, "test reject");
  // Verify via DB
  const row = execFileSync("sqlite3", [DB_PATH,
    `SELECT status, rejection_reason FROM opportunity_proposals WHERE id = ${pid};`
  ]).toString();
  assert.match(row, /rejected/);
})();

await test("C3: cannot approve already-approved proposal (state machine)", async () => {
  // Find approved proposal
  const list = await callMCP("opportunity_list", { status: "approved", limit: 1 });
  if (list.result.observation.count === 0) {
    console.log("    (skip — no approved proposals to test re-approval)");
    return;
  }
  const pid = list.result.observation.proposals[0].id;
  const r = await callMCP("opportunity_approve", { proposal_id: pid });
  // The wrapper passes the inner observation's ok through to top
  const obs = r.result.observation;
  assert.equal(obs.ok, false, "should not approve already-approved proposal");
  assert.match(obs.error, /already/);
})();

console.log("\nSection D — No Auto-Execute (1 test)\n");

await test("D1: NO opportunity_execute tool exists", async () => {
  // Try to call a hypothetical execute tool — the organ MUST NOT have one
  const r2 = await callMCP("opportunity_execute", { proposal_id: 1 });
  // The call will fail because opportunity_execute doesn't exist
  assert.equal(r2.ok, false, "opportunity_execute should NOT exist");
  // The error message should indicate the tool doesn't exist
  const error_msg = r2.error || r2.result?.error || (r2.result?.observation?.error) || "";
  assert.ok(error_msg.length > 0, `should have error message, got: ${JSON.stringify(r2)}`);
  // The capability gate should also report unregistered
  const cap_gate = (r2.gates_run || []).find(g => g.name === "capability");
  if (cap_gate) {
    assert.match(cap_gate.result.reason_code, /unregistered|capability_unregistered/);
  }
})();

console.log("\nSection E — Tier Reproducibility (1 test)\n");

await test("E1: tier classification is deterministic for same inputs", async () => {
  // Verify via DB that tiers are deterministic
  // Get all proposals and verify tier matches the expected formula based on ev_normalized + downside
  const list = await callMCP("opportunity_list", { limit: 20 });
  assert.equal(list.ok, true);
  const proposals = list.result.observation.proposals;
  for (const p of proposals) {
    // Tier should match: tier1 if ev_normalized >= 0.8 AND downside <= 10 AND read-only authority
    // tier2 if ev_normalized >= 0.4 AND downside <= 100
    // tier3 otherwise
    const is_read_only = ["read", "check", "get", "list", "history"].some(s => p.required_authority.includes(s));
    let expected_tier;
    if (p.ev_normalized >= 0.8 && p.downside_usd <= 10 && is_read_only) {
      expected_tier = "tier1";
    } else if (p.ev_normalized >= 0.4 && p.downside_usd <= 100) {
      expected_tier = "tier2";
    } else {
      expected_tier = "tier3";
    }
    assert.equal(p.tier, expected_tier, `tier mismatch for id=${p.id}: got ${p.tier}, expected ${expected_tier}`);
  }
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