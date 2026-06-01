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
  assert.equal(attackClassFor(undefined), "attack-light");
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
