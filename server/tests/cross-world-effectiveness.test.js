/**
 * Tests for cross-world skill effectiveness multipliers.
 *
 * The formula:
 *   floor      = 0.10 + 0.40 × min(1, level / maxLevel)
 *   affinity   = world.skill_affinity[domain] ?? .default ?? NEUTRAL[domain] ?? 0.7
 *   multiplier = max(floor, affinity)
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  registerWorldMeta,
  getWorldMeta,
  listKnownWorlds,
  effectivenessMultiplier,
  scaleByEffectiveness,
  explainEffectiveness,
} from "../lib/cross-world-effectiveness.js";

// The registry is module-level. Each test re-registers fresh metas; we
// intentionally don't expect a pristine slate between describe blocks.

describe("registerWorldMeta + getWorldMeta", () => {
  it("registers and retrieves a world by id", () => {
    registerWorldMeta({ world_id: "test_world_a", name: "A" });
    const got = getWorldMeta("test_world_a");
    assert.equal(got?.name, "A");
  });

  it("ignores meta without a world_id", () => {
    const before = listKnownWorlds().length;
    registerWorldMeta({ name: "no id" });
    assert.equal(listKnownWorlds().length, before);
  });
});

describe("effectivenessMultiplier", () => {
  beforeEach(() => {
    registerWorldMeta({
      world_id: "test_fantasy",
      skill_affinity: { magic: 1.0, swordsmanship: 0.95, hacking: 0.05, default: 0.4 },
    });
    registerWorldMeta({
      world_id: "test_cyber",
      skill_affinity: { hacking: 1.0, magic: 0.05, default: 0.5 },
    });
  });

  it("returns the world affinity when it dominates the floor", () => {
    const m = effectivenessMultiplier({ domain: "magic", worldId: "test_fantasy", level: 1 });
    assert.equal(m, 1.0);
  });

  it("returns the level floor when it dominates a weak affinity", () => {
    // Level 100 floor = 0.10 + 0.40 × 1.0 = 0.50; affinity hacking@fantasy = 0.05 → floor wins
    const m = effectivenessMultiplier({ domain: "hacking", worldId: "test_fantasy", level: 100, maxLevel: 100 });
    assert.equal(m, 0.5);
  });

  it("at level 1, floor is 0.10 + 0.40/100 ≈ 0.104, so weak affinities still bottom around 0.10", () => {
    const m = effectivenessMultiplier({ domain: "hacking", worldId: "test_fantasy", level: 1, maxLevel: 100 });
    assert.ok(m >= 0.104 - 1e-9 && m <= 0.105 + 1e-9, `got ${m}`);
  });

  it("falls back to default affinity, then NEUTRAL_AFFINITY", () => {
    const m = effectivenessMultiplier({ domain: "totally_unknown_skill", worldId: "test_fantasy", level: 1 });
    // default for test_fantasy = 0.4; floor at level 1 ≈ 0.104 → 0.4 wins
    assert.equal(m, 0.4);
  });

  it("scaleByEffectiveness multiplies the base value by the multiplier", () => {
    const base = 50;
    const scaled = scaleByEffectiveness(base, { domain: "magic", worldId: "test_fantasy", level: 1 });
    assert.equal(scaled, 50 * 1.0);
  });
});

describe("explainEffectiveness", () => {
  beforeEach(() => {
    registerWorldMeta({
      world_id: "test_explain",
      skill_affinity: { magic: 1.0, hacking: 0.05, default: 0.5 },
    });
  });

  it("identifies world_affinity as dominant when affinity > floor", () => {
    const r = explainEffectiveness({ domain: "magic", worldId: "test_explain", level: 1 });
    assert.equal(r.dominant, "world_affinity");
    assert.equal(r.multiplier, 1.0);
  });

  it("identifies level_floor as dominant when floor > affinity", () => {
    const r = explainEffectiveness({ domain: "hacking", worldId: "test_explain", level: 100, maxLevel: 100 });
    assert.equal(r.dominant, "level_floor");
    assert.equal(r.multiplier, 0.5);
  });

  it("returns a human-readable note for both dominants", () => {
    const a = explainEffectiveness({ domain: "magic", worldId: "test_explain", level: 1 });
    const b = explainEffectiveness({ domain: "hacking", worldId: "test_explain", level: 100, maxLevel: 100 });
    assert.ok(typeof a.note === "string" && a.note.length > 0);
    assert.ok(typeof b.note === "string" && b.note.length > 0);
  });
});
