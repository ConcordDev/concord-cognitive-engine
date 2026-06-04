// Contract test for Wave 7 / Layer 6 — the felt-per appraisal (the missing middle).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appraiseExperience,
  peakEnd,
  feltPeakBonus,
  classifyFragment,
} from "../lib/felt-per.js";

test("Wave 7 — felt-per appraisal (Layer 6)", async (t) => {
  await t.test("the SAME event feels different by state (relief vs nil)", () => {
    const starving = appraiseExperience({ kind: "eat" }, { needs: { hunger: 0.95 } });
    const sated = appraiseExperience({ kind: "eat" }, { needs: { hunger: 0.03 } });
    assert.ok(starving.intensity > sated.intensity,
      `starving-bread (${starving.intensity.toFixed(2)}) > sated-bread (${sated.intensity.toFixed(2)})`);
    assert.ok(starving.intensity > 0.2, "relief is a real felt peak");
    assert.ok(sated.intensity < 0.1, "eating when full barely registers");
    assert.equal(starving.dominantDrive, "SEEKING");
  });

  await t.test("a grieving state darkens the same appraisal (the loop)", () => {
    const event = { kind: "social_warm" };
    const neutral = appraiseExperience(event, { affect: { v: 0, a: 0.2 } });
    const grieving = appraiseExperience(event, { affect: { v: -0.8, a: 0.5 } });
    assert.ok(grieving.valence < neutral.valence,
      `grieving valence (${grieving.valence.toFixed(2)}) < neutral (${neutral.valence.toFixed(2)})`);
  });

  await t.test("harm events are negative + high-arousal", () => {
    const hit = appraiseExperience({ kind: "attacked", magnitude: 0.8 }, { needs: {} });
    assert.ok(hit.valence < 0 && hit.arousal > 0.5);
    assert.equal(hit.dominantDrive, "FEAR");
  });

  await t.test("totality on garbage input", () => {
    const r = appraiseExperience(null, null);
    assert.ok(Number.isFinite(r.valence) && Number.isFinite(r.arousal) && Number.isFinite(r.intensity));
    assert.equal(r.dominantDrive, null); // idle
  });

  await t.test("peakEnd picks the intensity argmax + the last fragment", () => {
    const frags = [
      { id: "a", feltPer: { intensity: 0.1, valence: 0.1 } },
      { id: "b", feltPer: { intensity: 0.9, valence: -0.8 } }, // the peak
      { id: "c", feltPer: { intensity: 0.3, valence: 0.2 } },
      { id: "d", feltPer: { intensity: 0.2, valence: 0.0 } }, // the end
    ];
    const { peak, end } = peakEnd(frags);
    assert.equal(peak.id, "b");
    assert.equal(end.id, "d");
    // total on empty
    assert.deepEqual(peakEnd([]), { peak: null, end: null });
    assert.deepEqual(peakEnd(null), { peak: null, end: null });
  });

  await t.test("feltPeakBonus rewards intensity + valence extremity", () => {
    const big = feltPeakBonus({ intensity: 0.9, valence: -0.9 });
    const dull = feltPeakBonus({ intensity: 0.05, valence: 0.05 });
    assert.ok(big > dull, "a trauma outlives a dull moment in retention");
    assert.ok(big <= 1 && dull >= 0);
    assert.equal(feltPeakBonus(null), 0);
  });

  await t.test("classifyFragment maps raw fragment shapes to kinds", () => {
    assert.equal(classifyFragment({ type: "damage_taken" }), "attacked");
    assert.equal(classifyFragment({ source: "world_visit" }), "explore");
    assert.equal(classifyFragment({ type: "funeral" }), "grief");
    assert.equal(classifyFragment({ kind: "eat" }), "eat");
    assert.equal(classifyFragment({}), "idle");
  });
});
