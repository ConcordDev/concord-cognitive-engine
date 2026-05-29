/**
 * WS4 — crossbreeding fusion integration.
 * Two parents that both have a damaging power breed a child whose FUSED power is
 * stronger than either parent's (the Bakugo dynamic), with a combined element.
 * When only one parent has a damaging power, no fusion is produced. The fusion
 * is additive — existing union inheritance + tension ability are untouched.
 * Run: node --test tests/crossbreed-fusion.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import {
  ensureCrossbreedingTables, recordEncounter, generateHybrid,
} from "../lib/creature-crossbreeding.js";
import { ensureSkillsTable, bootEmergentSkills, getSkill } from "../lib/emergent-skills.js";

function setup() {
  const db = new Database(":memory:");
  ensureCrossbreedingTables(db);
  ensureSkillsTable(db);
  bootEmergentSkills(db);
  return db;
}

const fireParent = {
  id: "p_fire", topology: "quadruped", massKg: 80, heightM: 1.4, worldId: "fantasy",
  skillIds: [], abilitySeeds: [{ name: "Flame Jet", effects: [{ kind: "damage", params: { amount: 20, element: "fire" } }] }],
};
const windParent = {
  id: "p_wind", topology: "quadruped", massKg: 84, heightM: 1.4, worldId: "fantasy",
  skillIds: [], abilitySeeds: [{ name: "Gust", effects: [{ kind: "damage", params: { amount: 16, element: "wind" } }] }],
};
const bufferParent = {
  id: "p_buff", topology: "quadruped", massKg: 82, heightM: 1.4, worldId: "fantasy",
  skillIds: [], abilitySeeds: [{ name: "Haste", effects: [{ kind: "buff", params: { stat: "speed", delta: 0.5 } }] }],
};

describe("crossbreed fusion (WS4)", () => {
  afterEach(() => { delete process.env.CONCORD_SKILL_FUSION; });

  it("fuses two damaging parents into a stronger child power", () => {
    const db = setup();
    for (let i = 0; i < 25; i++) recordEncounter(db, { aId: fireParent.id, bId: windParent.id, worldA: "fantasy", worldB: "fantasy" });
    const r = generateHybrid(db, { a: fireParent, b: windParent });
    assert.strictEqual(r.ok, true);
    assert.ok(r.fusionSkill, "expected a fusion skill");
    const dmg = r.fusionSkill.effects.find((e) => e.kind === "damage")?.params?.amount;
    assert.ok(dmg > 20, `fused damage ${dmg} should exceed the stronger parent (20)`);
    assert.equal(r.fusionSkill.fusion.element, "explosion"); // fire + wind → explosion
    // the fused skill is persisted + attached to the child blueprint
    assert.ok(r.hybrid.skillIds.includes(r.fusionSkill.id));
    assert.ok(getSkill(r.fusionSkill.id));
  });

  it("produces no fusion when only one parent has a damaging power", () => {
    const db = setup();
    for (let i = 0; i < 25; i++) recordEncounter(db, { aId: fireParent.id, bId: bufferParent.id, worldA: "fantasy", worldB: "fantasy" });
    const r = generateHybrid(db, { a: fireParent, b: bufferParent });
    assert.strictEqual(r.ok, true);
    assert.equal(r.fusionSkill, null);
  });

  it("kill-switch disables fusion", () => {
    process.env.CONCORD_SKILL_FUSION = "0";
    const db = setup();
    for (let i = 0; i < 25; i++) recordEncounter(db, { aId: fireParent.id, bId: windParent.id, worldA: "fantasy", worldB: "fantasy" });
    const r = generateHybrid(db, { a: fireParent, b: windParent });
    assert.equal(r.fusionSkill, null);
  });
});
