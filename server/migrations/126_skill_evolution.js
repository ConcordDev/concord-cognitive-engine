// Migration 126 — Phase 1: Skill Evolution.
//
// Adds the lifelong content engine: every 10 levels a skill recipe DTU
// can be upgraded with a player-supplied (or NPC-deterministic) narrative
// that mutates the recipe's max_damage, range_m, costs, and current_name.
// Revisions form a lineage chain via skill_revisions.recipe_dtu_id so a
// water gun → pressure jet → hydro pump progression is queryable end-to-end.
//
// Entity-agnostic: the same tables track player AND NPC revisions. NPCs
// at level 20,000+ (the Sovereign) accumulate 2,000-deep lineages composed
// by the deterministic engine over months of in-world simulation time.
//
// Tables:
//   skill_revisions          — one row per upgrade narrative
//   skill_evolution_unlocks  — one row per level-10 boundary crossed (gates
//                              the modal trigger for players, auto-commits
//                              for NPCs on the next npc-skill-evolve-cycle)
//
// dtus.meta.skill_kind ∈ {spell, biopower, cyber_ability, fighting_style,
//   psionic, tech_gadget, mundane} — set at recipe author time. We don't
//   add a column; the recipe DTU's meta JSON carries the kind so existing
//   author UIs (RecipeAuthorPanel) emit it without a schema change.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_revisions (
      id                  TEXT    PRIMARY KEY,
      recipe_dtu_id       TEXT    NOT NULL,
      revision_num        INTEGER NOT NULL,
      level_at_revision   REAL    NOT NULL,
      author_kind         TEXT    NOT NULL CHECK (author_kind IN ('player', 'npc')),
      author_id           TEXT    NOT NULL,
      description         TEXT    NOT NULL,
      composer            TEXT    NOT NULL CHECK (composer IN ('player_text', 'npc_deterministic', 'subconscious_llm', 'deterministic')),
      max_damage_before   REAL,
      max_damage_after    REAL,
      range_m_before      REAL,
      range_m_after       REAL,
      costs_json          TEXT,
      effect_delta_json   TEXT,
      name_before         TEXT,
      name_after          TEXT,
      status              TEXT    NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'applied', 'rejected')),
      reject_reason       TEXT,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_skrev_recipe ON skill_revisions(recipe_dtu_id, revision_num);
    CREATE INDEX IF NOT EXISTS idx_skrev_author ON skill_revisions(author_kind, author_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_skrev_status ON skill_revisions(status, created_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_evolution_unlocks (
      id                TEXT    PRIMARY KEY,
      entity_kind       TEXT    NOT NULL CHECK (entity_kind IN ('player', 'npc')),
      entity_id         TEXT    NOT NULL,
      recipe_dtu_id     TEXT    NOT NULL,
      level_at_unlock   INTEGER NOT NULL,
      unlocked_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      surfaced_at       INTEGER,
      completed_at      INTEGER,
      revision_id       TEXT,
      UNIQUE (entity_kind, entity_id, recipe_dtu_id, level_at_unlock)
    );
    CREATE INDEX IF NOT EXISTS idx_skunlock_pending
      ON skill_evolution_unlocks(entity_kind, entity_id, completed_at);
    CREATE INDEX IF NOT EXISTS idx_skunlock_recipe
      ON skill_evolution_unlocks(recipe_dtu_id, level_at_unlock);
  `);
}

export function down(_db) {
  // Forward-only — the lineage is the substrate. No drop path.
}
