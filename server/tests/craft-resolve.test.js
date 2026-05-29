/**
 * Living Society — Phase 0: craft-resolve contract test.
 *
 * Pins the deterministic resolve math: potency rises with input potency/skill/
 * station/power-fuel; conflicting affinities lower stability → backfire; the
 * potency floor gates god-tier; failure is soft (debuff, never throw); same
 * inputs → same result. No RNG in the resolution path.
 *
 * Run: node --test tests/craft-resolve.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveCraft } from "../lib/craft-resolve.js";

describe("Phase 0 — resolveCraft", () => {
  it("rejects empty inputs", () => {
    assert.equal(resolveCraft({ inputs: [] }).ok, false);
  });

  it("is deterministic for the same inputs", () => {
    const a = resolveCraft({ inputs: ["iron_ingot", "iron_ingot"], playerSkill: 40, stationQuality: 30 });
    const b = resolveCraft({ inputs: ["iron_ingot", "iron_ingot"], playerSkill: 40, stationQuality: 30 });
    assert.deepEqual(a, b);
  });

  it("higher-tier mats + skill + station yield higher output potency", () => {
    const basic = resolveCraft({ inputs: ["wood", "stone"], playerSkill: 10, stationQuality: 0, seed: "s" });
    const grand = resolveCraft({ inputs: ["dragonbone", "grand_soul_gem"], playerSkill: 90, stationQuality: 90, seed: "s" });
    assert.ok(grand.outputPotency > basic.outputPotency, `${grand.outputPotency} !> ${basic.outputPotency}`);
  });

  it("a magical power source (fuel) raises potency vs the same craft without it", () => {
    const noFuel = resolveCraft({ inputs: ["gemstone", "gemstone"], playerSkill: 50, stationQuality: 50, seed: "s" });
    const withFuel = resolveCraft({ inputs: ["gemstone", "grand_soul_gem"], playerSkill: 50, stationQuality: 50, seed: "s" });
    assert.ok(withFuel.outputPotency > noFuel.outputPotency);
  });

  it("dominant affinity cascades from the highest-potency input affinity", () => {
    // crystal (magic, potency 52) dominates wood (physical, 8)
    const r = resolveCraft({ inputs: ["crystal", "wood"], playerSkill: 0, stationQuality: 0, seed: "s" });
    assert.equal(r.outputAffinity, "magic");
  });

  it("conflicting affinities lower stability (Concordia twist on BotW cancel)", () => {
    const pure = resolveCraft({ inputs: ["iron_ingot", "steel_ingot"], seed: "x" });       // both physical
    const mixed = resolveCraft({ inputs: ["iron_ingot", "crystal", "essence_chaos"], seed: "x" }); // 3 affinities
    assert.ok(mixed.outputStability < pure.outputStability, `${mixed.outputStability} !< ${pure.outputStability}`);
  });

  it("high instability → a backfire is possible and is SOFT (debuff, never throws)", () => {
    // black_soul_gem (stability 30, chaos) + essence_chaos → very unstable; try seeds until one backfires
    let sawBackfire = false;
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const r = resolveCraft({ inputs: ["black_soul_gem", "essence_chaos"], risk: 1, seed });
      assert.equal(r.ok, true); // soft — always ok:true, never throws
      if (r.failed) { sawBackfire = true; assert.ok(r.debuff && r.debuff.magnitude > 0); }
    }
    assert.ok(sawBackfire, "expected at least one backfire across seeds for a highly unstable craft");
  });

  it("the potency floor gates god-tier output behind strong mats (soft fizzle)", () => {
    const r = resolveCraft({ inputs: ["wood", "stone"], recipe: { minPotency: 80 }, playerSkill: 0, stationQuality: 0, seed: "s" });
    assert.equal(r.failed, true);
    assert.equal(r.reason, "potency_floor_not_met");
    // a strong recipe meets the same floor
    const r2 = resolveCraft({ inputs: ["dragonbone", "grand_soul_gem"], recipe: { minPotency: 80 }, playerSkill: 90, stationQuality: 90, seed: "s" });
    assert.equal(r2.failed, false);
  });

  it("maps output potency to the executeCraft qualityMultiplier range [0.5, 2.0]", () => {
    const r = resolveCraft({ inputs: ["iron_ingot"], playerSkill: 50, stationQuality: 50, seed: "s" });
    assert.ok(r.qualityMultiplier >= 0.5 && r.qualityMultiplier <= 2.0);
  });
});
