// server/migrations/043_skill_progression.js
export function up(db) {
  // Extend dtus with skill level tracking columns (safe if already added)
  const skillCols = [
    ["skill_level",           "REAL    DEFAULT 1.0"],
    ["total_experience",      "REAL    DEFAULT 0"],
    ["practice_count",        "INTEGER DEFAULT 0"],
    ["teaching_count",        "INTEGER DEFAULT 0"],
    ["cross_world_uses",      "INTEGER DEFAULT 0"],
    ["hybrid_contributions",  "INTEGER DEFAULT 0"],
    ["last_practiced_at",     "INTEGER"],
    ["highest_meaningful_use","TEXT"],
  ];

  for (const [col, def] of skillCols) {
    try {
      db.exec(`ALTER TABLE dtus ADD COLUMN ${col} ${def}`);
    } catch (e) {
      if (!e?.message?.includes("duplicate column")) throw e;
    }
  }

  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_dtus_skill_level
        ON dtus(skill_level)
    `);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_experience_events (
      id               TEXT    PRIMARY KEY,
      skill_dtu_id     TEXT    NOT NULL,
      user_id          TEXT,
      npc_id           TEXT,
      world_id         TEXT    NOT NULL,
      event_type       TEXT    NOT NULL,
      experience_gained REAL   NOT NULL,
      context          TEXT,
      meaningful       INTEGER NOT NULL DEFAULT 1,
      timestamp        INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_see_skill ON skill_experience_events(skill_dtu_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_see_user  ON skill_experience_events(user_id,      timestamp);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS skill_experience_events`);
}
