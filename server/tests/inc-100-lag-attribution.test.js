// INC-100: lag attribution by measured duration + feed (emergent_id, created_at) index.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as P from "../lib/presence-idle.js";
import { up as up477 } from "../migrations/477_emergent_feed_emergent_time_index.js";

beforeEach(() => P._resetLagAttributionForTest());

describe("getLagCulprit", () => {
  it("does not blame a frequent timer that did no real work", () => {
    for (let i = 0; i < 50; i++) { P.markLagProbe("city_presence_broadcast"); P.recordLagWork("city_presence_broadcast", 1); }
    const a = P.getLagCulprit({ windowMs: 5000, stallMs: 2000 });
    assert.equal(a.culprit, "unattributed");
  });
  it("blames the longest synchronous run in the window", () => {
    P.recordLagWork("city_presence_broadcast", 8);
    P.recordLagWork("density_gauges", 1800);
    P.recordLagWork("city_presence_flush", 120);
    const a = P.getLagCulprit({ windowMs: 5000, stallMs: 2000 });
    assert.equal(a.culprit, "density_gauges"); assert.equal(a.culpritMs, 1800);
  });
  it("ignores runs too small to explain the stall and lists overlapping requests", () => {
    P.recordLagWork("city_presence_flush", 60);
    const now = Date.now();
    P.recordLagHttp("POST /api/chat/stream", now - 4000, now);
    P.recordLagHttp("POST /mcp/call", now - 2500, now - 100);
    const a = P.getLagCulprit({ windowMs: 5000, stallMs: 3000, now });
    assert.equal(a.culprit, "unattributed");
    assert.deepEqual(a.candidates.map((c) => c.split(" (")[0]), ["POST /api/chat/stream", "POST /mcp/call"]);
  });
  it("timeLagWork records the wrapped function's duration and returns its value", () => {
    const v = P.timeLagWork("busy", () => { const t = Date.now(); while (Date.now() - t < 60) { /* spin */ } return 7; });
    assert.equal(v, 7);
    assert.equal(P.getLagCulprit({ windowMs: 5000, stallMs: 100 }).culprit, "busy");
  });
  it("drops runs that ended before the window", () => {
    P.recordLagWork("old", 5000, Date.now() - 120_000);
    assert.equal(P.getLagCulprit({ windowMs: 5000, stallMs: 3000 }).culprit, "unattributed");
  });
});

describe("migration 477 — feed (emergent_id, created_at) index", () => {
  it("makes the per-emergent feed query an index SEARCH, not a time-index SCAN", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE emergent_activity_feed (id TEXT PRIMARY KEY, emergent_id TEXT, event_type TEXT NOT NULL,
      event_data TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX idx_emergent_feed_time ON emergent_activity_feed(created_at DESC);`);
    const q = "EXPLAIN QUERY PLAN SELECT * FROM emergent_activity_feed WHERE emergent_id = ? ORDER BY created_at DESC LIMIT ?";
    assert.match(db.prepare(q).all("x", 50).map((r) => r.detail).join(" "), /SCAN/);
    up477(db); up477(db); // idempotent
    const plan = db.prepare(q).all("x", 50).map((r) => r.detail).join(" ");
    assert.match(plan, /SEARCH .*idx_emergent_feed_emergent_time/);
    assert.doesNotMatch(plan, /TEMP B-TREE/);
  });
});
