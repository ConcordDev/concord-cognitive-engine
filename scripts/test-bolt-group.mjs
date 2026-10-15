// scripts/test-bolt-group.mjs
//
// Hand-calc validation for joint.bolt-group-distribution (Crawford-Kulak
// elastic method).
//
// Test case 1: Concentric load, 4 bolts in a 2x2 grid (50mm spacing)
//   P = 40 kN in +X
//   Centroid = (25, 25) mm
//   Direct shear per bolt = 40/4 = 10 kN
//   M = 0, so torsional = 0
//   Per-bolt resultant = 10 kN, all in +X direction
//
// Test case 2: Eccentric load, 4 bolts in 2x2 grid, eccentricity = 100 mm in +Y
//   P = 40 kN in +X
//   M = P · e = 40,000 · 0.1 = 4,000 N·m (about the bolt-group centroid)
//   J = Σ r_i²
//     r_1 = (50-25, 50-25) = (25, 25) mm → r² = 1250 mm²
//     r_2 = (50-25, 0-25) = (25, -25) mm → r² = 1250 mm²
//     r_3 = (0-25, 50-25) = (-25, 25) mm → r² = 1250 mm²
//     r_4 = (0-25, 0-25) = (-25, -25) mm → r² = 1250 mm²
//     J = 4 · 1250 = 5000 mm² = 5e-3 m²
//
//   For each bolt:
//     F_direct = (40,000/4) = 10,000 N in +X
//     F_torsion = (M/J) · (-dy, dx)  for each bolt
//               = (4000/5e-3) · (-dy, dx)
//               = 800,000 · (-dy, dx)
//   Bolt 1 (r=(25,25)): F_t = 800,000·(-25e-3, 25e-3) = (-20,000, 20,000)
//                       F_total = (10,000-20,000, 0+20,000) = (-10,000, 20,000)
//                       F_mag = √(100M + 400M) = √500M = 22,361 N
//                       angle = atan2(20,000, -10,000) = 116.6°
//   Bolt 2 (r=(25,-25)): F_t = 800,000·(25e-3, 25e-3) = (20,000, 20,000)
//                        F_total = (10,000+20,000, 0+20,000) = (30,000, 20,000)
//                        F_mag = √(900M + 400M) = √1300M = 36,056 N
//                        angle = atan2(20,000, 30,000) = 33.7°
//   Bolt 3 (r=(-25,25)): F_t = 800,000·(-25e-3, -25e-3) = (-20,000, -20,000)
//                        F_total = (10,000-20,000, 0-20,000) = (-10,000, -20,000)
//                        F_mag = √(100M + 400M) = 22,361 N
//                        angle = atan2(-20,000, -10,000) = -116.6°
//   Bolt 4 (r=(-25,-25)): F_t = 800,000·(25e-3, -25e-3) = (20,000, -20,000)
//                         F_total = (10,000+20,000, 0-20,000) = (30,000, -20,000)
//                         F_mag = √(900M + 400M) = 36,056 N
//                         angle = atan2(-20,000, 30,000) = -33.7°
//
//   The governing bolt is bolt 2 (or bolt 4, by symmetry) with F = 36,056 N

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
// Hand-calc for concentric load
// ────────────────────────────────────────────────────────────────────────
const P_conc = 40000;
const F_per_bolt_conc = P_conc / 4;  // 10,000 N
console.log("=== Hand-calc: concentric load ===");
console.log(`  P = ${P_conc} N, 4 bolts, F_direct = ${F_per_bolt_conc} N each`);

// ────────────────────────────────────────────────────────────────────────
// Hand-calc for eccentric load
// ────────────────────────────────────────────────────────────────────────
const P_ecc = 40000;
const e = 0.1;
const M = P_ecc * e;  // 4,000 N·m
const J = 4 * (0.025 * 0.025 + 0.025 * 0.025);  // 5e-3 m²
const F_governing = Math.sqrt(30000 * 30000 + 20000 * 20000);  // 36,055.5 N
const angle_governing = Math.atan2(20000, 30000) * 180 / Math.PI;  // 33.69°
console.log("\n=== Hand-calc: eccentric load ===");
console.log(`  P = ${P_ecc} N, e = ${e * 1000} mm, M = ${M} N·m`);
console.log(`  J = ${J.toExponential(4)} m²`);
console.log(`  Governing bolt force = ${F_governing.toFixed(2)} N at ${angle_governing.toFixed(2)}°`);

// ────────────────────────────────────────────────────────────────────────
// Test 1: concentric load
// ────────────────────────────────────────────────────────────────────────
const ir1 = {
  design: { id: "group-concentric" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "P1", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "0.1 m", width: "0.1 m", thickness: "0.01 m" } },
    { id: "B1", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "16 mm", length: "0.04 m" } },
    { id: "B2", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "16 mm", length: "0.04 m" } },
    { id: "B3", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "16 mm", length: "0.04 m" } },
    { id: "B4", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "16 mm", length: "0.04 m" } },
    { id: "J1", kind: "Joint", props: {
      shearPlanes: 1,
      holePattern: [
        { x: "0 mm", y: "0 mm" },
        { x: "50 mm", y: "0 mm" },
        { x: "0 mm", y: "50 mm" },
        { x: "50 mm", y: "50 mm" },
      ],
    } },
  ],
  edges: [
    { type: "CONTAINS", from: "A1", to: "P1" },
    { type: "CONTAINS", from: "A1", to: "B1" },
    { type: "CONTAINS", from: "A1", to: "B2" },
    { type: "CONTAINS", from: "A1", to: "B3" },
    { type: "CONTAINS", from: "A1", to: "B4" },
    { type: "CONTAINS", from: "J1", to: "P1" },
    { type: "CONTAINS", from: "J1", to: "B1" },
    { type: "CONTAINS", from: "J1", to: "B2" },
    { type: "CONTAINS", from: "J1", to: "B3" },
    { type: "CONTAINS", from: "J1", to: "B4" },
  ],
  loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "40 kN" }] }],
};
const o1 = openDesign(ir1);
const e1 = o1.session.results();
const g1 = e1.find((x) => x.runId === "joint.bolt-group-distribution@J1");
if (!g1) { console.log("FAIL — no group-distribution envelope. Got:", e1.map((x) => x.runId)); process.exit(1); }
console.log("\n=== joint.bolt-group-distribution@J1 (concentric) ===");
console.log(`  status: ${g1.status}`);
if (g1.outputs?.perBolt) {
  for (const b of g1.outputs.perBolt.value) {
    console.log(`    ${b.bolt}: F = ${b.F.toFixed(2)} N, angle = ${b.angle.toFixed(2)}°`);
  }
}
if (g1.outputs?.governingForce) {
  assertClose(g1.outputs.governingForce.value, F_per_bolt_conc, 1.0, "concentric governing force = P/n = 10 kN");
}

// ────────────────────────────────────────────────────────────────────────
// Test 2: eccentric load
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Eccentric load test ===");
const ir2 = {
  ...ir1,
  design: { id: "group-eccentric" },
  nodes: ir1.nodes.map((n) => n.id === "J1" ? { ...n, props: { ...n.props, eccentricity: { x: "0 mm", y: "100 mm" } } } : n),
};
const o2 = openDesign(ir2);
const e2 = o2.session.results();
const g2 = e2.find((x) => x.runId === "joint.bolt-group-distribution@J1");
console.log(`  status: ${g2.status}`);
if (g2.outputs?.governingForce) {
  assertClose(g2.outputs.governingForce.value, F_governing, 1.0, "eccentric governing force");
}
if (g2.outputs?.governingAngle) {
  // The hand-calc says +33.69° (B2) or -33.69° (B4). Either is valid
  // (the two governing bolts are symmetric). Use abs() in the comparison.
  const expected = Math.abs(angle_governing);
  const actual = Math.abs(g2.outputs.governingAngle.value);
  assertClose(actual, expected, 0.5, "eccentric governing angle (|angle|)");
}
if (g2.outputs?.J) {
  assertClose(g2.outputs.J.value, J, 1e-6, "polar moment J = 5e-3 m²");
}
if (g2.outputs?.perBolt) {
  for (const b of g2.outputs.perBolt.value) {
    console.log(`    ${b.bolt}: F = ${b.F.toFixed(2)} N, angle = ${b.angle.toFixed(2)}°`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Test 3: missing holePattern
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Missing holePattern test ===");
const ir3 = {
  ...ir1,
  design: { id: "no-hp" },
  nodes: ir1.nodes.map((n) => n.id === "J1" ? { ...n, props: { shearPlanes: 1 } } : n),
};
const o3 = openDesign(ir3);
const e3 = o3.session.results();
const g3 = e3.find((x) => x.runId === "joint.bolt-group-distribution@J1");
assertEq(g3?.status, "NOT_COMPUTED", "group-dist NOT_COMPUTED when no holePattern");

// ────────────────────────────────────────────────────────────────────────
// Test 4: holePattern length mismatch
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Length-mismatch test ===");
const ir4 = {
  ...ir1,
  design: { id: "mismatch" },
  nodes: ir1.nodes.map((n) => n.id === "J1" ? { ...n, props: { shearPlanes: 1, holePattern: [{ x: "0 mm", y: "0 mm" }] } } : n),
};
const o4 = openDesign(ir4);
const e4 = o4.session.results();
const g4 = e4.find((x) => x.runId === "joint.bolt-group-distribution@J1");
assertEq(g4?.status, "NOT_COMPUTED", "group-dist NOT_COMPUTED when holePattern.length != bolts.length");
if (g4?.reason?.includes("holePattern has 1 entries")) {
  ok("reason names the length mismatch");
}

console.log(`\n================================================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(`================================================\n`);
if (fail > 0) process.exit(1);