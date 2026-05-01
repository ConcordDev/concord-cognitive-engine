// server/migrations/068_quest_state_machine.js
// Quest state machine: objective tracking, progress, and reward distribution.

export function up(db) {
  // ── Create player_quests if it does not exist ──────────────────────────────
  // (Referenced in routes but never formally migrated)
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_quests (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      quest_id     TEXT NOT NULL,
      world_id     TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'active',
      completed_at INTEGER,
      rewarded_at  INTEGER,
      accepted_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, world_id, quest_id)
    );
    CREATE INDEX IF NOT EXISTS idx_player_quests_user ON player_quests(user_id, world_id, status);
  `);

  // ── Expand player_quests with status + reward tracking columns ─────────────
  // Wrap each ALTER TABLE in try/catch; column may already exist if table was
  // created by an earlier ad-hoc path.
  const pqCols = db.prepare('PRAGMA table_info(player_quests)').all().map(c => c.name);
  const pqNewCols = [
    ['status',       "TEXT DEFAULT 'active'"],
    ['completed_at', 'INTEGER'],
    ['rewarded_at',  'INTEGER'],
  ];
  for (const [col, def] of pqNewCols) {
    if (!pqCols.includes(col)) {
      try {
        db.exec(`ALTER TABLE player_quests ADD COLUMN ${col} ${def}`);
      } catch { /* already exists */ }
    }
  }

  // ── Quest objectives ───────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS quest_objectives (
      id             TEXT PRIMARY KEY,
      quest_id       TEXT NOT NULL,
      type           TEXT NOT NULL,
      target         TEXT NOT NULL,
      required_count INTEGER DEFAULT 1,
      description    TEXT,
      order_index    INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_quest_objectives_quest ON quest_objectives(quest_id);
  `);

  // ── Player objective progress ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_quest_progress (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      world_id     TEXT NOT NULL,
      quest_id     TEXT NOT NULL,
      objective_id TEXT NOT NULL,
      current_count INTEGER DEFAULT 0,
      completed_at  INTEGER,
      UNIQUE(user_id, world_id, quest_id, objective_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pqp_user_quest ON player_quest_progress(user_id, world_id, quest_id);
  `);

  // ── Quest rewards definition ───────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS quest_rewards (
      id          TEXT PRIMARY KEY,
      quest_id    TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      reward_key  TEXT,
      amount      INTEGER DEFAULT 100
    );
    CREATE INDEX IF NOT EXISTS idx_quest_rewards_quest ON quest_rewards(quest_id);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS player_quest_progress;`);
  db.exec(`DROP TABLE IF EXISTS quest_rewards;`);
  db.exec(`DROP TABLE IF EXISTS quest_objectives;`);
}
