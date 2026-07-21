// Ranged combat wiring — socket PvP range cap. The socket `combat:attack`
// handler fed client `data.range` straight into applyAttack's distance check
// with NO upper bound at all (`Number(data.range) || 3`) — a modified client
// could claim range:999999 and land a "hit" on a target anywhere on the map,
// regardless of actual distance. clampAttackRange bounds it to the same
// COMBAT_MAX_REACH_M ceiling the HTTP NPC route (_validateCombatReach) has
// used all along, closing the same class of gap G3 closed for damage.
//
// Run: node --test tests/socket-combat-range-cap.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  configurePresence,
  updateUserPosition,
  applyAttack,
  removeUser,
} from "../lib/city-presence.js";
import {
  clampAttackRange,
  COMBAT_MAX_REACH_M,
  COMBAT_MELEE_REACH_M,
} from "../lib/combat-limits.js";

describe("ranged combat — socket combat range cap", () => {
  beforeEach(() => configurePresence({ db: null, fireTrigger: null }));
  afterEach(() => { removeUser("atk"); removeUser("def"); });

  it("clampAttackRange bounds malicious / malformed input", () => {
    assert.equal(clampAttackRange(999_999), COMBAT_MAX_REACH_M);  // absurd claim → ceiling
    assert.equal(clampAttackRange(1e9), COMBAT_MAX_REACH_M);
    assert.equal(clampAttackRange(-5), COMBAT_MELEE_REACH_M);     // negative → melee default
    assert.equal(clampAttackRange(NaN), COMBAT_MELEE_REACH_M);
    assert.equal(clampAttackRange(0), COMBAT_MELEE_REACH_M);
    assert.equal(clampAttackRange(undefined), COMBAT_MELEE_REACH_M); // matches old `|| 3` default
    // Legitimate values pass through unchanged — melee (3), existing spell
    // range (12), and the new ranged-firearm 'fire' style (45) all fit
    // comfortably under the 80m ceiling.
    assert.equal(clampAttackRange(3), 3);
    assert.equal(clampAttackRange(12), 12);
    assert.equal(clampAttackRange(45), 45);
    assert.equal(clampAttackRange(COMBAT_MAX_REACH_M), COMBAT_MAX_REACH_M); // exactly at the ceiling
  });

  it("an out-of-map-range claim is rejected by applyAttack once the range is clamped", () => {
    updateUserPosition("atk", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("def", { cityId: "c1", x: 500, y: 0, z: 0 }); // far outside any real weapon's reach
    // Before this fix: range: Number(999999) || 3 → 999999, so this "hit" landed.
    const exploited = applyAttack({
      attackerId: "atk", targetId: "def",
      baseDamage: 10, range: 999_999, armorPierce: 0,
    });
    assert.equal(exploited.ok, true, "sanity: an unclamped absurd range does land (pre-fix behavior)");

    // After this fix: the handler clamps the client-supplied range first.
    const closed = applyAttack({
      attackerId: "atk", targetId: "def",
      baseDamage: 10, range: clampAttackRange(999_999), armorPierce: 0,
    });
    assert.equal(closed.ok, false, "clamped range correctly rejects the out-of-reach target");
    assert.equal(closed.error, "out_of_range");
  });

  it("a legitimate ranged-firearm shot at real distance still lands once clamped", () => {
    updateUserPosition("atk", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("def", { cityId: "c1", x: 30, y: 0, z: 0 }); // within the 45m 'fire' range
    const r = applyAttack({
      attackerId: "atk", targetId: "def",
      baseDamage: 11, range: clampAttackRange(45), armorPierce: 1,
    });
    assert.equal(r.ok, true);
    assert.ok(r.damage > 0);
  });
});
