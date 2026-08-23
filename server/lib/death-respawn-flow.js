// server/lib/death-respawn-flow.js
//
// Death/respawn flow. Handles:
// - Death trigger (HP drops to 0 in combat worlds; HP clamps at 1 in hub)
// - Death screen state (5-second screen fade + camera detach)
// - Respawn location (home portal / last save point / nearest safe zone)
// - Penalty (item drop, XP loss, faction reputation hit)
// - PvP: killer gets kill credit + faction bounty

const RESPAWN_DELAY_MS = 5000;        // 5s death screen
const HUB_RESPAWN_PROTECTION = true;  // HP clamps at 1 — sovereignty refusal field
const XP_LOSS_PERCENT = 0.10;         // 10% XP loss on death
const ITEM_DROP_PERCENT = 0.0;        // No item drop (3D MMO with consequences, not gear loss)
const FACTION_REP_LOSS = 5;          // -5 faction rep per kill

/**
 * Compute the death event for a player dying in a world.
 */
export function computeDeathEvent(player, cause, killer) {
  // Hub: Sovereign's refusal field prevents death (HP clamps at 1)
  if (player.worldId === 'concordia-hub') {
    return null; // No death — divinity shifts toward Sovereign instead
  }

  const respawnLocation = {
    worldId: 'concordia-hub',
    x: 0,
    y: 0,
    z: 0,
  };

  const repLost = killer ? FACTION_REP_LOSS : 0;

  return {
    playerId: player.id,
    worldId: player.worldId,
    cause,
    killerId: killer ? killer.id : undefined,
    killerFaction: killer ? killer.faction : undefined,
    location: { x: player.x, y: player.y, z: player.z },
    timestamp: Date.now(),
    respawnAt: Date.now() + RESPAWN_DELAY_MS,
    respawnLocation,
    penalty: {
      xpLost: Math.floor(player.xp * XP_LOSS_PERCENT),
      repLost,
    },
  };
}

/**
 * Apply the death event to the player.
 */
export function applyDeathRespawn(player, event) {
  if (event.penalty.xpLost > 0) {
    player.xp = Math.max(0, player.xp - event.penalty.xpLost);
  }

  if (event.penalty.repLost > 0 && player.factionRep) {
    const f = player.faction;
    if (player.factionRep[f]) {
      player.factionRep[f] = Math.max(0, player.factionRep[f] - event.penalty.repLost);
    }
  }

  player.worldId = event.respawnLocation.worldId;
  player.x = event.respawnLocation.x;
  player.y = event.respawnLocation.y;
  player.z = event.respawnLocation.z;

  if (player.hp !== undefined && player.maxHp !== undefined) {
    player.hp = Math.floor(player.maxHp * 0.5);
  }

  if (player.divinity) {
    player.divinity.sovereign = (player.divinity.sovereign || 0) - 1;
  }
}

/**
 * Death screen UI state — broadcast to the dying client.
 */
export function buildDeathScreen(event) {
  let message = 'You died';
  switch (event.cause) {
    case 'combat':    message = `Slain in combat in ${event.worldId}`; break;
    case 'pvp':       message = `Killed by ${event.killerId} in ${event.worldId}`; break;
    case 'environment': message = `Killed by the world in ${event.worldId}`; break;
    case 'fall':      message = `Fell to your death in ${event.worldId}`; break;
    case 'magic':     message = `Killed by a spell in ${event.worldId}`; break;
  }

  return {
    visible: true,
    message,
    cause: event.cause,
    respawnAt: event.respawnAt,
    respawnLocation: { worldId: event.respawnLocation.worldId },
    xpLost: event.penalty.xpLost,
    repLost: event.penalty.repLost,
  };
}

/**
 * Hub immunity: HP clamps at 1, no death possible.
 * Divinity alignment shifts toward Sovereign on hostile action.
 */
export function applyHubImmortality(player, hpDelta) {
  if (player.worldId !== 'concordia-hub') {
    return { hpAfter: (player.hp || 100) - hpDelta, divinityShift: 0 };
  }

  const currentHp = player.hp || 100;
  const hpAfter = Math.max(1, currentHp - hpDelta);
  const divinityShift = hpDelta > 0 ? -1 : 0;

  return { hpAfter, divinityShift };
}

export default {
  computeDeathEvent,
  applyDeathRespawn,
  buildDeathScreen,
  applyHubImmortality,
};
