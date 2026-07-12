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
import { up as upRunDraft } from "../migrations/267_run_draft.js";

// Wave 4 — pickUpgrade/tickWave now delegate to the shared run-draft engine
// (run_draft_picks table, migration 267), so tests need both migrations.
function freshDb() { const db = new Database(":memory:"); upHorde(db); upRunDraft(db); return db; }

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

  it("pickUpgrade records a real structured boon via the shared draft engine (Wave 4)", () => {
    const r = startHorde(db, "u1", { worldId: "tunya" });
    tickWave(db, r.runId, { killsThisWave: 0 });
    const p1 = pickUpgrade(db, r.runId, "blade_storm");
    assert.equal(p1.ok, true);
    assert.equal(p1.pickId, "blade_storm");
    // blade_storm's real effect (run-draft.js#DRAFT_POOL) — a structured
    // {stat,value}, not the old cosmetic "all damage +25%" string.
    assert.deepEqual(p1.boon.effect, { stat: "damageMult", value: 0.25 });
    assert.equal(p1.modifiers.damageMult, 0.25);

    const p2 = pickUpgrade(db, r.runId, "iron_hide");
    assert.equal(p2.ok, true);
    // Accumulated bundle now carries BOTH picks' stats.
    assert.equal(p2.modifiers.damageMult, 0.25);
    assert.equal(p2.modifiers.maxHpFlat, 30);
  });

  it("second pick of a distinct stat sums additively into the modifier bundle (hand-verified)", () => {
    // hot_blooded: attackSpeedMult +0.20. Picking it alongside blade_storm's
    // damageMult +0.25 must leave both stats independently correct — no
    // cross-stat bleed, and picking hot_blooded a second time is impossible
    // (already-picked), so the bundle for THIS stat is exactly 0.20, not
    // doubled.
    const r = startHorde(db, "u1", { worldId: "tunya" });
    pickUpgrade(db, r.runId, "blade_storm");
    const p = pickUpgrade(db, r.runId, "hot_blooded");
    assert.equal(p.modifiers.damageMult, 0.25);
    assert.equal(p.modifiers.attackSpeedMult, 0.20);
  });

  it("rejected: invalid upgrade id maps to the historical invalid_upgrade error", () => {
    const r = startHorde(db, "u1", { worldId: "tunya" });
    const p = pickUpgrade(db, r.runId, "godmode");
    assert.equal(p.ok, false);
    assert.equal(p.error, "invalid_upgrade");
  });

  it("rejected: re-picking the same boon maps to slot_collision", () => {
    const r = startHorde(db, "u1", { worldId: "tunya" });
    pickUpgrade(db, r.runId, "blade_storm");
    const p = pickUpgrade(db, r.runId, "blade_storm");
    assert.equal(p.ok, false);
    assert.equal(p.error, "slot_collision");
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

  it("getActiveHorde surfaces the live modifier bundle + active synergies (Wave 4)", () => {
    const r = startHorde(db, "u1", { worldId: "tunya" });
    // Juggernaut synergy: iron_hide (reflectPct doesn't exist... check pool) —
    // use the REAL synergy pair from run-draft.js#SYNERGIES: iron_hide +
    // thorned_aura -> Juggernaut, reflectPct bonus +0.10 on top of
    // thorned_aura's own +0.15.
    pickUpgrade(db, r.runId, "iron_hide");
    pickUpgrade(db, r.runId, "thorned_aura");
    const active = getActiveHorde(db, "u1");
    assert.ok(active);
    assert.equal(active.modifiers.maxHpFlat, 30);
    // 0.15 (thorned_aura) + 0.10 (Juggernaut synergy bonus) = 0.25
    assert.equal(active.modifiers.reflectPct, 0.25);
    assert.equal(active.synergies.length, 1);
    assert.equal(active.synergies[0].id, "juggernaut");
  });

  it("tickWave surfaces a near-synergy hint when one required boon is already picked", () => {
    const r = startHorde(db, "u1", { worldId: "tunya" });
    pickUpgrade(db, r.runId, "iron_hide");
    const t = tickWave(db, r.runId, { killsThisWave: 0 });
    assert.ok(Array.isArray(t.synergyHints));
    const juggernautHint = t.synergyHints.find((h) => h.id === "juggernaut");
    assert.ok(juggernautHint, "expected a juggernaut near-synergy hint after picking iron_hide");
    assert.equal(juggernautHint.missingBoonId, "thorned_aura");
  });
});
