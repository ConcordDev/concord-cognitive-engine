/**
 * SX-NUM-02 math.units-dimensional tests.
 *
 * Reference values are the SI / NIST SP 811 definitions: 1 atm =
 * 101325 Pa exactly, 1 ft = 0.3048 m exactly, 1 kWh = 3.6 MJ exactly.
 * The pi-group cases are the textbook ones: the pendulum's single
 * group (T^2 g / l) and the drag problem's two groups, whose span
 * must contain the Reynolds number and the drag-coefficient vector —
 * verified by exact linear algebra in the test, not by trusting the
 * solver's strings.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import {
  parseUnitExpr, UNITS, BASE_DIMS,
} from "../../lib/conkay/physics/solvers/units-dimensional.js";
import "../../lib/conkay/physics/solvers/units-dimensional.js";

const solver = getSolver("math.units-dimensional");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

const dimsOfExponents = (vars, exps) => {
  const total = [0, 0, 0, 0, 0, 0, 0];
  vars.forEach((v, i) => {
    const d = parseUnitExpr(v.unit).dims;
    for (let k = 0; k < 7; k += 1) {
      total[k] += exps[v.name] * d[k];
      if (total[k] === 0) total[k] = 0; // normalize -0 (0 * -1) for deepStrictEqual
    }
  });
  return total;
};

test("registered at L0 with declared regime, units, tolerance", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 0);
  assert.ok(solver.regime && solver.units && solver.tolerance);
});

test("dimension: named derived units recognized, expressions reduced to base dims", () => {
  const n = run({ unit: "N" }, "dimension");
  assert.equal(n.outputs.dimensions, "M*L*T^-2");
  assert.equal(n.outputs.namedUnit, "N");
  const cp = run({ unit: "J/(kg*K)" }, "dimension");
  assert.equal(cp.outputs.dimensions, "L^2*T^-2*Θ^-1");
  assert.equal(cp.outputs.vector.M, 0); // specific heat: no mass dimension (per unit mass)
  assert.equal(cp.outputs.vector.L, 2);
  assert.equal(cp.outputs.vector["Θ"], -1);
});

test("convert: exact SI definitions; mismatch and unknown units refused by name", () => {
  assert.equal(run({ value: 1, from: "atm", to: "Pa" }, "convert").outputs.result, 101325);
  assert.equal(run({ value: 1, from: "ft", to: "m" }, "convert").outputs.result, 0.3048);
  assert.equal(run({ value: 1, from: "kWh", to: "J" }, "convert").outputs.result, 3.6e6);
  const ft = run({ value: 4, from: "m", to: "ft" }, "convert");
  assert.ok(Math.abs(ft.outputs.result - 13.123359580052493) < 1e-9);
  const bad = run({ value: 1, from: "m", to: "s" }, "convert");
  assert.equal(bad.status, "NOT_COMPUTED");
  assert.ok(bad.reason.startsWith("dimension_mismatch"));
  assert.ok(run({ value: 1, from: "furlong", to: "m" }, "convert").reason.includes("unknown_unit:furlong"));
});

test("check: homogeneity is a verdict — PASS for like dims, FAIL naming the odd term", () => {
  const ok = run({ terms: ["m/s", "km/h", "ft/min"] }, "check");
  assert.equal(ok.status, "PASS");
  assert.equal(ok.outputs.homogeneous, true);
  const bad = run({ terms: ["m", "s"] }, "check");
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.outputs.homogeneous, false);
  assert.equal(bad.outputs.offending, "s");
  assert.equal(bad.failures[0].name, "dimensional_homogeneity");
});

test("pi-groups: the pendulum has exactly one group, proportional to T^2 g / l", () => {
  const vars = [
    { name: "T", unit: "s" }, { name: "m", unit: "kg" },
    { name: "l", unit: "m" }, { name: "g", unit: "m/s^2" },
  ];
  const r = run({ variables: vars }, "pi-groups");
  assert.equal(r.status, "PASS");
  assert.equal(r.outputs.rank, 3);
  assert.equal(r.outputs.groupCount, 1);
  const g = r.outputs.groups[0];
  // dimensionless by independent recomputation
  assert.deepEqual(dimsOfExponents(vars, g.exponents), [0, 0, 0, 0, 0, 0, 0]);
  // proportional to [2, 0, -1, 1]
  const e = [g.exponents.T, g.exponents.m, g.exponents.l, g.exponents.g];
  assert.equal(e[1], 0);
  assert.ok(Math.abs(e[0] / e[3] - 2) < 1e-12 && Math.abs(e[2] / e[3] + 1) < 1e-12);
});

test("pi-groups: the drag problem spans the Reynolds number and the drag coefficient", () => {
  const vars = [
    { name: "F", unit: "N" }, { name: "rho", unit: "kg/m^3" },
    { name: "V", unit: "m/s" }, { name: "L", unit: "m" }, { name: "mu", unit: "Pa*s" },
  ];
  const r = run({ variables: vars }, "pi-groups");
  assert.equal(r.outputs.rank, 3);
  assert.equal(r.outputs.groupCount, 2); // Buckingham: 5 variables - rank 3
  const basis = r.outputs.groups.map((g) => vars.map((v) => g.exponents[v.name]));
  for (const b of basis) {
    const exps = Object.fromEntries(vars.map((v, i) => [v.name, b[i]]));
    assert.deepEqual(dimsOfExponents(vars, exps), [0, 0, 0, 0, 0, 0, 0]);
  }
  // Re = rho V L / mu -> [0,1,1,1,-1]; CD-form = F/(rho V^2 L^2) -> [1,-1,-2,-2,0]
  const inSpan = (target) => {
    // solve a*b1 + b*b2 = target from rows 0 and 1, verify all rows
    const [b1, b2] = basis;
    const det = b1[0] * b2[1] - b2[0] * b1[1];
    if (Math.abs(det) < 1e-12) return false;
    const a = (target[0] * b2[1] - target[1] * b2[0]) / det;
    const b = (b1[0] * target[1] - b1[1] * target[0]) / det;
    return target.every((t, i) => Math.abs(a * b1[i] + b * b2[i] - t) < 1e-9);
  };
  assert.ok(inSpan([0, 1, 1, 1, -1]), "Reynolds vector in the span");
  assert.ok(inSpan([1, -1, -2, -2, 0]), "drag-coefficient vector in the span");
  assert.ok(BASE_DIMS.length === 7 && UNITS.atm.factor === 101325);
});
