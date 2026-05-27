// Phase G — per-world flavor loader contract.
//
// Pins: (1) all 8 authored sub-worlds have a valid loops.json,
// (2) validateFlavor catches schema errors, (3) getClimateOverride /
// getSkillCeiling / getNpcDensityTarget read from the cache cleanly,
// (4) isLoopEnabledForWorld defaults to true for absent entries,
// (5) frequency override is respected.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  initWorldFlavors,
  getWorldFlavor,
  validateFlavor,
  isLoopEnabledForWorld,
  getLoopFrequencyForWorld,
  getClimateOverride,
  getSkillCeiling,
  getNpcDensityTarget,
  getWorldVoice,
  listAllFlavors,
  _resetWorldFlavors,
} from "../lib/world-flavor.js";

describe("Phase G — world-flavor loader", () => {
  beforeEach(() => {
    _resetWorldFlavors();
  });

  it("loads all 8 authored sub-worlds", () => {
    initWorldFlavors();
    const flavors = listAllFlavors();
    const ids = flavors.map(f => f.worldId).sort();
    // concord-link-frontier is intentionally a sparse meta-world.
    for (const expected of ["concordia-hub", "tunya", "sovereign-ruins", "crime", "cyber", "superhero", "fantasy", "lattice-crucible", "concord-link-frontier"]) {
      assert.ok(ids.includes(expected), `expected flavor file for ${expected}`);
    }
  });

  it("validateFlavor accepts a valid baseline shape", () => {
    const { ok, errors } = validateFlavor({
      loops: { "npc-routine-cycle": { enabled: true, frequency: 5 } },
      climate: { baseTemp: 18, humidity: 55, illumination: 0.9 },
      factionStartState: { default: { stance: "consolidate", momentum: 0.0 } },
      skillCeilings: { fire: 150 },
      npcDensity: { targetPerFaction: 50, max: 400 },
    });
    assert.equal(ok, true, JSON.stringify(errors));
  });

  it("validateFlavor rejects negative frequency", () => {
    const { ok, errors } = validateFlavor({ loops: { foo: { frequency: 0 } } });
    assert.equal(ok, false);
    assert.ok(errors.some(e => e.includes("loops.foo.frequency")));
  });

  it("validateFlavor rejects unknown stance", () => {
    const { ok, errors } = validateFlavor({ factionStartState: { default: { stance: "rampage" } } });
    assert.equal(ok, false);
    assert.ok(errors.some(e => e.includes("stance")));
  });

  it("validateFlavor rejects out-of-range momentum", () => {
    const { ok, errors } = validateFlavor({ factionStartState: { default: { momentum: 2.5 } } });
    assert.equal(ok, false);
    assert.ok(errors.some(e => e.includes("momentum")));
  });

  it("getSkillCeiling reads world-specific ceiling", () => {
    initWorldFlavors();
    // tunya: fire ceiling 50
    assert.equal(getSkillCeiling("tunya", "fire"), 50);
    // superhero: fire ceiling 400
    assert.equal(getSkillCeiling("superhero", "fire"), 400);
    // unknown world returns null
    assert.equal(getSkillCeiling("nonexistent-world", "fire"), null);
  });

  it("getClimateOverride reads world climate band", () => {
    initWorldFlavors();
    const tunya = getClimateOverride("tunya");
    assert.equal(tunya.baseTemp, 32);
    assert.equal(tunya.humidity, 80);
    const ruins = getClimateOverride("sovereign-ruins");
    assert.equal(ruins.baseTemp, 8);
    assert.equal(ruins.illumination, 0.4);
  });

  it("getNpcDensityTarget falls back when world has no flavor", () => {
    initWorldFlavors();
    assert.equal(getNpcDensityTarget("crime"), 120);
    assert.equal(getNpcDensityTarget("nonexistent", 99), 99);
  });

  it("isLoopEnabledForWorld respects loops.json#enabled flag", () => {
    initWorldFlavors();
    // tunya has kingdom-decree-cycle disabled.
    assert.equal(isLoopEnabledForWorld("tunya", "kingdom-decree-cycle"), false);
    // tunya has npc-routine-cycle enabled.
    assert.equal(isLoopEnabledForWorld("tunya", "npc-routine-cycle"), true);
    // crime has creature-flock-cycle disabled.
    assert.equal(isLoopEnabledForWorld("crime", "creature-flock-cycle"), false);
  });

  it("isLoopEnabledForWorld defaults to true for unknown modules", () => {
    initWorldFlavors();
    assert.equal(isLoopEnabledForWorld("tunya", "module-that-doesnt-exist-yet"), true);
  });

  it("getLoopFrequencyForWorld returns override or null", () => {
    initWorldFlavors();
    // lattice-crucible accelerates npc-routine-cycle to freq 3 (default 5).
    assert.equal(getLoopFrequencyForWorld("lattice-crucible", "npc-routine-cycle"), 3);
    // tunya doesn't override (uses default freq).
    assert.equal(getLoopFrequencyForWorld("tunya", "npc-routine-cycle"), 5);
  });

  it("getWorldVoice returns the per-world voice block", () => {
    initWorldFlavors();
    const crime = getWorldVoice("crime");
    assert.ok(crime.tone.includes("noir"));
    const fantasy = getWorldVoice("fantasy");
    assert.ok(fantasy.tone.includes("archaic"));
  });
});
