// Phase CC7 — theme park tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  openAttraction, closeAttraction, tickVisitors,
  getAttraction, listAttractionsInWorld,
} from "../lib/theme-park.js";
import { up as upPark } from "../migrations/257_theme_park.js";

function freshDb() { const db = new Database(":memory:"); upPark(db); return db; }

describe("Phase CC7 — theme park tycoon", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("openAttraction rejects invalid kind", () => {
    const r = openAttraction(db, "u1", { worldId: "tunya", attractionKind: "casino" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_kind");
  });

  it("openAttraction + closeAttraction (owner only)", () => {
    const r = openAttraction(db, "u1", { worldId: "tunya", attractionKind: "ride", name: "Spinner" });
    assert.equal(r.ok, true);
    const otherClose = closeAttraction(db, r.attractionId, "u2");
    assert.equal(otherClose.ok, false);
    const ownClose = closeAttraction(db, r.attractionId, "u1");
    assert.equal(ownClose.ok, true);
    const a = getAttraction(db, r.attractionId);
    assert.ok(a.closed_at);
  });

  it("tickVisitors arrivals + assignment + revenue accrual", () => {
    const a = openAttraction(db, "u1", { worldId: "tunya", attractionKind: "ride", ticketCc: 8 });
    tickVisitors(db, "tunya", { newArrivals: 3 });
    const updated = getAttraction(db, a.attractionId);
    assert.equal(updated.total_visits, 3);
    assert.equal(updated.total_revenue, 24);
    assert.equal(updated.current_visitors, 3);
  });

  it("departing visitors decrement current_visitors", () => {
    const a = openAttraction(db, "u1", { worldId: "tunya", attractionKind: "ride", ticketCc: 5 });
    tickVisitors(db, "tunya", { newArrivals: 2 });
    // Force visitors to depart by backdating leaves_at.
    db.prepare(`UPDATE visitor_npcs SET leaves_at = 1`).run();
    tickVisitors(db, "tunya", { newArrivals: 0 });
    const updated = getAttraction(db, a.attractionId);
    assert.equal(updated.current_visitors, 0);
  });

  it("listAttractionsInWorld excludes closed + sorts revenue DESC", () => {
    const a = openAttraction(db, "u1", { worldId: "tunya", attractionKind: "ride", ticketCc: 5 });
    const b = openAttraction(db, "u1", { worldId: "tunya", attractionKind: "show", ticketCc: 10 });
    const c = openAttraction(db, "u1", { worldId: "tunya", attractionKind: "food", ticketCc: 3 });
    closeAttraction(db, c.attractionId, "u1");
    tickVisitors(db, "tunya", { newArrivals: 2 });  // both open attractions get 1 each
    const list = listAttractionsInWorld(db, "tunya");
    assert.equal(list.length, 2);
  });

  it("appeal grows with visits (capped at 1.0)", () => {
    const a = openAttraction(db, "u1", { worldId: "tunya", attractionKind: "ride" });
    tickVisitors(db, "tunya", { newArrivals: 10 });
    const updated = getAttraction(db, a.attractionId);
    assert.ok(updated.base_appeal > 0.5);
    assert.ok(updated.base_appeal <= 1.0);
  });
});
