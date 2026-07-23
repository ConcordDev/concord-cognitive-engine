/**
 * city-presence privacy (ghost / appear-offline mode) contract test.
 *
 * Audit item #27: getNearbyUsers/getPlayersNear/getPlayersInCell and the
 * `city:positions` broadcast payload had zero visibility controls. This pins
 * the `setUserVisibility`/`getUserVisibility` contract:
 *   - a `hidden` user is excluded from what OTHER users see them as
 *     (getNearbyUsers / getPlayersNear / getPlayersInCell results, and the
 *     shared broadcast payload array built in broadcastPositions)
 *   - a `hidden` user's OWN self-query is completely unaffected — hidden
 *     only changes how you're seen, never what you see
 *   - toggling back to `visible` restores them everywhere
 *
 * Run: node --test tests/city-presence-visibility.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  configurePresence,
  updateUserPosition,
  getNearbyUsers,
  getPlayersNear,
  getPlayersInCell,
  setUserVisibility,
  getUserVisibility,
  broadcastPositions,
  removeUser,
  PRESENCE_VISIBILITY,
} from "../lib/city-presence.js";

beforeEach(() => {
  configurePresence({ db: null, fireTrigger: null });
  // Best-effort isolation from any leftover users of prior test files running
  // in the same process — remove anything this suite is about to reuse.
  for (const uid of ["u_alice", "u_bob", "u_carl"]) {
    try { removeUser(uid); } catch { /* not present, fine */ }
  }
});

describe("setUserVisibility / getUserVisibility — basic contract", () => {
  it("defaults to visible for a brand-new presence entry", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    assert.equal(getUserVisibility("u_alice"), PRESENCE_VISIBILITY.VISIBLE);
    removeUser("u_alice");
  });

  it("defaults to visible for a user with no presence at all", () => {
    assert.equal(getUserVisibility("u_never_moved"), PRESENCE_VISIBILITY.VISIBLE);
  });

  it("setUserVisibility('hidden') flips the entry and is readable back", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    const applied = setUserVisibility("u_alice", "hidden");
    assert.equal(applied, true);
    assert.equal(getUserVisibility("u_alice"), PRESENCE_VISIBILITY.HIDDEN);
    removeUser("u_alice");
  });

  it("creates a stub presence entry when hiding before any position update (mirrors setUserMovementMode)", () => {
    const applied = setUserVisibility("u_ghost_early", "hidden");
    assert.equal(applied, true);
    assert.equal(getUserVisibility("u_ghost_early"), PRESENCE_VISIBILITY.HIDDEN);
    removeUser("u_ghost_early");
  });

  it("rejects an unrecognized mode string and leaves visibility unchanged", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    const applied = setUserVisibility("u_alice", "invisible-typo");
    assert.equal(applied, false);
    assert.equal(getUserVisibility("u_alice"), PRESENCE_VISIBILITY.VISIBLE);
    removeUser("u_alice");
  });
});

describe("getNearbyUsers — hidden exclusion", () => {
  it("a hidden user is excluded from another user's getNearbyUsers", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u_bob", { cityId: "c1", x: 5, y: 0, z: 5 });
    setUserVisibility("u_bob", "hidden");

    const nearbyForAlice = getNearbyUsers("u_alice");
    assert.equal(
      nearbyForAlice.some((u) => u.userId === "u_bob"),
      false,
      "hidden user u_bob must not appear in u_alice's nearby list"
    );

    removeUser("u_alice");
    removeUser("u_bob");
  });

  it("a visible user IS included in another user's getNearbyUsers", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u_bob", { cityId: "c1", x: 5, y: 0, z: 5 });
    // u_bob stays default-visible (no setUserVisibility call)

    const nearbyForAlice = getNearbyUsers("u_alice");
    assert.equal(
      nearbyForAlice.some((u) => u.userId === "u_bob"),
      true,
      "visible user u_bob must appear in u_alice's nearby list"
    );

    removeUser("u_alice");
    removeUser("u_bob");
  });

  it("a hidden user still sees everyone else in THEIR OWN getNearbyUsers query", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u_bob", { cityId: "c1", x: 5, y: 0, z: 5 });
    setUserVisibility("u_bob", "hidden"); // u_bob is the hidden one

    // u_bob's own query for what's near THEM must still return u_alice —
    // hidden only affects how others see u_bob, not what u_bob sees.
    const nearbyForBob = getNearbyUsers("u_bob");
    assert.equal(
      nearbyForBob.some((u) => u.userId === "u_alice"),
      true,
      "hidden user u_bob must still see visible user u_alice nearby"
    );

    removeUser("u_alice");
    removeUser("u_bob");
  });

  it("toggling back to visible restores the user in others' getNearbyUsers", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u_bob", { cityId: "c1", x: 5, y: 0, z: 5 });
    setUserVisibility("u_bob", "hidden");
    assert.equal(getNearbyUsers("u_alice").some((u) => u.userId === "u_bob"), false);

    setUserVisibility("u_bob", "visible");
    assert.equal(getUserVisibility("u_bob"), PRESENCE_VISIBILITY.VISIBLE);
    assert.equal(
      getNearbyUsers("u_alice").some((u) => u.userId === "u_bob"),
      true,
      "u_bob must reappear in u_alice's nearby list after toggling back to visible"
    );

    removeUser("u_alice");
    removeUser("u_bob");
  });
});

describe("getPlayersNear — hidden exclusion", () => {
  it("excludes a hidden user from a proximity point-query", () => {
    updateUserPosition("u_alice", { cityId: "c1", worldId: "w1", x: 0, y: 0, z: 0 });
    updateUserPosition("u_bob", { cityId: "c1", worldId: "w1", x: 5, y: 0, z: 5 });
    setUserVisibility("u_bob", "hidden");

    const near = getPlayersNear("w1", 0, 0, { cellSize: 50, radiusCells: 1 });
    assert.equal(near.includes("u_bob"), false, "hidden user must not appear in getPlayersNear");
    assert.equal(near.includes("u_alice"), true, "visible user must still appear in getPlayersNear");

    removeUser("u_alice");
    removeUser("u_bob");
  });
});

describe("getPlayersInCell — hidden exclusion", () => {
  it("excludes a hidden user from a cell query", () => {
    updateUserPosition("u_alice", { cityId: "c1", worldId: "w1", x: 10, y: 0, z: 10 });
    updateUserPosition("u_bob", { cityId: "c1", worldId: "w1", x: 12, y: 0, z: 12 });
    setUserVisibility("u_bob", "hidden");

    const cellX = Math.floor(10 / 50);
    const cellZ = Math.floor(10 / 50);
    const inCell = getPlayersInCell("w1", cellX, cellZ, 50);
    assert.equal(inCell.includes("u_bob"), false, "hidden user must not appear in getPlayersInCell");
    assert.equal(inCell.includes("u_alice"), true, "visible user must still appear in getPlayersInCell");

    removeUser("u_alice");
    removeUser("u_bob");
  });
});

describe("broadcastPositions — hidden exclusion from the shared payload", () => {
  it("omits a hidden user from the users[] array emitted to the chunk", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 20, y: 0, z: 20 });
    updateUserPosition("u_bob", { cityId: "c1", x: 22, y: 0, z: 22 });
    setUserVisibility("u_bob", "hidden");

    const emitted = [];
    broadcastPositions("c1", (event, data) => emitted.push({ event, data }));

    const positionEvents = emitted.filter((e) => e.event === "city:positions");
    assert.ok(positionEvents.length >= 1, "expected at least one city:positions emit");
    const allUserIds = positionEvents.flatMap((e) => e.data.users.map((u) => u.userId));
    assert.equal(allUserIds.includes("u_bob"), false, "hidden user must be excluded from the broadcast payload");
    assert.equal(allUserIds.includes("u_alice"), true, "visible user must still be in the broadcast payload");

    removeUser("u_alice");
    removeUser("u_bob");
  });

  it("includes a previously-hidden user again after toggling back to visible", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 20, y: 0, z: 20 });
    updateUserPosition("u_bob", { cityId: "c1", x: 22, y: 0, z: 22 });
    setUserVisibility("u_bob", "hidden");
    setUserVisibility("u_bob", "visible");

    const emitted = [];
    broadcastPositions("c1", (event, data) => emitted.push({ event, data }));
    const allUserIds = emitted
      .filter((e) => e.event === "city:positions")
      .flatMap((e) => e.data.users.map((u) => u.userId));
    assert.equal(allUserIds.includes("u_bob"), true, "u_bob must reappear in the broadcast after toggling back to visible");

    removeUser("u_alice");
    removeUser("u_bob");
  });
});

describe("visibility persists across position updates", () => {
  it("does not reset to visible on a subsequent updateUserPosition call", () => {
    updateUserPosition("u_carl", { cityId: "c1", x: 0, y: 0, z: 0 });
    setUserVisibility("u_carl", "hidden");
    updateUserPosition("u_carl", { cityId: "c1", x: 1, y: 0, z: 1 });
    assert.equal(getUserVisibility("u_carl"), PRESENCE_VISIBILITY.HIDDEN, "visibility must survive a plain move update");
    removeUser("u_carl");
  });
});
