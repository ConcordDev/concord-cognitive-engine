/**
 * WS1 — entity-power contract tests.
 * Pins: getEntityCombatLevel reads grown skill level (+ evolution bonus, +
 * fallbacks); HP/attack/cap are LEGACY with the flag off and SCALE with the
 * flag on; and the player damage formula is skill-weighted with no character-
 * level input (skill > level lock).
 * Run: node --test tests/entity-power.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import {
  absolutePowerEnabled,
  getEntityCombatLevel,
  npcMaxHpForLevel,
  npcAttackStats,
  capNpcDamage,
  POWER_DIALS,
} from "../lib/entity-power.js";
import { computeDamage } from "../lib/combat/damage-calculator.js";

function setup() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, level INTEGER DEFAULT 1);
    CREATE TABLE npc_skills (npc_id TEXT, skill_id TEXT, xp REAL DEFAULT 0, level INTEGER DEFAULT 1, PRIMARY KEY (npc_id, skill_id));
    CREATE TABLE skill_revisions (id TEXT PRIMARY KEY, author_kind TEXT, author_id TEXT, status TEXT);
  `);
  return db;
}

const ON = () => { process.env.CONCORD_ABSOLUTE_POWER = "1"; };
const OFF = () => { process.env.CONCORD_ABSOLUTE_POWER = "0"; };

describe("getEntityCombatLevel", () => {
  let db;
  beforeEach(() => { db = setup(); });

  it("reads the max grown skill level from npc_skills", () => {
    db.prepare("INSERT INTO world_npcs (id, level) VALUES ('n1', 3)").run();
    db.prepare("INSERT INTO npc_skills (npc_id, skill_id, level) VALUES ('n1','combat',40),('n1','magic',25)").run();
    assert.equal(getEntityCombatLevel(db, "n1"), 40);
  });

  it("adds a bonus for applied evolution revisions", () => {
    db.prepare("INSERT INTO world_npcs (id, level) VALUES ('n1', 1)").run();
    db.prepare("INSERT INTO npc_skills (npc_id, skill_id, level) VALUES ('n1','combat',20)").run();
    for (let i = 0; i < 6; i++) {
      db.prepare("INSERT INTO skill_revisions (id, author_kind, author_id, status) VALUES (?, 'npc', 'n1', 'applied')").run(`r${i}`);
    }
    // 6 applied revisions → +3 effective levels
    assert.equal(getEntityCombatLevel(db, "n1"), 23);
  });

  it("falls back to world_npcs.level then 1", () => {
    db.prepare("INSERT INTO world_npcs (id, level) VALUES ('n2', 12)").run();
    assert.equal(getEntityCombatLevel(db, "n2"), 12);
    assert.equal(getEntityCombatLevel(db, "ghost"), 1);
    assert.equal(getEntityCombatLevel(null, "x"), 1);
  });
});

describe("HP / attack / cap gating", () => {
  afterEach(OFF);

  it("HP is flat legacy 100 with the flag off, scales with the flag on", () => {
    OFF();
    assert.equal(absolutePowerEnabled(), false);
    assert.equal(npcMaxHpForLevel(1), POWER_DIALS.baseHp);
    assert.equal(npcMaxHpForLevel(80), POWER_DIALS.baseHp);
    ON();
    assert.equal(absolutePowerEnabled(), true);
    assert.equal(npcMaxHpForLevel(1), Math.round(POWER_DIALS.baseHp * (1 + 1 * POWER_DIALS.hpPerLevel)));
    assert.ok(npcMaxHpForLevel(80) > npcMaxHpForLevel(1));
  });

  it("attack stats are legacy criminal_rep shape off, level-scaled on", () => {
    OFF();
    const legacy = npcAttackStats(50, "physical", { criminalRep: 2 });
    assert.equal(legacy.skillLevel, 5);
    assert.equal(legacy.basePower, 5 + 2 * 10); // 5 + criminalRep*10
    ON();
    const scaled = npcAttackStats(50, "physical", { criminalRep: 2 });
    assert.equal(scaled.skillLevel, 50);
    assert.ok(scaled.basePower > legacy.basePower);
  });

  it("damage cap is a no-op off, bounds outgoing damage on", () => {
    OFF();
    assert.equal(capNpcDamage(99999, { basePower: 5 }), 99999);
    ON();
    const stats = npcAttackStats(200, "physical");
    const cap = Math.min(POWER_DIALS.damageHardCap, stats.basePower * POWER_DIALS.damageCritMult);
    assert.equal(capNpcDamage(99999, stats), cap);
    assert.ok(cap <= POWER_DIALS.damageHardCap);
  });

  it("a frontier NPC out-damages a hub NPC when scaling is on", () => {
    ON();
    const defender = { physical_resistance: 0, status_effects: "[]" };
    const hub = computeDamage(npcAttackStats(1, "physical"), defender, {});
    const frontier = computeDamage(npcAttackStats(90, "physical"), defender, {});
    assert.ok(frontier.finalDamage > hub.finalDamage * 5);
  });
});

describe("skill > level lock (player formula)", () => {
  it("player damage is driven by skill level, with no character-level input", () => {
    const defender = { physical_resistance: 0, status_effects: "[]" };
    // computeDamage's only progression input is skillLevel — there is no
    // characterLevel parameter, so a grind-leveled character cannot out-damage
    // a skilled one purely via character level.
    const skilled = computeDamage({ skillLevel: 60, basePower: 10, element: "physical" }, defender, {});
    const unskilled = computeDamage({ skillLevel: 5, basePower: 10, element: "physical" }, defender, {});
    assert.ok(skilled.finalDamage > unskilled.finalDamage);
    // adding a bogus characterLevel field changes nothing
    const withCharLevel = computeDamage({ skillLevel: 5, basePower: 10, element: "physical", characterLevel: 999 }, defender, {});
    assert.equal(withCharLevel.finalDamage, unskilled.finalDamage);
  });
});
