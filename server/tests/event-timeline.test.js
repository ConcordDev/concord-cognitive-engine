// server/tests/event-timeline.test.js
//
// Sprint 8 acceptance — unified event timeline.
//
// Pins the read/write API + best-effort emit guarantee. The wire-up
// into realtimeEmit + the macro surface are integration concerns
// covered by the server boot path; these tests pin the lib functions.

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  recordEvent, listRecent, stats, pruneOld,
  TIMELINE_CONSTANTS,
} from "../lib/event-timeline.js";
import { up as upMig169 } from "../migrations/169_event_timeline.js";

function setup() {
  const db = new Database(":memory:");
  upMig169(db);
  return db;
}

test("recordEvent inserts a row and listRecent returns it", () => {
  const db = setup();
  const r = recordEvent(db, "npc:activity", { activity: "patrol", world: "tunya" }, {
    worldId: "tunya", actorKind: "npc", actorId: "iyatte",
  });
  assert.equal(r.ok, true);

  const rows = listRecent(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channel, "npc:activity");
  assert.equal(rows[0].world_id, "tunya");
  assert.equal(rows[0].actor_id, "iyatte");
  assert.equal(rows[0].payload.activity, "patrol");
});

test("recordEvent is best-effort — never throws on garbage payload", () => {
  const db = setup();
  // Circular reference would throw if not caught.
  const circ = {};
  circ.self = circ;
  const r = recordEvent(db, "weird", circ);
  assert.equal(r.ok, true, "should still record despite unserialisable payload");
  const rows = listRecent(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload._unserialisable, true);
});

test("recordEvent truncates oversize payloads", () => {
  const db = setup();
  const huge = { data: "x".repeat(20_000) };
  const r = recordEvent(db, "bulk", huge);
  assert.equal(r.ok, true);
  const rows = listRecent(db);
  assert.equal(rows[0].payload._truncated, true);
  assert.ok(rows[0].payload._len > TIMELINE_CONSTANTS.MAX_PAYLOAD_BYTES);
});

test("listRecent filters by channel", () => {
  const db = setup();
  recordEvent(db, "combat:hit", { damage: 10 });
  recordEvent(db, "npc:activity", { activity: "patrol" });
  recordEvent(db, "combat:kill", { target: "x" });

  const combatRows = listRecent(db, { channels: ["combat:hit", "combat:kill"] });
  assert.equal(combatRows.length, 2);
  assert.ok(combatRows.every(r => r.channel.startsWith("combat:")));
});

test("listRecent filters by worldId", () => {
  const db = setup();
  recordEvent(db, "x", {}, { worldId: "tunya" });
  recordEvent(db, "x", {}, { worldId: "fantasy" });
  recordEvent(db, "x", {}, { worldId: "tunya" });

  const tunyaRows = listRecent(db, { worldId: "tunya" });
  assert.equal(tunyaRows.length, 2);
  assert.ok(tunyaRows.every(r => r.world_id === "tunya"));
});

test("listRecent respects limit", () => {
  const db = setup();
  for (let i = 0; i < 250; i++) {
    recordEvent(db, "test:event", { i });
  }
  const r10 = listRecent(db, { limit: 10 });
  assert.equal(r10.length, 10);
  const r500 = listRecent(db, { limit: 1000 }); // caps at 500
  assert.equal(r500.length, 250);
});

test("stats returns per-channel counts in window", () => {
  const db = setup();
  recordEvent(db, "combat:hit", {});
  recordEvent(db, "combat:hit", {});
  recordEvent(db, "npc:activity", {});
  recordEvent(db, "weather:update", {});

  const s = stats(db);
  assert.equal(s.ok, true);
  assert.equal(s.total, 4);
  const combat = s.channels.find(c => c.channel === "combat:hit");
  assert.equal(combat?.count, 2);
});

test("pruneOld deletes events older than the cutoff", () => {
  const db = setup();
  // Backdate 2 rows to past the prune window.
  recordEvent(db, "old", {});
  db.prepare(`UPDATE event_timeline_log SET created_at = ? WHERE id = 1`).run(
    Math.floor(Date.now() / 1000) - TIMELINE_CONSTANTS.PRUNE_OLDER_THAN_SECONDS - 1
  );
  recordEvent(db, "new", {});
  const r = pruneOld(db);
  assert.equal(r.ok, true);
  assert.equal(r.deleted, 1);
  const rows = listRecent(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channel, "new");
});

test("listRecent returns DESC by created_at", () => {
  const db = setup();
  recordEvent(db, "first", {});
  recordEvent(db, "second", {});
  recordEvent(db, "third", {});
  const rows = listRecent(db);
  assert.equal(rows[0].channel, "third");
  assert.equal(rows[1].channel, "second");
  assert.equal(rows[2].channel, "first");
});

test("missing db handled gracefully", () => {
  const r1 = recordEvent(null, "x", {});
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, "missing_inputs");
  const rows = listRecent(null);
  assert.deepEqual(rows, []);
  const s = stats(null);
  assert.equal(s.ok, false);
});
