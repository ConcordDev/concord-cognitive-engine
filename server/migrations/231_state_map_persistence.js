// server/migrations/231_state_map_persistence.js
//
// Smoking-gun cleanup sprint 2 — three STATE Map → DB swaps:
//   C2 STATE.gameProfiles    — players reset to level 1 every restart
//   C3 STATE.customPersonas  — user LLM personas vanish every restart
//   C4 STATE.councilProposals — governance votes interrupted mid-flight
//
// Same playbook as migrations 229 / 230 (council_dtu_votes,
// marketplace_dtu_listings). Each table matches the in-memory shape
// so swapping the Map for DB hydration is mechanical.

export function up(db) {
  // ─── C2. game_profiles ─────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_profiles (
      user_id           TEXT PRIMARY KEY,
      xp                INTEGER NOT NULL DEFAULT 0,
      level             INTEGER NOT NULL DEFAULT 1,
      badges_json       TEXT NOT NULL DEFAULT '[]',
      streak            INTEGER NOT NULL DEFAULT 0,
      last_activity_at  TEXT,                              -- ISO timestamp string (matches in-memory shape)
      quests_completed  INTEGER NOT NULL DEFAULT 0,
      concord_coin      REAL NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_gprof_xp_level ON game_profiles(xp DESC, level DESC);
  `);

  // ─── C3. custom_personas ───────────────────────────────────────
  //
  // Distinct from migration 223's chat_personas (which is per-owner,
  // brain-slot-aware, marketplace-publishable). customPersonas is the
  // older system-wide persona system with the 5-axis style vector
  // (verbosity/formality/skepticism/creativity/empathy) and free-form
  // traits array. Keeping it separate preserves the existing macro
  // contract; consolidation can happen later.
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_personas (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      style_json      TEXT NOT NULL DEFAULT '{}',         -- {verbosity,formality,skepticism,creativity,empathy} each 0..1
      traits_json     TEXT NOT NULL DEFAULT '[]',
      system_prompt   TEXT NOT NULL DEFAULT '',
      usage_count     INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL,                       -- ISO timestamp (matches in-memory)
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cpersonas_name ON custom_personas(name);
  `);

  // ─── C4. council_proposals ─────────────────────────────────────
  //
  // 7-day governance window per server.js:42104. Status ladder
  // pending → approved → rejected (+ implicit `expired` after the
  // window). votes_json stores {userId: 'approve'|'reject'} dict.
  db.exec(`
    CREATE TABLE IF NOT EXISTS council_proposals (
      id              TEXT PRIMARY KEY,
      type            TEXT NOT NULL DEFAULT 'promotion_to_global',
      dtu_id          TEXT NOT NULL,
      proposed_by     TEXT NOT NULL,
      reason          TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','expired')),
      votes_json      TEXT NOT NULL DEFAULT '{}',
      global_dtu_id   TEXT,                                -- set when approved (promoted DTU id)
      created_at      TEXT NOT NULL,                       -- ISO timestamp
      expires_at      TEXT NOT NULL,                       -- ISO timestamp (7-day window)
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_cprop_status   ON council_proposals(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cprop_dtu      ON council_proposals(dtu_id);
    CREATE INDEX IF NOT EXISTS idx_cprop_expires  ON council_proposals(expires_at) WHERE status = 'pending';
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS council_proposals;
    DROP TABLE IF EXISTS custom_personas;
    DROP TABLE IF EXISTS game_profiles;
  `);
}
