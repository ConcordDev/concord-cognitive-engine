/**
 * P0 (2026-07-11 factions-politics-capability-map audit) — a real
 * DECLARE_WAR/RAID move picked by the faction-strategy cycle must actually
 * spawn a joinable faction-war combat encounter (server/lib/combat/faction-war.js),
 * not just flip faction_strategy_state/faction_relations. Prior to this fix,
 * spawnFactionWar's only caller outside its own module/tests was the
 * admin/test-only POST /api/faction-war/spawn route.
 *
 * Pins:
 *   - a real DECLARE_WAR move (picked via the real pickMove/applyMove path,
 *     run through the real runFactionStrategyCycle heartbeat handler) causes
 *     a real row to land in `faction_wars` with the two real faction ids —
 *     not a mock, the real spawnFactionWar actually ran and wrote real DB rows
 *     (faction_wars + faction_war_npcs).
 *   - a second consecutive war-move (RAID, while still at war) against the
 *     SAME rival does NOT spawn a duplicate encounter — findActiveWarBetween
 *     short-circuits the spawn and the war count stays at 1.
 *   - the kill-switch (CONCORD_FACTION_WAR_SPAWN=0) disables the wiring
 *     entirely without touching the state-machine/relation side effects.
 *
 * Run: node --test tests/faction-war-autospawn.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { ensureFactionState } from "../lib/embodied/faction-strategy.js";
import { runFactionStrategyCycle } from "../emergent/faction-strategy-cycle.js";
import { up as upFactionStrategy } from "../migrations/117_faction_strategy.js";
import { up as upCombatFlow } from "../migrations/088_combat_flow.js";
import { up as upFactionWars } from "../migrations/301_faction_wars.js";
import { findActiveWarBetween } from "../lib/combat/faction-war.js";

function setupDb() {
  const db = new Database(":memory:");
  upFactionStrategy(db);
  upCombatFlow(db);
  upFactionWars(db);
  return db;
}

/** Force both factions back into `expand` stance, ready to move right now —
 * this keeps the deterministic seeded-RNG search for DECLARE_WAR bounded
 * without waiting on the real 6h move cooldown. */
function resetToExpandReady(db, factionIds) {
  const stmt = db.prepare(`
    UPDATE faction_strategy_state
       SET stance = 'expand', target_id = NULL, momentum = 0, next_move_at = 0
     WHERE faction_id = ?
  `);
  for (const id of factionIds) stmt.run(id);
}

function countWars(db) {
  return db.prepare(`SELECT COUNT(*) AS n FROM faction_wars`).get().n;
}

function activeWarRow(db, a, b) {
  return db.prepare(`
    SELECT * FROM faction_wars
     WHERE status = 'active'
       AND ((side_a = ? AND side_b = ?) OR (side_a = ? AND side_b = ?))
  `).get(a, b, b, a);
}

/**
 * Drive the real cycle repeatedly, resetting both factions to a
 * DECLARE_WAR-reachable state before each pass, until the cycle's own
 * `moves` output reports a DECLARE_WAR (or RAID) between the two factions —
 * or we give up. This exercises the real pickMove/applyMove/cycle path, not
 * a hand-constructed "picked" object.
 */
async function driveUntilWarMove(db, factionA, factionB, { maxAttempts = 80 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    resetToExpandReady(db, [factionA, factionB]);
    const result = await runFactionStrategyCycle({ db });
    const warMove = (result.moves || []).find(
      (m) => (m.move === "DECLARE_WAR" || m.move === "RAID") &&
        ((m.factionId === factionA && m.target === factionB) ||
         (m.factionId === factionB && m.target === factionA))
    );
    if (warMove) return { attempts: i + 1, warMove, result };
  }
  return null;
}

describe("faction-strategy DECLARE_WAR/RAID -> spawnFactionWar wiring", () => {
  let prevEnv;
  beforeEach(() => { prevEnv = process.env.CONCORD_FACTION_WAR_SPAWN; });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CONCORD_FACTION_WAR_SPAWN;
    else process.env.CONCORD_FACTION_WAR_SPAWN = prevEnv;
  });

  it("a real DECLARE_WAR/RAID move spawns a real, DB-backed faction-war encounter", async () => {
    const db = setupDb();
    ensureFactionState(db, "iron_wardens");
    ensureFactionState(db, "shadow_network");

    const found = await driveUntilWarMove(db, "iron_wardens", "shadow_network");
    assert.ok(found, "expected DECLARE_WAR or RAID to fire within the attempt budget");
    assert.equal(found.warMove.warReused, false);
    assert.ok(found.warMove.warId, "the cycle's move entry should carry the spawned warId");

    // Real DB row — not mocked. spawnFactionWar really ran and really wrote.
    const row = activeWarRow(db, "iron_wardens", "shadow_network");
    assert.ok(row, "expected an active faction_wars row for the pair");
    assert.equal(row.id, found.warMove.warId);
    assert.equal(row.status, "active");

    // spawnFactionWar's NPC side-effect also really happened.
    const npcCount = db.prepare(`SELECT COUNT(*) AS n FROM faction_war_npcs WHERE war_id = ?`).get(row.id).n;
    assert.ok(npcCount > 0, "expected spawnFactionWar to have inserted faction_war_npcs rows");

    // The strategy state/relation side of the move is unaffected by this wiring.
    const stateRow = db.prepare(`SELECT stance FROM faction_strategy_state WHERE faction_id = ?`).get(
      found.warMove.factionId
    );
    assert.equal(stateRow.stance, "war");
  });

  it("does not create the DB rows via spawnFactionWar's own admin-route caller assumption — findActiveWarBetween sees it", async () => {
    const db = setupDb();
    ensureFactionState(db, "merchant_collective");
    ensureFactionState(db, "zero_collective");
    const found = await driveUntilWarMove(db, "merchant_collective", "zero_collective");
    assert.ok(found);
    const via = findActiveWarBetween(db, "merchant_collective", "zero_collective");
    assert.ok(via);
    assert.equal(via.id, found.warMove.warId);
  });

  it("idempotent: a second consecutive war-move against the same rival does not spawn a duplicate encounter", async () => {
    const db = setupDb();
    ensureFactionState(db, "iron_wardens");
    ensureFactionState(db, "shadow_network");

    const first = await driveUntilWarMove(db, "iron_wardens", "shadow_network");
    assert.ok(first);
    assert.equal(countWars(db), 1);

    // Both factions are now in 'war' stance with target_id set (applyMove
    // persisted this). Bypass the cooldown only (don't reset stance/target)
    // so the NEXT move is a real in-war RAID/SEEK_TRUCE pick against the same
    // rival via the real war-stance branch of pickMove.
    db.prepare(`UPDATE faction_strategy_state SET next_move_at = 0 WHERE faction_id IN (?, ?)`).run(
      "iron_wardens", "shadow_network"
    );
    const second = await runFactionStrategyCycle({ db });
    const secondWarMove = (second.moves || []).find(
      (m) => m.factionId === "iron_wardens" || m.factionId === "shadow_network"
    );
    assert.ok(secondWarMove, "expected the war-stance faction to move again");

    // Whether the second pick was RAID (spawns/reuses) or SEEK_TRUCE (no
    // target-war spawn attempted), the war count must not have grown past 1.
    assert.equal(countWars(db), 1, "no duplicate faction_wars row should exist for the same pair");

    if (secondWarMove.move === "RAID") {
      assert.equal(secondWarMove.warReused, true, "the second RAID should have reused the existing war, not spawned a new one");
    }
  });

  it("kill-switch CONCORD_FACTION_WAR_SPAWN=0 disables the spawn without touching the state machine", async () => {
    process.env.CONCORD_FACTION_WAR_SPAWN = "0";
    const db = setupDb();
    ensureFactionState(db, "iron_wardens");
    ensureFactionState(db, "shadow_network");

    const found = await driveUntilWarMove(db, "iron_wardens", "shadow_network");
    assert.ok(found, "DECLARE_WAR/RAID should still fire — only the spawn is gated");
    assert.equal(found.warMove.warId, undefined, "no warId should be attached when the kill-switch is off");
    assert.equal(countWars(db), 0, "no faction_wars row should have been created");

    // The state-machine side effect (stance -> war) still happened.
    const stateRow = db.prepare(`SELECT stance FROM faction_strategy_state WHERE faction_id = ?`).get(
      found.warMove.factionId
    );
    assert.equal(stateRow.stance, "war");
  });
});
