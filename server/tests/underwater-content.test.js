/**
 * Tier-2 contract tests for Concordia Phase 8 — underwater-content.
 *
 * Pins:
 *   - spawnFeature + listFeaturesInWorld round-trip
 *   - featuresNearPlayer respects depth band + radius
 *   - listSpecies returns seeded aquatic species (kraken/leviathan/eel/anglerfish)
 *   - decideAttackOnPlayer:
 *       - returns no_attacker when no aggressive features nearby
 *       - returns attacker when within pursuit_radius + RNG hits probability
 *       - cooldown gates subsequent attacks
 *
 * Run: node --test tests/underwater-content.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  spawnFeature,
  listFeaturesInWorld,
  featuresNearPlayer,
  listSpecies,
  decideAttackOnPlayer,
  _resetCooldowns,
} from "../lib/underwater-content.js";
import { up as up178 } from "../migrations/178_underwater_features.js";

function setupDb() {
  const db = new Database(":memory:");
  up178(db);
  return db;
}

beforeEach(() => { _resetCooldowns(); });

describe("Phase 8 / underwater — features round-trip", () => {
  it("spawnFeature + list", () => {
    const db = setupDb();
    spawnFeature(db, {
      id: "uw_test_kelp", worldId: "concordia-hub", kind: "kelp_forest", name: "Test Kelp",
      pos_x: 10, pos_z: 10, depth_min_m: 4, depth_max_m: 18, radius_m: 25, aggression: 0,
    });
    const lst = listFeaturesInWorld(db, "concordia-hub");
    assert.equal(lst.length, 1);
    assert.equal(lst[0].id, "uw_test_kelp");
  });

  it("upserts on id", () => {
    const db = setupDb();
    spawnFeature(db, { id: "x", worldId: "w", kind: "kelp_forest", name: "n1", pos_x: 0, pos_z: 0 });
    spawnFeature(db, { id: "x", worldId: "w", kind: "kelp_forest", name: "n2", pos_x: 0, pos_z: 0 });
    assert.equal(listFeaturesInWorld(db, "w").length, 1);
    assert.equal(listFeaturesInWorld(db, "w")[0].name, "n2");
  });

  it("rejects missing inputs", () => {
    const db = setupDb();
    const r = spawnFeature(db, { id: "x" });
    assert.equal(r.ok, false);
  });
});

describe("Phase 8 / underwater — featuresNearPlayer", () => {
  it("includes feature within radius + depth band", () => {
    const db = setupDb();
    spawnFeature(db, {
      id: "uw_near", worldId: "w", kind: "kelp_forest", name: "near",
      pos_x: 5, pos_z: 5, depth_min_m: 4, depth_max_m: 18, radius_m: 30,
    });
    const r = featuresNearPlayer(db, "w", 5, 5, 10, 60);
    assert.equal(r.length, 1);
  });

  it("excludes feature outside radius", () => {
    const db = setupDb();
    spawnFeature(db, {
      id: "uw_far", worldId: "w", kind: "kelp_forest", name: "far",
      pos_x: 1000, pos_z: 1000, radius_m: 5, depth_min_m: 0, depth_max_m: 100,
    });
    const r = featuresNearPlayer(db, "w", 0, 0, 10, 60);
    assert.equal(r.length, 0);
  });

  it("excludes feature outside depth band", () => {
    const db = setupDb();
    spawnFeature(db, {
      id: "uw_deep", worldId: "w", kind: "trench_cave", name: "deep",
      pos_x: 0, pos_z: 0, depth_min_m: 80, depth_max_m: 200, radius_m: 50,
    });
    const r = featuresNearPlayer(db, "w", 0, 0, 10, 100);
    assert.equal(r.length, 0);
  });
});

describe("Phase 8 / underwater — listSpecies", () => {
  it("includes seeded species", () => {
    const db = setupDb();
    const ids = listSpecies(db).map(s => s.species_id);
    assert.ok(ids.includes("s-kraken"));
    assert.ok(ids.includes("s-leviathan"));
    assert.ok(ids.includes("s-eel"));
    assert.ok(ids.includes("s-anglerfish"));
  });
});

describe("Phase 8 / underwater — decideAttackOnPlayer", () => {
  it("no attacker when no aggressive features nearby", () => {
    const db = setupDb();
    spawnFeature(db, { id: "peaceful", worldId: "w", kind: "coral_garden", name: "c",
      pos_x: 0, pos_z: 0, radius_m: 100, aggression: 0 });
    const r = decideAttackOnPlayer(db, {
      worldId: "w", userId: "u", position: { x: 0, z: 0 }, depth_m: 10, rngFn: () => 0.0,
    });
    assert.equal(r.attacker, null);
  });

  it("attacker fires when probability roll succeeds", () => {
    const db = setupDb();
    spawnFeature(db, { id: "deep_trench", worldId: "w", kind: "trench_cave", name: "t",
      pos_x: 0, pos_z: 0, depth_min_m: 50, depth_max_m: 200, radius_m: 80, aggression: 3 });
    const r = decideAttackOnPlayer(db, {
      worldId: "w", userId: "u", position: { x: 0, z: 0 }, depth_m: 80, rngFn: () => 0.0,
    });
    assert.ok(r.attacker);
    assert.ok(r.painIntensity > 0);
  });

  it("cooldown gates second attack", () => {
    const db = setupDb();
    spawnFeature(db, { id: "deep_trench", worldId: "w", kind: "trench_cave", name: "t",
      pos_x: 0, pos_z: 0, depth_min_m: 50, depth_max_m: 200, radius_m: 80, aggression: 3 });
    const first = decideAttackOnPlayer(db, {
      worldId: "w", userId: "u", position: { x: 0, z: 0 }, depth_m: 80, rngFn: () => 0.0,
    });
    assert.ok(first.attacker);
    const second = decideAttackOnPlayer(db, {
      worldId: "w", userId: "u", position: { x: 0, z: 0 }, depth_m: 80, rngFn: () => 0.0,
    });
    assert.equal(second.attacker, null);
    assert.ok(second.on_cooldown_until > 0);
  });

  it("no attack when probability roll fails (rng=0.99)", () => {
    const db = setupDb();
    spawnFeature(db, { id: "trench", worldId: "w", kind: "trench_cave", name: "t",
      pos_x: 0, pos_z: 0, depth_min_m: 50, depth_max_m: 200, radius_m: 80, aggression: 1 });
    const r = decideAttackOnPlayer(db, {
      worldId: "w", userId: "u", position: { x: 0, z: 0 }, depth_m: 80, rngFn: () => 0.99,
    });
    assert.equal(r.attacker, null);
  });
});
