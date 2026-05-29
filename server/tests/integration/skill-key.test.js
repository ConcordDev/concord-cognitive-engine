/**
 * T3.1 — skillKeyForSkill resolution (combat payload → SKILL_CATALOG key).
 *
 * Run: node --test tests/integration/skill-key.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { skillKeyForSkill } from "../../lib/skills/skill-key.js";

describe("T3.1 — skillKeyForSkill", () => {
  it("maps elements to elemental_<x>", () => {
    assert.equal(skillKeyForSkill({ element: "fire" }), "elemental_fire");
    assert.equal(skillKeyForSkill({ element: "frost" }), "elemental_ice");
    assert.equal(skillKeyForSkill({ element: "storm" }), "elemental_lightning");
    assert.equal(skillKeyForSkill({ element: "bio" }), "elemental_poison");
  });

  it("element wins over weapon", () => {
    assert.equal(skillKeyForSkill({ element: "fire", weapon: "sword" }), "elemental_fire");
  });

  it("maps weapons to martial keys", () => {
    assert.equal(skillKeyForSkill({ weapon: "longsword" }), "swords");
    assert.equal(skillKeyForSkill({ kind: "spear" }), "spears");
    assert.equal(skillKeyForSkill({ weapon: "quarterstaff" }), "staves");
    assert.equal(skillKeyForSkill({ weapon: "recurve bow" }), "archery");
    assert.equal(skillKeyForSkill({ weapon: "pistol" }), "ranged_pistol");
    assert.equal(skillKeyForSkill({ weapon: "rifle" }), "ranged_rifle");
  });

  it("honours an explicit catalog skill_type", () => {
    assert.equal(skillKeyForSkill({ skill_type: "agility" }), "agility");
    assert.equal(skillKeyForSkill({ skill_type: "strength" }), "strength");
  });

  it("falls back to fists for physical/unknown", () => {
    assert.equal(skillKeyForSkill({ element: "physical" }), "fists");
    assert.equal(skillKeyForSkill({}), "fists");
    assert.equal(skillKeyForSkill(null), "fists");
    assert.equal(skillKeyForSkill({ element: "none", weapon: "spork" }), "fists");
  });
});
