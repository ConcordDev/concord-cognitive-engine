// server/migrations/065_crime_and_jobs.js
// Crime events, evidence, NPC jobs, schedules, and access control infrastructure.

export function up(db) {
  // ── Add home + job columns to world_npcs ─────────────────────────────────
  const npcCols = db.prepare('PRAGMA table_info(world_npcs)').all().map(c => c.name);
  const npcNew = [
    ['home_building_id', 'TEXT'],
    ['home_room_id',     'TEXT'],
    ['job_type',         'TEXT DEFAULT \'generic\''],
    ['job_location_id',  'TEXT'],  // building_id where they work
    ['job_room_id',      'TEXT'],  // room_id where they work
    ['schedule_phase',   'TEXT DEFAULT \'day\''],  // 'morning'|'day'|'evening'|'night'
    ['grief_level',      'REAL DEFAULT 0'],
    ['criminal_rep',     'REAL DEFAULT 0'],  // 0=law-abiding, 1=notorious criminal
    ['bounty',           'INTEGER DEFAULT 0'],
    ['is_wanted',        'INTEGER DEFAULT 0'],
    ['current_task',     'TEXT'],  // JSON: { type, target_id, started_at, progress }
  ];
  for (const [col, def] of npcNew) {
    if (!npcCols.includes(col)) db.exec(`ALTER TABLE world_npcs ADD COLUMN ${col} ${def}`);
  }

  // ── Add access-control columns to building_rooms ─────────────────────────
  // (building_rooms may not exist yet if migration 064 hasn't run — guard idempotently)
  try {
    const roomCols = db.prepare('PRAGMA table_info(building_rooms)').all().map(c => c.name);
    const roomNew = [
      ['lock_tier',    'INTEGER DEFAULT 0'],  // 0=unlocked, 1-5 lock difficulty
      ['lock_state',   'TEXT DEFAULT \'locked\''],  // 'locked'|'picked'|'broken'|'open'
      ['last_breach',  'INTEGER'],
    ];
    for (const [col, def] of roomNew) {
      if (!roomCols.includes(col)) db.exec(`ALTER TABLE building_rooms ADD COLUMN ${col} ${def}`);
    }
  } catch { /* table not created yet — migration 064 will add it */ }

  // ── Add access-control to world_buildings ────────────────────────────────
  try {
    const bldCols = db.prepare('PRAGMA table_info(world_buildings)').all().map(c => c.name);
    const bldNew = [
      ['lock_tier',    'INTEGER DEFAULT 0'],
      ['is_open',      'INTEGER DEFAULT 1'],  // 0=locked building, 1=openly accessible
      ['last_breach',  'INTEGER'],
    ];
    for (const [col, def] of bldNew) {
      if (!bldCols.includes(col)) db.exec(`ALTER TABLE world_buildings ADD COLUMN ${col} ${def}`);
    }
  } catch { /* table may not exist yet */ }

  // ── crime_events — every illegal act generates a record ───────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS crime_events (
      id              TEXT PRIMARY KEY,
      world_id        TEXT NOT NULL,
      crime_type      TEXT NOT NULL,  -- 'break_in'|'theft'|'assault'|'murder'|'vandalism'|'trespass'
      location_type   TEXT NOT NULL DEFAULT 'building',  -- 'building'|'room'|'world'
      location_id     TEXT NOT NULL,  -- building_id or room_id
      criminal_id     TEXT,           -- null until solved
      criminal_type   TEXT,           -- 'player'|'npc'
      victim_id       TEXT,
      victim_type     TEXT,
      evidence        TEXT NOT NULL DEFAULT '[]',  -- JSON array of evidence objects
      witnesses       TEXT NOT NULL DEFAULT '[]',  -- JSON array of witness NPC ids
      status          TEXT NOT NULL DEFAULT 'open', -- 'open'|'solved'|'closed'|'unsolved'
      detective_id    TEXT,           -- NPC detective assigned
      suspect_ids     TEXT DEFAULT '[]',
      confidence      REAL DEFAULT 0, -- 0-1 how certain detective is of culprit
      stolen_items    TEXT DEFAULT '[]',  -- JSON [{item_id,item_name,quantity}]
      occurred_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at     INTEGER,
      report_text     TEXT            -- detective's written report (DTU eventually)
    );
    CREATE INDEX IF NOT EXISTS idx_crime_world ON crime_events(world_id, status, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crime_location ON crime_events(location_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crime_criminal ON crime_events(criminal_id);
  `);

  // ── evidence_items — individual clues found at crime scenes ───────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_items (
      id              TEXT PRIMARY KEY,
      crime_event_id  TEXT NOT NULL,
      world_id        TEXT NOT NULL,
      evidence_type   TEXT NOT NULL,  -- 'footprint'|'broken_lock'|'blood'|'magical_residue'|'stolen_item_trace'|'witness_account'|'item_left_behind'
      description     TEXT NOT NULL,
      links_to_id     TEXT,           -- NPC/player id this evidence points to
      links_to_type   TEXT,           -- 'npc'|'player'
      confidence_boost REAL DEFAULT 0.1,  -- how much this clue helps identify criminal
      collected_by    TEXT,           -- detective npc_id who collected this
      collected_at    INTEGER,
      decay_at        INTEGER,        -- when this evidence disappears (footprints fade)
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (crime_event_id) REFERENCES crime_events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_crime ON evidence_items(crime_event_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_world ON evidence_items(world_id, collected_by);
  `);

  // ── npc_jobs — structured job assignments for each NPC ───────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_jobs (
      id              TEXT PRIMARY KEY,
      npc_id          TEXT NOT NULL UNIQUE,
      world_id        TEXT NOT NULL,
      job_type        TEXT NOT NULL,  -- see JOB_TYPES in npc-jobs.js
      employer_id     TEXT,           -- building owner / faction / null=self-employed
      work_building_id TEXT,
      work_room_id    TEXT,
      wage_per_tick   INTEGER DEFAULT 0,
      schedule        TEXT NOT NULL DEFAULT '{}',  -- JSON: { morning, day, evening, night } → task
      current_task    TEXT DEFAULT '{}',
      tasks_completed INTEGER DEFAULT 0,
      last_clocked_in INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (npc_id) REFERENCES world_npcs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_npc_jobs_world ON npc_jobs(world_id);
    CREATE INDEX IF NOT EXISTS idx_npc_jobs_building ON npc_jobs(work_building_id);
  `);

  // ── NPC opinion / social relationship tables ──────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_opinions (
      id           TEXT PRIMARY KEY,
      subject_id   TEXT NOT NULL,
      subject_type TEXT NOT NULL DEFAULT 'npc',
      target_id    TEXT NOT NULL,
      target_type  TEXT NOT NULL DEFAULT 'player',
      opinion      REAL NOT NULL DEFAULT 0,
      respect      REAL NOT NULL DEFAULT 0,
      fear         REAL NOT NULL DEFAULT 0,
      trust        REAL NOT NULL DEFAULT 0,
      last_event   TEXT,
      last_updated INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(subject_id, target_id)
    );
    CREATE INDEX IF NOT EXISTS idx_opinions_subject ON npc_opinions(subject_id);
    CREATE INDEX IF NOT EXISTS idx_opinions_target  ON npc_opinions(target_id);

    CREATE TABLE IF NOT EXISTS opinion_events (
      id             TEXT PRIMARY KEY,
      world_id       TEXT NOT NULL,
      actor_id       TEXT NOT NULL,
      actor_type     TEXT NOT NULL DEFAULT 'player',
      event_type     TEXT NOT NULL,
      magnitude      REAL NOT NULL,
      location_x     REAL,
      location_z     REAL,
      witness_radius REAL DEFAULT 30,
      context        TEXT,
      occurred_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_opinion_events_world ON opinion_events(world_id, occurred_at DESC);
  `);

  // ── arrest_records — warrants and arrests ─────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS arrest_records (
      id              TEXT PRIMARY KEY,
      world_id        TEXT NOT NULL,
      suspect_id      TEXT NOT NULL,
      suspect_type    TEXT NOT NULL DEFAULT 'npc',  -- 'npc'|'player'
      crime_event_id  TEXT NOT NULL,
      issuing_detective TEXT,
      bounty_amount   INTEGER DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'active',  -- 'active'|'arrested'|'cleared'|'expired'
      issued_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_arrests_world ON arrest_records(world_id, status);
    CREATE INDEX IF NOT EXISTS idx_arrests_suspect ON arrest_records(suspect_id, status);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS arrest_records;
    DROP TABLE IF EXISTS npc_jobs;
    DROP TABLE IF EXISTS evidence_items;
    DROP TABLE IF EXISTS crime_events;
  `);
}
