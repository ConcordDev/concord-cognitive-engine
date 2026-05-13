// server/migrations/179_tunyan_jobs.js
//
// Concordia Phase 10 — Tunyan jobs catalog + ration entitlements +
// player employment ledger.
//
// Three tables:
//
//   tunyan_jobs — authored catalog of named Tunyan occupations.
//     Each job: archetype, base wage in Sparks per shift, risk_pct,
//     skill requirements (best-effort).
//
//   ration_entitlements — keyed by demographic (unemployed, pregnant,
//     child, elderly, employed_baseline). Monthly Sparks the policy
//     guarantees. Per the player-experience spec: pre-policy-change
//     Tunya = 25 for unemployed, 100 for pregnant.
//
//   player_employment — per-(user, world) current job + last shift
//     timestamp. Used by the ration-floor heartbeat to determine
//     which ration tier the player qualifies for.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tunyan_jobs (
      id              TEXT    PRIMARY KEY,
      name            TEXT    NOT NULL,
      archetype       TEXT    NOT NULL,
      wage_sparks     INTEGER NOT NULL CHECK (wage_sparks >= 0),
      shift_hours     INTEGER NOT NULL DEFAULT 6 CHECK (shift_hours BETWEEN 1 AND 24),
      risk_pct        INTEGER NOT NULL DEFAULT 0 CHECK (risk_pct BETWEEN 0 AND 100),
      location_hint   TEXT,
      skill_required  TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ration_entitlements (
      demographic_kind TEXT PRIMARY KEY,
      monthly_sparks   INTEGER NOT NULL CHECK (monthly_sparks >= 0),
      description      TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS player_employment (
      user_id          TEXT    NOT NULL,
      world_id         TEXT    NOT NULL DEFAULT 'concordia-hub',
      job_id           TEXT,
      demographic_kind TEXT    NOT NULL DEFAULT 'unemployed',
      employed_at      INTEGER,
      last_shift_at    INTEGER,
      shifts_completed INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, world_id)
    )
  `);

  // Seed the 7 named Tunyan jobs.
  const insertJob = db.prepare(`
    INSERT INTO tunyan_jobs (id, name, archetype, wage_sparks, shift_hours, risk_pct, location_hint, skill_required)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  insertJob.run("job_fisherman",  "Fisherman",   "fisherman",   18, 8, 12, "coast",   "fishing");
  insertJob.run("job_vendor",     "Vendor",      "trader",      15, 8,  3, "market",  "trading");
  insertJob.run("job_captain",    "Boat Captain","fisherman",   30, 8, 18, "harbor",  "sailing");
  insertJob.run("job_miner",      "Miner",       "miner",       22, 8, 22, "quarry",  "mining");
  insertJob.run("job_clerk",      "Clerk",       "scholar",     14, 6,  1, "registrar","writing");
  insertJob.run("job_midwife",    "Midwife",     "healer",      20, 8,  4, "village", "medicine");
  insertJob.run("job_alchemist",  "Alchemist",   "mystic",      24, 6,  6, "stillroom","alchemy");

  // Seed ration entitlements.
  const insertRation = db.prepare(`
    INSERT INTO ration_entitlements (demographic_kind, monthly_sparks, description)
    VALUES (?, ?, ?)
    ON CONFLICT(demographic_kind) DO NOTHING
  `);
  insertRation.run("unemployed",        25, "pre-policy-change Tunyan unemployment ration");
  insertRation.run("pregnant",         100, "expecting mother — full ration");
  insertRation.run("child",             40, "under-12 ration");
  insertRation.run("elderly",           50, "elder ration");
  insertRation.run("employed_baseline",  0, "wages are the floor; no additional ration");
}

export function down(_db) {
  // Forward-only.
}
