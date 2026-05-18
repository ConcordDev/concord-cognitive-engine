// server/migrations/237_music_rebuild.js
//
// Music lens rebuild Sprint A — durable persistence for a full
// Spotify/Apple-Music/Bandcamp parity surface.
//
// Pre-this-migration the music lens had 2357 LOC of Spotify-style UI
// (Disc3, ListMusic, Library, Headphones icons) and 12 backend macros
// (analyze / bpmAnalyze / chordProgress / etc) — but ZERO persistence
// tables for tracks, albums, playlists, artists, listens, or likes.
// This migration ships the substrate.

export function up(db) {
  // music_artists ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_artists (
      id              TEXT PRIMARY KEY,
      owner_user_id   TEXT,                                -- null = imported/historical artist
      name            TEXT NOT NULL,
      slug            TEXT NOT NULL UNIQUE,                -- url-safe
      bio             TEXT,
      genres_json     TEXT NOT NULL DEFAULT '[]',
      cover_url       TEXT,
      banner_url      TEXT,
      website         TEXT,
      verified        INTEGER NOT NULL DEFAULT 0,
      follower_count  INTEGER NOT NULL DEFAULT 0,
      monthly_listeners INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_marts_owner ON music_artists(owner_user_id) WHERE owner_user_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_marts_followers ON music_artists(follower_count DESC);
  `);

  // music_albums ───────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_albums (
      id              TEXT PRIMARY KEY,
      artist_id       TEXT NOT NULL,
      title           TEXT NOT NULL,
      kind            TEXT NOT NULL DEFAULT 'album'
                      CHECK (kind IN ('album','ep','single','compilation','live','remix','soundtrack')),
      cover_url       TEXT,
      released_at     TEXT,                                -- ISO date
      label           TEXT,
      copyright       TEXT,
      isrc            TEXT,
      total_tracks    INTEGER NOT NULL DEFAULT 0,
      total_duration_ms INTEGER NOT NULL DEFAULT 0,
      visibility      TEXT NOT NULL DEFAULT 'public'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      deleted_at      INTEGER,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_malb_artist ON music_albums(artist_id, released_at DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_malb_vis ON music_albums(visibility, released_at DESC) WHERE deleted_at IS NULL;
  `);

  // music_tracks ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_tracks (
      id              TEXT PRIMARY KEY,
      artist_id       TEXT NOT NULL,
      album_id        TEXT,                                -- null = standalone single
      title           TEXT NOT NULL,
      track_number    INTEGER,
      disc_number     INTEGER NOT NULL DEFAULT 1,
      duration_ms     INTEGER NOT NULL DEFAULT 0,
      audio_url       TEXT,                                -- presigned / public URL or local relative
      stream_url      TEXT,                                -- transcoded stream variant
      preview_url     TEXT,                                -- 30s preview clip
      waveform_json   TEXT,                                -- pre-computed waveform peaks
      isrc            TEXT,
      bpm             REAL,
      key_signature   TEXT,                                -- 'C major', 'A minor', etc
      genres_json     TEXT NOT NULL DEFAULT '[]',
      mood_tags_json  TEXT NOT NULL DEFAULT '[]',
      lyrics          TEXT,
      explicit        INTEGER NOT NULL DEFAULT 0,
      visibility      TEXT NOT NULL DEFAULT 'public'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      license         TEXT NOT NULL DEFAULT 'all_rights_reserved'
                      CHECK (license IN ('all_rights_reserved','cc_by','cc_by_sa','cc_by_nc','cc_by_nc_sa','cc_by_nd','cc0','custom')),
      listen_count    INTEGER NOT NULL DEFAULT 0,
      like_count      INTEGER NOT NULL DEFAULT 0,
      skip_count      INTEGER NOT NULL DEFAULT 0,
      avg_listen_pct  REAL NOT NULL DEFAULT 0,             -- 0-1: average % of track listened
      dtu_id          TEXT,                                -- set when minted as DTU
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      published_at    INTEGER,
      deleted_at      INTEGER,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE,
      FOREIGN KEY (album_id) REFERENCES music_albums(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mtrk_artist ON music_tracks(artist_id, published_at DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_mtrk_album ON music_tracks(album_id, track_number) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_mtrk_listens ON music_tracks(listen_count DESC) WHERE deleted_at IS NULL AND visibility IN ('public','published','global');
    CREATE INDEX IF NOT EXISTS idx_mtrk_avg_listen ON music_tracks(avg_listen_pct DESC) WHERE deleted_at IS NULL;
  `);

  // music_playlists ───────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_playlists (
      id              TEXT PRIMARY KEY,
      owner_id        TEXT NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT,
      cover_url       TEXT,
      kind            TEXT NOT NULL DEFAULT 'curated'
                      CHECK (kind IN ('curated','smart','liked','listened','radio','collaborative')),
      visibility      TEXT NOT NULL DEFAULT 'private'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      track_count     INTEGER NOT NULL DEFAULT 0,
      total_duration_ms INTEGER NOT NULL DEFAULT 0,
      follower_count  INTEGER NOT NULL DEFAULT 0,
      collaborator_user_ids_json TEXT NOT NULL DEFAULT '[]',  -- for collaborative
      smart_rules_json TEXT,                               -- for smart playlists (mood/bpm/etc filter)
      dtu_id          TEXT,                                -- minted curator DTU
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      deleted_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_mpl_owner ON music_playlists(owner_id, updated_at DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_mpl_vis ON music_playlists(visibility, follower_count DESC) WHERE deleted_at IS NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS music_playlist_tracks (
      playlist_id     TEXT NOT NULL,
      track_id        TEXT NOT NULL,
      position        INTEGER NOT NULL,
      added_by        TEXT NOT NULL,
      added_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (playlist_id, position),
      FOREIGN KEY (playlist_id) REFERENCES music_playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mplt_track ON music_playlist_tracks(track_id);
  `);

  // music_listens ─────────────────────────────────────────────
  // Atomic listen event. listened_ms / track_duration_ms = pct.
  // Used by the inverse-X recommender (deep listens vs skips).
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_listens (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id        TEXT NOT NULL,
      user_id         TEXT,                                -- null = anon stream
      context_kind    TEXT,                                -- 'album','playlist','radio','search','recommendation','social_share','external'
      context_id      TEXT,
      listened_ms     INTEGER NOT NULL DEFAULT 0,
      track_duration_ms INTEGER NOT NULL,
      skipped         INTEGER NOT NULL DEFAULT 0,
      device          TEXT,
      ip_country      TEXT,                                -- inferred from IP, 2-letter
      started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mlsn_track ON music_listens(track_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mlsn_user ON music_listens(user_id, started_at DESC) WHERE user_id IS NOT NULL;
  `);

  // music_likes ───────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_likes (
      user_id         TEXT NOT NULL,
      track_id        TEXT NOT NULL,
      liked_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, track_id),
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mlk_user ON music_likes(user_id, liked_at DESC);
  `);

  // music_follows ─────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_follows (
      follower_id     TEXT NOT NULL,
      artist_id       TEXT NOT NULL,
      followed_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (follower_id, artist_id),
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mfol_artist ON music_follows(artist_id, followed_at DESC);
  `);

  // music_playlist_follows ────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_playlist_follows (
      follower_id     TEXT NOT NULL,
      playlist_id     TEXT NOT NULL,
      followed_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (follower_id, playlist_id),
      FOREIGN KEY (playlist_id) REFERENCES music_playlists(id) ON DELETE CASCADE
    );
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS music_playlist_follows;
    DROP TABLE IF EXISTS music_follows;
    DROP TABLE IF EXISTS music_likes;
    DROP TABLE IF EXISTS music_listens;
    DROP TABLE IF EXISTS music_playlist_tracks;
    DROP TABLE IF EXISTS music_playlists;
    DROP TABLE IF EXISTS music_tracks;
    DROP TABLE IF EXISTS music_albums;
    DROP TABLE IF EXISTS music_artists;
  `);
}
