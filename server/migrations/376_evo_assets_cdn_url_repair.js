// server/migrations/376_evo_assets_cdn_url_repair.js
//
// Restore evo_assets.cdn_url, dropped a second time by migration 373.
//
// History: migration 084 added `cdn_url TEXT` to evo_assets (nullable, no
// default — CDN integration is opt-in via CONCORD_CDN_BASE_URL; unset means
// the column just stays NULL and the origin keeps streaming). Migration 202
// rebuilt evo_assets via RENAME→CREATE→DROP and dropped it (its CREATE TABLE
// omitted the column); migration 299 restored it via the same idempotent
// `ALTER TABLE evo_assets ADD COLUMN cdn_url TEXT` shape used here. Migration
// 373 (admits 'github' as a source) rebuilt evo_assets AGAIN via the
// identical RENAME→CREATE→DROP shape, and its CREATE TABLE omits BOTH
// `train_consented` AND `cdn_url` a second time. Migration 375 restored
// `train_consented` but never restored `cdn_url` — leaving
// `server/routes/evo-asset.js`'s `GET /api/evo-asset/file/:id` SELECT
// (`a.cdn_url`) referencing a column that no longer exists on any DB that
// has run 373. Confirmed via `node scripts/verify-schema-drift.mjs --ci 0`
// (1 finding: `evo_assets.cdn_url` at evo-asset.js:91) and by booting real
// migrations into an in-memory DB and inspecting `PRAGMA table_info`.
//
// Fix: same idempotent ALTER-COLUMN approach as 084 and 375's
// train_consented restore. Plain nullable TEXT, no default — matches 084's
// original definition exactly (CDN integration stays opt-in; unset means
// NULL, origin keeps streaming).

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

export function up(db) {
  if (tableExists(db, "evo_assets") && !columnExists(db, "evo_assets", "cdn_url")) {
    db.exec(`ALTER TABLE evo_assets ADD COLUMN cdn_url TEXT`);
  }
}

export function down() {
  // Forward-only: SQLite can't cleanly DROP COLUMN pre-3.35, and this is a
  // strict repair of a column that should never have been missing.
}

export const description = "Restore evo_assets.cdn_url, dropped a second time by migration 373's RENAME->CREATE->DROP rebuild";
