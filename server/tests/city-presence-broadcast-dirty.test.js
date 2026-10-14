/**
 * city-presence broadcast dirty-skip + wire-format + sync-slice bound.
 *
 * Batch 019 (cursor-fix-batch-019-presence): event-loop cost of
 * city_presence_broadcast. Dirty-skip is the load-bearing fix; sync cost
 * at 1000 occupants is well under 25ms so setImmediate chunking was not added.
 *
 * Run: node --test tests/city-presence-broadcast-dirty.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  configurePresence,
  updateUserPosition,
  removeUser,
  broadcastPositions,
  setBroadcastSliceObserver,
  isCityBroadcastDirty,
  sweepStalePresence,
} from "../lib/city-presence.js";

const CITY = "golden_city";
const SLICE_BOUND_MS = 25;

/** Pre-change golden wire payload (timestamp stabilized). Captured 2026-10-14
 *  from broadcastPositions before dirty-skip landed — field set + order must
 *  stay identical on a dirty rebuild. */
const GOLDEN_PAYLOAD = {
  cityId: "golden_city",
  chunk: null,
  chunks: 2,
  users: [
    {
      userId: "u_a",
      x: 10,
      y: 0,
      z: 20,
      direction: 1.5,
      action: "walk",
      avatar: null,
      vehicleId: null,
      vehicleType: null,
      mode: "walk",
      locomotion: "idle",
      presenceStatus: "available",
      displayName: "u_a",
    },
    {
      userId: "npc_g1",
      x: 15,
      y: 0,
      z: 25,
      direction: 0.2,
      action: "idle",
      avatar: null,
      vehicleId: null,
      vehicleType: null,
      mode: "walk",
      locomotion: "idle",
      presenceStatus: "available",
      displayName: "npc_g1",
    },
    {
      userId: "u_b",
      x: 110,
      y: 1,
      z: 20,
      direction: 0,
      action: "idle",
      avatar: null,
      vehicleId: null,
      vehicleType: null,
      mode: "walk",
      locomotion: "idle",
      presenceStatus: "available",
      displayName: "u_b",
    },
  ],
  timestamp: "STABLE",
};

const FIXTURE = [
  { id: "u_a", x: 10, y: 0, z: 20, direction: 1.5, action: "walk" },
  { id: "u_b", x: 110, y: 1, z: 20, direction: 0, action: "idle" },
  { id: "npc_g1", x: 15, y: 0, z: 25, direction: 0.2, action: "idle" },
];

function seedFixture() {
  for (const f of FIXTURE) {
    updateUserPosition(f.id, {
      cityId: CITY,
      x: f.x,
      y: f.y,
      z: f.z,
      direction: f.direction,
      action: f.action,
    });
  }
}

function clearAll() {
  setBroadcastSliceObserver(null);
  sweepStalePresence(Date.now() + 1e12);
}

beforeEach(() => {
  configurePresence({ db: null, fireTrigger: null });
  clearAll();
});

afterEach(() => {
  clearAll();
});

describe("broadcastPositions — dirty-skip", () => {
  it("emits once after seed, then skips rebuild when nothing changed", () => {
    seedFixture();
    assert.equal(isCityBroadcastDirty(CITY), true);

    const emits = [];
    const r1 = broadcastPositions(CITY, (evt, data) => emits.push({ evt, data }));
    assert.equal(r1.skipped, false);
    assert.equal(r1.emitted, true);
    assert.equal(emits.length, 1);
    assert.equal(isCityBroadcastDirty(CITY), false);

    const r2 = broadcastPositions(CITY, (evt, data) => emits.push({ evt, data }));
    assert.equal(r2.skipped, true);
    assert.equal(r2.reason, "clean");
    assert.equal(emits.length, 1, "clean tick must not emit");
  });

  it("re-emits after a position change", () => {
    seedFixture();
    broadcastPositions(CITY, () => {});
    assert.equal(isCityBroadcastDirty(CITY), false);

    // Bypass rate-limit: wait past MIN_UPDATE_INTERVAL_MS via lastUpdate poke
    // by removing+re-adding isn't needed — update with enough wall time.
    // First update after seed already advanced lastUpdate; use force path:
    // remove + re-seed one user marks dirty.
    updateUserPosition("u_a", {
      cityId: CITY,
      x: 11,
      y: 0,
      z: 20,
      direction: 1.5,
      action: "walk",
    });
    // May be rate_limited if <20ms — retry once after short spin.
    if (!isCityBroadcastDirty(CITY)) {
      const start = Date.now();
      while (Date.now() - start < 25) { /* spin */ }
      updateUserPosition("u_a", {
        cityId: CITY,
        x: 12,
        y: 0,
        z: 20,
        direction: 1.5,
        action: "walk",
      });
    }
    assert.equal(isCityBroadcastDirty(CITY), true);

    const emits = [];
    const r = broadcastPositions(CITY, (evt, data) => emits.push({ evt, data }));
    assert.equal(r.emitted, true);
    assert.equal(emits.length, 1);
  });
});

describe("broadcastPositions — byte-identical wire payload", () => {
  it("fixture scenario matches pre-change golden payload (timestamp stabilized)", () => {
    seedFixture();
    let payload = null;
    broadcastPositions(CITY, (evt, data) => {
      payload = data;
    });
    assert.ok(payload, "expected an emit");
    const stable = { ...payload, timestamp: "STABLE" };
    assert.equal(
      JSON.stringify(stable),
      JSON.stringify(GOLDEN_PAYLOAD),
      "wire payload must stay byte-identical to the pre-change golden",
    );
  });
});

describe("broadcastPositions — 1000-occupant sync slice bound", () => {
  it("every sync slice stays under 25ms (injected observer)", () => {
    const slices = [];
    setBroadcastSliceObserver((info) => slices.push(info));

    const ids = [];
    for (let i = 0; i < 1000; i++) {
      const id = `load_${i}`;
      ids.push(id);
      const chunkIdx = Math.floor(i / 20);
      const x = (chunkIdx % 10) * 100 + (i % 20) * 3;
      const z = Math.floor(chunkIdx / 10) * 100 + (i % 20) * 3;
      updateUserPosition(id, {
        cityId: "load_city",
        x,
        y: 0,
        z,
        direction: 0,
        action: i % 3 === 0 ? "idle" : "walk",
      });
    }

    broadcastPositions("load_city", () => {});
    assert.ok(slices.length >= 1, "observer must see at least one slice");
    const rebuilds = slices.filter((s) => s.phase === "rebuild");
    assert.equal(rebuilds.length, 1);
    for (const s of rebuilds) {
      assert.ok(
        s.syncMs < SLICE_BOUND_MS,
        `sync slice ${s.syncMs}ms must be < ${SLICE_BOUND_MS}ms`,
      );
    }

    // Clean tick — skip slice also recorded and trivial
    slices.length = 0;
    broadcastPositions("load_city", () => {});
    assert.equal(slices.length, 1);
    assert.equal(slices[0].phase, "skip");
    assert.ok(slices[0].syncMs < SLICE_BOUND_MS);

    for (const id of ids) removeUser(id);
  });
});
