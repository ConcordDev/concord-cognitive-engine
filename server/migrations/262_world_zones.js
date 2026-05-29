// server/migrations/262_world_zones.js
//
// T3.3 — world zones.
//
// Until now the only spatial combat rule was a hardcoded
// `worldId === 'concordia-hub'` safe-zone check. There was no way to carve a
// sanctuary out of a dangerous world, mark a lawless district where crime goes
// unpunished, or designate a hazard field that hurts anyone standing in it.
//
// world_zones is a circular region in a world with a `kind` that governs the
// combat/environment rules inside it:
//   safe       — no combat (same refusal as the hub, but per-region)
//   sanctuary  — safe + a small regen / no-aggro bonus (towns, temples)
//   pvp        — player-vs-player explicitly enabled (otherwise PvP is off)
//   lawless    — combat allowed AND crimes here don't accrue reputation/witness
//   hazard     — periodic environmental damage to anyone inside (lava, blight)
//
// rules_json carries per-kind tunables (e.g. hazard dps, element, sanctuary
// regen). zoneAt resolves the *smallest* containing zone so a sanctuary inside
// a hazard field wins.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_zones (
      id            TEXT PRIMARY KEY,
      world_id      TEXT NOT NULL,
      name          TEXT NOT NULL,
      kind          TEXT NOT NULL
                     CHECK (kind IN ('safe','sanctuary','pvp','lawless','hazard')),
      center_x      REAL NOT NULL DEFAULT 0,
      center_z      REAL NOT NULL DEFAULT 0,
      radius_m      REAL NOT NULL DEFAULT 50,
      rules_json    TEXT NOT NULL DEFAULT '{}',
      created_by    TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE (world_id, name)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_world_zones_world ON world_zones(world_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_world_zones_kind  ON world_zones(world_id, kind);`);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS world_zones;`);
}
