// server/migrations/266_player_ascension.js
//
// D30 — endgame paragon/ascension loop.
//
// The biggest retention gap (Phase H: ~55%): D1/D7 loops are strong but there's
// no day-30 reason to log in beyond "another daily" — no paragon/prestige/NG+.
// Today, XP gained at the skill cap (level 100) is DISCARDED (skill-engine.js
// early-returns). This captures that overflow into an ascension track: a long-
// tail point sink granting small permanent account-wide bonuses — the classic
// ARPG/MMO endgame loop (Diablo Paragon / PoE).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_ascension (
      user_id          TEXT PRIMARY KEY,
      level            INTEGER NOT NULL DEFAULT 0,
      xp               INTEGER NOT NULL DEFAULT 0,
      points_available INTEGER NOT NULL DEFAULT 0,
      points_earned    INTEGER NOT NULL DEFAULT 0,
      points_spent     INTEGER NOT NULL DEFAULT 0,
      updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_ascension_allocations (
      user_id    TEXT NOT NULL,
      node_id    TEXT NOT NULL,
      rank       INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, node_id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ascension_alloc_user ON player_ascension_allocations(user_id);`);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS player_ascension_allocations;`);
  db.exec(`DROP TABLE IF EXISTS player_ascension;`);
}
