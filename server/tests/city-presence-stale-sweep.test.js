/**
 * city-presence stale-entry sweep contract test.
 *
 * `_userPositions` is normally pruned by socket disconnect handlers
 * (server.js:7112, 7120). The sweepStalePresence() helper covers the
 * crash-recovery / never-cleanly-disconnected gap by removing entries
 * whose lastUpdate is older than CONCORD_PRESENCE_STALE_MS.
 *
 * Run: node --test tests/city-presence-stale-sweep.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  configurePresence,
  updateUserPosition,
  getUserPosition,
  sweepStalePresence,
  removeUser,
} from "../lib/city-presence.js";

// getUserPosition returns `undefined` for missing users. This adapter
// returns explicit null so assert.equal(..., null) reads cleanly.
function _getUserPositionOrNull(uid) {
  const v = getUserPosition(uid);
  return v === undefined ? null : v;
}

beforeEach(() => {
  // Configure with no DB — sweep should still work in-memory.
  configurePresence({ db: null, fireTrigger: null });
  // Best-effort isolation: any leftover users from prior tests get pruned
  // by setting now far enough in the future.
  sweepStalePresence(Date.now() + 1e12);
});

describe("sweepStalePresence — basic behavior", () => {
  it("returns ok:true with pruned/scanned counts", () => {
    updateUserPosition("u_fresh", { cityId: "c1", x: 0, y: 0, z: 0 });
    const r = sweepStalePresence();
    assert.equal(r.ok, true);
    assert.equal(typeof r.pruned, "number");
    assert.equal(typeof r.scanned, "number");
    removeUser("u_fresh");
  });

  it("does not prune entries within the stale window", () => {
    updateUserPosition("u_active", { cityId: "c1", x: 1, y: 0, z: 1 });
    const r = sweepStalePresence(Date.now()); // immediate sweep
    assert.equal(r.pruned, 0, "fresh entries must not be pruned");
    assert.ok(_getUserPositionOrNull("u_active"), "fresh user must still be present");
    removeUser("u_active");
  });
});

describe("sweepStalePresence — prunes old entries", () => {
  it("prunes an entry older than 10 minutes (default threshold)", () => {
    updateUserPosition("u_stale", { cityId: "c1", x: 5, y: 0, z: 5 });
    // Advance virtual now to 15 minutes into the future.
    const futureNow = Date.now() + 15 * 60 * 1000;
    const r = sweepStalePresence(futureNow);
    assert.ok(r.pruned >= 1, `expected ≥1 pruned, got ${r.pruned}`);
    assert.equal(_getUserPositionOrNull("u_stale"), null, "stale user must be removed");
  });

  it("prunes multiple stale entries in one pass", () => {
    updateUserPosition("u_stale_1", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u_stale_2", { cityId: "c1", x: 0, y: 0, z: 1 });
    updateUserPosition("u_stale_3", { cityId: "c1", x: 0, y: 0, z: 2 });
    const futureNow = Date.now() + 15 * 60 * 1000;
    const r = sweepStalePresence(futureNow);
    assert.ok(r.pruned >= 3);
    assert.equal(_getUserPositionOrNull("u_stale_1"), null);
    assert.equal(_getUserPositionOrNull("u_stale_2"), null);
    assert.equal(_getUserPositionOrNull("u_stale_3"), null);
  });

  it("two sweeps with no new updates: second pass prunes nothing", () => {
    updateUserPosition("u_old", { cityId: "c1", x: 0, y: 0, z: 0 });
    const futureNow = Date.now() + 15 * 60 * 1000;
    const r1 = sweepStalePresence(futureNow);
    assert.ok(r1.pruned >= 1, "first sweep prunes the stale user");
    const r2 = sweepStalePresence(futureNow);
    assert.equal(r2.pruned, 0, "second sweep with no new updates is a no-op");
  });
});

describe("sweepStalePresence — empty / no-op", () => {
  it("returns pruned:0 when no users are present", () => {
    const r = sweepStalePresence();
    assert.equal(r.ok, true);
    assert.equal(r.pruned, 0);
  });
});
