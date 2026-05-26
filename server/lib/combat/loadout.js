// server/lib/combat/loadout.js
//
// Dual-hand loadout management. Players equip weapons to right/left/two-hand
// slots; the combat handler reads the loadout when a hit lands so the flow
// recorder can stamp which hand swung and what class the weapon was.
//
// Heuristics for inferring handedness + weapon_class from existing inventory
// rows that pre-date migration 090 (so the system works for legacy crafted
// items without a re-craft). Inferred values are written back via UPDATE so
// the inference runs at most once per item.
//
// ── 2026-05-26 expansion ──
// The 10-pattern table this used to ship with covered swords, hammers, rifles,
// shields, daggers, pistols, staves, bows. That stranded ~60% of authored +
// player-named weapons (scythes, halberds, SMGs, energy rifles, focus items,
// whips, exotic dual-wields, etc.) at `weapon_class = null`. Expanded the
// table to ~60 patterns across 12 weapon categories, added an "amorphous"
// classification for player-invented / shape-shifting weapons that don't
// fit a fixed archetype, and exported WEAPON_CLASS_INFO so downstream
// (flow-engine tagging, combat-netcode reach checks, NPC archetype matching)
// can read per-class metadata without re-hardcoding it everywhere.

import logger from "../../logger.js";

// ── Per-class metadata ───────────────────────────────────────────────────
// Downstream readers (combat-netcode reach validation, animation system
// selection, NPC archetype-preference matching) consume this. Keep
// every weapon_class string emitted by `inferWeaponClass` keyed here.
//
//   category   — high-level bucket for grouping / UI filtering
//   defaultHand — fallback when inference can't determine handedness
//   reach_m    — combat range cap (used by `_validateCombatReach`)
//   amorphous  — true when the weapon's behavior is data-driven from the
//                item itself rather than the class template
export const WEAPON_CLASS_INFO = Object.freeze({
  // ── Firearms ──────────────────────────────────────────────────────
  pistol:        { category: "firearm",  defaultHand: "either", reach_m: 30 },
  revolver:      { category: "firearm",  defaultHand: "either", reach_m: 30 },
  smg:           { category: "firearm",  defaultHand: "either", reach_m: 40 },
  rifle:         { category: "firearm",  defaultHand: "two",    reach_m: 80 },
  shotgun:       { category: "firearm",  defaultHand: "two",    reach_m: 20 },
  sniper:        { category: "firearm",  defaultHand: "two",    reach_m: 80 },
  lmg:           { category: "firearm",  defaultHand: "two",    reach_m: 60 },
  hand_cannon:   { category: "firearm",  defaultHand: "either", reach_m: 25 },
  blunderbuss:   { category: "firearm",  defaultHand: "two",    reach_m: 15 },
  energy_rifle:  { category: "firearm",  defaultHand: "two",    reach_m: 80 },
  plasma:        { category: "firearm",  defaultHand: "two",    reach_m: 50 },
  railgun:       { category: "firearm",  defaultHand: "two",    reach_m: 80 },
  bolter:        { category: "firearm",  defaultHand: "either", reach_m: 40 },
  flamethrower:  { category: "firearm",  defaultHand: "two",    reach_m: 12 },

  // ── Projectile (physics-driven) ────────────────────────────────────
  bow:           { category: "projectile", defaultHand: "two",    reach_m: 60 },
  longbow:       { category: "projectile", defaultHand: "two",    reach_m: 80 },
  shortbow:      { category: "projectile", defaultHand: "two",    reach_m: 45 },
  crossbow:      { category: "projectile", defaultHand: "two",    reach_m: 70 },
  sling:         { category: "projectile", defaultHand: "either", reach_m: 35 },
  blowgun:       { category: "projectile", defaultHand: "either", reach_m: 25 },
  thrown:        { category: "projectile", defaultHand: "either", reach_m: 20 },
  javelin:       { category: "projectile", defaultHand: "either", reach_m: 30 },
  harpoon:       { category: "projectile", defaultHand: "two",    reach_m: 25 },
  boomerang:     { category: "projectile", defaultHand: "either", reach_m: 30 },

  // ── Melee blades (one-handed) ──────────────────────────────────────
  sword:         { category: "melee_blade_1h", defaultHand: "either", reach_m: 2.5 },
  saber:         { category: "melee_blade_1h", defaultHand: "either", reach_m: 2.5 },
  rapier:        { category: "melee_blade_1h", defaultHand: "either", reach_m: 2.8 },
  katana:        { category: "melee_blade_1h", defaultHand: "either", reach_m: 2.6 },
  cutlass:       { category: "melee_blade_1h", defaultHand: "either", reach_m: 2.3 },
  machete:       { category: "melee_blade_1h", defaultHand: "either", reach_m: 2.0 },
  dagger:        { category: "melee_blade_1h", defaultHand: "either", reach_m: 1.5 },
  knife:         { category: "melee_blade_1h", defaultHand: "either", reach_m: 1.4 },
  kukri:         { category: "melee_blade_1h", defaultHand: "either", reach_m: 1.8 },
  sickle:        { category: "melee_blade_1h", defaultHand: "either", reach_m: 1.6 },
  hatchet:       { category: "melee_blade_1h", defaultHand: "either", reach_m: 1.7 },
  tomahawk:      { category: "melee_blade_1h", defaultHand: "either", reach_m: 1.7 },

  // ── Melee blades (two-handed) ──────────────────────────────────────
  greatsword:    { category: "melee_blade_2h", defaultHand: "two", reach_m: 3.5 },
  greataxe:      { category: "melee_blade_2h", defaultHand: "two", reach_m: 3.2 },
  scythe:        { category: "melee_blade_2h", defaultHand: "two", reach_m: 3.0 },
  glaive:        { category: "melee_polearm",  defaultHand: "two", reach_m: 3.8 },
  naginata:      { category: "melee_polearm",  defaultHand: "two", reach_m: 3.6 },
  halberd:       { category: "melee_polearm",  defaultHand: "two", reach_m: 3.8 },

  // ── Melee blunt ────────────────────────────────────────────────────
  mace:          { category: "melee_blunt_1h", defaultHand: "either", reach_m: 2.0 },
  club:          { category: "melee_blunt_1h", defaultHand: "either", reach_m: 1.8 },
  flail:         { category: "melee_blunt_1h", defaultHand: "either", reach_m: 2.5 },
  hammer:        { category: "melee_blunt_2h", defaultHand: "two", reach_m: 2.8 },
  maul:          { category: "melee_blunt_2h", defaultHand: "two", reach_m: 2.8 },
  quarterstaff:  { category: "melee_blunt_2h", defaultHand: "two", reach_m: 2.5 },

  // ── Polearms ──────────────────────────────────────────────────────
  spear:         { category: "melee_polearm", defaultHand: "either", reach_m: 3.5 },
  lance:         { category: "melee_polearm", defaultHand: "two",    reach_m: 4.0 },
  pike:          { category: "melee_polearm", defaultHand: "two",    reach_m: 4.5 },
  trident:       { category: "melee_polearm", defaultHand: "either", reach_m: 3.2 },

  // ── Exotic melee ──────────────────────────────────────────────────
  whip:          { category: "melee_exotic", defaultHand: "either", reach_m: 4.5 },
  chain:         { category: "melee_exotic", defaultHand: "either", reach_m: 4.0 },
  kusarigama:    { category: "melee_exotic", defaultHand: "either", reach_m: 4.0 },
  nunchaku:      { category: "melee_exotic", defaultHand: "either", reach_m: 1.8 },
  tonfa:         { category: "melee_exotic", defaultHand: "either", reach_m: 1.5 },
  sai:           { category: "melee_exotic", defaultHand: "either", reach_m: 1.5 },
  fan:           { category: "melee_exotic", defaultHand: "either", reach_m: 1.4 },
  kama:          { category: "melee_exotic", defaultHand: "either", reach_m: 1.6 },

  // ── Fist / claw ───────────────────────────────────────────────────
  fist:          { category: "fist", defaultHand: "either", reach_m: 1.2 },
  gauntlet:      { category: "fist", defaultHand: "either", reach_m: 1.3 },
  claw:          { category: "fist", defaultHand: "either", reach_m: 1.5 },
  knuckles:      { category: "fist", defaultHand: "either", reach_m: 1.2 },

  // ── Magical focus / spellcasting ──────────────────────────────────
  wand:          { category: "focus", defaultHand: "either", reach_m: 30 },
  rod:           { category: "focus", defaultHand: "either", reach_m: 25 },
  staff:         { category: "focus", defaultHand: "two",    reach_m: 35 },
  scepter:       { category: "focus", defaultHand: "either", reach_m: 25 },
  orb:           { category: "focus", defaultHand: "either", reach_m: 30 },
  talisman:      { category: "focus", defaultHand: "either", reach_m: 25 },
  grimoire:      { category: "focus", defaultHand: "either", reach_m: 30 },
  crystal:       { category: "focus", defaultHand: "either", reach_m: 25 },

  // ── Defensive ─────────────────────────────────────────────────────
  shield:        { category: "shield", defaultHand: "left",  reach_m: 1.5 },
  buckler:       { category: "shield", defaultHand: "left",  reach_m: 1.3 },
  bulwark:       { category: "shield", defaultHand: "left",  reach_m: 1.6 },
  tower_shield:  { category: "shield", defaultHand: "left",  reach_m: 1.8 },

  // ── Amorphous (shape-shifting / player-invented / AI-modulated) ───
  // Behaviour comes from item meta, not the class template. Used when
  // a player crafts a weapon that doesn't fit any archetype — the item
  // declares its own handedness, reach, element via meta_json. Lets
  // the system support emergent weapons (e.g. a "void scythe" that
  // morphs into a shotgun mid-combo) without code changes.
  amorphous:     { category: "amorphous", defaultHand: "either", reach_m: null, amorphous: true },
});

// ── Regex pattern → weapon_class inference ───────────────────────────────
// Order matters: more specific patterns first (e.g. "greatsword" before
// "sword"). The matcher returns on first hit.
const NAME_TO_CLASS = [
  // Firearms — energy / sci-fi first (more specific keywords)
  [/energy[ _-]?rifle|laser[ _-]?rifle|beam[ _-]?rifle/i,  "energy_rifle", "two"],
  [/plasma\b/i,                                            "plasma",       "two"],
  [/railgun|rail[ _-]?gun/i,                               "railgun",      "two"],
  [/bolter|bolt[ _-]?gun/i,                                "bolter",       "either"],
  [/flamethrower|flame[ _-]?gun/i,                         "flamethrower", "two"],
  [/sniper|marksman\s+rifle|long\s+rifle/i,                "sniper",       "two"],
  [/shotgun|scattergun|pump[ _-]?action/i,                 "shotgun",      "two"],
  [/smg|submachine|machine\s+pistol|uzi/i,                 "smg",          "either"],
  [/lmg|light\s+machine\s+gun|hmg|heavy\s+machine\s+gun/i, "lmg",          "two"],
  [/hand[ _-]?cannon/i,                                    "hand_cannon",  "either"],
  [/blunderbuss|musket|arquebus|hand\s+gonne/i,            "blunderbuss",  "two"],
  [/rifle|carbine|battle\s+rifle|assault\s+rifle/i,        "rifle",        "two"],
  // blowgun before pistol — pistol's `gun\b` greedy-matches "blowgun"
  [/blowgun|blow[ _-]?pipe/i,                              "blowgun",      "either"],
  [/pistol|revolver|sidearm|gun\b/i,                       "pistol",       "either"],

  // Projectile / physics
  [/longbow/i,                                             "longbow",      "two"],
  [/shortbow/i,                                            "shortbow",     "two"],
  [/heavy[ _-]?crossbow|repeating[ _-]?crossbow|arbalest/i,"crossbow",     "two"],
  [/crossbow/i,                                            "crossbow",     "two"],
  [/bow\b/i,                                               "bow",          "two"],
  [/sling\b/i,                                             "sling",        "either"],
  [/javelin/i,                                             "javelin",      "either"],
  [/harpoon/i,                                             "harpoon",      "two"],
  [/boomerang|chakram/i,                                   "boomerang",    "either"],
  [/throwing[ _-]?(knife|axe|star|dagger|spike|shuriken)|shuriken/i,
                                                           "thrown",       "either"],

  // Melee polearms (before "sword" / "axe" because halberd contains neither but glaive could conflict)
  [/halberd|poleaxe|pole[ _-]?axe/i,                       "halberd",      "two"],
  [/naginata/i,                                            "naginata",     "two"],
  [/glaive/i,                                              "glaive",       "two"],
  [/pike\b/i,                                              "pike",         "two"],
  [/lance/i,                                               "lance",        "two"],
  [/trident/i,                                             "trident",      "either"],
  [/spear/i,                                               "spear",        "either"],
  [/quarterstaff|bo[ _-]?staff|long\s+staff/i,             "quarterstaff", "two"],

  // Two-handed melee blades (more specific keywords before "sword")
  [/great\s*sword|claymore|zwei|two[- ]?hand|flamberge|montante/i, "greatsword", "two"],
  [/great\s*axe|war[ _-]?axe|battle[ _-]?axe.*two/i,       "greataxe",     "two"],
  [/scythe|reaper|war[ _-]?scythe/i,                       "scythe",       "two"],

  // Blunt
  [/warhammer|war[ _-]?hammer|sledgehammer|maul/i,         "maul",         "two"],
  [/hammer/i,                                              "hammer",       "two"],
  [/flail|morningstar|morning[ _-]?star/i,                 "flail",        "either"],
  [/mace|cudgel/i,                                         "mace",         "either"],
  [/club\b/i,                                              "club",         "either"],

  // Exotic melee
  [/kusarigama/i,                                          "kusarigama",   "either"],
  [/nunchaku|nunchuck/i,                                   "nunchaku",     "either"],
  [/tonfa/i,                                               "tonfa",        "either"],
  [/sai\b/i,                                               "sai",          "either"],
  [/kama\b/i,                                              "kama",         "either"],
  [/war[ _-]?fan|tessen|iron\s+fan/i,                      "fan",          "either"],
  [/whip\b/i,                                              "whip",         "either"],
  [/chain[ _-]?whip|spiked\s+chain/i,                      "chain",        "either"],

  // Fist / claw
  [/gauntlet/i,                                            "gauntlet",     "either"],
  [/claw\b|talon|wolverine/i,                              "claw",         "either"],
  [/knuckles|brass[ _-]?knuckles|cestus/i,                 "knuckles",     "either"],
  [/fist\b|punch/i,                                        "fist",         "either"],

  // Blades (after specific subtypes)
  [/dagger|knife|stiletto|dirk|kris/i,                     "dagger",       "either"],
  [/machete/i,                                             "machete",      "either"],
  [/kukri/i,                                               "kukri",        "either"],
  [/hatchet/i,                                             "hatchet",      "either"],
  [/tomahawk/i,                                            "tomahawk",     "either"],
  [/sickle/i,                                              "sickle",       "either"],
  [/cutlass/i,                                             "cutlass",      "either"],
  [/rapier|épée|epee|estoc/i,                              "rapier",       "either"],
  [/katana|wakizashi|tachi/i,                              "katana",       "either"],
  [/saber|sabre|scimitar|falchion/i,                       "saber",        "either"],
  [/sword|blade|gladius|longsword/i,                       "sword",        "either"],

  // Magical focus
  [/grimoire|tome|spellbook|codex/i,                       "grimoire",     "either"],
  [/crystal|focusing\s+crystal/i,                          "crystal",      "either"],
  [/orb\b|sphere|astrolabe/i,                              "orb",          "either"],
  [/talisman|amulet|sigil/i,                               "talisman",     "either"],
  [/scepter|sceptre/i,                                     "scepter",      "either"],
  [/wand/i,                                                "wand",         "either"],
  [/rod\b/i,                                               "rod",          "either"],
  [/staff\b/i,                                             "staff",        "two"],

  // Defense
  [/tower[ _-]?shield|kite[ _-]?shield/i,                  "tower_shield", "left"],
  [/buckler/i,                                             "buckler",      "left"],
  [/bulwark/i,                                             "bulwark",      "left"],
  [/shield|aegis/i,                                        "shield",       "left"],

  // Amorphous (player-invented / shape-shifting) — explicit name markers
  [/amorphous|polymorph|shift(er|ing)|adapt(ive|ing)|emergent[ _-]?weapon|null[ _-]?weapon|null[ _-]?form|void[ _-]?form/i,
                                                            "amorphous",   "either"],
];

/**
 * Infer (weapon_class, handedness) from an item name. Returns the first
 * matching pattern from NAME_TO_CLASS, or — if the item record carries
 * `meta.amorphous === true` — the amorphous classification with handedness
 * taken from `meta.handedness` (defaults to "either"). Callers pass the
 * full inventory row when possible so the amorphous shortcut works.
 */
export function inferWeaponClass(itemName = "", itemMeta = null) {
  // Amorphous shortcut — item explicitly declares its own behavior.
  if (itemMeta && typeof itemMeta === "object" && itemMeta.amorphous === true) {
    return {
      weaponClass: "amorphous",
      handedness: ["left", "right", "two", "either"].includes(itemMeta.handedness)
        ? itemMeta.handedness
        : "either",
    };
  }
  for (const [rx, cls, hand] of NAME_TO_CLASS) {
    if (rx.test(itemName)) return { weaponClass: cls, handedness: hand };
  }
  return { weaponClass: null, handedness: "either" };
}

/**
 * Resolve the per-class metadata (category, reach, default-hand, amorphous-
 * flag) for downstream consumers. Returns `null` for unknown classes so
 * the caller can apply safe defaults.
 */
export function getWeaponClassInfo(weaponClass) {
  if (!weaponClass) return null;
  return WEAPON_CLASS_INFO[weaponClass] || null;
}

/**
 * Look up the caller's equipment row, lazily inserting a default row when
 * it doesn't exist. Returns the joined item details for each slot
 * (or null when the slot is empty).
 */
export function getLoadout(db, userId) {
  if (!db || !userId) return null;
  let row = db.prepare(`SELECT * FROM player_equipment WHERE user_id = ?`).get(userId);
  if (!row) {
    db.prepare(`INSERT INTO player_equipment (user_id) VALUES (?)`).run(userId);
    row = db.prepare(`SELECT * FROM player_equipment WHERE user_id = ?`).get(userId);
  }
  function loadItem(invId) {
    if (!invId) return null;
    const it = db.prepare(`SELECT * FROM player_inventory WHERE id = ? AND user_id = ?`).get(invId, userId);
    if (!it) return null;
    // Lazily fill weapon_class + handedness from the name if missing
    if (!it.weapon_class || !it.handedness || it.handedness === 'either') {
      const inf = inferWeaponClass(it.item_name || "");
      if (!it.weapon_class && inf.weaponClass) {
        try { db.prepare(`UPDATE player_inventory SET weapon_class = ? WHERE id = ?`).run(inf.weaponClass, it.id); } catch { /* ok */ }
        it.weapon_class = inf.weaponClass;
      }
      if ((!it.handedness || it.handedness === 'either') && inf.handedness !== 'either') {
        try { db.prepare(`UPDATE player_inventory SET handedness = ? WHERE id = ?`).run(inf.handedness, it.id); } catch { /* ok */ }
        it.handedness = inf.handedness;
      }
    }
    return it;
  }
  return {
    userId,
    rightHand: loadItem(row.right_hand_id),
    leftHand:  loadItem(row.left_hand_id),
    head:      loadItem(row.head_id),
    body:      loadItem(row.body_id),
    accessory: loadItem(row.accessory_id),
    updatedAt: row.updated_at,
  };
}

/**
 * Equip an item to a slot. When the item is two-handed, occupy both right
 * and left slots and clear whatever was previously in the off-hand. When
 * attempting to equip a one-handed item to a hand while a two-handed weapon
 * is already equipped, the two-handed weapon is removed from both slots
 * first (it can't share with anything else).
 */
export function equipItem(db, userId, slot, itemId) {
  if (!db || !userId) return { ok: false, error: "missing_args" };
  if (!["right_hand", "left_hand", "head", "body", "accessory", null, undefined].includes(slot) && slot !== "off") {
    return { ok: false, error: "unknown_slot" };
  }
  // null itemId = unequip the slot
  if (!itemId) {
    db.prepare(`INSERT OR IGNORE INTO player_equipment (user_id) VALUES (?)`).run(userId);
    const col = slot === "right_hand" ? "right_hand_id"
              : slot === "left_hand"  ? "left_hand_id"
              : slot === "head"       ? "head_id"
              : slot === "body"       ? "body_id"
              : slot === "accessory"  ? "accessory_id"
              : null;
    if (!col) return { ok: false, error: "unknown_slot" };
    db.prepare(`UPDATE player_equipment SET ${col} = NULL, updated_at = unixepoch() WHERE user_id = ?`).run(userId);
    return { ok: true, slot, itemId: null };
  }


  const item = db.prepare(`SELECT * FROM player_inventory WHERE id = ? AND user_id = ?`).get(itemId, userId);
  if (!item) return { ok: false, error: "item_not_found" };

  // Re-infer handedness if missing
  if (!item.handedness || item.handedness === 'either') {
    const inf = inferWeaponClass(item.item_name || "");
    if (inf.handedness !== 'either') {
      try { db.prepare(`UPDATE player_inventory SET handedness = ? WHERE id = ?`).run(inf.handedness, item.id); } catch { /* ok */ }
      item.handedness = inf.handedness;
    }
  }

  db.prepare(`INSERT OR IGNORE INTO player_equipment (user_id) VALUES (?)`).run(userId);

  // Two-handed weapon: occupies both right and left, displaces anything else
  if (item.handedness === 'two') {
    db.prepare(`
      UPDATE player_equipment
      SET right_hand_id = ?, left_hand_id = ?, updated_at = unixepoch()
      WHERE user_id = ?
    `).run(item.id, item.id, userId);
    return { ok: true, slot: "two_hand", itemId: item.id };
  }

  // One-handed equip — first clear any two-handed weapon currently in the
  // hands so we don't end up with a half-equipped two-hander.
  const eq = db.prepare(`SELECT * FROM player_equipment WHERE user_id = ?`).get(userId);
  if (eq && eq.right_hand_id && eq.right_hand_id === eq.left_hand_id) {
    db.prepare(`
      UPDATE player_equipment SET right_hand_id = NULL, left_hand_id = NULL WHERE user_id = ?
    `).run(userId);
  }

  // Validate handedness vs slot. handedness='left' → only left_hand;
  // handedness='right' → only right_hand; 'either' → any one-handed slot.
  const target = slot === "right_hand" || slot === "left_hand" ? slot : null;
  if (!target) return { ok: false, error: "non_hand_slot_for_weapon" };
  if (item.handedness === "left"  && target !== "left_hand")  return { ok: false, error: "left_hand_only" };
  if (item.handedness === "right" && target !== "right_hand") return { ok: false, error: "right_hand_only" };

  const col = target === "right_hand" ? "right_hand_id" : "left_hand_id";
  // Prevent duplicating one item across both slots
  const otherCol = target === "right_hand" ? "left_hand_id" : "right_hand_id";
  const eqAfter = db.prepare(`SELECT * FROM player_equipment WHERE user_id = ?`).get(userId);
  if (eqAfter && eqAfter[otherCol] === item.id) {
    db.prepare(`UPDATE player_equipment SET ${otherCol} = NULL WHERE user_id = ?`).run(userId);
  }
  db.prepare(`UPDATE player_equipment SET ${col} = ?, updated_at = unixepoch() WHERE user_id = ?`).run(item.id, userId);
  return { ok: true, slot: target, itemId: item.id };
}

/**
 * Resolve the active hand + weapon for a single attack. The CombatInput
 * Controller emits hand='right'|'left'|'two' on combat:attack; this looks
 * the loaded item up and returns the meta the flow recorder should stamp.
 */
export function resolveAttackHand(db, userId, hand) {
  const loadout = getLoadout(db, userId);
  if (!loadout) return { hand: hand || "right", item: null, weaponClass: null };
  // Two-hand weapon override: if right_hand and left_hand are the same id,
  // every attack is two-hand regardless of what the client sent.
  if (loadout.rightHand && loadout.leftHand && loadout.rightHand.id === loadout.leftHand.id) {
    return { hand: "two", item: loadout.rightHand, weaponClass: loadout.rightHand.weapon_class };
  }
  if (hand === "left" && loadout.leftHand) {
    return { hand: "left", item: loadout.leftHand, weaponClass: loadout.leftHand.weapon_class };
  }
  if (hand === "right" || !hand) {
    if (loadout.rightHand) return { hand: "right", item: loadout.rightHand, weaponClass: loadout.rightHand.weapon_class };
  }
  // Fallback: fist with the requested hand
  return { hand: hand || "right", item: null, weaponClass: "fist" };
}
