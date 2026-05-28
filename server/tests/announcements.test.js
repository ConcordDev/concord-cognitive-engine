// Phase BB3 — announcements tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  publishAnnouncement,
  listRecentAnnouncements,
  sweepExpiredAnnouncements,
  dequeueBroadcastBatch,
} from "../lib/announcements.js";
import { runAnnouncementBroadcaster } from "../emergent/announcement-broadcaster.js";
import { up as upAnnouncements } from "../migrations/237_announcements.js";

function freshDb() { const db = new Database(":memory:"); upAnnouncements(db); return db; }

describe("Phase BB3 — announcements", () => {
  let db;
  beforeEach(() => { db = freshDb(); delete process.env.CONCORD_ANNOUNCEMENTS_ENABLED; });

  it("publish + list round-trip", () => {
    const r = publishAnnouncement(db, {
      kind: "feature_drop", title: "Phase BB3 lives", body: "ship it.",
    });
    assert.equal(r.ok, true);
    const list = listRecentAnnouncements(db);
    assert.equal(list.length, 1);
    assert.equal(list[0].title, "Phase BB3 lives");
  });

  it("rejects invalid kind + missing inputs", () => {
    assert.equal(publishAnnouncement(db, { kind: "spam", title: "x", body: "y" }).ok, false);
    assert.equal(publishAnnouncement(db, { kind: "feature_drop", body: "y" }).ok, false);
    assert.equal(publishAnnouncement(db, { kind: "feature_drop", title: "x" }).ok, false);
  });

  it("listRecentAnnouncements filters by kind", () => {
    publishAnnouncement(db, { kind: "feature_drop", title: "Feature", body: "x" });
    publishAnnouncement(db, { kind: "roadmap", title: "Roadmap", body: "x" });
    const fd = listRecentAnnouncements(db, { kind: "feature_drop" });
    assert.equal(fd.length, 1);
    assert.equal(fd[0].kind, "feature_drop");
  });

  it("sweepExpiredAnnouncements drops expired rows only", () => {
    publishAnnouncement(db, { kind: "event", title: "Live", body: "x" });
    publishAnnouncement(db, { kind: "event", title: "Old", body: "x", expiresAt: 1 });
    const s = sweepExpiredAnnouncements(db);
    assert.equal(s.removed, 1);
    const list = listRecentAnnouncements(db);
    assert.equal(list.length, 1);
    assert.equal(list[0].title, "Live");
  });

  it("dequeueBroadcastBatch is idempotent (re-pull is empty)", () => {
    publishAnnouncement(db, { kind: "feature_drop", title: "A", body: "x" });
    publishAnnouncement(db, { kind: "feature_drop", title: "B", body: "x" });
    const a = dequeueBroadcastBatch(db);
    assert.equal(a.length, 2);
    const b = dequeueBroadcastBatch(db);
    assert.equal(b.length, 0, "all rows now marked broadcast");
  });

  it("heartbeat broadcasts via io.emit + env disable short-circuits", () => {
    publishAnnouncement(db, { kind: "roadmap", title: "Belonging sprint", body: "soon" });
    const emits = [];
    const io = { emit: (n, p) => emits.push({ name: n, payload: p }) };
    const r = runAnnouncementBroadcaster({ db, io });
    assert.equal(r.ok, true);
    assert.equal(r.broadcast, 1);
    assert.equal(emits[0].name, "concord:announcement");
    assert.equal(emits[0].payload.kind, "roadmap");

    process.env.CONCORD_ANNOUNCEMENTS_ENABLED = "0";
    publishAnnouncement(db, { kind: "feature_drop", title: "Blocked", body: "x" });
    const r2 = runAnnouncementBroadcaster({ db, io });
    assert.equal(r2.skipped, "disabled_by_env");
    delete process.env.CONCORD_ANNOUNCEMENTS_ENABLED;
  });
});
