// server/migrations/383_world_organizations.js
//
// Guild/crew durability fix (grounding audit, V1.2 Wave D).
//
// `server/lib/world-organizations.js` — the player-facing guild/crew
// system — stored every organization + its roster in a module-scope
// `LruMap`. A player-formed guild vanished the instant the server process
// restarted. That's inconsistent with the authored-faction "realm" system
// (migration 158_kingdoms.js, table `realms`), which IS durable. Player-
// created institutions should be the same durability class as authored
// ones.
//
// There's already a DB-backed companion, `org_progression` (migration
// 238_guild_substrate.js, keyed by `org_id` TEXT with no formal FK), built
// for guild XP/bank/hall state. That table was already durable — it just
// pointed at ids that themselves only lived in memory. This migration adds
// the missing durable base: `world_organizations` (the org row itself) and
// `org_members` (the roster). The id format world-organizations.js already
// generates (`org_<ts36>_<uuid8>`) is unchanged, so every existing
// `org_progression` row (and anything else keyed by an org id) continues
// to resolve correctly — no data migration needed, no id remap.
//
// `org_members.role` mirrors the exact MEMBER_ROLES vocabulary
// world-organizations.js already defines: leader / officer / member /
// apprentice.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_organizations (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL,
      type               TEXT NOT NULL DEFAULT 'guild',
      description        TEXT NOT NULL DEFAULT '',
      leader_id          TEXT NOT NULL,
      district_id        TEXT,
      purpose            TEXT NOT NULL DEFAULT '',
      recruit_criteria   TEXT NOT NULL DEFAULT 'open',
      revenue_split_json TEXT NOT NULL DEFAULT '{}',
      treasury           REAL NOT NULL DEFAULT 0,
      dtu_count          INTEGER NOT NULL DEFAULT 0,
      headquarters_json  TEXT NOT NULL DEFAULT '{}',
      stats_json         TEXT NOT NULL DEFAULT '{}',
      created_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_world_organizations_type ON world_organizations(type);
    CREATE INDEX IF NOT EXISTS idx_world_organizations_district ON world_organizations(district_id);
    CREATE INDEX IF NOT EXISTS idx_world_organizations_leader ON world_organizations(leader_id);

    CREATE TABLE IF NOT EXISTS org_members (
      org_id    TEXT NOT NULL,
      user_id   TEXT NOT NULL,
      role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader','officer','member','apprentice')),
      joined_at TEXT NOT NULL,
      PRIMARY KEY (org_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_org_members_user;
    DROP TABLE IF EXISTS org_members;
    DROP INDEX IF EXISTS idx_world_organizations_leader;
    DROP INDEX IF EXISTS idx_world_organizations_district;
    DROP INDEX IF EXISTS idx_world_organizations_type;
    DROP TABLE IF EXISTS world_organizations;
  `);
}
