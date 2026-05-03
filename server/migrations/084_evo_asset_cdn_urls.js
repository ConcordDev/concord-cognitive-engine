// server/migrations/084_evo_asset_cdn_urls.js
// Add cdn_url column to evo_assets + evo_asset_versions so the file router
// can 302-redirect to a CDN-hosted GLB instead of streaming from origin.
// CDN integration is opt-in via CONCORD_CDN_BASE_URL — when unset, the
// column simply stays NULL and the origin keeps streaming.

export function up(db) {
  try {
    db.exec(`ALTER TABLE evo_assets ADD COLUMN cdn_url TEXT`);
  } catch (e) {
    if (!e?.message?.includes("duplicate column name")) throw e;
  }
  try {
    db.exec(`ALTER TABLE evo_asset_versions ADD COLUMN cdn_url TEXT`);
  } catch (e) {
    if (!e?.message?.includes("duplicate column name")) throw e;
  }
}

export function down(db) {
  // SQLite doesn't support DROP COLUMN cleanly; leave the columns in place.
  void db;
}
