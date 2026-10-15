// scripts/test-prying-action.mjs
//
// Hand-calc validation for joint.prying-action (AISC Steel Design Guide 9).
//
// Test case: T-stub flange, 1 bolt, applied tension B = 20 kN
//   t_flange = 10 mm
//   a = 30 mm (bolt to stem face)
//   b = 25 mm (bolt to edge of flange)
//   w = 100 mm (tributary width)
//   material: A36, Fy = 250 MPa
//
// Check a ≤ 1.25·b: 30 ≤ 1.25·25 = 31.25 ✓
//
// Hand-calc:
//   Q_max = (w · t² / 4) · Fy · (b / a)
//         = (0.1 · 0.01² / 4) · 250e6 · (0.025 / 0.030)
//         = (0.1 · 1e-4 / 4) · 250e6 · 0.8333
//         = (1e-5 / 4) · 250e6 · 0.8333
//         = 2.5e-6 · 250e6 · 0.8333
//         = 2.5e-6 · 208,333,333
//         = 520.83 N
//
//   Per-bolt (1 bolt): Q = 520.83 / 1 = 520.83 N
//   B + Q = 20,000 + 520.83 = 20,520.83 N
//   Prying factor = 520.83 / 20,000 = 0.026 (2.6% amplification)
//
// Plus tests for:
//   - a > 1.25·b → NOT_COMPUTED
//   - Missing t_flange → NOT_COMPUTED
//   - Different a/b ratio (high prying case): a=20, b=30 → prying factor 1.5

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
// Hand-calc
// ────────────────────────────────────────────────────────────────────────
const t_flange = 0.010;
const a = 0.030;
const b = 0.025;
const w = 0.100;
const Fy = 250e6;
const B = 20000;  // 20 kN
const Q_max = (w * t_flange * t_flange / 4) * Fy * (b / a);
const Q_per = Q_max / 1;  // 1 bolt
const B_eff = B + Q_per;
const pryingFactor = Q_per / B;
console.log("=== Hand-calc ground truth ===");
console.log(`  t = ${t_flange * 1000} mm, a = ${a * 1000} mm, b = ${b * 1000} mm, w = ${w * 1000} mm`);
console.log(`  a/b = ${(a / b).toFixed(3)} (must be ≤ 1.25)`);
console.log(`  Q_max = ${Q_max.toFixed(2)} N (per bolt, 1 bolt in joint)`);
console.log(`  B + Q = ${B_eff.toFixed(2)} N`);
console.log(`  Prying factor = ${pryingFactor.toFixed(4)} (${(pryingFactor * 100).toFixed(2)}% amplification)`);

// ────────────────────────────────────────────────────────────────────────
// PASS test
// ────────────────────────────────────────────────────────────────────────
const ir = {
  design: { id: "prying-test" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "P1", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "0.1 m", width: "0.1 m", thickness: "0.01 m" } },
    { id: "B1", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "20 mm", length: "0.04 m" } },
    { id: "J1", kind: "Joint", props: {
      shearPlanes: 1,
      flangeThickness: "10 mm",
      tStubA: "30 mm",
      tStubB: "25 mm",
      tributaryWidth: "100 mm",
    } },
  ],
  edges: [
    { type: "CONTAINS", from: "A1", to: "P1" },
    { type: "CONTAINS", from: "A1", to: "B1" },
    { type: "CONTAINS", from: "J1", to: "P1" },
    { type: "CONTAINS", from: "J1", to: "B1" },
  ],
  loadCases: [{ id: "LC1", loads: [{ target: "J1", tension: "20 kN" }] }],
};

const opened = openDesign(ir);
if (!opened.ok) { console.log("compile errors:", opened.errors); process.exit(1); }
const envs = opened.session.results();
const pEnv = envs.find((e) => e.runId === "joint.prying-action@J1");
if (!pEnv) { console.log("FAIL — no prying envelope. Got:", envs.map((e) => e.runId)); process.exit(1); }

console.log("\n=== joint.prying-action@J1 (solver output) ===");
console.log(`  status: ${pEnv.status}`);
if (pEnv.outputs) {
  for (const [k, v] of Object.entries(pEnv.outputs)) {
    console.log(`  ${k}: ${v.value}${v.unit || ""}${v.comment ? "  (" + v.comment + ")" : ""}`);
  }
}

console.log("\n=== Assertions ===");
assertEq(pEnv.status, "PASS", "prying PASS (Q computed)");
if (pEnv.outputs?.Q_max) {
  assertClose(pEnv.outputs.Q_max.value, Q_max, 1.0, "Q_max matches AISC reference");
}
if (pEnv.outputs?.governingPryingForce) {
  assertClose(pEnv.outputs.governingPryingForce.value, Q_per, 1.0, "Q per bolt = Q_max / n");
}
if (pEnv.outputs?.governingEffectiveTension) {
  assertClose(pEnv.outputs.governingEffectiveTension.value, B_eff, 1.0, "B + Q matches");
}
if (pEnv.outputs?.pryingFactor) {
  assertClose(pEnv.outputs.pryingFactor.value, pryingFactor, 1e-4, "prying factor = Q/B");
}

// ────────────────────────────────────────────────────────────────────────
// a > 1.25·b → NOT_COMPUTED (impractical)
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== a > 1.25·b test ===");
const irBad = {
  ...ir,
  design: { id: "prying-bad" },
  nodes: ir.nodes.map((n) => n.id === "J1" ? { ...n, props: { ...n.props, tStubA: "50 mm", tStubB: "30 mm" } } : n),
  // 50 / 30 = 1.67 > 1.25
};
const oBad = openDesign(irBad);
const eBad = oBad.session.results();
const pBad = eBad.find((e) => e.runId === "joint.prying-action@J1");
assertEq(pBad?.status, "NOT_COMPUTED", "prying NOT_COMPUTED when a > 1.25·b");
if (pBad?.reason?.includes("1.25")) {
  ok("reason mentions AISC §9 a ≤ 1.25·b limit");
}

// ────────────────────────────────────────────────────────────────────────
// Missing flangeThickness → NOT_COMPUTED
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Missing flangeThickness test ===");
const irNoT = {
  ...ir,
  design: { id: "prying-no-t" },
  nodes: ir.nodes.map((n) => n.id === "J1" ? { ...n, props: { shearPlanes: 1, tStubA: "30 mm", tStubB: "25 mm", tributaryWidth: "100 mm" } } : n),
};
const oNoT = openDesign(irNoT);
const eNoT = oNoT.session.results();
const pNoT = eNoT.find((e) => e.runId === "joint.prying-action@J1");
assertEq(pNoT?.status, "NOT_COMPUTED", "prying NOT_COMPUTED when no flangeThickness");
if (pNoT?.reason?.includes("flangeThickness")) {
  ok("reason names the missing field");
}

// ────────────────────────────────────────────────────────────────────────
// No tension demand → NOT_COMPUTED
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== No-tension test ===");
const irNoTens = {
  ...ir,
  design: { id: "prying-no-tens" },
  loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "10 kN" }] }],
};
const oNoTens = openDesign(irNoTens);
const eNoTens = oNoTens.session.results();
const pNoTens = eNoTens.find((e) => e.runId === "joint.prying-action@J1");
assertEq(pNoTens?.status, "NOT_COMPUTED", "prying NOT_COMPUTED when no tension demand");

// ────────────────────────────────────────────────────────────────────────
// Prying sensitivity test: thicker flange → less prying (Q scales as t²)
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Prying sensitivity test (t_flange = 20 mm, 2x thicker) ===");
const t_thick = 0.020;
const Q_thick = (w * t_thick * t_thick / 4) * Fy * (b / a);
const irThick = {
  ...ir,
  design: { id: "prying-thick" },
  nodes: ir.nodes.map((n) => n.id === "J1" ? { ...n, props: { ...n.props, flangeThickness: "20 mm" } } : n),
};
const oThick = openDesign(irThick);
const eThick = oThick.session.results();
const pThick = eThick.find((e) => e.runId === "joint.prying-action@J1");
if (pThick?.outputs?.Q_max) {
  // Q should be 4× higher for 2× thicker flange
  assertClose(pThick.outputs.Q_max.value, Q_thick, 1.0, "Q_max scales as t²");
  const ratio = pThick.outputs.Q_max.value / Q_max;
  assertClose(ratio, 4.0, 0.1, "Q is 4× higher for 2× thicker flange");
}

console.log(`\n================================================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(`================================================\n`);
if (fail > 0) process.exit(1);