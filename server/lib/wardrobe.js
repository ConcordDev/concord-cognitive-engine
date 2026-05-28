// server/lib/wardrobe.js
//
// Phase V3 — slot-based wardrobe.

import crypto from "node:crypto";

const MAX_OUTFITS_PER_USER = 50;

export function saveOutfit(db, userId, opts) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const name = String(opts?.name || "").slice(0, 80).trim();
  if (!name) return { ok: false, error: "name_required" };
  const slots = opts?.slots && typeof opts.slots === "object" ? opts.slots : {};

  // Per-user cap.
  try {
    const r = db.prepare(`SELECT COUNT(*) AS n FROM saved_outfits WHERE user_id = ?`).get(userId);
    if ((r?.n || 0) >= MAX_OUTFITS_PER_USER) return { ok: false, error: "outfit_cap_reached" };
  } catch { /* table optional */ }

  const id = opts?.id || `outfit_${crypto.randomBytes(6).toString("hex")}`;
  try {
    db.prepare(`
      INSERT INTO saved_outfits (id, user_id, name, slots_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        slots_json = excluded.slots_json,
        updated_at = unixepoch()
    `).run(id, userId, name, JSON.stringify(slots));
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listMyOutfits(db, userId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, name, slots_json, created_at AS createdAt, updated_at AS updatedAt
      FROM saved_outfits WHERE user_id = ?
      ORDER BY updated_at DESC
    `).all(userId).map(r => ({ ...r, slots: _parseJson(r.slots_json) }));
  } catch {
    return [];
  }
}

export function getOutfit(db, outfitId, userId) {
  if (!db || !outfitId) return null;
  try {
    const r = db.prepare(`
      SELECT id, user_id AS userId, name, slots_json, created_at AS createdAt, updated_at AS updatedAt
      FROM saved_outfits WHERE id = ?
    `).get(outfitId);
    if (!r) return null;
    if (userId && r.userId !== userId) return null;
    return { ...r, slots: _parseJson(r.slots_json) };
  } catch {
    return null;
  }
}

export function deleteOutfit(db, outfitId, userId) {
  if (!db || !outfitId || !userId) return { ok: false, error: "missing_inputs" };
  try {
    const r = db.prepare(`DELETE FROM saved_outfits WHERE id = ? AND user_id = ?`).run(outfitId, userId);
    return r.changes > 0 ? { ok: true } : { ok: false, error: "not_found_or_not_owner" };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Equip an outfit. Two modes (Phase BA4):
 *   - 'cosmetic' (default): overlay only — writes to
 *     users.cosmetic_wardrobe_overlay_json, leaves underlying stat gear
 *     in appearance_json untouched. The renderer composes overlay on
 *     top of base.
 *   - 'replace': back-compat — writes directly to appearance_json,
 *     replacing the look entirely.
 *
 * Returns the new slots for the caller to broadcast.
 */
export function equipOutfit(db, outfitId, userId, mode = "cosmetic") {
  const outfit = getOutfit(db, outfitId, userId);
  if (!outfit) return { ok: false, error: "not_found" };
  const payload = JSON.stringify({
    slots: outfit.slots, outfitId, equippedAt: Math.floor(Date.now() / 1000), mode,
  });
  try {
    if (mode === "replace") {
      db.prepare(`UPDATE users SET appearance_json = ? WHERE id = ?`).run(payload, userId);
    } else {
      // cosmetic mode is default — never touches appearance_json.
      db.prepare(`UPDATE users SET cosmetic_wardrobe_overlay_json = ? WHERE id = ?`).run(payload, userId);
    }
    return { ok: true, slots: outfit.slots, outfitId, mode };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Read the cosmetic overlay back. Returns null when nothing equipped.
 * Used by the avatar renderer composition pipeline.
 */
export function getCosmeticOverlay(db, userId) {
  if (!db || !userId) return null;
  try {
    const r = db.prepare(`SELECT cosmetic_wardrobe_overlay_json FROM users WHERE id = ?`).get(userId);
    if (!r?.cosmetic_wardrobe_overlay_json) return null;
    return JSON.parse(r.cosmetic_wardrobe_overlay_json);
  } catch { return null; }
}

/** Clear the cosmetic overlay (back to stat-gear look). */
export function clearCosmeticOverlay(db, userId) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  try {
    db.prepare(`UPDATE users SET cosmetic_wardrobe_overlay_json = NULL WHERE id = ?`).run(userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Mint a kind='outfit_recipe' DTU so the outfit is marketable.
 */
export function shareOutfit(db, outfitId, userId) {
  const outfit = getOutfit(db, outfitId, userId);
  if (!outfit) return { ok: false, error: "not_found" };
  const dtuId = `dtu_outfit_${crypto.randomBytes(6).toString("hex")}`;
  try {
    db.prepare(`
      INSERT INTO dtus (id, title, kind, created_by, created_at, meta_json)
      VALUES (?, ?, 'outfit_recipe', ?, unixepoch(), ?)
    `).run(dtuId, outfit.name, userId, JSON.stringify({ outfit_slots: outfit.slots, source_outfit_id: outfitId }));
    return { ok: true, dtuId };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listSlotTypes(db) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT slot_kind AS slotKind, label, valid_items_kinds, sort_order AS sortOrder
      FROM outfit_slot_types ORDER BY sort_order ASC
    `).all().map(r => ({ ...r, valid_items_kinds: _parseJson(r.valid_items_kinds) }));
  } catch {
    return [];
  }
}

function _parseJson(s) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}
