// Phase M — multiplayer density helpers.
//
// Pins: (1) getWorldUserCount returns 0 for unknown worlds, (2) tracking
// a user against a worldId increments the count, (3) getUserIdsInWorld
// returns ids, (4) getPlayersInCell filters to a 50m cell.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  updateUserPosition,
  getWorldUserCount,
  getUserIdsInWorld,
  getPlayersInCell,
  removeUser,
  configurePresence,
} from "../lib/city-presence.js";

describe("Phase M — multiplayer density", () => {
  beforeEach(() => {
    // Reset by removing any test users from prior cases.
    for (const userId of ["p1", "p2", "p3", "p4", "p5"]) {
      removeUser(userId);
    }
    configurePresence({ db: null, fireTrigger: null });
  });

  it("getWorldUserCount returns 0 when no one is in the world", () => {
    assert.equal(getWorldUserCount("tunya"), 0);
  });

  it("getWorldUserCount counts users in a world", () => {
    updateUserPosition("p1", { cityId: "tunya-c1", worldId: "tunya", x: 0, y: 0, z: 0, direction: 0, action: "idle" });
    updateUserPosition("p2", { cityId: "tunya-c1", worldId: "tunya", x: 10, y: 0, z: 10, direction: 0, action: "idle" });
    updateUserPosition("p3", { cityId: "crime-c1", worldId: "crime", x: 0, y: 0, z: 0, direction: 0, action: "idle" });
    assert.equal(getWorldUserCount("tunya"), 2);
    assert.equal(getWorldUserCount("crime"), 1);
    assert.equal(getWorldUserCount("never-spawned"), 0);
  });

  it("getUserIdsInWorld returns the user list", () => {
    updateUserPosition("p1", { cityId: "tunya-c1", worldId: "tunya", x: 0, y: 0, z: 0, direction: 0, action: "idle" });
    updateUserPosition("p2", { cityId: "tunya-c1", worldId: "tunya", x: 10, y: 0, z: 10, direction: 0, action: "idle" });
    const ids = getUserIdsInWorld("tunya").sort();
    assert.deepEqual(ids, ["p1", "p2"]);
  });

  it("getPlayersInCell filters by 50m spatial cell", () => {
    updateUserPosition("p1", { cityId: "tunya-c1", worldId: "tunya", x: 25, y: 0, z: 25, direction: 0, action: "idle" });
    updateUserPosition("p2", { cityId: "tunya-c1", worldId: "tunya", x: 100, y: 0, z: 100, direction: 0, action: "idle" });
    // p1 is in cell (0, 0); p2 is in cell (2, 2).
    const cell00 = getPlayersInCell("tunya", 0, 0);
    const cell22 = getPlayersInCell("tunya", 2, 2);
    assert.deepEqual(cell00, ["p1"]);
    assert.deepEqual(cell22, ["p2"]);
  });

  it("removing a user updates the world count", () => {
    updateUserPosition("p1", { cityId: "tunya-c1", worldId: "tunya", x: 0, y: 0, z: 0, direction: 0, action: "idle" });
    assert.equal(getWorldUserCount("tunya"), 1);
    removeUser("p1");
    assert.equal(getWorldUserCount("tunya"), 0);
  });
});
