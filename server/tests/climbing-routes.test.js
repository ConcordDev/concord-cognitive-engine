// Phase CA3 — climbing route ledger tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { recordRoute, listRoutes, getTopRoutes, countTallRoutes } from "../lib/climbing.js";
import { up as upClimbing } from "../migrations/244_climbing_routes.js";

function freshDb() { const db = new Database(":memory:"); upClimbing(db); return db; }

describe("Phase CA3 — climbing routes", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("recordRoute computes height_climbed from start_y → peak_altitude", () => {
    const r = recordRoute(db, "u1", {
      worldId: "tunya",
      startX: 0, startY: 100, startZ: 0,
      endX: 0, endY: 200, endZ: 0,
      peakAltitude: 250, durationS: 120,
    });
    assert.equal(r.ok, true);
    assert.equal(r.heightClimbed, 150);
  });

  it("listRoutes returns user's routes newest-first", () => {
    recordRoute(db, "u1", { worldId: "tunya", startX: 0, startY: 0, startZ: 0, endX: 0, endY: 50, endZ: 0, peakAltitude: 50, durationS: 30 });
    recordRoute(db, "u1", { worldId: "tunya", startX: 0, startY: 0, startZ: 0, endX: 0, endY: 80, endZ: 0, peakAltitude: 80, durationS: 60 });
    const list = listRoutes(db, "u1");
    assert.equal(list.length, 2);
    assert.equal(list[0].height_climbed, 80, "newest first");
  });

  it("getTopRoutes sorts world by height DESC", () => {
    recordRoute(db, "u1", { worldId: "tunya", startX: 0, startY: 0, startZ: 0, endX: 0, endY: 200, endZ: 0, peakAltitude: 200, durationS: 30 });
    recordRoute(db, "u2", { worldId: "tunya", startX: 0, startY: 0, startZ: 0, endX: 0, endY: 500, endZ: 0, peakAltitude: 500, durationS: 60 });
    recordRoute(db, "u3", { worldId: "cyber", startX: 0, startY: 0, startZ: 0, endX: 0, endY: 999, endZ: 0, peakAltitude: 999, durationS: 90 });
    const top = getTopRoutes(db, "tunya");
    assert.equal(top.length, 2);
    assert.equal(top[0].peak_altitude, 500);
  });

  it("countTallRoutes filters by min height (cliff_master gate)", () => {
    recordRoute(db, "u1", { worldId: "tunya", startX: 0, startY: 0, startZ: 0, endX: 0, endY: 50, endZ: 0, peakAltitude: 50, durationS: 30 });
    recordRoute(db, "u1", { worldId: "tunya", startX: 0, startY: 0, startZ: 0, endX: 0, endY: 150, endZ: 0, peakAltitude: 150, durationS: 60 });
    recordRoute(db, "u1", { worldId: "tunya", startX: 0, startY: 0, startZ: 0, endX: 0, endY: 200, endZ: 0, peakAltitude: 200, durationS: 60 });
    assert.equal(countTallRoutes(db, "u1", 100), 2);
    assert.equal(countTallRoutes(db, "u1", 250), 0);
  });

  it("invalid coords rejected", () => {
    const r = recordRoute(db, "u1", { worldId: "tunya" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_coords");
  });

  it("missing user / world rejected", () => {
    assert.equal(recordRoute(db, null, {}).ok, false);
    assert.equal(recordRoute(db, "u1", {}).ok, false);
  });
});
