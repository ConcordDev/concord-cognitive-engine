// server/lib/cosmetics.js
//
// Phase BA3 — dye / tint cosmetic overlay.
//
// Layer between the base appearance (users.appearance_json or
// avatars.appearance_json from mig 187/093) and the avatar renderer.
// Renderer pipeline becomes:
//
//   base appearance → wardrobe overlay (BA4) → dye overlay (BA3) → mesh
//
// The compose function is pure — no DB access — so the renderer can
// call it inline on every frame without hitting the database.

const VALID_CHANNELS = new Set(["primary", "secondary", "trim", "glow"]);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Set a dye on a specific slot+channel. Idempotent on the PK; re-set
 * just updates the color_hex + applied_at.
 */
export function setDye(db, userId, avatarId, slot, channel, colorHex) {
  if (!db || !userId || !slot || !channel) return { ok: false, error: "missing_inputs" };
  if (!VALID_CHANNELS.has(channel)) return { ok: false, error: "invalid_channel" };
  if (!HEX_RE.test(String(colorHex || ""))) return { ok: false, error: "invalid_color" };
  const avatar = avatarId || "default";
  try {
    db.prepare(`
      INSERT INTO cosmetic_overrides (user_id, avatar_id, slot, channel, color_hex)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, avatar_id, slot, channel)
      DO UPDATE SET color_hex = excluded.color_hex, applied_at = unixepoch()
    `).run(userId, avatar, slot, channel, colorHex);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || "db_error" };
  }
}

/** Remove a dye on a slot+channel (idempotent on missing). */
export function removeDye(db, userId, avatarId, slot, channel) {
  if (!db || !userId || !slot || !channel) return { ok: false, error: "missing_inputs" };
  const avatar = avatarId || "default";
  try {
    const r = db.prepare(`
      DELETE FROM cosmetic_overrides
      WHERE user_id = ? AND avatar_id = ? AND slot = ? AND channel = ?
    `).run(userId, avatar, slot, channel);
    return { ok: true, removed: r.changes > 0 };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Get all overrides for a (user, avatar). Returns
 * `{ slot1: { primary, secondary, trim, glow }, slot2: {...}, ... }`.
 */
export function getOverrides(db, userId, avatarId) {
  if (!db || !userId) return {};
  const avatar = avatarId || "default";
  try {
    const rows = db.prepare(`
      SELECT slot, channel, color_hex FROM cosmetic_overrides
      WHERE user_id = ? AND avatar_id = ?
    `).all(userId, avatar);
    const out = {};
    for (const r of rows) {
      if (!out[r.slot]) out[r.slot] = {};
      out[r.slot][r.channel] = r.color_hex;
    }
    return out;
  } catch { return {}; }
}

/**
 * Pure compose: layer dye overrides on top of a base appearance
 * object without mutating. Caller's overrides shape matches getOverrides
 * output: `{ slot: { channel: '#HEX' } }`.
 *
 * Shape contract (preserved): the renderer reads
 *   `appearance.slots[slot][channel]` for the final color.
 */
export function applyAppearanceOverride(baseAppearance, overrides) {
  const base = baseAppearance && typeof baseAppearance === "object" ? baseAppearance : {};
  const ov = overrides && typeof overrides === "object" ? overrides : {};

  // Shallow-clone base, then write dye channels into slots[slot].
  const next = { ...base };
  next.slots = { ...(base.slots || {}) };

  for (const [slot, channels] of Object.entries(ov)) {
    next.slots[slot] = { ...(next.slots[slot] || {}), ...channels };
  }

  return next;
}
