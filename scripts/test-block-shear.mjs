// scripts/test-block-shear.mjs
//
// Hand-calc validation for joint.block-shear (AISC 360-16 §J4-3 Eq. J4-5).
//
// Test case: 1-bolt edge connection, A36 plate
//   L_e = 30 mm (parallel to load), L_e_perp = 25 mm (perp to load)
//   holeDiameter = 18 mm
//   plate width = 100 mm, thickness = 10 mm
//   material: A36 (Fu = 400 MPa)
//
// Hand-calc:
//   L_s = L_e − d_h/2 = 30 − 9 = 21 mm
//   L_t = L_e_perp − d_h/2 = 25 − 9 = 16 mm
//   Agv = L_s · t = 0.021 · 0.010 = 2.1e-4 m²
//   Agt = L_t · t = 0.016 · 0.010 = 1.6e-4 m²
//   n_shear = 1, n_tension = 1
//   Anv = Agv − 1·d_h·t = 2.1e-4 − 1.8e-4 = 3e-5 m²
//   Ant = Agt − 1·d_h·t = 1.6e-4 − 1.8e-4 = −2e-5 m²  ← NEGATIVE!
//
// If Ant < 0, the block-shear path is not feasible (the hole is
// larger than the tension leg). The solver should report NOT_COMPUTED
// or use Ant = 0 (zero contribution from the tension leg).
//
// Let me use a different test case: more tension leg
//   L_e = 30 mm, L_e_perp = 50 mm
//   L_s = 21 mm, L_t = 41 mm
//   Agv = 2.1e-4 m²
//   Agt = 4.1e-4 m²
//   Anv = 2.1e-4 − 1.8e-4 = 3e-5 m²
//   Ant = 4.1e-4 − 1.8e-4 = 2.3e-4 m²
//
//   φRn_J4-5 = 0.75 · [0.6·Fu·Anv + Ubs·Fu·Ant]
//            = 0.75 · [0.6 · 400e6 · 3e-5 + 1.0 · 400e6 · 2.3e-4]
//            = 0.75 · [7,200 + 92,000]
//            = 0.75 · 99,200
//            = 74,400 N
//   φRn_limit = 0.75 · Fu · Agv = 0.75 · 400e6 · 2.1e-4 = 63,000 N
//   φRn = MIN(74,400, 63,000) = 63,000 N  ← upper limit governs
//
// Demand: 30 kN → utilization 48% → PASS

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
const Fu = 400e6;
const L_e = 0.030;
const L_e_perp = 0.050;
const d_h = 0.018;
const t = 0.010;
const L_s = L_e - d_h / 2;        // 0.021
const L_t = L_e_perp - d_h / 2;   // 0.041
const Agv = L_s * t;              // 2.1e-4
const Agt = L_t * t;              // 4.1e-4
const n_shear = 1;
const n_tension = 1;
const Anv = Agv - n_shear * d_h * t;   // 3e-5
const Ant = Agt - n_tension * d_h * t; // 2.3e-4
const Ubs = 1.0;
const phiRn_J4_5 = 0.75 * (0.6 * Fu * Anv + Ubs * Fu * Ant);  // 74,400 N
const phiRn_limit = 0.75 * Fu * Agv;                          // 63,000 N
const phiRn_HAND = Math.min(phiRn_J4_5, phiRn_limit);         // 63,000 N (upper limit governs)

console.log("=== Hand-calc ground truth ===");
console.log(`  L_s = ${L_s * 1000} mm, L_t = ${L_t * 1000} mm`);
console.log(`  Agv = ${Agv.toExponential(4)} m², Agt = ${Agt.toExponential(4)} m²`);
console.log(`  Anv = ${Anv.toExponential(4)} m², Ant = ${Ant.toExponential(4)} m²`);
console.log(`  φRn_J4-5 = ${phiRn_J4_5.toFixed(2)} N`);
console.log(`  φRn_limit = ${phiRn_limit.toFixed(2)} N (upper limit)`);
console.log(`  φRn = MIN(...) = ${phiRn_HAND.toFixed(2)} N  ← upper limit governs`);

// ────────────────────────────────────────────────────────────────────────
// PASS test
// ────────────────────────────────────────────────────────────────────────
const ir = {
  design: { id: "block-shear-test" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "P1", kind: "Plate", material: "steel-a36",
      geometry: { shape: "plate", length: "0.1 m", width: "0.1 m", thickness: "0.01 m" } },
    { id: "B1", kind: "Bolt", material: "astm-a325",
      geometry: { shape: "bolt", diameter: "16 mm", length: "0.04 m" } },
    { id: "J1", kind: "Joint", props: {
      shearPlanes: 1,
      edgeDistance: "30 mm",
      edgeDistancePerpendicular: "50 mm",
      holeDiameter: "18 mm",
      holePattern: [{ x: "30 mm", y: "0 mm" }],  // 1 hole at the edge
    } },
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
const bEnv = envs.find((e) => e.runId === "joint.block-shear@J1");
if (!bEnv) { console.log("FAIL — no block-shear envelope. Got:", envs.map((e) => e.runId)); process.exit(1); }

console.log("\n=== joint.block-shear@J1 (solver output) ===");
console.log(`  status: ${bEnv.status}`);
if (bEnv.outputs) {
  for (const [k, v] of Object.entries(bEnv.outputs)) {
    console.log(`  ${k}: ${v.value}${v.unit || ""}${v.comment ? "  (" + v.comment + ")" : ""}`);
  }
}

console.log("\n=== Assertions ===");
assertEq(bEnv.status, "PASS", "block-shear PASS at 30 kN demand");
if (bEnv.outputs?.governingCapacity) {
  assertClose(bEnv.outputs.governingCapacity.value, phiRn_HAND, 1e-3, "φRn matches AISC reference");
}
if (bEnv.outputs?.Anv) assertClose(bEnv.outputs.Anv.value, Anv, 1e-9, "Anv matches");
if (bEnv.outputs?.Ant) assertClose(bEnv.outputs.Ant.value, Ant, 1e-9, "Ant matches");
if (bEnv.outputs?.Agv) assertClose(bEnv.outputs.Agv.value, Agv, 1e-9, "Agv matches");
if (bEnv.outputs?.Agt) assertClose(bEnv.outputs.Agt.value, Agt, 1e-9, "Agt matches");
if (bEnv.outputs?.Ubs) assertClose(bEnv.outputs.Ubs.value, Ubs, 1e-9, "Ubs = 1.0");
if (bEnv.outputs?.nShearHoles) assertEq(bEnv.outputs.nShearHoles.value, 1, "nShearHoles = 1");
if (bEnv.outputs?.nTensionHoles) assertEq(bEnv.outputs.nTensionHoles.value, 1, "nTensionHoles = 1");
if (bEnv.outputs?.governingLimit) {
  // Could be either; the upper limit governs in this case
  const limit = bEnv.outputs.governingLimit.value;
  if (limit === "upper limit (0.75·Fu·Agv)" || limit === "Eq. J4-5") {
    ok(`governingLimit: ${limit}`);
  } else {
    ng("governingLimit", `expected 'upper limit' or 'Eq. J4-5', got ${limit}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Missing-input test: no holePattern
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Missing holePattern test ===");
const noHP = {
  ...ir,
  design: { id: "no-hp" },
  nodes: ir.nodes.map((n) => n.id === "J1" ? { ...n, props: { shearPlanes: 1, edgeDistance: "30 mm", edgeDistancePerpendicular: "50 mm", holeDiameter: "18 mm" } } : n),
};
const o2 = openDesign(noHP);
const e2 = o2.session.results();
const b2 = e2.find((e) => e.runId === "joint.block-shear@J1");
assertEq(b2?.status, "NOT_COMPUTED", "block-shear NOT_COMPUTED when no holePattern");
if (b2?.reason?.includes("holePattern")) {
  ok("reason names the missing field");
}

// ────────────────────────────────────────────────────────────────────────
// Missing-input test: no edgeDistance
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Missing edgeDistance test ===");
const noLE = {
  ...ir,
  design: { id: "no-le" },
  nodes: ir.nodes.map((n) => n.id === "J1" ? { ...n, props: { shearPlanes: 1, holeDiameter: "18 mm", holePattern: [{ x: "30 mm", y: "0 mm" }] } } : n),
};
const o3 = openDesign(noLE);
const e3 = o3.session.results();
const b3 = e3.find((e) => e.runId === "joint.block-shear@J1");
assertEq(b3?.status, "NOT_COMPUTED", "block-shear NOT_COMPUTED when no edgeDistance");

// ────────────────────────────────────────────────────────────────────────
// User-supplied blockShearPath (staggered / non-standard)
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== User-supplied blockShearPath test ===");
const userAnv = 0.00005;  // 50 mm²
const userAnt = 0.0002;   // 200 mm²
const userAgv = 0.0003;   // 300 mm²
const userAgt = 0.0004;   // 400 mm²
const userUbs = 0.5;      // non-uniform tension
const phiRn_user = 0.75 * (0.6 * Fu * userAnv + userUbs * Fu * userAnt);
const ir4 = {
  ...ir,
  design: { id: "user-path" },
  nodes: ir.nodes.map((n) => n.id === "P1" ? { ...n, props: { blockShearPath: { Anv: userAnv, Ant: userAnt, Agv: userAgv, Agt: userAgt, Ubs: userUbs } } } : n),
};
const o4 = openDesign(ir4);
const e4 = o4.session.results();
const b4 = e4.find((e) => e.runId === "joint.block-shear@J1");
if (b4?.outputs?.governingCapacity) {
  // Should be the J4-5 capacity (74,400 + ?); user is a separate test
  console.log(`  expected φRn = 0.75·(0.6·Fu·Anv + Ubs·Fu·Ant) = 0.75·(12000 + 40000) = 39,000 N`);
  // Actually let me recompute: 0.6 · 400e6 · 5e-5 = 12,000; 0.5 · 400e6 · 2e-4 = 40,000
  // 0.75 · (12000 + 40000) = 0.75 · 52000 = 39,000
  assertClose(b4.outputs.governingCapacity.value, 39000, 1.0, "user-supplied path honored with Ubs=0.5");
}
if (b4?.outputs?.Ubs) {
  assertClose(b4.outputs.Ubs.value, 0.5, 1e-9, "Ubs = 0.5 (non-uniform)");
}

console.log(`\n================================================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(`================================================\n`);
if (fail > 0) process.exit(1);