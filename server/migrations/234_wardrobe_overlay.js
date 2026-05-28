// server/migrations/234_wardrobe_overlay.js
//
// Phase BA4 — wardrobe cosmetic overlay column.
//
// Today equipOutfit writes the outfit slots directly to
// users.appearance_json, replacing the look entirely. Modern transmog
// is: stat gear stays in inventory; the wardrobe pick is purely
// cosmetic and layers on top.
//
// Add ALTER users ADD COLUMN cosmetic_wardrobe_overlay_json TEXT NULL.
// equipOutfit(mode='cosmetic') writes here. equipOutfit(mode='replace')
// is the existing path, kept for back-compat. Renderer pipeline:
//
//   base appearance → wardrobe overlay (this column) → dye overlay (BA3)

export function up(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
    if (!cols.includes("cosmetic_wardrobe_overlay_json")) {
      db.exec(`ALTER TABLE users ADD COLUMN cosmetic_wardrobe_overlay_json TEXT`);
    }
  } catch { /* table missing on minimal build — tolerated */ }
}

export function down(_db) {
  // SQLite older versions can't DROP COLUMN; leave in place on down.
}
