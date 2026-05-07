// server/migrations/104_player_companions.js
//
// Pet / companion ownership table. Distinct from creature_bonds (migration
// 083) — bonds track romantic / breeding affinity between two creatures;
// companions track allegiance from a creature to a player owner.
//
// A tamed creature can still breed via creature_bonds, and two players can
// theoretically co-own the same creature (UNIQUE on (owner_id, creature_id)
// allows a single ownership row per pair, but a creature could appear in
// multiple ownership rows if the design ever wants co-tame; v1 ships
// single-owner only and we can relax later without migration churn).
//
// Append-only per CLAUDE.md migration invariant.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_companions (
      id          TEXT PRIMARY KEY,
      owner_id    TEXT NOT NULL,
      creature_id TEXT NOT NULL,
      name        TEXT NOT NULL,
      tame_bond   REAL NOT NULL DEFAULT 100.0,    -- 0..1000; decays slowly without interaction
      loyalty     REAL NOT NULL DEFAULT 50.0,     -- 0..100; rises with combat assists, falls on neglect
      level       INTEGER NOT NULL DEFAULT 1,
      xp          INTEGER NOT NULL DEFAULT 0,
      caught_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      world_id    TEXT NOT NULL DEFAULT 'concordia-hub',
      deployed    INTEGER NOT NULL DEFAULT 0,     -- 0/1 boolean
      last_action_at INTEGER,
      UNIQUE(owner_id, creature_id)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_player_companions_owner       ON player_companions(owner_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_player_companions_owner_world ON player_companions(owner_id, world_id, deployed)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_player_companions_creature    ON player_companions(creature_id)`);
}

export function down(_db) {
  // SQLite < 3.35 — leave table on rollback.
}
