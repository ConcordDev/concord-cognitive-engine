// server/tests/weapon-loadout-classes.test.js
//
// Pins the weapon-class registry. The 2026-05-26 expansion grew the regex
// table from 10 patterns to ~60 across 12 categories and added amorphous-
// weapon support. Without this contract, a future "let me clean up the
// regex list" refactor could silently re-strand player items at
// weapon_class=null, breaking flow-engine tag emission + combat-netcode
// reach validation + NPC archetype matching.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inferWeaponClass,
  getWeaponClassInfo,
  WEAPON_CLASS_INFO,
} from "../lib/combat/loadout.js";

describe("inferWeaponClass — firearms", () => {
  const cases = [
    ["heavy pistol",        "pistol"],
    ["heavy revolver",      "pistol"],   // "revolver" caught by pistol pattern (matches sidearm/gun set)
    ["military sidearm",    "pistol"],
    ["Mossberg shotgun",    "shotgun"],
    ["pump-action",         "shotgun"],
    ["sniper rifle",        "sniper"],   // sniper rule wins before rifle
    ["assault rifle",       "rifle"],
    ["battle rifle",        "rifle"],
    ["energy rifle",        "energy_rifle"],
    ["laser rifle",         "energy_rifle"],
    ["plasma cannon",       "plasma"],
    ["railgun",             "railgun"],
    ["rail gun",            "railgun"],
    ["bolter",              "bolter"],
    ["flamethrower",        "flamethrower"],
    ["SMG",                 "smg"],
    ["uzi",                 "smg"],
    ["heavy machine gun",   "lmg"],
    ["hand cannon",         "hand_cannon"],
    ["blunderbuss",         "blunderbuss"],
    ["musket",              "blunderbuss"],
  ];
  for (const [name, expected] of cases) {
    it(`"${name}" → ${expected}`, () => {
      assert.equal(inferWeaponClass(name).weaponClass, expected);
    });
  }
});

describe("inferWeaponClass — projectile / physics", () => {
  const cases = [
    ["longbow",            "longbow"],
    ["shortbow",           "shortbow"],
    ["heavy crossbow",     "crossbow"],
    ["arbalest",           "crossbow"],
    ["wooden bow",         "bow"],
    ["sling",              "sling"],
    ["blowgun",            "blowgun"],
    ["javelin",            "javelin"],
    ["whaling harpoon",    "harpoon"],
    ["boomerang",          "boomerang"],
    ["chakram",            "boomerang"],
    ["throwing knife",     "thrown"],
    ["throwing axe",       "thrown"],
    ["shuriken",           "thrown"],
  ];
  for (const [name, expected] of cases) {
    it(`"${name}" → ${expected}`, () => {
      assert.equal(inferWeaponClass(name).weaponClass, expected);
    });
  }
});

describe("inferWeaponClass — melee blades & polearms", () => {
  const cases = [
    ["scythe",             "scythe"],
    ["war scythe",         "scythe"],
    ["greatsword",         "greatsword"],
    ["claymore",           "greatsword"],
    ["zweihander",         "greatsword"],
    ["greataxe",           "greataxe"],
    ["halberd",            "halberd"],
    ["poleaxe",            "halberd"],
    ["glaive",             "glaive"],
    ["naginata",           "naginata"],
    ["spear",              "spear"],
    ["lance",              "lance"],
    ["pike",               "pike"],
    ["trident",            "trident"],
    ["quarterstaff",       "quarterstaff"],
    ["bo staff",           "quarterstaff"],
    ["katana",             "katana"],
    ["wakizashi",          "katana"],
    ["rapier",             "rapier"],
    ["scimitar",           "saber"],
    ["dagger",             "dagger"],
    ["stiletto",           "dagger"],
    ["machete",            "machete"],
    ["kukri",              "kukri"],
    ["hatchet",            "hatchet"],
    ["tomahawk",           "tomahawk"],
    ["cutlass",            "cutlass"],
    ["longsword",          "sword"],   // generic sword pattern wins after longbow has its own rule
    ["gladius",            "sword"],
  ];
  for (const [name, expected] of cases) {
    it(`"${name}" → ${expected}`, () => {
      assert.equal(inferWeaponClass(name).weaponClass, expected);
    });
  }
});

describe("inferWeaponClass — blunt / exotic / fist", () => {
  const cases = [
    ["warhammer",          "maul"],     // warhammer routes through maul (heavier weapon)
    ["sledgehammer",       "maul"],
    ["small hammer",       "hammer"],
    ["mace",               "mace"],
    ["cudgel",             "mace"],
    ["flail",              "flail"],
    ["morningstar",        "flail"],
    ["club",               "club"],
    ["whip",               "whip"],
    ["spiked chain",       "chain"],
    ["kusarigama",         "kusarigama"],
    ["nunchaku",           "nunchaku"],
    ["tonfa",              "tonfa"],
    ["sai",                "sai"],
    ["kama",               "kama"],
    ["war fan",            "fan"],
    ["tessen",             "fan"],
    ["gauntlet",           "gauntlet"],
    ["claw",               "claw"],
    ["brass knuckles",     "knuckles"],
    ["cestus",             "knuckles"],
  ];
  for (const [name, expected] of cases) {
    it(`"${name}" → ${expected}`, () => {
      assert.equal(inferWeaponClass(name).weaponClass, expected);
    });
  }
});

describe("inferWeaponClass — focus / spell catalysts", () => {
  const cases = [
    ["wand",               "wand"],
    ["wooden wand",        "wand"],
    ["rod",                "rod"],
    ["wizard staff",       "staff"],
    ["scepter",            "scepter"],
    ["sceptre",            "scepter"],
    ["orb",                "orb"],
    ["talisman",           "talisman"],
    ["grimoire",           "grimoire"],
    ["spellbook",          "grimoire"],
    ["focusing crystal",   "crystal"],
  ];
  for (const [name, expected] of cases) {
    it(`"${name}" → ${expected}`, () => {
      assert.equal(inferWeaponClass(name).weaponClass, expected);
    });
  }
});

describe("inferWeaponClass — shields", () => {
  const cases = [
    ["shield",             "shield"],
    ["aegis",              "shield"],
    ["buckler",            "buckler"],
    ["bulwark",            "bulwark"],
    ["tower shield",       "tower_shield"],
    ["kite shield",        "tower_shield"],
  ];
  for (const [name, expected] of cases) {
    it(`"${name}" → ${expected}`, () => {
      const r = inferWeaponClass(name);
      assert.equal(r.weaponClass, expected);
      assert.equal(r.handedness, "left", "shields always left-hand");
    });
  }
});

describe("inferWeaponClass — handedness contract", () => {
  it("scythe is two-handed", () => {
    assert.equal(inferWeaponClass("scythe").handedness, "two");
  });
  it("shotgun is two-handed", () => {
    assert.equal(inferWeaponClass("shotgun").handedness, "two");
  });
  it("staff is two-handed", () => {
    assert.equal(inferWeaponClass("staff").handedness, "two");
  });
  it("dagger is either-hand", () => {
    assert.equal(inferWeaponClass("dagger").handedness, "either");
  });
  it("shield is left-hand-only", () => {
    assert.equal(inferWeaponClass("buckler").handedness, "left");
  });
});

describe("inferWeaponClass — amorphous shortcut", () => {
  it("itemMeta.amorphous=true → amorphous class regardless of name", () => {
    const r = inferWeaponClass("Ordinary Sword", { amorphous: true });
    assert.equal(r.weaponClass, "amorphous");
    assert.equal(r.handedness, "either", "default handedness when meta omits it");
  });
  it("amorphous respects meta.handedness when present + valid", () => {
    const r = inferWeaponClass("nameless weapon", { amorphous: true, handedness: "two" });
    assert.equal(r.weaponClass, "amorphous");
    assert.equal(r.handedness, "two");
  });
  it("amorphous falls back to either when meta.handedness is bogus", () => {
    const r = inferWeaponClass("x", { amorphous: true, handedness: "explode" });
    assert.equal(r.weaponClass, "amorphous");
    assert.equal(r.handedness, "either");
  });
  it("name-only amorphous markers (no meta) still route through", () => {
    // Names with NO explicit weapon noun route through to amorphous via marker.
    // Names that contain a real weapon noun (e.g. "Void Form Blade") take the
    // weapon noun — the meta-flag is the way to mark such items amorphous.
    assert.equal(inferWeaponClass("polymorph weapon").weaponClass, "amorphous");
    assert.equal(inferWeaponClass("shifter").weaponClass, "amorphous");
    assert.equal(inferWeaponClass("void form").weaponClass, "amorphous");
    assert.equal(inferWeaponClass("null form").weaponClass, "amorphous");
    assert.equal(inferWeaponClass("emergent weapon").weaponClass, "amorphous");
  });
});

describe("inferWeaponClass — unknown name fallback", () => {
  it("unknown name returns { weaponClass: null, handedness: 'either' }", () => {
    const r = inferWeaponClass("xyzzy");
    assert.equal(r.weaponClass, null);
    assert.equal(r.handedness, "either");
  });
  it("empty / missing name returns null+either", () => {
    assert.deepEqual(inferWeaponClass(""), { weaponClass: null, handedness: "either" });
    assert.deepEqual(inferWeaponClass(), { weaponClass: null, handedness: "either" });
  });
  it("null itemMeta is ignored, not crashed on", () => {
    assert.equal(inferWeaponClass("sword", null).weaponClass, "sword");
  });
});

describe("WEAPON_CLASS_INFO — registry coverage", () => {
  it("every class emitted by inferWeaponClass is keyed in WEAPON_CLASS_INFO", () => {
    const emitters = [
      "pistol", "revolver", "smg", "rifle", "shotgun", "sniper", "lmg",
      "hand_cannon", "blunderbuss", "energy_rifle", "plasma", "railgun",
      "bolter", "flamethrower",
      "bow", "longbow", "shortbow", "crossbow", "sling", "blowgun",
      "thrown", "javelin", "harpoon", "boomerang",
      "sword", "saber", "rapier", "katana", "cutlass", "machete",
      "dagger", "kukri", "sickle", "hatchet", "tomahawk",
      "greatsword", "greataxe", "scythe",
      "glaive", "naginata", "halberd", "spear", "lance", "pike", "trident",
      "mace", "club", "flail", "hammer", "maul", "quarterstaff",
      "whip", "chain", "kusarigama", "nunchaku", "tonfa", "sai", "fan", "kama",
      "fist", "gauntlet", "claw", "knuckles",
      "wand", "rod", "staff", "scepter", "orb", "talisman", "grimoire", "crystal",
      "shield", "buckler", "bulwark", "tower_shield",
      "amorphous",
    ];
    for (const cls of emitters) {
      assert.ok(WEAPON_CLASS_INFO[cls], `missing metadata for class "${cls}"`);
      assert.ok(WEAPON_CLASS_INFO[cls].category, `class "${cls}" has no category`);
    }
  });

  it("category groupings are consistent", () => {
    assert.equal(WEAPON_CLASS_INFO.shotgun.category, "firearm");
    assert.equal(WEAPON_CLASS_INFO.energy_rifle.category, "firearm");
    assert.equal(WEAPON_CLASS_INFO.longbow.category, "projectile");
    assert.equal(WEAPON_CLASS_INFO.scythe.category, "melee_blade_2h");
    assert.equal(WEAPON_CLASS_INFO.glaive.category, "melee_polearm");
    assert.equal(WEAPON_CLASS_INFO.whip.category, "melee_exotic");
    assert.equal(WEAPON_CLASS_INFO.gauntlet.category, "fist");
    assert.equal(WEAPON_CLASS_INFO.orb.category, "focus");
    assert.equal(WEAPON_CLASS_INFO.buckler.category, "shield");
    assert.equal(WEAPON_CLASS_INFO.amorphous.category, "amorphous");
  });

  it("amorphous has amorphous:true flag + null reach (data-driven)", () => {
    assert.equal(WEAPON_CLASS_INFO.amorphous.amorphous, true);
    assert.equal(WEAPON_CLASS_INFO.amorphous.reach_m, null);
  });

  it("firearm reach >> melee reach (sanity)", () => {
    assert.ok(WEAPON_CLASS_INFO.sniper.reach_m >= 60);
    assert.ok(WEAPON_CLASS_INFO.dagger.reach_m < 2);
    assert.ok(WEAPON_CLASS_INFO.pike.reach_m > WEAPON_CLASS_INFO.dagger.reach_m);
  });
});

describe("getWeaponClassInfo", () => {
  it("returns the metadata row for a known class", () => {
    const info = getWeaponClassInfo("scythe");
    assert.ok(info);
    assert.equal(info.category, "melee_blade_2h");
    assert.equal(info.defaultHand, "two");
  });
  it("returns null for null / undefined / unknown class", () => {
    assert.equal(getWeaponClassInfo(null), null);
    assert.equal(getWeaponClassInfo(undefined), null);
    assert.equal(getWeaponClassInfo(""), null);
    assert.equal(getWeaponClassInfo("phaser_array_mk7"), null);
  });
});
