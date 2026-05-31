// server/migrations/301_faction_wars.js
//
// Formalize the faction-war substrate into the migration ledger.
//
// lib/combat/faction-war.js is a complete, wired producer (spawnFactionWar /
// tickAllFactionWars / listActiveWars, ticked inline in governorTick; the
// FactionWarBanner + EmergentEventFeed consume faction-war:* events). But it
// created its tables lazily via an in-lib `ensureSchema()` CREATE IF NOT EXISTS,
// so they were never in the ledger — a Phase-F shard-write hazard and invisible
// to the schema-drift gate's PRAGMA ground truth. This migration creates the
// exact same shape up-front; the lib's idempotent CREATE IF NOT EXISTS then
// becomes a harmless no-op.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS faction_war_npcs (
      id           TEXT PRIMARY KEY,
      war_id       TEXT NOT NULL,
      event_id     TEXT,
      faction_id   TEXT NOT NULL,
      style_seed   TEXT NOT NULL DEFAULT '',
      spawned_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      health       REAL NOT NULL DEFAULT 100,
      alive        INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_faction_war_npcs_war ON faction_war_npcs(war_id, alive);

    CREATE TABLE IF NOT EXISTS faction_wars (
      id            TEXT PRIMARY KEY,
      event_id      TEXT,
      cityId        TEXT,
      side_a        TEXT NOT NULL,
      side_b        TEXT NOT NULL,
      side_a_wins   INTEGER NOT NULL DEFAULT 0,
      side_b_wins   INTEGER NOT NULL DEFAULT 0,
      started_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at      INTEGER,
      status        TEXT NOT NULL DEFAULT 'active'
    );
    CREATE INDEX IF NOT EXISTS idx_faction_wars_status ON faction_wars(status);
  `);
}

export function down(_db) {
  // forward-only
}
