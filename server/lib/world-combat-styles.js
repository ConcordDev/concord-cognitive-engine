// server/lib/world-combat-styles.js
//
// Per-world combat styles. The Concordia hub is the ONLY non-combat zone.
// Every other world is FFA with consequences — but each world has unique
// damage types, weapons, abilities, and faction rules that shape combat.

/**
 * Hub ground refuses all violence (existing HUB_GROUND_NO_COMBAT rule).
 * Other worlds have unique combat styles:
 *
 * - Cyber: hacking, EMP, drone strikes, network warfare
 *   Damage types: virus, emp, drone_strike, data_drain
 *   Factions: corp_security, netrunners, ai_cult, freelancers
 *
 * - Crime: gunfights, theft, intimidation, fence operations
 *   Damage types: bullet, blunt, knife, intimidation
 *   Factions: docks_union, smugglers, syndicate, fixers
 *
 * - Fantasy: magic spells, melee weapons, mounts, siege
 *   Damage types: fire, frost, holy, arcane, bludgeon, pierce
 *   Factions: kingdom, druids, mages_guild, beastfolk
 *
 * - Frontier: ranged weapons, survival, taming
 *   Damage types: rifle, pistol, trap, beast_attack
 *   Factions: rangers, homesteaders, traders, raiders
 *
 * - Superhero: powers, gadgets, team-ups
 *   Damage types: kinetic, energy, psionic, gadget, elemental
 *   Factions: luminary, regulator, renegades, civilians
 *
 * - Lattice-Crucible: subway shadows, crystal resonance, void
 *   Damage types: void, crystal_resonance, shadow, mind
 *   Factions: keepers, shades, crystals, seekers
 *
 * - Sovereign-Ruins: ancient weapons, refusal field combat
 *   Damage types: refusal, ancient_blade, stone, wind
 *   Factions: keepers, hunters, scholars, ruins_walkers
 *
 * - Tunya: open prairie combat, ranged, mounted
 *   Damage types: rifle, lance, bow, prairie_storm
 *   Factions: ranchers, drifters, sun_cult, mesa_holders
 *
 * - Concord-Link (between worlds): restricted but allowed for keepers
 *   Damage types: refusal, breath, law
 *   Factions: keepers (exclusive)
 *
 * CONCORDIA-HUB: HUB_GROUND_NO_COMBAT = true. No exceptions.
 * The ground IS Concordia; she refuses hostile movement and combat.
 * This is canon (LORE_BIBLE §1) and enforced by physics-engine.js.
 */

export const WORLD_COMBAT_STYLES = {
  'concordia-hub': {
    combatAllowed: false,
    reason: 'hub_ground_refuses_violence',
    damageTypes: [],
    factions: ['citizens', 'keepers', 'witnesses'],
    weapons: [],
    abilities: [],
    consequences: {
      hostile_action: 'ground_refuses_movement',
      weapon_drawn: 'soft_power_disarm',
      attack_attempted: 'cascade_does_not_fire_but_divinity_shifts_toward_sovereign',
    },
  },

  cyber: {
    combatAllowed: true,
    damageTypes: ['virus', 'emp', 'drone_strike', 'data_drain', 'kinetic', 'energy'],
    factions: ['corp_security', 'netrunners', 'ai_cult', 'freelancers'],
    weapons: ['pistol', 'rifle', 'drone', 'deck', 'shock_baton'],
    abilities: ['hack', 'overclock', 'trace', 'ghost_protocol'],
    signatureEvent: 'data_storm',
    consequences: {
      kill: 'corp_response_squad',
      faction_war: 'grid_lockout',
      ai_cult_member_killed: 'cascade_fires_immediately',
    },
  },

  crime: {
    combatAllowed: true,
    damageTypes: ['bullet', 'blunt', 'knife', 'intimidation', 'molotov'],
    factions: ['docks_union', 'smugglers', 'syndicate', 'fixers'],
    weapons: ['pistol', 'smg', 'knife', 'bat', 'garrote'],
    abilities: ['threaten', 'fence', 'cut_rope', 'pay_off'],
    signatureEvent: 'dock_war',
    consequences: {
      syndicate_member_killed: 'faction_lockout_no_more_drops',
      kill_civilian: 'divinity_drops_to_sovereign_immediately',
    },
  },

  fantasy: {
    combatAllowed: true,
    damageTypes: ['fire', 'frost', 'holy', 'arcane', 'bludgeon', 'pierce', 'slash'],
    factions: ['kingdom', 'druids', 'mages_guild', 'beastfolk'],
    weapons: ['sword', 'staff', 'bow', 'axe', 'spear', 'wand'],
    abilities: ['cast', 'mount', 'summon', 'ritual', 'bless', 'curse'],
    signatureEvent: 'arcane_tempest',
    consequences: {
      beastfolk_attacked_unprovoked: 'cascade_fires_within_hour',
      kingdom_civilian_killed: 'kingdom_declares_open_season',
    },
  },

  frontier: {
    combatAllowed: true,
    damageTypes: ['rifle', 'pistol', 'trap', 'beast_attack', 'knife'],
    factions: ['rangers', 'homesteaders', 'traders', 'raiders'],
    weapons: ['rifle', 'pistol', 'knife', 'trap', 'lasso'],
    abilities: ['track', 'tame', 'survive', 'signal'],
    signatureEvent: 'storm_chase',
    consequences: {
      homesteader_killed: 'rangers_track_player_relentlessly',
      beast_tamed_killed: 'cascade_fires',
    },
  },

  superhero: {
    combatAllowed: true,
    damageTypes: ['kinetic', 'energy', 'psionic', 'gadget', 'elemental'],
    factions: ['luminary', 'regulator', 'renegades', 'civilians'],
    weapons: ['fists', 'boots', 'gadget', 'beam', 'psionic_blast'],
    abilities: ['fly', 'super_strength', 'toughness', 'team_up', 'power_surge'],
    signatureEvent: 'sky_duel',
    consequences: {
      civilian_killed: 'regulator_response_squad + divinity_lock',
      teammate_killed: 'cascade_fires_immediately',
    },
  },

  'lattice-crucible': {
    combatAllowed: true,
    damageTypes: ['void', 'crystal_resonance', 'shadow', 'mind', 'kinetic'],
    factions: ['keepers', 'shades', 'crystals', 'seekers'],
    weapons: ['resonance_blade', 'void_touch', 'crystal_stave', 'mind_spike'],
    abilities: ['resonate', 'phase', 'warp_perception', 'attune'],
    signatureEvent: 'resonance_cascade',
    consequences: {
      shade_killed: 'shade_swarm_response',
      crystal_shattered: 'cascade_fires_within_minutes',
    },
  },

  'sovereign-ruins': {
    combatAllowed: true,
    damageTypes: ['refusal', 'ancient_blade', 'stone', 'wind', 'arrow'],
    factions: ['keepers', 'hunters', 'scholars', 'ruins_walkers'],
    weapons: ['ancient_blade', 'refusal_ward', 'longbow', 'staff'],
    abilities: ['invoke_refusal', 'read_stone', 'summon_wind', 'consecrate'],
    signatureEvent: 'refusal_echo',
    consequences: {
      ruins_walker_killed: 'cascade_fires',
      refusal_field_damaged: 'divinity_shifts_immediately',
    },
  },

  tunya: {
    combatAllowed: true,
    damageTypes: ['rifle', 'lance', 'bow', 'prairie_storm', 'knife'],
    factions: ['ranchers', 'drifters', 'sun_cult', 'mesa_holders'],
    weapons: ['rifle', 'lance', 'bow', 'knife', 'whip'],
    abilities: ['mount', 'track', 'ride_storm', 'lasso'],
    signatureEvent: 'sun_storm',
    consequences: {
      rancher_killed: 'ranchers_track_player_to_edge_of_world',
      mesa_holder_killed: 'cascade_fires_at_sunset',
    },
  },

  'concord-link-frontier': {
    combatAllowed: true,
    damageTypes: ['refusal', 'breath', 'law'],
    factions: ['keepers'],
    weapons: ['refusal_blade', 'breath', 'law_glyph'],
    abilities: ['seal', 'unseal', 'walk_link'],
    signatureEvent: 'link_shudder',
    consequences: {
      keeper_attacked: 'the_three_respond',
    },
  },
};

/**
 * Returns whether combat is allowed in a world.
 * @param {string} worldId
 * @returns {boolean}
 */
export function isCombatAllowed(worldId) {
  const style = WORLD_COMBAT_STYLES[worldId];
  if (!style) return false;
  return style.combatAllowed === true;
}

/**
 * Returns the unique damage types for a world.
 * @param {string} worldId
 * @returns {string[]}
 */
export function getDamageTypes(worldId) {
  const style = WORLD_COMBAT_STYLES[worldId];
  return style ? style.damageTypes : [];
}

/**
 * Returns consequences for hostile action in a world.
 * @param {string} worldId
 * @param {string} action
 * @returns {string|null}
 */
export function getConsequence(worldId, action) {
  const style = WORLD_COMBAT_STYLES[worldId];
  if (!style || !style.consequences) return null;
  return style.consequences[action] || null;
}

/**
 * Get full combat style for a world.
 * @param {string} worldId
 * @returns {object}
 */
export function getWorldCombatStyle(worldId) {
  return WORLD_COMBAT_STYLES[worldId] || null;
}

/**
 * Returns all worldIds that allow combat.
 * @returns {string[]}
 */
export function getCombatWorlds() {
  return Object.entries(WORLD_COMBAT_STYLES)
    .filter(([_, style]) => style.combatAllowed)
    .map(([id]) => id);
}

export default {
  WORLD_COMBAT_STYLES,
  isCombatAllowed,
  getDamageTypes,
  getConsequence,
  getWorldCombatStyle,
  getCombatWorlds,
};
