// G3 — socket PvP damage cap. The socket `combat:attack` path fed client
// `data.baseDamage` straight into applyAttack with only armor mitigation, so a
// modified client could send baseDamage:1e9 and one-shot any player (the HTTP
// NPC route was capped; this path wasn't). Now the handler clamps the input via
// clampBaseDamage and bounds the resolved damage via applyAttack's maxDamage.
//
// Run: node --test tests/socket-combat-damage-cap.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  configurePresence,
  updateUserPosition,
  applyAttack,
  removeUser,
} from "../lib/city-presence.js";
import {
  clampBaseDamage,
  resolvedDamageCap,
  COMBAT_DAMAGE_HARD_CAP,
} from "../lib/combat-limits.js";

describe("G3 — socket combat damage cap", () => {
  beforeEach(() => configurePresence({ db: null, fireTrigger: null }));
  afterEach(() => { removeUser("atk"); removeUser("def"); });

  it("clampBaseDamage bounds malicious / malformed input", () => {
    assert.equal(clampBaseDamage(1_000_000), COMBAT_DAMAGE_HARD_CAP);   // absurd → hard cap
    assert.equal(clampBaseDamage(1e9, 0), COMBAT_DAMAGE_HARD_CAP);
    assert.equal(clampBaseDamage(200, 150), 150);                       // skill ceiling wins
    assert.equal(clampBaseDamage(-2147483648), 1);                     // negative floors to 1
    assert.equal(clampBaseDamage(NaN), 1);
    assert.equal(clampBaseDamage(Infinity), 1);
    assert.equal(clampBaseDamage(50), 50);                             // legit value passes through
  });

  it("resolvedDamageCap = skill*crit or the hard cap", () => {
    assert.equal(resolvedDamageCap(), COMBAT_DAMAGE_HARD_CAP);
    assert.equal(resolvedDamageCap(100), 250); // 100 * 2.5
  });

  it("applyAttack(maxDamage) bounds the resolved damage regardless of baseDamage", () => {
    updateUserPosition("atk", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("def", { cityId: "c1", x: 1, y: 0, z: 1 });
    // A small maxDamage makes the bound deterministic: Math.min(anything, 5) ≤ 5,
    // even with an absurd base + full armor pierce + a crit.
    const r = applyAttack({
      attackerId: "atk", targetId: "def",
      baseDamage: 1_000_000, range: 5, armorPierce: 100, maxDamage: 5,
    });
    assert.equal(r.ok, true);
    assert.ok(r.damage <= 5, `resolved damage ${r.damage} must be ≤ maxDamage 5`);
    assert.ok(r.damage > 0, "attack should still land");
  });

  it("the socket-path values (clamp + cap) keep a one-shot attempt within the hard cap", () => {
    updateUserPosition("atk", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("def", { cityId: "c1", x: 1, y: 0, z: 1 });
    // Exactly what the handler now passes for a baseDamage:1e9 injection.
    const r = applyAttack({
      attackerId: "atk", targetId: "def",
      baseDamage: clampBaseDamage(1e9), range: 5, armorPierce: 0,
      maxDamage: resolvedDamageCap(),
    });
    assert.equal(r.ok, true);
    assert.ok(r.damage <= COMBAT_DAMAGE_HARD_CAP + 0.5,
      `resolved damage ${r.damage} must be ≤ hard cap ${COMBAT_DAMAGE_HARD_CAP}`);
  });
});
