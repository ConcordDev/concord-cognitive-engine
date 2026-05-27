// server/lib/dungeons.js
//
// Wave F — per-world procedural dungeons. Every world ships a distinct
// dungeon template:
//   - Themed room kinds (corridor, vault, ICE-chamber, server-rack…)
//   - Creature archetype bias for what spawns inside
//   - Weapon-class loot bias matching the world's combat flavor
//   - Hazards specific to the world's physics (curses vs. ICE locks vs.
//     radiation vs. simulation glitches)
//   - A unique boss archetype + room
//
// Dungeons are composed deterministically from a seed so a player can
// revisit the same dungeon. The seed combines world_id + anchor + a
// random salt.
//
// Public API:
//   composeDungeon(db, opts)           — generates + persists a dungeon
//   getDungeon(db, dungeonId)          — read + decode
//   listInWorld(db, worldId, opts?)    — list active dungeons
//   enterRoom(db, dungeonId, roomIdx, userId) — log visit + return room
//   claimLoot(db, lootId, userId)      — transfer to player_inventory
//   rollLootForRoom(db, dungeon, roomIdx) — roll the room's loot once
//
// Per-world templates exported as WORLD_DUNGEON_TEMPLATES; the spawner
// heartbeat picks them by world_id.

import crypto from "crypto";

// ── Per-world dungeon templates ──────────────────────────────────────
//
// Each world maps to one or more template_kind values. Adding a new
// world = adding an entry here. Adding a new template = adding an
// entry under any world that should host it.

export const WORLD_DUNGEON_TEMPLATES = Object.freeze({
  fantasy: [
    {
      kind: "crypts_of_the_old_order",
      displayName: "Crypts of the Old Order",
      roomKinds: ["corridor", "treasure_vault", "traps_room", "undead_crypt"],
      bossKind: "dragon_lair",
      creatureArchetypes: ["creature:dragon", "creature:undead", "creature:slime", "creature:warlock"],
      weaponClassBias: ["greatsword", "scythe", "halberd", "staff", "grimoire"],
      hazards: ["fall_pit", "spike_trap", "curse_glyph", "summoning_circle"],
      minRooms: 6, maxRooms: 12,
      rarityBoost: 0.1,
    },
  ],
  cyber: [
    {
      kind: "data_vault",
      displayName: "Data Vault",
      roomKinds: ["server_rack", "ice_chamber", "debug_room", "memory_corridor"],
      bossKind: "kernel_core",
      creatureArchetypes: ["creature:rogue_ai", "creature:drone", "creature:firewall", "creature:virus"],
      weaponClassBias: ["smart_gun", "tech_gun", "emp_gun", "mantis_blades", "monomolecular_whip"],
      hazards: ["ice_lockout", "kernel_panic", "memory_leak", "trace_alert"],
      minRooms: 5, maxRooms: 10,
      rarityBoost: 0.15,
    },
  ],
  crime: [
    {
      kind: "kingpin_compound",
      displayName: "Kingpin Compound",
      roomKinds: ["stash_house", "drug_lab", "money_room", "henchman_quarters"],
      bossKind: "kingpin_suite",
      creatureArchetypes: ["thug", "enforcer", "henchman", "criminal_kingpin"],
      weaponClassBias: ["pistol", "shotgun", "smg", "knuckles", "dagger"],
      hazards: ["jammed_door", "alarm_trip", "snitch_witness", "mounted_camera"],
      minRooms: 4, maxRooms: 9,
      rarityBoost: 0.05,
    },
  ],
  superhero: [
    {
      kind: "villain_lair",
      displayName: "Villain Lair",
      roomKinds: ["minion_barracks", "experiment_lab", "death_ray_chamber", "vault"],
      bossKind: "super_villain_throne",
      creatureArchetypes: ["henchman", "robot_enforcer", "corrupted_hero", "ai_overlord"],
      weaponClassBias: ["energy_rifle", "plasma", "laser_pistol", "tech_gun", "blaster"],
      hazards: ["laser_grid", "gravity_well", "mind_control_ray", "self_destruct_timer"],
      minRooms: 5, maxRooms: 11,
      rarityBoost: 0.2,
    },
  ],
  "sovereign-ruins": [
    {
      kind: "buried_throne",
      displayName: "The Buried Throne",
      roomKinds: ["throne_corridor", "burial_chamber", "gallery_of_the_fallen", "refusal_well"],
      bossKind: "sovereign_tomb",
      creatureArchetypes: ["creature:undead", "guard", "fanatic", "creature:wraith"],
      weaponClassBias: ["pole_hammer", "halberd", "scepter", "tower_shield", "scythe"],
      hazards: ["refusal_field", "ancestral_curse", "echoing_step", "tomb_collapse"],
      minRooms: 7, maxRooms: 14,
      rarityBoost: 0.25,
    },
  ],
  "lattice-crucible": [
    {
      kind: "crucible_core",
      displayName: "Crucible Core",
      roomKinds: ["training_vat", "simulation_chamber", "reactor_corridor", "engineer_lab"],
      bossKind: "prime_mover",
      creatureArchetypes: ["creature:simulation", "cyborg", "creature:rogue_ai", "engineer"],
      weaponClassBias: ["railgun", "gauss_rifle", "particle_beam", "ion_cannon", "mantis_blades"],
      hazards: ["simulation_glitch", "feedback_loop", "training_overload", "core_meltdown"],
      minRooms: 6, maxRooms: 12,
      rarityBoost: 0.2,
    },
  ],
  "concord-link-frontier": [
    {
      kind: "outpost_complex",
      displayName: "Frontier Outpost",
      roomKinds: ["supply_cache", "comms_relay", "outpost_corridor", "armory"],
      bossKind: "frontier_commander",
      creatureArchetypes: ["soldier", "guard", "scout", "creature:rogue_drone"],
      weaponClassBias: ["rifle", "shotgun", "sniper", "grenade_launcher", "smg"],
      hazards: ["claymore_mine", "comms_jam", "frostbite_chamber", "blowdown_corridor"],
      minRooms: 5, maxRooms: 10,
      rarityBoost: 0.1,
    },
  ],
  tunya: [
    {
      kind: "ancestor_grove",
      displayName: "The Ancestor Grove",
      roomKinds: ["shrine_corridor", "ritual_room", "ancestor_grove", "elemental_pool"],
      bossKind: "hierophant_chamber",
      creatureArchetypes: ["mystic", "shaman", "creature:spirit", "creature:elemental"],
      weaponClassBias: ["staff", "talisman", "orb", "scepter", "naginata"],
      hazards: ["spirit_haze", "ancestral_judgement", "elemental_surge", "shrine_lockdown"],
      minRooms: 5, maxRooms: 11,
      rarityBoost: 0.15,
    },
  ],
  "concordia-hub": [
    {
      kind: "council_undercity",
      displayName: "The Undercity Wards",
      roomKinds: ["sealed_ward", "council_archive", "refusal_chapel", "guard_barracks"],
      bossKind: "warden_inner_sanctum",
      creatureArchetypes: ["guard", "warden", "creature:undead", "fanatic"],
      weaponClassBias: ["halberd", "sword", "mace", "shield", "scepter"],
      hazards: ["sealed_door", "warden_trap", "ancestral_lock", "refusal_burst"],
      minRooms: 5, maxRooms: 10,
      rarityBoost: 0.1,
    },
  ],
});

// Fallback for any world not listed above.
const DEFAULT_TEMPLATE = {
  kind: "generic_ruin",
  displayName: "Forgotten Ruin",
  roomKinds: ["corridor", "chamber", "vault"],
  bossKind: "ruin_warden",
  creatureArchetypes: ["creature:undead", "guard"],
  weaponClassBias: ["sword", "mace", "bow"],
  hazards: ["fall_pit", "spike_trap"],
  minRooms: 4, maxRooms: 8,
  rarityBoost: 0,
};

const RARITY_TIERS = ["common", "uncommon", "rare", "epic", "legendary"];

/**
 * Deterministic per-room seed used everywhere we need a "random" choice
 * that should be stable across re-reads of the same dungeon.
 */
function _seededInt(seedStr, salt = 0) {
  const h = crypto.createHash("sha1").update(`${seedStr}|${salt}`).digest();
  return h.readUInt32BE(0);
}

function _pickFromList(seedStr, salt, list) {
  if (!list || list.length === 0) return null;
  return list[_seededInt(seedStr, salt) % list.length];
}

function _pickTemplate(worldId, seedStr) {
  const candidates = WORLD_DUNGEON_TEMPLATES[worldId];
  if (!candidates || candidates.length === 0) return DEFAULT_TEMPLATE;
  return candidates[_seededInt(seedStr, 0) % candidates.length];
}

/**
 * Compose a dungeon for a world. Deterministic from seed; returns the
 * persisted row + room graph + loot instances.
 */
export function composeDungeon(db, { worldId, seed = null, anchorX = 0, anchorZ = 0, depthLevel = 1 } = {}) {
  if (!db || !worldId) return { ok: false, reason: "missing_args" };
  const seedStr = seed || `${worldId}|${anchorX}|${anchorZ}|${crypto.randomBytes(3).toString("hex")}`;
  const tpl = _pickTemplate(worldId, seedStr);

  // Room count scales with depthLevel within template bounds.
  const span = tpl.maxRooms - tpl.minRooms;
  const roomCount = tpl.minRooms + (_seededInt(seedStr, 1) % Math.max(1, span + 1));
  const dungeonId = `dung_${crypto.randomBytes(6).toString("hex")}`;
  const name = tpl.displayName;

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO dungeons (id, world_id, template_kind, seed, name,
        anchor_x, anchor_z, depth_level, room_count, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(dungeonId, worldId, tpl.kind, seedStr, name, anchorX, anchorZ, depthLevel, roomCount);

    // Lay out rooms on a deterministic random walk. Entrance at index 0;
    // boss at index roomCount-1.
    let cx = 0, cz = 0;
    const positions = [{ x: cx, z: cz }];
    for (let i = 1; i < roomCount; i++) {
      const dir = _seededInt(seedStr, 100 + i) % 4;
      if      (dir === 0) cx += 14;
      else if (dir === 1) cx -= 14;
      else if (dir === 2) cz += 14;
      else                cz -= 14;
      positions.push({ x: cx, z: cz });
    }

    for (let i = 0; i < roomCount; i++) {
      const isBoss = i === roomCount - 1;
      const kind = isBoss
        ? tpl.bossKind
        : (i === 0 ? "entrance" : _pickFromList(seedStr, 200 + i, tpl.roomKinds) || "chamber");
      const hazard = !isBoss && i > 0 && (_seededInt(seedStr, 300 + i) % 3 === 0)
        ? [_pickFromList(seedStr, 400 + i, tpl.hazards)]
        : [];
      const creatureCount = isBoss
        ? 1
        : Math.max(0, (_seededInt(seedStr, 500 + i) % 4) - 1);
      // Connections: each room connects to the previous; some rooms
      // get a branch back to an earlier room.
      const conns = i > 0 ? [i - 1] : [];
      if (i > 2 && _seededInt(seedStr, 600 + i) % 4 === 0) {
        conns.push(_seededInt(seedStr, 700 + i) % (i - 1));
      }
      db.prepare(`
        INSERT INTO dungeon_rooms (dungeon_id, room_idx, kind, x, z, width, depth,
          connections_json, hazards_json, creature_count, is_boss)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        dungeonId, i, kind,
        anchorX + positions[i].x, anchorZ + positions[i].z,
        isBoss ? 20 : 12, isBoss ? 20 : 12,
        JSON.stringify(conns), JSON.stringify(hazard),
        creatureCount, isBoss ? 1 : 0,
      );
    }
  });
  try { tx(); }
  catch (err) { return { ok: false, reason: "persist_failed", message: err?.message }; }

  return {
    ok: true,
    dungeonId,
    name,
    templateKind: tpl.kind,
    roomCount,
    worldId,
    seed: seedStr,
  };
}

/** Read the full dungeon shape (header + rooms + open loot). */
export function getDungeon(db, dungeonId) {
  if (!db || !dungeonId) return null;
  try {
    const header = db.prepare(`SELECT * FROM dungeons WHERE id = ?`).get(dungeonId);
    if (!header) return null;
    const rooms = db.prepare(`
      SELECT * FROM dungeon_rooms WHERE dungeon_id = ? ORDER BY room_idx ASC
    `).all(dungeonId).map((r) => ({
      ...r,
      connections: _tryJSON(r.connections_json) ?? [],
      hazards: _tryJSON(r.hazards_json) ?? [],
    }));
    return { ...header, rooms };
  } catch { return null; }
}

export function listInWorld(db, worldId, { limit = 50, status = "active" } = {}) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT * FROM dungeons WHERE world_id = ? AND status = ? ORDER BY generated_at DESC LIMIT ?
    `).all(worldId, status, limit);
  } catch { return []; }
}

/**
 * Mark a room visited + roll loot if this is the player's first time.
 * Returns the room + any new loot instances generated.
 */
export function enterRoom(db, dungeonId, roomIdx, userId) {
  if (!db || !dungeonId || roomIdx == null || !userId) return { ok: false, reason: "missing_args" };
  const room = db.prepare(`
    SELECT * FROM dungeon_rooms WHERE dungeon_id = ? AND room_idx = ?
  `).get(dungeonId, roomIdx);
  if (!room) return { ok: false, reason: "room_not_found" };

  // Log the visit (idempotent in terms of state — duplicates allowed for
  // objective tracking).
  try {
    db.prepare(`
      INSERT INTO dungeon_visits (dungeon_id, user_id, room_idx) VALUES (?, ?, ?)
    `).run(dungeonId, userId, roomIdx);
  } catch { /* ok */ }

  // Roll loot exactly once per (dungeon, room). Subsequent visits return
  // the same instances.
  const existing = db.prepare(`
    SELECT COUNT(*) AS n FROM dungeon_loot_instances WHERE dungeon_id = ? AND room_idx = ?
  `).get(dungeonId, roomIdx);
  let lootRolled = [];
  if ((existing?.n ?? 0) === 0) {
    lootRolled = rollLootForRoom(db, dungeonId, roomIdx);
  }
  const lootRows = db.prepare(`
    SELECT id, item_json, claimed_by FROM dungeon_loot_instances
    WHERE dungeon_id = ? AND room_idx = ?
  `).all(dungeonId, roomIdx).map((r) => ({
    id: r.id, claimedBy: r.claimed_by,
    item: _tryJSON(r.item_json),
  }));

  return { ok: true, room: { ...room, connections: _tryJSON(room.connections_json) ?? [], hazards: _tryJSON(room.hazards_json) ?? [] }, lootRolled, loot: lootRows };
}

/** Roll loot for a room based on the dungeon's template. */
export function rollLootForRoom(db, dungeonId, roomIdx) {
  const dungeon = db.prepare(`SELECT * FROM dungeons WHERE id = ?`).get(dungeonId);
  if (!dungeon) return [];
  const room = db.prepare(`
    SELECT * FROM dungeon_rooms WHERE dungeon_id = ? AND room_idx = ?
  `).get(dungeonId, roomIdx);
  if (!room) return [];

  // Find the template by kind so we know the loot bias.
  const tpl = _findTemplateByKind(dungeon.template_kind) || DEFAULT_TEMPLATE;

  // Loot count: boss rooms get 3 items, vault-like rooms get 2, others get 0–1.
  const isBoss = room.is_boss === 1;
  const isVault = /vault|treasure|cache|armory/.test(room.kind);
  let lootCount = 0;
  if (isBoss) lootCount = 3;
  else if (isVault) lootCount = 2;
  else if (_seededInt(dungeon.seed, 800 + roomIdx) % 3 === 0) lootCount = 1;
  if (lootCount === 0) return [];

  const items = [];
  for (let i = 0; i < lootCount; i++) {
    const weaponClass = _pickFromList(dungeon.seed, 900 + roomIdx * 10 + i, tpl.weaponClassBias);
    const baseTier = isBoss ? 3 : isVault ? 2 : 1;
    const boostedTier = Math.min(RARITY_TIERS.length - 1,
      baseTier + Math.floor(tpl.rarityBoost * 4 + dungeon.depth_level / 3));
    const rarity = RARITY_TIERS[boostedTier];
    const itemId = `dung_loot_${crypto.randomBytes(4).toString("hex")}`;
    const item = {
      item_id: itemId,
      item_type: "weapon",
      item_name: _composeLootName(weaponClass, rarity, dungeon.name),
      quality: _rarityToQuality(rarity),
      weapon_class: weaponClass,
      rarity,
      gear_level: Math.max(1, dungeon.depth_level + (isBoss ? 2 : 0)),
    };
    try {
      const id = `dlt_${crypto.randomBytes(6).toString("hex")}`;
      db.prepare(`
        INSERT INTO dungeon_loot_instances (id, dungeon_id, room_idx, item_json)
        VALUES (?, ?, ?, ?)
      `).run(id, dungeonId, roomIdx, JSON.stringify(item));
      items.push({ id, item });
    } catch { /* skip */ }
  }
  return items;
}

/** Transfer a rolled loot row into the player's inventory. */
export function claimLoot(db, lootId, userId, { worldId } = {}) {
  if (!db || !lootId || !userId) return { ok: false, reason: "missing_args" };
  const row = db.prepare(`SELECT * FROM dungeon_loot_instances WHERE id = ?`).get(lootId);
  if (!row) return { ok: false, reason: "loot_not_found" };
  if (row.claimed_by) return { ok: false, reason: "already_claimed" };
  const item = _tryJSON(row.item_json);
  if (!item) return { ok: false, reason: "malformed_item" };

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO player_inventory
        (id, user_id, item_type, item_id, item_name, quantity, quality, world_id, weapon_class, handedness)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'either')
    `).run(
      crypto.randomUUID(), userId, item.item_type, item.item_id, item.item_name,
      item.quality, worldId || null, item.weapon_class ?? null,
    );
    db.prepare(`
      UPDATE dungeon_loot_instances SET claimed_by = ?, claimed_at = unixepoch() WHERE id = ?
    `).run(userId, lootId);
  });
  try { tx(); }
  catch (err) { return { ok: false, reason: "persist_failed", message: err?.message }; }
  return { ok: true, item };
}

function _findTemplateByKind(kind) {
  for (const templates of Object.values(WORLD_DUNGEON_TEMPLATES)) {
    const found = templates.find((t) => t.kind === kind);
    if (found) return found;
  }
  return null;
}

function _composeLootName(weaponClass, rarity, dungeonName) {
  const rarityWord = rarity.charAt(0).toUpperCase() + rarity.slice(1);
  const weaponWord = weaponClass ? weaponClass.replace(/_/g, " ") : "Relic";
  return `${rarityWord} ${weaponWord} of the ${dungeonName.split(" ").slice(-1)[0] || "Vault"}`;
}

function _rarityToQuality(rarity) {
  switch (rarity) {
    case "legendary": return 95;
    case "epic":      return 80;
    case "rare":      return 60;
    case "uncommon":  return 40;
    default:          return 20;
  }
}

function _tryJSON(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

export const _internal = { _pickTemplate, _findTemplateByKind, RARITY_TIERS };
