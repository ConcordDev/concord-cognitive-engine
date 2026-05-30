// server/migrations/290_ideology.js
//
// Living Society — Phase 12: emergent ideology & NPCs-first politics.
//
// Factions carry prose values/fears but NO structured POSITION — and per-world
// political axes aren't authored. This phase persists a position vector so
// ideology becomes the RECRUITMENT ATTRACTOR for the Phase-5 movement engine
// (you recruit along shared position, not at random) and a hypocrisy gap
// (professed vs revealed strategy) a rival can expose.
//
//   - faction_ideology: a faction's professed position on its world's axes.
//   - ideology_alerts: faction-political-weather (echo-chamber / sweeping
//     position / hypocrisy) following the drift-monitor pattern.

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

export function up(db) {
  if (!tableExists(db, "faction_ideology")) {
    db.exec(`
      CREATE TABLE faction_ideology (
        faction_id  TEXT NOT NULL,
        world_id    TEXT NOT NULL,
        axes_json   TEXT NOT NULL,          -- { axis: position -1..1 } (professed)
        updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (faction_id, world_id)
      );
      CREATE INDEX idx_faction_ideology_world ON faction_ideology(world_id);
    `);
  }
  if (!tableExists(db, "ideology_alerts")) {
    db.exec(`
      CREATE TABLE ideology_alerts (
        id          TEXT PRIMARY KEY,
        world_id    TEXT NOT NULL,
        kind        TEXT NOT NULL,          -- echo_chamber | memetic_drift | goodhart_hypocrisy
        subject_id  TEXT NOT NULL,
        severity    TEXT NOT NULL DEFAULT 'warning',
        detail_json TEXT,
        created_at  INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX idx_ideology_alerts_world ON ideology_alerts(world_id, created_at);
    `);
  }
}

export function down(_db) {
  // forward-only
}
