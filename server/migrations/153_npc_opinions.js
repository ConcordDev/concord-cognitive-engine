// Migration 153 — Sprint C / Track A2: NPC Opinions.
//
// `npc_grudges` (migration 128) records hostile feeling on a 1-10 scale.
// It does not capture neutral / liking / admiring / fearful / respectful
// states. `character_opinions` is the symmetric registry: per-NPC × per-target
// signed score (-100..+100) with a discrete kind label and a per-row
// daily decay rate. Cascades to family/allies via npc-opinions.js helpers.
//
// target_kind ∈ player|npc|faction|kingdom — kingdom is added now so
// Track D (procedural kingdoms) can read citizen loyalty as a view over
// this table without a second schema migration.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_opinions (
      npc_id        TEXT    NOT NULL,
      target_kind   TEXT    NOT NULL CHECK (target_kind IN ('player', 'npc', 'faction', 'kingdom')),
      target_id     TEXT    NOT NULL,
      score         INTEGER NOT NULL DEFAULT 0
                            CHECK (score BETWEEN -100 AND 100),
      kind          TEXT    NOT NULL DEFAULT 'neutral'
                            CHECK (kind IN ('admires','likes','neutral','wary','hates','fears','respects','envies')),
      decay_per_day INTEGER NOT NULL DEFAULT 1
                            CHECK (decay_per_day BETWEEN 0 AND 5),
      top_reason    TEXT,
      last_event_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (npc_id, target_kind, target_id)
    );
    CREATE INDEX IF NOT EXISTS idx_opinion_target ON character_opinions(target_kind, target_id);
    CREATE INDEX IF NOT EXISTS idx_opinion_npc    ON character_opinions(npc_id, score);
    CREATE INDEX IF NOT EXISTS idx_opinion_kind   ON character_opinions(kind);
  `);
}

export function down(_db) {
  // Forward-only — opinion history is the substrate.
}
