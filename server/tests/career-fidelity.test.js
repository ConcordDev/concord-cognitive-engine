// WAVE JOBS — the 3-fidelity dial + ActionResolver. Pins the floor-gated band
// (attributes gate the achievable range, skill biases within it, can't bypass),
// the three modes, and that PLAY pays/XPs best.
//
// Run: node --test tests/career-fidelity.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FIDELITIES, resolveAction, resolveSession, fidelityPayMultiplier, fidelityXpMultiplier,
  FLOOR_FRAC, CEIL_FRAC,
} from "../lib/career-fidelity.js";

const seeded = (s) => { let h = s >>> 0; return () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0; h ^= h >>> 16; return (h >>> 0) / 4294967296; }; };

describe("ActionResolver — floor-gated band", () => {
  it("attributes set the band; skill biases within it", () => {
    const a = 0.6;
    const bad = resolveAction({ attribute: a, skillInput: 0 });
    const good = resolveAction({ attribute: a, skillInput: 1 });
    assert.ok(good.outcome > bad.outcome);                 // skill matters
    assert.ok(bad.outcome >= a * FLOOR_FRAC - 1e-9);       // floor: attributes keep you up
    assert.ok(good.outcome <= a + (1 - a) * CEIL_FRAC + 1e-9); // ceiling: skill can't fully bypass
  });
  it("a low-attribute action can't be greened by perfect input (the 2K rule)", () => {
    const lowGreatInput = resolveAction({ attribute: 0.2, skillInput: 1 });
    assert.ok(lowGreatInput.outcome < 0.7, `outcome ${lowGreatInput.outcome}`); // can't reach elite/"green" (~0.8)
    assert.ok(lowGreatInput.ceiling < 0.7);
    // and it stays far below a high-attribute player's ceiling
    assert.ok(lowGreatInput.ceiling < resolveAction({ attribute: 0.9, skillInput: 0 }).ceiling + 0.3);
  });
  it("a high-attribute action has a high floor even on bad input", () => {
    const highBadInput = resolveAction({ attribute: 0.9, skillInput: 0 });
    assert.ok(highBadInput.outcome >= 0.9 * FLOOR_FRAC);   // ≥0.36, your stats carry you
  });
});

describe("3-fidelity sessions", () => {
  it("delegate is a deterministic attribute-driven sim (no human input)", () => {
    const s1 = resolveSession("delegate", { attribute: 0.7, rng: seeded(1) });
    const s2 = resolveSession("delegate", { attribute: 0.7, rng: seeded(1) });
    assert.equal(s1.performanceScore, s2.performanceScore); // same seed → same result
    assert.equal(s1.mode, "delegate");
  });
  it("play uses the player's real skillInput", () => {
    const great = resolveSession("play", { attribute: 0.6, skillInput: 1 });
    const poor = resolveSession("play", { attribute: 0.6, skillInput: 0 });
    assert.ok(great.performanceScore > poor.performanceScore);
  });
  it("coach nudges the sim upward", () => {
    const plain = resolveSession("coach", { attribute: 0.5, coachNudge: 0, rng: seeded(3) });
    const nudged = resolveSession("coach", { attribute: 0.5, coachNudge: 1, rng: seeded(3) });
    assert.ok(nudged.performanceScore >= plain.performanceScore);
  });
  it("an unknown mode falls back to delegate", () => {
    assert.equal(resolveSession("teleport", { attribute: 0.5 }).mode, "delegate");
  });
});

describe("doing it yourself pays best", () => {
  it("play > coach > delegate on pay and XP", () => {
    assert.ok(fidelityPayMultiplier("play") > fidelityPayMultiplier("coach"));
    assert.ok(fidelityPayMultiplier("coach") > fidelityPayMultiplier("delegate"));
    assert.ok(fidelityXpMultiplier("play") > fidelityXpMultiplier("delegate"));
    assert.deepEqual(FIDELITIES, ["delegate", "coach", "play"]);
  });
});
