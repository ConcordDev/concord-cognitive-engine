/**
 * R5 continuation — server-authoritative locomotion (idle/walk/run)
 * classification contract test.
 *
 * Gap this closes: `player:move` previously carried only a free-text
 * `action` string that was either hardcoded ("walk", always — the web
 * client) or binary idle/walk with no run branch at all (the pre-this-unit
 * Godot client, which had no sprint input). The server already computed a
 * real, authoritative `speedMps` from position deltas over server wall-clock
 * dt for every accepted move packet (the anti-cheat speed-hack gate), but
 * discarded it after the max-speed comparison. This pins:
 *   1. classifyLocomotion() — the pure idle/walk/run threshold + hysteresis
 *      function, using the SAME numbers animation_state_machine.gd already
 *      uses (IDLE_MAX_SPEED=0.05, RUN_MIN_SPEED=8.5, hysteresis=BLEND_BAND=1.5).
 *   2. updateUserPosition() derives + stores `.locomotion` on the presence
 *      entry from real per-packet speed, never a client claim, and carries
 *      the previous value forward on packets where no speed can be derived
 *      (first-ever packet, city transition, grace period, rejected packet).
 *   3. broadcastPositions()/getNearbyUsers() additively expose `.locomotion`
 *      without disturbing any existing field (back-compat).
 *
 * Run: node --test tests/city-presence-locomotion.test.js
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  configurePresence,
  updateUserPosition,
  getUserPosition,
  getNearbyUsers,
  broadcastPositions,
  removeUser,
  classifyLocomotion,
} from "../lib/city-presence.js";

let _prevEarnedSpeed;
before(() => {
  // Mirrors tests/mobility-modes.test.js's convention: force the legacy
  // static walk cap (16 m/s) so a simulated ~10-12 m/s "run" packet isn't
  // rejected by the (much lower, level-1-agility) earned-speed ceiling —
  // this suite is about locomotion CLASSIFICATION, not the earned-speed
  // system, so it isolates from it exactly like the existing precedent.
  _prevEarnedSpeed = process.env.CONCORD_EARNED_SPEED;
  process.env.CONCORD_EARNED_SPEED = "0";
});
after(() => {
  if (_prevEarnedSpeed === undefined) delete process.env.CONCORD_EARNED_SPEED;
  else process.env.CONCORD_EARNED_SPEED = _prevEarnedSpeed;
});

beforeEach(() => {
  configurePresence({ db: null, fireTrigger: null });
  for (const uid of ["u_loco_1", "u_loco_2", "u_loco_watcher"]) {
    try { removeUser(uid); } catch { /* not present, fine */ }
  }
});

// Simulate a move of `distanceM` metres over `dtMs` of real elapsed time by
// directly back-dating the live presence entry, exactly like
// tests/mobility-modes.test.js's documented pattern (getUserPosition returns
// the live stored reference, not a copy).
function moveOverTime(userId, { toX, dtMs, cityId = "c" }) {
  const entry = getUserPosition(userId);
  assert.ok(entry, "presence entry must exist before simulating elapsed time");
  entry.createdAt = Date.now() - 10_000; // clear the login grace period
  entry.lastUpdate = Date.now() - dtMs;
  return updateUserPosition(userId, { cityId, x: toX, y: 0, z: 0 });
}

describe("classifyLocomotion — pure thresholds", () => {
  it("classifies stationary/near-zero speed as idle", () => {
    assert.equal(classifyLocomotion(0), "idle");
    assert.equal(classifyLocomotion(0.04), "idle");
  });

  it("classifies speed just above the idle cutoff as walk", () => {
    assert.equal(classifyLocomotion(0.06), "walk");
    assert.equal(classifyLocomotion(5.0), "walk"); // MOVE_SPEED
    assert.equal(classifyLocomotion(8.4), "walk"); // just under the run boundary
  });

  it("classifies speed at/above the run boundary as run", () => {
    assert.equal(classifyLocomotion(8.5), "run"); // RUN_MIN_SPEED boundary itself
    assert.equal(classifyLocomotion(12.0), "run"); // RUN_SPEED
    assert.equal(classifyLocomotion(16.0), "run");
  });

  it("treats non-finite/garbage speed as idle rather than fabricating motion", () => {
    assert.equal(classifyLocomotion(NaN), "idle");
    assert.equal(classifyLocomotion(undefined), "idle");
    assert.equal(classifyLocomotion(-3), "idle"); // negative speed is nonsensical, floors to 0
  });

  it("hysteresis: once classified run, a dip below RUN_MIN_SPEED (but within the band) stays run", () => {
    // Band is [RUN_MIN_SPEED - 1.5, +inf) = [7.0, +inf) while already "run".
    assert.equal(classifyLocomotion(7.5, "run"), "run");
    assert.equal(classifyLocomotion(7.0, "run"), "run");
  });

  it("hysteresis: a dip below the band falls back to walk", () => {
    assert.equal(classifyLocomotion(6.9, "run"), "walk");
  });

  it("no hysteresis boost applies when the previous state was NOT run", () => {
    // Same 7.5 m/s that stayed "run" above is classified "walk" when coming
    // from idle/walk — the boost only protects an established run state.
    assert.equal(classifyLocomotion(7.5, "walk"), "walk");
    assert.equal(classifyLocomotion(7.5, null), "walk");
    assert.equal(classifyLocomotion(7.5, "idle"), "walk");
  });

  it("never flaps: a state pinned exactly at the run boundary stays stable across repeated calls", () => {
    // Regression against boundary-flapping: feed the exact same speed twice
    // in a row with the previous state honored each time.
    let state = null;
    for (let i = 0; i < 5; i++) state = classifyLocomotion(8.5, state);
    assert.equal(state, "run");
  });
});

describe("updateUserPosition — derives + stores real locomotion (not client-claimed)", () => {
  it("defaults a brand-new presence entry to idle (no speed to derive yet)", () => {
    const r = updateUserPosition("u_loco_1", { cityId: "c", x: 0, y: 0, z: 0 });
    assert.equal(r.ok, true);
    const entry = getUserPosition("u_loco_1");
    assert.equal(entry.locomotion, "idle");
  });

  it("classifies a walking-speed movement as walk", () => {
    updateUserPosition("u_loco_1", { cityId: "c", x: 0, y: 0, z: 0 });
    // 3m over 1s = 3 m/s — walking speed.
    const r = moveOverTime("u_loco_1", { toX: 3, dtMs: 1000 });
    assert.equal(r.ok, true);
    assert.equal(getUserPosition("u_loco_1").locomotion, "walk");
  });

  it("classifies a running-speed movement as run, even though the client never claimed 'run'", () => {
    updateUserPosition("u_loco_1", { cityId: "c", x: 0, y: 0, z: 0, action: "walk" });
    // 10m over 1s = 10 m/s — above RUN_MIN_SPEED (8.5), well under the 16 m/s
    // legacy walk-mode cap. The caller passed action:"walk" — the server
    // must NOT trust that string; the derived label must be "run".
    const r = moveOverTime("u_loco_1", { toX: 10, dtMs: 1000 });
    assert.equal(r.ok, true);
    assert.equal(getUserPosition("u_loco_1").locomotion, "run");
  });

  it("a rejected (speed-hack) packet leaves the previous locomotion untouched", () => {
    updateUserPosition("u_loco_1", { cityId: "c", x: 0, y: 0, z: 0 });
    moveOverTime("u_loco_1", { toX: 3, dtMs: 1000 }); // walk
    assert.equal(getUserPosition("u_loco_1").locomotion, "walk");

    // 30m in 1s = 30 m/s — above the 16 m/s legacy walk cap but well under
    // the single-frame teleport ceiling (maxSpeed * FRAME_DISTANCE_RATIO =
    // 256m), so this trips "speed_hack_detected" specifically, not
    // "teleport_detected". Must be rejected, and locomotion must stay
    // "walk" (nothing about this packet is trusted).
    const entry = getUserPosition("u_loco_1");
    entry.lastUpdate = Date.now() - 1000;
    const rejected = updateUserPosition("u_loco_1", { cityId: "c", x: 33, y: 0, z: 0 });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, "speed_hack_detected");
    assert.equal(getUserPosition("u_loco_1").locomotion, "walk");
  });

  it("a city-transition packet (speed check skipped) carries the previous locomotion forward", () => {
    updateUserPosition("u_loco_1", { cityId: "c1", x: 0, y: 0, z: 0 });
    moveOverTime("u_loco_1", { toX: 10, dtMs: 1000, cityId: "c1" }); // run
    assert.equal(getUserPosition("u_loco_1").locomotion, "run");

    const entry = getUserPosition("u_loco_1");
    entry.lastUpdate = Date.now() - 1000;
    const r = updateUserPosition("u_loco_1", { cityId: "c2", x: 9999, y: 0, z: 0 });
    assert.equal(r.ok, true);
    // Teleport-by-city-change is allowed (portal/travel); locomotion can't be
    // derived from this jump, so it must carry forward, not reset or guess.
    assert.equal(getUserPosition("u_loco_1").locomotion, "run");
  });

  it("hysteresis persists in the live per-user flow: a slight dip below the boundary stays run, a real drop falls to walk", () => {
    updateUserPosition("u_loco_1", { cityId: "c", x: 0, y: 0, z: 0 });
    moveOverTime("u_loco_1", { toX: 10, dtMs: 1000 }); // 10 m/s -> run
    assert.equal(getUserPosition("u_loco_1").locomotion, "run");

    // Next packet: 7.5 m/s (below RUN_MIN_SPEED 8.5 but within the 1.5 m/s
    // hysteresis band) — must stay "run".
    moveOverTime("u_loco_1", { toX: 17.5, dtMs: 1000 });
    assert.equal(getUserPosition("u_loco_1").locomotion, "run");

    // Next packet: 2 m/s — a real drop, well outside the band — must fall
    // back to "walk".
    moveOverTime("u_loco_1", { toX: 19.5, dtMs: 1000 });
    assert.equal(getUserPosition("u_loco_1").locomotion, "walk");
  });
});

describe("broadcastPositions / getNearbyUsers — additive `locomotion` field", () => {
  it("broadcastPositions includes locomotion without dropping existing fields", () => {
    updateUserPosition("u_loco_1", { cityId: "broadcast_loco_city", x: 0, y: 0, z: 0 });
    moveOverTime("u_loco_1", { toX: 10, dtMs: 1000, cityId: "broadcast_loco_city" }); // run

    const emitted = [];
    broadcastPositions("broadcast_loco_city", (evt, data) => emitted.push({ evt, data }));
    const payload = emitted.find((e) => e.evt === "city:positions");
    assert.ok(payload, "expected a city:positions event");
    const row = payload.data.users.find((u) => u.userId === "u_loco_1");
    assert.ok(row, "expected the user in the broadcast");
    assert.equal(row.locomotion, "run");
    // Existing fields untouched (back-compat).
    assert.equal(typeof row.x, "number");
    assert.ok("action" in row);
    assert.ok("mode" in row);
  });

  it("getNearbyUsers includes locomotion for other users", () => {
    updateUserPosition("u_loco_1", { cityId: "nearby_loco_city", x: 0, y: 0, z: 0 });
    updateUserPosition("u_loco_2", { cityId: "nearby_loco_city", x: 1, y: 0, z: 1 });
    moveOverTime("u_loco_2", { toX: 11, dtMs: 1000, cityId: "nearby_loco_city" }); // run, position (11, 0, 0) — still within default 500m radius

    const results = getNearbyUsers("u_loco_1");
    const other = results.find((u) => u.userId === "u_loco_2");
    assert.ok(other, "expected u_loco_2 in u_loco_1's nearby list");
    assert.equal(other.locomotion, "run");
  });
});
