// server/migrations/318_npc_captures.js
//
// Temperament P5 — the capture/transport economy. P4 gave combat a third outcome
// (downed/surrendered = hors de combat, can't be executed). This is where a
// captor does something WITH that body other than walk away: bind it, carry it,
// load it onto a mount/vehicle, haul it, and deliver it to jail (arrest) or for
// ransom. One row per capture tracks the whole chain.
//
//   stage         : captured → carried → loaded → transported → delivered
//                   (terminal: delivered | released | escaped)
//   carrier_kind  : 'self' | 'mount' | 'vehicle'   (what's hauling the captive)
//   destination   : 'jail' | 'ransom' | null
//   ransom        : CC owed on a ransom delivery (paid out by the caller, guarded)
//
// IF NOT EXISTS for idempotency. Off (CONCORD_TEMPERAMENT) nothing writes here.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_captures (
      id            TEXT PRIMARY KEY,
      npc_id        TEXT NOT NULL,
      captor_id     TEXT NOT NULL,
      world_id      TEXT NOT NULL,
      stage         TEXT NOT NULL DEFAULT 'captured'
                    CHECK (stage IN ('captured','carried','loaded','transported','delivered','released','escaped')),
      carrier_kind  TEXT NOT NULL DEFAULT 'self'
                    CHECK (carrier_kind IN ('self','mount','vehicle')),
      carrier_id    TEXT,
      destination   TEXT CHECK (destination IN ('jail','ransom') OR destination IS NULL),
      ransom        REAL NOT NULL DEFAULT 0,
      captured_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      delivered_at  INTEGER,
      ended_reason  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_npc_captures_captor ON npc_captures(captor_id, stage);
    CREATE INDEX IF NOT EXISTS idx_npc_captures_npc ON npc_captures(npc_id);
    CREATE INDEX IF NOT EXISTS idx_npc_captures_world_active ON npc_captures(world_id, stage);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS npc_captures;`);
}
