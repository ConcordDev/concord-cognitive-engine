// server/migrations/101_player_inventory_world_scope.js
//
// Add world_id to player_inventory so a player's items follow them per
// world. Pre-this-migration, switching avatars+worlds left items behind
// because the table only had user_id; cross-world inventory queries
// returned the wrong slice (every world saw every world's items).
//
// Default for legacy rows: 'concordia-hub' — the canonical hub. Migration
// 098 already established 'concordia-hub' as the canonical hub id and
// reconciled all twelve world_id-bearing tables to that value, so legacy
// inventory rows are correctly attributed there.
//
// Append-only per CLAUDE.md invariant; previous migrations are untouched.

export function up(db) {
  // Idempotent: skip if column already exists (a re-apply against an
  // already-migrated DB shouldn't fail).
  const cols = db.prepare(`PRAGMA table_info(player_inventory)`).all().map(r => r.name);
  if (!cols.includes("world_id")) {
    db.exec(`ALTER TABLE player_inventory ADD COLUMN world_id TEXT NOT NULL DEFAULT 'concordia-hub'`);
  }

  // Composite index: every inventory query is scoped by (user_id, world_id),
  // so an index on the pair is the canonical lookup path. Old single-column
  // index on user_id is retained for legacy code paths that haven't been
  // updated yet (search for `WHERE user_id = ?` in inventory.js etc.).
  db.exec(`CREATE INDEX IF NOT EXISTS idx_player_inv_user_world ON player_inventory(user_id, world_id)`);

  // Item-id lookup also benefits from world scoping (different worlds
  // can have items with the same item_id — e.g. "iron_ore" in superhero
  // vs concordia is the same string but a different per-world resource).
  db.exec(`CREATE INDEX IF NOT EXISTS idx_player_inv_user_world_item ON player_inventory(user_id, world_id, item_id)`);
}

export function down(_db) {
  // SQLite < 3.35 can't DROP COLUMN. We leave the column on rollback —
  // the index can be dropped if needed by a follow-up migration.
}
