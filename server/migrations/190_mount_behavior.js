// server/migrations/190_mount_behavior.js
//
// Phase U — substrate-driven loose mount behaviour.
//
// Loose mounts (player_companions where mount_eligible=1 AND deployed=0)
// need a current position + a behavior state so the mount-behavior
// heartbeat can drive wandering / fleeing / feeding ticks.

export function up(db) {
  for (const sql of [
    `ALTER TABLE player_companions ADD COLUMN behavior_state TEXT NOT NULL DEFAULT 'wandering'`,
    `ALTER TABLE player_companions ADD COLUMN pos_x REAL`,
    `ALTER TABLE player_companions ADD COLUMN pos_z REAL`,
    `ALTER TABLE player_companions ADD COLUMN behavior_updated_at INTEGER`,
  ]) {
    try { db.exec(sql); } catch (e) {
      if (!String(e?.message || e).toLowerCase().includes('duplicate column')) throw e;
    }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_companions_behavior ON player_companions(behavior_state, deployed)`);
}

export function down(_db) { /* forward-only */ }
