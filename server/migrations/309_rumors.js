// server/migrations/309_rumors.js
//
// Slice-of-Life SL2 — gossip/rumor propagation. The drama engine has the
// CONTENT (secrets) but no PROPAGATION: secrets didn't seep NPC→NPC→NPC. These
// tables track an in-flight rumor as it spreads along the npc_relationships
// social graph (an independent-cascade contagion, engine N3); when it reaches
// enough carriers it surfaces a blackmail hook and/or a public-reputation hit.
// Append-only. Behind CONCORD_GOSSIP.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rumors (
      id             TEXT PRIMARY KEY,
      secret_id      TEXT NOT NULL,
      subject_kind   TEXT NOT NULL,            -- 'player' | 'npc'
      subject_id     TEXT NOT NULL,
      world_id       TEXT NOT NULL,
      origin_npc_id  TEXT,
      hops           INTEGER NOT NULL DEFAULT 0,
      reach          INTEGER NOT NULL DEFAULT 1, -- distinct NPCs who now know
      surfaced       INTEGER NOT NULL DEFAULT 0, -- 0 spreading | 1 went public
      created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      last_spread_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_rumors_world ON rumors(world_id, surfaced);
    CREATE TABLE IF NOT EXISTS rumor_carriers (
      rumor_id TEXT NOT NULL,
      npc_id   TEXT NOT NULL,
      PRIMARY KEY (rumor_id, npc_id)
    );
  `);
}
