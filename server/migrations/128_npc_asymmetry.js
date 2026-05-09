// Migration 128 — Phase 2: NPC Asymmetry.
//
// Three new structured tables that get auto-prepended to every LLM
// dialogue prompt via narrative-bridge.js#buildNPCTraits. NPCs stop
// sounding generic because the LLM is forced to thread specific events
// through every reply.
//
// Tables:
//   npc_grudges        — persistent resentment against a player/NPC/faction
//   npc_preoccupations — current obsession (faction phase / personal loss)
//   npc_desires        — asymmetric want from a matching player archetype

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_grudges (
      id            TEXT    PRIMARY KEY,
      npc_id        TEXT    NOT NULL,
      target_kind   TEXT    NOT NULL CHECK (target_kind IN ('player', 'npc', 'faction')),
      target_id     TEXT    NOT NULL,
      narrative     TEXT    NOT NULL,
      severity      INTEGER NOT NULL DEFAULT 5
                            CHECK (severity BETWEEN 1 AND 10),
      event_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_grudge_npc      ON npc_grudges(npc_id, severity);
    CREATE INDEX IF NOT EXISTS idx_grudge_target   ON npc_grudges(target_kind, target_id);
    CREATE INDEX IF NOT EXISTS idx_grudge_unresolved ON npc_grudges(npc_id, resolved_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_preoccupations (
      id              TEXT    PRIMARY KEY,
      npc_id          TEXT    NOT NULL,
      kind            TEXT    NOT NULL CHECK (kind IN (
                              'faction_phase', 'personal_loss',
                              'professional_pursuit', 'rival_npc')),
      source_id       TEXT,
      narrative       TEXT    NOT NULL,
      established_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      fades_at        INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_preocc_npc    ON npc_preoccupations(npc_id, established_at);
    CREATE INDEX IF NOT EXISTS idx_preocc_active ON npc_preoccupations(npc_id, fades_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_desires (
      id                    TEXT    PRIMARY KEY,
      npc_id                TEXT    NOT NULL,
      target_archetype      TEXT    NOT NULL,
      narrative             TEXT    NOT NULL,
      completion_predicate_json TEXT,
      reward_kind           TEXT    NOT NULL DEFAULT 'opinion_shift',
      status                TEXT    NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'offered', 'completed', 'expired')),
      offered_to_user_id    TEXT,
      offered_at            INTEGER,
      completed_at          INTEGER,
      created_at            INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_desire_npc      ON npc_desires(npc_id, status);
    CREATE INDEX IF NOT EXISTS idx_desire_open     ON npc_desires(status, target_archetype);
    CREATE INDEX IF NOT EXISTS idx_desire_offered  ON npc_desires(offered_to_user_id, status);
  `);
}

export function down(_db) {
  // Forward-only — asymmetry history is the substrate.
}
