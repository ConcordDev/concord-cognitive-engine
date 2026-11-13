import test from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, FAILURE_CLASSES } from "../../lib/cockpit/failure-taxonomy.js";

const rows = [
  [{ ok: false, reason: "scope_denied", error: "scope mcp:lens:read required for list_lens_actions (risk=read)" }, "scope_denied"],
  [{ ok: false, error: "unknown compute function physics.length.convert", validKeys: ["physics.power"] }, "bad_args"],
  [{ ok: false, unknownTool: true, error: "unknown tool: dila_status" }, "unknown_tool"],
  [{ ok: false, error: "unsupported part: phone stand" }, "unsupported_input"],
  [{ ok: false, error: "DTU not found" }, "not_found"],
  [{ ok: false, error: "HTTP 404" }, "external"],
  [{ ok: false, error: "code_exec_forbidden" }, "disabled_tool"],
  [{ ok: false, reason: "timeout", error: "It ran out of time before this step finished." }, "timeout"],
  [{ ok: false, reason: "handler_threw", error: "lens action error: x is undefined" }, "tool_error"],
  [{ ok: false, error: "forbidden_by_governance" }, "hard_stop"],
  [{ ok: false, error: "insufficient funds" }, "hard_stop"],
  [{ ok: false, error: "something odd" }, "tool_error"],
  [{ ok: true }, "ok"],
];

for (const [input, cls] of rows) {
  test(`classifyFailure: ${JSON.stringify(input)} -> ${cls}`, () => {
    assert.equal(classifyFailure(input).class, cls);
  });
}

test("hard_stop is hard and not retryable", () => {
  const c = classifyFailure({ ok: false, error: "forbidden_by_governance" });
  assert.equal(c.hard, true);
  assert.equal(c.retryable, false);
});

test("negative control: consent required is hard_stop, never bad_args", () => {
  assert.equal(classifyFailure({ ok: false, error: "consent required" }).class, "hard_stop");
});

test("scope_denied is not retryable; others are", () => {
  assert.equal(classifyFailure({ ok: false, reason: "scope_denied" }).retryable, false);
  assert.equal(classifyFailure({ ok: false, error: "HTTP 503" }).retryable, true);
});

test("every produced class is in FAILURE_CLASSES (or ok)", () => {
  for (const [input] of rows) {
    const c = classifyFailure(input).class;
    assert.ok(c === "ok" || FAILURE_CLASSES.includes(c), c);
  }
});
