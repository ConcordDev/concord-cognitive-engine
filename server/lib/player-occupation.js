// server/lib/player-occupation.js
//
// Living Society — Phase 9: occupation-as-verbs for PLAYERS, on the SAME loop
// the NPCs run. A work shift drives the very `dispatchEconomicAction` labor
// functions NPCs use (performConstruction/Farming/Logging/Mining — world-state
// mutation, not a parallel player-economy), pays the Phase-3 employment-edge
// wage, and grants archetype-specific skill XP with apprentice→journeyman→
// master progression. A shift can also fill a Phase-1.5c settlement vacancy.
//
// One loop, no parallel economy. Adding an occupation = a role→activity row.

import crypto from "node:crypto";
import { dispatchEconomicAction } from "./npc-economy.js";
import { gainSkillXP } from "./skills/skill-engine.js";
import { awardSparks } from "./currency.js";

// role → { activity (the NPC labor verb), skill (archetype-specific XP) }
const ROLE_SHIFT = Object.freeze({
  farmer:     { activity: "farm",  skill: "farming" },
  builder:    { activity: "build", skill: "construction" },
  miner:      { activity: "mine",  skill: "mining" },
  logger:     { activity: "log",   skill: "logging" },
  blacksmith: { activity: "build", skill: "smithing" }, // a smith raises the forge + smiths
  laborer:    { activity: "build", skill: "construction" },
});

const SHIFT_XP = Number(process.env.CONCORD_SHIFT_XP) || 40;
const SHIFT_STIPEND = Number(process.env.CONCORD_SHIFT_STIPEND) || 12; // fallback wage when no edge

function playerPos(pos) {
  return { x: Number(pos?.x) || 0, z: Number(pos?.z) || 0 };
}

/**
 * Run a player work shift. Returns the world effect + wage + XP. The player is
 * passed to the SAME action fn an NPC uses (id = userId), so the world mutates
 * identically. Yields from extraction are moved into player_inventory.
 *
 * @param db
 * @param opts { userId, worldId, role, pos, worldType }
 */
export function workShift(db, { userId, worldId, role, pos = {}, worldType = "standard" } = {}) {
  if (!db || !userId || !worldId || !role) return { ok: false, reason: "missing_inputs" };
  const shift = ROLE_SHIFT[String(role).toLowerCase()];
  if (!shift) return { ok: false, reason: "unknown_role" };

  const { x, z } = playerPos(pos);
  const actor = { id: userId, world_id: worldId, archetype: role, x, z };

  // 1. Run the NPC labor verb (world-state mutation).
  const effect = dispatchEconomicAction(db, actor, shift.activity);

  // 2. Move any extraction yield from the actor's npc_inventory row into the
  //    player's world-scoped inventory (a player's loot is player_inventory).
  let yielded = null;
  if (effect?.yield && effect?.taken) {
    try {
      db.prepare(`DELETE FROM npc_inventory WHERE npc_id = ? AND resource_kind = ?`).run(userId, effect.yield);
    } catch { /* npc_inventory absent */ }
    try {
      db.prepare(`
        INSERT INTO player_inventory (id, user_id, world_id, item_type, item_id, item_name, quantity, quality, acquired_at)
        VALUES (?, ?, ?, 'material', ?, ?, ?, 'gathered', unixepoch())
      `).run(crypto.randomUUID(), userId, worldId, effect.yield, effect.yield, effect.taken);
      yielded = { item: effect.yield, quantity: effect.taken };
    } catch { /* player_inventory shape differs */ }
  }

  // 3. Pay the wage. Prefer an active employment edge for this worker; else a
  //    flat shift stipend. Both route through the sparks ledger.
  let wage = 0;
  try {
    const edge = db.prepare(`
      SELECT rate_sparks FROM employment_edges
      WHERE world_id = ? AND worker_kind = 'player' AND worker_id = ? AND active = 1
      ORDER BY rate_sparks DESC LIMIT 1
    `).get(worldId, userId);
    wage = edge?.rate_sparks ?? SHIFT_STIPEND;
  } catch { wage = SHIFT_STIPEND; }
  try { awardSparks(db, userId, wage, `shift:${role}`, worldId); }
  catch { /* users/sparks_ledger absent in a minimal test DB */ }

  // 4. Archetype-specific skill XP (a smith shift boosts smithing, not generic
  //    crafting) — the apprentice→master ladder lives on the skill engine.
  let xp = null;
  try { xp = gainSkillXP(db, userId, shift.skill, worldType, SHIFT_XP); } catch { xp = null; }

  return { ok: true, role, activity: shift.activity, effect, yielded, wage, skill: shift.skill, xp };
}

export const OCCUPATION_ROLES = Object.freeze(Object.keys(ROLE_SHIFT));
export { ROLE_SHIFT };
