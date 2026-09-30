import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveCompletionStatus } from "../lib/runtime/completion-status.js";
import { LENS_ACTION_STATUS } from "../lib/runtime/lens-behavioral-contract.js";
import { classifyMacro } from "../lib/runtime/macro-capability-classifier.js";
import { STATEFUL_COVERAGE_MACRO_IDS } from "../../scripts/lib/runtime-coverage-fixtures.mjs";

describe("completion-status", () => {
  it("maps passed contract to VERIFIED", () => {
    assert.equal(
      deriveCompletionStatus({ contractStatus: LENS_ACTION_STATUS.PASSED }),
      "VERIFIED"
    );
  });

  it("maps oracle verification to VERIFIED", () => {
    assert.equal(deriveCompletionStatus({ oracleVerified: true }), "VERIFIED");
  });

  it("maps interactive skip to BLOCKED_REQUIRES_INTERACTIVE_STATE", () => {
    assert.equal(deriveCompletionStatus({ skippedClassD: true }), "BLOCKED_REQUIRES_INTERACTIVE_STATE");
  });
});

describe("runtime-capability-classifier coverage buckets", () => {
  it("classifies math symbolicCompute as headless-safe A", () => {
    const r = classifyMacro("math", "symbolicCompute");
    assert.equal(r.class, "A");
    assert.equal(r.headlessSafe, true);
  });

  it("classifies world create as stateful D", () => {
    const r = classifyMacro("world", "create");
    assert.equal(r.class, "D");
    assert.equal(r.headlessSafe, false);
  });

  it("stateful harness includes class D and E macros", () => {
    assert.ok(STATEFUL_COVERAGE_MACRO_IDS.has("world.save"));
    assert.ok(STATEFUL_COVERAGE_MACRO_IDS.has("dtu.delete"));
    assert.ok(STATEFUL_COVERAGE_MACRO_IDS.size >= 63);
  });
});
