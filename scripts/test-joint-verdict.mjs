// scripts/test-joint-verdict.mjs
//
// Regression test for the joint.governing-check verdict guard.
// Uses the live lap-splice bracket design workflow as the fixture.
//
// Acceptance criteria (from P0 spec):
//   1. A bolt-shear PASS alone never produces a joint PASS.
//   2. Missing edge distances block a complete verdict when tear-out is applicable.
//   3. A missing solver cannot be silently treated as a passing check.
//   4. A failed applicable check produces an overall FAIL.
//   5. All applicable checks passing, with prerequisites satisfied, permits PASS.

import { openDesign } from "/Users/dutch/concord vs code/concord-cognitive-engine/server/lib/conkay/index.js";
import { aggregateJointVerdict, JOINT_VERDICT } from "/Users/dutch/concord vs code/concord-cognitive-engine/server/lib/conkay/physics/solvers/joint-governing-check.js";
import { KIND_DOMAINS } from "/Users/dutch/concord vs code/concord-cognitive-engine/server/lib/conkay/verification/coverage.js";

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✓ ${name}`); };
const ng = (name, why) => { fail++; console.log(`  ✗ ${name}  -- ${why}`); };

function assertEq(actual, expected, label) {
  if (actual === expected) ok(`${label}: ${actual}`);
  else ng(label, `expected ${expected}, got ${actual}`);
}

function assertHas(verdict, domain, label) {
  if (verdict.missing.some((m) => m.domain === domain)) ok(`${label}: ${domain} reported as missing`);
  else if (verdict.blocked.some((b) => b.domain === domain)) ok(`${label}: ${domain} reported as blocked`);
  else ng(label, `expected ${domain} in missing/blocked, not found`);
}

// ────────────────────────────────────────────────────────────────────────
// FIXTURE 1: the real lap-splice bracket design from the workflow test.
// This is the live design we ran in the engineering-workflow.mjs script:
// 4 × M16 ASTM A325 bolts, 1 shear plane, 200×100×10 mm A36 plate, 40 kN.
// ────────────────────────────────────────────────────────────────────────
const LAP_SPLICE_IR = {
  design: { id: "test-lap-splice", name: "Lap-splice regression fixture" },
  materials: { "astm-a325": { costPerKgUsd: "4 USD/kg" } },
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "P1", kind: "Plate", material: "steel-a36",
      geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" } },
    { id: "B1", kind: "Bolt", material: "astm-a325",
      geometry: { shape: "bolt", diameter: "16 mm", length: "40 mm" }, qty: 4 },
    { id: "J1", kind: "Joint", props: { shearPlanes: 1 } },
  ],
  edges: [
    { type: "CONTAINS", from: "A1", to: "P1" },
    { type: "CONTAINS", from: "A1", to: "B1" },
    { type: "CONTAINS", from: "J1", to: "P1" },
    { type: "CONTAINS", from: "J1", to: "B1" },
  ],
  loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "40 kN" }] }],
};

console.log("\n================================================");
console.log("FIXTURE 1: real lap-splice bracket (live design)");
console.log("================================================\n");

const opened = openDesign(LAP_SPLICE_IR);
if (!opened.ok) { console.error("openDesign failed:", opened); process.exit(1); }
const session = opened.session;
const envelopes = session.results();

console.log(`Total envelopes: ${envelopes.length}`);
for (const e of envelopes) {
  console.log(`  ${e.runId.padEnd(40)} ${e.status.padEnd(13)} solver=${e.solver.id}`);
}

// We need a ctx-like object for aggregateJointVerdict. Build one with
// the read hooks the engine would provide.
const ctx = {
  get: (id, path) => session.graph.get(id, path),
  children: (id, type) => session.graph.children(id, type),
  loadCases: () => session.graph.loadCases || [],
};

const v1 = aggregateJointVerdict("J1", ctx, envelopes, { jointKind: "bearing" });

console.log(`\nVerdict for J1 (bearing joint): ${v1.verdict}`);
console.log(`  checks: ${v1.checks.map((c) => `${c.domain}=${c.status}`).join(", ")}`);
console.log(`  missing: ${v1.missing.map((m) => `${m.domain}(${m.reason})`).join(", ")}`);
console.log(`  blocked: ${v1.blocked.map((b) => `${b.domain}(${b.reason})`).join(", ")}`);
console.log(`  failed: ${v1.failed.length}`);
console.log(`  solverErrors: ${v1.solverErrors.length}`);

console.log("\n[1] Acceptance criterion: bolt-shear PASS alone cannot produce joint PASS.");
// The existing design has joint.bolt-shear PASS, joint.bolt-bearing PASS,
// but tear-out was reported "no structural.tearout solver yet" in the
// earlier workflow. So the verdict MUST be INCOMPLETE.
assertEq(v1.verdict, JOINT_VERDICT.INCOMPLETE, "verdict for fixture 1");

console.log("\n[2] Acceptance criterion: missing tear-out is reported.");
assertHas(v1, "structural.tearout", "fixture 1 tear-out reported");

console.log("\n[3] Acceptance criterion: PASS domains are listed individually, not collapsed.");
if (v1.checks.some((c) => c.domain === "structural.shear" && c.status === "PASS")) {
  ok("shear listed as PASS");
} else {
  ng("shear listed as PASS", "not found in checks");
}
if (v1.checks.some((c) => c.domain === "structural.bearing" && c.status === "PASS")) {
  ok("bearing listed as PASS");
} else {
  ng("bearing listed as PASS", "not found in checks");
}

console.log("\n[4] Acceptance criterion: structural.slip is in the Joint applicability table but not required for a bearing joint.");
// A bearing joint does not require slip. The verdict should NOT report
// it as missing.
if (v1.missing.some((m) => m.domain === "structural.slip-critical")) {
  ng("slip is scope-aware", "bearing joint incorrectly requires slip");
} else {
  ok("bearing joint does not require slip");
}

// ────────────────────────────────────────────────────────────────────────
// FIXTURE 2: synthetic failed case. We hand-build envelopes to force
// the verdict into FAIL.
// ────────────────────────────────────────────────────────────────────────
console.log("\n================================================");
console.log("FIXTURE 2: synthetic FAIL (shear fails)");
console.log("================================================\n");

const failEnvelopes = [
  {
    runId: "joint.bolt-shear@J1",
    status: "FAIL",
    solver: { id: "joint.bolt-shear", domains: ["structural.shear"] },
    target: "J1",
    covers: ["J1", "B1"],
    failures: [{ reason: "demand 50,000 N exceeds capacity 56,144 N" }],
  },
  {
    runId: "joint.bolt-bearing@J1",
    status: "PASS",
    solver: { id: "joint.bolt-bearing", domains: ["structural.bearing"] },
    target: "J1",
    covers: ["J1", "P1"],
  },
];

const v2 = aggregateJointVerdict("J1", ctx, failEnvelopes, { jointKind: "bearing" });
console.log(`Verdict: ${v2.verdict}`);
console.log(`  failed: ${v2.failed.map((f) => `${f.domain}(${f.reason})`).join(", ")}`);
console.log(`  missing: ${v2.missing.map((m) => m.domain).join(", ")}`);

assertEq(v2.verdict, JOINT_VERDICT.FAIL, "verdict for fixture 2");
if (v2.failed.some((f) => f.domain === "structural.shear")) ok("fixture 2: shear listed in failed");
else ng("fixture 2: shear listed in failed", "not found");

// ────────────────────────────────────────────────────────────────────────
// FIXTURE 3: synthetic PASS case. All required bearing checks pass.
// ────────────────────────────────────────────────────────────────────────
console.log("\n================================================");
console.log("FIXTURE 3: synthetic PASS (all bearing checks pass)");
console.log("================================================\n");

const passEnvelopes = [
  {
    runId: "joint.bolt-shear@J1",
    status: "PASS",
    solver: { id: "joint.bolt-shear", domains: ["structural.shear"] },
    target: "J1",
    covers: ["J1", "B1"],
  },
  {
    runId: "joint.bolt-bearing@J1",
    status: "PASS",
    solver: { id: "joint.bolt-bearing", domains: ["structural.bearing"] },
    target: "J1",
    covers: ["J1", "P1"],
  },
  {
    runId: "joint.bolt-tearout@J1",
    status: "PASS",
    solver: { id: "joint.bolt-tearout", domains: ["structural.tearout"] },
    target: "J1",
    covers: ["J1", "P1"],
  },
  // The 2026-10-12 update expanded the bearing-joint applicability
  // table to include member-level limit states (gross-section,
  // net-section, block-shear) and the bolt-group distribution
  // check. The synthetic PASS case must include all of them.
  {
    runId: "joint.gross-section@J1",
    status: "PASS",
    solver: { id: "joint.gross-section", domains: ["structural.gross-section"] },
    target: "J1",
    covers: ["J1", "P1"],
  },
  {
    runId: "joint.net-section@J1",
    status: "PASS",
    solver: { id: "joint.net-section", domains: ["structural.net-section"] },
    target: "J1",
    covers: ["J1", "P1"],
  },
  {
    runId: "joint.block-shear@J1",
    status: "PASS",
    solver: { id: "joint.block-shear", domains: ["structural.block-shear"] },
    target: "J1",
    covers: ["J1", "P1"],
  },
  {
    runId: "joint.bolt-group-distribution@J1",
    status: "PASS",
    solver: { id: "joint.bolt-group-distribution", domains: ["structural.bolt-group"] },
    target: "J1",
    covers: ["J1", "B1"],
  },
];

const v3 = aggregateJointVerdict("J1", ctx, passEnvelopes, { jointKind: "bearing" });
console.log(`Verdict: ${v3.verdict}`);
assertEq(v3.verdict, JOINT_VERDICT.PASS, "verdict for fixture 3");

// ────────────────────────────────────────────────────────────────────────
// FIXTURE 4: synthetic ERROR case. A solver threw.
// ────────────────────────────────────────────────────────────────────────
console.log("\n================================================");
console.log("FIXTURE 4: synthetic ERROR (solver threw)");
console.log("================================================\n");

const errorEnvelopes = [
  {
    runId: "joint.bolt-shear@J1",
    status: "PASS",
    solver: { id: "joint.bolt-shear", domains: ["structural.shear"] },
    target: "J1",
    covers: ["J1"],
  },
  {
    runId: "joint.bolt-tearout@J1",
    status: "ERROR",
    solver: { id: "joint.bolt-tearout", domains: ["structural.tearout"] },
    target: "J1",
    covers: ["J1"],
    error: "plate thickness must be > 0",
  },
];

const v4 = aggregateJointVerdict("J1", ctx, errorEnvelopes, { jointKind: "bearing" });
console.log(`Verdict: ${v4.verdict}`);
assertEq(v4.verdict, JOINT_VERDICT.ERROR, "verdict for fixture 4");

// ────────────────────────────────────────────────────────────────────────
// FIXTURE 5: slip-critical scope check. A slip-critical joint requires
// structural.slip in addition to the bearing ones.
// ────────────────────────────────────────────────────────────────────────
console.log("\n================================================");
console.log("FIXTURE 5: slip-critical scope (slip is required)");
console.log("================================================\n");

const slipMissingEnvelopes = [
  {
    runId: "joint.bolt-shear@J1",
    status: "PASS",
    solver: { id: "joint.bolt-shear", domains: ["structural.shear"] },
    target: "J1",
    covers: ["J1"],
  },
  {
    runId: "joint.bolt-bearing@J1",
    status: "PASS",
    solver: { id: "joint.bolt-bearing", domains: ["structural.bearing"] },
    target: "J1",
    covers: ["J1"],
  },
  {
    runId: "joint.bolt-tearout@J1",
    status: "PASS",
    solver: { id: "joint.bolt-tearout", domains: ["structural.tearout"] },
    target: "J1",
    covers: ["J1"],
  },
  // No structural.slip envelope at all.
];

const v5 = aggregateJointVerdict("J1", ctx, slipMissingEnvelopes, { jointKind: "slip-critical" });
console.log(`Verdict: ${v5.verdict}`);
console.log(`  missing: ${v5.missing.map((m) => `${m.domain}(${m.reason})`).join(", ")}`);
assertEq(v5.verdict, JOINT_VERDICT.INCOMPLETE, "verdict for fixture 5");
if (v5.missing.some((m) => m.domain === "structural.slip-critical")) ok("slip-critical: slip is required");
else ng("slip-critical: slip is required", "slip not in missing");

// ────────────────────────────────────────────────────────────────────────
console.log(`\n================================================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(`================================================\n`);

if (fail > 0) process.exit(1);