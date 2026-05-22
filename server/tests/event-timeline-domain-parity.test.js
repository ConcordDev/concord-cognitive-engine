// server/tests/event-timeline-domain-parity.test.js
//
// Contract tests for server/domains/event-timeline.js — the activity-feed
// parity macro surface (search / range / detail / timeseries / channels /
// exportEvents / saved views). Exercises each macro against a real
// in-memory event_timeline_log and asserts the { ok } envelope.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerEventTimelineMacros from "../domains/event-timeline.js";
import {
  recordEvent, listRecent as libListRecent, stats as libStats,
} from "../lib/event-timeline.js";
import { up as upMig169 } from "../migrations/169_event_timeline.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`event_timeline.${name}`);
  if (!fn) throw new Error(`event_timeline.${name} not registered`);
  return fn(ctx, input);
}

before(() => {
  registerEventTimelineMacros(register, { listRecent: libListRecent, stats: libStats });
});

let db;
function seed() {
  db = new Database(":memory:");
  upMig169(db);
  const now = Math.floor(Date.now() / 1000);
  // Spread a few rows over the last 24h across channels.
  const samples = [
    { ch: "combat:hit", world: "tunya", ak: "player", ai: "p1", p: { kind: "fire", damage: 42 }, ago: 60 },
    { ch: "combat:kill", world: "tunya", ak: "player", ai: "p1", p: { kind: "lethal", target_id: "npc_9" }, ago: 120 },
    { ch: "npc:activity", world: "tunya", ak: "npc", ai: "iyatte", p: { activity: "patrol" }, ago: 3600 },
    { ch: "npc:activity", world: "cyber", ak: "npc", ai: "vex", p: { activity: "trade" }, ago: 7200 },
    { ch: "dream:captured", world: null, ak: "user", ai: "u1", p: { summary: "a quiet harvest" }, ago: 18000 },
    { ch: "world:refusal-field", world: "tunya", ak: "system", ai: null, p: { kind: "dome", strength: 7 }, ago: 40000 },
  ];
  for (const s of samples) {
    recordEvent(db, s.ch, s.p, { worldId: s.world, actorKind: s.ak, actorId: s.ai });
    // Backdate created_at so range/timeseries tests have spread.
    const id = db.prepare("SELECT MAX(id) AS id FROM event_timeline_log").get().id;
    db.prepare("UPDATE event_timeline_log SET created_at = ? WHERE id = ?").run(now - s.ago, id);
  }
  return db;
}

beforeEach(() => { seed(); });

const ctx = () => ({ db, actor: { userId: "user_test" } });

describe("event_timeline.recent / stats (baseline)", () => {
  it("recent returns rows", async () => {
    const r = await call("recent", ctx(), { limit: 50 });
    assert.equal(r.ok, true);
    assert.ok(r.count >= 6);
  });
  it("stats returns per-channel counts", async () => {
    const r = await call("stats", ctx(), {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.channels));
  });
});

describe("event_timeline.channels", () => {
  it("returns distinct channels with counts + last_seen", async () => {
    const r = await call("channels", ctx(), {});
    assert.equal(r.ok, true);
    const npc = r.channels.find(c => c.channel === "npc:activity");
    assert.ok(npc);
    assert.equal(npc.count, 2);
    assert.ok(npc.last_seen > 0);
  });
  it("no_db when ctx lacks a db", async () => {
    const r = await call("channels", { actor: { userId: "x" } }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });
});

describe("event_timeline.search", () => {
  it("rejects a too-short query", async () => {
    const r = await call("search", ctx(), { query: "a" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "query_too_short");
  });
  it("matches payload content", async () => {
    const r = await call("search", ctx(), { query: "patrol" });
    assert.equal(r.ok, true);
    assert.equal(r.count, 1);
    assert.equal(r.rows[0].channel, "npc:activity");
    assert.equal(r.rows[0].payload.activity, "patrol");
  });
  it("matches channel name", async () => {
    const r = await call("search", ctx(), { query: "combat" });
    assert.equal(r.ok, true);
    assert.ok(r.count >= 2);
  });
  it("respects a channel filter", async () => {
    const r = await call("search", ctx(), { query: "tunya", channels: ["combat:hit"] });
    assert.equal(r.ok, true);
    assert.ok(r.rows.every(x => x.channel === "combat:hit"));
  });
});

describe("event_timeline.range", () => {
  it("rejects an invalid from", async () => {
    const r = await call("range", ctx(), { fromTs: 0 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_from");
  });
  it("rejects an inverted window", async () => {
    const now = Math.floor(Date.now() / 1000);
    const r = await call("range", ctx(), { fromTs: now, toTs: now - 1000 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_range");
  });
  it("returns events inside the window", async () => {
    const now = Math.floor(Date.now() / 1000);
    const r = await call("range", ctx(), { fromTs: now - 4000, toTs: now });
    assert.equal(r.ok, true);
    // combat:hit (60s) + combat:kill (120s) + npc:activity (3600s)
    assert.equal(r.count, 3);
  });
});

describe("event_timeline.detail", () => {
  it("rejects an invalid id", async () => {
    const r = await call("detail", ctx(), { id: 0 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_id");
  });
  it("not_found for an unknown id", async () => {
    const r = await call("detail", ctx(), { id: 99999 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_found");
  });
  it("returns the event + linked entities + nearby", async () => {
    const id = db.prepare("SELECT id FROM event_timeline_log WHERE channel = 'combat:kill'").get().id;
    const r = await call("detail", ctx(), { id });
    assert.equal(r.ok, true);
    assert.equal(r.event.channel, "combat:kill");
    assert.ok(Array.isArray(r.linkedEntities));
    assert.ok(r.linkedEntities.some(e => e.field === "target_id" && e.value === "npc_9"));
    assert.ok(Array.isArray(r.nearby));
  });
});

describe("event_timeline.timeseries", () => {
  it("returns per-channel bucketed series", async () => {
    const r = await call("timeseries", ctx(), { windowSec: 24 * 3600, buckets: 24 });
    assert.equal(r.ok, true);
    assert.equal(r.buckets, 24);
    assert.equal(r.bucketStarts.length, 24);
    assert.ok(r.series.length >= 1);
    for (const s of r.series) {
      assert.equal(s.counts.length, 24);
      assert.equal(s.counts.reduce((a, b) => a + b, 0), s.total);
    }
  });
  it("clamps buckets into range", async () => {
    const r = await call("timeseries", ctx(), { buckets: 9999 });
    assert.equal(r.ok, true);
    assert.ok(r.buckets <= 96);
  });
});

describe("event_timeline.exportEvents", () => {
  it("exports CSV by default with a header row", async () => {
    const r = await call("exportEvents", ctx(), {});
    assert.equal(r.ok, true);
    assert.equal(r.format, "csv");
    assert.match(r.filename, /\.csv$/);
    assert.match(r.body.split("\n")[0], /^id,channel,world_id/);
    assert.ok(r.count >= 6);
  });
  it("exports JSON when requested", async () => {
    const r = await call("exportEvents", ctx(), { format: "json" });
    assert.equal(r.ok, true);
    assert.equal(r.format, "json");
    const parsed = JSON.parse(r.body);
    assert.ok(Array.isArray(parsed));
  });
  it("honours a channel + query filter", async () => {
    const r = await call("exportEvents", ctx(), { channels: ["npc:activity"], query: "patrol" });
    assert.equal(r.ok, true);
    assert.equal(r.count, 1);
  });
});

describe("event_timeline saved views", () => {
  it("saveView → listViews → deleteView round-trips per user", async () => {
    const c = ctx();
    const save = await call("saveView", c, { name: "combat-only", channels: ["combat:hit", "combat:kill"], query: "fire" });
    assert.equal(save.ok, true);
    assert.ok(save.view.id);

    const list = await call("listViews", c, {});
    assert.equal(list.ok, true);
    assert.ok(list.views.some(v => v.name === "combat-only"));

    const del = await call("deleteView", c, { id: save.view.id });
    assert.equal(del.ok, true);
    assert.equal(del.removed, 1);

    const after = await call("listViews", c, {});
    assert.ok(!after.views.some(v => v.id === save.view.id));
  });
  it("saveView rejects an empty name", async () => {
    const r = await call("saveView", ctx(), { name: "" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "name_required");
  });
  it("saved views are scoped per user", async () => {
    await call("saveView", { db, actor: { userId: "alice" } }, { name: "alice-view" });
    const bob = await call("listViews", { db, actor: { userId: "bob" } }, {});
    assert.equal(bob.ok, true);
    assert.ok(!bob.views.some(v => v.name === "alice-view"));
  });
});
