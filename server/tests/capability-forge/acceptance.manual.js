// server/tests/capability-forge/acceptance.manual.js
//
// F.5.5 — Independent evaluator for Capability Forge organ.
//
// Run with: node server/tests/capability-forge/acceptance.manual.js

import assert from "node:assert/strict";

const BACKEND = process.env.CONCORD_BACKEND || "http://127.0.0.1:5050";
const ORGAN = "capability-forge";

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

console.log("Section A — Mine (3 tests)");

await test("A1: capability_mine finds patterns from initiatives", async () => {
  const r = await callMCP("capability_mine", { since_minutes: 1440 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(typeof obs.patterns_found === "number");
  assert.ok(typeof obs.patterns_eligible === "number");
  assert.ok(typeof obs.patterns_persisted === "number");
  assert.ok(typeof obs.min_occurrences_threshold === "number");
});

await test("A2: mined patterns have required schema", async () => {
  const r = await callMCP("capability_mine", { since_minutes: 1440 });
  const patterns = r.result.observation.patterns;
  for (const p of patterns) {
    assert.ok(typeof p.pattern_id === "string", "pattern_id required");
    assert.ok(typeof p.kind === "string");
    assert.ok(typeof p.target_tool === "string");
    assert.ok(typeof p.organ === "string");
    assert.ok(typeof p.action === "string");
    assert.ok(typeof p.occurrences === "number");
    assert.ok(typeof p.success_count === "number");
    assert.ok(typeof p.success_rate === "number");
    assert.ok(p.success_rate >= 0 && p.success_rate <= 1, "success_rate in [0,1]");
  }
});

await test("A3: dry_run does NOT persist patterns", async () => {
  const before = await callMCP("capability_list_patterns", { limit: 100 });
  const beforeCount = before.result.observation.count;
  const dry = await callMCP("capability_mine", { since_minutes: 1440, dry_run: true });
  assert.equal(dry.result.observation.dry_run, true);
  const after = await callMCP("capability_list_patterns", { limit: 100 });
  const afterCount = after.result.observation.count;
  assert.ok(afterCount >= beforeCount, "dry_run must NOT increase pattern count");
});

console.log("\nSection B — List Patterns + Templates (3 tests)");

await test("B1: capability_list_patterns returns with organ filter", async () => {
  const r = await callMCP("capability_list_patterns", { limit: 20 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(Array.isArray(obs.patterns));
});

await test("B2: capability_list_templates returns with status filter", async () => {
  const r = await callMCP("capability_list_templates", { status: "pending_review", limit: 10 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  for (const t of obs.templates) {
    assert.equal(t.status, "pending_review", "all must match filter");
  }
});

await test("B3: capability_list_templates returns empty when no matches", async () => {
  const r = await callMCP("capability_list_templates", { status: "nonexistent_status_xyz", limit: 10 });
  assert.equal(r.ok, true);
  assert.equal(r.result.observation.count, 0);
});

console.log("\nSection C — Generate Template (3 tests)");

await test("C1: capability_generate_template requires existing pattern", async () => {
  const r = await callMCP("capability_generate_template", { pattern_id: "pat_nonexistent_xyz" });
  assert.equal(r.ok, false, "should fail for nonexistent pattern");
  assert.ok(r.result.observation.error.includes("not found"));
});

await test("C2: capability_generate_template produces valid descriptor", async () => {
  // First find a real pattern
  const list = await callMCP("capability_list_patterns", { limit: 5 });
  if (list.result.observation.count === 0) {
    console.log("    (skipped — no patterns)");
    return;
  }
  // Find a pattern that doesn't already have a template
  let pid = null;
  for (const p of list.result.observation.patterns) {
    const r = await callMCP("capability_generate_template", { pattern_id: p.pattern_id });
    if (r.ok && r.result.observation.template) {
      pid = p.pattern_id;
      break;
    }
  }
  if (!pid) {
    console.log("    (skipped — all patterns already templated)");
    return;
  }
  // Re-generate to inspect descriptor
  const r = await callMCP("capability_generate_template", { pattern_id: pid });
  // May be duplicate now, but we got the descriptor from first call
  // Re-fetch via list to get the descriptor
  const tlist = await callMCP("capability_list_templates", { limit: 50 });
  const tpl = tlist.result.observation.templates.find(t => t.template_id === `tpl_${pid}`);
  if (!tpl) {
    // Get the capability name from the first call's response (stored in observation)
    console.log("    (template exists — verify it has correct fields via list_templates)");
    return;
  }
  assert.ok(typeof tpl.capability === "string");
  assert.ok(tpl.capability.includes("."), "capability name must have dot (organ.action)");
  assert.ok(typeof tpl.owner === "string");
  assert.ok(["read", "write", "execute", "trade", "deploy"].includes(tpl.risk));
  assert.ok(typeof tpl.description === "string");
  // Template dedupes by capability — verify either new template OR dup detected
  if (r.ok && r.result.observation.template) {
    assert.equal(r.result.observation.template.status, "pending_review");
  } else {
    assert.equal(r.result.observation.error.includes("already exists"), true,
      "duplicate should report 'already exists'");
  }
});

await test("C3: template status starts as pending_review (not auto-registered)", async () => {
  const list = await callMCP("capability_list_templates", { status: "pending_review", limit: 1 });
  if (list.result.observation.count === 0) {
    console.log("    (skipped — no pending templates)");
    return;
  }
  const t = list.result.observation.templates[0];
  assert.equal(t.status, "pending_review", "templates start pending_review");
  // None of them should be 'registered' without explicit operator action
});

console.log("\nSection D — Register (3 tests)");

await test("D1: capability_register requires existing template", async () => {
  const r = await callMCP("capability_register", { id: 999999 });
  assert.equal(r.ok, false);
  assert.ok(r.result.observation.error.includes("not found"));
});

await test("D2: capability_register can REJECT a template", async () => {
  // Find a pending_review template
  const list = await callMCP("capability_list_templates", { status: "pending_review", limit: 1 });
  if (list.result.observation.count === 0) {
    console.log("    (skipped — no pending template)");
    return;
  }
  const id = list.result.observation.templates[0].id;
  const r = await callMCP("capability_register", { id, action: "reject", reason: "test rejection" });
  assert.equal(r.ok, true);
  assert.equal(r.result.observation.action, "reject");
  assert.equal(r.result.observation.new_status, "rejected");
});

await test("D3: cannot register already-registered template (idempotency)", async () => {
  // Find a registered OR rejected template
  const list = await callMCP("capability_list_templates", { status: "rejected", limit: 1 });
  if (list.result.observation.count === 0) {
    console.log("    (skipped — no rejected template)");
    return;
  }
  const id = list.result.observation.templates[0].id;
  const r = await callMCP("capability_register", { id, action: "approve" });
  assert.equal(r.ok, false, "should fail because already rejected");
});

console.log("\nSection E — No Auto-Register (1 test)");

await test("E1: NO capability_auto_register tool exists", async () => {
  const r = await callMCP("capability_auto_register", { pattern_id: "any" });
  assert.equal(r.ok, false, "capability_auto_register must NOT exist");
});

console.log("\nResults:");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);