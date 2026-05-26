// server/lib/npc-gear.js
// NPC self-managed gear economy:
//   - Each occupation earns wealth_sparks per simulator tick
//   - Every ~20 ticks the NPC evaluates whether to upgrade a gear slot
//   - Emergent leaders transfer wealth to undergeared faction members
//   - Hard ceiling: no NPC may exceed the top-percentile active-player gear level

import crypto from 'crypto';
import logger from '../logger.js';
import { WEAPON_CLASS_INFO, inferWeaponClass } from './combat/loadout.js';

// ── Constants ─────────────────────────────────────────────────────────────────

// Sparks earned per simulator tick (~60 s) by occupation
const OCCUPATION_INCOME = {
  blacksmith:  4.0,  trader:     3.5,  merchant:   3.5,
  engineer:    3.0,  scientist:  3.0,  medic:      2.5,
  guard:       2.0,  journalist: 2.0,  farmer:     1.5,
  hunter:      2.0,  rogue:      2.5,  soldier:    2.0,
  default:     1.0,
};

// Cumulative cost to reach each gear level (sparks)
const GEAR_UPGRADE_COST = [0, 0, 20, 50, 100, 200, 400, 800, 1600, 3200, 6400];
const MAX_GEAR_LEVEL = 10;

// Stat increments per gear level per slot
const SLOT_STATS = {
  weapon:    (lvl) => ({ damage:  5 * lvl, speed: lvl }),
  armor:     (lvl) => ({ defense: 5 * lvl, hp:    10 * lvl }),
  tool:      (lvl) => ({ efficiency: 0.1 * lvl }),
  accessory: (lvl) => ({ luck: 0.05 * lvl, speed: Math.floor(lvl / 2) }),
};

// Archetype → default loadout slots
const ARCHETYPE_SLOTS = {
  guard:      ['weapon', 'armor'],
  soldier:    ['weapon', 'armor'],
  hunter:     ['weapon', 'armor', 'accessory'],
  rogue:      ['weapon', 'accessory'],
  blacksmith: ['tool', 'armor'],
  engineer:   ['tool', 'accessory'],
  scientist:  ['tool'],
  medic:      ['tool', 'accessory'],
  trader:     ['accessory'],
  farmer:     ['tool'],
  default:    ['weapon'],
};

// ── Archetype → tiered weapon classes (level → class list) ─────────────────
//
// Each archetype has 5 tier bands keyed by minimum level:
//   1 = novice   (club, knife, hatchet — improvised / starter)
//   3 = trained  (sword, mace, bow — journeyman gear)
//   5 = veteran  (halberd, longbow, staff — full-kit professional)
//   7 = elite    (greatsword, energy_rifle, gunblade — top-of-class)
//   9 = legendary (scythe, railgun, mantis_blades — pinnacle / unique)
//
// pickWeaponClassForArchetype(archetype, npcId, level) walks down the
// keys, picks the highest tier ≤ level, then deterministically picks
// one class from that tier band keyed by npcId.
//
// Each band is curated so the picked class CATEGORY upgrades coherently
// (e.g. warrior stays melee_*, mage stays focus). Coverage test pins
// the contract.
const ARCHETYPE_WEAPON_TIERS = {
  // Frontline melee
  warrior: {
    1: ['club', 'mace'],
    3: ['sword', 'mace', 'hatchet'],
    5: ['sword', 'flail', 'spear', 'halberd'],
    7: ['greatsword', 'greataxe', 'glaive'],
    9: ['scythe', 'greatsword', 'meteor_hammer'],
  },
  guard: {
    1: ['club', 'mace'],
    3: ['spear', 'sword', 'mace'],
    5: ['halberd', 'spear', 'sword'],
    7: ['halberd', 'guan_dao', 'bardiche'],
    9: ['halberd', 'pole_hammer', 'glaive'],
  },
  guardian: {
    1: ['mace', 'shield'],
    3: ['spear', 'shield', 'mace'],
    5: ['halberd', 'tower_shield', 'spear'],
    7: ['halberd', 'tower_shield', 'guan_dao'],
    9: ['pole_hammer', 'tower_shield', 'meteor_hammer'],
  },
  knight: {
    1: ['mace', 'sword'],
    3: ['sword', 'lance', 'mace'],
    5: ['sword', 'lance', 'flail'],
    7: ['greatsword', 'lance', 'pole_hammer'],
    9: ['greatsword', 'glaive', 'meteor_hammer'],
  },
  soldier: {
    1: ['pistol', 'club'],
    3: ['pistol', 'shotgun', 'carbine'],
    5: ['rifle', 'carbine', 'shotgun'],
    7: ['rifle', 'sniper', 'lmg'],
    9: ['sniper', 'anti_material', 'rpg'],
  },
  enforcer: {
    1: ['club', 'knuckles'],
    3: ['mace', 'club', 'flail'],
    5: ['hammer', 'mace', 'flail'],
    7: ['maul', 'hammer', 'flail'],
    9: ['maul', 'meteor_hammer', 'kanabo'],
  },
  fanatic: {
    1: ['club', 'sickle'],
    3: ['flail', 'sickle', 'club'],
    5: ['scythe', 'flail', 'pike'],
    7: ['scythe', 'flail', 'greataxe'],
    9: ['scythe', 'meteor_hammer', 'urumi'],
  },
  raider: {
    1: ['club', 'hatchet'],
    3: ['cutlass', 'mace', 'hatchet'],
    5: ['cutlass', 'tomahawk', 'mace'],
    7: ['greataxe', 'cutlass', 'flail'],
    9: ['greataxe', 'macuahuitl', 'scythe'],
  },
  berserker: {
    1: ['club', 'hatchet'],
    3: ['mace', 'hatchet', 'tomahawk'],
    5: ['greataxe', 'maul', 'flail'],
    7: ['greataxe', 'scythe', 'maul'],
    9: ['scythe', 'meteor_hammer', 'kanabo'],
  },

  // Ranged / stealth
  hunter: {
    1: ['sling', 'shortbow'],
    3: ['shortbow', 'bow', 'dagger'],
    5: ['longbow', 'crossbow', 'dagger'],
    7: ['longbow', 'crossbow', 'harpoon'],
    9: ['longbow', 'crossbow', 'sniper'],
  },
  scout: {
    1: ['sling', 'dagger'],
    3: ['shortbow', 'dagger', 'crossbow'],
    5: ['crossbow', 'shortbow', 'dagger'],
    7: ['crossbow', 'longbow', 'rapier'],
    9: ['longbow', 'sniper', 'chakram'],
  },
  ranger: {
    1: ['sling', 'shortbow'],
    3: ['shortbow', 'bow', 'crossbow'],
    5: ['longbow', 'crossbow', 'shortbow'],
    7: ['longbow', 'crossbow', 'rapier'],
    9: ['longbow', 'sniper', 'crossbow'],
  },
  archer: {
    1: ['shortbow', 'bow'],
    3: ['shortbow', 'bow', 'crossbow'],
    5: ['longbow', 'crossbow', 'bow'],
    7: ['longbow', 'crossbow'],
    9: ['longbow', 'chakram'],
  },
  rogue: {
    1: ['dagger'],
    3: ['dagger', 'rapier', 'kukri'],
    5: ['rapier', 'dagger', 'cutlass'],
    7: ['rapier', 'kukri', 'gunblade'],
    9: ['rapier', 'urumi', 'monomolecular_whip'],
  },
  assassin: {
    1: ['dagger'],
    3: ['dagger', 'kukri', 'sai'],
    5: ['katana', 'dagger', 'kukri'],
    7: ['katana', 'gunblade', 'monomolecular_whip'],
    9: ['katana', 'monomolecular_whip', 'mantis_blades'],
  },
  thief: {
    1: ['dagger', 'sai'],
    3: ['dagger', 'sai'],
    5: ['dagger', 'rapier', 'sai'],
    7: ['rapier', 'kukri', 'gunblade'],
    9: ['rapier', 'monomolecular_whip', 'urumi'],
  },
  ninja: {
    1: ['dagger', 'kama'],
    3: ['thrown', 'katana', 'kama'],
    5: ['katana', 'kusarigama', 'thrown'],
    7: ['katana', 'kusarigama', 'sai'],
    9: ['katana', 'urumi', 'monomolecular_whip'],
  },
  thug: {
    1: ['club', 'knuckles'],
    3: ['club', 'mace', 'knuckles'],
    5: ['mace', 'hammer', 'flail'],
    7: ['hammer', 'maul', 'flail'],
    9: ['maul', 'kanabo', 'meteor_hammer'],
  },
  predator: {
    1: ['fist', 'claw'],
    3: ['claw', 'fist', 'knuckles'],
    5: ['claw', 'knuckles', 'gauntlet'],
    7: ['gauntlet', 'claw', 'mantis_blades'],
    9: ['mantis_blades', 'gorilla_arms', 'claw'],
  },

  // Magic / focus
  mage: {
    1: ['wand', 'rod'],
    3: ['wand', 'rod', 'orb'],
    5: ['staff', 'orb', 'grimoire'],
    7: ['staff', 'grimoire', 'scepter'],
    9: ['staff', 'grimoire', 'crystal'],
  },
  mystic: {
    1: ['talisman', 'rod'],
    3: ['rod', 'talisman', 'orb'],
    5: ['orb', 'staff', 'talisman'],
    7: ['staff', 'scepter', 'orb'],
    9: ['staff', 'crystal', 'grimoire'],
  },
  wizard: {
    1: ['wand', 'rod'],
    3: ['wand', 'staff', 'grimoire'],
    5: ['staff', 'grimoire', 'wand'],
    7: ['staff', 'grimoire', 'scepter'],
    9: ['staff', 'grimoire', 'crystal'],
  },
  sorcerer: {
    1: ['wand', 'rod'],
    3: ['wand', 'orb', 'crystal'],
    5: ['orb', 'crystal', 'wand'],
    7: ['scepter', 'orb', 'crystal'],
    9: ['scepter', 'crystal', 'grimoire'],
  },
  warlock: {
    1: ['rod', 'wand'],
    3: ['wand', 'scepter', 'grimoire'],
    5: ['scepter', 'grimoire', 'wand'],
    7: ['scepter', 'grimoire', 'staff'],
    9: ['scepter', 'crystal', 'grimoire'],
  },
  shaman: {
    1: ['rod', 'talisman'],
    3: ['rod', 'talisman', 'staff'],
    5: ['staff', 'talisman', 'rod'],
    7: ['staff', 'talisman', 'scepter'],
    9: ['staff', 'talisman', 'crystal'],
  },
  cleric: {
    1: ['mace', 'rod'],
    3: ['mace', 'staff', 'talisman'],
    5: ['mace', 'staff', 'scepter'],
    7: ['scepter', 'mace', 'staff'],
    9: ['scepter', 'staff', 'flail'],
  },
  priest: {
    1: ['rod', 'mace'],
    3: ['scepter', 'staff', 'rod'],
    5: ['scepter', 'staff'],
    7: ['scepter', 'staff', 'grimoire'],
    9: ['scepter', 'crystal', 'grimoire'],
  },

  // Tech / cyber
  hacker: {
    1: ['pistol', 'dagger'],
    3: ['pistol', 'smart_gun', 'emp_gun'],
    5: ['smart_gun', 'emp_gun', 'pistol'],
    7: ['smart_gun', 'emp_gun', 'tech_gun'],
    9: ['tech_gun', 'emp_gun', 'monomolecular_whip'],
  },
  pilot: {
    1: ['pistol', 'derringer'],
    3: ['pistol', 'smart_gun'],
    5: ['smart_gun', 'laser_pistol', 'pistol'],
    7: ['laser_pistol', 'smart_gun', 'beam_rifle'],
    9: ['beam_rifle', 'laser_pistol', 'particle_beam'],
  },
  engineer: {
    1: ['hammer', 'pistol'],
    3: ['hammer', 'pistol', 'tech_gun'],
    5: ['tech_gun', 'hammer', 'smart_gun'],
    7: ['tech_gun', 'plasma', 'railgun'],
    9: ['railgun', 'plasma', 'gauss_rifle'],
  },
  cyborg: {
    1: ['gauntlet', 'knuckles'],
    3: ['gauntlet', 'gorilla_arms', 'mantis_blades'],
    5: ['mantis_blades', 'gorilla_arms', 'tech_gun'],
    7: ['mantis_blades', 'gorilla_arms', 'monomolecular_whip'],
    9: ['mantis_blades', 'monomolecular_whip', 'gorilla_arms'],
  },
  marksman: {
    1: ['pistol', 'bow'],
    3: ['rifle', 'pistol', 'crossbow'],
    5: ['sniper', 'rifle', 'longbow'],
    7: ['sniper', 'rifle', 'anti_material'],
    9: ['sniper', 'anti_material', 'railgun'],
  },
  gunslinger: {
    1: ['derringer', 'pistol'],
    3: ['revolver', 'pistol', 'shotgun'],
    5: ['revolver', 'shotgun', 'hand_cannon'],
    7: ['hand_cannon', 'revolver', 'shotgun'],
    9: ['hand_cannon', 'gunblade', 'revolver'],
  },

  // Civilian / utility
  vigilante: {
    1: ['fist', 'club'],
    3: ['kanabo', 'club', 'pistol'],
    5: ['kanabo', 'pistol', 'mace'],
    7: ['pistol', 'kanabo', 'gunblade'],
    9: ['gunblade', 'mantis_blades', 'kanabo'],
  },
  security: {
    1: ['club', 'mace'],
    3: ['mace', 'shield', 'pistol'],
    5: ['mace', 'shield', 'pistol'],
    7: ['shield', 'mace', 'rifle'],
    9: ['shield', 'rifle', 'mace'],
  },
  trader:     { 1: ['pistol', 'dagger'], 3: ['pistol', 'dagger'], 5: ['pistol', 'derringer'], 7: ['pistol', 'rifle'], 9: ['pistol', 'rifle'] },
  blacksmith: { 1: ['hammer'], 3: ['hammer', 'mace'], 5: ['hammer', 'mace'], 7: ['hammer', 'maul'], 9: ['maul', 'hammer'] },
  miner:      { 1: ['hammer'], 3: ['hammer', 'mace'], 5: ['hammer', 'mace'], 7: ['hammer', 'maul'], 9: ['maul', 'hammer'] },
  farmer:     { 1: ['sickle'], 3: ['sickle', 'hatchet'], 5: ['scythe', 'sickle', 'hatchet'], 7: ['scythe', 'hatchet'], 9: ['scythe'] },
  medic:      { 1: ['fist'], 3: ['fist', 'dagger'], 5: ['dagger', 'fist'], 7: ['dagger', 'pistol'], 9: ['pistol', 'dagger'] },
  scientist:  { 1: ['fist'], 3: ['fist'], 5: ['fist', 'rod'], 7: ['rod', 'fist'], 9: ['rod', 'staff'] },
  journalist: { 1: ['fist'], 3: ['fist'], 5: ['fist', 'pistol'], 7: ['pistol', 'fist'], 9: ['pistol'] },
  entertainer:{ 1: ['fan'], 3: ['fan', 'whip'], 5: ['fan', 'whip'], 7: ['whip', 'fan'], 9: ['urumi', 'fan'] },
  citizen:    { 1: ['fist', 'club'], 3: ['fist', 'club'], 5: ['club', 'mace'], 7: ['mace', 'club'], 9: ['mace'] },
  wanderer:   { 1: ['sling', 'dagger'], 3: ['quarterstaff', 'dagger', 'sling'], 5: ['quarterstaff', 'dagger'], 7: ['quarterstaff', 'sword'], 9: ['quarterstaff', 'staff'] },
  investigator: { 1: ['fist', 'pistol'], 3: ['pistol', 'sword'], 5: ['pistol', 'sword'], 7: ['pistol', 'rifle'], 9: ['pistol', 'rifle'] },
  official:   { 1: ['sword'], 3: ['sword', 'scepter'], 5: ['sword', 'scepter'], 7: ['scepter', 'sword'], 9: ['scepter', 'sword'] },

  // Fallback
  default:    { 1: ['fist'], 3: ['fist', 'club'], 5: ['club', 'mace'], 7: ['mace', 'sword'], 9: ['sword'] },
};

// ── Rarity ladder by level ─────────────────────────────────────────────────
const RARITY_BY_LEVEL = [
  // [minLevel, key,          adjective,    color (UI hint)]
  [1,  'common',     'Common',      '#9ca3af'],   // 1–2
  [3,  'uncommon',   'Uncommon',    '#22c55e'],   // 3–4
  [5,  'rare',       'Rare',        '#3b82f6'],   // 5–6
  [7,  'epic',       'Epic',        '#a855f7'],   // 7–8
  [9,  'legendary',  'Legendary',   '#f59e0b'],   // 9+
];

function _rarityForLevel(level) {
  let pick = RARITY_BY_LEVEL[0];
  for (const row of RARITY_BY_LEVEL) {
    if (level >= row[0]) pick = row;
  }
  return { key: pick[1], adjective: pick[2], color: pick[3] };
}

function _tierForLevel(archetype, level) {
  const tiers = ARCHETYPE_WEAPON_TIERS[archetype] ?? ARCHETYPE_WEAPON_TIERS.default;
  const keys = Object.keys(tiers).map(Number).sort((a, b) => a - b);
  let pickKey = keys[0];
  for (const k of keys) {
    if (level >= k) pickKey = k;
  }
  return tiers[pickKey];
}

// ── Item-name templates per weapon_class ───────────────────────────────────
// Mapping a class → human-readable noun. The noun MUST be a keyword that
// inferWeaponClass() matches, so the round-trip resolves: e.g. for class
// "longbow", the noun "Longbow" matches /longbow/i and resolves back.
// Keep nouns single-word where possible so the prefix/suffix templating
// stays readable.
const WEAPON_CLASS_NOUNS = {
  // Firearms
  pistol: 'Pistol', revolver: 'Revolver', derringer: 'Derringer',
  machine_pistol: 'Machine Pistol', smg: 'SMG', carbine: 'Carbine',
  rifle: 'Rifle', shotgun: 'Shotgun', sniper: 'Sniper Rifle',
  anti_material: 'Anti-Material Rifle', lmg: 'LMG', hand_cannon: 'Hand Cannon',
  blunderbuss: 'Blunderbuss', flamethrower: 'Flamethrower',
  // Energy
  energy_rifle: 'Energy Rifle', plasma: 'Plasma Cannon',
  railgun: 'Railgun', gauss_rifle: 'Gauss Rifle', bolter: 'Bolter',
  laser_pistol: 'Laser Pistol', beam_rifle: 'Beam Rifle',
  particle_beam: 'Particle Beam', ion_cannon: 'Ion Cannon',
  microwave_gun: 'Microwave Gun', emp_gun: 'EMP Gun',
  disruptor: 'Disruptor', blaster: 'Blaster',
  arc_thrower: 'Arc Thrower', freeze_gun: 'Freeze Gun',
  // Heavy
  grenade_launcher: 'Grenade Launcher', rocket_launcher: 'Rocket Launcher',
  rpg: 'RPG-7', missile_launcher: 'Missile Launcher', mortar: 'Mortar',
  recoilless_rifle: 'Recoilless Rifle',
  // Projectile
  bow: 'Bow', longbow: 'Longbow', shortbow: 'Shortbow',
  crossbow: 'Crossbow', sling: 'Sling', blowgun: 'Blowgun',
  thrown: 'Throwing Knife', javelin: 'Javelin', harpoon: 'Harpoon',
  boomerang: 'Boomerang', atlatl: 'Atlatl', chakram: 'Chakram',
  // Blades 1h
  sword: 'Sword', saber: 'Saber', rapier: 'Rapier', katana: 'Katana',
  tachi: 'Tachi', jian: 'Jian', cutlass: 'Cutlass', falx: 'Falx',
  shotel: 'Shotel', machete: 'Machete', dagger: 'Dagger', knife: 'Knife',
  katar: 'Katar', kukri: 'Kukri', sickle: 'Sickle', hatchet: 'Hatchet',
  tomahawk: 'Tomahawk',
  // Blades 2h
  greatsword: 'Greatsword', greataxe: 'Greataxe', scythe: 'Scythe',
  // Polearms
  spear: 'Spear', lance: 'Lance', pike: 'Pike', trident: 'Trident',
  bardiche: 'Bardiche', glaive: 'Glaive', naginata: 'Naginata',
  halberd: 'Halberd', guan_dao: 'Guan Dao', tepoztopilli: 'Tepoztopilli',
  pole_hammer: 'Pole Hammer', taiaha: 'Taiaha', quarterstaff: 'Quarterstaff',
  // Blunt
  mace: 'Mace', club: 'Club', flail: 'Flail',
  hammer: 'Hammer', maul: 'Maul',
  // Exotic
  whip: 'Whip', chain: 'Chain Whip', kusarigama: 'Kusarigama',
  nunchaku: 'Nunchaku', tonfa: 'Tonfa', sai: 'Sai', fan: 'War Fan',
  kama: 'Kama', urumi: 'Urumi', meteor_hammer: 'Meteor Hammer',
  kanabo: 'Kanabo', macuahuitl: 'Macuahuitl', wahaika: 'Wahaika',
  gunblade: 'Gunblade',
  // Fist
  fist: 'Bare Fist', gauntlet: 'Gauntlet', claw: 'Claw', knuckles: 'Brass Knuckles',
  // Focus
  wand: 'Wand', rod: 'Rod', staff: 'Staff', scepter: 'Scepter',
  orb: 'Orb', talisman: 'Talisman', grimoire: 'Grimoire', crystal: 'Crystal',
  // Shield
  shield: 'Shield', buckler: 'Buckler', bulwark: 'Bulwark', tower_shield: 'Tower Shield',
  // Cyberware
  mantis_blades: 'Mantis Blades', gorilla_arms: 'Gorilla Arms',
  monomolecular_whip: 'Mono Whip', smart_gun: 'Smart Gun',
  tech_gun: 'Tech Rifle', cyber_implant: 'Cyber Arm',
};

// Leader faction wealth transfer: fraction of leader's surplus given per undergeared member
const LEADER_TRANSFER_FRACTION = 0.15;
// Member is "undergeared" if their gear_level < leader_gear_level - 2
const UNDERGEAR_GAP_THRESHOLD = 2;

// NPC ceiling is capped at this fraction of the active-player ceiling
const NPC_CEILING_FRACTION     = 0.90;   // regular NPCs: 90% of top player
const CONSCIOUS_CEILING_BOOST  = 0.10;   // conscious emergents: +10% (= 100% of top player)
const ACTIVE_PLAYER_WINDOW_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Wealth Accumulation ───────────────────────────────────────────────────────

export function accumulateWealth(db, npcId, occupation) {
  const income = OCCUPATION_INCOME[occupation] ?? OCCUPATION_INCOME.default;
  db.prepare('UPDATE world_npcs SET wealth_sparks = wealth_sparks + ? WHERE id = ?')
    .run(income, npcId);
}

// ── Gear Initialisation ───────────────────────────────────────────────────────

/**
 * Pick a weapon_class for an archetype deterministically from npcId.
 *
 * The same (archetype, npcId, level) always yields the same class — important
 * for save/restore consistency. Class grows with level: a low-level guard
 * carries a club, a high-level guard carries a halberd. Rarity also climbs
 * — common (1–2) → uncommon (3–4) → rare (5–6) → epic (7–8) → legendary (9+).
 *
 * Returns { class, rarity, rarityKey, rarityColor, name } where name is a
 * round-trippable string that inferWeaponClass() resolves back to `class`.
 *
 * Returns null when archetype has no weapon preferences (e.g. blacksmith,
 * which uses tool slot, not weapon). Caller falls back to the generic
 * "{archetype} {slot} Lv{n}" naming in that case.
 */
export function pickWeaponClassForArchetype(archetype, npcId, level = 1) {
  const tierClasses = _tierForLevel(archetype, level);
  if (!tierClasses || tierClasses.length === 0) return null;
  // Filter out any class without registry metadata (defensive — e.g. "pickaxe"
  // is a tool that doesn't appear in WEAPON_CLASS_INFO, so it falls through
  // to the next preference).
  const valid = tierClasses.filter((c) => WEAPON_CLASS_INFO[c]);
  if (valid.length === 0) return null;
  // Deterministic pick keyed by npcId so the same NPC always gets the same
  // weapon. SHA1 → modulo for a stable index.
  const h = crypto.createHash('sha1').update(`${archetype}:${npcId}`).digest();
  const idx = h.readUInt32BE(0) % valid.length;
  const cls = valid[idx];
  const noun = WEAPON_CLASS_NOUNS[cls] ?? _capitalize(cls);
  const rarity = _rarityForLevel(level);
  return {
    class: cls,
    rarity: rarity.adjective,
    rarityKey: rarity.key,
    rarityColor: rarity.color,
    // Format: "Rare Hunter's Crossbow Lv5" — rarity adjective + archetype
    // possessive + class noun + level marker. Noun appears LAST so the
    // inferWeaponClass regex still resolves the class (most patterns match
    // on the noun keyword regardless of prefix).
    name: `${rarity.adjective} ${_capitalize(archetype)}'s ${noun} Lv${level}`,
  };
}

/**
 * Seed a freshly spawned NPC with starter gear for its archetype.
 * Called once by NPCSimulator._spawnNpc(). Weapon slots use the archetype-
 * preferred class via pickWeaponClassForArchetype so a guard spawns with a
 * spear or halberd (melee_polearm), a hunter with a longbow, a wizard with
 * a staff. Tool / armor / accessory slots use the legacy generic naming.
 */
export function seedStarterGear(db, npcId, archetype, startLevel = 1) {
  const slots = ARCHETYPE_SLOTS[archetype] ?? ARCHETYPE_SLOTS.default;
  // Every slot also gets a rarity stamp keyed by gear_level so tool / armor
  // / accessory upgrades feel like loot too, not just weapons.
  const slotRarity = _rarityForLevel(startLevel);
  for (const slot of slots) {
    const stats = SLOT_STATS[slot]?.(startLevel) ?? {};
    let itemId = `${archetype}-${slot}-lv${startLevel}`;
    let itemName = `${slotRarity.adjective} ${_capitalize(archetype)} ${_capitalize(slot)} Lv${startLevel}`;
    let weaponClass = null;
    let rarityKey = slotRarity.key;
    if (slot === 'weapon') {
      const pick = pickWeaponClassForArchetype(archetype, npcId, startLevel);
      if (pick) {
        itemId = `${archetype}-${pick.class}-lv${startLevel}`;
        itemName = pick.name;
        weaponClass = pick.class;
        rarityKey = pick.rarityKey;
      }
    }
    // Persist weapon_class + rarity in stats JSON so downstream readers
    // (combat, loot, dialogue colour, character sheet) can read them
    // without re-inferring.
    const statsWithMeta = {
      ...stats,
      rarity: rarityKey,
      rarity_color: slotRarity.color,
      ...(weaponClass ? { weapon_class: weaponClass } : {}),
    };
    db.prepare(`
      INSERT OR IGNORE INTO npc_gear (id, npc_id, slot, item_id, item_name, item_type, gear_level, stats)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), npcId, slot,
      itemId, itemName, slot, startLevel,
      JSON.stringify(statsWithMeta),
    );
  }
  db.prepare('UPDATE world_npcs SET gear_level = ? WHERE id = ?').run(startLevel, npcId);
}

/**
 * Lookup the canonical preference list for an archetype at a given level.
 * Returns the tier band for that level. Used by the loadout-test harness
 * and by faction-strategy "what does this archetype carry?" prompts.
 */
export function getArchetypeWeaponPreferences(archetype, level = 1) {
  return _tierForLevel(archetype, level);
}

/**
 * Rarity ladder lookup — public so the character-sheet route can decorate
 * player loot with the same color the NPC's gear stamps.
 *
 *   { key: 'rare', adjective: 'Rare', color: '#3b82f6' }
 *
 * Levels: 1–2 common, 3–4 uncommon, 5–6 rare, 7–8 epic, 9+ legendary.
 */
export function rarityForLevel(level) {
  return _rarityForLevel(level);
}

// ── Gear Upgrade Evaluation ───────────────────────────────────────────────────

/**
 * Called every ~20 ticks per NPC. Checks wealth vs cost and upgrades the
 * lowest-level equipped slot if affordable, respecting the world gear ceiling.
 */
export function evaluateGearUpgrade(db, npcId) {
  const npc = db.prepare(
    'SELECT wealth_sparks, gear_level, archetype, is_conscious FROM world_npcs WHERE id = ?'
  ).get(npcId);
  if (!npc) return false;

  const ceiling = _getEffectiveCeiling(db, !!npc.is_conscious);
  if ((npc.gear_level ?? 1) >= ceiling) return false;

  const nextLevel = (npc.gear_level ?? 1) + 1;
  if (nextLevel > MAX_GEAR_LEVEL) return false;

  const cost = GEAR_UPGRADE_COST[nextLevel] ?? Infinity;
  if ((npc.wealth_sparks ?? 0) < cost) return false;

  // Find lowest-level gear slot to upgrade
  const lowestSlot = db.prepare(
    'SELECT id, slot, gear_level FROM npc_gear WHERE npc_id = ? AND equipped = 1 ORDER BY gear_level ASC LIMIT 1'
  ).get(npcId);
  if (!lowestSlot) return false;

  const newSlotLevel = (lowestSlot.gear_level ?? 1) + 1;
  const baseStats = SLOT_STATS[lowestSlot.slot]?.(newSlotLevel) ?? {};
  const rarity = _rarityForLevel(newSlotLevel);

  // Weapon slot: re-roll class against the new tier band so a guard
  // crossing the Lv5 threshold goes club → halberd, a mage Lv5 goes
  // wand → staff. Non-weapon slots just bump the rarity adjective.
  let nextItemName;
  let nextStats;
  if (lowestSlot.slot === 'weapon') {
    const pick = pickWeaponClassForArchetype(npc.archetype ?? 'default', npcId, newSlotLevel);
    if (pick) {
      nextItemName = pick.name;
      nextStats = { ...baseStats, weapon_class: pick.class, rarity: pick.rarityKey, rarity_color: pick.rarityColor };
    } else {
      nextItemName = `${rarity.adjective} ${_capitalize(npc.archetype ?? 'npc')} ${_capitalize(lowestSlot.slot)} Lv${newSlotLevel}`;
      nextStats = { ...baseStats, rarity: rarity.key, rarity_color: rarity.color };
    }
  } else {
    nextItemName = `${rarity.adjective} ${_capitalize(npc.archetype ?? 'npc')} ${_capitalize(lowestSlot.slot)} Lv${newSlotLevel}`;
    nextStats = { ...baseStats, rarity: rarity.key, rarity_color: rarity.color };
  }

  db.prepare(`
    UPDATE npc_gear SET gear_level = ?, item_name = ?, stats = ?
    WHERE id = ?
  `).run(newSlotLevel, nextItemName, JSON.stringify(nextStats), lowestSlot.id);

  // Deduct cost, update aggregate gear_level (average of equipped slots, rounded)
  db.prepare('UPDATE world_npcs SET wealth_sparks = wealth_sparks - ? WHERE id = ?').run(cost, npcId);
  _recalcNPCGearLevel(db, npcId);

  logger.debug('npc-gear', 'upgraded', { npcId, slot: lowestSlot.slot, newSlotLevel });
  return true;
}

// ── Leader Faction Gear Enforcement ──────────────────────────────────────────

/**
 * Called by NPCSimulator during faction coordination tick.
 * Leader transfers a fraction of surplus wealth to undergeared members.
 */
export function leaderEnsuresFactionGear(db, leaderId, memberIds) {
  const leader = db.prepare(
    'SELECT wealth_sparks, gear_level FROM world_npcs WHERE id = ?'
  ).get(leaderId);
  if (!leader || !memberIds.length) return;

  const leaderLevel = leader.gear_level ?? 1;
  const leaderWealth = leader.wealth_sparks ?? 0;

  // Single batched SELECT for member gear/wealth replaces the per-member
  // lookup (was N+1).
  const memberPlaceholders = memberIds.map(() => "?").join(",");
  const memberRows = db.prepare(
    `SELECT id, wealth_sparks, gear_level FROM world_npcs WHERE id IN (${memberPlaceholders})`,
  ).all(...memberIds);
  const memberById = new Map(memberRows.map(r => [r.id, r]));

  // Collect qualifying members first; transfer amount is computed from a
  // wealth snapshot so it's identical for every recipient. Single batched
  // UPDATE replaces the per-member loop (was 2N queries → 2 queries total).
  const transfer = Math.min(leaderWealth * LEADER_TRANSFER_FRACTION, 50);
  if (transfer < 1) return;
  const recipients = [];
  for (const memberId of memberIds) {
    const member = memberById.get(memberId);
    if (!member) continue;
    const gap = leaderLevel - (member.gear_level ?? 1);
    if (gap < UNDERGEAR_GAP_THRESHOLD) continue;
    recipients.push({ memberId, gap });
  }
  if (recipients.length === 0) return;

  const totalDebit = transfer * recipients.length;
  db.prepare('UPDATE world_npcs SET wealth_sparks = wealth_sparks - ? WHERE id = ?').run(totalDebit, leaderId);
  const recipientIds = recipients.map(r => r.memberId);
  const ph = recipientIds.map(() => "?").join(",");
  db.prepare(
    `UPDATE world_npcs SET wealth_sparks = wealth_sparks + ? WHERE id IN (${ph})`,
  ).run(transfer, ...recipientIds);
  for (const { memberId, gap } of recipients) {
    logger.debug('npc-gear', 'leader_transfer', { leaderId, memberId, transfer, gap });
  }
}

// ── User Gear Ceiling ─────────────────────────────────────────────────────────

/**
 * Recomputes the ceiling from active-player gear levels.
 * Call every ~50 ticks (a few times per game-hour).
 */
export function updateUserGearCeiling(db) {
  try {
    const cutoff = Math.floor((Date.now() - ACTIVE_PLAYER_WINDOW_MS) / 1000);

    // Use max gear level from users active in the past 7 days
    // Proxy: max gear_level among player_inventory items for recently-seen users
    const row = db.prepare(`
      SELECT MAX(CAST(json_extract(metadata, '$.gear_level') AS INTEGER)) AS top_level
      FROM dtus
      WHERE type = 'item' AND owner_type = 'user'
        AND updated_at > ?
    `).get(cutoff);

    const topLevel = Math.max(1, row?.top_level ?? 1);
    db.prepare(
      'UPDATE user_gear_ceiling SET ceiling_level = ?, updated_at = unixepoch() WHERE id = 1'
    ).run(topLevel);

    return topLevel;
  } catch {
    return 1;
  }
}

/**
 * Cap any NPC that has somehow exceeded the ceiling (edge cases after player churn).
 */
export function enforceGearCeiling(db) {
  const ceiling = db.prepare('SELECT ceiling_level FROM user_gear_ceiling WHERE id = 1').get();
  if (!ceiling) return;

  const npcCap   = Math.max(1, Math.floor(ceiling.ceiling_level * NPC_CEILING_FRACTION));
  const bossCap  = Math.max(1, Math.ceil(ceiling.ceiling_level * (NPC_CEILING_FRACTION + CONSCIOUS_CEILING_BOOST)));

  db.prepare(
    'UPDATE world_npcs SET gear_level = ? WHERE is_conscious = 0 AND gear_level > ?'
  ).run(npcCap, npcCap);
  db.prepare(
    'UPDATE world_npcs SET gear_level = ? WHERE is_conscious = 1 AND gear_level > ?'
  ).run(bossCap, bossCap);
}

/**
 * Return all gear rows for an NPC (used by loot generator).
 */
export function getNPCGear(db, npcId) {
  return db.prepare('SELECT * FROM npc_gear WHERE npc_id = ? AND equipped = 1').all(npcId);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _getEffectiveCeiling(db, isConscious) {
  const row = db.prepare('SELECT ceiling_level FROM user_gear_ceiling WHERE id = 1').get();
  const base = row?.ceiling_level ?? 1;
  const fraction = isConscious
    ? NPC_CEILING_FRACTION + CONSCIOUS_CEILING_BOOST
    : NPC_CEILING_FRACTION;
  return Math.max(1, Math.floor(base * fraction));
}

function _recalcNPCGearLevel(db, npcId) {
  const slots = db.prepare(
    'SELECT gear_level FROM npc_gear WHERE npc_id = ? AND equipped = 1'
  ).all(npcId);
  if (!slots.length) return;
  const avg = slots.reduce((s, r) => s + (r.gear_level ?? 1), 0) / slots.length;
  db.prepare('UPDATE world_npcs SET gear_level = ? WHERE id = ?').run(Math.round(avg), npcId);
}

function _capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}
