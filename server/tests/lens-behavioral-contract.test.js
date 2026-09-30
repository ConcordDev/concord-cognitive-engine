import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isExemptLens,
  isWellShapedEnvelope,
  isHonestResponse,
  runLensActionContract,
  LENS_ACTION_STATUS,
} from "../lib/runtime/lens-behavioral-contract.js";

describe("lens-behavioral-contract", () => {
  it("exempts the four by-design no-backend lenses", () => {
    assert.equal(isExemptLens("ux-suite"), true);
    assert.equal(isExemptLens("sentinel"), false);
  });

  it("detects well-shaped envelopes", () => {
    assert.equal(isWellShapedEnvelope({ ok: true, result: {} }), true);
    assert.equal(isWellShapedEnvelope({ error: "nope" }), true);
    assert.equal(isWellShapedEnvelope("string"), false);
  });

  it("runs full contract on a stub dispatch", async () => {
    const dispatch = async (domain, action, input) => {
      if (input?.__invalid) return { ok: false, error: "invalid" };
      return { ok: true, result: { items: [], total: 0 } };
    };
    const resolveAction = (d, a) => (d === "sentinel" && a === "triage.list" ? "macros" : null);
    const r = await runLensActionContract({
      lensId: "sentinel",
      domain: "sentinel",
      action: "triage.list",
      dispatch,
      resolveAction,
      ctx: { actor: { userId: "test" } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.status, LENS_ACTION_STATUS.PASSED);
    assert.equal(r.stages.action_resolution.pass, true);
    assert.equal(r.stages.semantic_correctness.pass, true);
  });

  it("accepts reason as an honest failure field", () => {
    assert.equal(isHonestResponse({ ok: false, reason: "missing_query" }), true);
    assert.equal(isHonestResponse({ ok: false }), false);
  });

  it("fails registration when action missing", async () => {
    const r = await runLensActionContract({
      lensId: "fake",
      domain: "fake",
      action: "missing",
      dispatch: async () => ({ ok: true }),
      resolveAction: () => null,
      ctx: {},
    });
    assert.equal(r.ok, false);
    assert.equal(r.failureType, "REGISTRATION_FAILURE");
  });
});
