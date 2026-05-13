/**
 * Tier-2 contract test for per-world material availability.
 *
 * Pins:
 *   - availabilityForMaterial reads from getWorldMeta — registering a
 *     meta with material_availability returns the declared value.
 *   - Unknown world / unknown material defaults to documented values.
 *   - materialForSkill maps gun/weapons_modern → ballistic_ammo, magic →
 *     magical_reagents, hacking → tech_parts, bio_powers → bloodline_fuel.
 *   - classifyAvailability bucketing thresholds.
 *   - The 8 canon worlds' meta.json files each declare material_availability
 *     with the four canonical kinds.
 *   - Gun skill_affinity is now ≥ 0.9 across all canon worlds (the old
 *     0.0 was the user-noted "guns do zero damage" bug).
 *
 * Run: node --test tests/material-availability.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  availabilityForMaterial,
  materialForSkill,
  materialAvailabilityForSkillInWorld,
  classifyAvailability,
  MATERIAL_KINDS,
} from "../lib/embodied/material-availability.js";
import { registerWorldMeta } from "../lib/cross-world-effectiveness.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

const CANON_META_PATHS = [
  "content/world/_meta.json",
  "content/world/tunya/meta.json",
  "content/world/cyber/meta.json",
  "content/world/crime/meta.json",
  "content/world/fantasy/meta.json",
  "content/world/superhero/meta.json",
  "content/world/sovereign-ruins/meta.json",
  "content/world/lattice-crucible/meta.json",
  "content/world/concord-link-frontier/meta.json",
];

function readJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
}

beforeEach(() => {
  // Register one fixture world so availabilityForMaterial has something
  // to read.
  registerWorldMeta({
    world_id: "test_world",
    universe_type: "test",
    material_availability: {
      ballistic_ammo: 0.05,
      magical_reagents: 1.0,
      tech_parts: 0.30,
      bloodline_fuel: 0.50,
    },
  });
});

describe("availabilityForMaterial reads from registry", () => {
  it("returns declared value for a registered world", () => {
    assert.equal(availabilityForMaterial("test_world", "ballistic_ammo"), 0.05);
    assert.equal(availabilityForMaterial("test_world", "magical_reagents"), 1.0);
    assert.equal(availabilityForMaterial("test_world", "tech_parts"), 0.30);
    assert.equal(availabilityForMaterial("test_world", "bloodline_fuel"), 0.50);
  });

  it("falls back to documented defaults for an unknown world", () => {
    assert.equal(availabilityForMaterial("nope_world", "ballistic_ammo"), 1.0);
    assert.equal(availabilityForMaterial("nope_world", "magical_reagents"), 0.5);
    assert.equal(availabilityForMaterial("nope_world", "tech_parts"), 0.5);
    assert.equal(availabilityForMaterial("nope_world", "bloodline_fuel"), 0.5);
  });
});

describe("materialForSkill maps skill → consumable kind", () => {
  it("ballistic skills map to ballistic_ammo", () => {
    assert.equal(materialForSkill("gun"), "ballistic_ammo");
    assert.equal(materialForSkill("weapons_modern"), "ballistic_ammo");
    assert.equal(materialForSkill("weapon_attachments"), "ballistic_ammo");
  });
  it("magic / alchemy map to magical_reagents", () => {
    assert.equal(materialForSkill("magic"), "magical_reagents");
    assert.equal(materialForSkill("alchemy"), "magical_reagents");
  });
  it("hacking / tech / engineering map to tech_parts", () => {
    assert.equal(materialForSkill("hacking"), "tech_parts");
    assert.equal(materialForSkill("tech"), "tech_parts");
    assert.equal(materialForSkill("engineering"), "tech_parts");
  });
  it("bio_powers / bloodlines map to bloodline_fuel", () => {
    assert.equal(materialForSkill("bio_powers"), "bloodline_fuel");
    assert.equal(materialForSkill("fire_bloodline"), "bloodline_fuel");
    assert.equal(materialForSkill("ice_bloodline"), "bloodline_fuel");
  });
  it("material-independent skills return null", () => {
    assert.equal(materialForSkill("athletics"), null);
    assert.equal(materialForSkill("diplomacy"), null);
    assert.equal(materialForSkill("stealth"), null);
  });
});

describe("materialAvailabilityForSkillInWorld combines both", () => {
  it("gun in test_world returns the ballistic_ammo availability", () => {
    const r = materialAvailabilityForSkillInWorld("test_world", "gun");
    assert.equal(r.ok, true);
    assert.equal(r.materialKind, "ballistic_ammo");
    assert.equal(r.availability, 0.05);
  });
  it("stealth never gates by material", () => {
    const r = materialAvailabilityForSkillInWorld("test_world", "stealth");
    assert.equal(r.materialKind, null);
    assert.equal(r.availability, 1.0);
  });
});

describe("classifyAvailability tiers", () => {
  it("0.9 → abundant, 0.5 → moderate, 0.2 → scarce, 0.05 → depleted", () => {
    assert.equal(classifyAvailability(0.9), "abundant");
    assert.equal(classifyAvailability(0.5), "moderate");
    assert.equal(classifyAvailability(0.2), "scarce");
    assert.equal(classifyAvailability(0.05), "depleted");
  });
  it("exact thresholds: 0.70 = abundant, 0.40 = moderate, 0.15 = scarce", () => {
    assert.equal(classifyAvailability(0.70), "abundant");
    assert.equal(classifyAvailability(0.40), "moderate");
    assert.equal(classifyAvailability(0.15), "scarce");
  });
});

describe("canon worlds declare material_availability", () => {
  for (const p of CANON_META_PATHS) {
    it(`${p} has material_availability for all 4 kinds`, () => {
      const meta = readJSON(p);
      assert.ok(meta.material_availability, `${p} missing material_availability`);
      for (const kind of MATERIAL_KINDS) {
        const v = meta.material_availability[kind];
        assert.equal(typeof v, "number", `${p} missing material_availability.${kind}`);
        assert.ok(v >= 0 && v <= 1, `${p} ${kind} out of [0,1]`);
      }
    });
  }
});

describe("gun skill_affinity is no longer 0.0 in low-tech worlds", () => {
  it("tunya gun affinity is ≥ 0.9 — bullets still hurt", () => {
    const meta = readJSON("content/world/tunya/meta.json");
    assert.ok(meta.skill_affinity?.gun >= 0.9, `tunya gun affinity ${meta.skill_affinity?.gun} should be ≥ 0.9`);
  });
  it("fantasy gun affinity is ≥ 0.9", () => {
    const meta = readJSON("content/world/fantasy/meta.json");
    assert.ok(meta.skill_affinity?.gun >= 0.9, `fantasy gun affinity ${meta.skill_affinity?.gun} should be ≥ 0.9`);
  });
  it("sovereign-ruins gun affinity ≥ 0.9", () => {
    const meta = readJSON("content/world/sovereign-ruins/meta.json");
    assert.ok(meta.skill_affinity?.gun >= 0.9, `sovereign-ruins gun affinity ${meta.skill_affinity?.gun} should be ≥ 0.9`);
  });
  it("tunya / fantasy ammo IS gated (ballistic_ammo ≤ 0.10)", () => {
    const tunya = readJSON("content/world/tunya/meta.json");
    const fantasy = readJSON("content/world/fantasy/meta.json");
    assert.ok(tunya.material_availability.ballistic_ammo <= 0.10, "tunya should have rare ammo");
    assert.ok(fantasy.material_availability.ballistic_ammo <= 0.10, "fantasy should have rare ammo");
  });
});
