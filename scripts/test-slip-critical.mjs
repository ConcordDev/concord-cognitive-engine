// scripts/test-slip-critical.mjs
//
// Hand-calc validation for joint.slip-critical (AISC 360-16 §J3.8).
//
// Test case: M20 A325, Class B faying surface (μ=0.50),
// standard hole (hf=1.00), 1 slip plane (ns=1),
// bolt pretension Tb = 142 kN (AISC Table J3.1 for M20 A325),
// 4 bolts, 60 kN shear demand (15 kN per bolt).
//
// Hand-calc:
//   φRn = 1.00 · 0.50 · 1.13 · 1.00 · 142,000 · 1
//       = 80,230 N per bolt
//   Demand = 60,000 / 4 = 15,000 N per bolt
//   Utilization = 15,000 / 80,230 = 18.7% → PASS
//
// Plus tests for:
//   - Missing fayingSurface → NOT_COMPUTED
//   - Missing pretension → NOT_COMPUTED with reference to AISC Table J3.1
//   - Class A (μ=0.30) — different φRn
//   - Long-slotted parallel to load (hf=0.70) — different φRn

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
const mu = 0.50;
const Du = 1.13;
const hf = 1.00;
const Tb = 142000;   // AISC Table J3.1, M20 A325
const ns = 1;
const phi = 1.00;
const phiRn_HAND = phi * mu * Du * hf * Tb * ns;
const DEMAND_PER_BOLT = 15000;

console.log("=== Hand-calc ground truth ===");
console.log(`  φ = ${phi}, μ = ${mu}, Du = ${Du}, hf = ${hf}, Tb = ${Tb} N, ns = ${ns}`);
console.log(`  φRn = ${phiRn_HAND.toFixed(2)} N per bolt`);

// ────────────────────────────────────────────────────────────────────────
// PASS test
// ────────────────────────────────────────────────────────────────────────
const ir = {
  design: { id: "slip-test" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "P1", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "0.1 m", width: "0.1 m", thickness: "0.01 m" } },
    { id: "B1", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "20 mm", length: "0.04 m" }, props: { pretension: "142 kN" } },
    { id: "B2", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "20 mm", length: "0.04 m" }, props: { pretension: "142 kN" } },
    { id: "B3", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "20 mm", length: "0.04 m" }, props: { pretension: "142 kN" } },
    { id: "B4", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "20 mm", length: "0.04 m" }, props: { pretension: "142 kN" } },
    { id: "J1", kind: "Joint", props: { shearPlanes: 1, fayingSurface: "B" } },
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
  loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "60 kN" }] }],
};

const opened = openDesign(ir);
if (!opened.ok) { console.log("compile errors:", opened.errors); process.exit(1); }
const envs = opened.session.results();
const sEnv = envs.find((e) => e.runId === "joint.slip-critical@J1");
if (!sEnv) { console.log("FAIL — no slip-critical envelope. Got:", envs.map((e) => e.runId)); process.exit(1); }

console.log("\n=== joint.slip-critical@J1 (solver output) ===");
console.log(`  status: ${sEnv.status}`);
if (sEnv.outputs) {
  for (const [k, v] of Object.entries(sEnv.outputs)) {
    console.log(`  ${k}: ${v.value}${v.unit || ""}${v.comment ? "  (" + v.comment + ")" : ""}`);
  }
}

console.log("\n=== Assertions ===");
assertEq(sEnv.status, "PASS", "slip-critical PASS at 15 kN/bolt demand");
if (sEnv.outputs?.governingCapacity) {
  assertClose(sEnv.outputs.governingCapacity.value, phiRn_HAND, 1.0, "φRn matches AISC reference");
}
if (sEnv.outputs?.mu) assertClose(sEnv.outputs.mu.value, mu, 1e-9, "μ = 0.50 (Class B)");
if (sEnv.outputs?.hf) assertClose(sEnv.outputs.hf.value, hf, 1e-9, "hf = 1.00 (standard)");
if (sEnv.margins?.[0]) {
  assertClose(sEnv.margins[0].demand, DEMAND_PER_BOLT, 1.0, "demand = 60/4 = 15 kN per bolt");
  assertClose(sEnv.margins[0].capacity, phiRn_HAND, 1.0, "margin capacity matches");
}

// ────────────────────────────────────────────────────────────────────────
// Class A test (μ = 0.30) — different capacity
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Class A test (μ = 0.30) ===");
const irA = {
  ...ir,
  design: { id: "slip-A" },
  nodes: ir.nodes.map((n) => n.id === "J1" ? { ...n, props: { ...n.props, fayingSurface: "A" } } : n),
};
const phiRn_A = 1.00 * 0.30 * 1.13 * 1.00 * 142000 * 1;
const oA = openDesign(irA);
const eA = oA.session.results();
const sA = eA.find((e) => e.runId === "joint.slip-critical@J1");
if (sA?.outputs?.governingCapacity) {
  assertClose(sA.outputs.governingCapacity.value, phiRn_A, 1.0, "Class A φRn");
  assertClose(sA.outputs.mu.value, 0.30, 1e-9, "μ = 0.30 (Class A)");
}

// ────────────────────────────────────────────────────────────────────────
// Long-slotted parallel test (hf = 0.70)
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Long-slotted parallel test (hf = 0.70) ===");
const irSlot = {
  ...ir,
  design: { id: "slip-slot" },
  nodes: ir.nodes.map((n) => n.id === "J1" ? { ...n, props: { ...n.props, holeType: "parallel-to-load" } } : n),
};
const phiRn_slot = 1.00 * 0.50 * 1.13 * 0.70 * 142000 * 1;
const oSlot = openDesign(irSlot);
const eSlot = oSlot.session.results();
const sSlot = eSlot.find((e) => e.runId === "joint.slip-critical@J1");
if (sSlot?.outputs?.governingCapacity) {
  assertClose(sSlot.outputs.governingCapacity.value, phiRn_slot, 1.0, "long-slotted φRn");
  assertClose(sSlot.outputs.hf.value, 0.70, 1e-9, "hf = 0.70 (long-slotted parallel)");
}

// ────────────────────────────────────────────────────────────────────────
// Missing fayingSurface → NOT_COMPUTED
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Missing fayingSurface test ===");
const irNoSurface = {
  ...ir,
  design: { id: "no-surface" },
  nodes: ir.nodes.map((n) => n.id === "J1" ? { ...n, props: { shearPlanes: 1 } } : n),
};
const oNS = openDesign(irNoSurface);
const eNS = oNS.session.results();
const sNS = eNS.find((e) => e.runId === "joint.slip-critical@J1");
assertEq(sNS?.status, "NOT_COMPUTED", "slip-critical NOT_COMPUTED when no fayingSurface");
if (sNS?.reason?.includes("fayingSurface")) {
  ok("reason names the missing field");
}

// ────────────────────────────────────────────────────────────────────────
// Missing pretension → NOT_COMPUTED
// ────────────────────────────────────────────────────────────────────────
console.log("\n=== Missing pretension test ===");
const irNoTb = {
  ...ir,
  design: { id: "no-tb" },
  nodes: ir.nodes.map((n) => n.id === "J1" ? { ...n, props: { shearPlanes: 1, fayingSurface: "B" } } : n.id.startsWith("B") ? { ...n, props: {} } : n),
};
const oTb = openDesign(irNoTb);
const eTb = oTb.session.results();
const sTb = eTb.find((e) => e.runId === "joint.slip-critical@J1");
assertEq(sTb?.status, "NOT_COMPUTED", "slip-critical NOT_COMPUTED when no pretension");
if (sTb?.reason?.includes("pretension") && sTb.reason.includes("AISC Table J3.1")) {
  ok("reason names the missing field AND references AISC Table J3.1");
} else {
  ng("reason includes AISC Table J3.1 reference", `expected pretension + AISC Table J3.1 in reason, got: ${sTb?.reason?.slice(0, 200)}`);
}

console.log(`\n================================================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(`================================================\n`);
if (fail > 0) process.exit(1);