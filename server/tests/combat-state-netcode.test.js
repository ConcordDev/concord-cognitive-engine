/**
 * Combat state + netcode validation tests.
 * Run: node --test tests/combat-state-netcode.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";

import {
  applyHitToState,
  tickCombatState,
  getCombatState,
  grantIFrames,
  setBlock,
  resetCombatState,
  COMBAT_STATE_CONSTANTS,
} from "../lib/combat-state.js";
import {
  recordAttackSwing,
  validateHit,
  _resetAttackCooldowns,
} from "../lib/combat-netcode.js";

describe("combat-state: applyHitToState", () => {
  beforeEach(() => resetCombatState("v"));

  it("applies full damage when no shields", () => {
    const r = applyHitToState("v", { damage: 20 });
    assert.strictEqual(r.damageMul, 1.0);
    assert.strictEqual(r.iframed, false);
    assert.strictEqual(r.blocked, false);
  });

  it("zeros damage during i-frames", () => {
    grantIFrames("v", 1000);
    const r = applyHitToState("v", { damage: 999 });
    assert.strictEqual(r.damageMul, 0);
    assert.strictEqual(r.iframed, true);
  });

  it("halves damage while blocking", () => {
    setBlock("v", 1000);
    const r = applyHitToState("v", { damage: 20 });
    assert.strictEqual(r.damageMul, 0.5);
    assert.strictEqual(r.blocked, true);
  });

  it("triggers stagger when poise exhausts", () => {
    let staggered = false;
    for (let i = 0; i < 10; i++) {
      const r = applyHitToState("v", { damage: 30 });
      if (r.staggered) { staggered = true; break; }
    }
    assert.strictEqual(staggered, true);
  });
});

describe("combat-state: poise regen", () => {
  it("restores poise over time via tickCombatState", async () => {
    resetCombatState("regen_v");
    applyHitToState("regen_v", { damage: 50 });
    const before = getCombatState("regen_v").poise;
    // Simulate a few ticks
    await new Promise(r => setTimeout(r, 200));
    tickCombatState();
    const after = getCombatState("regen_v").poise;
    assert.ok(after >= before);
  });
});

describe("combat-netcode: cooldown gate", () => {
  beforeEach(() => _resetAttackCooldowns());

  it("first swing is allowed", () => {
    const r = recordAttackSwing("att1");
    assert.strictEqual(r.allowed, true);
  });

  it("rapid second swing is rejected", () => {
    recordAttackSwing("att1");
    const r = recordAttackSwing("att1");
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.reason, "cooldown_active");
  });
});

describe("combat-netcode: validateHit", () => {
  const baseAttacker = { id: "a", position: { x: 0, y: 0, z: 0 }, cityId: "concordia" };
  const baseVictim   = { id: "v", position: { x: 1, y: 0, z: 0 }, cityId: "concordia" };

  it("accepts a melee hit within reach", () => {
    const r = validateHit({ attacker: baseAttacker, victim: baseVictim, weapon: { reach: 3, maxDamage: 30 }, damage: 12, isCrit: false });
    assert.strictEqual(r.ok, true);
  });

  it("rejects out-of-reach", () => {
    const r = validateHit({
      attacker: baseAttacker,
      victim:   { ...baseVictim, position: { x: 50, y: 0, z: 0 } },
      weapon:   { reach: 3, maxDamage: 30 },
      damage:   12,
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "out_of_reach");
  });

  it("rejects damage above cap", () => {
    const r = validateHit({ attacker: baseAttacker, victim: baseVictim, weapon: { maxDamage: 10 }, damage: 999 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "damage_over_max");
  });

  it("rejects cross-city attacks", () => {
    const r = validateHit({
      attacker: baseAttacker,
      victim:   { ...baseVictim, cityId: "fantasy" },
      damage:   10,
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "cross_city");
  });

  it("rejects self-target", () => {
    const r = validateHit({ attacker: baseAttacker, victim: baseAttacker, damage: 5 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "self_target");
  });

  it("crit raises the damage cap", () => {
    const r = validateHit({ attacker: baseAttacker, victim: baseVictim, weapon: { maxDamage: 30 }, damage: 60, isCrit: true });
    assert.strictEqual(r.ok, true); // 60 < 30 * 2.5
  });
});
