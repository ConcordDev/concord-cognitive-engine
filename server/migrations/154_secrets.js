// Migration 154 — Sprint C / Track A3: Secrets discovery loop.
//
// Authored NPCs ship `narrative_context.secret` strings (26 dormant
// across content/world/**/npcs.json). These MUST NOT enter the LLM
// prompt — they're for human-author branch conditions only. This
// migration adds structured secret rows + per-user discovery records so
// the substrate can:
//   - track which player has discovered which secret
//   - gate quest objectives via requires_secret
//   - power "weaponise" actions that record opinion deltas on holder + subject
//
// PRIVACY INVARIANT: secrets.body MUST NEVER appear in any LLM prompt.
// Discovery beats are standalone text composed at the dialogue endpoint;
// they describe the discovery, not the secret content.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS secrets (
      id                   TEXT    PRIMARY KEY,
      holder_npc_id        TEXT    NOT NULL,
      subject_kind         TEXT    NOT NULL CHECK (subject_kind IN ('npc', 'player', 'faction', 'kingdom', 'world')),
      subject_id           TEXT    NOT NULL,
      kind                 TEXT    NOT NULL CHECK (kind IN
                                  ('paternity', 'crime', 'liaison', 'debt',
                                   'heresy', 'grudge_origin', 'hidden_skill',
                                   'fabricated')),
      body                 TEXT    NOT NULL,
      discovery_difficulty INTEGER NOT NULL DEFAULT 5
                                  CHECK (discovery_difficulty BETWEEN 1 AND 10),
      synthetic            INTEGER NOT NULL DEFAULT 0
                                  CHECK (synthetic IN (0, 1)),
      created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      revealed_at          INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_secret_holder   ON secrets(holder_npc_id);
    CREATE INDEX IF NOT EXISTS idx_secret_subject  ON secrets(subject_kind, subject_id);
    CREATE INDEX IF NOT EXISTS idx_secret_kind     ON secrets(kind);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS secret_discoveries (
      user_id              TEXT    NOT NULL,
      secret_id            TEXT    NOT NULL,
      discovered_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      via                  TEXT    NOT NULL CHECK (via IN
                                  ('dialogue', 'inventory', 'surveillance',
                                   'inheritance', 'quest')),
      weaponised_at        INTEGER,
      weaponised_against   TEXT,
      PRIMARY KEY (user_id, secret_id)
    );
    CREATE INDEX IF NOT EXISTS idx_discovery_user      ON secret_discoveries(user_id);
    CREATE INDEX IF NOT EXISTS idx_discovery_secret    ON secret_discoveries(secret_id);
  `);
}

export function down(_db) {
  // Forward-only — discovery history is the substrate.
}
