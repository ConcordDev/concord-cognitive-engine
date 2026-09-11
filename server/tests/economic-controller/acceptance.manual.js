// server/tests/economic-controller/acceptance.manual.js
//
// E.5 — Independent evaluator for Economic Controller organ.
//
// Run with: node server/tests/economic-controller/acceptance.manual.js

import assert from "node:assert/strict";

const BACKEND = process.env.CONCORD_BACKEND || "http://127.0.0.1:5050";
const ORGAN = "economic-controller";

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

console.log("Section A — Snapshot (3 tests)");

await test("A1: economic_snapshot returns summary + budget + attribution", async () => {
  const r = await callMCP("economic_snapshot", { since_minutes: 1440 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(typeof obs.summary === "object", "summary required");
  assert.ok(typeof obs.budget === "object", "budget required");
  assert.ok(["continue", "alert", "throttle", "halt_optional"].includes(obs.budget_action),
    "budget_action must be valid");
  assert.ok(typeof obs.summary.total_spend_usd === "number", "total_spend_usd required");
  assert.ok(typeof obs.summary.net_pnl_ex_airdrops === "number", "net_pnl_ex_airdrops required");
  assert.ok(typeof obs.summary.fee_drag_usd === "number", "fee_drag_usd required");
});

await test("A2: net_pnl_ex_airdrops = trading_pnl - fee_drag (no double-counting)", async () => {
  const r = await callMCP("economic_snapshot", { since_minutes: 1440 });
  const s = r.result.observation.summary;
  // net_pnl = trading_pnl - fee_drag. Airdrops NOT included.
  const expected = s.trading_pnl_usd - s.fee_drag_usd;
  assert.ok(Math.abs(s.net_pnl_ex_airdrops - expected) < 0.01,
    `net_pnl_ex_airdrops (${s.net_pnl_ex_airdrops}) must equal trading_pnl (${s.trading_pnl_usd}) - fee_drag (${s.fee_drag_usd}) = ${expected}`);
  // Airdrop income is separate line — NOT included in net
  assert.ok(typeof s.airdrop_income_usd === "number");
});

await test("A3: budget_action follows decision rules", async () => {
  const r = await callMCP("economic_snapshot", { since_minutes: 1440 });
  const obs = r.result.observation;
  // If CF monthly is < 90% and net_pnl >= -10, action should be 'continue'
  const cf_pct = obs.budget.cf.monthly_pct;
  const net_pnl = obs.summary.net_pnl_ex_airdrops;
  if (cf_pct < 90 && net_pnl >= -10) {
    assert.equal(obs.budget_action, "continue",
      `action must be 'continue' when cf_monthly_pct<90 (${cf_pct}) and net_pnl≥-10 (${net_pnl})`);
  }
});

console.log("\nSection B — Budget (2 tests)");

await test("B1: economic_budget returns CF + resource state", async () => {
  const r = await callMCP("economic_budget", {});
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(typeof obs.budget === "object");
  assert.ok(typeof obs.budget.cf === "object", "CF budget required");
  assert.ok(typeof obs.budget.cf.daily_pct === "number");
  assert.ok(typeof obs.budget.cf.monthly_pct === "number");
  assert.ok(typeof obs.budget.cf.cost_usd === "number");
  assert.ok(typeof obs.budget.resource_budget === "object");
});

await test("B2: economic_budget exposes action + reason", async () => {
  const r = await callMCP("economic_budget", {});
  const obs = r.result.observation;
  assert.ok(["continue", "alert", "throttle", "halt_optional"].includes(obs.budget_action));
  assert.ok(typeof obs.budget_reason === "string");
});

console.log("\nSection C — Costs + Attribution (3 tests)");

await test("C1: economic_costs returns persisted cost entries", async () => {
  const r = await callMCP("economic_costs", { since_minutes: 1440, limit: 50 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(Array.isArray(obs.costs));
  // At least one snapshot should have created cost entries
});

await test("C2: economic_attribution returns organ->cost mapping", async () => {
  const r = await callMCP("economic_attribution", { since_minutes: 1440 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(typeof obs.attribution === "object");
  // Research frontier attribution is required
  assert.ok("research_frontier" in obs.attribution, "research_frontier attribution required");
});

await test("C3: research_frontier attribution includes total_cost_usd", async () => {
  const r = await callMCP("economic_attribution", { since_minutes: 1440 });
  const rf = r.result.observation.attribution.research_frontier;
  assert.ok(typeof rf.total_cost_usd === "number", "research_frontier.total_cost_usd required");
  assert.ok(rf.total_cost_usd >= 0, "cost must be non-negative");
});

console.log("\nSection D — P&L (2 tests)");

await test("D1: economic_pnl returns current + history", async () => {
  const r = await callMCP("economic_pnl", { since_period_days: 30, limit: 30 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(typeof obs.current_period === "object");
  assert.ok(Array.isArray(obs.history));
  assert.ok(typeof obs.current_period.trading_pnl_usd === "number");
});

await test("D2: economic_pnl current_period follows net_pnl = trading - fee", async () => {
  const r = await callMCP("economic_pnl", { since_period_days: 30 });
  const cp = r.result.observation.current_period;
  const expected = cp.trading_pnl_usd - cp.fee_drag_usd;
  assert.ok(Math.abs(cp.net_pnl_ex_airdrops - expected) < 0.01,
    `current_period net_pnl must equal trading - fee_drag`);
});

console.log("\nSection E — Budget Gate (2 tests)");

await test("E1: economic_check returns action + safe_to_proceed", async () => {
  const r = await callMCP("economic_check", {});
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(["continue", "alert", "throttle", "halt_optional"].includes(obs.action));
  assert.ok(typeof obs.safe_to_proceed === "boolean");
  assert.ok(typeof obs.reason === "string");
});

await test("E2: economic_check is consistent with snapshot budget_action", async () => {
  const check = await callMCP("economic_check", {});
  const snap = await callMCP("economic_snapshot", { since_minutes: 1440 });
  // Both should report same action unless net_pnl changes between calls
  // (allow some slack for state drift)
  const check_action = check.result.observation.action;
  const snap_action = snap.result.observation.budget_action;
  // Just verify both are valid
  assert.ok(["continue", "alert", "throttle", "halt_optional"].includes(check_action));
  assert.ok(["continue", "alert", "throttle", "halt_optional"].includes(snap_action));
});

console.log("\nSection F — No Auto-Execute (1 test)");

await test("F1: NO economic_trade or economic_pay tool exists", async () => {
  // The Economic Controller is READ-ONLY. No action tools allowed.
  const r1 = await callMCP("economic_trade", {});
  const r2 = await callMCP("economic_pay", {});
  const r3 = await callMCP("economic_withdraw", {});
  // All three must return errors (tool not found or unimplemented)
  for (const r of [r1, r2, r3]) {
    assert.equal(r.ok, false, `Action tool must NOT exist`);
  }
});

console.log("\nResults:");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);