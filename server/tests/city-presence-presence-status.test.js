/**
 * city-presence presence-status contract test (V1.2 Wave A — Society &
 * Presence).
 *
 * Pins the `setUserPresenceStatus`/`getUserPresenceStatus` contract:
 *   - a brand-new / never-moved user defaults to "available"
 *   - a valid status round-trips (set → get)
 *   - an invalid status is rejected and leaves the prior value unchanged
 *   - status survives a plain position update (same non-reset contract as
 *     `visibility`/`movementMode`)
 *   - status is additively surfaced in getNearbyUsers() results and the
 *     broadcastPositions() shared payload, without disturbing any existing
 *     field
 *   - getPresenceForUsers() is the id-based (NOT radius-based) lookup
 *     lightweight groups use: it returns presence for exactly the ids
 *     asked for regardless of real distance between them, and it respects
 *     the ghost/hidden visibility contract (coords withheld, status/online
 *     still shown) exactly like every distance-based query already does.
 *
 * Run: node --test tests/city-presence-presence-status.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  configurePresence,
  updateUserPosition,
  getNearbyUsers,
  broadcastPositions,
  setUserPresenceStatus,
  getUserPresenceStatus,
  setUserVisibility,
  getPresenceForUsers,
  removeUser,
  PRESENCE_STATUS,
} from "../lib/city-presence.js";

const USERS = ["u_alice", "u_bob", "u_carl"];

beforeEach(() => {
  configurePresence({ db: null, fireTrigger: null });
  for (const uid of USERS) {
    try { removeUser(uid); } catch { /* not present, fine */ }
  }
});

describe("setUserPresenceStatus / getUserPresenceStatus — basic contract", () => {
  it("defaults to available for a brand-new presence entry", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    assert.equal(getUserPresenceStatus("u_alice"), PRESENCE_STATUS.AVAILABLE);
    removeUser("u_alice");
  });

  it("defaults to available for a user with no presence at all", () => {
    assert.equal(getUserPresenceStatus("u_never_moved"), PRESENCE_STATUS.AVAILABLE);
  });

  it("creates a stub presence entry when set before any position update", () => {
    const applied = setUserPresenceStatus("u_early_status", PRESENCE_STATUS.BUSY);
    assert.equal(applied, true);
    assert.equal(getUserPresenceStatus("u_early_status"), PRESENCE_STATUS.BUSY);
    removeUser("u_early_status");
  });

  for (const status of ["away", "busy", "dnd", "available"]) {
    it(`round-trips "${status}"`, () => {
      updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
      const applied = setUserPresenceStatus("u_alice", status);
      assert.equal(applied, true);
      assert.equal(getUserPresenceStatus("u_alice"), status);
      removeUser("u_alice");
    });
  }

  it("rejects an unrecognized status and leaves the prior value unchanged", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    setUserPresenceStatus("u_alice", "busy");
    const applied = setUserPresenceStatus("u_alice", "raging");
    assert.equal(applied, false);
    assert.equal(getUserPresenceStatus("u_alice"), "busy", "invalid status must not overwrite the prior valid one");
    removeUser("u_alice");
  });

  it("rejects a missing userId", () => {
    assert.equal(setUserPresenceStatus(null, "away"), false);
  });

  it("survives a plain position update (same non-reset contract as visibility)", () => {
    updateUserPosition("u_carl", { cityId: "c1", x: 0, y: 0, z: 0 });
    setUserPresenceStatus("u_carl", "dnd");
    updateUserPosition("u_carl", { cityId: "c1", x: 1, y: 0, z: 1 });
    assert.equal(getUserPresenceStatus("u_carl"), "dnd", "status must survive a plain move update");
    removeUser("u_carl");
  });
});

describe("presence status surfaces additively in getNearbyUsers / broadcastPositions", () => {
  it("getNearbyUsers includes the other user's presenceStatus without dropping existing fields", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u_bob", { cityId: "c1", x: 5, y: 0, z: 5 });
    setUserPresenceStatus("u_bob", "busy");

    const nearby = getNearbyUsers("u_alice");
    const bob = nearby.find((u) => u.userId === "u_bob");
    assert.ok(bob, "u_bob must appear in u_alice's nearby list");
    assert.equal(bob.presenceStatus, "busy");
    // Existing fields still present (additive, not a replacement).
    assert.equal(typeof bob.x, "number");
    assert.equal(typeof bob.locomotion, "string");

    removeUser("u_alice");
    removeUser("u_bob");
  });

  it("defaults presenceStatus to available for a nearby user who never set one", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u_bob", { cityId: "c1", x: 5, y: 0, z: 5 });
    const nearby = getNearbyUsers("u_alice");
    const bob = nearby.find((u) => u.userId === "u_bob");
    assert.equal(bob.presenceStatus, PRESENCE_STATUS.AVAILABLE);
    removeUser("u_alice");
    removeUser("u_bob");
  });

  it("broadcastPositions carries presenceStatus in the shared payload", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 20, y: 0, z: 20 });
    updateUserPosition("u_bob", { cityId: "c1", x: 22, y: 0, z: 22 });
    setUserPresenceStatus("u_bob", "away");

    const emitted = [];
    broadcastPositions("c1", (event, data) => emitted.push({ event, data }));

    const users = emitted.filter((e) => e.event === "city:positions").flatMap((e) => e.data.users);
    const bob = users.find((u) => u.userId === "u_bob");
    assert.ok(bob, "u_bob must be in the broadcast payload");
    assert.equal(bob.presenceStatus, "away");

    removeUser("u_alice");
    removeUser("u_bob");
  });
});

describe("getPresenceForUsers — id-based lookup, regardless of proximity", () => {
  it("returns presence for far-apart users with no distance filtering at all", () => {
    // Put alice and bob ~1.1km apart (each axis still inside the ±1000m
    // world-bounds envelope city-presence.js clamps to — math-safety.js's
    // clampToWorldBounds would otherwise silently reset an out-of-envelope
    // coordinate back to the origin, which would defeat this test) — far
    // outside getNearbyUsers' default 500m radius, to prove this lookup is
    // purely id-based, unlike every distance-scoped query in this file.
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u_bob", { cityId: "c1", x: 800, y: 0, z: 800 });
    setUserPresenceStatus("u_bob", "busy");

    // Sanity: they are NOT mutually visible via the distance-scoped query.
    assert.equal(getNearbyUsers("u_alice").some((u) => u.userId === "u_bob"), false);

    const presence = getPresenceForUsers(["u_alice", "u_bob"]);
    const alice = presence.find((p) => p.userId === "u_alice");
    const bob = presence.find((p) => p.userId === "u_bob");
    assert.ok(alice && bob, "both far-apart users must be present in the result");
    assert.equal(alice.online, true);
    assert.equal(bob.online, true);
    assert.equal(bob.presenceStatus, "busy");
    assert.equal(bob.x, 800, "coordinates must be returned even though the pair is far apart");

    removeUser("u_alice");
    removeUser("u_bob");
  });

  it("reports online:false for a userId with no live presence, without throwing", () => {
    const presence = getPresenceForUsers(["u_never_moved"]);
    assert.equal(presence.length, 1);
    assert.equal(presence[0].online, false);
    assert.equal(presence[0].presenceStatus, PRESENCE_STATUS.AVAILABLE);
  });

  it("returns an empty array for non-array input", () => {
    assert.deepEqual(getPresenceForUsers(null), []);
    assert.deepEqual(getPresenceForUsers(undefined), []);
  });

  it("withholds coordinates for a hidden (ghost) user but still reports online + status", () => {
    updateUserPosition("u_bob", { cityId: "c1", x: 42, y: 0, z: 7 });
    setUserPresenceStatus("u_bob", "dnd");
    setUserVisibility("u_bob", "hidden");

    const [bob] = getPresenceForUsers(["u_bob"]);
    assert.equal(bob.online, true, "a hidden user is still online — visibility ≠ offline");
    assert.equal(bob.hidden, true);
    assert.equal(bob.x, null, "coordinates must be withheld for a hidden user, same as any other presence query");
    assert.equal(bob.y, null);
    assert.equal(bob.z, null);
    assert.equal(bob.cityId, null);
    assert.equal(bob.presenceStatus, "dnd", "status is not gated by visibility, only location is");

    removeUser("u_bob");
  });
});
