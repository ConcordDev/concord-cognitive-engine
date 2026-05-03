// server/tests/inference/royalty.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeContributors, emitRoyaltyEvent } from "../../lib/inference/royalty-hook.js";

describe("@concord/inference — Royalty Hook", () => {
  it("computeContributors returns empty for no refs", () => {
    assert.deepEqual(computeContributors([], []), []);
    assert.deepEqual(computeContributors(null, []), []);
  });

  it("computeContributors assigns equal weights", () => {
    const contribs = computeContributors(["dtu_a", "dtu_b", "dtu_c"], []);
    assert.equal(contribs.length, 3);
    const totalWeight = contribs.reduce((s, c) => s + c.weight, 0);
    assert.ok(Math.abs(totalWeight - 1.0) < 0.05, `Weights should sum to ~1, got ${totalWeight}`);
  });

  it("computeContributors maps dtuId correctly", () => {
    const contribs = computeContributors(["dtu_x"], []);
    assert.equal(contribs[0].dtuId, "dtu_x");
    assert.equal(contribs[0].weight, 1);
  });

  it("emitRoyaltyEvent does not throw when royalty-cascade is unavailable", async () => {
    // This should be non-blocking and non-fatal
    await assert.doesNotReject(async () => {
      emitRoyaltyEvent("inf_test", [{ dtuId: "dtu_a", weight: 1 }], null);
      // Give setImmediate a chance to run
      await new Promise(r => { setImmediate(r); });
    });
  });

  it("emitRoyaltyEvent skips when no contributors", async () => {
    await assert.doesNotReject(async () => {
      emitRoyaltyEvent("inf_empty", [], null);
      await new Promise(r => { setImmediate(r); });
    });
  });
});
