// server/migrations/192_foundry_phase7.js
//
// Foundry — Phase 7. The four systems the design spec listed that did
// NOT exist in the codebase (the substrate audit flagged them), now
// built as real substrate so the registry stubs can flip to
// 'available':
//
//   player_size           — Size Scaling (Ant-Man / Giant): per-player,
//                            per-world current scale
//   player_titles         — Status Window: earnable, world-scoped titles
//   player_skill_affinity  — per-player skill learning, distinct from
//                            the per-world skill_affinity modulator
//   reincarnations        — Isekai Reincarnation: a per-world ledger of
//                            a player's lives + the inherited boon
//
// All four are world-aware (a Foundry world enables them via its
// worldspec; the rule_modulators carry the per-world config).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_size (
      user_id     TEXT NOT NULL,
      world_id    TEXT NOT NULL,
      scale       REAL NOT NULL DEFAULT 1.0,
      changed_at  INTEGER NOT NULL,
      PRIMARY KEY (user_id, world_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS player_titles (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      world_id   TEXT NOT NULL,
      title      TEXT NOT NULL,
      earned_at  INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_player_titles_user_world ON player_titles(user_id, world_id)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_player_titles_unique ON player_titles(user_id, world_id, title)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS player_skill_affinity (
      user_id       TEXT NOT NULL,
      skill_id      TEXT NOT NULL,
      affinity      REAL NOT NULL DEFAULT 1.0,
      uses          INTEGER NOT NULL DEFAULT 0,
      last_used_at  INTEGER NOT NULL,
      PRIMARY KEY (user_id, skill_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS reincarnations (
      id               TEXT PRIMARY KEY,
      user_id          TEXT NOT NULL,
      world_id         TEXT NOT NULL,
      life_number      INTEGER NOT NULL,
      prior_avatar_id  TEXT,
      inherited_json   TEXT NOT NULL DEFAULT '{}',
      reincarnated_at  INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reincarnations_user_world ON reincarnations(user_id, world_id, life_number)`);
}

export function down(_db) { /* forward-only */ }
