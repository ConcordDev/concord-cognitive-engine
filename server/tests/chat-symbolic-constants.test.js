// Brief D item 3: symbolic.evaluate knows pi, e and standard constants and
// says what to bind when a variable is unbound.
import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, CONSTANTS } from "../lib/compute/symbolic-math.js";
import { executeToolCall } from "../lib/chat-agent.js";

const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.abs(b);

test("pi and e resolve", () => {
  assert.equal(evaluate("pi"), Math.PI);
  assert.equal(evaluate("e"), Math.E);
  assert.ok(near(evaluate("2*pi*r", { r: 3 }), 6 * Math.PI));
});

test("Euler column from the footbridge: pi^2 * E * I / L^2 = 568.5 kN", () => {
  const v = evaluate("pi^2 * E * I / L^2", { E: 200e9, I: 1.8e-6, L: 2.5 });
  assert.ok(Math.abs(v / 1e3 - 568.5) < 0.1);
});

test("a caller's binding wins over a constant", () => {
  assert.equal(evaluate("e + 1", { e: 10 }), 11);
});

test("an unbound variable explains how to bind it", () => {
  assert.throws(() => evaluate("x + pi"), (err) => /unbound variable x/.test(err.message) && /values/.test(err.message) && /pi/.test(err.message));
});

test("constants are frozen and physical", () => {
  assert.ok(Object.isFrozen(CONSTANTS));
  assert.equal(CONSTANTS.g0, 9.80665);
});

test("through the chat tool", async () => {
  const r = await executeToolCall({}, () => null, new Map(), { tool: "run_compute", params: { key: "symbolic.evaluate", input: { expression: "pi * 2^2" } } });
  assert.equal(r.ok, true);
  assert.ok(near(r.result, 4 * Math.PI));
});
