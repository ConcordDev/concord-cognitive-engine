// server/migrations/315_missing_tables_repair.js
//
// Schema-drift repair (Vael's Expedition rounds 2–3 ghost-table cluster):
// a set of tables that feature code SELECTs/INSERTs but that exist in NO
// migration (and, per the round-6 fresh-DB audit, are genuinely never created
// anywhere) — so every query against them throws `no such table` at runtime.
//
// These were renamed/consolidated away or simply never migrated. This migration
// creates them with the exact shape the live queries expect (columns derived
// directly from each query's SELECT list / INSERT column list), so the features
// degrade gracefully (empty result) instead of crashing, and the schema ledger
// becomes the source of truth (closes the round-6 #F1 read-before-create hazard
// for these tables). `IF NOT EXISTS` so it's idempotent against any code path
// that also lazily creates them.
//
// NOTE: several of these tables have no writer yet (e.g. npc_relations,
// authored_npcs) — their owning features stay dormant-but-safe until a writer
// is wired. That's the same end-state as today (caught crash → empty), minus the
// crash. The companion redirects (city_presence→world_npcs, the money-ledger
// rewrites) live outside this migration; see docs/PLAYTEST_FINDINGS_PLAN.md.

export function up(db) {
  db.exec(`
    -- world happenings feed (goddess / chronicle / uprising / vassalage / feed)
    CREATE TABLE IF NOT EXISTS world_events (
      id          TEXT PRIMARY KEY,
      world_id    TEXT,
      event_type  TEXT,
      kind        TEXT,
      title       TEXT,
      description TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_world_events_world ON world_events(world_id, created_at);

    -- per-user external messaging handles
    CREATE TABLE IF NOT EXISTS messaging_adapters (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      platform     TEXT,
      handle       TEXT,
      is_default   INTEGER NOT NULL DEFAULT 0,
      connected_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_messaging_adapters_user ON messaging_adapters(user_id);

    -- auto-governance proposals (auto-proposal.js)
    CREATE TABLE IF NOT EXISTS council_proposals (
      id         TEXT PRIMARY KEY,
      title      TEXT,
      body       TEXT,
      status     TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- player quest headers (guidance-waypoint)
    CREATE TABLE IF NOT EXISTS quest_state (
      id              TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      world_id        TEXT NOT NULL,
      title           TEXT,
      objectives_json TEXT,
      status          TEXT NOT NULL DEFAULT 'active',
      started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, world_id, id)
    );

    -- per-(user,world,quest) progress (forward-sim, tutorial-first-cycle)
    CREATE TABLE IF NOT EXISTS quest_progress (
      user_id      TEXT NOT NULL,
      world_id     TEXT NOT NULL,
      quest_id     TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'active',
      completed_at INTEGER,
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, world_id, quest_id)
    );

    -- player ↔ faction membership (forward-sim faction prediction)
    CREATE TABLE IF NOT EXISTS faction_members (
      user_id    TEXT NOT NULL,
      faction_id TEXT NOT NULL,
      joined_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, faction_id)
    );

    -- per-user skill levels (crisis skill check)
    CREATE TABLE IF NOT EXISTS user_skills (
      user_id  TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      level    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, skill_id)
    );

    -- lattice cross-domain synthesis feed (patterns lens)
    CREATE TABLE IF NOT EXISTS cross_domain_breakthroughs (
      id         TEXT PRIMARY KEY,
      theme      TEXT,
      summary    TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- federation pulse feed (patterns lens)
    CREATE TABLE IF NOT EXISTS cnet_federation_pulse (
      id              TEXT PRIMARY KEY,
      kind            TEXT,
      payload_summary TEXT,
      ts              INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- merit/credit score gate (global-gates)
    CREATE TABLE IF NOT EXISTS economy_balances (
      user_id TEXT PRIMARY KEY,
      balance REAL NOT NULL DEFAULT 0
    );

    -- per-(user,domain) reputation score (analytics)
    CREATE TABLE IF NOT EXISTS user_reputation (
      user_id TEXT NOT NULL,
      domain  TEXT NOT NULL,
      score   REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, domain)
    );

    -- daily login streak (analytics)
    CREATE TABLE IF NOT EXISTS user_login_streak (
      user_id TEXT PRIMARY KEY,
      streak  INTEGER NOT NULL DEFAULT 0
    );

    -- coarse player position by city (anomaly-queue join)
    CREATE TABLE IF NOT EXISTS player_position (
      user_id    TEXT PRIMARY KEY,
      city_id    TEXT,
      x          REAL,
      y          REAL,
      z          REAL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- social posts (GDPR account-data export)
    CREATE TABLE IF NOT EXISTS social_posts (
      id         TEXT PRIMARY KEY,
      user_id    TEXT,
      author_id  TEXT,
      content    TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- direct messages (GDPR account-data export)
    CREATE TABLE IF NOT EXISTS direct_messages (
      id           TEXT PRIMARY KEY,
      sender_id    TEXT,
      recipient_id TEXT,
      content      TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- emergent characters (world-emergents seeding)
    CREATE TABLE IF NOT EXISTS emergents (
      id               TEXT PRIMARY KEY,
      name             TEXT,
      archetype        TEXT,
      personality_json TEXT,
      world_id         TEXT,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- npc kinship/relationship edges (npc-legacy heir lookup, spouse reactivity).
    -- Carries both naming conventions the readers use (related_to / related_npc_id).
    CREATE TABLE IF NOT EXISTS npc_relations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      npc_id          TEXT NOT NULL,
      related_npc_id  TEXT,
      related_to      TEXT,
      relation_kind   TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_npc_relations_npc ON npc_relations(npc_id);
    CREATE INDEX IF NOT EXISTS idx_npc_relations_related ON npc_relations(related_to);

    -- authored NPC roster lookup (nemesis name resolve, perception snapshot)
    CREATE TABLE IF NOT EXISTS authored_npcs (
      id         TEXT PRIMARY KEY,
      name       TEXT,
      faction_id TEXT,
      world_id   TEXT,
      x          REAL,
      y          REAL,
      z          REAL
    );
    CREATE INDEX IF NOT EXISTS idx_authored_npcs_world ON authored_npcs(world_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS world_events;
    DROP TABLE IF EXISTS messaging_adapters;
    DROP TABLE IF EXISTS council_proposals;
    DROP TABLE IF EXISTS quest_state;
    DROP TABLE IF EXISTS quest_progress;
    DROP TABLE IF EXISTS faction_members;
    DROP TABLE IF EXISTS user_skills;
    DROP TABLE IF EXISTS cross_domain_breakthroughs;
    DROP TABLE IF EXISTS cnet_federation_pulse;
    DROP TABLE IF EXISTS economy_balances;
    DROP TABLE IF EXISTS user_reputation;
    DROP TABLE IF EXISTS user_login_streak;
    DROP TABLE IF EXISTS player_position;
    DROP TABLE IF EXISTS social_posts;
    DROP TABLE IF EXISTS direct_messages;
    DROP TABLE IF EXISTS emergents;
    DROP TABLE IF EXISTS npc_relations;
    DROP TABLE IF EXISTS authored_npcs;
  `);
}
