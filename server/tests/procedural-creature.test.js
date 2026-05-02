/**
 * Procedural creature generation + physics validation tests.
 * Run: node --test tests/procedural-creature.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  generateCreature,
  validateCreaturePhysics,
  TOPOLOGIES,
  WORLD_MODIFIERS,
  matchBaseline,
  listBaselines,
} from "../lib/procedural-creature.js";

describe("topology inference", () => {
  it("detects winged_quadruped from 'dragon' keyword", () => {
    const bp = generateCreature({ description: "fire-breathing dragon attacked the village" });
    assert.strictEqual(bp.topology, "winged_quadruped");
  });
  it("detects quadruped from 'wolf' keyword", () => {
    const bp = generateCreature({ description: "lone wolf prowling the woods" });
    assert.strictEqual(bp.topology, "quadruped");
  });
  it("detects serpentine from 'snake'", () => {
    const bp = generateCreature({ description: "great serpent in the cave" });
    assert.strictEqual(bp.topology, "serpentine");
  });
  it("falls back to humanoid for ambiguous text", () => {
    const bp = generateCreature({ description: "stranger" });
    assert.ok(["humanoid", "quadruped"].includes(bp.topology));
  });
  it("respects explicit topology override", () => {
    const bp = generateCreature({ description: "weird thing", topology: "polyped" });
    assert.strictEqual(bp.topology, "polyped");
  });
});

describe("physics validation", () => {
  it("validates a dragon when wing area supports mass", () => {
    const bp = generateCreature({ description: "great dragon", topology: "winged_quadruped", massKg: 200, heightM: 5 });
    // 200kg needs ~10m² wings. Auto-rescale should produce a valid blueprint.
    assert.strictEqual(bp.validation.ok, true);
    const wings = bp.parts.filter(p => p.kind === "wing");
    const area = wings.reduce((s, w) => s + (w.dimensions.x * 2) * w.dimensions.z * 2, 0);
    assert.ok(area >= bp.massKg * 0.05 - 0.01);
  });

  it("rejects a dragon with too-small wings without auto-rescale", () => {
    const bp = {
      topology: "winged_quadruped",
      massKg:   1000,
      parts: [
        { kind: "torso", dimensions: { x: 0.5, y: 0.5, z: 1.0 }, massKg: 600 },
        { kind: "leg",   dimensions: { x: 0.1, y: 0.4, z: 0.1 }, massKg: 90 },
        { kind: "leg",   dimensions: { x: 0.1, y: 0.4, z: 0.1 }, massKg: 90 },
        { kind: "leg",   dimensions: { x: 0.1, y: 0.4, z: 0.1 }, massKg: 90 },
        { kind: "leg",   dimensions: { x: 0.1, y: 0.4, z: 0.1 }, massKg: 90 },
        { kind: "wing",  dimensions: { x: 0.5, y: 0.05, z: 0.3 }, massKg: 20 }, // tiny
        { kind: "wing",  dimensions: { x: 0.5, y: 0.05, z: 0.3 }, massKg: 20 }, // tiny
      ],
    };
    const v = validateCreaturePhysics(bp);
    assert.strictEqual(v.ok, false);
    assert.ok(/wings too small/i.test(v.reason));
    assert.ok(typeof v.fix?.suggestedMassKg === "number");
  });

  it("rejects a humanoid with insufficient leg cross-section", () => {
    const bp = {
      topology: "humanoid",
      massKg:   500,
      parts: [
        { kind: "torso", dimensions: { x: 0.3, y: 0.5, z: 0.2 }, massKg: 230 },
        { kind: "head",  dimensions: { x: 0.15, y: 0.15, z: 0.15 }, massKg: 40 },
        { kind: "arm",   dimensions: { x: 0.05, y: 0.3, z: 0.05 }, massKg: 25 },
        { kind: "arm",   dimensions: { x: 0.05, y: 0.3, z: 0.05 }, massKg: 25 },
        { kind: "leg",   dimensions: { x: 0.02, y: 0.4, z: 0.02 }, massKg: 90 }, // too thin
        { kind: "leg",   dimensions: { x: 0.02, y: 0.4, z: 0.02 }, massKg: 90 }, // too thin
      ],
    };
    const v = validateCreaturePhysics(bp);
    assert.strictEqual(v.ok, false);
    assert.ok(/legs too thin/i.test(v.reason));
  });

  it("auto-rescales when generation produces an invalid initial body", () => {
    const bp = generateCreature({
      description: "colossal titan dragon",
      topology:    "winged_quadruped",
      massKg:      9000, // intentionally too much for any realistic wing area
      heightM:     12,
    });
    // After rescale the blueprint must be valid (or report rescaled flag)
    assert.strictEqual(bp.validation.ok, true);
    assert.ok(bp.massKg <= 9000);
    if (bp.massKg < 9000) assert.strictEqual(bp.provenance.rescaled, true);
  });
});

describe("world modifiers", () => {
  it("lists all four worlds + concordia hub", () => {
    for (const w of ["superhero", "fantasy", "crime", "cyber", "concordia"]) {
      assert.ok(WORLD_MODIFIERS[w], `missing ${w}`);
    }
  });
  it("fantasy creatures are slightly heavier", () => {
    const fant = generateCreature({ description: "wolf", topology: "quadruped", worldId: "fantasy" });
    const con  = generateCreature({ description: "wolf", topology: "quadruped", worldId: "concordia" });
    // Fantasy massScale = 1.1; same description should produce slightly heavier mass
    assert.ok(fant.massKg >= con.massKg * 1.05);
  });
  it("worldId is preserved on the blueprint", () => {
    const bp = generateCreature({ description: "thing", worldId: "cyber" });
    assert.strictEqual(bp.worldId, "cyber");
    assert.strictEqual(bp.provenance.worldId, "cyber");
  });
});

describe("baseline matching", () => {
  it("matches a fantasy thorn_wolf description", () => {
    const m = matchBaseline("fantasy", "a thorn wolf prowled the wildwood");
    assert.ok(m, "expected to match thorn_wolf");
    assert.strictEqual(m.id, "thorn_wolf");
  });

  it("returns null when no baseline matches", () => {
    const m = matchBaseline("fantasy", "amorphous stranger walked by");
    assert.strictEqual(m, null);
  });

  it("listBaselines returns an array per world", () => {
    for (const w of ["superhero", "fantasy", "crime", "cyber"]) {
      const list = listBaselines(w);
      assert.ok(Array.isArray(list));
      assert.ok(list.length >= 5, `world ${w} has fewer than 5 baselines`);
    }
  });
});

describe("topology coverage", () => {
  it("every topology produces a parseable blueprint", () => {
    for (const t of TOPOLOGIES) {
      const bp = generateCreature({ description: `${t} creature`, topology: t, massKg: 50, heightM: 1.5 });
      assert.ok(bp.parts.length > 0, `${t} produced no parts`);
      assert.ok(bp.gait, `${t} has no gait`);
    }
  });
});
