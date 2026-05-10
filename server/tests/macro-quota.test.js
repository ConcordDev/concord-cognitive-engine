/**
 * Tier-2 contract tests for DX Platform Phase A1 — per-user macro quota.
 *
 * Pinned:
 *   - checkUserQuota returns ok:true when no prior calls
 *   - incrementUserQuota UPSERTs by composite PK
 *   - quota fires retryAfterMs when limit reached in current minute window
 *   - sweepOldQuotaRows deletes rows older than retention
 *   - listUserQuotas returns the per-macro current-window snapshot
 *   - failure path is fail-open (returns ok:true if migration not applied)
 *
 * Run: node --test tests/macro-quota.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig145 from "../migrations/145_macro_call_billing.js";
import * as mig002 from "../migrations/002_economy_tables.js";
import {
  checkUserQuota,
  incrementUserQuota,
  sweepOldQuotaRows,
  listUserQuotas,
  limitForMacro,
} from "../lib/macro-quota.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  mig002.up(db);
  mig145.up(db);
});

afterEach(() => {
  try { db?.close(); } catch { /* intentional */ }
  delete process.env.FF_MACRO_BILLING;
});

describe("checkUserQuota", () => {
  it("returns ok:true with full remaining when no prior calls", () => {
    const r = checkUserQuota(db, "alice", "detectors", "run");
    assert.equal(r.ok, true);
    const limit = limitForMacro("detectors", "run");
    assert.equal(r.remaining, limit);
    assert.equal(r.limit, limit);
  });

  it("returns ok:true with Infinity when FF_MACRO_BILLING is off", () => {
    process.env.FF_MACRO_BILLING = "0";
    const r = checkUserQuota(db, "alice", "detectors", "run");
    assert.equal(r.ok, true);
    assert.equal(r.remaining, Infinity);
  });

  it("fails open when migration is not applied", () => {
    const freshDb = new Database(":memory:");
    const r = checkUserQuota(freshDb, "alice", "detectors", "run");
    assert.equal(r.ok, true);
    freshDb.close();
  });

  it("returns ok:false when current-window count >= limit", () => {
    const limit = limitForMacro("detectors", "runAll");
    const windowStart = Math.floor(Math.floor(Date.now() / 1000) / 60) * 60;
    db.prepare(`
      INSERT INTO user_macro_quota (user_id, domain, macro_name, window_start, call_count)
      VALUES ('alice', 'detectors', 'runAll', ?, ?)
    `).run(windowStart, limit);
    const r = checkUserQuota(db, "alice", "detectors", "runAll");
    assert.equal(r.ok, false);
    assert.equal(r.remaining, 0);
    assert.ok(r.retryAfterMs >= 0);
    assert.ok(r.retryAfterMs <= 60_000);
  });
});

describe("incrementUserQuota", () => {
  it("creates a new row when no prior count exists", () => {
    const r = incrementUserQuota(db, "alice", "detectors", "run");
    assert.equal(r.ok, true);
    const row = db.prepare(`
      SELECT call_count FROM user_macro_quota
      WHERE user_id = 'alice' AND domain = 'detectors' AND macro_name = 'run'
    `).get();
    assert.equal(row.call_count, 1);
  });

  it("increments existing count via UPSERT", () => {
    incrementUserQuota(db, "alice", "detectors", "run");
    incrementUserQuota(db, "alice", "detectors", "run");
    incrementUserQuota(db, "alice", "detectors", "run");
    const row = db.prepare(`
      SELECT call_count FROM user_macro_quota WHERE user_id = 'alice'
    `).get();
    assert.equal(row.call_count, 3);
  });

  it("isolates counts per (user, domain, macro)", () => {
    incrementUserQuota(db, "alice", "detectors", "run");
    incrementUserQuota(db, "bob", "detectors", "run");
    incrementUserQuota(db, "alice", "repair", "runProphet");
    const all = db.prepare(`SELECT * FROM user_macro_quota`).all();
    assert.equal(all.length, 3);
  });

  it("respects FF_MACRO_BILLING=0 — no-op", () => {
    process.env.FF_MACRO_BILLING = "0";
    const r = incrementUserQuota(db, "alice", "detectors", "run");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "billing_disabled");
    const rows = db.prepare(`SELECT * FROM user_macro_quota`).all();
    assert.equal(rows.length, 0);
  });
});

describe("sweepOldQuotaRows", () => {
  it("deletes rows whose window_start is older than retention", () => {
    const oldEpoch = Math.floor(Date.now() / 1000) - 86400 - 60;
    const recentEpoch = Math.floor(Date.now() / 1000) - 60;
    db.prepare(`INSERT INTO user_macro_quota (user_id, domain, macro_name, window_start, call_count) VALUES (?, ?, ?, ?, ?)`)
      .run("alice", "detectors", "run", oldEpoch, 5);
    db.prepare(`INSERT INTO user_macro_quota (user_id, domain, macro_name, window_start, call_count) VALUES (?, ?, ?, ?, ?)`)
      .run("alice", "detectors", "run", recentEpoch, 1);
    const r = sweepOldQuotaRows(db, 24);
    assert.equal(r.ok, true);
    assert.equal(r.deleted, 1);
    const remaining = db.prepare(`SELECT COUNT(*) AS n FROM user_macro_quota`).get();
    assert.equal(remaining.n, 1);
  });

  it("returns ok:false when db is missing", () => {
    const r = sweepOldQuotaRows(null, 24);
    assert.equal(r.ok, false);
  });
});

describe("listUserQuotas", () => {
  it("returns current-window quotas for the user", () => {
    incrementUserQuota(db, "alice", "detectors", "run");
    incrementUserQuota(db, "alice", "detectors", "run");
    incrementUserQuota(db, "alice", "repair", "runProphet");
    const list = listUserQuotas(db, "alice");
    assert.equal(list.length, 2);
    const detRun = list.find(x => x.domain === "detectors" && x.macroName === "run");
    assert.ok(detRun);
    assert.equal(detRun.used, 2);
    assert.equal(detRun.limit, limitForMacro("detectors", "run"));
    assert.equal(detRun.remaining, detRun.limit - 2);
  });

  it("returns empty array for unknown user", () => {
    const list = listUserQuotas(db, "ghost");
    assert.equal(list.length, 0);
  });
});

describe("limitForMacro", () => {
  it("returns configured limit for a known macro", () => {
    assert.ok(limitForMacro("detectors", "run") > 0);
    assert.ok(limitForMacro("repair", "runProphet") > 0);
  });

  it("returns the fallback for unknown macros", () => {
    const v = limitForMacro("totally_unknown", "macro");
    assert.ok(Number.isFinite(v));
    assert.ok(v > 0);
  });
});
