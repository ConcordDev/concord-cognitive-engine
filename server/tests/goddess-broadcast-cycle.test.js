// Behavioral tests for server/emergent/goddess-broadcast-cycle.js — the
// heartbeat that closes the "goddess.compose_now has zero callers" gap
// (see docs/lens-specs/goddess-capability-map.md). Pins: composes one
// dispatch per active world per pass, degrades gracefully with no db /
// no worlds table, respects the CONCORD_GODDESS_BROADCAST=0 kill-switch,
// and never throws on a per-world compose failure.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runGoddessBroadcastCycle } from "../emergent/goddess-broadcast-cycle.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE worlds (id TEXT PRIMARY KEY);
    CREATE TABLE goddess_dispatches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      tone TEXT NOT NULL,
      ecosystem_score REAL,
      refusal_strength REAL,
      drift_kind TEXT,
      body TEXT NOT NULL,
      composed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  return db;
}

afterEach(() => { delete process.env.CONCORD_GODDESS_BROADCAST; });

describe("goddess-broadcast-cycle", () => {
  it("composes exactly one dispatch per active world", async () => {
    const db = freshDb();
    db.prepare("INSERT INTO worlds (id) VALUES (?)").run("concordia-hub");
    db.prepare("INSERT INTO worlds (id) VALUES (?)").run("tunya");
    const state = { worlds: new Map() };

    const r = await runGoddessBroadcastCycle({ state, db });
    assert.equal(r.ok, true);
    assert.equal(r.composed, 2);
    assert.equal(r.scanned, 2);

    const rows = db.prepare("SELECT world_id FROM goddess_dispatches ORDER BY world_id").all();
    assert.deepEqual(rows.map((x) => x.world_id), ["concordia-hub", "tunya"]);
  });

  it("degrades gracefully with no db and with no worlds table", async () => {
    const noDb = await runGoddessBroadcastCycle({ state: {}, db: null });
    assert.equal(noDb.ok, false);
    assert.equal(noDb.reason, "no_db");

    const db = new Database(":memory:");
    const noTable = await runGoddessBroadcastCycle({ state: {}, db });
    assert.equal(noTable.ok, true);
    assert.equal(noTable.composed, 0);
  });

  it("respects the CONCORD_GODDESS_BROADCAST=0 kill-switch", async () => {
    process.env.CONCORD_GODDESS_BROADCAST = "0";
    const db = freshDb();
    db.prepare("INSERT INTO worlds (id) VALUES (?)").run("concordia-hub");
    const r = await runGoddessBroadcastCycle({ state: {}, db });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "disabled");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM goddess_dispatches").get().n, 0);
  });

  it("never throws when one world's compose fails — isolates per-world errors", async () => {
    const db = freshDb();
    db.prepare("INSERT INTO worlds (id) VALUES (?)").run("concordia-hub");
    db.prepare("INSERT INTO worlds (id) VALUES (?)").run(""); // falsy id filtered by the module itself upstream — but guard belt+suspenders here too
    // Drop the dispatches table to force composeAndRecord's recordDispatch to fail for every world.
    db.exec("DROP TABLE goddess_dispatches");
    const r = await runGoddessBroadcastCycle({ state: {}, db });
    assert.equal(r.ok, true);
    assert.equal(r.composed, 0, "recordDispatch failures are swallowed per-world, never thrown");
  });
});
