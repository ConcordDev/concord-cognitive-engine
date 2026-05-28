// server/migrations/213_world_platform.js
//
// Phases Q + R + S + T — world platform substrate.
//
// Q (UGC worlds): ugc_worlds tracks user-authored sub-worlds. Each entry
//   points at a content/world/<slug>/ directory and carries authorship +
//   moderation state. The directory still uses the JSON-triplet pattern
//   so it's auto-picked-up by discoverSubWorlds().
//
// R (world marketplace): world_tenancies + world_tenant_members let
//   users lease a copy of a world as a private tenant (LARP groups,
//   classrooms, companies). Per-tenant world_id namespace; shared
//   substrate. Membership roles + payment ledger.
//
// S (real-money tournaments): tournaments + tournament_entries +
//   tournament_matches let any world run scheduled PvP / league / heist
//   competitions. Buy-in feeds the prize pool; placement distributes via
//   tournament-specific cascade (not the standard royalty path).
//
// T (AI residents): ai_residents lets users deploy autonomous agents
//   into a world via the existing agent_marathon_sessions substrate.
//   Each resident is an NPC + a marathon session + an intent DTU.
//
// All tables are world-scoped (world_id columns) so they slot into the
// Phase F write-ownership rules already documented.

export function up(db) {
  // ── Q — UGC worlds ─────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS ugc_worlds (
      world_id          TEXT PRIMARY KEY,
      author_user_id    TEXT NOT NULL,
      directory_slug    TEXT NOT NULL UNIQUE,
      title             TEXT NOT NULL,
      description       TEXT,
      published_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      status            TEXT NOT NULL DEFAULT 'active' CHECK (
                          status IN ('pending', 'active', 'rejected', 'removed')
                        ),
      moderation_notes  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ugc_worlds_author ON ugc_worlds(author_user_id);
    CREATE INDEX IF NOT EXISTS idx_ugc_worlds_status ON ugc_worlds(status, published_at);
  `);

  // ── R — World tenancies (lease-a-world) ────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_tenancies (
      tenant_world_id   TEXT PRIMARY KEY,
      base_world_id     TEXT NOT NULL,
      owner_user_id     TEXT NOT NULL,
      plan              TEXT NOT NULL CHECK (plan IN ('private', 'public', 'public-read')),
      leased_until      INTEGER NOT NULL,
      cc_paid           REAL NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_world_tenancies_owner ON world_tenancies(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_world_tenancies_base ON world_tenancies(base_world_id);
    CREATE INDEX IF NOT EXISTS idx_world_tenancies_expiry ON world_tenancies(leased_until);

    CREATE TABLE IF NOT EXISTS world_tenant_members (
      tenant_world_id   TEXT NOT NULL,
      user_id           TEXT NOT NULL,
      role              TEXT NOT NULL CHECK (role IN ('owner','admin','member','spectator')),
      joined_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (tenant_world_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_world_tenant_members_user ON world_tenant_members(user_id);
  `);

  // ── S — Tournaments ────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id                TEXT PRIMARY KEY,
      world_id          TEXT NOT NULL,
      kind              TEXT NOT NULL CHECK (kind IN ('pvp','league','heist','custom')),
      title             TEXT NOT NULL,
      buyin_cc          REAL NOT NULL DEFAULT 0,
      prize_pool_cc     REAL NOT NULL DEFAULT 0,
      starts_at         INTEGER NOT NULL,
      ends_at           INTEGER,
      status            TEXT NOT NULL DEFAULT 'open' CHECK (
                          status IN ('open','running','complete','cancelled')
                        ),
      ruleset_dtu_id    TEXT,
      organizer_user_id TEXT,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_tournaments_world ON tournaments(world_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status, starts_at);

    CREATE TABLE IF NOT EXISTS tournament_entries (
      tournament_id     TEXT NOT NULL,
      user_id           TEXT NOT NULL,
      registered_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      eliminated_at     INTEGER,
      placement         INTEGER,
      PRIMARY KEY (tournament_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tournament_entries_user ON tournament_entries(user_id);
    CREATE INDEX IF NOT EXISTS idx_tournament_entries_placement ON tournament_entries(tournament_id, placement);

    CREATE TABLE IF NOT EXISTS tournament_matches (
      id                TEXT PRIMARY KEY,
      tournament_id     TEXT NOT NULL,
      round             INTEGER NOT NULL,
      players_json      TEXT NOT NULL DEFAULT '[]',
      winner_user_id    TEXT,
      replay_dtu_id     TEXT,
      played_at         INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tournament_matches_tour ON tournament_matches(tournament_id, round);
  `);

  // ── T — AI residents ───────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_residents (
      npc_id              TEXT PRIMARY KEY,
      owner_user_id       TEXT NOT NULL,
      marathon_session_id TEXT,
      world_id            TEXT NOT NULL,
      intent_dtu_id       TEXT,
      current_status_json TEXT DEFAULT '{}',
      deployed_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      paused_at           INTEGER,
      recalled_at         INTEGER,
      deposit_cc          REAL NOT NULL DEFAULT 0,
      earnings_cc         REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ai_residents_owner ON ai_residents(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_ai_residents_world ON ai_residents(world_id);
    CREATE INDEX IF NOT EXISTS idx_ai_residents_marathon ON ai_residents(marathon_session_id);
  `);
}

export function down(db) {
  try { db.exec(`DROP TABLE IF EXISTS ai_residents;`); } catch { /* idempotent */ }
  try { db.exec(`DROP TABLE IF EXISTS tournament_matches;`); } catch { /* idempotent */ }
  try { db.exec(`DROP TABLE IF EXISTS tournament_entries;`); } catch { /* idempotent */ }
  try { db.exec(`DROP TABLE IF EXISTS tournaments;`); } catch { /* idempotent */ }
  try { db.exec(`DROP TABLE IF EXISTS world_tenant_members;`); } catch { /* idempotent */ }
  try { db.exec(`DROP TABLE IF EXISTS world_tenancies;`); } catch { /* idempotent */ }
  try { db.exec(`DROP TABLE IF EXISTS ugc_worlds;`); } catch { /* idempotent */ }
}
