// server/lib/npc-attack.js
//
// One NPC → player strike for every transport. POST
// /api/worlds/:worldId/combat/npc-attack and the /unity-ws `npc:attack` event
// both call resolveNpcAttackOnPlayer, so a creature that hits a Unity player
// runs the same Concordant Law refusal, level-scaled damage, NPC damage cap,
// dodge/block state, revive, pain, low-health and defeat loot as the web path.

import logger from "../logger.js";

function _reply(status, body) {
  return { status, body };
}

/**
 * Resolve one strike by `npcId` (a live world_npcs row) on `userId` in `worldId`.
 * Returns `{ status, body }` where body is the REST response shape.
 */
export async function resolveNpcAttackOnPlayer(db, { worldId, userId, npcId, io = null }) {
  // Concordant Law: NPCs cannot harm players inside the hub. Mirrors the
  // player→NPC gate in routes/worlds.js (POST …/combat/attack).
  if (worldId === "concordia-hub" || worldId === "concordia") {
    return _reply(403, {
      ok: false,
      error: "concordant_law_refusal",
      reason: "The Three Above All refuse violence within Concordia.",
    });
  }

  const {
    computeDamage,
    applyDamageToPlayer,
    getOrCreateNPCResistances,
    getOrInitPlayerBars,
  } = await import("./combat/damage-calculator.js");

  const npc = db.prepare(`
    SELECT id, archetype, criminal_rep, fire_resistance, ice_resistance,
           physical_resistance, current_hp, max_hp, npc_type, is_conscious,
           x, z
    FROM world_npcs WHERE id = ?
  `).get(npcId);
  if (!npc) return _reply(404, { ok: false, error: "NPC not found" });

  // WS1: NPC attack power derives from its GROWN combat level (skill +
  // evolution), so a leveled frontier hostile genuinely threatens a player
  // while a level-1 hub NPC stays harmless. Gated behind CONCORD_ABSOLUTE_POWER
  // — with the flag off, npcAttackStats returns the legacy
  // `5 + criminal_rep*10` shape so behaviour is unchanged.
  const { getEntityCombatLevel, npcAttackStats, capNpcDamage,
          getPlayerCombatLevel, relativeScaledLevel } =
    await import("./entity-power.js");
  const element = npc.archetype === 'mage' ? 'energy' : 'physical';
  // E1 (Phase E §0) — RELATIVE scaling (no-op unless CONCORD_RELATIVE_SCALING
  // is on): named/authored NPCs + bosses are floored to ~player tier so they
  // stay a credible threat; common NPCs are capped below the player so a
  // leveled player genuinely outgrows trash (the power fantasy). "Named" =
  // boss type, an authored/conscious NPC, or a title-bearing archetype.
  const isNamedNpc = npc.npc_type === 'boss' || !!npc.is_conscious
    || /boss|warlord|champion|overlord|queen|king|captain|lord|elder|matriarch/i.test(npc.archetype || '');
  const combatLevel = relativeScaledLevel(
    getEntityCombatLevel(db, npc.id),
    getPlayerCombatLevel(db, userId),
    { named: isNamedNpc },
  );
  const attackerStats = npcAttackStats(combatLevel, element, { criminalRep: npc.criminal_rep || 0 });

  // Fetch player resistances from equipped armor DTUs
  const armorDtu = db.prepare(`
    SELECT data FROM dtus WHERE creator_id = ? AND type = 'item'
    ORDER BY created_at DESC LIMIT 1
  `).get(userId);
  let armorData = {};
  if (armorDtu) {
    try { armorData = JSON.parse(armorDtu.data); } catch { /* ignore */ }
  }
  const defenderStats = {
    physical_resistance: armorData.defense ? Math.min(0.5, armorData.defense / 200) : 0,
    fire_resistance: armorData.fire_resistance || 0,
    ice_resistance: armorData.ice_resistance || 0,
    status_effects: '[]',
  };
  // The player's own hp bar decides the kill. Without it computeDamage
  // compared each strike against a default 100, so a player at 0 hp was
  // never defeated unless one strike reached 100.
  const bars = getOrInitPlayerBars(db, userId, worldId);
  defenderStats.current_hp = bars?.hp ?? 100;
  defenderStats.max_hp = bars?.max_hp ?? 100;

  const damageResult = computeDamage(attackerStats, defenderStats, {});
  // WS1 anti-cheat / anti-misconfig: cap NPC outgoing damage (mirrors the
  // player-side _validateDamageCap). No-op when the flag is off.
  damageResult.finalDamage = capNpcDamage(damageResult.finalDamage, attackerStats);

  // D2 (depth plan) — honor the player's server-tracked defensive state so
  // a well-timed dodge (i-frames) or a held block actually matters against
  // an NPC attack. Before this, the NPC→player path applied damage with no
  // defensive check, so dodge/parry/block were cosmetic here while the
  // socket handlers dutifully recorded i-frames/block windows that nothing
  // ever consulted. combat-state.js is a single shared module instance
  // (ESM path-cached), so the dodge i-frames granted on the socket path are
  // visible here. applyHitToState early-returns on i-frames before poise
  // depletion, so a whiffed hit costs the player no poise.
  try {
    const { applyHitToState } = await import("./combat-state.js");
    const defMod = applyHitToState(userId, {
      damage: damageResult.finalDamage,
      isCrit: !!damageResult.isCrit,
    });
    if (defMod.iframed) {
      try {
        io?.to(`world:${worldId}`).emit("combat:npc-attack-evaded", {
          worldId, npcId, userId, reason: "iframe", t: Date.now(),
        });
      } catch { /* evade emit best-effort */ }
      return _reply(200, { ok: true, evaded: true, reason: "iframe", finalDamage: 0, eventId: null });
    }
    if (defMod.damageMul !== 1 && Number.isFinite(damageResult.finalDamage)) {
      damageResult.finalDamage = Math.round(damageResult.finalDamage * defMod.damageMul);
      if (defMod.blocked) damageResult.blocked = true;
    }
  } catch { /* combat-state optional — fall through to undefended damage */ }
  // The cap and any block changed finalDamage after computeDamage set `kill`.
  damageResult.kill = damageResult.finalDamage >= defenderStats.current_hp;

  const { eventId, kill: killRaw } = applyDamageToPlayer(db, worldId, npcId, 'npc', userId, damageResult, {
    element, bar_used: 'hp', bar_cost: damageResult.finalDamage,
    // Hit position → the attacking NPC's live world_npcs position (already
    // SELECTed above for this route). The footprint overlay draws CREATURE
    // tracks, so the NPC combatant's position is the correct one on both
    // directions of the exchange. Null-safe: NULL beats a guessed coordinate.
    x: npc?.x, z: npc?.z,
  });
  let kill = killRaw;

  // Wave 4 (Gap C) — roguelite death handling. A hit that WOULD kill the
  // player is intercepted here, before any downstream kill-consequence
  // logic (near-death awakening, pvp-loot) runs, so a consumed revive
  // reads as "survived" everywhere below, not as a death that got
  // undone after the fact.
  let revived = null;
  if (kill) {
    try {
      const { maybeReviveRoguelitePlayer } = await import("./roguelite.js");
      const rev = maybeReviveRoguelitePlayer(db, userId, worldId);
      if (rev.revived) {
        kill = false;
        revived = rev;
        io?.to(`user:${userId}`)?.emit?.("roguelite:revived", {
          worldId, revivesRemaining: rev.revivesRemaining, reviveHp: rev.reviveHp,
        });
      }
    } catch { /* roguelite substrate optional — a kill without an active run is unaffected */ }
  }

  // ── Layer 8: record pain signal ────────────────────────────────────────
  // Players' bodies remember. The repair-cycle heartbeat will turn this
  // into endurance / strength / agility / vitality / focus XP plus a
  // `damage_resist` buff at the next 20-tick boundary.
  try {
    const { recordPain, regionForElement } = await import("./embodied/pain.js");
    const intensity = Math.max(0.05, Math.min(1, (damageResult.finalDamage || 0) / 100));
    recordPain(db, userId, {
      worldId, region: regionForElement(element),
      intensity, source: 'combat', sourceId: eventId, element,
    });
  } catch { /* Layer 8 disabled — combat still works */ }

  // WS4(b) — near-death awakening trigger. If the player SURVIVED a hit that
  // dropped them to a sliver of HP, surface an awakening opportunity (a
  // stress-triggered power spike, MHA-style). Advisory event; the client
  // confirms which skill to awaken via the skill-awakening.awaken macro.
  if (!kill) {
    try {
      const { isNearDeath } = await import("./skill-awakening.js");
      const bars = db.prepare(
        `SELECT hp, max_hp FROM player_resource_bars WHERE user_id = ? AND world_id = ?`
      ).get(userId, worldId);
      if (bars && isNearDeath(bars.hp, bars.max_hp)) {
        io?.to(`user:${userId}`)?.emit?.("player:awakening-available", {
          worldId, hp: bars.hp, maxHp: bars.max_hp, source: 'near_death_survived',
        });
      }
      // Low-health signal for the screen-reader / a11y bridge. The world page
      // subscribes to `player:low-health` (SR_BRIDGE_EVENTS) but until now
      // nothing emitted it — a receiver with no caller. Fire it whenever the
      // player drops below LOW_HEALTH_FRACTION so the announce / HUD cue is a
      // pure function of a real backend event.
      const LOW_HEALTH_FRACTION = 0.3;
      if (bars && bars.max_hp > 0 && bars.hp / bars.max_hp <= LOW_HEALTH_FRACTION) {
        io?.to(`user:${userId}`)?.emit?.("player:low-health", {
          worldId, hp: bars.hp, maxHp: bars.max_hp,
          fraction: Math.max(0, bars.hp / bars.max_hp),
          source: 'npc_attack',
        });
      }
    } catch { /* awakening + low-health surfacing is best-effort */ }
  }

  // ── Layer 2 (loop honesty): the kill consequence must LAND ──────────────
  // When an NPC defeats a player, the player really loses sparks + 1–3 items
  // into a loot bag the NPC claims. handleNPCKilledPlayer (lib/pvp-loot.js)
  // does all of this — but it had ZERO callers, so for months "You have been
  // defeated" fired while the player's wallet/inventory stayed untouched (a
  // toast-without-grant, like the fixed world-event endEvent bug). Wire it
  // here, on the real kill, so the consequence is asserted-true not pretended.
  let lootDrop = null;
  if (kill) {
    try {
      const { handleNPCKilledPlayer } = await import("./pvp-loot.js");
      lootDrop = handleNPCKilledPlayer(db, {
        npcId, playerId: userId, worldId,
        x: Number(npc.x) || 0, y: 0, z: Number(npc.z) || 0,
      });
      // Truthful feedback travels in the response `lootDrop` below — the
      // caller IS the victim (the authenticated userId), so no extra socket
      // emit is needed (and a world-room emit with no listener would be an
      // orphan). The grant itself is the source of truth.
    } catch (lootErr) {
      // Loot is best-effort — a drop failure must never wedge the combat
      // response. But it is a real grant, not a notification, so we log it.
      logger.warn?.("pvp-loot", "npc_kill_loot_failed", { worldId, npcId, userId, error: String(lootErr?.message || lootErr) });
    }
  }

  let after = null;
  try {
    after = db.prepare("SELECT hp, max_hp FROM player_resource_bars WHERE user_id = ? AND world_id = ?").get(userId, worldId);
  } catch { /* bars optional */ }

  return _reply(200, {
    ok: true, damageResult, eventId, kill, lootDrop: lootDrop || undefined,
    playerHp: after?.hp ?? null, playerMaxHp: after?.max_hp ?? null,
    revived: revived || undefined,
    message: kill ? 'You have been defeated' : (revived ? 'A second chance — you live on' : undefined),
  });
}

export default { resolveNpcAttackOnPlayer };
