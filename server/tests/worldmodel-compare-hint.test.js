// FIX-worldmodel-006 — an identically-configured compare must say why it ties.
//
// The walk: Compare with growth 0 on both sides produced "0 vs 0,
// no net difference" with no hint that the scenarios were configured
// the same. (The panel's own defaults are 0.05 vs 0.12 and compare
// meaningfully; the confusing case is ANY equal configuration.)
// compare_scenarios now returns a hint naming the shared growth and
// what to change when both sides are configured identically and the
// trajectories come out identical — and no hint for a real compare.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("worldmodel compare hint (FIX-worldmodel-006)", () => {
  let ctx;
  before(async () => {
    ctx = await depthCtx("worldmodel-cmp-hint");
    await lensRun("worldmodel", "wm_create_entity", { params: { name: "E", attributes: { value: 100 } } }, ctx);
  });

  it("growth 0 on both sides: verdict ties AND the hint explains why", async () => {
    const r = await lensRun("worldmodel", "compare_scenarios", { params: {
      steps: 5, baseline: { growth: 0 }, counterfactual: { growth: 0 },
    } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalSwing, 0);
    assert.equal(r.result.verdict, "no net difference");
    assert.ok(typeof r.result.hint === "string" && r.result.hint.includes("growth 0"));
    assert.ok(r.result.hint.includes("different growth rate"));
  });

  it("equal non-zero growth also hints (same configuration, not a real tie)", async () => {
    const r = await lensRun("worldmodel", "compare_scenarios", { params: {
      steps: 5, baseline: { growth: 0.1 }, counterfactual: { growth: 0.1 },
    } }, ctx);
    assert.equal(r.result.totalSwing, 0);
    assert.ok(r.result.hint && r.result.hint.includes("growth 0.1"));
  });

  it("a real compare (0.10 vs 0.20) carries NO hint", async () => {
    const r = await lensRun("worldmodel", "compare_scenarios", { params: {
      steps: 5, baseline: { growth: 0.1 }, counterfactual: { growth: 0.2 },
    } }, ctx);
    assert.ok(r.result.totalSwing > 0);
    assert.equal(r.result.hint, null);
  });
});
