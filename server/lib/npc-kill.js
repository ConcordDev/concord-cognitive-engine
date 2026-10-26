// server/lib/npc-kill.js
//
// One NPC death path for every transport. POST /api/worlds/:worldId/npcs/:npcId/kill
// and the /unity-ws creature kill both call resolveNpcKill, so a kill from the
// Unity client runs the same restraint gate, death consequences, nemesis
// record, sparks and loot bag as one from the web.

import logger from "../logger.js";
import { mirrorToGateways } from "./gateway-fanout.js";

function _parsePos(val) {
  if (val && typeof val === "object") return val;
  try { return JSON.parse(val) || { x: 0, y: 0, z: 0 }; } catch { return { x: 0, y: 0, z: 0 }; }
}

/**
 * Kill an NPC on behalf of `killerId`.
 * Returns `{ died:false, spared:true, reason, combatState }` when restraint spares it,
 * `{ died:false, reason:'immortal' }` for an immortal NPC, otherwise the
 * triggerNPCDeath result plus `nemesisDefeated`, `sparksAwarded`, `lootBagId`, `lootItems`.
 */
export async function resolveNpcKill(db, { worldId, npcId, killerId, combatLog = null, io = null }) {
  // Temperament P4 — a target that has surrendered / been downed or arrested
  // is hors de combat and cannot be executed. Gated by CONCORD_TEMPERAMENT
  // (off → never spares; binary combat preserved). Records the lethal attempt
  // as an excessive-force legitimacy event for the P6 rubric.
  try {
    const { shouldSpareExecution } = await import("./combat-restraint.js");
    const spare = shouldSpareExecution(db, npcId);
    if (spare.spare) {
      try {
        const { recordLegitimacyEvent } = await import("./legitimacy.js");
        recordLegitimacyEvent(db, { worldId, actorId: killerId, npcId, kind: "execute_hors_de_combat", combatState: spare.combatState });
      } catch { /* legitimacy ledger optional until P6 */ }
      io?.to(`world:${worldId}`).emit("world:npc-spared", { npcId, worldId, reason: spare.reason, combatState: spare.combatState });
      return { died: false, spared: true, reason: spare.reason, combatState: spare.combatState };
    }
  } catch { /* restraint gate best-effort — never blocks a normal kill */ }

  const { triggerNPCDeath } = await import("./npc-consequences.js");
  const { onPlayerKilledNemesis, recordCombatMemory } = await import("./nemesis.js");

  const result = await triggerNPCDeath(db, npcId, killerId, (event, data) => {
    io?.emit(event, data);
  });
  if (!result.died && result.reason === "immortal") return result;

  // Record combat memory in nemesis if applicable
  if (result.died && combatLog && killerId) {
    recordCombatMemory(db, npcId, killerId, combatLog);
    const nemesisKilled = await onPlayerKilledNemesis(db, killerId, npcId, (event, data) => {
      io?.emit(event, data);
    });
    result.nemesisDefeated = !!nemesisKilled;
  }

  // Award sparks for the kill
  if (result.died && killerId) {
    try {
      const { awardSparks } = await import("./currency.js");
      const npc = db.prepare("SELECT * FROM world_npcs WHERE id = ?").get(npcId);
      const sparks = (npc?.level || 1) * 5;
      awardSparks(db, killerId, sparks, "npc_kill", worldId);
      result.sparksAwarded = sparks;

      // Generate a loot bag at NPC's last position
      try {
        const { generateNPCLoot, createLootBag, lootDroppedPayload } = await import("./loot-generator.js");
        const { getNPCGear } = await import("./npc-gear.js");
        const gear = getNPCGear(db, npcId);
        const items = generateNPCLoot(npc, gear);
        const pos = _parsePos(npc.current_location);
        const bagId = createLootBag(db, worldId, pos, "npc", npcId, "player", killerId, items);
        result.lootBagId = bagId;
        result.lootItems = items;
        // Game clients (Unity/Godot) in this world see the bag drop.
        try {
          mirrorToGateways("loot:dropped", lootDroppedPayload(bagId, worldId, pos, items), { worldId });
        } catch { /* fan-out best-effort */ }
      } catch (lootErr) {
        logger.debug("worlds", "loot_bag_skip", { reason: lootErr?.message });
      }
    } catch { /* non-fatal */ }
  }

  return result;
}

export default { resolveNpcKill };
