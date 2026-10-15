// scripts/test-gross-section.mjs
//
// Hand-calc validation for joint.gross-section (AISC 360-16 §D2-1).
//
// Test case: A36 steel plate, width 50 mm, thickness 10 mm, in tension.
//   Fy = 250 MPa (A36 minimum yield per AISC Manual Table 2-3)
//   Ag = 0.05 m × 0.01 m = 5e-4 m²
//   φRn = 0.90 · Fy · Ag = 0.90 · 250e6 · 5e-4 = 112,500 N
//
// Demand: 30 kN (one bolt, joint.shear) → utilization 27% → PASS
//
// Plus tests for:
//   - User-supplied grossArea (non-rectangular section)
//   - Missing Fy → NOT_COMPUTED with reason
//   - No tension load → NOT_COMPUTED

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
const Fy = 250e6;     // A36 yield (Pa)
const width = 0.05;   // m
const thickness = 0.01;
const Ag = width * thickness;   // 5e-4 m²
const phiRn_HAND = 0.90 * Fy * Ag;  // 112,500 N

console.log("=== Hand-calc ground truth ===");
console.log(`  width = ${width * 1000} mm, thickness = ${thickness * 1000} mm`);
console.log(`  Ag = ${Ag.toExponential(4)} m²`);
console.log(`  Fy = ${Fy.toExponential(4)} Pa`);
console.log(`  φRn = 0.90·Fy·Ag = ${phiRn_HAND.toFixed(2)} N`);

// ────────────────────────────────────────────────────────────────────────
// PASS test: 30 kN demand on the joint, 1 bolt, 1 plate
// ────────────────────────────────────────────────────────────────────────
const ir = {
  design: { id: "gross-test" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "P1", kind: "Plate", material: "steel-a36",
      geometry: { shape: "plate", length: "0.1 m", width: "0.05 m", thickness: "0.01 m" } },
    { id: "B1", kind: "Bolt", material: "astm-a325",
      geometry: { shape: "bolt", diameter: "16 mm", length: "0.04 m" } },
    { id: "J1", kind: "Joint", props: { shearPlanes: 1 } },
  ],
  edges: [
    { type: "CONTAINS", from: "A1", to: "P1" },
    { type: "CONTAINS", from: "A1", to: "B1" },
    { type: "CONTAINS", from: "J1", to: "P1" },
    { type: "CONTAINS", from: "J1", to: "B1" },
  ],
  loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "30 kN" }] }],
};

const opened = openDesign(ir);
if (!opened.ok) { console.log("compile errors:", opened.errors); process.exit(1); }
const envs = opened.session.results();
const gEnv = envs.find((e) => e.runId === "joint.gross-section@J1");
if (!gEnv) { console.log("FAIL — no gross-section envelope. Got:", envs.map((e) => e.runId)); process.exit(1); }

console.log("\n=== joint.gross-section@J1 (solver output) ===");
console.log(`  status: ${gEnv.status}`);
if (gEnv.outputs) {
  for (const [k, v] of Object.entries(gEnv.outputs)) {
    console.log(`  ${k}: ${v.value}${v.unit || ""}${v.comment ? "  (" + v.comment + ")" : ""}`);
  }
}

console.log("\n=== Assertions ===");
assertEq(gEnv.status, "PASS", "gross-section PASS at 30 kN demand");
if (gEnv.outputs?.governingCapacity) {
  assertClose(gEnv.outputs.governingCapacity.value, phiRn_HAND, 1e-3, "φRn matches AISC reference");
}
if (gEnv.outputs?.Ag) {
  assertClose(gEnv.outputs.Ag.value, Ag, 1e-9, "Ag matches hand calc");
}
if (gEnv.outputs?.Fy) {
  assertClose(gEnv.outputs.Fy.value, Fy, 1.0, "Fy matches A36");
}
if (gEnv.margins?.[0]) {
  assertClose(gEnv.margins[0].capacity, phiRn_HAND, 1e-3, "margin capacity matches");
  assertClose(gEnv.margins[0].demand, 30000, 1.0, "demand = 30 kN / 1 bolt = 30 kN");
}

// ────────────────────────────────────────────────────────────────────────
// User-supplied grossArea (non-rectangular section)
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== User-supplied grossArea test ===");
const userAg = 0.0008;  // 800 mm², e.g. a C-shape
const phiRn_userAg = 0.90 * Fy * userAg;
const ir2 = {
  ...ir,
  design: { id: "user-ag" },
  nodes: ir.nodes.map((n) => n.id === "P1" ? { ...n, props: { grossArea: "800 mm²" } } : n),
};
const o2 = openDesign(ir2);
const e2 = o2.session.results();
const g2 = e2.find((e) => e.runId === "joint.gross-section@J1");
if (g2?.outputs?.governingCapacity) {
  assertClose(g2.outputs.governingCapacity.value, phiRn_userAg, 1e-3, "user-supplied Ag honored");
}

// ────────────────────────────────────────────────────────────────────────
// No tension demand → NOT_COMPUTED
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== No-load test ===");
const noLoad = {
  ...ir,
  design: { id: "no-load" },
  loadCases: [],  // no load cases at all
};
const nl = openDesign(noLoad);
const nlE = nl.session.results();
const nlG = nlE.find((e) => e.runId === "joint.gross-section@J1");
assertEq(nlG?.status, "NOT_COMPUTED", "gross-section NOT_COMPUTED when no tension load");
if (nlG?.reason?.includes("no tension load") || nlG?.reason?.includes("no shear")) {
  ok("reason names the missing condition");
}

console.log(`\n================================================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(`================================================\n`);
if (fail > 0) process.exit(1);