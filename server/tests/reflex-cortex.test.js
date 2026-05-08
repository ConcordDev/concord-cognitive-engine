/**
 * Tier-2 contract tests for the Reflex Cortex (Phase 8 / T3).
 *
 * Each of the four handlers must:
 *   - return { ok: true|false } never throw
 *   - report a `reason` when ok=false
 *   - tolerate missing dependencies (no STATE, no DB, no detector findings)
 *   - respect CONCORD_REFLEX_GOVERNANCE=0 kill-switch
 *
 * Pattern mirrors tests/lattice-orchestrator.test.js.
 *
 * Run: node --test tests/reflex-cortex.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  initReflexCortex,
  runArchitecturalDrift,
  runScalingPressure,
  runDependencyEntropy,
  runUnsafeExpansion,
  reflexStatus,
} from "../emergent/reflex-cortex.js";

describe("reflex cortex initialization", () => {
  it("initReflexCortex accepts (STATE) without throwing", () => {
    assert.doesNotThrow(() => initReflexCortex({}, {}));
    assert.doesNotThrow(() => initReflexCortex(null, {}));
  });

  it("reflexStatus returns shape-compliant payload", () => {
    initReflexCortex({}, {});
    const s = reflexStatus();
    assert.ok(typeof s === "object");
    assert.ok("disabled" in s);
  });
});

describe("never-throws contract — each handler returns { ok, reason? }", () => {
  for (const [name, fn] of [
    ["runArchitecturalDrift", runArchitecturalDrift],
    ["runScalingPressure", runScalingPressure],
    ["runDependencyEntropy", runDependencyEntropy],
    ["runUnsafeExpansion", runUnsafeExpansion],
  ]) {
    it(`${name} returns { ok: bool } never throws`, async () => {
      initReflexCortex({}, {});
      const r = await fn({});
      assert.ok(typeof r === "object" && r !== null);
      assert.equal(typeof r.ok, "boolean");
      if (!r.ok) assert.equal(typeof r.reason, "string");
    });

    it(`${name} survives no-state path`, async () => {
      initReflexCortex(null, {});
      const r = await fn({});
      assert.ok(typeof r === "object" && r !== null);
      assert.equal(typeof r.ok, "boolean");
    });
  }
});

describe("kill-switch CONCORD_REFLEX_GOVERNANCE=0", () => {
  it("each handler respects the disable flag", async () => {
    initReflexCortex({}, {});
    const prev = process.env.CONCORD_REFLEX_GOVERNANCE;
    process.env.CONCORD_REFLEX_GOVERNANCE = "0";
    try {
      const a = await runArchitecturalDrift({});
      assert.equal(a.ok, false);
      assert.match(a.reason, /disabled/);
      const b = await runScalingPressure({});
      assert.equal(b.ok, false);
      assert.match(b.reason, /disabled/);
      const c = await runDependencyEntropy({});
      assert.equal(c.ok, false);
      assert.match(c.reason, /disabled/);
      const d = await runUnsafeExpansion({});
      assert.equal(d.ok, false);
      assert.match(d.reason, /disabled/);
    } finally {
      if (prev === undefined) delete process.env.CONCORD_REFLEX_GOVERNANCE;
      else process.env.CONCORD_REFLEX_GOVERNANCE = prev;
    }
  });
});

describe("integration shape — handlers can be invoked in parallel", () => {
  it("all four handlers run in parallel without cross-talk", async () => {
    initReflexCortex({}, {});
    const results = await Promise.all([
      runArchitecturalDrift({}),
      runScalingPressure({}),
      runDependencyEntropy({}),
      runUnsafeExpansion({}),
    ]);
    for (const r of results) {
      assert.ok(typeof r === "object" && r !== null);
      assert.equal(typeof r.ok, "boolean");
    }
  });
});
