// server/migrations/393_plugin_gallery_disclosure.js
//
// Plugin gallery honesty pass (2026-07-24, user-approved scope: "lightweight
// automated gate + honest labeling" over a full human-review queue). Any
// authenticated user can publish + list a plugin publicly today; `trusted`
// means only "self-signed with a key the SAME account registered for
// itself" — no review, and there was no takedown path at the gallery-entry
// level (an admin could stop a RUNNING plugin via the existing unload route,
// but the gallery ENTRY stayed fully visible/re-installable). This migration
// adds the two honesty primitives that close that gap:
//
//   declared_macros_json — capability disclosure. The macro-namespace grants
//     the plugin is confined to at install time (see
//     buildSandboxedContext/makeConfinedCtx) — sourced from the SAME
//     manifest the loader actually enforces, never a hand-maintained
//     parallel description (see plugin-gallery.js#publishPlugin).
//
//   delisted_at / delisted_reason — the takedown path. Nullable; a delisted
//     entry is excluded from listGallery going forward but stays readable
//     via direct getGalleryEntry lookup, for audit (see
//     plugin-gallery.js#delistPlugin).
//
// Additive + nullable, matching the idiom in migrations 358/359/366/375/376/
// 380/386/389 — guarded no-op on a minimal build without the plugin_gallery
// table (migration 085), byte-identical read-back for every pre-existing row.

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (!tableExists(db, "plugin_gallery")) return; // minimal build without the plugin gallery table

  if (!columnExists(db, "plugin_gallery", "declared_macros_json")) {
    db.exec(`ALTER TABLE plugin_gallery ADD COLUMN declared_macros_json TEXT`);
  }
  if (!columnExists(db, "plugin_gallery", "delisted_at")) {
    db.exec(`ALTER TABLE plugin_gallery ADD COLUMN delisted_at TEXT`);
  }
  if (!columnExists(db, "plugin_gallery", "delisted_reason")) {
    db.exec(`ALTER TABLE plugin_gallery ADD COLUMN delisted_reason TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_plugin_gallery_delisted ON plugin_gallery(delisted_at)`);
}

export function down(db) {
  // Forward-only column add (same rationale as 359/376/380/386/389's ADD
  // COLUMNs) — additive + nullable + harmless to leave behind. The index is
  // safe to drop.
  db.exec(`DROP INDEX IF EXISTS idx_plugin_gallery_delisted`);
}

export const description = "plugin_gallery gains declared_macros_json (capability disclosure sourced from the enforced manifest) + delisted_at/delisted_reason (the takedown path) — nullable, back-compat for every pre-existing row";
