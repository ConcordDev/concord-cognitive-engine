// server/migrations/207_scheduled_consequences.js
//
// Generic delayed-action ledger. Every revolutionary RPG feature in the
// active arc (consequence cascades, scheme reveals, bard legends, cult
// formations, bounty postings) needs "schedule X to fire N hours after
// event Y". Today the codebase has two scheduler patterns but both are
// template-driven and not generic (faction-event-scheduler picks from
// authored lore, personal-beat-scheduler ticks player-facing beats).
//
// This table is the substrate everything else writes into:
//   schedule({kind, fireInS, payload, source, target, worldId})
//   consequence-dispatcher-cycle drains due rows on a heartbeat
//   per-kind handlers fire whatever the consequence is

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_consequences (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      kind          TEXT NOT NULL,
      fires_at      INTEGER NOT NULL,
      source_kind   TEXT,
      source_id     TEXT,
      target_kind   TEXT,
      target_id     TEXT,
      world_id      TEXT,
      payload_json  TEXT,
      fired_at      INTEGER,
      fire_result   TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- The dispatcher's hot read: unfired rows ordered by when they're due.
    CREATE INDEX IF NOT EXISTS idx_sc_due
      ON scheduled_consequences(fired_at, fires_at)
      WHERE fired_at IS NULL;

    -- For "what did the world owe this player?" lookups.
    CREATE INDEX IF NOT EXISTS idx_sc_target
      ON scheduled_consequences(target_kind, target_id, fires_at);

    -- For "what cascades did this event spawn?" lookups.
    CREATE INDEX IF NOT EXISTS idx_sc_source
      ON scheduled_consequences(source_kind, source_id, created_at);
  `);
}

export function down(_db) { /* sqlite — keep on rollback */ }
