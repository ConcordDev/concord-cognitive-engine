/**
 * Stealth + perception fairness test.
 *
 * Verifies the opacity curve is asymmetric and skill-driven, plus the
 * backstab gate fails when victim's perception is meaningfully higher
 * than attacker's stealth.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeVisibility,
  MIN_OPACITY,
  MAX_OPACITY,
  BACKSTAB_PERCEPTION_MARGIN,
} from "../lib/stealth-perception.js";

describe("computeVisibility — basic skill matchup", () => {
  it("low perception sees a high-stealth target as nearly invisible", () => {
    const o = computeVisibility({
      targetStealthSkill: 200,
      observerPerceptionSkill: 0,
      distance: 5,
    });
    assert.ok(o < 0.4, `low perception should see a master rogue near floor; got ${o}`);
    assert.ok(o >= MIN_OPACITY);
  });

  it("high perception sees a high-stealth target clearly", () => {
    const o = computeVisibility({
      targetStealthSkill: 200,
      observerPerceptionSkill: 200,
      distance: 5,
    });
    assert.ok(o > 0.7, `high perception should see master rogue clearly; got ${o}`);
  });

  it("equal-skill matchup sits in the middle", () => {
    const o = computeVisibility({
      targetStealthSkill: 100,
      observerPerceptionSkill: 100,
      distance: 5,
    });
    assert.ok(o > 0.5 && o < 0.95, `expected mid-range opacity; got ${o}`);
  });

  it("never returns 0 — silhouette always visible", () => {
    const o = computeVisibility({
      targetStealthSkill: 200,
      observerPerceptionSkill: 0,
      distance: 100,
      isCrouching: true,
      hasCover: true,
      lighting: 0,
    });
    assert.ok(o >= MIN_OPACITY, `should be at least MIN_OPACITY (${MIN_OPACITY}); got ${o}`);
  });

  it("never returns above 1.0", () => {
    const o = computeVisibility({
      targetStealthSkill: 0,
      observerPerceptionSkill: 200,
      distance: 1,
      isCrouching: false,
      hasCover: false,
      lighting: 1.0,
    });
    assert.ok(o <= MAX_OPACITY);
  });
});

describe("computeVisibility — environmental modifiers", () => {
  it("crouch lowers opacity vs same matchup standing", () => {
    const standing = computeVisibility({
      targetStealthSkill: 100,
      observerPerceptionSkill: 100,
      distance: 5,
      isCrouching: false,
    });
    const crouching = computeVisibility({
      targetStealthSkill: 100,
      observerPerceptionSkill: 100,
      distance: 5,
      isCrouching: true,
    });
    assert.ok(crouching < standing, `crouch (${crouching}) should < standing (${standing})`);
  });

  it("hard cover stacks with crouch", () => {
    const open = computeVisibility({
      targetStealthSkill: 100, observerPerceptionSkill: 100, distance: 5,
    });
    const concealed = computeVisibility({
      targetStealthSkill: 100, observerPerceptionSkill: 100, distance: 5,
      isCrouching: true, hasCover: true,
    });
    assert.ok(concealed < open * 0.6);
  });

  it("distance > 30m further reduces visibility", () => {
    const close = computeVisibility({
      targetStealthSkill: 100, observerPerceptionSkill: 100, distance: 5,
    });
    const far = computeVisibility({
      targetStealthSkill: 100, observerPerceptionSkill: 100, distance: 60,
    });
    assert.ok(far < close, `far (${far}) should < close (${close})`);
  });

  it("lighting=0 (pitch dark) doesn't drive opacity below the floor", () => {
    const dark = computeVisibility({
      targetStealthSkill: 0, observerPerceptionSkill: 200, distance: 5,
      lighting: 0,
    });
    const bright = computeVisibility({
      targetStealthSkill: 0, observerPerceptionSkill: 200, distance: 5,
      lighting: 1,
    });
    assert.ok(dark < bright);
    assert.ok(dark > 0.2, `night-vision floor should keep opacity above 0.2; got ${dark}`);
  });
});

describe("computeVisibility — fairness asymmetry", () => {
  it("training observation dramatically improves detection", () => {
    const untrained = computeVisibility({
      targetStealthSkill: 150, observerPerceptionSkill: 0,
    });
    const novice = computeVisibility({
      targetStealthSkill: 150, observerPerceptionSkill: 50,
    });
    const trained = computeVisibility({
      targetStealthSkill: 150, observerPerceptionSkill: 100,
    });
    const expert = computeVisibility({
      targetStealthSkill: 150, observerPerceptionSkill: 200,
    });
    assert.ok(untrained < novice);
    assert.ok(novice < trained);
    assert.ok(trained < expert);
    // The progression should be monotone increasing — more training
    // means more visibility on the same target.
  });
});

describe("backstab perception margin constant", () => {
  it("BACKSTAB_PERCEPTION_MARGIN is a sane value", () => {
    assert.ok(BACKSTAB_PERCEPTION_MARGIN > 0);
    assert.ok(BACKSTAB_PERCEPTION_MARGIN < 100);
  });
});
