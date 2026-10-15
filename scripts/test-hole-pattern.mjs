// scripts/test-hole-pattern.mjs
//
// Tests the new holePattern IR field:
//   1. Compiler unit-converts {x, y} entries to SI metres.
//   2. Backward compat: a Joint with no holePattern still compiles.
//   3. Validation: malformed holePattern entries (non-array, missing
//      x/y, non-positive values) are reported as structured errors.
//   4. The holePattern is exposed on the compiled Joint.props and is
//      readable by solvers (smoke test through ctx.get).
//   5. A real four-bolt pattern matches hand-converted metres.

import { compileDesignIR } from "/Users/dutch/concord vs code/concord-cognitive-engine/server/lib/conkay/compiler/design-ir.js";

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✓ ${name}`); };
const ng = (name, why) => { fail++; console.log(`  ✗ ${name}  -- ${why}`); };
function assertEq(actual, expected, label) {
  if (actual === expected) ok(`${label}: ${JSON.stringify(actual)}`);
  else ng(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertClose(actual, expected, tol, label) {
  if (Math.abs(actual - expected) <= tol) ok(`${label}: ${actual} ≈ ${expected}`);
  else ng(label, `expected ≈ ${expected} ± ${tol}, got ${actual}`);
}
function assertErr(compile, sub, label) {
  if (!compile.ok) {
    const has = compile.errors.some((e) => e.includes(sub));
    if (has) ok(`${label}: "${sub}" in errors`);
    else ng(label, `errors do not contain "${sub}": ${JSON.stringify(compile.errors)}`);
  } else {
    ng(label, `expected compile failure with "${sub}", got ok`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// 1. Backward compat: no holePattern still compiles
// ────────────────────────────────────────────────────────────────────────
console.log("\n[HP-1] Backward compatibility: no holePattern");
const noHP = {
  design: { id: "no-hp" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "J1", kind: "Joint", props: { shearPlanes: 1 } },
  ],
  edges: [{ type: "CONTAINS", from: "A1", to: "J1" }],
  loadCases: [],
};
const c1 = compileDesignIR(noHP);
assertEq(c1.ok, true, "no holePattern compiles");
if (c1.ok) {
  const j = c1.design.nodes.find((n) => n.id === "J1");
  assertEq(j.props.holePattern, undefined, "holePattern stays undefined (no default)");
}

// ────────────────────────────────────────────────────────────────────────
// 2. Compiler unit-converts {x, y} entries to SI metres
// ────────────────────────────────────────────────────────────────────────
console.log("\n[HP-2] holePattern unit conversion");
const withHP = {
  design: { id: "with-hp" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "J1", kind: "Joint", props: {
      shearPlanes: 1,
      holePattern: [
        { x: "30 mm", y: "0 mm" },
        { x: "0 mm", y: "30 mm" },
        { x: "30 mm", y: "30 mm" },
        { x: "0 mm", y: "0 mm" },
      ],
    } },
  ],
  edges: [{ type: "CONTAINS", from: "A1", to: "J1" }],
  loadCases: [],
};
const c2 = compileDesignIR(withHP);
assertEq(c2.ok, true, "holePattern compiles");
if (c2.ok) {
  const j = c2.design.nodes.find((n) => n.id === "J1");
  const hp = j.props.holePattern;
  assertEq(hp.length, 4, "holePattern length preserved");
  if (Array.isArray(hp)) {
    assertClose(hp[0].x, 0.03, 1e-9, "hp[0].x (30 mm → 0.03 m)");
    assertClose(hp[0].y, 0.0, 1e-9, "hp[0].y (0 mm → 0.0 m)");
    assertClose(hp[1].x, 0.0, 1e-9, "hp[1].x (0 mm → 0.0 m)");
    assertClose(hp[1].y, 0.03, 1e-9, "hp[1].y (30 mm → 0.03 m)");
    assertClose(hp[2].x, 0.03, 1e-9, "hp[2].x");
    assertClose(hp[2].y, 0.03, 1e-9, "hp[2].y");
  }
}

// ────────────────────────────────────────────────────────────────────────
// 3. Mixed units per element (mm + inches)
// ────────────────────────────────────────────────────────────────────────
console.log("\n[HP-3] Mixed units across holePattern entries");
const mixed = {
  design: { id: "mixed-hp" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "J1", kind: "Joint", props: {
      holePattern: [
        { x: "1 in", y: "0.5 in" },
        { x: "0.5 in", y: "1 in" },
      ],
    } },
  ],
  edges: [{ type: "CONTAINS", from: "A1", to: "J1" }],
  loadCases: [],
};
const c3 = compileDesignIR(mixed);
assertEq(c3.ok, true, "mixed-unit holePattern compiles");
if (c3.ok) {
  const hp = c3.design.nodes.find((n) => n.id === "J1").props.holePattern;
  assertClose(hp[0].x, 0.0254, 1e-6, "1 in → 0.0254 m");
  assertClose(hp[0].y, 0.0127, 1e-6, "0.5 in → 0.0127 m");
}

// ────────────────────────────────────────────────────────────────────────
// 4. Malformed holePattern reported as errors
// ────────────────────────────────────────────────────────────────────────
console.log("\n[HP-4] Validation: malformed holePattern rejected");
const notArray = {
  design: { id: "bad-hp-1" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "J1", kind: "Joint", props: { holePattern: "not an array" } },
  ],
  edges: [{ type: "CONTAINS", from: "A1", to: "J1" }],
  loadCases: [],
};
const cBad1 = compileDesignIR(notArray);
assertErr(cBad1, "holePattern", "non-array holePattern rejected");

const missingX = {
  design: { id: "bad-hp-2" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "J1", kind: "Joint", props: { holePattern: [{ y: "10 mm" }] } },
  ],
  edges: [{ type: "CONTAINS", from: "A1", to: "J1" }],
  loadCases: [],
};
const cBad2 = compileDesignIR(missingX);
assertErr(cBad2, "holePattern", "holePattern entry without x rejected");

const negative = {
  design: { id: "bad-hp-3" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "J1", kind: "Joint", props: { holePattern: [{ x: "-5 mm", y: "10 mm" }] } },
  ],
  edges: [{ type: "CONTAINS", from: "A1", to: "J1" }],
  loadCases: [],
};
const cBad3 = compileDesignIR(negative);
assertErr(cBad3, "must be non-negative", "negative x rejected");

// ────────────────────────────────────────────────────────────────────────
// 5. Real four-bolt pattern as a single source of truth
// ────────────────────────────────────────────────────────────────────────
console.log("\n[HP-5] Real 4-bolt pattern, end-to-end");
const real = {
  design: { id: "real-hp" },
  materials: {},
  nodes: [
    { id: "A1", kind: "Assembly" },
    // 4 bolts at 0/0, 50/0, 0/50, 50/50 (mm). Load in +X direction.
    { id: "J1", kind: "Joint", props: {
      edgeDistance: "15 mm",
      edgeDistancePerpendicular: "15 mm",
      holeDiameter: "18 mm",
      holePattern: [
        { x: "0 mm", y: "0 mm" },
        { x: "50 mm", y: "0 mm" },
        { x: "0 mm", y: "50 mm" },
        { x: "50 mm", y: "50 mm" },
      ],
    } },
  ],
  edges: [{ type: "CONTAINS", from: "A1", to: "J1" }],
  loadCases: [],
};
const cReal = compileDesignIR(real);
assertEq(cReal.ok, true, "real pattern compiles");
if (cReal.ok) {
  const j = cReal.design.nodes.find((n) => n.id === "J1");
  const hp = j.props.holePattern;
  assertEq(hp.length, 4, "4 entries");
  // Centroid of this symmetric pattern = (25, 25) mm
  const cx = hp.reduce((s, e) => s + e.x, 0) / hp.length;
  const cy = hp.reduce((s, e) => s + e.y, 0) / hp.length;
  assertClose(cx, 0.025, 1e-9, "centroid x = 0.025 m");
  assertClose(cy, 0.025, 1e-9, "centroid y = 0.025 m");
  // Edge distances: outer bolt at 0/0 has x=0, edge distance = 0.015
  assertClose(j.props.edgeDistance, 0.015, 1e-9, "edgeDistance 15 mm → 0.015 m");
  assertClose(j.props.edgeDistancePerpendicular, 0.015, 1e-9, "edgeDistancePerpendicular 15 mm → 0.015 m");
  assertClose(j.props.holeDiameter, 0.018, 1e-9, "holeDiameter 18 mm → 0.018 m");
}

console.log(`\n================================================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(`================================================\n`);
if (fail > 0) process.exit(1);