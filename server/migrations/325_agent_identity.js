// server/migrations/325_agent_identity.js
//
// Wave 7 / Track B1 — the unified agent self-model. Today an autonomous resident's
// identity is scattered across world_npcs.narrative_context + ai_residents +
// marathon accumulated_state_json. This is the ONE canonical record of WHO the
// agent is: its self-chosen name, its un-driftable core values (the anchor B5/C3
// measure drift against), its Panksepp motivation seed, and the pointer to its
// continuous identity DTU. Forward-only.
//
//   agent_id          PK
//   user_id           the player-tier account the agent acts as (Sparks-only)
//   world_id          where it lives
//   given_name        its self-chosen name (first act of agency)
//   naming_origin     how the name was chosen (self_named | authored | inherited)
//   core_values_json  the FIXED point — evolution may not drift past this (the anchor)
//   drive_profile_json the 7-drive Panksepp motivation seed (its day-one wants)
//   identity_dtu_id   the persistent self DTU (name, values, key memories)
//   status            active | paused | retired
//   deposit_sparks    the Sparks bond (NEVER CC — the C2 economy fence)
//   created_at / last_evolved_at / last_reviewed_at  lifecycle + human-review cadence

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_identities (
      agent_id          TEXT PRIMARY KEY,
      user_id           TEXT,
      world_id          TEXT,
      given_name        TEXT NOT NULL,
      naming_origin     TEXT NOT NULL DEFAULT 'self_named',
      core_values_json  TEXT NOT NULL DEFAULT '[]',
      drive_profile_json TEXT NOT NULL DEFAULT '{}',
      identity_dtu_id   TEXT,
      status            TEXT NOT NULL DEFAULT 'active',
      deposit_sparks    INTEGER NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      last_evolved_at   INTEGER,
      last_reviewed_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_agent_identities_user ON agent_identities(user_id);
    CREATE INDEX IF NOT EXISTS idx_agent_identities_world ON agent_identities(world_id);
    CREATE INDEX IF NOT EXISTS idx_agent_identities_status ON agent_identities(status);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS agent_identities;`);
}
