// server/tests/wave3-digest.test.js
//
// Pins the digest route shape and offline-window detection.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import createDigestRouter from "../routes/digest.js";

let db;
let router;

before(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, last_login_at TEXT);
    CREATE TABLE world_visits (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL,
      arrived_at INTEGER NOT NULL DEFAULT (unixepoch()),
      departed_at INTEGER, total_time_minutes REAL
    );
    CREATE TABLE event_timeline_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL, world_id TEXT,
      actor_kind TEXT, actor_id TEXT, payload_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  router = createDigestRouter({
    db,
    requireAuth: (req, _res, next) => { req.user = { id: "U1" }; next(); },
  });

  const now = Math.floor(Date.now() / 1000);

  // U1 was gone for 2 hours
  db.prepare(`INSERT INTO users (id, last_login_at) VALUES ('U1', ?)`).run(new Date((now - 7200) * 1000).toISOString());
  db.prepare(`INSERT INTO world_visits (id, user_id, world_id, arrived_at, departed_at) VALUES
    ('v1', 'U1', 'concordia-hub', ?, ?)`).run(now - 10000, now - 7200);

  // Seed a few events spanning the window
  const seed = (channel, ts, payload = {}) => db.prepare(`
    INSERT INTO event_timeline_log (channel, world_id, payload_json, created_at)
    VALUES (?, 'concordia-hub', ?, ?)
  `).run(channel, JSON.stringify(payload), ts);
  seed("world:hybrid-spawned", now - 6000, { hybridId: "hyb_a" });
  seed("world:hybrid-spawned", now - 4000, { hybridId: "hyb_b" });
  seed("faction-strategy:move-applied", now - 3000, { faction: "sovereign", move: "RAID" });
  seed("noise:not-in-digest", now - 2000, {});  // should be filtered out
});

after(() => { db?.close(); });

function invoke(path) {
  return new Promise((resolve) => {
    let status = 200, body = null;
    const q = path.includes("?") ? Object.fromEntries(new URL(`http://x${path}`).searchParams) : {};
    const req = { method: "GET", url: path, headers: {}, query: q };
    const res = {
      status(c) { status = c; return this; },
      json(b)   { body = b; resolve({ status, body }); },
    };
    router.handle(req, res, () => resolve({ status: 404, body: null }));
  });
}

describe("GET /api/world/digest", () => {
  it("returns events from the offline window on whitelisted channels", async () => {
    const r = await invoke("/digest?worldId=concordia-hub");
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.shouldShow, "30-min threshold met");
    assert.ok(r.body.elapsedSeconds >= 7000);
    assert.ok(r.body.eventCount >= 3);
    // The off-channel event must NOT appear.
    const offChannel = r.body.events.find((e) => e.channel === "noise:not-in-digest");
    assert.equal(offChannel, undefined, "non-whitelisted channels filtered");
    assert.ok(r.body.channels.includes("world:hybrid-spawned"));
    assert.ok(r.body.grouped["world:hybrid-spawned"].length >= 2);
  });

  it("reports shouldShow=false when the gap is too small", async () => {
    // Update the visit to have just departed.
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`UPDATE world_visits SET departed_at = ? WHERE id = 'v1'`).run(now - 60);
    db.prepare(`UPDATE users SET last_login_at = ? WHERE id = 'U1'`)
      .run(new Date((now - 60) * 1000).toISOString());
    const r = await invoke("/digest");
    assert.equal(r.status, 200);
    assert.equal(r.body.shouldShow, false);
  });
});
