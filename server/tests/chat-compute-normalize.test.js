// server/tests/chat-compute-normalize.test.js
//
// Compute-don't-guess in chat (lib/chat-compute-normalize.js). A QA run got a
// fabricated 7,031,242 for 1234*5678 (true: 7,006,652) because the model
// emitted a bare {"key":"multiply",...} object and guessed the answer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeComputeCall, extractArithmetic } from "../lib/chat-compute-normalize.js";
import { evaluate } from "../lib/compute/symbolic-math.js";
import { parseObserveCalls } from "../lib/v6-observe-bridge.js";

test("model-invented arithmetic keys map to the deterministic evaluator", () => {
  const n = normalizeComputeCall("multiply", { a: 1234, b: 5678 });
  assert.equal(n.key, "symbolic.evaluate");
  assert.equal(evaluate(n.expression), 7006652);
  assert.equal(evaluate(normalizeComputeCall("calculate", { expression: "(2+3)^2/5" }).expression), 5);
  assert.equal(evaluate(normalizeComputeCall("sum", { values: [1, 2, 3] }).expression), 6);
  assert.equal(evaluate(normalizeComputeCall("", { expression: "1234*5678" }).expression), 7006652, "empty key + expression still computes");
  assert.deepEqual(normalizeComputeCall("chemistry.molecularAnalysis", { formula: "H2O" }), { key: "chemistry.molecularAnalysis", input: { formula: "H2O" } });
});

test("arithmetic is pulled from a user's message, but not from dates or ranges", () => {
  assert.equal(extractArithmetic("What is 1234 * 5678? Use run_compute"), "1234 * 5678");
  assert.equal(extractArithmetic("calculate (2+3)^2/5 please"), "(2+3)^2/5");
  assert.equal(extractArithmetic("what's 12 × 4"), "12 * 4");
  assert.equal(extractArithmetic("what is 100 - 58"), "100 - 58");
  assert.equal(extractArithmetic("whats 98765 minus 4321"), "98765 - 4321");
  assert.equal(extractArithmetic("what is 12 times 4"), "12 * 4");
  assert.equal(extractArithmetic("2 to the power of 10?"), "2 ^ 10");
  assert.equal(extractArithmetic("meet me 2026-09-27 at 3"), null);
  assert.equal(extractArithmetic("I need 3-5 apples"), null);
  assert.equal(extractArithmetic("tell me about Concord"), null);
});

test("a bare tool-shaped JSON reply is parsed as a real call", () => {
  const calls = parseObserveCalls('{"key":"multiply","input":{"a":1234,"b":5678},"answer":7031242}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, "run_compute");
  assert.deepEqual(calls[0].params, { key: "multiply", input: { a: 1234, b: 5678 } });
  const lens = parseObserveCalls('{"domain":"engineering","action":"runFEA","params":{"x":1}}');
  assert.equal(lens[0].tool, "run_lens_action");
});

test("arithmetic answers are formatted from the engine's value", async () => {
  const { formatArithmeticAnswer } = await import("../lib/chat-compute-normalize.js");
  assert.equal(formatArithmeticAnswer("1234 * 5678", 7006652), "1234 × 5678 = 7,006,652");
});

test("only messages that ASK for a calculation trigger the fallback", async () => {
  const { arithmeticQuestion } = await import("../lib/chat-compute-normalize.js");
  assert.equal(arithmeticQuestion("What is 1234 * 5678? Use run_compute, don't guess."), "1234 * 5678");
  assert.equal(arithmeticQuestion("98765 minus 4321"), "98765 - 4321");
  assert.equal(arithmeticQuestion("Explain why 2+2=4 matters in philosophy of mathematics"), null);
  assert.equal(arithmeticQuestion("I scored 12 * 4 points in the game last night, nice right?"), null);
});
