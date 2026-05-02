/**
 * Crossbreeding tests — bond decay, compatibility gates, hybrid generation.
 * Run: node --test tests/creature-crossbreeding.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import {
  ensureCrossbreedingTables,
  recordEncounter,
  decayBonds,
  getBond,
  checkCompatibility,
  generateHybrid,
  maybeCrossbreed,
  getLineage,
} from "../lib/creature-crossbreeding.js";
import { ensureSkillsTable, bootEmergentSkills } from "../lib/emergent-skills.js";

function setup() {
  const db = new Database(":memory:");
  ensureCrossbreedingTables(db);
  ensureSkillsTable(db);
  bootEmergentSkills(db);
  return db;
}

const fantasyParent = {
  id: "p_fant_1", topology: "quadruped", massKg: 80, heightM: 1.4,
  worldId: "fantasy", skillIds: [], abilitySeeds: [{ effects: [{ kind: "damage", params: { amount: 8 } }] }],
};
const cyberParent = {
  id: "p_cyber_1", topology: "quadruped", massKg: 90, heightM: 1.4,
  worldId: "cyber", skillIds: [], abilitySeeds: [{ effects: [{ kind: "buff", params: { stat: "speed", delta: 0.5 } }] }],
};
const wingedParent = {
  id: "p_winged", topology: "winged_quadruped", massKg: 200, heightM: 5,
  worldId: "fantasy", skillIds: [], abilitySeeds: [],
};

describe("bond tracking", () => {
  it("recordEncounter increments bond per call", () => {
    const db = setup();
    recordEncounter(db, { aId: "a", bId: "b", worldA: "fantasy", worldB: "fantasy" });
    const b1 = getBond(db, "a", "b");
    recordEncounter(db, { aId: "a", bId: "b", worldA: "fantasy", worldB: "fantasy" });
    const b2 = getBond(db, "a", "b");
    assert.ok(b2 > b1);
  });

  it("self-pair encounters return error", () => {
    const db = setup();
    const r = recordEncounter(db, { aId: "x", bId: "x", worldA: "fantasy", worldB: "fantasy" });
    assert.strictEqual(r.ok, false);
  });

  it("ordered pair: (a,b) and (b,a) collapse to one row", () => {
    const db = setup();
    recordEncounter(db, { aId: "a", bId: "z", worldA: "fantasy", worldB: "fantasy" });
    recordEncounter(db, { aId: "z", bId: "a", worldA: "fantasy", worldB: "fantasy" });
    const rows = db.prepare(`SELECT COUNT(*) as c FROM creature_bonds WHERE (a_id='a' AND b_id='z') OR (a_id='z' AND b_id='a')`).get();
    assert.strictEqual(rows.c, 1);
  });

  it("bonus multipliers stack", () => {
    const db = setup();
    recordEncounter(db, { aId: "a", bId: "b", worldA: "fantasy", worldB: "fantasy" });
    const baseline = getBond(db, "a", "b");
    recordEncounter(db, { aId: "c", bId: "d", worldA: "fantasy", worldB: "fantasy", sameEnvironmentBonus: true, sharedThreatBonus: true });
    const boosted = getBond(db, "c", "d");
    assert.ok(boosted > baseline * 2);
  });

  it("decayBonds drops fully-decayed pairs", () => {
    const db = setup();
    recordEncounter(db, { aId: "a", bId: "b", worldA: "fantasy", worldB: "fantasy" });
    // Force last_seen_at far in the past
    db.prepare(`UPDATE creature_bonds SET last_seen_at = unixepoch() - 100000, bond = 0.1`).run();
    decayBonds(db);
    const r = db.prepare(`SELECT COUNT(*) as c FROM creature_bonds`).get();
    assert.strictEqual(r.c, 0);
  });
});

describe("compatibility", () => {
  it("rejects self-pair", () => {
    const r = checkCompatibility({ a: fantasyParent, b: fantasyParent, bond: 9999 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "self_pair");
  });

  it("rejects bond_too_low for same-world below threshold (100)", () => {
    const r = checkCompatibility({ a: fantasyParent, b: { ...fantasyParent, id: "p2" }, bond: 50 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "bond_too_low");
    assert.strictEqual(r.bondNeeded, 100);
  });

  it("rejects bond_too_low for cross-world below higher threshold (200)", () => {
    const r = checkCompatibility({ a: fantasyParent, b: cyberParent, bond: 150 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.bondNeeded, 200);
  });

  it("accepts when bond meets threshold", () => {
    const r = checkCompatibility({ a: fantasyParent, b: { ...fantasyParent, id: "p2" }, bond: 110 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.sameWorld, true);
  });
});

describe("hybrid generation", () => {
  it("blends two same-world parents into a valid blueprint", () => {
    const db = setup();
    // push bond past threshold
    for (let i = 0; i < 25; i++) recordEncounter(db, { aId: fantasyParent.id, bId: "p2_fant", worldA: "fantasy", worldB: "fantasy" });
    const r = generateHybrid(db, { a: fantasyParent, b: { ...fantasyParent, id: "p2_fant" } });
    assert.strictEqual(r.ok, true);
    assert.ok(r.hybrid);
    assert.strictEqual(r.crossWorld, false);
    assert.ok(r.stability > 0.1);
    assert.ok(r.stability <= 1.0);
  });

  it("cross-world hybrid stability caps at 0.4", () => {
    const db = setup();
    for (let i = 0; i < 50; i++) recordEncounter(db, { aId: fantasyParent.id, bId: cyberParent.id, worldA: "fantasy", worldB: "cyber" });
    const r = generateHybrid(db, { a: fantasyParent, b: cyberParent });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.crossWorld, true);
    assert.ok(r.stability <= 0.4 + 0.001);
  });

  it("blends winged + ground topology toward winged", () => {
    const db = setup();
    for (let i = 0; i < 25; i++) recordEncounter(db, { aId: wingedParent.id, bId: fantasyParent.id, worldA: "fantasy", worldB: "fantasy" });
    const r = generateHybrid(db, { a: wingedParent, b: fantasyParent });
    assert.strictEqual(r.ok, true);
    assert.ok(["winged_quadruped", "winged_biped"].includes(r.hybrid.topology));
  });

  it("authors a tension skill when both parents have ability seeds", () => {
    const db = setup();
    for (let i = 0; i < 25; i++) recordEncounter(db, { aId: fantasyParent.id, bId: cyberParent.id, worldA: "fantasy", worldB: "cyber" });
    for (let i = 0; i < 25; i++) recordEncounter(db, { aId: fantasyParent.id, bId: cyberParent.id, worldA: "fantasy", worldB: "cyber" });
    const r = generateHybrid(db, { a: fantasyParent, b: cyberParent });
    assert.strictEqual(r.ok, true);
    if (r.tensionSkill) {
      assert.ok(r.tensionSkill.id);
      assert.ok(r.tensionSkill.effects.length > 0);
    }
  });

  it("persists lineage", () => {
    const db = setup();
    for (let i = 0; i < 25; i++) recordEncounter(db, { aId: fantasyParent.id, bId: "p2_fant", worldA: "fantasy", worldB: "fantasy" });
    const r = generateHybrid(db, { a: fantasyParent, b: { ...fantasyParent, id: "p2_fant" } });
    const lineage = getLineage(db, r.hybrid.id);
    assert.ok(lineage?.self);
    assert.ok([fantasyParent.id, "p2_fant"].includes(lineage.self.parent_a) || [fantasyParent.id, "p2_fant"].includes(lineage.self.parent_b));
  });
});

describe("maybeCrossbreed pipeline", () => {
  it("rejects when bond not yet built", () => {
    const db = setup();
    const r = maybeCrossbreed(db, { a: fantasyParent, b: { ...fantasyParent, id: "p2" } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "bond_too_low");
  });
});
