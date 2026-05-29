/**
 * WS4 — skill-fusion (MHA engine) contract tests.
 * Pins the Bakugo dynamic: a fused child power is stronger than either parent,
 * elements combine iconically (fire+wind → explosion), gains diminish across
 * generations, inbreeding dilutes, and a deep lineage hits a singularity unlock.
 * Run: node --test tests/skill-fusion.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  combineElements, composeFusedName, fuseTwoSkills, FUSION_DIALS,
} from "../lib/skill-fusion.js";

const fire = { name: "Flame Jet", element: "fire", maxDamage: 20, rangeM: 10 };
const wind = { name: "Gust", element: "wind", maxDamage: 16, rangeM: 14 };

describe("combineElements", () => {
  it("fuses fire + wind into explosion (Bakugo), order-independent", () => {
    assert.equal(combineElements("fire", "wind"), "explosion");
    assert.equal(combineElements("wind", "fire"), "explosion");
  });
  it("same element stays itself; unknown pair falls back to dominant", () => {
    assert.equal(combineElements("fire", "fire"), "fire");
    assert.equal(combineElements("fire", "bio", { dominant: "fire" }), "fire");
  });
});

describe("fuseTwoSkills (Bakugo dynamic)", () => {
  it("child is stronger than the stronger parent", () => {
    const child = fuseTwoSkills(fire, wind, { stability: 1, generation: 1 });
    assert.ok(child.maxDamage > Math.max(fire.maxDamage, wind.maxDamage),
      `fused ${child.maxDamage} should exceed ${Math.max(fire.maxDamage, wind.maxDamage)}`);
    assert.equal(child.element, "explosion");
    assert.ok(child.gain >= FUSION_DIALS.gainMin);
  });

  it("higher stability yields a stronger fusion", () => {
    const stable = fuseTwoSkills(fire, wind, { stability: 1 });
    const shaky = fuseTwoSkills(fire, wind, { stability: 0 });
    assert.ok(stable.maxDamage > shaky.maxDamage);
    // even a shaky fusion still beats the stronger parent (gainMin > 1)
    assert.ok(shaky.maxDamage > Math.max(fire.maxDamage, wind.maxDamage));
  });

  it("gain diminishes across generations", () => {
    const g1 = fuseTwoSkills(fire, wind, { stability: 1, generation: 1 });
    const g5 = fuseTwoSkills(fire, wind, { stability: 1, generation: 5 });
    assert.ok(g5.gain < g1.gain, "later generations gain less");
    assert.ok(g5.maxDamage <= g1.maxDamage);
  });

  it("inbreeding dilutes the fusion", () => {
    const out = fuseTwoSkills(fire, wind, { stability: 1, inbred: false });
    const inbred = fuseTwoSkills(fire, wind, { stability: 1, inbred: true });
    assert.ok(inbred.maxDamage < out.maxDamage);
  });

  it("deep lineage unlocks a singularity surge", () => {
    const pre = fuseTwoSkills(fire, wind, { stability: 1, generation: FUSION_DIALS.singularityGen - 1 });
    const sing = fuseTwoSkills(fire, wind, { stability: 1, generation: FUSION_DIALS.singularityGen });
    assert.equal(pre.unlockedHidden, false);
    assert.equal(sing.unlockedHidden, true);
    // the singularity bonus offsets generation decay enough to spike the gain
    assert.ok(sing.gain > pre.gain);
  });

  it("composeFusedName is deterministic and themed", () => {
    const n1 = composeFusedName("Flame Jet", "Gust", "explosion", "x");
    const n2 = composeFusedName("Flame Jet", "Gust", "explosion", "x");
    assert.equal(n1, n2);
    assert.ok(["Detonation", "Blastcore"].includes(n1));
  });
});
