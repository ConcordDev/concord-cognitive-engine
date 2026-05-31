import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GUN_ARCHETYPES, RANGED_PARRY_WINDOW_MS, damageAtRange, spreadAt,
  createMagazine, fire, reload,
} from "../lib/firearms.js";
import { ammoItemFor, planReload, canFire } from "../lib/ammunition.js";

// Universal Move System Phase 3 — guns balanced, not OP. Research-grounded
// two-point linear falloff to a floor (R1), magazine/reload, parry-window=0.

test("ranged parry window is 0 (a gun user must NOT parry like a swordsman)", () => {
  assert.equal(RANGED_PARRY_WINDOW_MS, 0);
});

test("damage falloff is full ≤ falloffStart, floors at minDamageFloor, never zero", () => {
  const close = damageAtRange("rifle", 5);    // ≤ falloffStart(25) → full
  const mid = damageAtRange("rifle", 47);     // between
  const far = damageAtRange("rifle", 999);    // ≥ maxRange → floor
  const g = GUN_ARCHETYPES.rifle;
  assert.equal(close, g.baseDamage);                       // full at close
  assert.ok(mid < close && mid > far, "linear decay between the two points");
  assert.ok(far > 0, "floors above zero, never a dead bullet");
  assert.equal(far, g.baseDamage * g.minDamageFloor);
});

test("weapon classes specialize: shotgun steep+strong-close, rifle shallow", () => {
  // shotgun crushes point-blank (8 pellets), rifle wins at distance
  assert.ok(damageAtRange("shotgun", 2) > damageAtRange("rifle", 2));
  assert.ok(damageAtRange("rifle", 60) > damageAtRange("shotgun", 60));
});

test("recoil bloom: spread grows with sustained fire and saturates", () => {
  assert.equal(spreadAt("smg", 0), 0);
  assert.ok(spreadAt("smg", 10) > spreadAt("smg", 2));
  assert.ok(spreadAt("smg", 100) <= GUN_ARCHETYPES.smg.spreadBloom);
});

test("magazine: fire consumes a round, empties, reload refills + recovery window", () => {
  let mag = createMagazine("pistol");
  assert.equal(mag.rounds, 12);
  for (let i = 0; i < 12; i++) mag = fire(mag, 1000).mag;
  assert.equal(mag.rounds, 0);
  const empty = fire(mag, 1000);
  assert.equal(empty.ok, false);
  assert.equal(empty.needsReload, true);
  const r = reload(mag, 1000);
  assert.equal(r.mag.rounds, 12);
  assert.ok(r.reloadMs > 0);
  assert.equal(fire(r.mag, 1000).ok, false); // still in reload recovery window
  assert.equal(fire(r.mag, 1000 + r.reloadMs + 1).ok, true); // ready after recovery
});

test("ammo scarcity: a reload only loads what the player owns", () => {
  assert.equal(ammoItemFor("sniper"), "ammo_rifle");
  const partial = planReload("rifle", 7);
  assert.equal(partial.loaded, 7);
  assert.equal(partial.shortfall, 23);
  assert.equal(canFire({ magazineRounds: 0, reserveRounds: 0 }), false);
  assert.equal(canFire({ magazineRounds: 0, reserveRounds: 5 }), true);
});
