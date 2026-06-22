// Contract test for spontaneousGatherings (city-presence) — the clustering
// helper behind the world.gatherings macro / EventsGatherings panel.
import { test } from "node:test";
import assert from "node:assert";
import { updateUserPosition, spontaneousGatherings, getPlayersNear } from "../lib/city-presence.js";

test("spontaneousGatherings clusters nearby present players (>=2 in a 50m cell)", () => {
  const W = `test-gather-world-${Date.now()}`;
  // Three players in the same 50m cell (x 10/20/30 → cell 0), one far away.
  updateUserPosition("g_u1", { worldId: W, x: 10, y: 0, z: 10, districtId: "plaza" });
  updateUserPosition("g_u2", { worldId: W, x: 20, y: 0, z: 20, districtId: "plaza" });
  updateUserPosition("g_u3", { worldId: W, x: 30, y: 0, z: 30, districtId: "plaza" });
  updateUserPosition("g_u4", { worldId: W, x: 500, y: 0, z: 500, districtId: "edge" });

  const gatherings = spontaneousGatherings(W, {});
  assert.ok(Array.isArray(gatherings));

  const big = gatherings.find((g) => g.playerCount >= 3);
  assert.ok(big, "expected a gathering of the 3 clustered players");
  assert.equal(big.location, "plaza", "location should prefer the players' district");
  assert.ok(big.id.startsWith(`gather_${W}`), "id is world-scoped");
  assert.match(big.description, /3 players/);

  // The lone player (count 1) is NOT a gathering.
  assert.ok(!gatherings.some((g) => g.location === "edge"), "single player must not cluster");
});

test("spontaneousGatherings is honest-empty for an empty / unknown world", () => {
  assert.deepEqual(spontaneousGatherings(`nobody-here-${Date.now()}`, {}), []);
  assert.deepEqual(spontaneousGatherings("", {}), []);
});

test("getPlayersNear returns players within the cell window, excludes far ones", () => {
  const W = `test-near-world-${Date.now()}`;
  updateUserPosition("n_u1", { worldId: W, x: 100, y: 0, z: 100 });    // cell (2,2)
  updateUserPosition("n_u2", { worldId: W, x: 140, y: 0, z: 90 });     // cell (2,1) — adjacent
  updateUserPosition("n_u3", { worldId: W, x: 1000, y: 0, z: 1000 });  // cell (20,20) — far
  const near = getPlayersNear(W, 110, 110, { radiusCells: 1 });        // around cell (2,2)
  assert.ok(near.includes("n_u1"), "same-cell player is near");
  assert.ok(near.includes("n_u2"), "adjacent-cell player is near");
  assert.ok(!near.includes("n_u3"), "far player is excluded");
  assert.deepEqual(getPlayersNear("", 0, 0), [], "no world → empty");
});
