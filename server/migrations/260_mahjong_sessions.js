// server/migrations/260_mahjong_sessions.js
//
// Phase E4 — full mahjong tile sim substrate.
//
// mahjong_sessions: one per active table.
// mahjong_seats: 4 per session (player + 3 NPCs).
// mahjong_actions_log: one row per game action for replay + scoring.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mahjong_sessions (
      id              TEXT PRIMARY KEY,
      world_id        TEXT NOT NULL,
      started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at        INTEGER,
      end_reason      TEXT,             -- 'tsumo' | 'exhausted' | 'abandoned'
      winner_seat     INTEGER,
      dealer_seat     INTEGER NOT NULL DEFAULT 0,
      round_wind      TEXT NOT NULL DEFAULT 'east'
                       CHECK (round_wind IN ('east', 'south', 'west', 'north')),
      dora_indicator  TEXT,             -- single tile string e.g. "m3", "pE"
      wall_remaining  INTEGER NOT NULL DEFAULT 70,
      turn_seat       INTEGER NOT NULL DEFAULT 0,
      seed            INTEGER NOT NULL  -- for deterministic wall shuffle
    );

    CREATE TABLE IF NOT EXISTS mahjong_seats (
      session_id      TEXT NOT NULL,
      seat_index      INTEGER NOT NULL,    -- 0..3, 0 = dealer (east)
      entity_kind     TEXT NOT NULL,       -- 'player' | 'npc'
      entity_id       TEXT NOT NULL,
      seat_wind       TEXT NOT NULL,       -- east | south | west | north
      hand_json       TEXT NOT NULL DEFAULT '[]',
      melded_json     TEXT NOT NULL DEFAULT '[]',
      discards_json   TEXT NOT NULL DEFAULT '[]',
      style           TEXT,                -- npc style: 'safe' | 'tempai' | 'yakuhunt'
      riichi_at       INTEGER,
      tsumo_at        INTEGER,
      PRIMARY KEY (session_id, seat_index)
    );

    CREATE INDEX IF NOT EXISTS idx_mahjong_seats_session ON mahjong_seats(session_id);

    CREATE TABLE IF NOT EXISTS mahjong_actions_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT NOT NULL,
      seat_index      INTEGER NOT NULL,
      action_kind     TEXT NOT NULL,        -- 'draw' | 'discard' | 'tsumo' | 'wall_exhausted'
      payload_json    TEXT NOT NULL DEFAULT '{}',
      at_ms           INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_mahjong_log_session ON mahjong_actions_log(session_id, at_ms);
  `);
}

export const description = "Phase E4 — mahjong tile sim sessions + seats + action log";
