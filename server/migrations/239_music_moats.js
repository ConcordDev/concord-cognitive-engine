// server/migrations/239_music_moats.js
//
// Music lens rebuild Sprint C — concord-native moats.
//
// RESEARCH GROUNDING (May 2026):
//   - Sound.xyz uses EIP-2981 royalty standard with default 10% on
//     secondary sales, configurable splits across wallets. Concord's
//     royalty cascade is the no-blockchain equivalent.
//   - ClearBeats called out "derivative works clearance with accurate
//     rights attribution at scale" as the music industry's biggest
//     unsolved problem. Concord's DTU cite cascade solves it natively.
//   - Bandcamp Fridays (8 days/year, 0% take) generated $19M in 2025
//     alone, $154M cumulative since 2020. Concord Fridays adopts the
//     exact 2026 calendar for fan-familiar UX.
//   - Funkwhale + Soundstorm = ActivityPub-federated music. Concord
//     exports as ActivityPub Note + audio_url enclosure for interop.
//   - Bandcamp banned AI music in 2025-2026. Musical AI is the
//     attribution-for-generative-models layer. Concord supports
//     consent-based AI with mandatory training-source citation.

export function up(db) {
  // music_track_mints — every track that's been minted as a citable DTU
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_track_mints (
      track_id        TEXT PRIMARY KEY,
      dtu_id          TEXT NOT NULL UNIQUE,
      creator_id      TEXT NOT NULL,
      royalty_rate    REAL NOT NULL DEFAULT 0.10,         -- EIP-2981 default
      visibility      TEXT NOT NULL DEFAULT 'public'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      allow_derivative INTEGER NOT NULL DEFAULT 1,
      allow_ai_training INTEGER NOT NULL DEFAULT 0,        -- AI consent (Subvert / Bandcamp position)
      citation_count  INTEGER NOT NULL DEFAULT 0,          -- derivative count (covers/samples/remixes)
      derivative_revenue_cents INTEGER NOT NULL DEFAULT 0, -- royalty cascade earnings (in cents)
      minted_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mtm_creator ON music_track_mints(creator_id, minted_at DESC);
  `);

  // music_playlist_mints — curated playlist as DTU, curator earns royalty
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_playlist_mints (
      playlist_id     TEXT PRIMARY KEY,
      dtu_id          TEXT NOT NULL UNIQUE,
      curator_id      TEXT NOT NULL,
      curator_royalty_rate REAL NOT NULL DEFAULT 0.05,    -- 5% of plays-from-this-playlist
      visibility      TEXT NOT NULL DEFAULT 'public'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      follower_count_at_mint INTEGER NOT NULL DEFAULT 0,
      install_count   INTEGER NOT NULL DEFAULT 0,          -- forks/copies
      minted_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (playlist_id) REFERENCES music_playlists(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mpm_curator ON music_playlist_mints(curator_id, minted_at DESC);
  `);

  // music_derivative_links — cover/sample/remix/interpolation relationships
  // ClearBeats parity: explicit derivative type + clearance status
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_derivative_links (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      derivative_track_id TEXT NOT NULL,
      parent_track_id TEXT NOT NULL,
      kind            TEXT NOT NULL
                      CHECK (kind IN ('cover','sample','interpolation','remix','mashup','stem_swap','translation','ai_generated_from')),
      attribution_pct REAL NOT NULL DEFAULT 1.0,           -- share of revenue routed to parent (0-1)
      clearance_status TEXT NOT NULL DEFAULT 'auto_via_lineage'
                       CHECK (clearance_status IN ('auto_via_lineage','manual_cleared','pending_review','disputed','blocked')),
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (derivative_track_id) REFERENCES music_tracks(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_track_id) REFERENCES music_tracks(id) ON DELETE CASCADE,
      UNIQUE(derivative_track_id, parent_track_id, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_mdl_derivative ON music_derivative_links(derivative_track_id);
    CREATE INDEX IF NOT EXISTS idx_mdl_parent ON music_derivative_links(parent_track_id, created_at DESC);
  `);

  // music_ai_training_citations — when an AI-generated track was trained on
  // identifiable sources, those sources are cited. Musical AI parity.
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_ai_training_citations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ai_track_id     TEXT NOT NULL,
      training_source_dtu_id TEXT NOT NULL,
      contribution_weight REAL NOT NULL DEFAULT 0,         -- estimated contribution (0-1)
      model_name      TEXT,                                 -- which AI model generated the track
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (ai_track_id) REFERENCES music_tracks(id) ON DELETE CASCADE,
      UNIQUE(ai_track_id, training_source_dtu_id)
    );
    CREATE INDEX IF NOT EXISTS idx_matc_ai ON music_ai_training_citations(ai_track_id);
    CREATE INDEX IF NOT EXISTS idx_matc_source ON music_ai_training_citations(training_source_dtu_id);
  `);

  // music_concord_fridays — 0%-take days schedule (Bandcamp Fridays pattern)
  // Pre-seeded for 2026 using Bandcamp's actual calendar for fan-familiar UX.
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_concord_fridays (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      day             TEXT NOT NULL UNIQUE,                -- ISO date (YYYY-MM-DD)
      label           TEXT NOT NULL,
      enabled         INTEGER NOT NULL DEFAULT 1,
      total_payouts_cents INTEGER NOT NULL DEFAULT 0,      -- analytics: how much flowed
      participating_tracks INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_mcf_day ON music_concord_fridays(day);

    -- Seed 2026 calendar matching Bandcamp Fridays exactly
    INSERT OR IGNORE INTO music_concord_fridays (day, label) VALUES
      ('2026-02-06', 'Concord Friday — Feb'),
      ('2026-03-06', 'Concord Friday — Mar'),
      ('2026-05-01', 'Concord Friday — May'),
      ('2026-08-07', 'Concord Friday — Aug'),
      ('2026-09-04', 'Concord Friday — Sep'),
      ('2026-10-02', 'Concord Friday — Oct'),
      ('2026-11-06', 'Concord Friday — Nov'),
      ('2026-12-04', 'Concord Friday — Dec');
  `);

  // music_federation_publishes — ActivityPub publish log (Funkwhale-compatible)
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_federation_publishes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id        TEXT NOT NULL,
      activity_json   TEXT NOT NULL,                       -- the ActivityPub Note + audio enclosure
      target_inbox    TEXT,                                -- null = local Outbox only
      status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','sent','failed','skipped')),
      attempts        INTEGER NOT NULL DEFAULT 0,
      last_error      TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      sent_at         INTEGER,
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mfp_track ON music_federation_publishes(track_id);
    CREATE INDEX IF NOT EXISTS idx_mfp_pending ON music_federation_publishes(status, created_at) WHERE status = 'pending';
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS music_federation_publishes;
    DROP TABLE IF EXISTS music_concord_fridays;
    DROP TABLE IF EXISTS music_ai_training_citations;
    DROP TABLE IF EXISTS music_derivative_links;
    DROP TABLE IF EXISTS music_playlist_mints;
    DROP TABLE IF EXISTS music_track_mints;
  `);
}
