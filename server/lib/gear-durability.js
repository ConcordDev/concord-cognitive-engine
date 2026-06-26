// server/lib/gear-durability.js
//
// Gear DURABILITY + REPAIR engine (MMO research-grounded).
//
// DESIGN (do not deviate):
//   • Durability decay is tied to DEATH, not per-hit/per-ability. WoW's
//     per-block "Block Tax" is the textbook anti-pattern; symmetric
//     death-tied decay avoids it. On a player's own death, each EQUIPPED
//     item loses a fixed chunk of durability (floored at 0).
//   • "Broken" gear (current_durability === 0) provides NO stat/effect
//     benefit until repaired — see isBroken() + the combat affix/set read.
//   • Repair is a gold sink: "Repair All" costs Concord Coin scaling with
//     item level + missing durability, refills durability to max.
//   • NULL max_durability ⇒ indestructible / non-gear (materials,
//     consumables, legacy rows). Such items never decay and are never
//     broken — getInventoryDurability / decay skip them entirely.
//
// Everything here is guarded: a missing player_inventory / player_equipment
// table or a missing durability column degrades gracefully and NEVER throws.
//
// Concord Coin debit follows the canonical in-game gold-sink pattern used by
// world-buildings-repair.js / skill-marketplace.js: an atomic
//   UPDATE users SET concordia_credits = concordia_credits - ? WHERE id = ? AND concordia_credits >= ?
// guarded by a balance check first.

// ── Constants (balance dials) ───────────────────────────────────────────────
export const DURABILITY = Object.freeze({
  // Default max durability stamped on gear that has none yet (ensureDurability).
  MAX_DEFAULT: Number(process.env.CONCORD_GEAR_MAX_DURABILITY) || 100,
  // Flat durability lost per equipped item on the owner's death.
  DEATH_DECAY: Number(process.env.CONCORD_GEAR_DEATH_DECAY) || 20,
  // Fraction of max at/below which the client warns ("low durability").
  LOW_FRACTION: Number(process.env.CONCORD_GEAR_LOW_FRACTION) || 0.2,
  // Repair cost = base + perLevel*itemLevel, per unit of missing durability,
  // normalised by max. See repairCostFor.
  REPAIR_BASE: Number(process.env.CONCORD_GEAR_REPAIR_BASE) || 2,
  REPAIR_PER_LEVEL: Number(process.env.CONCORD_GEAR_REPAIR_PER_LEVEL) || 0.5,
});

// Item types that are gear (can take durability). Everything else is left
// indestructible (NULL max_durability) so materials/consumables never break.
const GEAR_ITEM_TYPES = new Set([
  "equipment", "weapon", "armor", "tool", "gear", "accessory", "shield",
]);

// ── Internal: column / table presence guards ────────────────────────────────
function hasColumn(db, table, col) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().some((r) => r.name === col); }
  catch { return false; }
}

function durabilitySupported(db) {
  return hasColumn(db, "player_inventory", "current_durability")
      && hasColumn(db, "player_inventory", "max_durability");
}

/**
 * Resolve the inventory-row ids currently equipped by `userId` from
 * player_equipment (the canonical loadout table). Returns a de-duplicated
 * array of inventory ids (a two-handed weapon occupies two slots → one id).
 * Empty array if the table / row is absent.
 */
function equippedInventoryIds(db, userId) {
  try {
    const row = db.prepare(`SELECT * FROM player_equipment WHERE user_id = ?`).get(userId);
    if (!row) return [];
    const ids = [row.right_hand_id, row.left_hand_id, row.head_id, row.body_id, row.accessory_id]
      .filter(Boolean);
    return [...new Set(ids)];
  } catch { return []; }
}

/** The item level used for repair cost — gear_level, else quality/10, else 1. */
function itemLevelOf(item) {
  if (!item) return 1;
  if (Number.isFinite(item.gear_level) && item.gear_level > 0) return Number(item.gear_level);
  if (Number.isFinite(item.quality) && item.quality > 0) return Math.max(1, Math.round(Number(item.quality) / 10));
  return 1;
}

// ── isBroken ────────────────────────────────────────────────────────────────
/**
 * An item is broken when it HAS durability (max set) and current is 0.
 * Items with a NULL max_durability are indestructible and never broken.
 */
export function isBroken(item) {
  if (!item) return false;
  const max = item.max_durability;
  if (max === null || max === undefined) return false;
  return Number(item.current_durability) === 0;
}

/** True when the item has durability and is at/below the LOW_FRACTION warn line (but not broken). */
export function isLowDurability(item) {
  if (!item) return false;
  const max = item.max_durability;
  if (max === null || max === undefined || Number(max) <= 0) return false;
  const cur = Number(item.current_durability);
  if (cur === 0) return false; // broken, not "low"
  return cur <= Math.floor(Number(max) * DURABILITY.LOW_FRACTION);
}

// ── repairCostFor ────────────────────────────────────────────────────────────
/**
 * Deterministic repair cost for a single item: scales with item level and the
 * amount of missing durability. Returns 0 for non-gear / full / NULL-max items.
 */
export function repairCostFor(item) {
  if (!item) return 0;
  const max = item.max_durability;
  if (max === null || max === undefined || Number(max) <= 0) return 0;
  const cur = Math.max(0, Number(item.current_durability) || 0);
  const missing = Math.max(0, Number(max) - cur);
  if (missing <= 0) return 0;
  const level = itemLevelOf(item);
  const perPoint = DURABILITY.REPAIR_BASE + DURABILITY.REPAIR_PER_LEVEL * level;
  // Cost is proportional to missing durability as a fraction of max, so a
  // small nick is cheap and a fully-broken item is expensive.
  return Math.max(1, Math.ceil((missing / Number(max)) * perPoint * Number(max) / 10));
}

// ── ensureDurability ─────────────────────────────────────────────────────────
/**
 * Stamp default durability on an equipped GEAR item that doesn't have it yet
 * (legacy gear crafted before this system). Materials / consumables stay NULL.
 * Returns the (possibly mutated) item row. Best-effort; never throws.
 */
export function ensureDurability(db, item) {
  if (!item || !durabilitySupported(db)) return item;
  const isGear = GEAR_ITEM_TYPES.has(String(item.item_type || "").toLowerCase());
  if (!isGear) return item;
  if (item.max_durability !== null && item.max_durability !== undefined) return item;
  const max = DURABILITY.MAX_DEFAULT;
  try {
    db.prepare(
      `UPDATE player_inventory SET max_durability = ?, current_durability = ? WHERE id = ? AND user_id = ?`,
    ).run(max, max, item.id, item.user_id);
    item.max_durability = max;
    item.current_durability = max;
  } catch { /* column/table optional */ }
  return item;
}

// ── decayEquippedOnDeath ─────────────────────────────────────────────────────
/**
 * Apply death-decay to every equipped GEAR item the player owns. Each item
 * with a non-null max_durability loses DURABILITY.DEATH_DECAY (floored at 0).
 * Legacy equipped gear without durability is lazily initialised first so it
 * also participates. Returns a list of { itemId, itemName, current, max, broke }.
 *
 * `broke` is true when the item crossed FROM >0 TO 0 on this death.
 */
export function decayEquippedOnDeath(db, userId) {
  if (!db || !userId || !durabilitySupported(db)) return [];
  const ids = equippedInventoryIds(db, userId);
  if (ids.length === 0) return [];

  const out = [];
  try {
    const tx = db.transaction(() => {
      for (const invId of ids) {
        let item;
        try { item = db.prepare(`SELECT * FROM player_inventory WHERE id = ? AND user_id = ?`).get(invId, userId); }
        catch { item = null; }
        if (!item) continue;
        // Lazily stamp durability on legacy gear so it decays too.
        ensureDurability(db, item);
        const max = item.max_durability;
        if (max === null || max === undefined) continue; // non-gear / indestructible
        const before = Math.max(0, Number(item.current_durability ?? max));
        const after = Math.max(0, before - DURABILITY.DEATH_DECAY);
        if (after === before) {
          // already 0 — still report as broken so the client keeps warning
          out.push({ itemId: invId, itemName: item.item_name || "", current: after, max: Number(max), broke: false, broken: after === 0 });
          continue;
        }
        db.prepare(`UPDATE player_inventory SET current_durability = ? WHERE id = ? AND user_id = ?`)
          .run(after, invId, userId);
        out.push({
          itemId: invId,
          itemName: item.item_name || "",
          current: after,
          max: Number(max),
          broke: before > 0 && after === 0,
          broken: after === 0,
        });
      }
    });
    tx();
  } catch { return out; }
  return out;
}

// ── getInventoryDurability ───────────────────────────────────────────────────
/**
 * List all of the player's items that HAVE durability (max set), with derived
 * broken/low flags. Items with NULL max_durability are omitted (they have no
 * durability surface). User-global read — scoped by user_id only, NEVER world_id.
 */
export function getInventoryDurability(db, userId) {
  if (!db || !userId || !durabilitySupported(db)) return [];
  let rows;
  try {
    rows = db.prepare(
      `SELECT id, item_name, item_type, gear_level, quality, current_durability, max_durability
       FROM player_inventory
       WHERE user_id = ? AND max_durability IS NOT NULL
       ORDER BY acquired_at DESC`,
    ).all(userId);
  } catch { return []; }
  const equipped = new Set(equippedInventoryIds(db, userId));
  return rows.map((r) => ({
    itemId: r.id,
    itemName: r.item_name || "",
    itemType: r.item_type || null,
    current: Number(r.current_durability ?? r.max_durability),
    max: Number(r.max_durability),
    broken: isBroken(r),
    lowDurability: isLowDurability(r),
    equipped: equipped.has(r.id),
    repairCost: repairCostFor(r),
  }));
}

// ── repairAll ────────────────────────────────────────────────────────────────
/**
 * Repair every damaged GEAR item the player owns, refilling each to max.
 * Cost = sum of repairCostFor over damaged items. Debits CC via the passed
 * `walletDebit(amount) -> { ok }` callback (canonical in-game gold sink).
 *
 * Returns { ok, cost, repaired:[{itemId,itemName,restoredTo}] } on success,
 * { ok:false, reason:'insufficient_funds', cost } when the wallet can't pay,
 * { ok:true, cost:0, repaired:[] } when nothing needs repair.
 *
 * The whole thing is one transaction so a partial repair never half-spends.
 */
export function repairAll(db, userId, { walletDebit } = {}) {
  if (!db || !userId) return { ok: false, reason: "missing_inputs" };
  if (!durabilitySupported(db)) return { ok: false, reason: "durability_unsupported" };

  let damaged;
  try {
    damaged = db.prepare(
      `SELECT id, item_name, item_type, gear_level, quality, current_durability, max_durability
       FROM player_inventory
       WHERE user_id = ? AND max_durability IS NOT NULL
         AND current_durability < max_durability`,
    ).all(userId);
  } catch { return { ok: false, reason: "durability_unsupported" }; }

  if (!damaged || damaged.length === 0) return { ok: true, cost: 0, repaired: [] };

  const cost = damaged.reduce((sum, it) => sum + repairCostFor(it), 0);

  // Debit CC up-front. If no walletDebit is supplied (tests / minimal builds)
  // we proceed without charging — same contract as land-claims.claimLand.
  if (cost > 0 && typeof walletDebit === "function") {
    const charged = walletDebit(cost);
    if (!charged?.ok) return { ok: false, reason: "insufficient_funds", cost };
  }

  const repaired = [];
  try {
    const tx = db.transaction(() => {
      for (const it of damaged) {
        db.prepare(`UPDATE player_inventory SET current_durability = max_durability WHERE id = ? AND user_id = ?`)
          .run(it.id, userId);
        repaired.push({ itemId: it.id, itemName: it.item_name || "", restoredTo: Number(it.max_durability) });
      }
    });
    tx();
  } catch (err) {
    return { ok: false, reason: "repair_failed", error: err?.message };
  }

  return { ok: true, cost, repaired };
}

/**
 * Build the canonical in-game CC walletDebit closure for `userId`. Atomic +
 * balance-guarded; returns { ok:false } if the balance can't cover `amount`.
 * Mirrors world-buildings-repair.js / skill-marketplace.js. Best-effort: if
 * the users table / column is absent it fails open (ok:true, charged:0).
 */
export function makeWalletDebit(db, userId) {
  return (amount) => {
    const amt = Math.max(0, Math.ceil(Number(amount) || 0));
    if (amt === 0) return { ok: true, charged: 0 };
    try {
      const w = db.prepare(`SELECT concordia_credits AS balance FROM users WHERE id = ?`).get(userId);
      if (!w) return { ok: true, charged: 0 }; // no wallet row — fail open
      if ((w.balance ?? 0) < amt) return { ok: false, balance: w.balance ?? 0 };
      const r = db.prepare(
        `UPDATE users SET concordia_credits = concordia_credits - ? WHERE id = ? AND concordia_credits >= ?`,
      ).run(amt, userId, amt);
      if (r.changes === 0) return { ok: false, balance: w.balance ?? 0 };
      return { ok: true, charged: amt };
    } catch { return { ok: true, charged: 0 }; }
  };
}
