// server/migrations/110_dreams.js
//
// Layer 9: dream cycle.
//
// `dreams` records the result of an offline dream-composition pass. The
// dream-cycle heartbeat runs while a player is logged off (no presence
// activity in the last hour); it gathers fragments from the day's
// activity (combat outcomes, gathered resources, places visited, pain
// absorbed, skills levelled) and composes a `dream` DTU summarising
// the day's experience.
//
// The DTU itself is the canonical record — it slots into the existing
// citation / royalty / marketplace pipeline. This table exists so the
// cycle can throttle (one dream per user per `min_compose_interval_s`)
// and so a HUD can show "your dreams" without scanning every DTU.
//
// `signature` is a hash over the fragment fingerprints used; lets a
// repeated cycle on the same window early-out when nothing new
// happened.

export function up(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS dreams (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      world_id      TEXT,
      dream_dtu_id  TEXT,
      fragment_count INTEGER NOT NULL DEFAULT 0,
      signature     TEXT NOT NULL,
      composer      TEXT NOT NULL DEFAULT 'deterministic',  -- 'deterministic' | 'subconscious_llm'
      composed_at   INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_dreams_user_composed
      ON dreams(user_id, composed_at DESC)
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_dreams_signature
      ON dreams(user_id, signature)
  `).run();
}

export function down(db) {
  db.prepare('DROP INDEX IF EXISTS idx_dreams_signature').run();
  db.prepare('DROP INDEX IF EXISTS idx_dreams_user_composed').run();
  db.prepare('DROP TABLE IF EXISTS dreams').run();
}
