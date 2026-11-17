/**
 * SX-NUM-05 math.svd-lsq tests.
 *
 * The headline reference case is the NIST StRD Longley set — data
 * and certified values re-pulled from itl.nist.gov (Longley.dat)
 * for this build: 16 observations, 7 parameters, certified
 * coefficients to 15 digits, residual sum of squares
 * 836424.055505915, R^2 0.995479004577296. Longley is StRD's
 * "higher difficulty" regression: a normal-equations solve in
 * double precision visibly loses digits here, which is exactly
 * what the SVD path must not do.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/svd-lsq.js";

const solver = getSolver("math.svd-lsq");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

// Longley data (y, x1..x6), verbatim from NIST StRD Longley.dat
const LONGLEY = [
  [60323, 83.0, 234289, 2356, 1590, 107608, 1947],
  [61122, 88.5, 259426, 2325, 1456, 108632, 1948],
  [60171, 88.2, 258054, 3682, 1616, 109773, 1949],
  [61187, 89.5, 284599, 3351, 1650, 110929, 1950],
  [63221, 96.2, 328975, 2099, 3099, 112075, 1951],
  [63639, 98.1, 346999, 1932, 3594, 113270, 1952],
  [64989, 99.0, 365385, 1870, 3547, 115094, 1953],
  [63761, 100.0, 363112, 3578, 3350, 116219, 1954],
  [66019, 101.2, 397469, 2904, 3048, 117388, 1955],
  [67857, 104.6, 419180, 2822, 2857, 118734, 1956],
  [68169, 108.4, 442769, 2936, 2798, 120445, 1957],
  [66513, 110.8, 444546, 4681, 2637, 121950, 1958],
  [68655, 112.6, 482704, 3813, 2552, 123366, 1959],
  [69564, 114.2, 502601, 3931, 2514, 125368, 1960],
  [69331, 115.7, 518173, 4806, 2572, 127852, 1961],
  [70551, 116.9, 554894, 4007, 2827, 130081, 1962],
];
const LONGLEY_CERTIFIED = [
  -3482258.63459582, 15.0618722713733, -0.0358191792925910,
  -2.02022980381683, -1.03322686717359, -0.0511041056535807,
  1829.15146461355,
];
const LONGLEY_RSS = 836424.055505915;

test("registered at L2 with declared regime, units, tolerance", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 2);
  assert.ok(solver.regime && solver.units && solver.tolerance);
});

test("svd: analytic singular values (A^T A eigenvalues 3 and 1 give sigma sqrt(3), 1)", () => {
  const A = [[1, 1], [0, 1], [1, 0]];
  const r = run({ A }, "svd");
  assert.equal(r.status, "PASS");
  assert.ok(Math.abs(r.outputs.singularValues[0] - Math.sqrt(3)) < 1e-12);
  assert.ok(Math.abs(r.outputs.singularValues[1] - 1) < 1e-12);
  assert.ok(r.outputs.reconstructionError < 1e-12);
  const wide = run({ A: [[3, 0, 0], [0, 1, 0]] }, "svd");
  assert.deepEqual(wide.outputs.singularValues.map((v) => Math.round(v * 1e12) / 1e12), [3, 1]);
});

test("lsq: an exact overdetermined fit recovers the known line with zero residual", () => {
  const A = [[1, 0], [1, 1], [1, 2]];
  const r = run({ A, b: [1, 3, 5] }, "lsq");
  assert.equal(r.status, "PASS");
  assert.ok(Math.abs(r.outputs.x[0] - 1) < 1e-12 && Math.abs(r.outputs.x[1] - 2) < 1e-12);
  assert.ok(r.outputs.residualNorm2 < 1e-12);
  assert.equal(r.outputs.truncatedSingularValues, 0);
});

test("lsq: the NIST StRD Longley reference case, against the certified values", () => {
  const A = LONGLEY.map((row) => [1, ...row.slice(1)]);
  const b = LONGLEY.map((row) => row[0]);
  const r = run({ A, b }, "lsq");
  assert.equal(r.status, "PASS");
  LONGLEY_CERTIFIED.forEach((cert, i) => {
    const rel = Math.abs(r.outputs.x[i] - cert) / Math.abs(cert);
    assert.ok(rel < 1e-6, `B${i}: got ${r.outputs.x[i]}, certified ${cert} (rel err ${rel})`);
  });
  const rss = r.outputs.residualNorm2 ** 2;
  assert.ok(Math.abs(rss - LONGLEY_RSS) / LONGLEY_RSS < 1e-9, `RSS ${rss} vs certified ${LONGLEY_RSS}`);
  assert.equal(r.outputs.effectiveRank, 7);
});

test("rank deficiency is declared, and the minimum-norm solution is the one served", () => {
  const A = [[1, 1], [1, 1], [1, 1]];
  const rk = run({ A }, "rank");
  assert.equal(rk.outputs.rank, 1);
  const r = run({ A, b: [2, 2, 2] }, "lsq");
  assert.equal(r.outputs.truncatedSingularValues, 1);
  assert.ok(Math.abs(r.outputs.x[0] - 1) < 1e-12 && Math.abs(r.outputs.x[1] - 1) < 1e-12); // min-norm split
  assert.ok(r.outputs.residualNorm2 < 1e-12);
});

test("tikhonov: lambda is required (never assumed) and shrinks the solution", () => {
  const A = [[1, 0], [0, 1], [1, 1]];
  const b = [1, 2, 3];
  assert.ok(run({ A, b }, "tikhonov").reason.startsWith("missing_input:lambda"));
  const plain = run({ A, b }, "lsq").outputs.x;
  const ridge = run({ A, b, lambda: 10 }, "tikhonov").outputs.x;
  const nPlain = Math.hypot(...plain);
  const nRidge = Math.hypot(...ridge);
  assert.ok(nRidge < nPlain, `ridge norm ${nRidge} < lsq norm ${nPlain}`);
});

test("tls: exact-fit data returns the exact solution", () => {
  const A = [[1, 0], [1, 1], [1, 2]];
  const r = run({ A, b: [1, 3, 5] }, "tls");
  assert.equal(r.status, "PASS");
  assert.ok(Math.abs(r.outputs.x[0] - 1) < 1e-9 && Math.abs(r.outputs.x[1] - 2) < 1e-9);
});

test("malformed input refused by name", () => {
  assert.ok(run({ A: [[1, 2], [3]] }, "svd").reason.startsWith("invalid_input:A"));
  assert.ok(run({ A: [[1], [2]], b: [1] }, "lsq").reason.startsWith("invalid_input:b"));
  assert.ok(run({ A: [[1]], rcond: 2 }, "rank").reason.startsWith("invalid_input:rcond"));
});
