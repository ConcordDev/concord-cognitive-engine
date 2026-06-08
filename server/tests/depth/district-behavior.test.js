// server/tests/depth/district-behavior.test.js
//
// Behavioral coverage for the `district` lens-action domain via a LOCAL SHIM
// (no server boot, no DB). Asserts the snapshot-record → timeline-list
// round-trip, exact growth-analysis deltas, districts-list counts, validation
// rejections, and empty-by-default behavior.

import test from "node:test";
import assert from "node:assert/strict";
import register from "../../domains/district.js";

const H = new Map();
register((d, a, fn) => H.set(a, fn));
const run = (a, data = {}, params = {}, ctx = { actor: { userId: "u1" } }) =>
  H.get(a)(ctx, { data }, params);

// Each test gets a clean STATE store so districts don't bleed across cases.
function resetStore() {
  if (!globalThis._concordSTATE) globalThis._concordSTATE = {};
  globalThis._concordSTATE.districtSnapshots = new Map();
}

test("registers all four macros", () => {
  assert.ok(H.has("snapshot-record"));
  assert.ok(H.has("timeline-list"));
  assert.ok(H.has("growth-analysis"));
  assert.ok(H.has("districts-list"));
  // substantive: a freshly-registered domain lists zero districts
  assert.deepEqual(run("districts-list").result.districts, []);
});

test("timeline-list is empty by default", () => {
  resetStore();
  const r = run("timeline-list", {}, { districtId: "north" });
  assert.equal(r.ok, true);
  assert.equal(r.result.count, 0);
  assert.deepEqual(r.result.snapshots, []);
});

test("snapshot-record → timeline-list round-trip is ordered", () => {
  resetStore();
  const a = run("snapshot-record", {}, {
    districtId: "north", buildingCount: 10, population: 100, activeUsers: 5,
    at: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(a.ok, true);
  const b = run("snapshot-record", {}, {
    districtId: "north", buildingCount: 20, population: 250, activeUsers: 12,
    at: "2026-02-01T00:00:00.000Z",
  });
  assert.equal(b.ok, true);

  const list = run("timeline-list", {}, { districtId: "north" });
  assert.equal(list.ok, true);
  assert.equal(list.result.count, 2);
  // oldest first
  assert.equal(list.result.snapshots[0].buildingCount, 10);
  assert.equal(list.result.snapshots[1].buildingCount, 20);
  assert.ok(list.result.snapshots[0].ts <= list.result.snapshots[1].ts);
});

test("timeline-list orders out-of-order inserts and respects limit", () => {
  resetStore();
  run("snapshot-record", {}, { districtId: "south", buildingCount: 3, population: 30, at: "2026-03-01T00:00:00.000Z" });
  run("snapshot-record", {}, { districtId: "south", buildingCount: 1, population: 10, at: "2026-01-01T00:00:00.000Z" });
  run("snapshot-record", {}, { districtId: "south", buildingCount: 2, population: 20, at: "2026-02-01T00:00:00.000Z" });

  const all = run("timeline-list", {}, { districtId: "south" });
  const buildings = all.result.snapshots.map((s) => s.buildingCount);
  assert.deepEqual(buildings, [1, 2, 3]);

  const limited = run("timeline-list", {}, { districtId: "south", limit: 2 });
  assert.equal(limited.result.count, 2);
  // most-recent two, still in order
  assert.deepEqual(limited.result.snapshots.map((s) => s.buildingCount), [2, 3]);
});

test("growth-analysis computes exact deltas on 2 snapshots", () => {
  resetStore();
  run("snapshot-record", {}, { districtId: "east", buildingCount: 10, population: 100, activeUsers: 4, at: "2026-01-01T00:00:00.000Z" });
  run("snapshot-record", {}, { districtId: "east", buildingCount: 25, population: 200, activeUsers: 10, at: "2026-02-01T00:00:00.000Z" });

  const g = run("growth-analysis", {}, { districtId: "east" });
  assert.equal(g.ok, true);
  assert.equal(g.result.hasAnalysis, true);
  assert.equal(g.result.snapshotCount, 2);
  assert.equal(g.result.periods, 1);
  assert.equal(g.result.deltas.buildingCount, 15);
  assert.equal(g.result.deltas.population, 100);
  assert.equal(g.result.deltas.activeUsers, 6);
  // single period: compound rate == simple ratio - 1
  assert.equal(g.result.growthRatePerPeriod.population, 1.0); // 200/100 - 1
  assert.equal(g.result.percentChange.population, 100);
  assert.equal(g.result.percentChange.buildingCount, 150);
  assert.equal(g.result.trend, "growing");
});

test("growth-analysis labels a declining trend", () => {
  resetStore();
  run("snapshot-record", {}, { districtId: "west", buildingCount: 30, population: 300, at: "2026-01-01T00:00:00.000Z" });
  run("snapshot-record", {}, { districtId: "west", buildingCount: 20, population: 150, at: "2026-02-01T00:00:00.000Z" });
  const g = run("growth-analysis", {}, { districtId: "west" });
  assert.equal(g.result.deltas.population, -150);
  assert.equal(g.result.trend, "declining");
});

test("growth-analysis gives guidance with < 2 snapshots", () => {
  resetStore();
  // zero snapshots
  const none = run("growth-analysis", {}, { districtId: "empty" });
  assert.equal(none.ok, true);
  assert.equal(none.result.hasAnalysis, false);
  assert.equal(none.result.snapshotCount, 0);
  assert.ok(none.result.guidance.includes("at least 2"));

  // one snapshot
  run("snapshot-record", {}, { districtId: "solo", buildingCount: 5, population: 50 });
  const one = run("growth-analysis", {}, { districtId: "solo" });
  assert.equal(one.result.hasAnalysis, false);
  assert.equal(one.result.snapshotCount, 1);
  assert.ok(one.result.guidance.includes("at least 2"));
});

test("districts-list reports distinct districts with snapshot counts", () => {
  resetStore();
  run("snapshot-record", {}, { districtId: "alpha", buildingCount: 1, population: 10 });
  run("snapshot-record", {}, { districtId: "alpha", buildingCount: 2, population: 20 });
  run("snapshot-record", {}, { districtId: "beta", buildingCount: 3, population: 30 });

  const r = run("districts-list");
  assert.equal(r.ok, true);
  assert.equal(r.result.count, 2);
  const alpha = r.result.districts.find((d) => d.districtId === "alpha");
  const beta = r.result.districts.find((d) => d.districtId === "beta");
  assert.ok(alpha);
  assert.ok(beta);
  assert.equal(alpha.snapshotCount, 2);
  assert.equal(beta.snapshotCount, 1);
});

test("districts-list is empty by default", () => {
  resetStore();
  const r = run("districts-list");
  assert.equal(r.ok, true);
  assert.equal(r.result.count, 0);
  assert.deepEqual(r.result.districts, []);
});

test("snapshot-record rejects missing districtId", () => {
  resetStore();
  const r = run("snapshot-record", {}, { buildingCount: 1, population: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("districtId"));
});

test("snapshot-record rejects non-numeric buildingCount", () => {
  resetStore();
  const r = run("snapshot-record", {}, { districtId: "x", buildingCount: "lots", population: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("buildingCount"));
});

test("snapshot-record rejects missing population", () => {
  resetStore();
  const r = run("snapshot-record", {}, { districtId: "x", buildingCount: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("population"));
});

test("snapshot-record rejects negative numeric fields", () => {
  resetStore();
  const r = run("snapshot-record", {}, { districtId: "x", buildingCount: -1, population: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("buildingCount"));
});

test("snapshot-record rejects an invalid timestamp", () => {
  resetStore();
  const r = run("snapshot-record", {}, { districtId: "x", buildingCount: 1, population: 1, at: "not-a-date" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("timestamp"));
});

test("timeline-list and growth-analysis reject missing districtId", () => {
  resetStore();
  const a = run("timeline-list", {}, {});
  assert.equal(a.ok, false);
  assert.ok(a.error.includes("districtId"));
  const b = run("growth-analysis", {}, {});
  assert.equal(b.ok, false);
  assert.ok(b.error.includes("districtId"));
});
