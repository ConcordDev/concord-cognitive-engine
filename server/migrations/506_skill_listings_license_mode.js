// Migration 506 — SB-20: skill listings carry a license mode. A 'single'
// listing sells once and is marked sold by its purchase; a 'multi'
// listing stays active across sales. A plain ADD COLUMN (the 503
// pattern) — rows written before this migration carry the default
// 'single', which is the only behaviour the marketplace has ever had.

export function up(db) {
  const cols = db.prepare(`PRAGMA table_info(skill_listings)`).all().map((c) => c.name);
  if (cols.length && !cols.includes("license_mode")) {
    db.exec(`ALTER TABLE skill_listings ADD COLUMN license_mode TEXT NOT NULL DEFAULT 'single'`);
  }
}

export function down(_db) {
  // No-op — the column is inert when unused.
}
