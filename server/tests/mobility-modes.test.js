/**
 * Godot Phase 3a — server-side mobility-mode substrate contract tests.
 *
 * Covers:
 *  1. modeSpeedCap() per-mode speed values (pure function).
 *  2. The core anti-cheat contract: updateUserPosition() accepts
 *     mount-speed movement WHEN the tracked mode is a legitimate mount,
 *     but REJECTS the identical movement when the tracked mode is "walk".
 *  3. Mode-legitimacy checks (mirroring the player:mode socket handler in
 *     server.js) using the REAL underlying primitives
 *     (getActiveMountPayload, cityPresence.getUserVehicle) — a mount/
 *     vehicle claim that doesn't match reality is rejected.
 *  4. city-presence tracks + exposes the mode (getUserMovementMode,
 *     broadcastPositions payload).
 *
 * Run: node --test tests/mobility-modes.test.js
 *
 * Note on (3): the actual dispatch lives in an inline `socket.on("player:mode", ...)`
 * handler inside server.js (a ~90k-line file not meaningfully unit-testable in
 * isolation without booting a full socket.io + HTTP server). Following the
 * documented precedent in tests/combat-anti-cheat.test.js, this file exercises
 * the REAL exported primitives the handler is built from and reproduces its
 * documented accept/reject shape locally — a drift between this replica and
 * server.js's handler is itself a finding.
 */

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  configurePresence,
  updateUserPosition,
  setUserMovementMode,
  setUserVehicle,
  getUserVehicle,
  getUserMovementMode,
  getUserPosition,
  isUserFlying,
  modeSpeedCap,
  getMaxSpeedForVehicle,
  removeUser,
  broadcastPositions,
} from "../lib/city-presence.js";
import { getActiveMountPayload } from "../lib/companions-mount.js";

// ── Minimal schema for the mount tables the mount-legitimacy checks read.
// Mirrors migrations 104 (player_companions) + 142 (mount_species,
// mounted_instances, player_companions.mount_eligible) at the columns these
// helpers actually SELECT — hand-rolled per this test-suite's existing
// convention (see tests/vehicles.test.js, tests/combat-anti-cheat.test.js)
// rather than running the full migration chain.
function setupMountDB() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id       TEXT PRIMARY KEY,
      world_id TEXT,
      archetype TEXT
    );
    CREATE TABLE player_companions (
      id             TEXT PRIMARY KEY,
      owner_id       TEXT NOT NULL,
      creature_id    TEXT NOT NULL,
      name           TEXT NOT NULL,
      mount_eligible INTEGER NOT NULL DEFAULT 0,
      mount_state    TEXT,
      world_id       TEXT NOT NULL DEFAULT 'concordia-hub'
    );
    CREATE TABLE mount_species (
      species_id             TEXT PRIMARY KEY,
      display_name           TEXT NOT NULL,
      size_class             TEXT NOT NULL DEFAULT 'medium',
      base_speed_mps         REAL NOT NULL,
      base_stamina           REAL NOT NULL DEFAULT 100,
      carry_capacity_kg      REAL NOT NULL DEFAULT 50,
      gait_profile_id        TEXT,
      rider_seat_offset_json TEXT NOT NULL DEFAULT '{}',
      saddle_anchor_bone     TEXT NOT NULL DEFAULT 'spine_03',
      reins_anchor_bone      TEXT NOT NULL DEFAULT 'head',
      flight_capable         INTEGER NOT NULL DEFAULT 0,
      aesthetic_tags_json    TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE mounted_instances (
      id                 TEXT PRIMARY KEY,
      rider_id           TEXT NOT NULL,
      mount_companion_id TEXT NOT NULL,
      world_id           TEXT NOT NULL DEFAULT 'concordia-hub',
      mounted_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      dismounted_at      INTEGER,
      seat_offset_json   TEXT
    );
  `);
  return db;
}

// ── Local replica of the player:mode handler's legitimacy branches.
// Uses the REAL exported primitives; this is orchestration logic only, not
// a re-implementation of the underlying checks themselves.
function validateModeRequest(db, userId, requested, worldId = "concordia-hub") {
  if (requested === "walk" || requested === "sprint" || requested === "fly") {
    return { ok: true }; // unconditional, per server.js's documented contract
  }
  if (requested.startsWith("mount:")) {
    const speciesId = requested.slice("mount:".length);
    const payload = getActiveMountPayload(db, userId, worldId);
    if (!payload || !payload.speciesId || payload.speciesId !== speciesId) {
      return { ok: false, reason: "not_mounted" };
    }
    return { ok: true, mountSpeedMps: payload.species?.baseSpeedMps ?? null };
  }
  if (requested.startsWith("vehicle:")) {
    const vehicleType = requested.slice("vehicle:".length);
    const current = getUserVehicle(userId);
    if (!current.vehicleId || current.vehicleType !== vehicleType) {
      return { ok: false, reason: "not_in_vehicle" };
    }
    return { ok: true };
  }
  return { ok: false, reason: "unknown_mode" };
}

describe("modeSpeedCap — pure per-mode speed lookup", () => {
  it("walk matches the legacy static on-foot ceiling (16 m/s)", () => {
    assert.equal(modeSpeedCap("walk"), 16);
    assert.equal(modeSpeedCap("walk"), getMaxSpeedForVehicle("walk"));
  });

  it("sprint is a named factor faster than walk", () => {
    assert.equal(modeSpeedCap("sprint"), 24); // 16 * 1.5
    assert.ok(modeSpeedCap("sprint") > modeSpeedCap("walk"));
  });

  it("fly uses a named flight cap between car and glider", () => {
    const fly = modeSpeedCap("fly");
    assert.equal(fly, 45);
    assert.ok(fly > getMaxSpeedForVehicle("car"));
    assert.ok(fly < getMaxSpeedForVehicle("glider"));
  });

  it("vehicle:<type> delegates to the existing vehicle table (byte-identical)", () => {
    assert.equal(modeSpeedCap("vehicle:car"), 40);
    assert.equal(modeSpeedCap("vehicle:glider"), 60);
    assert.equal(modeSpeedCap("vehicle:plane"), 150);
    assert.equal(modeSpeedCap("vehicle:rocket"), 16); // unknown vehicle type -> walk fallback
  });

  it("mount:<speciesId> uses the supplied species speed, never trusting an absent/invalid one", () => {
    assert.equal(modeSpeedCap("mount:dragon", { mountSpeedMps: 22 }), 22);
    assert.equal(modeSpeedCap("mount:dragon", {}), 16); // no context supplied -> conservative fallback
    assert.equal(modeSpeedCap("mount:dragon", { mountSpeedMps: -5 }), 16); // invalid -> fallback
    assert.equal(modeSpeedCap("mount:dragon", { mountSpeedMps: 0 }), 16); // zero -> fallback
  });

  it("an unrecognized mode string falls back to the most conservative (walk) cap", () => {
    assert.equal(modeSpeedCap("teleport_hack"), 16);
    assert.equal(modeSpeedCap(undefined), 16);
    assert.equal(modeSpeedCap(""), 16);
  });
});

describe("updateUserPosition — mode-aware anti-cheat (core contract)", () => {
  const userId = "mobility_test_user";
  let _prevEarnedSpeed;

  beforeEach(() => {
    configurePresence({ db: null });
    removeUser(userId);
    // Disable the agility-scaled on-foot cap so "walk" resolves to the
    // deterministic static 16 m/s ceiling (modeSpeedCap("walk")) instead of
    // a DB-derived value — isolates the mode-gating contract under test
    // from the separate Speedster S1 feature.
    _prevEarnedSpeed = process.env.CONCORD_EARNED_SPEED;
    process.env.CONCORD_EARNED_SPEED = "0";
  });

  after(() => {
    if (_prevEarnedSpeed === undefined) delete process.env.CONCORD_EARNED_SPEED;
    else process.env.CONCORD_EARNED_SPEED = _prevEarnedSpeed;
  });

  it("rejects mount-speed movement while tracked mode is walk, but accepts the SAME movement once legitimately in mount mode", () => {
    // Establish a baseline position.
    const first = updateUserPosition(userId, { cityId: "c", x: 0, y: 0, z: 0 });
    assert.equal(first.ok, true);
    assert.equal(getUserMovementMode(userId), "walk"); // default mode

    const entry = getUserPosition(userId);
    assert.ok(entry, "presence entry must exist after the first move");
    // Deterministically simulate ~2s of elapsed time and bypass the
    // post-login grace window — getUserPosition returns the live stored
    // reference (not a copy), so mutating it here is exactly equivalent to
    // real wall-clock time having passed.
    entry.createdAt = Date.now() - 10_000;
    entry.lastUpdate = Date.now() - 2_000;

    const lastUpdateBeforeAttempt = entry.lastUpdate;

    // distance 38m over ~2s ≈ 19 m/s: above the walk cap (16) but below a
    // dragon mount's cap (22) — the same physical movement must be judged
    // differently depending on the tracked mode.
    const walkAttempt = updateUserPosition(userId, { cityId: "c", x: 38, y: 0, z: 0 });
    assert.equal(walkAttempt.ok, false);
    assert.equal(walkAttempt.reason, "speed_hack_detected");
    assert.equal(walkAttempt.mode, "walk");

    // Rejected — the entry (position, lastUpdate, createdAt) must be untouched.
    assert.equal(entry.x, 0);
    assert.equal(entry.lastUpdate, lastUpdateBeforeAttempt);

    // Now legitimately switch into mount mode with the ridden species' real
    // speed (as the player:mode handler would after validating an active
    // mounted_instances row) and re-arm the same deterministic dt.
    setUserMovementMode(userId, "mount:dragon", { mountSpeedMps: 22 });
    assert.equal(getUserMovementMode(userId), "mount:dragon");
    entry.createdAt = Date.now() - 10_000;
    entry.lastUpdate = Date.now() - 2_000;

    const mountAttempt = updateUserPosition(userId, { cityId: "c", x: 38, y: 0, z: 0 });
    assert.equal(mountAttempt.ok, true);
    assert.equal(entry.movementMode, "mount:dragon");
  });

  it("vehicle mode raises the cap exactly like the legacy vehicleType path did", () => {
    removeUser(userId);
    updateUserPosition(userId, { cityId: "c", x: 0, y: 0, z: 0 });
    setUserVehicle(userId, { vehicleId: "veh1", vehicleType: "plane" });
    assert.equal(getUserMovementMode(userId), "vehicle:plane");

    const entry = getUserPosition(userId);
    entry.createdAt = Date.now() - 10_000;
    entry.lastUpdate = Date.now() - 1_000;

    // 100 m/s is within the plane cap (150) — should be accepted.
    const r = updateUserPosition(userId, { cityId: "c", x: 100, y: 0, z: 0 });
    assert.equal(r.ok, true);
  });

  it("flightActive tracks the fly mode and clears on dismount/mode-change", () => {
    removeUser(userId);
    updateUserPosition(userId, { cityId: "c", x: 0, y: 0, z: 0 });
    assert.equal(isUserFlying(userId), false);
    setUserMovementMode(userId, "fly", {});
    assert.equal(isUserFlying(userId), true);
    assert.equal(getUserMovementMode(userId), "fly");
    setUserMovementMode(userId, "walk", {});
    assert.equal(isUserFlying(userId), false);
  });
});

describe("player:mode legitimacy checks (mount/vehicle claims validated against reality)", () => {
  let db;

  beforeEach(() => {
    db = setupMountDB();
    configurePresence({ db: null }); // presence itself stays in-memory/independent of this DB
  });

  it("walk / sprint / fly requests are always accepted (no external capability needed)", () => {
    assert.equal(validateModeRequest(db, "anyUser", "walk").ok, true);
    assert.equal(validateModeRequest(db, "anyUser", "sprint").ok, true);
    assert.equal(validateModeRequest(db, "anyUser", "fly").ok, true); // TODO(Phase 3b): unchecked today, by design
  });

  it("accepts mount:<speciesId> ONLY when a real active mounted_instances row for that species exists", () => {
    db.exec(`
      INSERT INTO world_npcs (id, world_id, archetype) VALUES ('creature1', 'concordia-hub', 'creature:dragon');
      INSERT INTO mount_species (species_id, display_name, base_speed_mps) VALUES ('dragon', 'Dragon', 22);
      INSERT INTO player_companions (id, owner_id, creature_id, name, mount_eligible)
        VALUES ('comp1', 'u1', 'creature1', 'Rex', 1);
      INSERT INTO mounted_instances (id, rider_id, mount_companion_id, world_id, dismounted_at)
        VALUES ('mi1', 'u1', 'comp1', 'concordia-hub', NULL);
    `);

    const legit = validateModeRequest(db, "u1", "mount:dragon");
    assert.equal(legit.ok, true);
    assert.equal(legit.mountSpeedMps, 22);

    // Claiming a DIFFERENT species while actually mounted on the dragon
    // must be rejected — the species in the claim must match reality.
    const wrongSpecies = validateModeRequest(db, "u1", "mount:phoenix");
    assert.equal(wrongSpecies.ok, false);
    assert.equal(wrongSpecies.reason, "not_mounted");

    // A user with no mounted_instances row at all gets rejected outright.
    const noMount = validateModeRequest(db, "u2_never_mounted", "mount:dragon");
    assert.equal(noMount.ok, false);
    assert.equal(noMount.reason, "not_mounted");
  });

  it("accepts vehicle:<type> ONLY when presence already reflects a validated vehicle mount of that type", () => {
    // Simulates the real flow: routes/vehicles.js only calls setUserVehicle
    // AFTER validateOwnership(db, vehicleId, userId) passes.
    setUserVehicle("u3", { vehicleId: "veh1", vehicleType: "car" });

    const legit = validateModeRequest(db, "u3", "vehicle:car");
    assert.equal(legit.ok, true);

    // Claiming a vehicle type that doesn't match what's actually mounted.
    const wrongType = validateModeRequest(db, "u3", "vehicle:plane");
    assert.equal(wrongType.ok, false);
    assert.equal(wrongType.reason, "not_in_vehicle");

    // A user who never mounted any vehicle.
    const neverMounted = validateModeRequest(db, "u4_never_drove", "vehicle:car");
    assert.equal(neverMounted.ok, false);
    assert.equal(neverMounted.reason, "not_in_vehicle");
  });

  it("rejects an unrecognized mode family outright", () => {
    const r = validateModeRequest(db, "anyUser", "noclip:god");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_mode");
  });
});

describe("city-presence tracks + exposes mode", () => {
  beforeEach(() => {
    configurePresence({ db: null });
  });

  it("getUserMovementMode defaults to walk for a user with no presence yet", () => {
    removeUser("ghost_user_never_present");
    assert.equal(getUserMovementMode("ghost_user_never_present"), "walk");
  });

  it("broadcastPositions includes an additive `mode` field per user without dropping existing fields", () => {
    const userId = "broadcast_mode_user";
    removeUser(userId);
    updateUserPosition(userId, { cityId: "broadcast_city", x: 1, y: 0, z: 1 });
    setUserMovementMode(userId, "sprint", {});

    const emitted = [];
    broadcastPositions("broadcast_city", (evt, data) => emitted.push({ evt, data }));

    assert.ok(emitted.length > 0, "expected at least one city:positions emit");
    const payload = emitted.find((e) => e.evt === "city:positions");
    assert.ok(payload, "expected a city:positions event");
    const userRow = payload.data.users.find((u) => u.userId === userId);
    assert.ok(userRow, "expected the user to appear in the broadcast");
    assert.equal(userRow.mode, "sprint");
    // Existing fields must still be present (back-compat).
    assert.equal(typeof userRow.x, "number");
    assert.ok("vehicleType" in userRow);
  });
});
