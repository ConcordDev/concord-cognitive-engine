// Phase CB2 — bullet heaven horde mode tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  startHorde, tickWave, pickUpgrade, endHorde,
  getActiveHorde, isHordeAutoAttack, spawnRateAtWave,
  UPGRADE_CATALOG, BASE_SPAWN_RATE, SPAWN_RATE_GROWTH,
} from "../lib/horde-mode.js";
import { up as upHorde } from "../migrations/246_horde_mode.js";

function freshDb() { const db = new Database(":memory:"); upHorde(db); return db; }

describe("Phase CB2 — horde mode", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("startHorde creates a run; re-start returns existing active", () => {
    const a = startHorde(db, "u1", { worldId: "tunya" });
    assert.equal(a.alreadyActive, false);
    const b = startHorde(db, "u1", { worldId: "tunya" });
    assert.equal(b.alreadyActive, true);
    assert.equal(a.runId, b.runId);
  });

  it("spawnRateAtWave grows exponentially", () => {
    assert.equal(spawnRateAtWave(1), BASE_SPAWN_RATE);
    assert.equal(spawnRateAtWave(2), BASE_SPAWN_RATE * SPAWN_RATE_GROWTH);
    const w10 = spawnRateAtWave(10);
    assert.ok(w10 > spawnRateAtWave(5));
  });

  it("tickWave increments wave, kills, score + returns 3 upgrade choices", () => {
    const r = startHorde(db, "u1", { worldId: "tunya" });
    const t = tickWave(db, r.runId, { killsThisWave: 50 });
    assert.equal(t.ok, true);
    assert.equal(t.wave, 1);
    assert.equal(t.kills, 50);
    assert.equal(t.score, 50 * 10 + 1 * 25);
    assert.equal(t.upgradeChoices.length, 3);
  });

  it("pickUpgrade records choice, dedupe via slot index", () => {
    const r = startHorde(db, "u1", { worldId: "tunya" });
    tickWave(db, r.runId, { killsThisWave: 0 });
    const p1 = pickUpgrade(db, r.runId, "blade_storm");
    assert.equal(p1.ok, true);
    assert.equal(p1.slotIdx, 0);
    const p2 = pickUpgrade(db, r.runId, "iron_hide");
    assert.equal(p2.slotIdx, 1);
  });

  it("rejected: invalid upgrade id", () => {
    const r = startHorde(db, "u1", { worldId: "tunya" });
    const p = pickUpgrade(db, r.runId, "godmode");
    assert.equal(p.ok, false);
    assert.equal(p.error, "invalid_upgrade");
  });

  it("upgrade choices don't include already-picked upgrades", () => {
    const r = startHorde(db, "u1", { worldId: "tunya" });
    pickUpgrade(db, r.runId, "blade_storm");
    pickUpgrade(db, r.runId, "iron_hide");
    const t = tickWave(db, r.runId, { killsThisWave: 0 });
    const ids = t.upgradeChoices.map(u => u.id);
    assert.ok(!ids.includes("blade_storm"));
    assert.ok(!ids.includes("iron_hide"));
  });

  it("endHorde with death flips ended_at + reason", () => {
    const r = startHorde(db, "u1", { worldId: "tunya" });
    const e = endHorde(db, r.runId, { reason: "death" });
    assert.equal(e.ok, true);
    assert.equal(getActiveHorde(db, "u1"), null);
  });

  it("tickWave on ended run rejected", () => {
    const r = startHorde(db, "u1", { worldId: "tunya" });
    endHorde(db, r.runId, { reason: "death" });
    const t = tickWave(db, r.runId, { killsThisWave: 1 });
    assert.equal(t.ok, false);
    assert.equal(t.error, "run_ended");
  });

  it("isHordeAutoAttack returns true while run active", () => {
    startHorde(db, "u1", { worldId: "tunya" });
    assert.equal(isHordeAutoAttack(db, "u1"), true);
  });
});
