// analytics-growth-contract.test.js
//
// FIX-analytics-007: the Platform growth panel reads series points as
// { ts, users, dtus } plus a totals block, but getDtuGrowthTrends
// returned { timestamp, totalDtus, totalProfiles } points and no
// totals — every cell dashed and the chart blank for every range.
// "90d" also fell through to the 24h window. The trends function now
// emits the panel's fields alongside its native ones, totals from the
// latest snapshot in range, and a real 90d window.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getDtuGrowthTrends, takeSnapshot } from "../emergent/analytics-dashboard.js";

function seededState() {
  const STATE = { dtus: new Map(), _social: { profiles: new Map() } };
  takeSnapshot(STATE); // initializes STATE._analytics
  const analytics = STATE._analytics;
  const now = Date.now();
  const snap = (ageMs, totalDtus, totalProfiles) => ({
    ts: now - ageMs,
    timestamp: new Date(now - ageMs).toISOString(),
    totalDtus, totalProfiles, atlasDtus: 0, publicDtus: 0,
  });
  analytics.snapshots = [
    snap(3 * 86400000, 100, 10),   // 3 days old
    snap(2 * 3600000, 140, 14),    // 2 hours old
    snap(30 * 60000, 150, 15),     // 30 minutes old
  ];
  return STATE;
}

test("growth series carries the panel's fields and totals", () => {
  const out = getDtuGrowthTrends(seededState(), { period: "7d" });
  assert.equal(out.ok, true);
  assert.equal(out.series.length, 3);
  const last = out.series[out.series.length - 1];
  assert.equal(last.dtus, 150);
  assert.equal(last.users, 15);
  assert.equal(typeof last.ts, "string");
  assert.equal(last.ts.slice(0, 10), last.timestamp.slice(0, 10));
  assert.deepEqual(out.totals, { users: 15, dtus: 150, activeUsers: null, revenueUsd: null });
});

test("90d queries a 90-day window, not 24h", () => {
  const out90 = getDtuGrowthTrends(seededState(), { period: "90d" });
  assert.equal(out90.series.length, 3); // the 3-day-old snapshot is in range
  const out24 = getDtuGrowthTrends(seededState(), { period: "24h" });
  assert.equal(out24.series.length, 2); // …and out of the 24h range
});

test("no snapshots → empty series and null totals (honest empty)", () => {
  const STATE = { dtus: new Map() };
  takeSnapshot(STATE);
  STATE._analytics.snapshots = [];
  const out = getDtuGrowthTrends(STATE, { period: "7d" });
  assert.equal(out.series.length, 0);
  assert.equal(out.totals, null);
});
