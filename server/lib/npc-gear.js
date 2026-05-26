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

// ── Archetype → preferred weapon classes ───────────────────────────────────
//
// Each archetype declares a ranked list of weapon_class values (from
// WEAPON_CLASS_INFO). pickWeaponClassForArchetype() deterministically picks
// one per NPC by hashing npcId, so the same NPC always gets the same weapon
// across save/restore. The chosen class is rendered as a human-readable item
// name that round-trips through inferWeaponClass() — e.g. "Hunter Longbow
// Lv3" parses back to weapon_class='longbow'.
//
// Keep this list using only canonical WEAPON_CLASS_INFO keys — the
// archetype-coverage test pins that contract.
const ARCHETYPE_WEAPON_CLASSES = {
  // Frontline melee
  warrior:    ['greatsword', 'greataxe', 'sword',     'mace'],
  guard:      ['spear',      'halberd',  'sword',     'mace'],
  guardian:   ['halberd',    'spear',    'tower_shield', 'mace'],
  knight:     ['sword',      'lance',    'mace'],
  soldier:    ['rifle',      'carbine',  'pistol',    'sword'],
  enforcer:   ['mace',       'hammer',   'flail',     'club'],
  fanatic:    ['scythe',     'flail',    'club'],
  raider:     ['cutlass',    'mace',     'hatchet',   'dagger'],

  // Ranged / stealth
  hunter:     ['longbow',    'crossbow', 'shortbow',  'dagger'],
  scout:      ['shortbow',   'crossbow', 'dagger'],
  ranger:     ['longbow',    'crossbow', 'shortbow'],
  archer:     ['longbow',    'shortbow', 'bow'],
  // Note: "knife" class is intentionally absent — the inferWeaponClass
  // regex groups knife/dagger/stiletto/dirk/kris under class=dagger, so
  // naming an NPC's item "Knife" would round-trip to class=dagger and
  // break the round-trip contract. Use "dagger" as the canonical short-blade.
  rogue:      ['dagger',     'rapier',   'kukri'],
  assassin:   ['dagger',     'katana',   'kukri',     'sai'],
  thief:      ['dagger',     'sai'],
  ninja:      ['katana',     'thrown',   'sai',       'kusarigama'],

  // Brute
  thug:       ['club',       'hammer',   'mace',      'knuckles'],
  predator:   ['claw',       'fist',     'knuckles'],
  berserker:  ['greataxe',   'scythe',   'maul'],

  // Magic / focus
  mage:       ['staff',      'wand',     'orb',       'grimoire'],
  mystic:     ['staff',      'orb',      'talisman',  'scepter'],
  wizard:     ['staff',      'wand',     'grimoire'],
  sorcerer:   ['wand',       'orb',      'crystal'],
  warlock:    ['scepter',    'wand',     'grimoire'],
  shaman:     ['staff',      'talisman', 'rod'],
  cleric:     ['mace',       'staff',    'talisman'],
  priest:     ['scepter',    'staff'],

  // Tech / cyber
  hacker:     ['smart_gun',  'emp_gun',  'pistol'],
  pilot:      ['pistol',     'smart_gun', 'laser_pistol'],
  engineer:   ['tech_gun',   'hammer',   'pistol'],
  cyborg:     ['mantis_blades', 'gorilla_arms', 'tech_gun'],
  marksman:   ['sniper',     'rifle',    'pistol'],
  gunslinger: ['revolver',   'pistol',   'shotgun'],

  // Civilian
  vigilante:  ['fist',       'kanabo',   'pistol'],
  security:   ['shield',     'mace',     'pistol'],
  trader:     ['pistol',     'dagger'],
  blacksmith: ['hammer',     'mace'],
  miner:      ['hammer',     'pickaxe',  'mace'],   // pickaxe → falls through, mace fallback
  farmer:     ['sickle',     'scythe',   'hatchet'],
  medic:      ['fist',       'dagger'],
  scientist:  ['fist'],
  journalist: ['fist'],
  entertainer:['fan',        'whip'],
  citizen:    ['fist',       'club'],
  wanderer:   ['dagger',     'quarterstaff', 'sling'],
  investigator: ['pistol',   'sword'],
  official:   ['sword',      'scepter'],

  default:    ['fist'],
};

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
 * The same (archetype, npcId) always yields the same class — important for
 * save/restore consistency. Returns { class, name } where name is a
 * round-trippable string that inferWeaponClass() resolves back to `class`.
 *
 * Returns null when archetype has no weapon preferences (e.g. blacksmith,
 * which uses tool slot, not weapon). Caller falls back to the generic
 * "{archetype} {slot} Lv{n}" naming in that case.
 */
export function pickWeaponClassForArchetype(archetype, npcId, level = 1) {
  const prefs = ARCHETYPE_WEAPON_CLASSES[archetype] ?? ARCHETYPE_WEAPON_CLASSES.default;
  if (!prefs || prefs.length === 0) return null;
  // Filter out any class without registry metadata (defensive — e.g. "pickaxe"
  // is a tool that doesn't appear in WEAPON_CLASS_INFO, so it falls through
  // to the next preference).
  const valid = prefs.filter((c) => WEAPON_CLASS_INFO[c]);
  if (valid.length === 0) return null;
  // Deterministic pick keyed by npcId so the same NPC always gets the same
  // weapon. SHA1 → modulo for a stable index.
  const h = crypto.createHash('sha1').update(`${archetype}:${npcId}`).digest();
  const idx = h.readUInt32BE(0) % valid.length;
  const cls = valid[idx];
  const noun = WEAPON_CLASS_NOUNS[cls] ?? _capitalize(cls);
  return { class: cls, name: `${_capitalize(archetype)}'s ${noun} Lv${level}` };
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
  for (const slot of slots) {
    const stats = SLOT_STATS[slot]?.(startLevel) ?? {};
    let itemId = `${archetype}-${slot}-lv${startLevel}`;
    let itemName = `${_capitalize(archetype)} ${_capitalize(slot)} Lv${startLevel}`;
    let weaponClass = null;
    if (slot === 'weapon') {
      const pick = pickWeaponClassForArchetype(archetype, npcId, startLevel);
      if (pick) {
        itemId = `${archetype}-${pick.class}-lv${startLevel}`;
        itemName = pick.name;
        weaponClass = pick.class;
      }
    }
    // Persist weapon_class in stats JSON so downstream readers (combat,
    // loot, dialogue colour) can read it without re-inferring.
    const statsWithClass = weaponClass ? { ...stats, weapon_class: weaponClass } : stats;
    db.prepare(`
      INSERT OR IGNORE INTO npc_gear (id, npc_id, slot, item_id, item_name, item_type, gear_level, stats)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), npcId, slot,
      itemId, itemName, slot, startLevel,
      JSON.stringify(statsWithClass),
    );
  }
  db.prepare('UPDATE world_npcs SET gear_level = ? WHERE id = ?').run(startLevel, npcId);
}

/**
 * Lookup the canonical preference list for an archetype (read-only). Used
 * by the loadout-test harness and by faction-strategy "what does this
 * archetype carry?" prompts.
 */
export function getArchetypeWeaponPreferences(archetype) {
  return ARCHETYPE_WEAPON_CLASSES[archetype] ?? ARCHETYPE_WEAPON_CLASSES.default;
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
  const stats = SLOT_STATS[lowestSlot.slot]?.(newSlotLevel) ?? {};

  db.prepare(`
    UPDATE npc_gear SET gear_level = ?, item_name = ?, stats = ?
    WHERE id = ?
  `).run(
    newSlotLevel,
    `${_capitalize(npc.archetype ?? 'npc')} ${_capitalize(lowestSlot.slot)} Lv${newSlotLevel}`,
    JSON.stringify(stats),
    lowestSlot.id,
  );

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
