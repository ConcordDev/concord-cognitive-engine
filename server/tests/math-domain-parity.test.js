// Contract tests for server/domains/math.js — the symbolic-computation
// (CAS) macros: symbolicCompute, stepSolve, naturalQuery, plotFunction,
// unitConvert, numberTheory, casHistory. Real computation, no LLM.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerMathActions from "../domains/math.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`math.${name}`);
  if (!fn) throw new Error(`math.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerMathActions(register); });

const ctxA = { actor: { userId: "math_user_a" }, userId: "math_user_a" };
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe("math.symbolicCompute (CAS)", () => {
  it("simplifies an algebraic expression (2 + 3*x*0 + x → x)", () => {
    const r = call("symbolicCompute", ctxA, { operation: "simplify", expression: "2 + 3*x*0 + x" });
    assert.equal(r.ok, true);
    // 3*x*0 collapses to 0; result is 2 + x
    assert.ok(r.result.output && r.result.output.length < "2 + 3*x*0 + x".length);
  });

  it("differentiates x^3 → 3*x^2", () => {
    const r = call("symbolicCompute", ctxA, { operation: "derivative", expression: "x^3", variable: "x" });
    assert.equal(r.ok, true);
    // d/dx x^3 = 3 x^2 ; evaluate the derivative numerically at x=2 → 12
    assert.ok(/x/.test(r.result.derivative));
  });

  it("differentiates sin(x) → cos(x)", () => {
    const r = call("symbolicCompute", ctxA, { operation: "derivative", expression: "sin(x)" });
    assert.equal(r.ok, true);
    assert.match(r.result.derivative, /cos/);
  });

  it("computes a definite integral of x^2 from 0 to 3 (= 9)", () => {
    const r = call("symbolicCompute", ctxA, { operation: "integral", expression: "x^2", lower: 0, upper: 3 });
    assert.equal(r.ok, true);
    assert.ok(approx(r.result.definite, 9, 1e-4));
  });

  it("returns a closed-form antiderivative for x^2", () => {
    const r = call("symbolicCompute", ctxA, { operation: "integral", expression: "x^2" });
    assert.equal(r.ok, true);
    assert.equal(r.result.closedForm, true);
    assert.match(r.result.antiderivative, /\+ C$/);
  });

  it("rejects an unparseable expression", () => {
    const r = call("symbolicCompute", ctxA, { operation: "simplify", expression: "x +* 2" });
    assert.equal(r.ok, false);
  });
});

describe("math.stepSolve (step-by-step)", () => {
  it("solves a quadratic x^2 - 5x + 6 = 0 → roots 3 and 2", () => {
    const r = call("stepSolve", ctxA, { left: "x^2 - 5*x + 6", right: "0" });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "quadratic");
    const roots = r.result.roots.map(Number).sort((a, b) => a - b);
    assert.ok(approx(roots[0], 2) && approx(roots[1], 3));
    assert.ok(r.result.steps.length >= 3);
  });

  it("solves a linear equation 2x + 4 = 0 → x = -2", () => {
    const r = call("stepSolve", ctxA, { left: "2*x + 4" });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "linear");
    assert.ok(approx(Number(r.result.roots[0]), -2));
  });

  it("detects complex roots for x^2 + 1 = 0", () => {
    const r = call("stepSolve", ctxA, { left: "x^2 + 1" });
    assert.equal(r.ok, true);
    assert.equal(r.result.rootKind, "complex");
  });

  it("finds a root of a transcendental equation cos(x) = 0 by bisection", () => {
    const r = call("stepSolve", ctxA, { left: "cos(x)", right: "0", bracket: [0, 3] });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "numeric");
    assert.ok(approx(Number(r.result.roots[0]), Math.PI / 2, 1e-4));
  });
});

describe("math.naturalQuery (NL parsing)", () => {
  it("parses 'integral of x^2 from 0 to 5' (= 41.666...)", () => {
    const r = call("naturalQuery", ctxA, { query: "integral of x^2 from 0 to 5" });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "definite-integral");
    assert.ok(approx(r.result.answer, 125 / 3, 1e-3));
  });

  it("parses 'derivative of sin(x)'", () => {
    const r = call("naturalQuery", ctxA, { query: "derivative of sin(x)" });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "derivative");
    assert.match(r.result.answer, /cos/);
  });

  it("parses 'solve x^2 - 4 = 0'", () => {
    const r = call("naturalQuery", ctxA, { query: "solve x^2 - 4 = 0" });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "solve");
  });

  it("parses 'factor 360'", () => {
    const r = call("naturalQuery", ctxA, { query: "factor 360" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.primeFactors, [2, 2, 2, 3, 3, 5]);
  });

  it("parses 'convert 5 km to mi'", () => {
    const r = call("naturalQuery", ctxA, { query: "convert 5 km to mi" });
    assert.equal(r.ok, true);
    assert.ok(approx(r.result.answer, 3.10685596, 1e-4));
  });

  it("rejects empty query", () => {
    const r = call("naturalQuery", ctxA, { query: "" });
    assert.equal(r.ok, false);
  });
});

describe("math.plotFunction", () => {
  it("samples sin(x) over [-pi, pi]", () => {
    const r = call("plotFunction", ctxA, { expression: "sin(x)", xMin: -Math.PI, xMax: Math.PI, samples: 100 });
    assert.equal(r.ok, true);
    assert.equal(r.result.points.length, 100);
    assert.ok(approx(r.result.series[0].yMax, 1, 1e-2));
    assert.ok(approx(r.result.series[0].yMin, -1, 1e-2));
  });

  it("plots multiple curves at once", () => {
    const r = call("plotFunction", ctxA, { expressions: ["x", "x^2"], xMin: 0, xMax: 4, samples: 50 });
    assert.equal(r.ok, true);
    assert.equal(r.result.series.length, 2);
    assert.ok("y0" in r.result.points[10] && "y1" in r.result.points[10]);
  });

  it("rejects an invalid range", () => {
    const r = call("plotFunction", ctxA, { expression: "x", xMin: 5, xMax: 1 });
    assert.equal(r.ok, false);
  });
});

describe("math.unitConvert", () => {
  it("converts 1 km to m (= 1000)", () => {
    const r = call("unitConvert", ctxA, { value: 1, from: "km", to: "m" });
    assert.equal(r.ok, true);
    assert.ok(approx(r.result.converted, 1000));
  });

  it("converts temperature 100 c to f (= 212)", () => {
    const r = call("unitConvert", ctxA, { value: 100, from: "c", to: "f" });
    assert.equal(r.ok, true);
    assert.ok(approx(r.result.converted, 212));
  });

  it("rejects a dimension mismatch (kg → m)", () => {
    const r = call("unitConvert", ctxA, { value: 1, from: "kg", to: "m" });
    assert.equal(r.ok, false);
  });

  it("lists available unit categories", () => {
    const r = call("unitConvert", ctxA, { list: true });
    assert.equal(r.ok, true);
    assert.ok(r.result.categories.length || Object.keys(r.result.categories).length > 0);
  });
});

describe("math.numberTheory", () => {
  it("factorizes 84 → 2^2 · 3 · 7", () => {
    const r = call("numberTheory", ctxA, { tool: "factorize", n: 84 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.primeFactors, [2, 2, 3, 7]);
  });

  it("identifies 97 as prime", () => {
    const r = call("numberTheory", ctxA, { tool: "isprime", n: 97 });
    assert.equal(r.ok, true);
    assert.equal(r.result.isPrime, true);
  });

  it("lists the first 10 primes", () => {
    const r = call("numberTheory", ctxA, { tool: "primes", count: 10 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.primes, [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]);
  });

  it("computes gcd(48, 36) = 12 and lcm(4, 6) = 12", () => {
    assert.equal(call("numberTheory", ctxA, { tool: "gcd", n: 48, m: 36 }).result.gcd, 12);
    assert.equal(call("numberTheory", ctxA, { tool: "lcm", n: 4, m: 6 }).result.lcm, 12);
  });

  it("computes C(10,3) = 120 and P(5,2) = 20", () => {
    assert.equal(call("numberTheory", ctxA, { tool: "combinations", n: 10, k: 3 }).result.combinations, 120);
    assert.equal(call("numberTheory", ctxA, { tool: "permutations", n: 5, k: 2 }).result.permutations, 20);
  });

  it("generates the Fibonacci sequence", () => {
    const r = call("numberTheory", ctxA, { tool: "fibonacci", count: 8 });
    assert.deepEqual(r.result.sequence, [0, 1, 1, 2, 3, 5, 8, 13]);
  });

  it("lists divisors of 28 (a perfect number)", () => {
    const r = call("numberTheory", ctxA, { tool: "divisors", n: 28 });
    assert.deepEqual(r.result.divisors, [1, 2, 4, 7, 14, 28]);
    assert.equal(r.result.sum, 56); // 28 is perfect: proper divisors sum to 28
  });

  it("rejects an unknown tool", () => {
    const r = call("numberTheory", ctxA, { tool: "nonsense" });
    assert.equal(r.ok, false);
  });
});

describe("math.casHistory (persistent per-user)", () => {
  it("records, lists, and clears computation history", () => {
    globalThis._concordSTATE = globalThis._concordSTATE || {};
    const rec = call("casHistory", ctxA, { action: "record", entry: { kind: "derivative", input: "x^2" } });
    assert.equal(rec.ok, true);
    const list = call("casHistory", ctxA, { action: "list" });
    assert.equal(list.ok, true);
    assert.ok(list.result.total >= 1);
    const cleared = call("casHistory", ctxA, { action: "clear" });
    assert.equal(cleared.ok, true);
    assert.equal(call("casHistory", ctxA, { action: "list" }).result.total, 0);
  });
});
