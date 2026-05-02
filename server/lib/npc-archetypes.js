// server/lib/npc-archetypes.js
// World-native NPC definitions keyed by universe_type.
// Each universe has enemies, civilians, and boss archetypes.
// Bosses are backed by conscious emergent AI (is_conscious = 1, is_immortal = 1).

export const UNIVERSE_ARCHETYPES = {

  superhero: {
    enemies: [
      { archetype: 'henchman',         body_type: 'humanoid',  faction: 'villain', level_range: [1, 4],  occupation: 'guard' },
      { archetype: 'mutant_brute',      body_type: 'large',     faction: 'villain', level_range: [3, 7],  occupation: 'enforcer' },
      { archetype: 'tech_villain',      body_type: 'humanoid',  faction: 'villain', level_range: [4, 8],  occupation: 'scientist' },
      { archetype: 'alien_soldier',     body_type: 'alien',     faction: 'invader', level_range: [5, 10], occupation: 'soldier' },
      { archetype: 'corrupted_hero',    body_type: 'humanoid',  faction: 'rogue',   level_range: [6, 12], occupation: 'vigilante' },
      { archetype: 'robot_enforcer',    body_type: 'mech',      faction: 'villain', level_range: [5, 9],  occupation: 'guard' },
    ],
    civilians: [
      { archetype: 'journalist',        body_type: 'humanoid',  faction: 'neutral', occupation: 'journalist' },
      { archetype: 'scientist',         body_type: 'humanoid',  faction: 'neutral', occupation: 'scientist' },
      { archetype: 'vigilante',         body_type: 'humanoid',  faction: 'hero',    occupation: 'vigilante' },
      { archetype: 'politician',        body_type: 'humanoid',  faction: 'neutral', occupation: 'official' },
    ],
    bosses: [
      { archetype: 'crime_lord',        body_type: 'humanoid',  faction: 'villain', is_conscious: 1, is_immortal: 1, quest_giver: 1 },
      { archetype: 'dimension_ruler',   body_type: 'large',     faction: 'villain', is_conscious: 1, is_immortal: 1, quest_giver: 1 },
      { archetype: 'shadow_government', body_type: 'humanoid',  faction: 'neutral', is_conscious: 1, is_immortal: 1, quest_giver: 1 },
    ],
  },

  fantasy: {
    enemies: [
      { archetype: 'goblin',            body_type: 'small',     faction: 'monster', level_range: [1, 3],  occupation: 'raider' },
      { archetype: 'orc_warrior',       body_type: 'large',     faction: 'monster', level_range: [3, 6],  occupation: 'warrior' },
      { archetype: 'dark_wizard',       body_type: 'humanoid',  faction: 'monster', level_range: [5, 9],  occupation: 'mage' },
      { archetype: 'undead',            body_type: 'undead',    faction: 'undead',  level_range: [2, 7],  occupation: 'wanderer' },
      { archetype: 'bandit',            body_type: 'humanoid',  faction: 'outlaw',  level_range: [2, 5],  occupation: 'thief' },
      { archetype: 'dragon_cultist',    body_type: 'humanoid',  faction: 'cult',    level_range: [6, 10], occupation: 'fanatic' },
      { archetype: 'troll',             body_type: 'giant',     faction: 'monster', level_range: [7, 12], occupation: 'guardian' },
    ],
    civilians: [
      { archetype: 'blacksmith',        body_type: 'humanoid',  faction: 'neutral', occupation: 'blacksmith' },
      { archetype: 'merchant',          body_type: 'humanoid',  faction: 'neutral', occupation: 'trader' },
      { archetype: 'farmer',            body_type: 'humanoid',  faction: 'neutral', occupation: 'farmer' },
      { archetype: 'bard',              body_type: 'humanoid',  faction: 'neutral', occupation: 'entertainer' },
      { archetype: 'guard',             body_type: 'humanoid',  faction: 'hero',    occupation: 'guard' },
    ],
    bosses: [
      { archetype: 'lich_king',         body_type: 'undead',    faction: 'undead',  is_conscious: 1, is_immortal: 1, quest_giver: 1 },
      { archetype: 'dragon_lord',       body_type: 'dragon',    faction: 'monster', is_conscious: 1, is_immortal: 1, quest_giver: 1 },
      { archetype: 'dark_jarl',         body_type: 'humanoid',  faction: 'outlaw',  is_conscious: 1, is_immortal: 1, quest_giver: 1 },
    ],
  },

  scifi: {
    enemies: [
      { archetype: 'rogue_android',     body_type: 'mech',      faction: 'rogue',   level_range: [3, 7],  occupation: 'soldier' },
      { archetype: 'alien_scout',       body_type: 'alien',     faction: 'invader', level_range: [4, 8],  occupation: 'scout' },
      { archetype: 'pirate',            body_type: 'humanoid',  faction: 'outlaw',  level_range: [2, 6],  occupation: 'thief' },
      { archetype: 'corporate_enforcer',body_type: 'humanoid',  faction: 'corp',    level_range: [3, 7],  occupation: 'security' },
      { archetype: 'combat_drone',      body_type: 'mech',      faction: 'corp',    level_range: [4, 8],  occupation: 'guard' },
    ],
    civilians: [
      { archetype: 'engineer',          body_type: 'humanoid',  faction: 'neutral', occupation: 'engineer' },
      { archetype: 'medic',             body_type: 'humanoid',  faction: 'neutral', occupation: 'medic' },
      { archetype: 'pilot',             body_type: 'humanoid',  faction: 'neutral', occupation: 'pilot' },
      { archetype: 'hacker',            body_type: 'humanoid',  faction: 'neutral', occupation: 'hacker' },
    ],
    bosses: [
      { archetype: 'ai_overlord',       body_type: 'mech',      faction: 'rogue',   is_conscious: 1, is_immortal: 1, quest_giver: 1 },
      { archetype: 'alien_queen',       body_type: 'alien',     faction: 'invader', is_conscious: 1, is_immortal: 1, quest_giver: 1 },
      { archetype: 'mega_corp_ceo',     body_type: 'humanoid',  faction: 'corp',    is_conscious: 1, is_immortal: 1, quest_giver: 1 },
    ],
  },

  cyberpunk: {
    enemies: [
      { archetype: 'street_gang',       body_type: 'humanoid',  faction: 'gang',    level_range: [1, 4],  occupation: 'thug' },
      { archetype: 'cyborg_enforcer',   body_type: 'cyborg',    faction: 'corp',    level_range: [4, 8],  occupation: 'security' },
      { archetype: 'netrunner',         body_type: 'humanoid',  faction: 'rogue',   level_range: [5, 9],  occupation: 'hacker' },
      { archetype: 'corpo_assassin',    body_type: 'humanoid',  faction: 'corp',    level_range: [6, 10], occupation: 'assassin' },
    ],
    civilians: [
      { archetype: 'fixer',             body_type: 'humanoid',  faction: 'neutral', occupation: 'trader' },
      { archetype: 'street_doc',        body_type: 'humanoid',  faction: 'neutral', occupation: 'medic' },
      { archetype: 'techie',            body_type: 'humanoid',  faction: 'neutral', occupation: 'engineer' },
    ],
    bosses: [
      { archetype: 'gang_warlord',      body_type: 'cyborg',    faction: 'gang',    is_conscious: 1, is_immortal: 1, quest_giver: 1 },
      { archetype: 'corp_chairman',     body_type: 'humanoid',  faction: 'corp',    is_conscious: 1, is_immortal: 1, quest_giver: 1 },
    ],
  },

  horror: {
    enemies: [
      { archetype: 'zombie',            body_type: 'undead',    faction: 'undead',  level_range: [1, 4],  occupation: 'wanderer' },
      { archetype: 'cultist',           body_type: 'humanoid',  faction: 'cult',    level_range: [2, 5],  occupation: 'fanatic' },
      { archetype: 'demon',             body_type: 'demon',     faction: 'demon',   level_range: [6, 11], occupation: 'predator' },
      { archetype: 'wraith',            body_type: 'undead',    faction: 'undead',  level_range: [5, 9],  occupation: 'wanderer' },
      { archetype: 'possessed',         body_type: 'humanoid',  faction: 'demon',   level_range: [4, 8],  occupation: 'wanderer' },
    ],
    civilians: [
      { archetype: 'survivor',          body_type: 'humanoid',  faction: 'neutral', occupation: 'wanderer' },
      { archetype: 'hunter',            body_type: 'humanoid',  faction: 'hero',    occupation: 'hunter' },
      { archetype: 'priest',            body_type: 'humanoid',  faction: 'hero',    occupation: 'cleric' },
    ],
    bosses: [
      { archetype: 'elder_god',         body_type: 'demon',     faction: 'demon',   is_conscious: 1, is_immortal: 1, quest_giver: 1 },
      { archetype: 'cult_leader',       body_type: 'humanoid',  faction: 'cult',    is_conscious: 1, is_immortal: 1, quest_giver: 1 },
    ],
  },

  western: {
    enemies: [
      { archetype: 'outlaw',            body_type: 'humanoid',  faction: 'outlaw',  level_range: [2, 5],  occupation: 'thief' },
      { archetype: 'bounty_hunter',     body_type: 'humanoid',  faction: 'neutral', level_range: [4, 7],  occupation: 'hunter' },
      { archetype: 'bandit_gang',       body_type: 'humanoid',  faction: 'outlaw',  level_range: [3, 6],  occupation: 'raider' },
    ],
    civilians: [
      { archetype: 'sheriff',           body_type: 'humanoid',  faction: 'hero',    occupation: 'official' },
      { archetype: 'saloon_keeper',     body_type: 'humanoid',  faction: 'neutral', occupation: 'trader' },
      { archetype: 'miner',             body_type: 'humanoid',  faction: 'neutral', occupation: 'miner' },
      { archetype: 'doctor',            body_type: 'humanoid',  faction: 'neutral', occupation: 'medic' },
    ],
    bosses: [
      { archetype: 'outlaw_king',       body_type: 'humanoid',  faction: 'outlaw',  is_conscious: 1, is_immortal: 1, quest_giver: 1 },
      { archetype: 'railroad_baron',    body_type: 'humanoid',  faction: 'corp',    is_conscious: 1, is_immortal: 1, quest_giver: 1 },
    ],
  },

  medieval: {
    enemies: [
      { archetype: 'knight_rogue',      body_type: 'humanoid',  faction: 'outlaw',  level_range: [4, 8],  occupation: 'warrior' },
      { archetype: 'mercenary',         body_type: 'humanoid',  faction: 'outlaw',  level_range: [3, 7],  occupation: 'warrior' },
      { archetype: 'plague_bearer',     body_type: 'undead',    faction: 'undead',  level_range: [5, 9],  occupation: 'wanderer' },
      { archetype: 'assassin',          body_type: 'humanoid',  faction: 'guild',   level_range: [6, 10], occupation: 'assassin' },
    ],
    civilians: [
      { archetype: 'knight',            body_type: 'humanoid',  faction: 'hero',    occupation: 'guard' },
      { archetype: 'innkeeper',         body_type: 'humanoid',  faction: 'neutral', occupation: 'trader' },
      { archetype: 'monk',              body_type: 'humanoid',  faction: 'neutral', occupation: 'cleric' },
    ],
    bosses: [
      { archetype: 'dark_king',         body_type: 'humanoid',  faction: 'villain', is_conscious: 1, is_immortal: 1, quest_giver: 1 },
      { archetype: 'assassin_master',   body_type: 'humanoid',  faction: 'guild',   is_conscious: 1, is_immortal: 1, quest_giver: 1 },
    ],
  },

  modern: {
    enemies: [
      { archetype: 'crime_syndicate',   body_type: 'humanoid',  faction: 'crime',   level_range: [2, 5],  occupation: 'thug' },
      { archetype: 'corrupt_officer',   body_type: 'humanoid',  faction: 'corp',    level_range: [3, 6],  occupation: 'security' },
      { archetype: 'hitman',            body_type: 'humanoid',  faction: 'crime',   level_range: [6, 10], occupation: 'assassin' },
    ],
    civilians: [
      { archetype: 'detective',         body_type: 'humanoid',  faction: 'hero',    occupation: 'investigator' },
      { archetype: 'journalist',        body_type: 'humanoid',  faction: 'neutral', occupation: 'journalist' },
      { archetype: 'mechanic',          body_type: 'humanoid',  faction: 'neutral', occupation: 'engineer' },
    ],
    bosses: [
      { archetype: 'godfather',         body_type: 'humanoid',  faction: 'crime',   is_conscious: 1, is_immortal: 1, quest_giver: 1 },
      { archetype: 'intelligence_chief',body_type: 'humanoid',  faction: 'corp',    is_conscious: 1, is_immortal: 1, quest_giver: 1 },
    ],
  },
};

// Fallback for unknown universe types
const GENERIC_ARCHETYPES = {
  enemies:   [{ archetype: 'wanderer', body_type: 'humanoid', faction: 'neutral', level_range: [1, 5], occupation: 'wanderer' }],
  civilians: [{ archetype: 'citizen',  body_type: 'humanoid', faction: 'neutral', occupation: 'citizen' }],
  bosses:    [{ archetype: 'elder',    body_type: 'humanoid', faction: 'neutral', is_conscious: 1, is_immortal: 1, quest_giver: 1 }],
};

/**
 * Get archetype config for a specific universe type and role.
 * @param {string} universeType
 * @param {'enemies'|'civilians'|'bosses'} role
 * @returns {object[]}
 */
export function getArchetypes(universeType, role) {
  const universe = UNIVERSE_ARCHETYPES[universeType] || GENERIC_ARCHETYPES;
  return universe[role] || GENERIC_ARCHETYPES[role] || [];
}

/**
 * Pick a random enemy archetype for a universe type, weighted by level range.
 */
export function pickEnemyArchetype(universeType, targetLevel = 1) {
  const enemies = getArchetypes(universeType, 'enemies');
  const eligible = enemies.filter(e => {
    const [min, max] = e.level_range || [1, 10];
    return targetLevel >= min - 2 && targetLevel <= max + 2;
  });
  return (eligible.length ? eligible : enemies)[Math.floor(Math.random() * (eligible.length || enemies.length))];
}

/**
 * Get spawn config for a world: how many of each role to spawn on world creation.
 */
export function getSpawnConfig(universeType) {
  const enemies   = getArchetypes(universeType, 'enemies');
  const civilians = getArchetypes(universeType, 'civilians');
  const bosses    = getArchetypes(universeType, 'bosses');

  // Bosses: one per boss archetype (they're the Jarls/Governors)
  // Civilians: 2-4 per type
  // Enemies: 3-8 spawns total, varied types
  return {
    bosses:    bosses.map(b => ({ ...b, count: 1 })),
    civilians: civilians.map(c => ({ ...c, count: 2 + Math.floor(Math.random() * 3) })),
    enemies:   enemies.slice(0, 4).map(e => ({ ...e, count: 3 + Math.floor(Math.random() * 6) })),
  };
}

/**
 * Map body_type to AvatarSystem3D appearance hints.
 */
export const BODY_TYPE_APPEARANCE = {
  humanoid: { scale: 1.0,  colorTint: null },
  large:    { scale: 1.4,  colorTint: '#8b4513' },
  small:    { scale: 0.75, colorTint: '#2d5a27' },
  giant:    { scale: 2.0,  colorTint: '#5c4033' },
  mech:     { scale: 1.1,  colorTint: '#607d8b' },
  alien:    { scale: 1.05, colorTint: '#4a148c' },
  undead:   { scale: 1.0,  colorTint: '#37474f' },
  cyborg:   { scale: 1.0,  colorTint: '#0277bd' },
  demon:    { scale: 1.3,  colorTint: '#b71c1c' },
  dragon:   { scale: 3.0,  colorTint: '#e65100' },
};

export const FACTION_COLOR = {
  villain:  '#e53935',
  invader:  '#7b1fa2',
  rogue:    '#f57c00',
  monster:  '#388e3c',
  undead:   '#546e7a',
  outlaw:   '#795548',
  cult:     '#6a1b9a',
  corp:     '#1565c0',
  gang:     '#d84315',
  crime:    '#c62828',
  demon:    '#b71c1c',
  hero:     '#1976d2',
  neutral:  '#9e9e9e',
  guild:    '#6d4c41',
};
