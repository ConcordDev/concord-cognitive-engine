// server/migrations/288_law.js
//
// Living Society — Phase 10: law, crime & jail-as-a-verb (F2P-safe).
//
// Never punish TIME — punish value, reputation, access. These tables hold the
// player wanted/notoriety rung (extending the NPC-only criminal_rep to players)
// and detentions (a short detain you can bribe out of / work off / break out of
// / get sprung from — jail as four new verbs, not dead time). Per-world.

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

export function up(db) {
  if (!tableExists(db, "player_wanted")) {
    db.exec(`
      CREATE TABLE player_wanted (
        user_id     TEXT NOT NULL,
        world_id    TEXT NOT NULL,
        wanted_level INTEGER NOT NULL DEFAULT 0,
        notoriety   INTEGER NOT NULL DEFAULT 0,
        last_crime_at INTEGER,
        updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (user_id, world_id)
      );
    `);
  }
  if (!tableExists(db, "player_detentions")) {
    db.exec(`
      CREATE TABLE player_detentions (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        world_id    TEXT NOT NULL,
        crime       TEXT NOT NULL,
        severity_tier INTEGER NOT NULL DEFAULT 1,
        bail_sparks INTEGER NOT NULL DEFAULT 0,
        labor_required INTEGER NOT NULL DEFAULT 0,
        labor_done  INTEGER NOT NULL DEFAULT 0,
        state       TEXT NOT NULL DEFAULT 'detained'
                      CHECK (state IN ('detained','bribed_out','worked_off','broke_out','sprung','served')),
        detained_at INTEGER NOT NULL DEFAULT (unixepoch()),
        released_at INTEGER,
        released_via TEXT
      );
      CREATE INDEX idx_detentions_user ON player_detentions(user_id, state);
    `);
  }
}

export function down(_db) {
  // forward-only
}
