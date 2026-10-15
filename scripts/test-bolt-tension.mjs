// scripts/test-bolt-tension.mjs
//
// Hand-calc validation for joint.bolt-tension (AISC 360-16 §J3.6).
//
// Test case: single M16 A325 bolt, Fu = 827 MPa (120 ksi),
// Ab = 157 mm² (AISC Manual Table 7-2), 30 kN tension demand.
//
// Hand calc:
//   Fnt = 0.75 · Fu = 0.75 · 827,370,875 Pa = 620,528,156 Pa
//   φRn = 0.75 · Fnt · Ab = 0.75 · 620,528,156 · 157e-6 m²
//        = 0.75 · 620,528,156 · 0.000157 m²
//        = 73,067 N
//   Demand 30,000 N → utilization 0.41 → PASS
//
// Plus tests for:
//   - Missing stressArea → NOT_COMPUTED with a precise reason
//   - Missing tension demand → NOT_COMPUTED
//   - Threads excluded → Fnt ratio drops to 0.60

import { openDesign } from "/Users/dutch/concord vs code/concord-cognitive-engine/server/lib/conkay/index.js";

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✓ ${name}`); };
const ng = (name, why) => { fail++; console.log(`  ✗ ${name}  -- ${why}`); };
function assertClose(actual, expected, tol, label) {
  if (Math.abs(actual - expected) <= tol) ok(`${label}: ${actual.toExponential(6)} ≈ ${expected.toExponential(6)}`);
  else ng(label, `expected ≈ ${expected.toExponential(6)} ± ${tol}, got ${actual.toExponential(6)}`);
}
function assertEq(actual, expected, label) {
  if (actual === expected) ok(`${label}: ${JSON.stringify(actual)}`);
  else ng(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ────────────────────────────────────────────────────────────────────────
// Hand-calc ground truth
// ────────────────────────────────────────────────────────────────────────
const Fu = 827370875;            // A325 ultimate strength (Pa) — matches the bolt-shear receipt
const Ab = 157e-6;               // 157 mm² = 1.57e-4 m²
const Fnt = 0.75 * Fu;
const phiRn_HAND = 0.75 * Fnt * Ab;  // 0.75 · 0.75 · Fu · Ab
const DEMAND = 30000;            // 30 kN per bolt (single bolt, demand split = 1)

console.log("=== Hand-calc ground truth ===");
console.log(`  Fu = ${Fu.toExponential(4)} Pa`);
console.log(`  Ab = ${Ab.toExponential(4)} m²`);
console.log(`  Fnt = 0.75·Fu = ${Fnt.toExponential(4)} Pa`);
console.log(`  φRn = 0.75·Fnt·Ab = ${phiRn_HAND.toFixed(2)} N`);

// ────────────────────────────────────────────────────────────────────────
// Build the IR: 1 M16 A325 bolt, 30 kN tension
// ────────────────────────────────────────────────────────────────────────
const ir = {
  design: { id: "tension-test", name: "Single-bolt tension test" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "P1", kind: "Plate", material: "steel-a36",
      geometry: { shape: "plate", length: "0.1 m", width: "0.05 m", thickness: "0.01 m" } },
    { id: "B1", kind: "Bolt", material: "astm-a325",
      geometry: { shape: "bolt", diameter: "16 mm", length: "0.04 m" },
      props: { stressArea: "157 mm²" } },
    { id: "J1", kind: "Joint", props: { shearPlanes: 1 } },
  ],
  edges: [
    { type: "CONTAINS", from: "A1", to: "P1" },
    { type: "CONTAINS", from: "A1", to: "B1" },
    { type: "CONTAINS", from: "J1", to: "P1" },
    { type: "CONTAINS", from: "J1", to: "B1" },
  ],
  loadCases: [{ id: "LC1", loads: [{ target: "J1", tension: "30 kN" }] }],
};

const opened = openDesign(ir);
if (!opened.ok) {
  console.log("FAIL — design did not compile:", opened.errors);
  process.exit(1);
}
const envs = opened.session.results();
const tEnv = envs.find((e) => e.runId === "joint.bolt-tension@J1");

if (!tEnv) {
  console.log("FAIL — no joint.bolt-tension@J1 in envelopes. Got:", envs.map((e) => e.runId));
  process.exit(1);
}
console.log("\n=== joint.bolt-tension@J1 (solver output) ===");
console.log(`  status: ${tEnv.status}`);
if (tEnv.outputs) {
  for (const [k, v] of Object.entries(tEnv.outputs)) {
    console.log(`  ${k}: ${v.value}${v.unit || ""}`);
  }
}
console.log(`  margins: ${JSON.stringify(tEnv.margins)}`);

console.log("\n=== Assertions ===");
assertEq(tEnv.status, "PASS", "tension PASS at 30 kN demand");
if (tEnv.outputs?.governingCapacity) {
  assertClose(tEnv.outputs.governingCapacity.value, phiRn_HAND, 1.0, "governingCapacity matches AISC reference");
}
if (tEnv.margins?.[0]) {
  assertClose(tEnv.margins[0].demand, DEMAND, 1.0, "demand = 30 kN per bolt (1 bolt, 30 kN total)");
  assertClose(tEnv.margins[0].capacity, phiRn_HAND, 1.0, "margin capacity matches AISC reference");
}
if (tEnv.outputs?.threads) {
  assertEq(tEnv.outputs.threads.value, "included (N)", "threads labelled as N (included)");
}

// ────────────────────────────────────────────────────────────────────────
// Test: missing stressArea → NOT_COMPUTED with a precise reason
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Missing-input test: no stressArea ===");
const noAbIR = {
  ...ir,
  design: { id: "no-ab" },
  nodes: ir.nodes.map((n) => n.id === "B1" ? { ...n, props: {} } : n),
};
const noAbOpened = openDesign(noAbIR);
const noAbEnvs = noAbOpened.session.results();
const noAbT = noAbEnvs.find((e) => e.runId === "joint.bolt-tension@J1");
assertEq(noAbT?.status, "NOT_COMPUTED", "tension NOT_COMPUTED when stressArea missing");
if (noAbT?.reason) {
  console.log(`  reason: ${noAbT.reason.slice(0, 200)}`);
  if (noAbT.reason.includes("stressArea")) {
    ok("reason names the missing field (stressArea)");
  } else {
    ng("reason names the missing field", `expected 'stressArea' in reason, got: ${noAbT.reason}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Test: no tension demand → NOT_COMPUTED
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== No-tension-demand test ===");
const noTIR = {
  ...ir,
  design: { id: "no-tension" },
  loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "10 kN" }] }],
};
const noTOpened = openDesign(noTIR);
const noTEnvs = noTOpened.session.results();
const noTT = noTEnvs.find((e) => e.runId === "joint.bolt-tension@J1");
assertEq(noTT?.status, "NOT_COMPUTED", "tension NOT_COMPUTED when no tension demand");
if (noTT?.reason?.includes("no tension load")) {
  ok("reason names the missing condition");
} else {
  ng("reason names the missing condition", `expected 'no tension load' in reason, got: ${noTT?.reason}`);
}

// ────────────────────────────────────────────────────────────────────────
// Test: threads excluded → Fnt = 0.60·Fu
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Threads-excluded test (Fnt = 0.60·Fu) ===");
const exIR = {
  ...ir,
  design: { id: "excluded-threads" },
  nodes: ir.nodes.map((n) => n.id === "J1" ? { ...n, props: { shearPlanes: 1, threadsExcluded: true } } : n),
};
const exOpened = openDesign(exIR);
const exEnvs = exOpened.session.results();
const exT = exEnvs.find((e) => e.runId === "joint.bolt-tension@J1");
const phiRn_X = 0.75 * 0.60 * Fu * Ab;
console.log(`  expected φRn (X) = 0.75·0.60·Fu·Ab = ${phiRn_X.toFixed(2)} N`);
if (exT?.outputs?.governingCapacity) {
  assertClose(exT.outputs.governingCapacity.value, phiRn_X, 1.0, "φRn for X threads");
  assertEq(exT.outputs.threads?.value, "excluded (X)", "threads labelled as X (excluded)");
}

console.log(`\n================================================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(`================================================\n`);
if (fail > 0) process.exit(1);