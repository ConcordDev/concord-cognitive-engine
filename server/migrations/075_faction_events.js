// server/migrations/075_faction_events.js
// Tier 3 deferral 12 — faction event scheduler (hybrid existing-lore).
// Tracks which authored lore events have rolled in which worlds, with
// cooldowns so the same event doesn't fire twice in a row.

export function up(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS faction_events_scheduled (
        id           TEXT PRIMARY KEY,
        template_id  TEXT NOT NULL,
        world_id     TEXT NOT NULL,
        factions_json TEXT NOT NULL DEFAULT '[]',
        status       TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'ended', 'cancelled')),
        title        TEXT,
        description  TEXT,
        started_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        ends_at      INTEGER NOT NULL,
        ended_at     INTEGER
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_faction_events_world ON faction_events_scheduled(world_id, status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_faction_events_template ON faction_events_scheduled(template_id, world_id, started_at DESC)`);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }
}
