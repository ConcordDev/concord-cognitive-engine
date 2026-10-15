// scripts/test-bolt-combined.mjs
//
// Hand-calc validation for joint.bolt-combined (AISC 360-16 §J3.7).
//
// Test case: M16 A325 bolt, 1 shear plane, Ab = 157 mm²,
//   φRn_shear   = 56,144 N (from earlier joint.bolt-shear tests)
//   φRn_tension = 73,067 N (from joint.bolt-tension tests, threads N)
//   demand: Fr = 20 kN shear, Ft = 30 kN tension (same load case)
//
// Hand calc:
//   ratio = Fr/φRn_shear + Ft/φRn_tension
//         = 20,000/56,144 + 30,000/73,067
//         = 0.3562 + 0.4106
//         = 0.7668
//   limit  = 1.3
//   0.7668 < 1.3 → PASS
//
// Plus tests for:
//   - Missing tension capacity → NOT_COMPUTED with upstream reason
//   - Shear-only load → NOT_COMPUTED (combined requires both)
//   - Tension-only load → NOT_COMPUTED (combined requires both)

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
const phiRn_shear = 56144;   // N, from joint.bolt-shear (M16, 1 plane, A325)
const phiRn_tension = 73067; // N, from joint.bolt-tension (M16, A325, Ab=157mm², threads N)
const Fr = 20000;
const Ft = 30000;
const ratio_HAND = (Fr / phiRn_shear) + (Ft / phiRn_tension);
const limit = 1.3;
console.log("=== Hand-calc ground truth ===");
console.log(`  Fr = ${Fr} N, Ft = ${Ft} N`);
console.log(`  φRn_shear = ${phiRn_shear} N, φRn_tension = ${phiRn_tension} N`);
console.log(`  ratio = ${ratio_HAND.toFixed(4)} (limit 1.3) → ${ratio_HAND <= limit ? "PASS" : "FAIL"}`);

// ────────────────────────────────────────────────────────────────────────
// Combined shear + tension: PASS case
// ────────────────────────────────────────────────────────────────────────
const ir = {
  design: { id: "combined-test" },
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
  loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "20 kN", tension: "30 kN" }] }],
};

const opened = openDesign(ir);
if (!opened.ok) { console.log("compile errors:", opened.errors); process.exit(1); }
const envs = opened.session.results();
const cEnv = envs.find((e) => e.runId === "joint.bolt-combined@J1");
if (!cEnv) { console.log("FAIL — no combined envelope. Got:", envs.map((e) => e.runId)); process.exit(1); }

console.log("\n=== joint.bolt-combined@J1 (solver output) ===");
console.log(`  status: ${cEnv.status}`);
if (cEnv.outputs) {
  for (const [k, v] of Object.entries(cEnv.outputs)) {
    console.log(`  ${k}: ${v.value}${v.comment ? "  (" + v.comment + ")" : ""}`);
  }
}
console.log(`  inputs: ${JSON.stringify(cEnv.inputs)}`);

console.log("\n=== Assertions ===");
assertEq(cEnv.status, "PASS", "combined PASS");
if (cEnv.outputs?.governingRatio) {
  assertClose(cEnv.outputs.governingRatio.value, ratio_HAND, 1e-3, "ratio matches AISC reference");
}
if (cEnv.outputs?.governingLimit) {
  assertEq(cEnv.outputs.governingLimit.value, 1.3, "limit is 1.3");
}
if (cEnv.outputs?.ok) {
  assertEq(cEnv.outputs.ok.value, true, "ok = true");
}

// ────────────────────────────────────────────────────────────────────────
// Shear-only: should NOT_COMPUTED with a precise reason
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Shear-only test (no tension) ===");
const shearOnly = {
  ...ir,
  design: { id: "shear-only" },
  loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "20 kN" }] }],
};
const soOpened = openDesign(shearOnly);
const soEnvs = soOpened.session.results();
const soC = soEnvs.find((e) => e.runId === "joint.bolt-combined@J1");
assertEq(soC?.status, "NOT_COMPUTED", "combined NOT_COMPUTED when no tension");
if (soC?.reason?.includes("no tension load")) {
  ok("reason names the missing condition");
} else {
  ng("reason names the missing condition", `expected 'no tension load' in reason, got: ${soC?.reason}`);
}

// ────────────────────────────────────────────────────────────────────────
// Tension-only: should NOT_COMPUTED
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Tension-only test (no shear) ===");
const tOnly = {
  ...ir,
  design: { id: "t-only" },
  loadCases: [{ id: "LC1", loads: [{ target: "J1", tension: "30 kN" }] }],
};
const tOpened = openDesign(tOnly);
const tEnvs = tOpened.session.results();
const tC = tEnvs.find((e) => e.runId === "joint.bolt-combined@J1");
assertEq(tC?.status, "NOT_COMPUTED", "combined NOT_COMPUTED when no shear");

// ────────────────────────────────────────────────────────────────────────
// Upstream missing: no stressArea → tension notComputed → combined notComputed
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Upstream-missing test (no stressArea) ===");
const noAb = {
  ...ir,
  design: { id: "no-ab" },
  nodes: ir.nodes.map((n) => n.id === "B1" ? { ...n, props: {} } : n),
};
const naOpened = openDesign(noAb);
const naEnvs = naOpened.session.results();
const naC = naEnvs.find((e) => e.runId === "joint.bolt-combined@J1");
assertEq(naC?.status, "NOT_COMPUTED", "combined NOT_COMPUTED when upstream tension notComputed");
if (naC?.reason?.includes("joint.bolt-tension")) {
  ok("reason names the upstream solver (joint.bolt-tension)");
} else {
  ng("reason names the upstream solver", `expected 'joint.bolt-tension' in reason, got: ${naC?.reason}`);
}

console.log(`\n================================================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(`================================================\n`);
if (fail > 0) process.exit(1);