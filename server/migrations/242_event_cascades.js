// server/migrations/242_event_cascades.js
//
// Phase BD3 — event cascades (parent/child quest linkage).
//
// GW2 pattern: event A's outcome spawns event B. Today every procgen
// quest is isolated. This adds:
//   - cascade_definitions: authored chains (parent_event_id →
//     {onSuccess, onFailure})
//   - lattice_born_quests.parent_quest_id + cascade_chain (lineage)
//   - cascade_spawns: idempotent log of (parent, outcome) → spawned

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cascade_definitions (
      parent_event_id     TEXT PRIMARY KEY,
      on_success          TEXT,
      on_failure          TEXT,
      max_depth           INTEGER NOT NULL DEFAULT 10,
      content_pack        TEXT
    );
    CREATE TABLE IF NOT EXISTS cascade_spawns (
      parent_event_id     TEXT NOT NULL,
      outcome             TEXT NOT NULL CHECK (outcome IN ('success','failure')),
      spawned_quest_id    TEXT NOT NULL,
      depth               INTEGER NOT NULL DEFAULT 1,
      spawned_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (parent_event_id, outcome)
    );
  `);

  // ALTER lattice_born_quests + world_events for lineage. Best-effort.
  try {
    const cols = db.prepare(`PRAGMA table_info(lattice_born_quests)`).all().map(c => c.name);
    if (!cols.includes("parent_quest_id")) {
      db.exec(`ALTER TABLE lattice_born_quests ADD COLUMN parent_quest_id TEXT`);
    }
    if (!cols.includes("cascade_chain")) {
      db.exec(`ALTER TABLE lattice_born_quests ADD COLUMN cascade_chain TEXT`);
    }
    if (!cols.includes("cascade_depth")) {
      db.exec(`ALTER TABLE lattice_born_quests ADD COLUMN cascade_depth INTEGER DEFAULT 0`);
    }
  } catch { /* table missing on minimal build */ }
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS cascade_spawns;
    DROP TABLE IF EXISTS cascade_definitions;
  `);
}
