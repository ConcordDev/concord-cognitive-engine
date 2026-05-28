// Phase N — spectator-mode helpers.
//
// Pins: (1) joinSpectator increments count + leaves a per-socket marker,
// (2) leaveSpectator decrements + clears the marker, (3) getSpectatorCount
// is safe for unknown worlds, (4) the spectator count map is per-world.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  joinSpectator,
  leaveSpectator,
  getSpectatorCount,
  listSpectatorCounts,
  _resetSpectators,
} from "../lib/spectator-mode.js";

function fakeSocket(id) {
  const rooms = new Set();
  return {
    id,
    rooms,
    join(room) { rooms.add(room); },
    leave(room) { rooms.delete(room); },
  };
}

describe("Phase N — spectator mode", () => {
  beforeEach(() => { _resetSpectators(); });

  it("joinSpectator increments count and joins the room", () => {
    const s = fakeSocket("sock-1");
    const r = joinSpectator(s, "tunya");
    assert.equal(r.ok, true);
    assert.equal(r.count, 1);
    assert.ok(s.rooms.has("world:tunya"));
    assert.ok(s.rooms.has("world:tunya:spectator"));
  });

  it("leaveSpectator decrements + cleans up rooms", () => {
    const s = fakeSocket("sock-2");
    joinSpectator(s, "tunya");
    leaveSpectator(s);
    assert.equal(getSpectatorCount("tunya"), 0);
    assert.equal(s.rooms.has("world:tunya"), false);
    assert.equal(s._concordSpectatorWorldId, null);
  });

  it("getSpectatorCount returns 0 for unknown worlds", () => {
    assert.equal(getSpectatorCount("never-watched"), 0);
  });

  it("counts are per-world isolated", () => {
    joinSpectator(fakeSocket("a"), "tunya");
    joinSpectator(fakeSocket("b"), "tunya");
    joinSpectator(fakeSocket("c"), "crime");
    assert.equal(getSpectatorCount("tunya"), 2);
    assert.equal(getSpectatorCount("crime"), 1);
    const all = listSpectatorCounts();
    assert.equal(all.tunya, 2);
    assert.equal(all.crime, 1);
  });

  it("joinSpectator is safe with null inputs", () => {
    assert.deepEqual(joinSpectator(null, "tunya"), { ok: false, count: 0 });
    assert.deepEqual(joinSpectator(fakeSocket("x"), ""), { ok: false, count: 0 });
  });
});
