// server/migrations/052_guild_persistence.js
// Persist guilds/organizations from in-memory to DB.
//
// NOTE (Phase 3.5.5 archival, May 2026):
//   `guilds` and `guild_members` are superseded by the orgs substrate
//   (organizations + faction subsystem). Zero SELECT references found
//   by cartographer. Idempotent CREATE preserved.
//   REPLACED_BY: orgs/factions tables (later migrations)
export function up(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS guilds (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        type        TEXT NOT NULL DEFAULT 'guild',
        description TEXT NOT NULL DEFAULT '',
        leader_id   TEXT,
        district_id TEXT,
        bank_sparks INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS guild_members (
        guild_id   TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        role       TEXT NOT NULL DEFAULT 'member',
        joined_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (guild_id, user_id),
        FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_guild_members_user ON guild_members(user_id)`);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }
}
