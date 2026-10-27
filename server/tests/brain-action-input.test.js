import { test } from "node:test";
import assert from "node:assert/strict";
import { hasUsableBrainInput, needsInputError } from "../lib/brain-action-input.js";

test("empty data and params -> false", () => {
  assert.equal(hasUsableBrainInput(undefined, undefined), false);
  assert.equal(hasUsableBrainInput(null, {}), false);
  assert.equal(hasUsableBrainInput({}, {}), false);
  assert.equal(hasUsableBrainInput([], null), false);
});

test("data with fields -> true", () => {
  assert.equal(hasUsableBrainInput({ code: "x" }, {}), true);
  assert.equal(hasUsableBrainInput([1], {}), true);
  assert.equal(hasUsableBrainInput("text", {}), true);
});

test("params with a non-empty value -> true", () => {
  assert.equal(hasUsableBrainInput({}, { prompt: "hi" }), true);
  assert.equal(hasUsableBrainInput(null, { n: 0 }), true);
});

test("params with only empty values -> false", () => {
  assert.equal(hasUsableBrainInput({}, { a: "", b: "  ", c: null, d: undefined, e: [], f: {} }), false);
});

test("needsInputError shape", () => {
  const e = needsInputError("code", "review");
  assert.equal(e.ok, false);
  assert.equal(e.error, "invalid_input");
  assert.equal(e.reason, "needs_artifact_input");
  assert.equal(e.message, "code.review needs input to work on");
});

test("a stored artifact's title counts as input; a virtual artifact has none", () => {
  assert.equal(hasUsableBrainInput({}, {}, "Quarterly review notes"), true);
  assert.equal(hasUsableBrainInput({}, {}, undefined), false);
  assert.equal(hasUsableBrainInput(null, {}, "   "), false);
});
