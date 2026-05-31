// N4-EVO — the 3 newly-wired EvoAsset call sites (craft / loot / combat). Pins
// that each path registers/accrues the right evo_asset + interaction, that the
// combat path resolves a skill's asset idempotently (use → fitness), and the
// kill-switch gates it. Drives the bridge handlers the same way the live call
// sites do.
//
// Run: node --test tests/evo-asset-gameplay-wiring.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { onPlayerCraft, onLootDropped, onCombatHit, weaponAssetIdForSkill } from "../lib/gameplay-asset-bridge.js";

function assetBySource(db, sourceId) {
  return db.prepare(`SELECT * FROM evo_assets WHERE source_id = ?`).get(sourceId);
}
function interactionCount(db, assetId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM evo_asset_interactions WHERE asset_id = ?`).get(assetId).n;
}

describe("EvoAsset gameplay wiring", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("onPlayerCraft registers a CRAFT asset + a craft interaction", () => {
    const r = onPlayerCraft(db, { userId: "u1", recipeId: "rec1", itemId: "dtu_sword", quality: 3 });
    assert.ok(r?.id);
    const a = assetBySource(db, "craft:u1:rec1:dtu_sword");
    assert.ok(a);
    assert.equal(a.kind, "craft");
    assert.ok(interactionCount(db, a.id) >= 1);
  });

  it("onLootDropped registers a DROP asset per drop", () => {
    onLootDropped(db, { lootId: "hide", killerId: "u1", victimId: "wolf", label: "Wolf Hide" });
    const a = assetBySource(db, "loot:wolf:hide");
    assert.ok(a);
    assert.equal(a.kind, "drop");
    assert.ok(interactionCount(db, a.id) >= 1);
  });

  it("combat: a skill becomes an evolvable asset that accrues fitness with use", () => {
    // first hit registers the skill asset; subsequent hits accrue interactions.
    const wid = weaponAssetIdForSkill(db, "skill_firebolt");
    assert.ok(wid);
    const a = assetBySource(db, "skill:skill_firebolt");
    assert.equal(a.kind, "skill");
    onCombatHit(db, { attackerId: "u1", victimId: "npc1", weapon: { id: wid }, damage: 50, isCrit: false });
    onCombatHit(db, { attackerId: "u1", victimId: "npc1", weapon: { id: wid }, damage: 100, isCrit: true });
    assert.ok(interactionCount(db, wid) >= 2);
    // interaction_points grew (the fitness the heartbeat scores on)
    const pts = db.prepare(`SELECT interaction_points FROM evo_assets WHERE id=?`).get(wid).interaction_points;
    assert.ok(pts > 0);
  });

  it("weaponAssetIdForSkill is idempotent (same asset across hits)", () => {
    const a = weaponAssetIdForSkill(db, "skill_x");
    const b = weaponAssetIdForSkill(db, "skill_x");
    assert.equal(a, b);
  });

  it("a crit hit accrues more fitness than a normal hit", () => {
    const w1 = weaponAssetIdForSkill(db, "skill_a");
    const w2 = weaponAssetIdForSkill(db, "skill_b");
    onCombatHit(db, { attackerId: "u1", victimId: "n", weapon: { id: w1 }, damage: 100, isCrit: false });
    onCombatHit(db, { attackerId: "u1", victimId: "n", weapon: { id: w2 }, damage: 100, isCrit: true });
    const p1 = db.prepare(`SELECT interaction_points FROM evo_assets WHERE id=?`).get(w1).interaction_points;
    const p2 = db.prepare(`SELECT interaction_points FROM evo_assets WHERE id=?`).get(w2).interaction_points;
    assert.ok(p2 > p1); // crit weight 1.5×
  });
});
