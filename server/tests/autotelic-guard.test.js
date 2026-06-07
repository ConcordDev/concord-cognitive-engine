// Test for Wave 7 / E8 — the autotelic guard (Context 11): worth lives in the doing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appraiseGoalOutcome, appraiseExperience } from "../lib/felt-per.js";

test("E8 — autotelic goal-outcome guard", async (t) => {
  await t.test("abandonment is re-orientation, NOT despair (≈ zero existential penalty)", () => {
    const fp = appraiseGoalOutcome("abandoned", { affect: { v: 0.1, a: 0.2 } });
    assert.ok(Math.abs(fp.valence) < 0.2, `a dropped goal carries near-zero valence (${fp.valence.toFixed(2)})`);
    assert.ok(fp.intensity < 0.15, "and near-zero intensity — no peak, no scar");
  });

  await t.test("completion is a NORMAL peak, never an oversized terminal reward", () => {
    const completion = appraiseGoalOutcome("completed", { affect: { v: 0.2, a: 0.3 } });
    // a single intense lived moment (a triumph in the doing) is at least as strong
    const livedPeak = appraiseExperience({ kind: "victory" }, { affect: { v: 0.2, a: 0.8 } });
    assert.ok(completion.intensity <= 0.85, "completion intensity is capped");
    assert.ok(completion.valence > 0, "completion still feels good (just not arrival-fallacy huge)");
    assert.ok(completion.intensity <= livedPeak.intensity + 0.01,
      "the destination never dwarfs the lived stream (worth is in the doing)");
  });

  await t.test("totality", () => {
    assert.doesNotThrow(() => appraiseGoalOutcome("failed", {}));
    assert.ok(appraiseGoalOutcome("nonsense", {}).valence !== undefined);
  });
});
