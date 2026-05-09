// Migration 136 — Phase 5d: Magic Glyph Composition.
//
// Players compose new spells from base-6 glyphs (the same algebra that
// powers the Refusal Field). A spell is a sequence of 2-5 glyph-component
// rows that compose into a single skill recipe. The composed spell is
// minted as a DTU (kind='spell_recipe') so it flows through Phase 1 +
// 1.5 (evolution + marketplace) and the Phase 4b economy.
//
// Tables:
//   glyph_components       — author-curated palette of glyph primitives
//                            with element + magnitude + cost contributions
//   player_glyph_spells    — composed spells (recipe DTU + glyph chain)

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS glyph_components (
      id              TEXT    PRIMARY KEY,
      glyph           TEXT    NOT NULL,
      label           TEXT    NOT NULL,
      element         TEXT    NOT NULL,
      damage          REAL    NOT NULL DEFAULT 0,
      range_m         REAL    NOT NULL DEFAULT 0,
      stamina_cost    REAL    NOT NULL DEFAULT 0,
      mana_cost       REAL    NOT NULL DEFAULT 0,
      cooldown_s      REAL    NOT NULL DEFAULT 0,
      narrative       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_glyph_comp_element ON glyph_components(element);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS player_glyph_spells (
      id                TEXT    PRIMARY KEY,
      user_id           TEXT    NOT NULL,
      world_id          TEXT    NOT NULL,
      recipe_dtu_id     TEXT    NOT NULL,
      composed_glyph    TEXT    NOT NULL,
      component_chain   TEXT    NOT NULL,
      element           TEXT    NOT NULL,
      max_damage        REAL    NOT NULL,
      range_m           REAL    NOT NULL,
      stamina_cost      REAL    NOT NULL,
      mana_cost         REAL    NOT NULL,
      cooldown_s        REAL    NOT NULL,
      composed_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_pgs_user ON player_glyph_spells(user_id, composed_at);
    CREATE INDEX IF NOT EXISTS idx_pgs_glyph ON player_glyph_spells(composed_glyph);
  `);
}

export function down(_db) { /* forward-only */ }
