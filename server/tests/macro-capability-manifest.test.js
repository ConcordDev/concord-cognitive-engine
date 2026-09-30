import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyMacro } from "../lib/runtime/macro-capability-classifier.js";
import { evaluateDomainAcceptance } from "../lib/runtime/domain-acceptance.js";
import { isFailureType, FAILURE_TYPES } from "../lib/runtime/macro-failure-taxonomy.js";

describe("macro-capability-classifier", () => {
  it("classifies deterministic calculators as headless-safe A", () => {
    const r = classifyMacro("math", "symbolicCompute");
    assert.equal(r.class, "A");
    assert.equal(r.headlessSafe, true);
  });

  it("classifies destructive macros as E", () => {
    const r = classifyMacro("dtu", "delete");
    assert.equal(r.class, "E");
    assert.equal(r.headlessSafe, false);
  });

  it("classifies live_* as external dependency C", () => {
    const r = classifyMacro("astronomy", "live_apod");
    assert.equal(r.class, "C");
  });
});

describe("domain-acceptance gates", () => {
  it("passes A–F when oracle representative is registered, invoked, verified, logged", () => {
    const keys = new Set(["math.symbolicCompute"]);
    const inv = new Map([
      ["math.symbolicCompute", { ok: true, verified: true, logged: true }],
      ["math.symbolicCompute@invalid", { ok: false, threw: false }],
    ]);
    const report = evaluateDomainAcceptance("math", {
      registeredKeys: keys,
      invocationByKey: inv,
      representativeActions: ["symbolicCompute"],
    });
    assert.equal(report.complete, true);
    assert.equal(report.gates.A_registration.pass, true);
    assert.equal(report.gates.C_invocation.pass, true);
    assert.equal(report.gates.D_correctness.pass, true);
    assert.equal(report.gates.E_logging.pass, true);
    assert.equal(report.gates.F_error_behavior.pass, true);
  });
});

describe("macro-failure-taxonomy", () => {
  it("exports stable failure type list", () => {
    assert.ok(FAILURE_TYPES.includes("DISPATCH_FAILURE"));
    assert.ok(isFailureType("CORRECTNESS_FAILURE"));
    assert.equal(isFailureType("NOT_A_TYPE"), false);
  });
});
