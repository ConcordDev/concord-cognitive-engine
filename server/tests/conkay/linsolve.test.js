/**
 * SX-NUM-03 math.linsolve tests.
 *
 * Reference systems are manufactured from known solutions (the
 * expected x is chosen first, b = A x computed by hand), plus the
 * classic determinant and conditioning cases. References: Golub &
 * Van Loan, Matrix Computations 4e; NIST Matrix Market. The
 * catalogue validity envelope — refuse cond > 1e12 unless declared —
 * is pinned on a Hilbert matrix, whose condition number is a
 * textbook constant (cond_1(H10) ~ 3.5e13).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/linsolve.js";

const solver = getSolver("math.linsolve");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });
const close = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
const hilbert = (n) => Array.from({ length: n }, (_, i) =>
  Array.from({ length: n }, (_, j) => 1 / (i + j + 1)));

test("registered at L3 with the condition envelope declared", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 3);
  assert.ok(solver.regime.includes("1e12"));
});

test("solve: manufactured systems recover the known solution; residual verified", () => {
  const r2 = run({ A: [[2, 1], [1, 3]], b: [5, 5] }, "solve");
  assert.equal(r2.status, "PASS");
  assert.ok(close(r2.outputs.x[0], 2, 1e-12) && close(r2.outputs.x[1], 1, 1e-12));
  assert.ok(r2.outputs.residualInf < 1e-12);
  assert.equal(r2.outputs.determinant, 5);
  // x = [1, -2, 3] chosen first; b = A x = [1, -4, 11] by hand
  const A = [[3, 1, 0], [1, 4, 1], [0, 2, 5]];
  const r3 = run({ A, b: [1, -4, 11] }, "solve");
  assert.deepEqual(r3.outputs.x.map((v) => Math.round(v * 1e9) / 1e9), [1, -2, 3]);
});

test("det: pivot sign tracked through row exchanges", () => {
  assert.equal(run({ A: [[2, 1], [1, 3]] }, "det").outputs.determinant, 5);
  assert.equal(run({ A: [[0, 1], [1, 0]] }, "det").outputs.determinant, -1);
  assert.equal(run({ A: [[5]] }, "det").outputs.determinant, 5);
});

test("inverse: A * A^-1 = I, verified by independent multiplication in the test", () => {
  const A = [[3, 1, 0], [1, 4, 1], [0, 2, 5]];
  const r = run({ A }, "inverse");
  assert.equal(r.status, "PASS");
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const s = A[i].reduce((acc, v, k) => acc + v * r.outputs.inverse[k][j], 0);
      assert.ok(close(s, i === j ? 1 : 0, 1e-9), `(${i},${j}) = ${s}`);
    }
  }
  assert.ok(r.outputs.condition1 > 1);
});

test("cholesky: SPD solves; a non-SPD matrix is refused at its failing pivot", () => {
  const r = run({ A: [[4, 2], [2, 3]], b: [6, 5], method: "cholesky" }, "solve");
  assert.equal(r.status, "PASS");
  assert.ok(close(r.outputs.x[0], 1, 1e-12) && close(r.outputs.x[1], 1, 1e-12));
  const bad = run({ A: [[1, 2], [2, 1]], b: [1, 1], method: "cholesky" }, "solve");
  assert.equal(bad.status, "NOT_COMPUTED");
  assert.ok(bad.reason.startsWith("not_positive_definite"));
  assert.ok(run({ A: [[4, 2], [9, 3]], b: [1, 1], method: "cholesky" }, "solve")
    .reason.includes("symmetric"));
});

test("singular and malformed systems refused by name", () => {
  const s = run({ A: [[1, 2], [2, 4]], b: [1, 2] }, "solve");
  assert.equal(s.status, "NOT_COMPUTED");
  assert.ok(s.reason.startsWith("singular_matrix"));
  assert.ok(run({ A: [[1, 2], [3]], b: [1, 2] }, "solve").reason.startsWith("invalid_input:A"));
  assert.ok(run({ A: [[1, Number.NaN], [0, 1]], b: [1, 2] }, "solve").reason.startsWith("invalid_input:A"));
  assert.ok(run({ A: [[1, 0], [0, 1]], b: [1] }, "solve").reason.startsWith("invalid_input:b"));
});

test("condition envelope: Hilbert H10 refused above 1e12 unless declared; declared serves WARN, labelled", () => {
  const H = hilbert(10);
  const ones = Array(10).fill(1);
  const b = H.map((row) => row.reduce((s, v) => s + v, 0)); // b = H * ones
  const refused = run({ A: H, b }, "solve");
  assert.equal(refused.status, "NOT_COMPUTED");
  assert.ok(refused.reason.startsWith("condition_above_envelope"), refused.reason);
  const declared = run({ A: H, b, acceptIllConditioned: true }, "solve");
  assert.equal(declared.status, "WARN");
  assert.ok(declared.outputs.condition1 > 1e12);
  assert.ok(declared.warnings[0].includes("declared acceptance"));
});

test("the engine class is refused by name, never approximated", () => {
  for (const t of ["qr", "sparse", "iterative"]) {
    const r = run({ A: [[1, 0], [0, 1]], b: [1, 1] }, t);
    assert.equal(r.status, "NOT_COMPUTED");
    assert.ok(r.reason.startsWith("requires_engine_tier:lapack-petsc"), t);
  }
});
