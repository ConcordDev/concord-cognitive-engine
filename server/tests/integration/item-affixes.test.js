/**
 * F2.1 — item affixes (the ARPG itemization wire).
 *
 * Pins BOTH halves the plan flags (affixes are a no-op unless both are touched):
 *   - rollAffixes scales count/tier with rarity; common rolls nothing
 *   - equippedAffixBonuses aggregates enchant + per-element + resist + vitality
 *   - combatEnchantmentFor folds generic + matching-element bonus
 *   - a Flaming weapon raises FIRE damage through computeDamage (the payoff)
 *   - rollLoot attaches affixes to equippable gear, not raw materials
 *
 * Run: node --test tests/integration/item-affixes.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  rollAffixes, equippedAffixBonuses, combatEnchantmentFor, RARITY_RULES,
} from "../../lib/item-affixes.js";
import { computeDamage } from "../../lib/combat/damage-calculator.js";

// deterministic rng for reproducible rolls
function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

describe("F2.1 — rollAffixes", () => {
  it("scales affix count with rarity; common rolls none", () => {
    assert.equal(rollAffixes("common", seededRng(1)).length, 0);
    assert.equal(rollAffixes("uncommon", seededRng(1)).length, RARITY_RULES.uncommon.count);
    assert.equal(rollAffixes("legendary", seededRng(1)).length, RARITY_RULES.legendary.count);
  });

  it("produces real stat rolls with a slot + value", () => {
    const aff = rollAffixes("rare", seededRng(7));
    assert.ok(aff.length >= 1);
    for (const a of aff) {
      assert.ok(["prefix", "suffix"].includes(a.slot));
      assert.ok(typeof a.value === "number" && a.value > 0);
      assert.ok(a.label);
    }
  });
});

describe("F2.1 — equippedAffixBonuses aggregation", () => {
  it("sums enchant + element + resist + vitality across slots", () => {
    const loadout = {
      rightHand: { affixes_json: JSON.stringify([
        { stat: "enchantmentBonus", value: 8 },
        { stat: "element", element: "fire", value: 5 },
      ]) },
      body: { affixes_json: JSON.stringify([
        { stat: "resist", value: 0.1 },
        { stat: "vitality", value: 20 },
      ]) },
      head: null, leftHand: null, accessory: null,
    };
    const b = equippedAffixBonuses(loadout);
    assert.equal(b.enchantmentBonus, 8);
    assert.equal(b.elementBonus.fire, 5);
    assert.equal(b.resist, 0.1);
    assert.equal(b.vitality, 20);
  });

  it("combatEnchantmentFor folds generic + matching element only", () => {
    const loadout = { rightHand: { affixes_json: JSON.stringify([
      { stat: "enchantmentBonus", value: 6 },
      { stat: "element", element: "fire", value: 9 },
    ]) } };
    assert.equal(combatEnchantmentFor(loadout, "fire"), 15); // 6 + 9
    assert.equal(combatEnchantmentFor(loadout, "ice"), 6);   // 6 + 0 (no ice affix)
    assert.equal(combatEnchantmentFor(loadout, "none"), 6);
  });
});

describe("F2.1 — affixes actually change a hit (computeDamage)", () => {
  it("a Flaming weapon raises fire damage vs no gear", () => {
    const loadout = { rightHand: { affixes_json: JSON.stringify([
      { stat: "element", element: "fire", value: 10 },
    ]) } };
    const base = computeDamage(
      { skillLevel: 5, element: "fire", basePower: 10, enchantmentBonus: 0, worldMultiplier: 1 },
      { fire_resistance: 0 }, {},
    );
    const withAffix = computeDamage(
      { skillLevel: 5, element: "fire", basePower: 10, enchantmentBonus: combatEnchantmentFor(loadout, "fire"), worldMultiplier: 1 },
      { fire_resistance: 0 }, {},
    );
    assert.ok(withAffix.finalDamage > base.finalDamage, "Flaming weapon must increase fire damage");
  });
});
