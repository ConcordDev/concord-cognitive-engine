/**
 * Skill Effectiveness Tests
 *
 * Tests the continuous sigmoid effectiveness curves for skills in worlds:
 *   - getWorldResistance — resistance parameter lookup
 *   - computeEffectiveness — sigmoid curve computation
 *   - evaluateSkillInWorld — world rule multipliers + explanations
 *
 * Run: node --test tests/skill-effectiveness.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getWorldResistance,
  computeEffectiveness,
  evaluateSkillInWorld,
} from "../lib/skill-effectiveness.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeWorld(overrides = {}) {
  return {
    id: "test-world",
    name: "Test World",
    ...overrides,
  };
}

function makeSkill(overrides = {}) {
  return {
    id: "skill_1",
    title: "Swordsmanship",
    skill_level: 50,
    content: JSON.stringify({ domain: "combat", description: "Blade skills" }),
    ...overrides,
  };
}

function makeSkillWithContent(domain, level = 50) {
  return makeSkill({
    skill_level: level,
    content: JSON.stringify({ domain }),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. getWorldResistance
// ═══════════════════════════════════════════════════════════════════════════════

describe("getWorldResistance", () => {
  it("returns default values when no skill_resistance configured", () => {
    const world = makeWorld();
    const resistance = getWorldResistance(world, "combat");
    assert.equal(resistance.threshold, 1);
    assert.equal(resistance.scaling, 1.0);
  });

  it("returns configured values for a known skill type", () => {
    const world = makeWorld({
      rule_modulators: {
        skill_resistance: {
          combat: { threshold: 20, scaling: 2.0 },
        },
      },
    });
    const resistance = getWorldResistance(world, "combat");
    assert.equal(resistance.threshold, 20);
    assert.equal(resistance.scaling, 2.0);
  });

  it("falls back to default for unknown skill type", () => {
    const world = makeWorld({
      rule_modulators: {
        skill_resistance: {
          combat: { threshold: 20, scaling: 2.0 },
        },
      },
    });
    const resistance = getWorldResistance(world, "magic");
    assert.equal(resistance.threshold, 1);
    assert.equal(resistance.scaling, 1.0);
  });

  it("reads from _rules if rule_modulators is absent", () => {
    const world = makeWorld({
      _rules: {
        skill_resistance: {
          stealth: { threshold: 15, scaling: 1.5 },
        },
      },
    });
    const resistance = getWorldResistance(world, "stealth");
    assert.equal(resistance.threshold, 15);
    assert.equal(resistance.scaling, 1.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. computeEffectiveness
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeEffectiveness", () => {
  it("returns below_threshold when skill level < world threshold", () => {
    const skill = makeSkillWithContent("combat", 5);
    const world = makeWorld({
      rule_modulators: {
        skill_resistance: { combat: { threshold: 10, scaling: 1.0 } },
      },
    });
    const result = computeEffectiveness(skill, world);
    assert.equal(result.status, "below_threshold");
    assert.equal(result.effectiveness, 0);
  });

  it("returns functional or mastered when skill level >= threshold", () => {
    const skill = makeSkillWithContent("combat", 50);
    const world = makeWorld();
    const result = computeEffectiveness(skill, world);
    assert.ok(result.status === "functional" || result.status === "mastered");
    assert.ok(result.effectiveness > 0);
  });

  it("effectiveness is between 0 and 1", () => {
    const skill = makeSkillWithContent("combat", 100);
    const world = makeWorld();
    const result = computeEffectiveness(skill, world);
    assert.ok(result.effectiveness >= 0 && result.effectiveness <= 1);
  });

  it("higher skill level produces higher effectiveness", () => {
    const world = makeWorld();
    const low = computeEffectiveness(makeSkillWithContent("combat", 10), world);
    const high = computeEffectiveness(makeSkillWithContent("combat", 200), world);
    assert.ok(high.effectiveness > low.effectiveness, "higher level should be more effective");
  });

  it("returns mastered status when effectiveness >= 0.9", () => {
    // Very high level should reach mastered
    const skill = makeSkillWithContent("combat", 5000);
    const world = makeWorld();
    const result = computeEffectiveness(skill, world);
    assert.equal(result.status, "mastered");
    assert.ok(result.effectiveness >= 0.9);
  });

  it("includes skillLevel and threshold in output", () => {
    const skill = makeSkillWithContent("combat", 30);
    const world = makeWorld({
      rule_modulators: {
        skill_resistance: { combat: { threshold: 5, scaling: 1.0 } },
      },
    });
    const result = computeEffectiveness(skill, world);
    assert.equal(result.skillLevel, 30);
    assert.equal(result.threshold, 5);
  });

  it("handles non-JSON skill content gracefully", () => {
    const skill = makeSkill({
      skill_level: 50,
      content: "raw string content",
    });
    const world = makeWorld();
    // Should not throw — defaults to "default" skill type
    assert.doesNotThrow(() => computeEffectiveness(skill, world));
  });

  it("handles missing skill content gracefully", () => {
    const skill = makeSkill({ skill_level: 50, content: undefined });
    const world = makeWorld();
    assert.doesNotThrow(() => computeEffectiveness(skill, world));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. evaluateSkillInWorld
// ═══════════════════════════════════════════════════════════════════════════════

describe("evaluateSkillInWorld", () => {
  it("returns effectiveness, modifications, and explanation", () => {
    const skill = makeSkillWithContent("combat", 50);
    const world = makeWorld();
    const result = evaluateSkillInWorld(skill, world);

    assert.ok("effectiveness" in result);
    assert.ok("modifications" in result);
    assert.ok("explanation" in result);
    assert.ok(Array.isArray(result.modifications));
    assert.ok(typeof result.explanation === "string");
  });

  it("effectiveness is a number between 0 and 1 for normal skills", () => {
    const skill = makeSkillWithContent("default", 100);
    const world = makeWorld();
    const result = evaluateSkillInWorld(skill, world);
    assert.ok(result.effectiveness >= 0 && result.effectiveness <= 1);
  });

  it("applies world rule multiplier to effectiveness", () => {
    const skill = makeSkillWithContent("combat", 100);
    const worldHalf = makeWorld({
      _rules: {
        skill_effectiveness_rules: {
          combat: { multiplier: 0.5 },
        },
      },
    });
    const worldFull = makeWorld();

    const resultHalf = evaluateSkillInWorld(skill, worldHalf);
    const resultFull = evaluateSkillInWorld(skill, worldFull);

    assert.ok(
      resultHalf.effectiveness < resultFull.effectiveness,
      "0.5x multiplier world should halve effectiveness",
    );
  });

  it("notes multiplier in modifications when non-default", () => {
    const skill = makeSkillWithContent("magic", 100);
    const world = makeWorld({
      _rules: {
        skill_effectiveness_rules: {
          magic: { multiplier: 2.0 },
        },
      },
    });
    const result = evaluateSkillInWorld(skill, world);
    const hasMultiplierNote = result.modifications.some(m => m.includes("×2"));
    assert.ok(hasMultiplierNote, "should note the 2.0x multiplier");
  });

  it("notes threshold violation when skill is below threshold", () => {
    const skill = makeSkillWithContent("combat", 5);
    const world = makeWorld({
      rule_modulators: {
        skill_resistance: { combat: { threshold: 20, scaling: 1.0 } },
      },
    });
    const result = evaluateSkillInWorld(skill, world);
    assert.equal(result.effectiveness, 0);
    const hasThresholdNote = result.modifications.some(m => m.includes("below") || m.includes("threshold"));
    assert.ok(hasThresholdNote, "should note that skill is below threshold");
  });

  it("explanation mentions the world name", () => {
    const skill = makeSkillWithContent("combat", 50);
    const world = makeWorld({ name: "Arcane Realm" });
    const result = evaluateSkillInWorld(skill, world);
    assert.ok(result.explanation.includes("Arcane Realm"), "explanation should mention world name");
  });

  it("explanation mentions percent effectiveness for functional skills", () => {
    const skill = makeSkillWithContent("combat", 50);
    const world = makeWorld({ name: "Test World" });
    const result = evaluateSkillInWorld(skill, world);
    assert.ok(result.explanation.includes("%"), "explanation should include percentage");
  });
});
