// server/migrations/238_music_ai.js
//
// Music lens rebuild Sprint B — AI substrate.
//
//   music_track_classifications — auto-tag scores per track (genre + mood + era + energy + vocal + instrumental)
//   music_recommendations       — per-user precomputed recommendations
//   music_recommendation_audit  — "why am I hearing this?" explainability
//   music_ai_runs               — provenance for all music AI invocations

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_track_classifications (
      track_id        TEXT PRIMARY KEY,
      classifier_version TEXT NOT NULL DEFAULT 'v1',
      -- Inferred genre scores (top-N)
      genres_json     TEXT NOT NULL DEFAULT '{}',  -- {"indie_rock": 0.85, "alternative": 0.7, ...}
      -- Mood axes (0..1)
      energy          REAL NOT NULL DEFAULT 0.5,
      valence         REAL NOT NULL DEFAULT 0.5,    -- happy↔sad
      danceability    REAL NOT NULL DEFAULT 0.5,
      acousticness    REAL NOT NULL DEFAULT 0.5,
      instrumentalness REAL NOT NULL DEFAULT 0.5,
      live_recording  REAL NOT NULL DEFAULT 0,
      speechiness     REAL NOT NULL DEFAULT 0,
      -- Inferred era
      era             TEXT,                          -- '60s','70s','80s','90s','2000s','2010s','2020s'
      -- Derived "depth" axis (inverse-X positive)
      depth           REAL NOT NULL DEFAULT 0.5,     -- complexity / artistic substance
      hook_density    REAL NOT NULL DEFAULT 0.5,    -- can be negative signal (manufactured-pop suspicion)
      source          TEXT NOT NULL DEFAULT 'fallback'
                      CHECK (source IN ('llm','llm_with_audio','fallback','deterministic','human')),
      reasoning       TEXT,
      classified_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mclass_depth ON music_track_classifications(depth DESC);
    CREATE INDEX IF NOT EXISTS idx_mclass_energy ON music_track_classifications(energy DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS music_recommendations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         TEXT NOT NULL,
      track_id        TEXT NOT NULL,
      seed_kind       TEXT NOT NULL                  -- 'inverse_x_default','similar_to_liked','mood_match','genre_explore','depth_dive','rediscover'
                      CHECK (seed_kind IN ('inverse_x_default','similar_to_liked','mood_match','genre_explore','depth_dive','rediscover')),
      seed_id         TEXT,                          -- track/playlist/artist id that seeded this rec
      score           REAL NOT NULL,
      generated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      surfaced_at     INTEGER,                       -- set when actually shown to the user
      acted_on        TEXT,                          -- 'listened','liked','skipped','saved','dismissed'
      acted_at        INTEGER,
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mrec_user ON music_recommendations(user_id, score DESC, generated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mrec_unsurfaced ON music_recommendations(user_id, score DESC) WHERE surfaced_at IS NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS music_recommendation_audit (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         TEXT NOT NULL,
      track_id        TEXT NOT NULL,
      score           REAL NOT NULL,
      breakdown_json  TEXT,                          -- {depth_contrib, mood_contrib, ...}
      reasons_json    TEXT,                          -- ["boosted because depth=0.85", ...]
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_mra_user_track ON music_recommendation_audit(user_id, track_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS music_ai_runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         TEXT,
      track_id        TEXT,
      kind            TEXT NOT NULL
                      CHECK (kind IN ('classify','recommend','mood_detect','explain','similar')),
      input_text      TEXT,
      output_text     TEXT NOT NULL,
      source          TEXT NOT NULL DEFAULT 'llm'
                      CHECK (source IN ('llm','llm_with_audio','fallback','deterministic')),
      tokens          INTEGER NOT NULL DEFAULT 0,
      latency_ms      INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_mair_user ON music_ai_runs(user_id, created_at DESC) WHERE user_id IS NOT NULL;
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS music_ai_runs;
    DROP TABLE IF EXISTS music_recommendation_audit;
    DROP TABLE IF EXISTS music_recommendations;
    DROP TABLE IF EXISTS music_track_classifications;
  `);
}
