// scripts/test-net-section.mjs
//
// Hand-calc validation for joint.net-section (AISC 360-16 §D2-2).
//
// Test case: A36 plate, width 50 mm, thickness 10 mm, 1 bolt, 18 mm hole.
//   Fy = 250 MPa, Fu = 400 MPa (A36 typical)
//   Ag = 0.05 · 0.01 = 5e-4 m²
//   An = Ag − 1 · d_h · t = 5e-4 − 0.018 · 0.01 = 5e-4 − 1.8e-4 = 3.2e-4 m²
//   U = 1.0 (single-bolt, no shear lag)
//   Ae = U · An = 3.2e-4 m²
//   φRn = 0.75 · Fu · Ae = 0.75 · 400e6 · 3.2e-4 = 96,000 N
//
// Demand: 30 kN → utilization 31% → PASS
//
// Plus tests for:
//   - 2-bolt single-row hole pattern: 2 holes on the failure path
//   - User-supplied Ae (built-up section): honors it
//   - Missing holePattern AND no Ae: NOT_COMPUTED with reason

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
const Fu = 400e6;     // A36 ultimate (Pa)
const width = 0.05;
const thickness = 0.01;
const d_h = 0.018;
const Ag = width * thickness;
const n_holes = 1;
const An = Ag - n_holes * d_h * thickness;
const U = 1.0;
const Ae = U * An;
const phiRn_HAND = 0.75 * Fu * Ae;
console.log("=== Hand-calc ground truth ===");
console.log(`  Ag = ${Ag.toExponential(4)} m²`);
console.log(`  An = ${An.toExponential(4)} m² (= Ag − ${n_holes}·d_h·t)`);
console.log(`  Ae = U·An = ${Ae.toExponential(4)} m²`);
console.log(`  φRn = 0.75·Fu·Ae = ${phiRn_HAND.toFixed(2)} N`);

// ────────────────────────────────────────────────────────────────────────
// Test 1: single-bolt net-section
// ────────────────────────────────────────────────────────────────────────
const ir = {
  design: { id: "net-section-test" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "P1", kind: "Plate", material: "steel-a36",
      geometry: { shape: "plate", length: "0.1 m", width: "0.05 m", thickness: "0.01 m" } },
    { id: "B1", kind: "Bolt", material: "astm-a325",
      geometry: { shape: "bolt", diameter: "16 mm", length: "0.04 m" } },
    { id: "J1", kind: "Joint", props: {
      shearPlanes: 1,
      holeDiameter: "18 mm",
      holePattern: [{ x: "0 mm", y: "0 mm" }],
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
const nEnv = envs.find((e) => e.runId === "joint.net-section@J1");
if (!nEnv) { console.log("FAIL — no net-section envelope. Got:", envs.map((e) => e.runId)); process.exit(1); }

console.log("\n=== joint.net-section@J1 (solver output) ===");
console.log(`  status: ${nEnv.status}`);
if (nEnv.outputs) {
  for (const [k, v] of Object.entries(nEnv.outputs)) {
    console.log(`  ${k}: ${v.value}${v.unit || ""}${v.comment ? "  (" + v.comment + ")" : ""}`);
  }
}

console.log("\n=== Assertions ===");
assertEq(nEnv.status, "PASS", "net-section PASS at 30 kN demand");
if (nEnv.outputs?.governingCapacity) {
  assertClose(nEnv.outputs.governingCapacity.value, phiRn_HAND, 1e-3, "φRn matches AISC reference");
}
if (nEnv.outputs?.Ag) assertClose(nEnv.outputs.Ag.value, Ag, 1e-9, "Ag matches");
if (nEnv.outputs?.An) assertClose(nEnv.outputs.An.value, An, 1e-9, "An matches");
if (nEnv.outputs?.Ae) assertClose(nEnv.outputs.Ae.value, Ae, 1e-9, "Ae matches");
if (nEnv.outputs?.U) assertClose(nEnv.outputs.U.value, U, 1e-9, "U = 1.0 (single-bolt)");
if (nEnv.outputs?.nHoles) assertEq(nEnv.outputs.nHoles.value, 1, "nHoles = 1");

// ────────────────────────────────────────────────────────────────────────
// Test 2: 2-bolt single-row, holes on same x → 2 holes on the path
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== 2-bolt single-row test ===");
const ir2 = {
  ...ir,
  design: { id: "net-2bolts" },
  nodes: ir.nodes.map((n) => n.id === "J1" ? { ...n, props: {
    shearPlanes: 1,
    holeDiameter: "18 mm",
    holePattern: [
      { x: "0 mm", y: "0 mm" },
      { x: "0 mm", y: "30 mm" },  // same x as bolt 0, different y
    ],
  } } : n.id === "B1" ? { ...n, id: "B1" } : n),
  // Add second bolt
  edges: [...ir.edges, { type: "CONTAINS", from: "J1", to: "B2" }, { type: "CONTAINS", from: "A1", to: "B2" }],
  loadCases: ir.loadCases,
};
// Insert B2
ir2.nodes = [...ir.nodes.filter((n) => n.id !== "B1"), { id: "B1", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "16 mm", length: "0.04 m" } }, { id: "B2", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "16 mm", length: "0.04 m" } }];
// Hmm this is getting messy. Let me just hand-construct IR 2
const ir2clean = {
  design: { id: "net-2bolts" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "P1", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "0.1 m", width: "0.05 m", thickness: "0.01 m" } },
    { id: "B1", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "16 mm", length: "0.04 m" } },
    { id: "B2", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "16 mm", length: "0.04 m" } },
    { id: "J1", kind: "Joint", props: {
      shearPlanes: 1,
      holeDiameter: "18 mm",
      holePattern: [
        { x: "0 mm", y: "0 mm" },
        { x: "0 mm", y: "30 mm" },
      ],
    } },
  ],
  edges: [
    { type: "CONTAINS", from: "A1", to: "P1" },
    { type: "CONTAINS", from: "A1", to: "B1" },
    { type: "CONTAINS", from: "A1", to: "B2" },
    { type: "CONTAINS", from: "J1", to: "P1" },
    { type: "CONTAINS", from: "J1", to: "B1" },
    { type: "CONTAINS", from: "J1", to: "B2" },
  ],
  loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "30 kN" }] }],
};
const o2 = openDesign(ir2clean);
const e2 = o2.session.results();
const n2 = e2.find((e) => e.runId === "joint.net-section@J1");
if (n2?.outputs?.nHoles) {
  assertEq(n2.outputs.nHoles.value, 2, "2 holes on critical path (both at x=0)");
  // An = Ag - 2 · d_h · t = 5e-4 - 2 · 0.018 · 0.01 = 5e-4 - 3.6e-4 = 1.4e-4 m²
  // φRn = 0.75 · 400e6 · 1.4e-4 = 42,000 N
  const An2 = 5e-4 - 2 * 0.018 * 0.01;
  const phiRn2 = 0.75 * Fu * An2;
  if (n2.outputs.governingCapacity) {
    assertClose(n2.outputs.governingCapacity.value, phiRn2, 1.0, "φRn for 2-bolt matches AISC reference");
  }
}

// ────────────────────────────────────────────────────────────────────────
// Test 3: user-supplied Ae (built-up section)
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== User-supplied Ae test ===");
const Ae_user = 6e-4;  // 600 mm² effective area
const phiRn_user = 0.75 * Fu * Ae_user;
const ir3 = {
  ...ir,
  design: { id: "user-ae" },
  nodes: ir.nodes.map((n) => n.id === "P1" ? { ...n, props: { netAreaEffective: "600 mm²" } } : n),
};
const o3 = openDesign(ir3);
const e3 = o3.session.results();
const n3 = e3.find((e) => e.runId === "joint.net-section@J1");
if (n3?.outputs?.governingCapacity) {
  assertClose(n3.outputs.governingCapacity.value, phiRn_user, 1e-3, "user-supplied Ae honored");
}

// ────────────────────────────────────────────────────────────────────────
// Test 4: no holePattern, no Ae → NOT_COMPUTED with reason
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Missing-input test (joint with bolts but no holePattern) ===");
const ir4 = {
  design: { id: "no-holes" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "P1", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "0.1 m", width: "0.05 m", thickness: "0.01 m" } },
    { id: "B1", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "16 mm", length: "0.04 m" } },
    { id: "J1", kind: "Joint", props: { shearPlanes: 1 } },  // no holePattern, no holeDiameter
  ],
  edges: [
    { type: "CONTAINS", from: "A1", to: "P1" },
    { type: "CONTAINS", from: "A1", to: "B1" },
    { type: "CONTAINS", from: "J1", to: "P1" },
    { type: "CONTAINS", from: "J1", to: "B1" },
  ],
  loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "30 kN" }] }],
};
const o4 = openDesign(ir4);
const e4 = o4.session.results();
const n4 = e4.find((e) => e.runId === "joint.net-section@J1");
assertEq(n4?.status, "NOT_COMPUTED", "net-section NOT_COMPUTED when no holePattern/Ae");
if (n4?.reason?.includes("holePattern") || n4?.reason?.includes("netAreaEffective")) {
  ok("reason names the missing field");
}

console.log(`\n================================================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(`================================================\n`);
if (fail > 0) process.exit(1);