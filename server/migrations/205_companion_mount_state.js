// server/migrations/205_companion_mount_state.js
//
// Adds a per-companion 'mounted' boolean so the server has a canonical
// truth for which companion is currently being ridden by the owner.
// Mutually exclusive: only one mounted companion per user.

export function up(db) {
  const cols = db.prepare("PRAGMA table_info(player_companions)").all().map(c => c.name);
  if (!cols.includes("mounted")) {
    db.exec(`ALTER TABLE player_companions ADD COLUMN mounted INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.includes("mount_eligible")) {
    db.exec(`ALTER TABLE player_companions ADD COLUMN mount_eligible INTEGER NOT NULL DEFAULT 1`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_player_companions_mounted
           ON player_companions(owner_id, mounted)`);
}

export function down(_db) { /* sqlite — keep on rollback */ }
