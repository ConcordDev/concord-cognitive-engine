// Migration 127 — Phase 1.5: Knowledge Trade.
//
// NPCs sell skills to other NPCs and to players. Players buy skill
// recipes from NPCs and receive mentorship sessions that grant the
// student a skill_revisions row at the mentor's depth-minus-one. Both
// directions feed the existing royalty cascade.
//
// Tables:
//   mentorships             — one row per teaching agreement
//   npc_skill_acquisitions  — one row per intra-NPC skill purchase
//   skill_demonstration_log — one row per witnessed-tier event (consumed
//                             by the next NPC revision pass to bias the
//                             composer toward the demonstrated branch)

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mentorships (
      id                  TEXT    PRIMARY KEY,
      mentor_kind         TEXT    NOT NULL CHECK (mentor_kind IN ('player', 'npc')),
      mentor_id           TEXT    NOT NULL,
      student_kind        TEXT    NOT NULL CHECK (student_kind IN ('player', 'npc')),
      student_id          TEXT    NOT NULL,
      recipe_dtu_id       TEXT    NOT NULL,
      sessions_total      INTEGER NOT NULL DEFAULT 1,
      sessions_remaining  INTEGER NOT NULL DEFAULT 1,
      price_paid          INTEGER NOT NULL DEFAULT 0,
      started_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at        INTEGER,
      status              TEXT    NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'completed', 'abandoned'))
    );
    CREATE INDEX IF NOT EXISTS idx_mentorships_student
      ON mentorships(student_kind, student_id, status);
    CREATE INDEX IF NOT EXISTS idx_mentorships_mentor
      ON mentorships(mentor_kind, mentor_id, status);
    CREATE INDEX IF NOT EXISTS idx_mentorships_recipe
      ON mentorships(recipe_dtu_id, started_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_skill_acquisitions (
      id              TEXT    PRIMARY KEY,
      buyer_npc_id    TEXT    NOT NULL,
      seller_npc_id   TEXT    NOT NULL,
      recipe_dtu_id   TEXT    NOT NULL,
      price           INTEGER NOT NULL DEFAULT 0,
      acquired_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_npcsa_buyer  ON npc_skill_acquisitions(buyer_npc_id, acquired_at);
    CREATE INDEX IF NOT EXISTS idx_npcsa_seller ON npc_skill_acquisitions(seller_npc_id, acquired_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_demonstration_log (
      id                TEXT    PRIMARY KEY,
      witnessed_npc_id  TEXT    NOT NULL,
      caster_user_id    TEXT,
      caster_npc_id     TEXT,
      recipe_dtu_id     TEXT    NOT NULL,
      revision_num      INTEGER NOT NULL,
      element           TEXT,
      world_id          TEXT,
      consumed_at       INTEGER,
      witnessed_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_sdl_npc_pending
      ON skill_demonstration_log(witnessed_npc_id, consumed_at);
    CREATE INDEX IF NOT EXISTS idx_sdl_recipe ON skill_demonstration_log(recipe_dtu_id, witnessed_at);
  `);
}

export function down(_db) {
  // Forward-only — knowledge trade history is the substrate.
}
