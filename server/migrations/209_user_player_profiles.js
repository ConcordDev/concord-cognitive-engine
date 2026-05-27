// server/migrations/209_user_player_profiles.js
//
// Wave A / A3 — compiled per-user playstyle profile. Items 6 (AI learns
// YOU), 7 (gifts that match preferences), and the narrative-bridge
// injection chain all read from this.
//
// Compilation aggregates:
//   - player_skill_levels (top 3 skills)
//   - player_inventory (rarity histogram + weapon class affinities)
//   - player_glyph_spells (dominant element + school)
//   - skill_demonstration_log (witnessed casts)
//   - npc-lineage (which NPCs have copied this player's lineage)
//
// A heartbeat (user-profile-compiler-cycle, freq 240) compiles these
// into a short prose `dialogue_signature` + structured json fields.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_player_profiles (
      user_id              TEXT PRIMARY KEY,
      dialogue_signature   TEXT,              -- short prose injected into NPC prompts
      lineage_summary      TEXT,              -- "frost-mage cavalry duelist who hoards rare blueprints"
      playstyle_json       TEXT,              -- structured: { topSkills, dominantElement, weaponAffinity, rarityHistogram, demonstrations }
      gift_preferences_json TEXT,             -- structured: { preferredCategories, preferredElements, avoidsKinds }
      last_compiled_at     INTEGER,
      activity_signature   TEXT,              -- hash of last-seen inputs; only recompile when this changes
      created_at           INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_upp_stale
      ON user_player_profiles(last_compiled_at)
      WHERE last_compiled_at IS NULL;
  `);
}

export function down(_db) { /* sqlite — keep on rollback */ }
