// users.display_name — public label preferred over the @handle.
// lookupUserIdentity already SELECTs this column and falls back to username
// when it is null. The column was missing, so that SELECT was schema drift
// and the preference never landed.

export function up(db) {
  const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols.includes("display_name")) {
    db.exec("ALTER TABLE users ADD COLUMN display_name TEXT");
  }
}

export function down() {
  // Additive column. Leaving it in place is safe if this migration is reverted.
}
