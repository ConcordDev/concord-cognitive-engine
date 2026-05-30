// server/migrations/293_verified_human.js
//
// Universal Move System — the opt-in "verified human" badge (the locked identity
// decision). The world is indistinguishable by default; a player who wants it may
// carry a verified-human marker and filter for others who do. Columns on users:
//   verified_human     0/1   — has completed the one-time human verification
//   verified_human_at  TEXT  — when (audit trail)
//   badge_visible      0/1   — opt-in DISPLAY (verified but private is allowed)
// Synthetic playtest agents never call verifyHuman, so they're badge-ineligible
// by construction — Instrument 2 can never contaminate the verified-human signal.

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()) return;
  for (const [col, ddl] of [
    ["verified_human", "ALTER TABLE users ADD COLUMN verified_human INTEGER DEFAULT 0"],
    ["verified_human_at", "ALTER TABLE users ADD COLUMN verified_human_at TEXT"],
    ["badge_visible", "ALTER TABLE users ADD COLUMN badge_visible INTEGER DEFAULT 1"],
  ]) {
    if (!columnExists(db, "users", col)) {
      try { db.exec(ddl); } catch { /* noop */ }
    }
  }
}

export function down(_db) {
  // forward-only
}
