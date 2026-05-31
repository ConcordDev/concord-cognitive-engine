import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MOVEMENT_POWERS, getMovementPower, conflicts, tierForLevel, speedFor,
  drainPerSecFor, canActivate, drainTick,
} from "../lib/movement-powers.js";

// Universal Move System Phase 4 — movement powers: sustained gauge drain,
// level-gated, flight ⊥ super-speed don't stack (R4).

test("flight and super-speed conflict (no god-mobility stacking)", () => {
  assert.equal(conflicts("flight", "super_speed"), true);
  assert.equal(conflicts("super_speed", "flight"), true); // order-independent
  assert.equal(conflicts("flight", "web_swing"), false);
});

test("activation is level-gated + gauge-gated + world-gated (Pillar 2)", () => {
  // under-level
  assert.equal(canActivate({ power: "flight", skillLevel: 5, gauge: 100 }).ok, false);
  // not enough gauge
  assert.equal(canActivate({ power: "flight", skillLevel: 50, gauge: 2 }).ok, false);
  // crime world forbids innate powers
  assert.equal(canActivate({ power: "flight", skillLevel: 50, gauge: 100, worldAvailable: false }).reason, "world_forbids");
  // ok
  assert.equal(canActivate({ power: "flight", skillLevel: 50, gauge: 100 }).ok, true);
  // can't activate flight while super-speed is active
  assert.equal(canActivate({ power: "flight", skillLevel: 50, gauge: 100, activeNow: "super_speed" }).ok, false);
});

test("higher level → faster + sips less (the L200 freeway that drinks slowly)", () => {
  assert.ok(speedFor("ice_slide", 200) > speedFor("ice_slide", 1));
  assert.ok(drainPerSecFor("flight", 200) < drainPerSecFor("flight", 1));
  assert.equal(tierForLevel(1), 1);
  assert.equal(tierForLevel(1600), 5);
});

test("sustained drain runs the gauge down → deactivate (you fall)", () => {
  let g = 5;
  let res;
  for (let i = 0; i < 1000 && g > 0; i++) { res = drainTick({ power: "flight", gaugeRemaining: g, dtSec: 0.1, skillLevel: 50 }); g = res.gaugeRemaining; }
  assert.equal(g, 0);
  assert.equal(res.deactivate, true);
});

test("instant powers (blink/air_dash) don't drain over time", () => {
  assert.equal(drainTick({ power: "blink", gaugeRemaining: 50, dtSec: 1, skillLevel: 50 }).deactivate, false);
  assert.equal(MOVEMENT_POWERS.blink.drainPerSec, 0);
});

test("kill-switch CONCORD_MOVEMENT_POWERS=0 blocks activation", () => {
  const prev = process.env.CONCORD_MOVEMENT_POWERS;
  process.env.CONCORD_MOVEMENT_POWERS = "0";
  try {
    assert.equal(canActivate({ power: "flight", skillLevel: 99, gauge: 999 }).ok, false);
  } finally {
    if (prev === undefined) delete process.env.CONCORD_MOVEMENT_POWERS;
    else process.env.CONCORD_MOVEMENT_POWERS = prev;
  }
});

test("every power has an archetype that the move-render gate knows", () => {
  const known = new Set(["flight", "speed_trail", "surface_ride", "web_swing", "blink"]);
  for (const [name, p] of Object.entries(MOVEMENT_POWERS)) {
    assert.ok(known.has(p.archetype), `${name} → unknown archetype ${p.archetype}`);
  }
});
