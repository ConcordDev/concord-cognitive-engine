// server/migrations/358_hacking_hint_cost.js
//
// Wave 4 gap-closure — hacking-puzzle hint spam (minigames-capability-map.md
// item 1). `getHint` was free, unlimited, and argument-revealing, so a
// player could spam-request hints and skip the actual exploration puzzle
// with no cost. This migration adds a counter so `getHint` (server/lib/
// hacking.js) can track hint requests per (user, puzzle) attempt and
// `attemptCommand` can apply an escalating reward penalty at completion —
// the first hint per attempt stays free, every hint beyond that shaves a
// chunk off the bounty (floored so it never goes to zero).
//
// Append-only per CLAUDE.md invariant; previous migrations are untouched.

function columnExists(db, table, col) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().some((r) => r.name === col); }
  catch { return false; }
}

export function up(db) {
  // Skip cleanly if the table doesn't exist on a minimal build.
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hacking_attempts'").get()) return;

  if (!columnExists(db, "hacking_attempts", "hints_used")) {
    db.exec(`ALTER TABLE hacking_attempts ADD COLUMN hints_used INTEGER NOT NULL DEFAULT 0`);
  }
}

export function down(_db) {
  // SQLite < 3.35 can't DROP COLUMN. Forward-only; the column defaults to 0
  // and is harmless to leave in place.
}
