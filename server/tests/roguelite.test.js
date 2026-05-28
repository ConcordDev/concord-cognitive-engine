// Phase CB1 — roguelite meta-progression tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  startRun, endRun, getBalance, purchaseUnlock, listUnlocks,
  hasUnlock, getActiveRun, listRecentRuns,
} from "../lib/roguelite.js";
import { up as upRoguelite } from "../migrations/245_roguelite_runs.js";

function freshDb() { const db = new Database(":memory:"); upRoguelite(db); return db; }

describe("Phase CB1 — roguelite runs", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("startRun creates a run for a region; same region re-enter is idempotent", () => {
    const a = startRun(db, "u1", { worldId: "tunya", regionId: "reg-1" });
    assert.equal(a.ok, true);
    assert.equal(a.alreadyActive, false);
    const b = startRun(db, "u1", { worldId: "tunya", regionId: "reg-1" });
    assert.equal(b.runId, a.runId);
    assert.equal(b.alreadyActive, true);
  });

  it("startRun in a different region closes the prior active run as timeout", () => {
    const a = startRun(db, "u1", { worldId: "tunya", regionId: "reg-1" });
    startRun(db, "u1", { worldId: "tunya", regionId: "reg-2" });
    const prior = db.prepare(`SELECT end_reason FROM roguelite_runs WHERE id = ?`).get(a.runId);
    assert.equal(prior.end_reason, "timeout");
  });

  it("endRun with death banks half the depth-based currency", () => {
    const r = startRun(db, "u1", { worldId: "tunya", regionId: "reg-1" });
    const e = endRun(db, r.runId, { reason: "death", depthReached: 4 });
    assert.equal(e.ok, true);
    // depth 4 × 5 = 20, × 0.5 = 10
    assert.equal(e.earned, 10);
    assert.equal(getBalance(db, "u1").balance, 10);
  });

  it("endRun with extract banks 1.25× currency", () => {
    const r = startRun(db, "u1", { worldId: "tunya", regionId: "reg-1" });
    const e = endRun(db, r.runId, { reason: "extract", depthReached: 4 });
    // depth 4 × 5 = 20, × 1.25 = 25
    assert.equal(e.earned, 25);
  });

  it("endRun is idempotent on already-ended run", () => {
    const r = startRun(db, "u1", { worldId: "tunya", regionId: "reg-1" });
    endRun(db, r.runId, { reason: "extract", depthReached: 2 });
    const e2 = endRun(db, r.runId, { reason: "death", depthReached: 5 });
    assert.equal(e2.ok, false);
    assert.equal(e2.error, "already_ended");
  });

  it("purchaseUnlock deducts balance + records ownership", () => {
    const r = startRun(db, "u1", { worldId: "tunya", regionId: "reg-1" });
    endRun(db, r.runId, { reason: "extract", depthReached: 20 }); // earns 125
    const p = purchaseUnlock(db, "u1", "extra_slot", 50);
    assert.equal(p.ok, true);
    assert.equal(p.balanceRemaining, 75);
    assert.equal(hasUnlock(db, "u1", "extra_slot"), true);
  });

  it("re-purchase of same unlock rejected", () => {
    const r = startRun(db, "u1", { worldId: "tunya", regionId: "reg-1" });
    endRun(db, r.runId, { reason: "extract", depthReached: 20 });
    purchaseUnlock(db, "u1", "extra_slot", 50);
    const p2 = purchaseUnlock(db, "u1", "extra_slot", 50);
    assert.equal(p2.ok, false);
    assert.equal(p2.error, "already_unlocked");
  });

  it("insufficient funds rejected", () => {
    const r = startRun(db, "u1", { worldId: "tunya", regionId: "reg-1" });
    endRun(db, r.runId, { reason: "death", depthReached: 1 }); // earns 2
    const p = purchaseUnlock(db, "u1", "extra_slot", 50);
    assert.equal(p.ok, false);
    assert.equal(p.error, "insufficient_funds");
  });

  it("getActiveRun returns null after end", () => {
    const r = startRun(db, "u1", { worldId: "tunya", regionId: "reg-1" });
    assert.ok(getActiveRun(db, "u1"));
    endRun(db, r.runId, { reason: "extract", depthReached: 3 });
    assert.equal(getActiveRun(db, "u1"), null);
  });
});
