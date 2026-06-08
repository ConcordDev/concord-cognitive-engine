// server/tests/depth/hub-behavior.test.js
//
// REAL behavioral tests for the `hub` lens-action domain (ConcordiaHub feed +
// district counts). LOCAL SHIM — registers the domain into a plain Map and
// invokes handlers directly with the `(ctx, artifact, params)` signature, no
// server boot, no DB. With no ctx.db present every world_events / world_buildings
// read degrades to [] / null, so these assertions exercise the honest STATE path
// (recorded activity, zeros, empty-by-default).

import { test } from "node:test";
import assert from "node:assert/strict";
import register from "../../domains/hub.js";

const H = new Map();
register((d, a, fn) => H.set(a, fn));

const run = (a, data = {}, params = {}, ctx = { actor: { userId: "u1" } }) =>
  H.get(a)(ctx, { data }, params);

// Isolate STATE per test: the domain stores in globalThis._concordSTATE.hubActivity.
function resetState() {
  globalThis._concordSTATE = globalThis._concordSTATE || {};
  globalThis._concordSTATE.hubActivity = [];
}

test("activity-feed is empty by default (no fabricated rows)", () => {
  resetState();
  const r = run("activity-feed");
  assert.equal(r.ok, true);
  assert.equal(r.result.count, 0);
  assert.deepEqual(r.result.events, []);
  assert.equal(r.result.sources.recorded, 0);
});

test("activity-record → activity-feed round-trip surfaces the real event", () => {
  resetState();
  const rec = run("activity-record", {}, {
    districtId: "exchange",
    kind: "trade",
    summary: "Iron ore listed on the trading floor",
  });
  assert.equal(rec.ok, true);
  assert.equal(rec.result.event.districtId, "exchange");
  assert.equal(rec.result.event.kind, "trade");
  assert.equal(rec.result.event.actor, "u1"); // defaults to caller
  assert.equal(rec.result.activityCount, 1);

  const feed = run("activity-feed");
  assert.equal(feed.result.count, 1);
  const found = feed.result.events.find((e) => e.id === rec.result.event.id);
  assert.ok(found, "recorded event must appear in the feed");
  assert.equal(found.summary, "Iron ore listed on the trading floor");
  assert.equal(found.source, "recorded");
});

test("activity-feed filters by districtId", () => {
  resetState();
  run("activity-record", {}, { districtId: "exchange", summary: "trade A" });
  run("activity-record", {}, { districtId: "academy", summary: "lecture B" });
  run("activity-record", {}, { districtId: "exchange", summary: "trade C" });

  const all = run("activity-feed");
  assert.equal(all.result.count, 3);

  const exchange = run("activity-feed", {}, { districtId: "exchange" });
  assert.equal(exchange.result.count, 2);
  assert.ok(exchange.result.events.every((e) => e.districtId === "exchange"));
  const summaries = exchange.result.events.map((e) => e.summary);
  assert.ok(summaries.includes("trade A"));
  assert.ok(summaries.includes("trade C"));
  assert.equal(summaries.includes("lecture B"), false);
});

test("activity-feed is newest-first by timestamp", () => {
  resetState();
  run("activity-record", {}, { districtId: "forge", summary: "old", at: "2020-01-01T00:00:00.000Z" });
  run("activity-record", {}, { districtId: "forge", summary: "new", at: "2026-01-01T00:00:00.000Z" });
  const feed = run("activity-feed", {}, { districtId: "forge" });
  assert.equal(feed.result.events[0].summary, "new");
  assert.equal(feed.result.events[1].summary, "old");
});

test("activity-record rejects missing districtId and missing summary", () => {
  resetState();
  const noDistrict = run("activity-record", {}, { summary: "x" });
  assert.equal(noDistrict.ok, false);
  assert.ok(noDistrict.error.includes("districtId"));

  const noSummary = run("activity-record", {}, { districtId: "exchange" });
  assert.equal(noSummary.ok, false);
  assert.ok(noSummary.error.includes("summary"));
});

test("activity-record rejects an invalid timestamp", () => {
  resetState();
  const r = run("activity-record", {}, { districtId: "exchange", summary: "x", at: "not-a-date" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("timestamp"));
});

test("district-stats is honest 0 with no DB source and no activity", () => {
  resetState();
  const r = run("district-stats", {}, { districtId: "nexus" });
  assert.equal(r.ok, true);
  assert.equal(r.result.buildingCount, 0);
  assert.equal(r.result.population, 0);
  assert.equal(r.result.activeUsers, 0);
  // honest provenance: no building source present, no activity recorded
  assert.equal(r.result.hasBuildingSource, false);
  assert.equal(r.result.hasActivity, false);
});

test("district-stats counts real recorded actors (population vs activeUsers window)", () => {
  resetState();
  const fresh = new Date().toISOString();
  // two distinct fresh actors + one stale actor in the same district
  run("activity-record", {}, { districtId: "commons", summary: "a", actor: "alice", at: fresh });
  run("activity-record", {}, { districtId: "commons", summary: "b", actor: "bob", at: fresh });
  run("activity-record", {}, { districtId: "commons", summary: "c", actor: "carol", at: "2020-01-01T00:00:00.000Z" });

  const r = run("district-stats", {}, { districtId: "commons" });
  assert.equal(r.result.population, 3);   // all distinct actors all-time
  assert.equal(r.result.activeUsers, 2);  // only the two within the 1h window
  assert.equal(r.result.activityCount, 3);
  assert.equal(r.result.hasActivity, true);
});

test("district-stats rejects missing districtId", () => {
  resetState();
  const r = run("district-stats", {}, {});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("districtId"));
});

test("hub-totals aggregates real counts across requested districts", () => {
  resetState();
  const fresh = new Date().toISOString();
  run("activity-record", {}, { districtId: "exchange", summary: "x", actor: "alice", at: fresh });
  run("activity-record", {}, { districtId: "exchange", summary: "y", actor: "bob", at: fresh });
  run("activity-record", {}, { districtId: "academy", summary: "z", actor: "alice", at: fresh });

  const r = run("hub-totals", {}, { districtIds: ["exchange", "academy", "forge"] });
  assert.equal(r.ok, true);
  assert.equal(r.result.districtCount, 3);
  assert.equal(r.result.totalBuildings, 0); // no DB building source
  // alice + bob distinct overall = 2 (alice appears in both districts)
  assert.equal(r.result.totalPopulation, 2);
  assert.equal(r.result.totalActiveUsers, 2);

  const exchange = r.result.districts.find((d) => d.districtId === "exchange");
  assert.equal(exchange.population, 2);
  assert.equal(exchange.activityCount, 2);
  const forge = r.result.districts.find((d) => d.districtId === "forge");
  assert.equal(forge.population, 0); // requested but no activity → honest 0
  assert.equal(forge.activityCount, 0);
});

test("hub-totals with no requested districts aggregates only districts with activity", () => {
  resetState();
  run("activity-record", {}, { districtId: "docks", summary: "ship in", actor: "u9" });
  const r = run("hub-totals");
  assert.equal(r.result.districtCount, 1);
  assert.equal(r.result.districts[0].districtId, "docks");
});

test("district-stats reads real world_buildings when a DB handle is present", () => {
  resetState();
  // Minimal fake sqlite handle exposing the world_buildings COUNT query.
  const fakeDb = {
    prepare(sql) {
      if (String(sql).includes("world_buildings")) {
        return { get: () => ({ n: 7 }) };
      }
      return { all: () => [], get: () => null };
    },
  };
  const ctx = { actor: { userId: "u1" }, db: fakeDb };
  const r = run("district-stats", {}, { districtId: "grid" }, ctx);
  assert.equal(r.result.buildingCount, 7);
  assert.equal(r.result.hasBuildingSource, true);
});
