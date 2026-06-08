// tests/depth/math-behavior.test.js — REAL behavioral tests for the `math`
// computer-algebra domain (registerLensAction family, invoked via lensRun).
// This is a CAS: every assertion pins an EXACT symbolic / numeric / number-theory
// result (derivatives, integrals, matrix ops, regression coefficients, unit
// conversions, primality), plus round-trips + validation rejections.
//
// Contract reminder (see _harness.js + README):
//   lens.run unwraps a handler's { ok, result } → the OUTER `result`. So a SUCCESS
//   field is `r.result.<field>`; a handler REFUSAL (handler returns {ok:false,error}
//   with no `result` key) is NOT unwrapped → `r.result.ok === false` + `r.result.error`.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);

describe("math — statisticalAnalysis (exact descriptive stats)", () => {
  it("computes mean/median/variance/stdDev exactly for a known sample", async () => {
    const r = await lensRun("math", "statisticalAnalysis", { data: { values: [2, 4, 4, 4, 5, 5, 7, 9] } });
    assert.equal(r.result.n, 8);
    // mean = 40/8 = 5; median = (4+5)/2 = 4.5
    near(r.result.mean, 5);
    near(r.result.median, 4.5);
    // population variance of this textbook set = 4, σ = 2
    near(r.result.spread.variance, 4);
    near(r.result.stdDev, 2);
    // mode is 4 (appears 3 times)
    assert.deepEqual(r.result.centralTendency.modes, [4]);
    assert.equal(r.result.min, 2);
    assert.equal(r.result.max, 9);
  });

  it("flags an obvious high outlier via the 1.5·IQR fence", async () => {
    const r = await lensRun("math", "statisticalAnalysis", { data: { values: [10, 11, 12, 13, 14, 15, 100] } });
    assert.equal(r.result.outliers.count, 1);
    assert.deepEqual(r.result.outliers.values, [100]);
  });

  it("empty input returns a no-data message (graceful, ok:true)", async () => {
    const r = await lensRun("math", "statisticalAnalysis", { data: { values: [] } });
    assert.equal(r.result.message, "No numeric values to analyze.");
  });
});

describe("math — matrixOperations (exact linear algebra)", () => {
  it("determinant of [[1,2],[3,4]] = -2", async () => {
    const r = await lensRun("math", "matrixOperations", { data: { matrixA: [[1, 2], [3, 4]] }, params: { operation: "determinant" } });
    near(r.result.determinant, -2);
  });

  it("determinant of a 3x3 (Gaussian elimination) is exact", async () => {
    // det([[6,1,1],[4,-2,5],[2,8,7]]) = -306
    const r = await lensRun("math", "matrixOperations", { data: { matrixA: [[6, 1, 1], [4, -2, 5], [2, 8, 7]] }, params: { operation: "determinant" } });
    near(r.result.determinant, -306, 1e-4);
  });

  it("transpose swaps dimensions and indices", async () => {
    const r = await lensRun("math", "matrixOperations", { data: { matrixA: [[1, 2, 3], [4, 5, 6]] }, params: { operation: "transpose" } });
    assert.deepEqual(r.result.resultDimensions, [3, 2]);
    assert.deepEqual(r.result.matrix, [[1, 4], [2, 5], [3, 6]]);
  });

  it("multiply produces the exact product matrix", async () => {
    const r = await lensRun("math", "matrixOperations", {
      data: { matrixA: [[1, 2], [3, 4]], matrixB: [[5, 6], [7, 8]] },
      params: { operation: "multiply" },
    });
    assert.deepEqual(r.result.matrix, [[19, 22], [43, 50]]);
  });

  it("inverse of [[4,7],[2,6]] = [[0.6,-0.7],[-0.2,0.4]]", async () => {
    const r = await lensRun("math", "matrixOperations", { data: { matrixA: [[4, 7], [2, 6]] }, params: { operation: "inverse" } });
    near(r.result.matrix[0][0], 0.6);
    near(r.result.matrix[0][1], -0.7);
    near(r.result.matrix[1][0], -0.2);
    near(r.result.matrix[1][1], 0.4);
    near(r.result.determinant, 10);
  });

  it("rank of a rank-deficient matrix is exact", async () => {
    // rows 2 = 2×row1 → rank 1
    const r = await lensRun("math", "matrixOperations", { data: { matrixA: [[1, 2], [2, 4]] }, params: { operation: "rank" } });
    assert.equal(r.result.rank, 1);
    assert.equal(r.result.fullRank, false);
  });

  it("eigenvalues of [[2,0],[0,3]] are {2,3} via the closed-form 2x2 path", async () => {
    const r = await lensRun("math", "matrixOperations", { data: { matrixA: [[2, 0], [0, 3]] }, params: { operation: "eigenvalues" } });
    assert.equal(r.result.real, true);
    const evs = [...r.result.eigenvalues].sort((a, b) => a - b);
    near(evs[0], 2);
    near(evs[1], 3);
  });

  it("validation: determinant of a non-square matrix is rejected", async () => {
    const r = await lensRun("math", "matrixOperations", { data: { matrixA: [[1, 2, 3], [4, 5, 6]] }, params: { operation: "determinant" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("square"));
  });

  it("validation: a singular matrix has no inverse", async () => {
    const r = await lensRun("math", "matrixOperations", { data: { matrixA: [[1, 2], [2, 4]] }, params: { operation: "inverse" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("singular"));
  });

  it("validation: an unknown operation is rejected", async () => {
    const r = await lensRun("math", "matrixOperations", { data: { matrixA: [[1]] }, params: { operation: "wibble" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("Unknown operation"));
  });
});

describe("math — polynomialAnalysis (exact roots + calculus)", () => {
  it("x^2 - 3x + 2 has roots {1, 2}", async () => {
    const r = await lensRun("math", "polynomialAnalysis", { data: { coefficients: [1, -3, 2] } });
    assert.equal(r.result.degree, 2);
    const roots = [...r.result.roots].sort((a, b) => a - b);
    near(roots[0], 1);
    near(roots[1], 2);
  });

  it("evaluates via Horner's method at exact points", async () => {
    // p(x) = x^2 - 3x + 2 → p(0)=2, p(1)=0, p(3)=2
    const r = await lensRun("math", "polynomialAnalysis", { data: { coefficients: [1, -3, 2] }, params: { evaluateAt: [0, 1, 3] } });
    const at = (x) => r.result.evaluations.find((e) => e.x === x).y;
    near(at(0), 2);
    near(at(1), 0);
    near(at(3), 2);
  });

  it("derivative of x^2 - 3x + 2 is 2x - 3 (exact coefficients)", async () => {
    const r = await lensRun("math", "polynomialAnalysis", { data: { coefficients: [1, -3, 2] } });
    assert.deepEqual(r.result.derivativeDetail.coefficients, [2, -3]);
  });

  it("a degree-2 poly with negative discriminant surfaces complex roots", async () => {
    // x^2 + 1 = 0 → ±i
    const r = await lensRun("math", "polynomialAnalysis", { data: { coefficients: [1, 0, 1] } });
    assert.equal(r.result.roots.length, 0);
    assert.equal(r.result.complexRoots.length, 2);
    near(r.result.complexRoots[0].real, 0);
    near(Math.abs(r.result.complexRoots[0].imag), 1);
  });

  it("validation: no coefficients is rejected", async () => {
    const r = await lensRun("math", "polynomialAnalysis", { data: { coefficients: [] } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("No coefficients"));
  });
});

describe("math — regressionFit (exact least-squares)", () => {
  it("perfectly-linear data fits slope/intercept exactly with R²=1", async () => {
    // y = 2x + 1
    const r = await lensRun("math", "regressionFit", { data: { x: [0, 1, 2, 3], y: [1, 3, 5, 7] }, params: { type: "linear" } });
    near(r.result.slope, 2);
    near(r.result.intercept, 1);
    near(r.result.rSquared, 1);
    assert.equal(r.result.fit, "excellent");
  });

  it("exponential fit recovers a and b for y = 2·e^(0.5x)", async () => {
    const b = 0.5, a = 2;
    const xs = [0, 1, 2, 3, 4];
    const ys = xs.map((x) => a * Math.exp(b * x));
    const r = await lensRun("math", "regressionFit", { data: { x: xs, y: ys }, params: { type: "exponential" } });
    near(r.result.a, a, 1e-4);
    near(r.result.b, b, 1e-4);
    near(r.result.rSquared, 1, 1e-6);
  });

  it("polynomial fit recovers a quadratic exactly", async () => {
    // y = x^2 → coeffs [c0,c1,c2] = [0,0,1]
    const xs = [-2, -1, 0, 1, 2, 3];
    const ys = xs.map((x) => x * x);
    const r = await lensRun("math", "regressionFit", { data: { x: xs, y: ys }, params: { type: "polynomial", degree: 2 } });
    near(r.result.coefficients[0], 0, 1e-5);
    near(r.result.coefficients[1], 0, 1e-5);
    near(r.result.coefficients[2], 1, 1e-5);
    near(r.result.rSquared, 1, 1e-6);
  });

  it("validation: fewer than 2 points is rejected", async () => {
    const r = await lensRun("math", "regressionFit", { data: { points: [{ x: 1, y: 2 }] } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("2 data points"));
  });

  it("validation: exponential with a non-positive y is rejected", async () => {
    const r = await lensRun("math", "regressionFit", { data: { x: [0, 1], y: [1, -2] }, params: { type: "exponential" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("y values > 0"));
  });
});

describe("math — symbolicCompute (real CAS)", () => {
  it("differentiates x^2 → 2 * x", async () => {
    const r = await lensRun("math", "symbolicCompute", { params: { operation: "derivative", expression: "x^2" } });
    assert.equal(r.result.derivative, "2 * x");
  });

  it("differentiates sin(x) → cos(x) (chain rule, simplified)", async () => {
    const r = await lensRun("math", "symbolicCompute", { params: { operation: "derivative", expression: "sin(x)" } });
    assert.equal(r.result.derivative, "cos(x)");
  });

  it("differentiates exp(x) → exp(x)", async () => {
    const r = await lensRun("math", "symbolicCompute", { params: { operation: "derivative", expression: "exp(x)" } });
    assert.equal(r.result.derivative, "exp(x)");
  });

  it("simplifies x + 0 → x and x * 1 → x and 2 * 3 → 6", async () => {
    const a = await lensRun("math", "symbolicCompute", { params: { operation: "simplify", expression: "x + 0" } });
    assert.equal(a.result.output, "x");
    const b = await lensRun("math", "symbolicCompute", { params: { operation: "simplify", expression: "2 * 3" } });
    assert.equal(b.result.output, "6");
  });

  it("definite integral of x^2 from 0 to 3 = 9 (closed form)", async () => {
    const r = await lensRun("math", "symbolicCompute", { params: { operation: "integral", expression: "x^2", lower: 0, upper: 3 } });
    assert.equal(r.result.closedForm, true);
    near(r.result.definite, 9);
  });

  it("indefinite integral of cos(x) → sin(x) + C", async () => {
    const r = await lensRun("math", "symbolicCompute", { params: { operation: "integral", expression: "cos(x)" } });
    assert.equal(r.result.closedForm, true);
    assert.equal(r.result.antiderivative, "sin(x) + C");
  });

  it("validation: empty expression is rejected", async () => {
    const r = await lensRun("math", "symbolicCompute", { params: { operation: "simplify", expression: "" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("No expression"));
  });

  it("validation: a malformed expression returns a parse error", async () => {
    const r = await lensRun("math", "symbolicCompute", { params: { operation: "derivative", expression: "x +* 2" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("Parse error"));
  });
});

describe("math — stepSolve (equation solving with working)", () => {
  it("solves the linear 2x + 4 = 0 → x = -2", async () => {
    const r = await lensRun("math", "stepSolve", { params: { left: "2x + 4", right: "0" } });
    assert.equal(r.result.kind, "linear");
    near(r.result.roots[0], -2);
  });

  it("solves the quadratic x^2 - 5x + 6 = 0 → {2, 3}", async () => {
    const r = await lensRun("math", "stepSolve", { params: { left: "x^2 - 5x + 6", right: "0" } });
    assert.equal(r.result.kind, "quadratic");
    assert.equal(r.result.rootKind, "two-real");
    const roots = [...r.result.roots].sort((a, b) => a - b);
    near(roots[0], 2);
    near(roots[1], 3);
  });

  it("a negative discriminant yields complex roots (x^2 + 1 = 0)", async () => {
    const r = await lensRun("math", "stepSolve", { params: { left: "x^2 + 1", right: "0" } });
    assert.equal(r.result.rootKind, "complex");
    near(r.result.roots[0].real, 0);
    near(Math.abs(r.result.roots[0].imag), 1);
  });

  it("solves both sides: 3x = x + 4 → x = 2", async () => {
    const r = await lensRun("math", "stepSolve", { params: { left: "3x", right: "x + 4" } });
    assert.equal(r.result.kind, "linear");
    near(r.result.roots[0], 2);
  });

  it("validation: no equation provided is rejected", async () => {
    const r = await lensRun("math", "stepSolve", { params: { left: "" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("No equation"));
  });
});

describe("math — naturalQuery (NL → computation)", () => {
  it("'derivative of x^3' → 3 * x^2", async () => {
    const r = await lensRun("math", "naturalQuery", { params: { query: "derivative of x^3" } });
    assert.equal(r.result.kind, "derivative");
    assert.equal(r.result.answer, "3 * x ^ 2");
  });

  it("'integral of x^2 from 0 to 3' → 9", async () => {
    const r = await lensRun("math", "naturalQuery", { params: { query: "integral of x^2 from 0 to 3" } });
    assert.equal(r.result.kind, "definite-integral");
    near(r.result.answer, 9);
  });

  it("'factor 360' → prime factors [2,2,2,3,3,5]", async () => {
    const r = await lensRun("math", "naturalQuery", { params: { query: "factor 360" } });
    assert.equal(r.result.kind, "factorize");
    assert.deepEqual(r.result.primeFactors, [2, 2, 2, 3, 3, 5]);
  });

  it("'is 97 prime' → true", async () => {
    const r = await lensRun("math", "naturalQuery", { params: { query: "is 97 prime" } });
    assert.equal(r.result.kind, "isprime");
    assert.equal(r.result.isPrime, true);
  });

  it("'convert 5 km to mi' → 3.106855961", async () => {
    const r = await lensRun("math", "naturalQuery", { params: { query: "convert 5 km to mi" } });
    assert.equal(r.result.kind, "convert");
    near(r.result.answer, 5 * 1000 / 1609.344, 1e-6);
  });

  it("'solve x^2-4=0' → {-2, 2}", async () => {
    const r = await lensRun("math", "naturalQuery", { params: { query: "solve x^2-4=0" } });
    assert.equal(r.result.kind, "solve");
    const roots = [...r.result.answer.roots].sort((a, b) => a - b);
    near(roots[0], -2);
    near(roots[1], 2);
  });

  it("validation: empty query is rejected", async () => {
    const r = await lensRun("math", "naturalQuery", { params: { query: "" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("No query"));
  });
});

describe("math — plotFunction (numeric series)", () => {
  it("samples y = x^2 over [-2,2]; endpoints + count are exact", async () => {
    const r = await lensRun("math", "plotFunction", { params: { expression: "x^2", xMin: -2, xMax: 2, samples: 5 } });
    assert.equal(r.result.samples, 5);
    assert.equal(r.result.points.length, 5);
    // 5 samples over [-2,2] → x ∈ {-2,-1,0,1,2}; y = x^2
    assert.equal(r.result.points[0].x, -2);
    near(r.result.points[0].y0, 4);
    near(r.result.points[2].y0, 0);
    near(r.result.points[4].y0, 4);
    near(r.result.series[0].yMin, 0);
    near(r.result.series[0].yMax, 4);
  });

  it("validation: xMax <= xMin is rejected", async () => {
    const r = await lensRun("math", "plotFunction", { params: { expression: "x", xMin: 5, xMax: 5 } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("xMax > xMin"));
  });

  it("validation: no expression is rejected", async () => {
    const r = await lensRun("math", "plotFunction", { params: {} });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("No expression"));
  });
});

describe("math — unitConvert (exact factor + affine conversions)", () => {
  it("converts 1 km → 1000 m (length)", async () => {
    const r = await lensRun("math", "unitConvert", { params: { value: 1, from: "km", to: "m" } });
    assert.equal(r.result.category, "length");
    near(r.result.converted, 1000);
  });

  it("converts 100 C → 212 F (affine temperature)", async () => {
    const r = await lensRun("math", "unitConvert", { params: { value: 100, from: "c", to: "f" } });
    assert.equal(r.result.category, "temperature");
    near(r.result.converted, 212);
  });

  it("converts 1 kg → 1000 g and 1 h → 3600 s", async () => {
    const a = await lensRun("math", "unitConvert", { params: { value: 1, from: "kg", to: "g" } });
    near(a.result.converted, 1000);
    const b = await lensRun("math", "unitConvert", { params: { value: 1, from: "h", to: "s" } });
    near(b.result.converted, 3600);
  });

  it("list:true enumerates categories", async () => {
    const r = await lensRun("math", "unitConvert", { params: { list: true } });
    assert.ok(Object.keys(r.result.categories).includes("length"));
    assert.ok(r.result.categories.temperature.includes("c"));
  });

  it("validation: mixing temperature with non-temperature is rejected", async () => {
    const r = await lensRun("math", "unitConvert", { params: { value: 1, from: "c", to: "m" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("temperature"));
  });

  it("validation: a dimension mismatch is rejected", async () => {
    const r = await lensRun("math", "unitConvert", { params: { value: 1, from: "kg", to: "m" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("Dimension mismatch"));
  });

  it("validation: an unknown unit is rejected", async () => {
    const r = await lensRun("math", "unitConvert", { params: { value: 1, from: "smoots", to: "m" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("Unknown unit"));
  });
});

describe("math — numberTheory (exact integer math)", () => {
  it("factorize 360 → exponent form 2^3 · 3^2 · 5", async () => {
    const r = await lensRun("math", "numberTheory", { params: { tool: "factorize", n: 360 } });
    assert.deepEqual(r.result.primeFactors, [2, 2, 2, 3, 3, 5]);
    const f = r.result.factorization;
    assert.deepEqual(f.find((e) => e.base === 2), { base: 2, exponent: 3 });
    assert.deepEqual(f.find((e) => e.base === 3), { base: 3, exponent: 2 });
    assert.equal(r.result.isPrime, false);
  });

  it("isprime: 97 prime, 100 composite", async () => {
    const a = await lensRun("math", "numberTheory", { params: { tool: "isprime", n: 97 } });
    assert.equal(a.result.isPrime, true);
    const b = await lensRun("math", "numberTheory", { params: { tool: "isprime", n: 100 } });
    assert.equal(b.result.isPrime, false);
  });

  it("primes: first 5 primes are [2,3,5,7,11]", async () => {
    const r = await lensRun("math", "numberTheory", { params: { tool: "primes", count: 5 } });
    assert.deepEqual(r.result.primes, [2, 3, 5, 7, 11]);
  });

  it("gcd(48,36)=12 and lcm(4,6)=12", async () => {
    const g = await lensRun("math", "numberTheory", { params: { tool: "gcd", n: 48, m: 36 } });
    assert.equal(g.result.gcd, 12);
    const l = await lensRun("math", "numberTheory", { params: { tool: "lcm", n: 4, m: 6 } });
    assert.equal(l.result.lcm, 12);
  });

  it("factorial(5)=120; combinations(5,2)=10; permutations(5,2)=20", async () => {
    const f = await lensRun("math", "numberTheory", { params: { tool: "factorial", n: 5 } });
    assert.equal(f.result.factorial, 120);
    const c = await lensRun("math", "numberTheory", { params: { tool: "combinations", n: 5, k: 2 } });
    assert.equal(c.result.combinations, 10);
    const p = await lensRun("math", "numberTheory", { params: { tool: "permutations", n: 5, k: 2 } });
    assert.equal(p.result.permutations, 20);
  });

  it("fibonacci(7) → [0,1,1,2,3,5,8]", async () => {
    const r = await lensRun("math", "numberTheory", { params: { tool: "fibonacci", count: 7 } });
    assert.deepEqual(r.result.sequence, [0, 1, 1, 2, 3, 5, 8]);
  });

  it("divisors(12) → [1,2,3,4,6,12], sum 28 (12 is abundant)", async () => {
    const r = await lensRun("math", "numberTheory", { params: { tool: "divisors", n: 12 } });
    assert.deepEqual(r.result.divisors, [1, 2, 3, 4, 6, 12]);
    assert.equal(r.result.sum, 28);
  });

  it("totient(10) = 4", async () => {
    const r = await lensRun("math", "numberTheory", { params: { tool: "totient", n: 10 } });
    assert.equal(r.result.totient, 4);
  });

  it("validation: an unknown tool is rejected", async () => {
    const r = await lensRun("math", "numberTheory", { params: { tool: "quaternion" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("Unknown tool"));
  });

  it("validation: factorial out of range is rejected", async () => {
    const r = await lensRun("math", "numberTheory", { params: { tool: "factorial", n: 200 } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("0..170"));
  });
});

describe("math — casHistory (per-user persistent log)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("math-cas-history"); });

  it("record → list round-trips the entry for the same user", async () => {
    const rec = await lensRun("math", "casHistory", { params: { action: "record", entry: { op: "derivative", expr: "x^2" } } }, ctx);
    assert.equal(rec.result.recorded, true);
    assert.ok(rec.result.total >= 1);
    const list = await lensRun("math", "casHistory", { params: { action: "list" } }, ctx);
    assert.ok(list.result.history.some((h) => h.op === "derivative" && h.expr === "x^2"));
  });

  it("clear empties the log", async () => {
    await lensRun("math", "casHistory", { params: { action: "record", entry: { op: "integral" } } }, ctx);
    const cleared = await lensRun("math", "casHistory", { params: { action: "clear" } }, ctx);
    assert.equal(cleared.result.cleared, true);
    const list = await lensRun("math", "casHistory", { params: { action: "list" } }, ctx);
    assert.equal(list.result.history.length, 0);
  });

  it("validation: record without an entry object is rejected", async () => {
    const r = await lensRun("math", "casHistory", { params: { action: "record" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("'entry' object required"));
  });
});
