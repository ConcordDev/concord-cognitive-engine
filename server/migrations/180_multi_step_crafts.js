// server/migrations/180_multi_step_crafts.js
//
// Concordia Phase 11 — multi-step crafting chains.
//
// Each "chain" is an authored recipe with N steps. Each step has:
//   - a kind (gather / process / cure / assemble / finish)
//   - duration in cadence-seconds (or season-locked)
//   - required prerequisites (output of prior step)
//   - season gate (optional — Prail-only herb harvest, etc.)
//
// player_craft_jobs tracks an in-progress chain for a (user, world,
// chain_id). One row per active chain per player; completing a step
// advances current_step. Finished chains move to status='complete'.
//
// Chain definitions are authored JSON under content/world/{world}/
// recipes/ — this migration just provisions the table; the seeder
// (Phase 14 territory) reads + inserts canonical IDs.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS craft_chains (
      id              TEXT    PRIMARY KEY,
      name            TEXT    NOT NULL,
      world_id        TEXT    NOT NULL DEFAULT 'concordia-hub',
      steps_json      TEXT    NOT NULL,
      total_duration_s INTEGER NOT NULL DEFAULT 0,
      output_item     TEXT    NOT NULL,
      author_faction  TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_craft_chain_world ON craft_chains(world_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS player_craft_jobs (
      id             TEXT    PRIMARY KEY,
      user_id        TEXT    NOT NULL,
      world_id       TEXT    NOT NULL DEFAULT 'concordia-hub',
      chain_id       TEXT    NOT NULL,
      current_step   INTEGER NOT NULL DEFAULT 0,
      status         TEXT    NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','complete','abandoned','blocked_by_season')),
      started_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      step_started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      step_done_at   INTEGER,
      finished_at    INTEGER
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pcj_user ON player_craft_jobs(user_id, world_id, status)`);
}

export function down(_db) {
  // Forward-only.
}
