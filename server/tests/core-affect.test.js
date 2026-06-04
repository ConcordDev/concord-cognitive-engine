// Wave 7 / Layer 2 — core affect (Damasio fold) contract.
//
// Pins: predator + hunger → high arousal, negative valence; satiated + safe →
// positive valence, low arousal; smoothing lands between prior and target;
// totality on garbage.
//
// Run: node --test tests/core-affect.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCoreAffect, _internal } from "../lib/ecosystem/core-affect.js";
import { freshCreatureNeeds } from "../lib/ecosystem/creature-needs.js";

describe("Wave 7 — core affect (Layer 2)", () => {
  it("predator near + high hunger → high arousal, negative valence", () => {
    const needs = { ...freshCreatureNeeds(), hunger: 0.9, thirst: 0.6 };
    const { v, a } = computeCoreAffect(
      { salience: 0.7 }, needs, { predatorNear: true, painIntensity: 0.2 },
    );
    assert.ok(a > 0.7, `arousal high (${a})`);
    assert.ok(v < 0, `valence negative (${v})`);
  });

  it("satisfied needs, no threat → positive valence, low arousal", () => {
    const { v, a } = computeCoreAffect(
      { salience: 0.05 }, freshCreatureNeeds(), {},
    );
    assert.ok(v > 0.8, `valence high (${v})`);
    assert.ok(a < 0.2, `arousal low (${a})`);
  });

  it("smoothing lands a spike between prior and target", () => {
    const prior = { v: 0.5, a: 0.1 };
    const spike = computeCoreAffect(
      { salience: 1.0 }, { ...freshCreatureNeeds(), safety: 1 },
      { predatorNear: true }, prior,
    );
    // arousal target is high; smoothed value sits between prior.a and that target
    assert.ok(spike.a > prior.a && spike.a < 1.0, `arousal smoothed (${spike.a})`);
    // one pass of SMOOTH=0.3 means we moved (1-0.3)=0.7 of the way
    assert.ok(_internal.SMOOTH > 0 && _internal.SMOOTH < 1);
  });

  it("is total on garbage input", () => {
    const { v, a } = computeCoreAffect(null, null, null, null);
    assert.ok(Number.isFinite(v) && Number.isFinite(a));
    assert.ok(a >= 0 && a <= 1 && v >= -1 && v <= 1);
  });
});
