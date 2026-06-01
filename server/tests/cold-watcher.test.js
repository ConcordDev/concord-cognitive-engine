// F1 contract — the cold-watcher. Pins outcome classification + the fleet
// report (abandon/stall/convert rates, hook median, tool-vs-network split).

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { classifyOutcome, coldWatchReport } from "../lib/cold-watcher.js";

function db0() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE onboarding_funnel (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, step TEXT NOT NULL,
    at INTEGER NOT NULL, ms_since_start INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id, step));`);
  return db;
}
function add(db, user, step, at, ms = 0) {
  db.prepare(`INSERT OR IGNORE INTO onboarding_funnel (user_id, step, at, ms_since_start) VALUES (?,?,?,?)`).run(user, step, at, ms);
}

const NOW = 10_000_000;
const MIN = 60_000;

test("converted: reached first_win", () => {
  const db = db0();
  add(db, "u1", "account_created", NOW - 5 * MIN);
  add(db, "u1", "first_action", NOW - 4 * MIN);
  add(db, "u1", "first_win", NOW - 3 * MIN, 2 * MIN);
  assert.equal(classifyOutcome(db, "u1", { nowMs: NOW }), "converted");
});

test("stalled: acted, then quiet past the budget, no hook", () => {
  const db = db0();
  add(db, "u2", "account_created", NOW - 40 * MIN);
  add(db, "u2", "first_action", NOW - 30 * MIN);
  assert.equal(classifyOutcome(db, "u2", { nowMs: NOW }), "stalled");
});

test("abandoned: entered long ago, never a first_action, now quiet", () => {
  const db = db0();
  add(db, "u3", "account_created", NOW - 45 * MIN);
  add(db, "u3", "entered_world", NOW - 44 * MIN);
  assert.equal(classifyOutcome(db, "u3", { nowMs: NOW }), "abandoned");
});

test("active: recent activity, not yet converted", () => {
  const db = db0();
  add(db, "u4", "account_created", NOW - 1 * MIN);
  add(db, "u4", "first_action", NOW - 30_000);
  assert.equal(classifyOutcome(db, "u4", { nowMs: NOW }), "active");
});

test("report aggregates outcomes + rates + hook median", () => {
  const db = db0();
  // converter (hook at 2min)
  add(db, "c1", "account_created", NOW - 10 * MIN);
  add(db, "c1", "first_action", NOW - 9 * MIN);
  add(db, "c1", "first_win", NOW - 8 * MIN, 2 * MIN);
  // stalled
  add(db, "s1", "account_created", NOW - 40 * MIN);
  add(db, "s1", "first_action", NOW - 30 * MIN);
  // abandoned
  add(db, "a1", "account_created", NOW - 50 * MIN);

  const r = coldWatchReport(db, { nowMs: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.totalUsers, 3);
  assert.equal(r.outcomes.converted, 1);
  assert.equal(r.outcomes.stalled, 1);
  assert.equal(r.outcomes.abandoned, 1);
  assert.equal(r.conversionRate, 0.3333); // 1/3 rounded to 4dp
  assert.equal(r.hookMedianMs, 2 * MIN);
});

test("tool-vs-network split reports per-source conversion", () => {
  const db = db0();
  add(db, "t1", "account_created", NOW - 10 * MIN);
  add(db, "t1", "first_win", NOW - 9 * MIN, MIN);
  add(db, "n1", "account_created", NOW - 40 * MIN);
  add(db, "n1", "first_action", NOW - 30 * MIN); // stalled
  const sourceFor = (uid) => (uid.startsWith("t") ? "tool" : "network");
  const r = coldWatchReport(db, { nowMs: NOW, sourceFor });
  assert.equal(r.bySource.tool.conversionRate, 1);
  assert.equal(r.bySource.network.conversionRate, 0);
});

test("no_db is graceful, never throws", () => {
  assert.equal(coldWatchReport(null).ok, false);
  assert.equal(classifyOutcome(null, "x"), "active");
});
