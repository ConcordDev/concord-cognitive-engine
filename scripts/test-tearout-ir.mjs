// scripts/test-tearout-ir.mjs
//
// Tests the new IR fields (edgeDistance, holeDiameter) and the new
// joint.bolt-tearout solver against AISC 360-16 §J3.10c.
//
// Acceptance criteria:
//   1. Backward compatibility: old designs (no edgeDistance) still compile.
//   2. New fields are unit-converted: "20 mm" becomes 0.02 m.
//   3. New fields are bounds-checked: edgeDistance > holeDiameter/2.
//   4. AISC reference case: one 7/8 in A325 bolt, 1.5 in edge distance,
//      15/16 in hole, 1/2 in plate thickness, A36 plate, gives
//      φRn_tearout = 0.75 · 1.5 · Lc · t · Fu (Lc = L_e - d_h/2).
//   5. Tear-out capacity is bounded above by J3-6a (bearing).
//   6. Missing edgeDistance / holeDiameter yields notComputed with a
//      structured reason, never a fabricated default.

import { compileDesignIR, TYPED_JOINT_PROPS } from "/Users/dutch/concord vs code/concord-cognitive-engine/server/lib/conkay/compiler/design-ir.js";
import { openDesign } from "/Users/dutch/concord vs code/concord-cognitive-engine/server/lib/conkay/index.js";
import { aggregateJointVerdict, JOINT_VERDICT } from "/Users/dutch/concord vs code/concord-cognitive-engine/server/lib/conkay/physics/solvers/joint-governing-check.js";

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✓ ${name}`); };
const ng = (name, why) => { fail++; console.log(`  ✗ ${name}  -- ${why}`); };

function assertEq(actual, expected, label) {
  if (actual === expected) ok(`${label}: ${JSON.stringify(actual)}`);
  else ng(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertClose(actual, expected, tol, label) {
  if (Math.abs(actual - expected) <= tol) ok(`${label}: ${actual.toFixed(6)} ≈ ${expected}`);
  else ng(label, `expected ≈ ${expected} ± ${tol}, got ${actual}`);
}

function assertErr(compile, expectedSubstring, label) {
  if (!compile.ok) {
    const has = compile.errors.some((e) => e.includes(expectedSubstring));
    if (has) ok(`${label}: "${expectedSubstring}" in errors`);
    else ng(label, `errors do not contain "${expectedSubstring}": ${JSON.stringify(compile.errors)}`);
  } else {
    ng(label, `expected compile failure with "${expectedSubstring}", got ok`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// IR-LEVEL TESTS — these exercise the compiler, not the solver
// ────────────────────────────────────────────────────────────────────────
console.log("\n================================================");
console.log("IR COMPILER TESTS");
console.log("================================================\n");

console.log("[IR-1] Backward compatibility: old design without edgeDistance still compiles.");
const oldIR = {
  design: { id: "old", name: "Old design" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "P1", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" } },
    { id: "B1", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "16 mm", length: "40 mm" } },
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
const oldC = compileDesignIR(oldIR);
assertEq(oldC.ok, true, "old design compiles");
if (oldC.ok) {
  const j1 = oldC.design.nodes.find((n) => n.id === "J1");
  assertEq(j1?.props?.edgeDistance, undefined, "edgeDistance remains undefined (no default)");
  assertEq(j1?.props?.holeDiameter, undefined, "holeDiameter remains undefined (no default)");
}

console.log("\n[IR-2] New fields are unit-converted (mm → m).");
const newIR = {
  ...oldIR,
  nodes: oldIR.nodes.map((n) => n.id === "J1"
    ? { ...n, props: { ...n.props, edgeDistance: "20 mm", holeDiameter: "17 mm" } }
    : n),
};
const newC = compileDesignIR(newIR);
assertEq(newC.ok, true, "new design compiles");
if (newC.ok) {
  const j1 = newC.design.nodes.find((n) => n.id === "J1");
  assertClose(j1.props.edgeDistance, 0.02, 1e-9, "edgeDistance 20 mm → 0.02 m");
  assertClose(j1.props.holeDiameter, 0.017, 1e-9, "holeDiameter 17 mm → 0.017 m");
}

console.log("\n[IR-3] edgeDistance > holeDiameter/2 is enforced.");
const badIR = {
  ...oldIR,
  nodes: oldIR.nodes.map((n) => n.id === "J1"
    ? { ...n, props: { ...n.props, edgeDistance: "5 mm", holeDiameter: "17 mm" } }
    : n),
};
const badC = compileDesignIR(badIR);
assertErr(badC, "edgeDistance", "edgeDistance 5mm vs holeDiameter 17mm rejected");

console.log("\n[IR-4] Mixed units accepted (edgeDistance in mm, holeDiameter in inches, decimals).");
const mixedIR = {
  ...oldIR,
  nodes: oldIR.nodes.map((n) => n.id === "J1"
    ? { ...n, props: { ...n.props, edgeDistance: "1.5 in", holeDiameter: "0.9375 in" } }
    : n),
};
const mixedC = compileDesignIR(mixedIR);
assertEq(mixedC.ok, true, "mixed-unit design compiles");
if (mixedC.ok) {
  const j1 = mixedC.design.nodes.find((n) => n.id === "J1");
  assertClose(j1.props.edgeDistance, 0.0381, 1e-6, "1.5 in → 0.0381 m");
  assertClose(j1.props.holeDiameter, 0.0238125, 1e-6, "0.9375 in → 0.0238 m");
}

// ────────────────────────────────────────────────────────────────────────
// SOLVER-LEVEL TESTS — these exercise joint.bolt-tearout
// ────────────────────────────────────────────────────────────────────────
console.log("\n================================================");
console.log("SOLVER TESTS — joint.bolt-tearout");
console.log("================================================\n");

// AISC 360-16 reference: 7/8 in A325 bolt, 1.5 in edge distance,
// 15/16 in nominal hole, 1/2 in plate, A36 (Fu = 400 MPa, 58 ksi).
// Lc = L_e - d_h/2 = 1.5 in - 15/16 / 2 in = 1.5 - 0.46875 = 1.03125 in = 0.02619 m.
// t = 0.5 in = 0.0127 m.
// J3-6a (bearing):  φRn = 0.75 · 2.4 · d · t · Fu = 0.75 · 2.4 · 0.875 in · 0.5 in · 58 ksi
//                  = 0.75 · 2.4 · 0.022225 m · 0.0127 m · 400e6 Pa
//                  = 203,002 N (≈ 45.6 kips)
// J3-6c (tear-out): φRn = 0.75 · 1.5 · Lc · t · Fu = 0.75 · 1.5 · 0.02619 m · 0.0127 m · 400e6
//                  = 149,693 N (≈ 33.7 kips), bounded above by J3-6a = 203,002 N
//                  So the actual capacity is the smaller: 149,693 N.
const AISC_LEDGE = 0.0381; // 1.5 in
const AISC_DHOLE = 0.0238125; // 15/16 in
const AISC_T = 0.0127; // 0.5 in
const AISC_FU = 400e6;
const AISC_D = 0.875 * 0.0254; // 7/8 in
const AISC_LC = AISC_LEDGE - AISC_DHOLE / 2;
const AISC_J3_6a = 0.75 * 2.4 * AISC_D * AISC_T * AISC_FU;
const AISC_J3_6c_uncapped = 0.75 * 1.5 * AISC_LC * AISC_T * AISC_FU;
const AISC_J3_6c = Math.min(AISC_J3_6c_uncapped, AISC_J3_6a);

console.log(`Reference: AISC 360-16 §J3.10c reference case`);
console.log(`  7/8 in A325 bolt, 1.5 in edge, 15/16 in hole, 1/2 in plate, A36`);
console.log(`  Lc = ${AISC_LC.toFixed(6)} m = ${(AISC_LC / 0.0254).toFixed(4)} in`);
console.log(`  J3-6a (bearing) = ${AISC_J3_6a.toFixed(0)} N = ${(AISC_J3_6a / 4448).toFixed(2)} kips`);
console.log(`  J3-6c (tear-out) = ${AISC_J3_6c.toFixed(0)} N = ${(AISC_J3_6c / 4448).toFixed(2)} kips`);

// Open the design with edge distance + hole diameter
const aiscIR = {
  design: { id: "aisc-ref", name: "AISC reference" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "P1", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: `${AISC_T} m` } },
    { id: "B1", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: `${AISC_D} m`, length: "50 mm" } },
    { id: "J1", kind: "Joint", props: { shearPlanes: 1, edgeDistance: `${AISC_LEDGE} m`, holeDiameter: `${AISC_DHOLE} m` } },
  ],
  edges: [
    { type: "CONTAINS", from: "A1", to: "P1" },
    { type: "CONTAINS", from: "A1", to: "B1" },
    { type: "CONTAINS", from: "J1", to: "P1" },
    { type: "CONTAINS", from: "J1", to: "B1" },
  ],
  loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "40 kN" }] }],
};
const aiscOpened = openDesign(aiscIR);
assertEq(aiscOpened.ok, true, "AISC reference design opens");
const aiscSession = aiscOpened.session;
const aiscEnvs = aiscSession.results();

// Find the tear-out envelope
const tearout = aiscEnvs.find((e) => e.runId === "joint.bolt-tearout@J1");
if (tearout) {
  console.log(`\ntear-out envelope: status=${tearout.status} runtimeMs=${tearout.runtimeMs}`);
  console.log(`  outputs: ${JSON.stringify(tearout.outputs)}`);
  console.log(`  margins: ${JSON.stringify(tearout.margins, null, 2)}`);
  console.log(`  assumptions: ${JSON.stringify(tearout.assumptions)}`);

  // Check the tear-out capacity
  if (tearout.outputs?.tearoutCapacity) {
    const capacity = tearout.outputs.tearoutCapacity.value;
    assertClose(capacity, AISC_J3_6c, 1.0, "tear-out capacity matches AISC reference");
  } else {
    ng("tear-out capacity present", `outputs: ${JSON.stringify(tearout.outputs)}`);
  }

  // Check the bearing cap (J3-6a) is reported
  if (tearout.outputs?.bearingCapacity) {
    const cap = tearout.outputs.bearingCapacity.value;
    assertClose(cap, AISC_J3_6a, 1.0, "bearing cap (J3-6a) reported");
  } else {
    ng("bearing cap present", `outputs: ${JSON.stringify(tearout.outputs)}`);
  }

  // Check status is PASS at this load
  const shear = aiscEnvs.find((e) => e.runId === "joint.bolt-shear@J1");
  const bearing = aiscEnvs.find((e) => e.runId === "joint.bolt-bearing@J1");
  const gov = aiscEnvs.find((e) => e.runId === "joint.governing-check@J1");

  console.log(`\n  joint.bolt-shear@J1: status=${shear?.status}`);
  console.log(`  joint.bolt-bearing@J1: status=${bearing?.status}`);
  console.log(`  joint.bolt-tearout@J1: status=${tearout.status}`);
  console.log(`  joint.governing-check@J1: status=${gov?.status}, reason=${gov?.reason?.slice(0, 200)}`);

  // Tear-out should be PASS at 40 kN demand (capacity ~33.7 kips = 150 kN, so 40kN < 150kN → PASS)
  assertEq(tearout.status, "PASS", "tear-out PASS at 40 kN demand");
} else {
  ng("tear-out envelope present", "no joint.bolt-tearout@J1 in envelopes");
}

// ────────────────────────────────────────────────────────────────────────
// TEST: Missing inputs → notComputed (no fabrication)
// ────────────────────────────────────────────────────────────────────────
console.log("\n================================================");
console.log("MISSING-INPUT TESTS");
console.log("================================================\n");

// Open the original lap-splice (no edgeDistance, no holeDiameter)
const noGeomIR = {
  design: { id: "no-geom", name: "No edge geometry" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "P1", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" } },
    { id: "B1", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "16 mm", length: "40 mm" } },
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
const noGeomOpened = openDesign(noGeomIR);
const noGeomEnvs = noGeomOpened.session.results();
const tearoutNoGeom = noGeomEnvs.find((e) => e.runId === "joint.bolt-tearout@J1");
assertEq(tearoutNoGeom?.status, "NOT_COMPUTED", "tear-out NOT_COMPUTED when edgeDistance missing");
if (tearoutNoGeom?.reason) {
  console.log(`  reason: ${tearoutNoGeom.reason}`);
  if (tearoutNoGeom.reason.includes("edgeDistance")) {
    ok("reason names the missing input (edgeDistance)");
  } else {
    ng("reason names the missing input", `expected 'edgeDistance' in reason, got: ${tearoutNoGeom.reason}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// TEST: Edge-distance sensitivity — the cap should engage
// ────────────────────────────────────────────────────────────────────────
console.log("\n================================================");
console.log("EDGE-DISTANCE SENSITIVITY");
console.log("================================================\n");

// Small edge distance (10 mm), bigger hole (17 mm) → Lc = 10 - 8.5 = 1.5 mm
// Lc = 0.0015 m, t = 0.0127 m (inherited from aiscIR's P1), Fu = 400e6
// J3-6c = 0.75 · 1.5 · 0.0015 · 0.0127 · 400e6 = 8,572.5 N
// J3-6a = 0.75 · 2.4 · 0.016 · 0.0127 · 400e6 = 146,304 N
// So J3-6c governs and the actual capacity is 8,572.5 N
// Demand per bolt = 40,000 N → utilization 4.67 → FAIL
const smallEdgeIR = {
  ...aiscIR,
  design: { id: "small-edge", name: "small edge" },
  nodes: aiscIR.nodes.map((n) => n.id === "J1"
    ? { ...n, props: { ...n.props, edgeDistance: "10 mm", holeDiameter: "17 mm" } }
    : n),
};
const smallOpened = openDesign(smallEdgeIR);
const smallEnvs = smallOpened.session.results();
const tearoutSmall = smallEnvs.find((e) => e.runId === "joint.bolt-tearout@J1");
console.log(`small-edge tear-out: status=${tearoutSmall?.status}, capacity=${tearoutSmall?.outputs?.tearoutCapacity?.value}`);
// Expected: tear-out capacity = 0.75 * 1.5 * 0.0015 * 0.0127 * 400e6 = 8,572.5 N
const smallCap = tearoutSmall?.outputs?.tearoutCapacity?.value;
if (smallCap) {
  const t = AISC_T; // aiscIR was built with `${AISC_T} m`; read the constant directly
  const expectedSmall = 0.75 * 1.5 * 0.0015 * t * 400e6;
  assertClose(smallCap, expectedSmall, 1.0, "small-edge tear-out capacity");
  // 40kN > 8.6kN → FAIL
  assertEq(tearoutSmall?.status, "FAIL", "small-edge tear-out FAILs at 40 kN");
}

// ────────────────────────────────────────────────────────────────────────
console.log(`\n================================================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(`================================================\n`);

if (fail > 0) process.exit(1);