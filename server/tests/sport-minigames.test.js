// WAVE JOBS — per-sport minigame content-packs over the shared ActionResolver.
// Run: node --test tests/sport-minigames.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MINIGAMES, isMinigame, scoreInput, resolveMinigame } from "../lib/sport-minigames.js";

describe("minigame packs", () => {
  it("every pack declares a sport, attribute, and a scoreInput fn", () => {
    for (const [id, mg] of Object.entries(MINIGAMES)) {
      assert.ok(mg.sport && mg.attribute && typeof mg.scoreInput === "function", id);
    }
    assert.ok(isMinigame("shot_timing"));
    assert.equal(isMinigame("quidditch"), false);
  });
});

describe("scoreInput maps raw → 0..1", () => {
  it("perfect timing scores high, a miss scores low", () => {
    assert.ok(scoreInput("shot_timing", { errorMs: 0 }) > 0.95);
    assert.ok(scoreInput("shot_timing", { errorMs: 140 }) < 0.05);
    assert.ok(scoreInput("shot_timing", { errorMs: 0 }) > scoreInput("shot_timing", { errorMs: 70 }));
  });
  it("pitch-meter blends timing + aim", () => {
    const great = scoreInput("pitch_meter", { errorMs: 0, aimError: 0 });
    const okTimingBadAim = scoreInput("pitch_meter", { errorMs: 0, aimError: 1 });
    assert.ok(great > okTimingBadAim);
  });
  it("pass-power rewards matching the target band", () => {
    assert.ok(scoreInput("pass_power", { power: 0.7, targetPower: 0.7 }) > scoreInput("pass_power", { power: 0.2, targetPower: 0.7 }));
  });
});

describe("resolveMinigame → performanceScore via the floor-gated resolver", () => {
  it("good input + good attribute beats bad input", () => {
    const good = resolveMinigame("shot_timing", { attribute: 0.7, raw: { errorMs: 0 } });
    const bad = resolveMinigame("shot_timing", { attribute: 0.7, raw: { errorMs: 130 } });
    assert.ok(good.performanceScore > bad.performanceScore);
    assert.equal(good.sport, "basketball");
  });
  it("a low-attribute player can't green it even with perfect input (2K rule)", () => {
    const perfectButLow = resolveMinigame("punch_stick", { attribute: 0.2, raw: { errorMs: 0, aimAccuracy: 1 } });
    assert.ok(perfectButLow.performanceScore <= perfectButLow.ceiling + 1e-9);
    assert.ok(perfectButLow.ceiling < 0.7); // gated below elite
  });
  it("unknown minigame → zero", () => {
    assert.equal(resolveMinigame("nope", {}).performanceScore, 0);
  });
});
