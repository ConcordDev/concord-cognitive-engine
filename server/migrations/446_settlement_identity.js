// server/migrations/446_settlement_identity.js
//
// Persistent megaworld — settlement identity / place chronicle.
// Extends mig 287. Does not replace it. Abandoned towns KEEP the row.

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function hasColumn(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (tableExists(db, "settlements")) {
    const cols = [
      ["status", "TEXT NOT NULL DEFAULT 'active'"],
      ["founded_at", "INTEGER"],
      ["abandoned_at", "INTEGER"],
      ["destroyed_at", "INTEGER"],
      ["former_names_json", "TEXT"],
      ["founders_json", "TEXT"],
      ["culture", "TEXT"],
      ["government", "TEXT"],
      ["population", "INTEGER"],
    ];
    for (const [name, spec] of cols) {
      if (!hasColumn(db, "settlements", name)) {
        db.exec(`ALTER TABLE settlements ADD COLUMN ${name} ${spec}`);
      }
    }
    try {
      db.exec(`UPDATE settlements SET founded_at = created_at WHERE founded_at IS NULL`);
    } catch { /* created_at absent on a stripped stub */ }
  }

  if (!tableExists(db, "settlement_chronicle")) {
    db.exec(`
      CREATE TABLE settlement_chronicle (
        id             TEXT PRIMARY KEY,
        settlement_id  TEXT NOT NULL,
        world_id       TEXT NOT NULL,
        kind           TEXT NOT NULL,
        dedupe_key     TEXT NOT NULL,
        title          TEXT NOT NULL,
        body           TEXT NOT NULL,
        actor_id       TEXT,
        year_idx       INTEGER,
        created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE (settlement_id, dedupe_key)
      );
      CREATE INDEX idx_stl_chr_place ON settlement_chronicle(settlement_id, created_at);
      CREATE INDEX idx_stl_chr_world ON settlement_chronicle(world_id, created_at);
    `);
  }
}

export function down(_db) {
  // forward-only
}
