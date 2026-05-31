// server/migrations/300_trial_records.js
//
// Player-detective deduction / trial records.
//
// lib/detective.js#lockInDeduction (the /lenses/detective deduce→verdict→sentence
// flow, mounted at /api/detective/crime/:id/deduce) writes a rich trial record:
// charges + evidence_summary + verdict + sentence — but it was writing them to
// the bounty-tracking `arrest_records` table (mig 065), which has none of those
// columns, so every deduce + every getDeductionsByUser read threw and the lens
// broke on lock-in. These are a DISTINCT concept (a player's deduction verdict,
// not an NPC bounty), so they get their own table. The consumer was already
// wired front-to-back; this is the missing organ.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trial_records (
      id               TEXT PRIMARY KEY,
      world_id         TEXT,
      crime_event_id   TEXT NOT NULL,
      detective_id     TEXT NOT NULL,
      suspect_id       TEXT,
      suspect_type     TEXT,
      charges          TEXT,   -- JSON [weapon, motive]
      evidence_summary TEXT,   -- JSON reasons[]
      verdict          TEXT,   -- 'guilty' | 'pending'
      sentence_type    TEXT,
      sentence_data    TEXT,   -- JSON { correctCount }
      processed_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_trial_records_detective ON trial_records(detective_id, processed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trial_records_crime ON trial_records(crime_event_id);
  `);
}

export function down(_db) {
  // forward-only
}
