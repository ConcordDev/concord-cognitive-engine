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

import logger from "../../logger.js";

const NAME_TO_CLASS = [
  // [regex, weapon_class, handedness]
  [/great\s*sword|claymore|zwei|two[- ]?hand/i, "greatsword", "two"],
  [/hammer|maul|warhammer/i,                    "hammer",     "two"],
  [/sniper|rifle|shotgun|crossbow/i,            "rifle",      "two"],
  [/shield|buckler|bulwark/i,                   "shield",     "left"],
  [/dagger|knife|stiletto/i,                    "dagger",     "either"],
  [/pistol|revolver|sidearm|gun\b/i,            "pistol",     "either"],
  [/staff|wand|rod\b/i,                         "staff",      "two"],
  [/bow\b/i,                                    "bow",        "two"],
  [/sword|blade|saber|katana|rapier/i,          "sword",      "either"],
];

export function inferWeaponClass(itemName = "") {
  for (const [rx, cls, hand] of NAME_TO_CLASS) {
    if (rx.test(itemName)) return { weaponClass: cls, handedness: hand };
  }
  return { weaponClass: null, handedness: "either" };
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
