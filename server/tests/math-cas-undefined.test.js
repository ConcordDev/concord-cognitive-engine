// server/tests/math-cas-undefined.test.js
//
// FIX-math-001: the CAS echoed non-finite inputs back unchanged with no
// message — simplify 7/0 returned "7/0" and sqrt(-4) returned
// "sqrt(-4)". Division by zero is now flagged undefined, a bare
// sqrt of a negative returns the imaginary value with a note, and a
// nested one is refused as having no real value.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerMathActions from "../domains/math.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function simplify(expression) {
  const fn = ACTIONS.get("math.symbolicCompute");
  return fn({ actor: { userId: "u1" }, userId: "u1" }, { id: null, data: {}, meta: {} }, { operation: "simplify", expression });
}

before(() => { registerMathActions(register); });

describe("math CAS names its undefined cases (FIX-math-001)", () => {
  it("7/0 is flagged undefined, not echoed", () => {
    const r = simplify("7/0");
    assert.equal(r.ok, false);
    assert.match(r.error, /Undefined: .* divides by zero/);
  });

  it("0/0 and a symbolic denominator that folds to zero are flagged too", () => {
    assert.equal(simplify("0/0").ok, false);
    const r = simplify("x/(3-3)");
    assert.equal(r.ok, false);
    assert.match(r.error, /divides by zero/);
  });

  it("sqrt(-4) gives 2i with the no-real-root note", () => {
    const r = simplify("sqrt(-4)");
    assert.equal(r.ok, true);
    assert.equal(r.result.output, "2i");
    assert.match(r.result.note, /No real root/);
  });

  it("sqrt(-2) gives the rounded imaginary magnitude", () => {
    const r = simplify("sqrt(-2)");
    assert.equal(r.ok, true);
    assert.equal(r.result.output, "1.41421356i");
  });

  it("a nested sqrt of a negative is refused as no real value", () => {
    const r = simplify("1 + sqrt(-9)");
    assert.equal(r.ok, false);
    assert.match(r.error, /No real value/);
  });

  it("ordinary simplifications are unchanged", () => {
    assert.equal(simplify("sqrt(4)").result.output, "2");
    assert.equal(simplify("7/2").result.output, "3.5");
    assert.equal(simplify("x + x").result.output, "2 * x");
  });
});
