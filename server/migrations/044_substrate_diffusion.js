// server/migrations/044_substrate_diffusion.js
//
// NOTE (Phase 3.5.5 archival, May 2026):
//   The `creation_diffusion` table here has zero SELECT references in
//   the codebase. Superseded by the promotion-pipeline + breakthrough-
//   clusters substrate. Idempotent CREATE preserved for existing DBs.
//   REPLACED_BY: promotion-pipeline.js + breakthrough-clusters.js
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_diffusion (
      id          TEXT PRIMARY KEY,
      skill_id    TEXT NOT NULL,
      state       TEXT NOT NULL DEFAULT '{}',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_skill_diffusion_skill ON skill_diffusion(skill_id);

    CREATE TABLE IF NOT EXISTS creation_diffusion (
      id           TEXT PRIMARY KEY,
      creation_id  TEXT NOT NULL,
      state        TEXT NOT NULL DEFAULT '{}',
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_creation_diffusion_creation ON creation_diffusion(creation_id);

    CREATE TABLE IF NOT EXISTS substrate_patterns (
      id               TEXT PRIMARY KEY,
      pattern_type     TEXT NOT NULL,
      description      TEXT,
      member_dtu_ids   TEXT NOT NULL DEFAULT '[]',
      worlds_present   TEXT NOT NULL DEFAULT '[]',
      emergence_date   INTEGER NOT NULL DEFAULT (unixepoch()),
      current_strength REAL NOT NULL DEFAULT 0.0,
      trajectory       TEXT NOT NULL DEFAULT 'stable'
    );
    CREATE INDEX IF NOT EXISTS idx_substrate_patterns_type     ON substrate_patterns(pattern_type);
    CREATE INDEX IF NOT EXISTS idx_substrate_patterns_strength ON substrate_patterns(current_strength DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS substrate_patterns;
    DROP TABLE IF EXISTS creation_diffusion;
    DROP TABLE IF EXISTS skill_diffusion;
  `);
}
