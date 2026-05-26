// server/tests/combat-taxonomies.test.js
//
// Pins the spell / power / skill / element taxonomy contract. Sibling to
// weapon-loadout-classes.test.js. The same load-bearing concern: a refactor
// could silently drop player vocabulary, stranding emergent abilities at
// classification=null. This test ensures the named archetypes resolve
// AND the amorphous escape hatch always works so players can invent.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ELEMENT_INFO, SPELL_SCHOOL_INFO, POWER_TYPE_INFO, SKILL_TYPE_INFO,
  inferElement, inferSpellSchool, inferPowerType, inferSkillType,
  getElementInfo, getSpellSchoolInfo, getPowerTypeInfo, getSkillTypeInfo,
} from "../lib/combat/taxonomies.js";

describe("inferElement — core elements", () => {
  const cases = [
    ["fireball",            "fire"],
    ["inferno blast",       "fire"],
    ["frost spike",         "ice"],
    ["cryomancy",           "ice"],
    ["thunderstorm",        "lightning"],
    ["electric burst",      "lightning"],
    ["aqua jet",            "water"],
    ["earthquake",          "earth"],
    ["stone wall",          "earth"],
    ["air slash",           "wind"],
    ["gale force",          "wind"],
    ["iron skin",           "metal"],
    ["verdant growth",      "wood"],
    ["divine smite",        "holy"],
    ["radiant beam",        "light"],
    ["umbral grasp",        "dark"],
    ["shadow strike",       "shadow"],
    ["void rift",           "void"],
    ["kinetic punch",       "physical"],
    ["telekinetic push",    "force"],
    ["gravitic crush",      "gravity"],
    ["sonic boom",          "sonic"],
    ["nature wrath",        "bio"],
    ["toxic cloud",         "poison"],
    ["blood pact",          "blood"],
    ["quantum lance",       "energy"],
    ["gamma blast",         "radiation"],
    ["arcane missile",      "arcane"],
    ["mental spike",        "psychic"],
    ["chrono freeze",       "time"],
    ["spatial rift",        "space"],
    ["refusal mark",        "refusal"],
  ];
  for (const [name, expected] of cases) {
    it(`"${name}" → ${expected}`, () => {
      assert.equal(inferElement(name).element, expected);
    });
  }
});

describe("inferElement — compound elements + amorphous", () => {
  it("electric frost → ice (compound, dominant element wins)", () => {
    assert.equal(inferElement("electric frost").element, "ice");
  });
  it("blood fire → blood (compound)", () => {
    assert.equal(inferElement("blood fire").element, "blood");
  });
  it("meta.amorphous=true → amorphous regardless of name", () => {
    assert.equal(inferElement("fireball", { amorphous: true }).element, "amorphous");
  });
  it("unknown name returns null", () => {
    assert.equal(inferElement("xyzzy").element, null);
  });
  it("amorphous keyword in name routes through", () => {
    assert.equal(inferElement("amorphous wave").element, "amorphous");
    assert.equal(inferElement("elementless surge").element, "amorphous");
  });
});

describe("inferSpellSchool — D&D 8 schools + extras", () => {
  const cases = [
    ["evoke beam",          "evocation"],
    ["fire bolt",           "evocation"],
    ["arcane missile",      "evocation"],
    ["conjure familiar",    "conjuration"],
    ["summon elemental",    "conjuration"],
    ["teleport",            "conjuration"],
    ["mirror image",        "illusion"],
    ["invisibility",        "illusion"],
    ["charm person",        "enchantment"],
    ["dominate beast",      "enchantment"],
    ["scry",                "divination"],
    ["augur",               "divination"],
    ["necromantic touch",   "necromancy"],
    ["raise dead",          "necromancy"],
    ["drain life",          "necromancy"],
    ["polymorph self",      "transmutation"],
    ["abjuration ward",     "abjuration"],
    ["dispel magic",        "abjuration"],
    ["protect from evil",   "abjuration"],
    ["chi strike",          "martial"],
    ["rune ward",           "runic"],
    ["dragon breath",       "draconic"],
    ["blood pact",          "blood"],
    ["sanguine offering",   "blood"],
    ["ancestor call",       "spirit"],
    ["wild surge",          "wild"],
    ["chaos bolt",          "wild"],
    ["ritual circle cast",  "ritual"],
    ["psionic blast",       "psionic"],
    ["mind blast",          "psionic"],
  ];
  for (const [name, expected] of cases) {
    it(`"${name}" → ${expected}`, () => {
      assert.equal(inferSpellSchool(name).school, expected);
    });
  }
});

describe("inferSpellSchool — amorphous + unknown", () => {
  it("meta.amorphous=true overrides name match", () => {
    assert.equal(inferSpellSchool("fire bolt", { amorphous: true }).school, "amorphous");
  });
  it("unknown spell name returns null", () => {
    assert.equal(inferSpellSchool("xyzzy").school, null);
  });
});

describe("inferPowerType — superhero archetypes", () => {
  const cases = [
    ["superhero flight",    "flight"],
    ["hover ability",       "flight"],
    ["super speed",         "super_speed"],
    ["speedster",           "super_speed"],
    ["teleportation",       "teleport"],
    ["blink",               "teleport"],
    ["phase walking",       "phasing"],
    ["intangibility",       "intangibility"],
    ["super strength",      "super_strength"],
    ["herculean might",     "super_strength"],
    ["iron skin",           "super_durability"],
    ["regeneration",        "regeneration"],
    ["invulnerability",     "invulnerability"],
    ["telepathy",           "telepathy"],
    ["telekinesis",         "telekinesis"],
    ["mind control",        "mind_control"],
    ["precognition",        "precognition"],
    ["shapeshifting",       "shapeshifting"],
    ["size alter",          "size_alter"],
    ["duplication",         "duplication"],
    ["invisibility",        "invisibility"],
    ["x-ray vision",        "enhanced_senses"],
    ["heat vision",         "enhanced_senses"],
    ["elemental control",   "elemental_control"],
    ["energy projection",   "energy_projection"],
    ["optic blast",         "energy_projection"],
    ["healing touch",       "healing_touch"],
    ["time stop",           "time_control"],
    ["reality warp",        "reality_warp"],
    ["cosmic awareness",    "reality_warp"],
  ];
  for (const [name, expected] of cases) {
    it(`"${name}" → ${expected}`, () => {
      assert.equal(inferPowerType(name).power, expected);
    });
  }
});

describe("inferPowerType — amorphous escape", () => {
  it("meta.amorphous=true returns amorphous", () => {
    assert.equal(inferPowerType("superhero flight", { amorphous: true }).power, "amorphous");
  });
  it("invented power with no matching keyword → null", () => {
    assert.equal(inferPowerType("solar phase weave").power, null);
  });
  it("invented power can still be persisted via meta.amorphous", () => {
    const r = inferPowerType("solar phase weave", { amorphous: true });
    assert.equal(r.power, "amorphous");
    assert.equal(r.category, "amorphous");
  });
});

describe("inferSkillType — skill categories", () => {
  const cases = [
    ["combat training",     "combat"],
    ["swordsmanship",       "combat"],
    ["gunnery",             "combat"],
    ["parkour",             "movement"],
    ["climbing",            "movement"],
    ["swim",                "movement"],
    ["smithing",            "crafting"],
    ["alchemy",             "crafting"],
    ["cooking",             "crafting"],
    ["persuasion",          "social"],
    ["intimidation",        "social"],
    ["barter",              "social"],
    ["observation",         "perception"],
    ["tracking",            "perception"],
    ["deduction",           "perception"],
    ["wilderness survival", "survival"],
    ["foraging",            "survival"],
    ["spellcraft",          "magical"],
    ["sorcery",             "magical"],
    ["meditation",          "mental"],
    ["concentration",       "mental"],
    ["singing",             "performance"],
    ["instrument",          "performance"],
    ["hacking",             "technical"],
    ["lockpicking",         "technical"],
  ];
  for (const [name, expected] of cases) {
    it(`"${name}" → ${expected}`, () => {
      assert.equal(inferSkillType(name).skill, expected);
    });
  }
});

describe("inferSkillType — amorphous + unknown", () => {
  it("meta.amorphous=true overrides", () => {
    assert.equal(inferSkillType("combat training", { amorphous: true }).skill, "amorphous");
  });
  it("invented skill returns null without meta", () => {
    assert.equal(inferSkillType("dimensional folding").skill, null);
  });
});

describe("Registry coverage", () => {
  it("ELEMENT_INFO has every key emitted by inferElement", () => {
    const emitters = [
      "fire", "water", "earth", "wind", "ice", "lightning", "metal", "wood",
      "holy", "light", "dark", "shadow", "void",
      "physical", "force", "gravity", "sonic",
      "bio", "poison", "blood",
      "energy", "radiation", "arcane",
      "psychic", "time", "space", "refusal", "amorphous",
    ];
    for (const k of emitters) assert.ok(ELEMENT_INFO[k], `missing ELEMENT_INFO["${k}"]`);
  });

  it("SPELL_SCHOOL_INFO has every key emitted by inferSpellSchool", () => {
    const emitters = [
      "evocation", "conjuration", "illusion", "enchantment",
      "divination", "necromancy", "transmutation", "abjuration",
      "martial", "runic", "draconic", "blood", "spirit", "wild",
      "ritual", "psionic", "amorphous",
    ];
    for (const k of emitters) assert.ok(SPELL_SCHOOL_INFO[k], `missing SPELL_SCHOOL_INFO["${k}"]`);
  });

  it("POWER_TYPE_INFO has every key emitted by inferPowerType", () => {
    const emitters = [
      "flight", "super_speed", "teleport", "phasing", "intangibility",
      "super_strength", "super_durability", "regeneration", "invulnerability",
      "telepathy", "telekinesis", "mind_control", "precognition",
      "shapeshifting", "size_alter", "duplication",
      "invisibility", "enhanced_senses",
      "elemental_control", "energy_projection", "healing_touch",
      "time_control", "reality_warp", "amorphous",
    ];
    for (const k of emitters) assert.ok(POWER_TYPE_INFO[k], `missing POWER_TYPE_INFO["${k}"]`);
  });

  it("SKILL_TYPE_INFO has every key emitted by inferSkillType", () => {
    const emitters = [
      "combat", "movement", "crafting", "social", "perception",
      "survival", "magical", "mental", "performance", "technical",
      "amorphous",
    ];
    for (const k of emitters) assert.ok(SKILL_TYPE_INFO[k], `missing SKILL_TYPE_INFO["${k}"]`);
  });

  it("every registry has an explicit amorphous escape hatch", () => {
    assert.ok(ELEMENT_INFO.amorphous?.amorphous);
    assert.ok(SPELL_SCHOOL_INFO.amorphous?.amorphous);
    assert.ok(POWER_TYPE_INFO.amorphous?.amorphous);
    assert.ok(SKILL_TYPE_INFO.amorphous?.amorphous);
  });
});

describe("get*Info accessors", () => {
  it("return metadata for known keys", () => {
    assert.equal(getElementInfo("fire").category, "classical");
    assert.equal(getSpellSchoolInfo("evocation").intent.includes("energy"), true);
    assert.equal(getPowerTypeInfo("flight").category, "movement");
    assert.equal(getSkillTypeInfo("combat").trainable, true);
  });
  it("return null for unknown / null / empty keys", () => {
    assert.equal(getElementInfo(""), null);
    assert.equal(getElementInfo(null), null);
    assert.equal(getElementInfo("nonsense"), null);
    assert.equal(getSpellSchoolInfo("nonsense"), null);
    assert.equal(getPowerTypeInfo("nonsense"), null);
    assert.equal(getSkillTypeInfo("nonsense"), null);
  });
});
