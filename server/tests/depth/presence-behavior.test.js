// tests/depth/presence-behavior.test.js — REAL behavioral tests for the
// "presence" lens-action domain (registerLensAction family). Uses a LOCAL SHIM
// instead of the server-booting harness: the domain is pure STATE-backed
// in-memory logic, so we register its handlers into a plain Map and invoke
// them directly. Every call literally names the macro string so the intent is
// unambiguous: heartbeat round-trips, stale exclusion / GC, stats counts,
// multi-user via distinct ctx, validation rejections, and empty-by-default.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import register from "../../domains/presence.js";

// LOCAL SHIM — register handlers into a Map, invoke (ctx, {data}, params).
const H = new Map();
register((d, a, fn) => H.set(a, fn));
const run = (a, data = {}, params = {}, ctx = { actor: { userId: "u1" } }) =>
  H.get(a)(ctx, { data }, params);

// Each test starts from a clean presence store so counts are deterministic.
beforeEach(() => {
  if (!globalThis._concordSTATE) globalThis._concordSTATE = {};
  globalThis._concordSTATE.presenceHeartbeats = new Map();
  // Pin an empty profile store so the join path stays exercised but adds no fields.
  globalThis._concordSTATE.users = new Map();
});

describe("presence — heartbeat → active-list round-trip", () => {
  it("a recorded heartbeat surfaces in active-list for the same world", () => {
    const hb = run("heartbeat", {}, { worldId: "w1", activity: "building", position: { x: 1, y: 2, z: 3 } });
    assert.equal(hb.ok, true);
    assert.equal(hb.result.heartbeat.userId, "u1");
    assert.equal(hb.result.heartbeat.activity, "building");
    assert.deepEqual(hb.result.heartbeat.position, { x: 1, y: 2, z: 3 });

    const list = run("active-list", {}, { worldId: "w1" });
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    const me = list.result.players.find((pl) => pl.userId === "u1");
    assert.ok(me);
    assert.equal(me.online, true);
    assert.equal(me.activity, "building");
  });

  it("a heartbeat in a different world does NOT leak into another world's roster", () => {
    run("heartbeat", {}, { worldId: "w1" });
    run("heartbeat", {}, { worldId: "w2" }, { actor: { userId: "u2" } });
    const w1 = run("active-list", {}, { worldId: "w1" });
    assert.equal(w1.result.count, 1);
    assert.ok(w1.result.players.find((pl) => pl.userId === "u1"));
    assert.equal(w1.result.players.find((pl) => pl.userId === "u2"), undefined);
  });

  it("unknown activity normalises to idle; lens label is preserved", () => {
    const hb = run("heartbeat", {}, { worldId: "w1", activity: "nonsense", lens: "world" });
    assert.equal(hb.result.heartbeat.activity, "idle");
    assert.equal(hb.result.heartbeat.lens, "world");
  });
});

describe("presence — empty by default (never fabricates players)", () => {
  it("active-list on an empty store returns zero players", () => {
    const list = run("active-list", {}, { worldId: "w1" });
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 0);
    assert.equal(list.result.players.length, 0);
  });

  it("presence-stats on an empty store reports zero online", () => {
    const stats = run("presence-stats", {}, {});
    assert.equal(stats.ok, true);
    assert.equal(stats.result.totalOnline, 0);
    assert.equal(stats.result.worldCount, 0);
  });
});

describe("presence — stale exclusion + clear-stale GC", () => {
  it("a heartbeat older than the window is excluded from active-list", () => {
    run("heartbeat", {}, { worldId: "w1" });
    // Backdate the stored heartbeat well past a short window.
    const s = globalThis._concordSTATE.presenceHeartbeats;
    for (const hb of s.values()) hb.ts = Date.now() - 10 * 60 * 1000; // 10 min ago
    const fresh = run("active-list", {}, { worldId: "w1", windowMs: 60_000 }); // 1 min window
    assert.equal(fresh.result.count, 0);
    // A wide window still sees it.
    const wide = run("active-list", {}, { worldId: "w1", windowMs: 60 * 60 * 1000 });
    assert.equal(wide.result.count, 1);
  });

  it("clear-stale removes heartbeats older than olderThanMs and leaves fresh ones", () => {
    run("heartbeat", {}, { worldId: "w1" });                                  // fresh, u1
    run("heartbeat", {}, { worldId: "w1" }, { actor: { userId: "u2" } });     // will be aged, u2
    const s = globalThis._concordSTATE.presenceHeartbeats;
    // Age only u2's heartbeat.
    for (const [k, hb] of s) {
      if (k.includes("u2")) hb.ts = Date.now() - 2 * 60 * 60 * 1000; // 2h ago
    }
    const gc = run("clear-stale", {}, { olderThanMs: 60 * 60 * 1000 }); // 1h cutoff
    assert.equal(gc.ok, true);
    assert.equal(gc.result.removed, 1);
    assert.equal(gc.result.remaining, 1);
    const list = run("active-list", {}, { worldId: "w1", windowMs: 60 * 60 * 1000 });
    assert.ok(list.result.players.find((pl) => pl.userId === "u1"));
    assert.equal(list.result.players.find((pl) => pl.userId === "u2"), undefined);
  });
});

describe("presence — multi-user stats counts", () => {
  it("presence-stats counts online users by world and by activity", () => {
    run("heartbeat", {}, { worldId: "w1", activity: "building" }, { actor: { userId: "u1" } });
    run("heartbeat", {}, { worldId: "w1", activity: "trading" }, { actor: { userId: "u2" } });
    run("heartbeat", {}, { worldId: "w2", activity: "building" }, { actor: { userId: "u3" } });

    const all = run("presence-stats", {}, {});
    assert.equal(all.result.totalOnline, 3);
    assert.equal(all.result.worldCount, 2);
    assert.equal(all.result.byWorld.w1, 2);
    assert.equal(all.result.byWorld.w2, 1);
    assert.equal(all.result.byActivity.building, 2);
    assert.equal(all.result.byActivity.trading, 1);

    const scoped = run("presence-stats", {}, { worldId: "w1" });
    assert.equal(scoped.result.totalOnline, 2);
    assert.equal(scoped.result.worldId, "w1");
    assert.equal(scoped.result.byWorld.w2, undefined);
  });

  it("re-sending a heartbeat upserts (one row per user per world), not duplicates", () => {
    run("heartbeat", {}, { worldId: "w1", activity: "idle" });
    run("heartbeat", {}, { worldId: "w1", activity: "exploring" }); // same user, same world
    const list = run("active-list", {}, { worldId: "w1" });
    assert.equal(list.result.count, 1);
    assert.equal(list.result.players[0].activity, "exploring"); // latest wins
  });
});

describe("presence — validation rejections", () => {
  it("heartbeat without worldId is rejected", () => {
    const r = run("heartbeat", {}, {});
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("worldId"));
  });

  it("active-list without worldId is rejected", () => {
    const r = run("active-list", {}, {});
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("worldId"));
  });

  it("a non-finite position is dropped to null, not stored verbatim", () => {
    const r = run("heartbeat", {}, { worldId: "w1", position: { x: "NaN", y: 1, z: 2 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.heartbeat.position, null);
  });
});
