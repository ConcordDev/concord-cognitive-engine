// T2.9 — per-action-class attack cooldown: a kick chained after a light must
// LAND (independent tracks), while raw spam of one class is still gated and a
// global floor prevents dumping every class on one frame.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attackClassFor, newCooldownState, checkAttackCooldown,
  ATTACK_COOLDOWN_MS, ATTACK_GLOBAL_FLOOR_MS,
} from "../lib/combat/attack-cooldown.js";

test("attackClassFor maps styles to classes", () => {
  assert.equal(attackClassFor("attack-light"), "attack-light");
  assert.equal(attackClassFor("attack-heavy"), "attack-heavy");
  assert.equal(attackClassFor("vehicle-ram"), "attack-heavy");
  assert.equal(attackClassFor("air-dive"), "attack-heavy");
  assert.equal(attackClassFor("kick"), "kick");
  assert.equal(attackClassFor("dismount-kick"), "kick");
  assert.equal(attackClassFor("grab"), "grab");
  assert.equal(attackClassFor("hack-breach"), "grab");
  assert.equal(attackClassFor("fire"), "fire");
  assert.equal(attackClassFor(undefined), "attack-light");
});

test("ranged fire has its own independent cooldown track from melee", () => {
  const s = newCooldownState();
  let now = 2000;
  assert.equal(checkAttackCooldown(s, now, "attack-light").allowed, true, "light fires");
  // Past the global floor, light cooldown not elapsed — a 'fire' shot right
  // after should still land because it's a distinct class, same guarantee
  // T2.9 already gives kick/grab.
  now += 150;
  const shot = checkAttackCooldown(s, now, "fire");
  assert.equal(shot.allowed, true, "fire after light lands — independent track");
  assert.equal(shot.cls, "fire");
});

test("spamming fire is still gated by its own cooldown", () => {
  const s = newCooldownState();
  let now = 6000;
  assert.equal(checkAttackCooldown(s, now, "fire").allowed, true);
  now += ATTACK_COOLDOWN_MS.fire - 30;
  assert.equal(checkAttackCooldown(s, now, "fire").allowed, false, "second shot gated before cooldown elapses");
  now += 40;
  assert.equal(checkAttackCooldown(s, now, "fire").allowed, true, "shot fires once cooldown elapses");
});

test("a kick chained after a light LANDS (independent class tracks)", () => {
  const s = newCooldownState();
  let now = 1000;
  assert.equal(checkAttackCooldown(s, now, "attack-light").allowed, true, "light fires");
  // 150ms later: past the global floor (120), light cooldown (250) not elapsed,
  // but kick is a different class → it lands (the bug this fixes).
  now += 150;
  const kick = checkAttackCooldown(s, now, "kick");
  assert.equal(kick.allowed, true, "kick after light lands — was dropped before");
  assert.equal(kick.cls, "kick");
});

test("spamming the SAME class is gated by its cooldown", () => {
  const s = newCooldownState();
  let now = 5000;
  assert.equal(checkAttackCooldown(s, now, "attack-light").allowed, true);
  now += 200; // < 250ms light cooldown
  assert.equal(checkAttackCooldown(s, now, "attack-light").allowed, false, "second light gated");
  now += 60; // total 260ms ≥ 250
  assert.equal(checkAttackCooldown(s, now, "attack-light").allowed, true, "light fires after cooldown");
});

test("global anti-spam floor blocks dumping every class on one frame", () => {
  const s = newCooldownState();
  const now = 9000;
  assert.equal(checkAttackCooldown(s, now, "attack-light").allowed, true);
  // Same instant, different class — global floor (120ms) blocks it.
  assert.equal(checkAttackCooldown(s, now, "kick").allowed, false, "floor blocks same-frame second class");
  assert.equal(checkAttackCooldown(s, now + ATTACK_GLOBAL_FLOOR_MS, "kick").allowed, true, "lands after the floor");
});

test("heavy has a longer cooldown than light", () => {
  assert.ok(ATTACK_COOLDOWN_MS["attack-heavy"] > ATTACK_COOLDOWN_MS["attack-light"]);
});
