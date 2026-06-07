// Wave 7 / Layer 1 — umwelt filter contract.
//
// Pins: per-species perception vectors are total (authored → clade → humanoid);
// the SAME raw world signals produce a DIFFERENT salient channel per species
// (deer → sound, hawk → light — von Uexküll: a different perceptual world);
// graceful degrade when hasData is false.
//
// Run: node --test tests/umwelt.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  umweltForSpecies, perceiveSignals, _resetUmweltCache, UMWELT_CHANNELS,
} from "../lib/ecosystem/umwelt.js";

describe("Wave 7 — umwelt filter (Layer 1)", () => {
  it("umweltForSpecies is total: authored, clade fallback, humanoid baseline", () => {
    _resetUmweltCache();
    const deer = umweltForSpecies("deer");
    assert.ok(UMWELT_CHANNELS.every((c) => typeof deer[c] === "number"));
    assert.ok(deer.sound > deer.light, "deer weights sound over light");

    // unknown avian-named species → clade default (avian: light-heavy), not a throw
    const unknownBird = umweltForSpecies("glimmer_hawk_xyz");
    assert.ok(UMWELT_CHANNELS.every((c) => typeof unknownBird[c] === "number"));
    assert.ok(unknownBird.light > unknownBird.airQuality, "avian clade weights light high");

    // totally unknown → humanoid baseline (all 1), still total
    const glorp = umweltForSpecies("glorp_9000");
    assert.ok(UMWELT_CHANNELS.every((c) => typeof glorp[c] === "number"));
  });

  it("same world → different salient channel per species (the von Uexküll point)", () => {
    // A loud, brightly-lit clearing: high noise AND high light.
    const signals = {
      hasData: true,
      temperature: 18, humidity: 50, airQuality: 0.92,
      light: 95000,   // bright
      noise: 88,      // loud
      pressure: 101.325, structuralStress: 0,
    };
    const deerView = perceiveSignals(signals, umweltForSpecies("deer"));
    const hawkView = perceiveSignals(signals, umweltForSpecies("hawk"));

    assert.equal(deerView.salientChannel, "sound", "deer attends to the sound");
    assert.equal(hawkView.salientChannel, "light", "hawk attends to the light");

    // and the loud reading is MORE salient to the deer than to the hawk
    const deerSoundView = perceiveSignals({ ...signals, light: 10000 }, umweltForSpecies("deer"));
    const hawkSoundView = perceiveSignals({ ...signals, light: 10000 }, umweltForSpecies("hawk"));
    assert.ok(deerSoundView.salience > hawkSoundView.salience,
      "the same loud noise is louder in the deer's world than the hawk's");
  });

  it("salience degrades to ~0 when the world has no data", () => {
    const view = perceiveSignals({ hasData: false }, umweltForSpecies("deer"));
    assert.equal(view.salience, 0);
    assert.equal(view.salientChannel, null);
  });

  it("perceiveSignals is total on garbage input", () => {
    const view = perceiveSignals(null, null);
    assert.ok(Number.isFinite(view.salience));
    assert.equal(view.salience, 0);
  });
});
