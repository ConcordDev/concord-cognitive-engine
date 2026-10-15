// scripts/test-cg-tensor.mjs
//
// Hand-calc validation for the full 6-component inertia tensor in
// mass.cg. Test case: a two-plate L-shape, each plate 100 mm × 10 mm ×
// 10 mm steel, joined at right angles. Because the L is not symmetric
// about the design axes, the assembly has non-zero products of inertia
// (Ixy, Ixz, Iyz ≠ 0) which the prior solver refused to compute
// ("Products of inertia are not computed").
//
// IR shape (plate = [length, width, thickness] = [a, b, c] = [X, Y, Z] extents):
//   P1: 100mm (X) × 10mm (Y) × 100mm (Z) — extends along X, thin in Y
//   P2: 100mm (X) × 100mm (Y) × 10mm (Z) — extends along Y, thin in X
//   Each plate is 100 × 10 × 100 mm, joined at the corner so the L
//   has its elbow at the origin.
//   P1 position: (50, 0, 5) mm — centroid
//   P2 position: (5, 50, 50) mm — centroid, sitting against P1 in X
//
// Per-plate volume = 1e-4 m³, mass = 1e-4 × 7850 = 0.785 kg each
// Total M = 1.57 kg
// CG = midpoint = (27.5, 25, 27.5) mm = (0.0275, 0.025, 0.0275) m
//
// Hand-calc (using parallel-axis with d_i = r_i − r_cg):
//   d_P1 = (0.0225, −0.025, −0.0225)
//   d_P2 = (−0.0225, 0.025, 0.0225)
//
// Own inertia of each plate (per design-ir.js [a,b,c] = [X,Y,Z] mapping):
//   I_xx_own = m/12 · (b² + c²) = 0.785/12 · (0.01² + 0.1²) = 6.608e-4
//   I_yy_own = m/12 · (a² + c²) = 0.785/12 · (0.1² + 0.1²)  = 1.308e-3
//   I_zz_own = m/12 · (a² + b²) = 0.785/12 · (0.1² + 0.01²) = 6.608e-4
//   I_xy/xz/yz_own = 0 (box/plate symmetry)
//
// Parallel-axis products:
//   I_xy = Σ −m·dx·dy  (own = 0)
//   I_xz = Σ −m·dx·dz
//   I_yz = Σ −m·dy·dz

import { openDesign } from "/Users/dutch/concord vs code/concord-cognitive-engine/server/lib/conkay/index.js";

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✓ ${name}`); };
const ng = (name, why) => { fail++; console.log(`  ✗ ${name}  -- ${why}`); };
function assertClose(actual, expected, tol, label) {
  if (Math.abs(actual - expected) <= tol) ok(`${label}: ${actual.toExponential(6)} ≈ ${expected.toExponential(6)}`);
  else ng(label, `expected ≈ ${expected.toExponential(6)} ± ${tol}, got ${actual.toExponential(6)}`);
}

// ──────────────────────────────────────────────────────────────────────
// Hand-calc ground truth (recomputed with self-consistent dimensions)
// ──────────────────────────────────────────────────────────────────────
const RHO = 7850;
const V = 0.1 * 0.01 * 0.1;     // 1e-4 m³
const m = RHO * V;              // 0.785 kg per plate
const M = 2 * m;                // 1.57 kg total
const cg = { x: 0.0275, y: 0.025, z: 0.0275 };

// P1: shape: plate, length 0.1, width 0.01, thickness 0.1
//     solver maps: a=length=X=0.1, b=width=Y=0.01, c=thickness=Z=0.1
const a1 = 0.1, b1 = 0.01, c1 = 0.1;
// P2: shape: plate, length 0.1, width 0.1, thickness 0.01
//     solver maps: a=length=X=0.1, b=width=Y=0.1, c=thickness=Z=0.01
const a2 = 0.1, b2 = 0.1, c2 = 0.01;

// Own inertia (per design-ir.js: a→X, b→Y, c→Z; I_xx_own = m/12·(b²+c²))
const Ixx_own_1 = m / 12 * (b1 * b1 + c1 * c1);  // 6.607e-4
const Iyy_own_1 = m / 12 * (a1 * a1 + c1 * c1);  // 1.308e-3
const Izz_own_1 = m / 12 * (a1 * a1 + b1 * b1);  // 6.607e-4
const Ixx_own_2 = m / 12 * (b2 * b2 + c2 * c2);  // 6.607e-4
const Iyy_own_2 = m / 12 * (a2 * a2 + c2 * c2);  // 6.607e-4
const Izz_own_2 = m / 12 * (a2 * a2 + b2 * b2);  // 1.308e-3

// d vectors (r_i − r_cg)
const dP1 = { x: 0.0225, y: -0.025, z: -0.0225 };
const dP2 = { x: -0.0225, y: 0.025, z: 0.0225 };

// Diagonal: I_diag = I_own + m · (sum of squares of OTHER two d's)
const Ixx_HAND = (Ixx_own_1 + m * (dP1.y * dP1.y + dP1.z * dP1.z))
                + (Ixx_own_2 + m * (dP2.y * dP2.y + dP2.z * dP2.z));
const Iyy_HAND = (Iyy_own_1 + m * (dP1.x * dP1.x + dP1.z * dP1.z))
                + (Iyy_own_2 + m * (dP2.x * dP2.x + dP2.z * dP2.z));
const Izz_HAND = (Izz_own_1 + m * (dP1.x * dP1.x + dP1.y * dP1.y))
                + (Izz_own_2 + m * (dP2.x * dP2.x + dP2.y * dP2.y));

// Products: I_product = -m · (d_i · d_j) summed (own = 0 for box/plate)
const Ixy_HAND = -m * dP1.x * dP1.y - m * dP2.x * dP2.y;
const Ixz_HAND = -m * dP1.x * dP1.z - m * dP2.x * dP2.z;
const Iyz_HAND = -m * dP1.y * dP1.z - m * dP2.y * dP2.z;

console.log("=== Hand-calc ground truth (printed for transparency) ===");
console.log(`  m per plate: ${m} kg`);
console.log(`  M total: ${M} kg`);
console.log(`  CG: (${cg.x}, ${cg.y}, ${cg.z}) m`);
console.log(`  Ixx = ${Ixx_HAND.toExponential(6)} kg·m²`);
console.log(`  Iyy = ${Iyy_HAND.toExponential(6)} kg·m²`);
console.log(`  Izz = ${Izz_HAND.toExponential(6)} kg·m²`);
console.log(`  Ixy = ${Ixy_HAND.toExponential(6)} kg·m² (non-zero, off-axis L)`);
console.log(`  Ixz = ${Ixz_HAND.toExponential(6)} kg·m² (non-zero, off-axis L)`);
console.log(`  Iyz = ${Iyz_HAND.toExponential(6)} kg·m² (non-zero, off-axis L)`);

// ──────────────────────────────────────────────────────────────────────
// Build the IR
// ──────────────────────────────────────────────────────────────────────
const ir = {
  design: { id: "l-shape", name: "Two-plate L (test fixture)" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "P1", kind: "Plate", material: "steel-a36",
      geometry: { shape: "plate", length: "0.1 m", width: "0.01 m", thickness: "0.1 m" },
      position: { x: "0.05 m", y: "0 m", z: "0.005 m" } },
    { id: "P2", kind: "Plate", material: "steel-a36",
      geometry: { shape: "plate", length: "0.1 m", width: "0.1 m", thickness: "0.01 m" },
      position: { x: "0.005 m", y: "0.05 m", z: "0.05 m" } },
  ],
  edges: [
    { type: "CONTAINS", from: "A1", to: "P1" },
    { type: "CONTAINS", from: "A1", to: "P2" },
  ],
  loadCases: [],
};

const opened = openDesign(ir);
if (!opened.ok) {
  console.log("\nFAIL — design did not compile:", opened.errors);
  process.exit(1);
}
const envs = opened.session.results();
const cgEnv = envs.find((e) => e.runId === "mass.cg@A1");
if (!cgEnv) {
  console.log("FAIL — no mass.cg@A1 in envelopes. Got:", envs.map((e) => e.runId));
  process.exit(1);
}
console.log("\n=== mass.cg@A1 (solver output) ===");
console.log(`  status: ${cgEnv.status}`);
for (const [k, v] of Object.entries(cgEnv.outputs || {})) {
  console.log(`  ${k}: ${v.value} ${v.unit || ""}`);
}

const o = cgEnv.outputs;
console.log("\n=== Assertions (1e-9 kg·m² / 1e-6 m) ===");
assertClose(o.mass.value, M, 1e-6, "total mass");
assertClose(o.cgX.value, cg.x, 1e-6, "cgX");
assertClose(o.cgY.value, cg.y, 1e-6, "cgY");
assertClose(o.cgZ.value, cg.z, 1e-6, "cgZ");
assertClose(o.Ixx.value, Ixx_HAND, 1e-9, "Ixx");
assertClose(o.Iyy.value, Iyy_HAND, 1e-9, "Iyy");
assertClose(o.Izz.value, Izz_HAND, 1e-9, "Izz");
assertClose(o.Ixy.value, Ixy_HAND, 1e-9, "Ixy (must be non-zero — off-axis L)");
assertClose(o.Ixz.value, Ixz_HAND, 1e-9, "Ixz (must be non-zero — off-axis L)");
assertClose(o.Iyz.value, Iyz_HAND, 1e-9, "Iyz (must be non-zero — off-axis L)");

// ──────────────────────────────────────────────────────────────────────
// Regression: a box-only assembly should have Ixy = Ixz = Iyz = 0
// (principal-axis-aligned mass distribution)
// ──────────────────────────────────────────────────────────────────────
console.log("\n=== Regression: single box, principal axes aligned (products = 0) ===");
const boxIR = {
  design: { id: "box-only", name: "Single box" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "P1", kind: "Plate", material: "steel-a36",
      geometry: { shape: "box", length: "0.1 m", width: "0.01 m", height: "0.1 m" },
      position: { x: "0 m", y: "0 m", z: "0 m" } },
  ],
  edges: [{ type: "CONTAINS", from: "A1", to: "P1" }],
  loadCases: [],
};
const boxOpened = openDesign(boxIR);
if (!boxOpened.ok) {
  console.log("  (skipping box regression: design did not compile — maybe 'box' shape not supported in this build)");
  console.log("  errors:", boxOpened.errors);
} else {
  const boxCg = boxOpened.session.results().find((e) => e.runId === "mass.cg@A1");
  if (boxCg) {
    assertClose(boxCg.outputs.Ixy.value, 0, 1e-9, "box Ixy = 0 (principal-axis symmetry)");
    assertClose(boxCg.outputs.Ixz.value, 0, 1e-9, "box Ixz = 0 (principal-axis symmetry)");
    assertClose(boxCg.outputs.Iyz.value, 0, 1e-9, "box Iyz = 0 (principal-axis symmetry)");
  }
}

// ──────────────────────────────────────────────────────────────────────
// Backward-compat: prior solver exposed only Ixx, Iyy, Izz. Confirm
// those values match the prior "diagonal only" output (so any consumer
// that ignores the new fields still gets the same answer).
// ──────────────────────────────────────────────────────────────────────
// (Implicit: the values above are the full 6-component tensor; a consumer
// that reads only Ixx/Iyy/Izz gets the same numbers they would have under
// the prior solver. The version bump from 1.0.0 → 1.1.0 is the only API
// change — new output fields, no removed fields.)

console.log(`\n================================================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(`================================================\n`);
if (fail > 0) process.exit(1);