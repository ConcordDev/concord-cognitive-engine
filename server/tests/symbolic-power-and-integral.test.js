/**
 * `x**2` used to throw "unexpected token *", and definite-integral limits
 * passed to invokeCompute were ignored (integrate x^2 from 0 to 3 is 9).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as symbolic from "../lib/compute/symbolic-math.js";
import { executeToolCall, invokeCompute } from "../lib/chat-agent.js";

describe("symbolic-math ** power", () => {
  it("parses ** as exponentiation", () => {
    assert.equal(symbolic.stringify(symbolic.parse("x**2")), "(x ^ 2)");
    assert.equal(symbolic.evaluate("2**3", {}), 8);
    assert.equal(symbolic.evaluate("2**3**2", {}), 512);
  });

  it("still treats a single * as multiplication", () => {
    assert.equal(symbolic.stringify(symbolic.parse("x*2")), "(x * 2)");
    assert.equal(symbolic.evaluate("3*4", {}), 12);
  });

  it("integrates x**2 to x^3/3", () => {
    assert.equal(symbolic.stringify(symbolic.integrate("x**2", "x")), "((x ^ 3) / 3)");
  });
});

describe("invokeCompute definite integrals", () => {
  it("integrates x**2 from 0 to 3 as 9", () => {
    const r = invokeCompute(symbolic, "symbolic", "integrate", {
      expression: "x**2", variable: "x", lower: 0, upper: 3,
    });
    assert.equal(r.definite, true);
    assert.equal(r.value, 9);
    assert.equal(r.lower, 0);
    assert.equal(r.upper, 3);
    assert.match(r.antiderivative, /\^ 3/);
  });

  it("accepts from/to, a limits array, and a from/to phrase", () => {
    const fromTo = invokeCompute(symbolic, "symbolic", "integrate", {
      expression: "x^2", from: "0", to: "3",
    });
    assert.equal(fromTo.value, 9);
    const boxed = invokeCompute(symbolic, "symbolic-math", "integrate", {
      expression: "x**2", limits: [0, 3],
    });
    assert.equal(boxed.value, 9);
    const phrase = invokeCompute(symbolic, "symbolic", "integrate", {
      expression: "integrate x**2 from 0 to 3",
    });
    assert.equal(phrase.value, 9);
    const bounds = invokeCompute(symbolic, "symbolic", "integrate", {
      expr: "t**2", variable: "t", bounds: { lower: 0, upper: 3 },
    });
    assert.equal(bounds.value, 9);
  });

  it("still differentiates through the same adapter", () => {
    const r = invokeCompute(symbolic, "symbolic", "differentiate", {
      expression: "x**2", variable: "x",
    });
    assert.equal(symbolic.stringify(r), "(2 * x)");
  });

  it("leaves an indefinite integral alone when no limits are present", () => {
    const r = invokeCompute(symbolic, "symbolic", "integrate", {
      expression: "x^2", variable: "x",
    });
    assert.equal(symbolic.stringify(r), "((x ^ 3) / 3)");
    assert.equal(r.value, undefined);
  });

  it("does not invent a number when the antiderivative cannot be evaluated", () => {
    assert.throws(
      () => invokeCompute(symbolic, "symbolic", "integrate", {
        expression: "tan(x)", lower: 0, upper: 1,
      }),
      /definite integral/,
    );
    assert.throws(
      () => invokeCompute(symbolic, "symbolic", "integrate", {
        expression: "y*x**2", variable: "x", lower: 0, upper: 3,
      }),
      /definite integral could not be evaluated/,
    );
  });

  it("run_compute returns 9 for a definite integral of x**2", async () => {
    const result = await executeToolCall({}, () => null, new Map(), {
      tool: "run_compute",
      params: { key: "symbolic.integrate", input: { expression: "x**2", variable: "x", lower: 0, upper: 3 } },
    });
    assert.equal(result.ok, true);
    assert.equal(result.result.value, 9);
    assert.equal(result.result.definite, true);
  });

  it("run_compute reports an honest failure when definite limits cannot be evaluated", async () => {
    const result = await executeToolCall({}, () => null, new Map(), {
      tool: "run_compute",
      params: { key: "symbolic.integrate", input: { expression: "tan(x)", range: [0, 1] } },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /definite integral/);
  });
});
