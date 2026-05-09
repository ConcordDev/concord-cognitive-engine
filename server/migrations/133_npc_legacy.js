// Migration 133 — Phase 5b: Death + Legacy.
//
// When an NPC dies, their interiority shouldn't vanish. Their grudges,
// preoccupations, recipes, and wealth pass to heirs (children > faction
// + same-archetype peers). A legacy row records the death + last words +
// tomb position. Unfinished desires become memorial quest hooks.
//
// Tables:
//   npc_legacies            — one row per deceased NPC
//   npc_inheritance_links   — one row per inherited (parent, heir, kind)

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_legacies (
      id              TEXT    PRIMARY KEY,
      npc_id          TEXT    NOT NULL UNIQUE,
      world_id        TEXT    NOT NULL,
      died_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      cause_of_death  TEXT,
      last_words      TEXT,
      tomb_x          REAL    NOT NULL DEFAULT 0,
      tomb_z          REAL    NOT NULL DEFAULT 0,
      faction         TEXT,
      archetype       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_legacy_world ON npc_legacies(world_id, died_at);
    CREATE INDEX IF NOT EXISTS idx_legacy_faction ON npc_legacies(faction);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_inheritance_links (
      id                 TEXT    PRIMARY KEY,
      deceased_npc_id    TEXT    NOT NULL,
      heir_npc_id        TEXT    NOT NULL,
      inherited_kind     TEXT    NOT NULL CHECK (inherited_kind IN (
                                  'grudge', 'preoccupation', 'desire',
                                  'recipe', 'wealth', 'inventory')),
      source_id          TEXT,
      detail_json        TEXT,
      inherited_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_inh_deceased ON npc_inheritance_links(deceased_npc_id);
    CREATE INDEX IF NOT EXISTS idx_inh_heir     ON npc_inheritance_links(heir_npc_id);
  `);
}

export function down(_db) { /* forward-only */ }
