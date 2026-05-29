/**
 * F2.2 — set bonuses (theme-based, builds on F2.1 affixes).
 *
 * Pins:
 *   - setIdForAffixes maps a dominant affix theme → a set id
 *   - 2+ themed pieces grant the 2pc bonus; 4+ stacks the 4pc bonus
 *   - <2 pieces grant nothing
 *   - setDamageFor folds the set's matching-element / melee multiplier
 *
 * Run: node --test tests/integration/item-sets.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  setIdForAffixes, getEquipmentSetBonuses, setDamageFor,
} from "../../lib/item-sets.js";

function piece(setId) { return { set_id: setId, affixes_json: "[]" }; }

describe("F2.2 — setIdForAffixes", () => {
  it("maps elemental affixes to elemental sets", () => {
    assert.equal(setIdForAffixes([{ id: "flaming", element: "fire", value: 5 }]), "emberforged");
    assert.equal(setIdForAffixes([{ id: "frozen", element: "ice", value: 5 }]), "rimewardens");
    assert.equal(setIdForAffixes([{ id: "shocking", element: "lightning", value: 5 }]), "stormcallers");
  });
  it("maps might affixes to ironclad", () => {
    assert.equal(setIdForAffixes([{ id: "brutal", value: 5 }]), "ironclad");
  });
  it("returns null for no affixes", () => {
    assert.equal(setIdForAffixes([]), null);
  });
});

describe("F2.2 — getEquipmentSetBonuses thresholds", () => {
  it("grants nothing with 1 piece", () => {
    const b = getEquipmentSetBonuses({ rightHand: piece("emberforged") });
    assert.equal(b.activeSets.length, 0);
    assert.equal(b.resist, 0);
  });

  it("2 pieces grants the 2pc bonus", () => {
    const b = getEquipmentSetBonuses({ rightHand: piece("emberforged"), body: piece("emberforged") });
    assert.equal(b.resist, 0.05);
    assert.ok(b.activeSets.some((s) => s.setId === "emberforged" && s.threshold === 2));
    assert.equal(b.elementDamagePct.fire || 0, 0); // 4pc not met
  });

  it("4 pieces stacks the 4pc bonus", () => {
    const b = getEquipmentSetBonuses({
      rightHand: piece("emberforged"), leftHand: piece("emberforged"),
      head: piece("emberforged"), body: piece("emberforged"),
    });
    assert.equal(b.resist, 0.05);                 // 2pc
    assert.equal(b.elementDamagePct.fire, 0.10);  // 4pc
    assert.equal(b.activeSets.length, 2);         // both thresholds active
  });
});

describe("F2.2 — setDamageFor", () => {
  it("4pc Emberforged multiplies fire damage, not ice", () => {
    const loadout = {
      rightHand: piece("emberforged"), leftHand: piece("emberforged"),
      head: piece("emberforged"), body: piece("emberforged"),
    };
    assert.ok(Math.abs(setDamageFor(loadout, "fire").multiplier - 1.10) < 0.001);
    assert.equal(setDamageFor(loadout, "ice").multiplier, 1.0);
  });

  it("Ironclad multiplies melee for any element", () => {
    const loadout = {
      rightHand: piece("ironclad"), body: piece("ironclad"),
      head: piece("ironclad"), leftHand: piece("ironclad"),
    };
    // 2pc 0.06 + 4pc 0.14 = 0.20 melee
    assert.ok(Math.abs(setDamageFor(loadout, "none").multiplier - 1.20) < 0.001);
  });
});
