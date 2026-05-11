// server/tests/cross-world-potency-wireup.test.js
//
// Sprint 5 acceptance — the cross-world-effectiveness substrate is
// finally wired into the combat / skill / spell paths. Before this
// sprint, the formula existed in lib/cross-world-effectiveness.js but
// had ZERO callsites outside its own test file (the classic "almost-
// works trap"). This test pins the wire-up so it can't silently
// regress.
//
// Acceptance shape: a wizard's magic in cyber world is ~10% potent at
// level 1, ~50% potent at level 100, ~100% potent in fantasy.

import test from "node:test";
import assert from "node:assert/strict";
import { computeSkillEffectiveness } from "../lib/skills/skill-engine.js";
import {
  registerWorldMeta,
  effectivenessMultiplier,
  explainEffectiveness,
} from "../lib/cross-world-effectiveness.js";

// Register three test worlds with the same skill_affinity shapes as
// the real content/world/{fantasy,cyber,superhero}/meta.json files.
registerWorldMeta({
  world_id: "test_fantasy_5",
  skill_affinity: { default: 0.6, magic: 1.0, hacking: 0.0, bio_powers: 0.4, swordsmanship: 1.0 },
});
registerWorldMeta({
  world_id: "test_cyber_5",
  skill_affinity: { default: 0.6, magic: 0.1, hacking: 1.0, bio_powers: 0.5 },
});
registerWorldMeta({
  world_id: "test_superhero_5",
  skill_affinity: { default: 0.7, bio_powers: 1.0, magic: 0.05, swordsmanship: 0.6 },
});

test("wire-up — combat skill-engine pipes worldId through to cross-world layer", () => {
  // Level-1 wizard in fantasy: world_affinity (1.0) dominates the floor (0.10).
  const fantasyL1 = computeSkillEffectiveness("magic", 1, {}, { worldId: "test_fantasy_5" });
  assert.equal(fantasyL1.effective, true);
  assert.ok(fantasyL1.multiplier >= 1.0, `fantasy L1 mul ${fantasyL1.multiplier} should be ≥ 1.0`);
  assert.equal(fantasyL1.crossWorldMultiplier, 1.0);

  // Level-1 wizard in cyber: affinity=0.10, floor=0.10+0.40*(1/100)=0.104.
  // Floor narrowly wins; returns 0.104.
  const cyberL1 = computeSkillEffectiveness("magic", 1, {}, { worldId: "test_cyber_5" });
  assert.equal(cyberL1.effective, true);
  assert.ok(cyberL1.multiplier > 0.1 && cyberL1.multiplier < 0.11,
    `cyber L1 magic mul should be ~0.104, got ${cyberL1.multiplier}`);

  // Level-100 wizard in cyber: floor = 0.50, affinity = 0.10. Floor wins.
  const cyberL100 = computeSkillEffectiveness("magic", 100, {}, { worldId: "test_cyber_5", maxLevel: 100 });
  assert.equal(cyberL100.multiplier, 0.5,
    `cyber L100 magic mul should be 0.5 (floor wins over 0.1 affinity), got ${cyberL100.multiplier}`);

  // Level-50 wizard in cyber: floor = 0.10 + 0.40*0.5 = 0.30. Floor still wins.
  const cyberL50 = computeSkillEffectiveness("magic", 50, {}, { worldId: "test_cyber_5", maxLevel: 100 });
  assert.equal(cyberL50.multiplier, 0.3,
    `cyber L50 magic mul should be 0.3, got ${cyberL50.multiplier}`);
});

test("wire-up — bio-powers wizard ranks differently between superhero and cyber", () => {
  // Native bio-power user in superhero: full strength.
  const heroNative = computeSkillEffectiveness("bio_powers", 1, {}, { worldId: "test_superhero_5" });
  assert.equal(heroNative.multiplier, 1.0);

  // Same user travels to cyber: dampened to 0.5 affinity. Floor at L1 is 0.10.
  const heroInCyber = computeSkillEffectiveness("bio_powers", 1, {}, { worldId: "test_cyber_5" });
  assert.equal(heroInCyber.multiplier, 0.5);

  // Max-level master in cyber: floor (0.5) ties affinity (0.5). Same result.
  const heroL100InCyber = computeSkillEffectiveness("bio_powers", 100, {}, { worldId: "test_cyber_5", maxLevel: 100 });
  assert.equal(heroL100InCyber.multiplier, 0.5);
});

test("wire-up — backward compatibility: callsites without opts.worldId still work", () => {
  // No opts at all: layer 2 skipped, returns 1.0 base multiplier.
  const noOpts = computeSkillEffectiveness("magic", 50, {});
  assert.equal(noOpts.effective, true);
  assert.equal(noOpts.multiplier, 1.0);
  assert.equal(noOpts.crossWorldMultiplier, undefined);

  // Explicit empty opts: same as no opts.
  const emptyOpts = computeSkillEffectiveness("magic", 50, {}, {});
  assert.equal(emptyOpts.effective, true);
  assert.equal(emptyOpts.multiplier, 1.0);
});

test("wire-up — rule_modulators × skill_affinity multiply correctly", () => {
  const rules = {
    skill_effectiveness_rules: {
      magic: { multiplier: 0.5 }, // legacy DB rule: half potency
    },
  };
  // Layer 1: 0.5 (rule_modulators), Layer 2: 1.0 (fantasy magic is native). Combined = 0.5.
  const fantasyHalf = computeSkillEffectiveness("magic", 50, rules, { worldId: "test_fantasy_5", maxLevel: 100 });
  assert.equal(fantasyHalf.multiplier, 0.5);

  // Layer 1: 0.5, Layer 2: 0.3 (cyber, L50 floor). Combined = 0.15.
  const cyberHalf = computeSkillEffectiveness("magic", 50, rules, { worldId: "test_cyber_5", maxLevel: 100 });
  assert.equal(cyberHalf.multiplier, 0.15);
});

test("explainEffectiveness returns dialogue-ready note text", () => {
  const fantasy = explainEffectiveness({ domain: "magic", worldId: "test_fantasy_5", level: 1 });
  assert.ok(fantasy.note.includes("favorable") || fantasy.note.includes("supports") || fantasy.note.includes("magic"),
    `fantasy magic note should reference favorability, got: ${fantasy.note}`);

  const cyber = explainEffectiveness({ domain: "magic", worldId: "test_cyber_5", level: 1 });
  // At L1 cyber magic: affinity=0.10, floor=0.104. Floor wins by a hair.
  // The "note" should reference either dampening or skill level carrying you.
  assert.ok(cyber.note.length > 0, `note must be non-empty, got: ${JSON.stringify(cyber)}`);
  assert.ok(cyber.multiplier > 0.1 && cyber.multiplier < 0.11,
    `cyber L1 multiplier should be ~0.104, got ${cyber.multiplier}`);

  const cyberMaster = explainEffectiveness({ domain: "magic", worldId: "test_cyber_5", level: 100, maxLevel: 100 });
  assert.equal(cyberMaster.dominant, "level_floor");
  assert.ok(cyberMaster.note.includes("level") || cyberMaster.note.includes("carries"),
    `master-in-cyber note should mention skill level carrying you, got: ${cyberMaster.note}`);
});

test("effectivenessMultiplier returns NEUTRAL when world is unknown", () => {
  // World never registered — falls through to neutral.
  const m = effectivenessMultiplier({ domain: "magic", worldId: "world_that_doesnt_exist", level: 1 });
  assert.ok(m >= 0.1 && m <= 1.0, `unknown world should give a sane number, got ${m}`);
});
