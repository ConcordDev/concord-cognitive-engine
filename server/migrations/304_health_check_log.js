// server/migrations/304_health_check_log.js
//
// Maintenance / Homeostasis loop — the world-health-monitor's ledger.
//
// Each monitor pass records what it found, whether it auto-healed (mechanical)
// or escalated (value/arc — the cortex never makes a design call), so the
// operator repair-telemetry lens can show "what the world repaired while you
// slept." Append-only; read by domains/repair.js + /lenses/repair-telemetry.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_check_log (
      id            TEXT PRIMARY KEY,
      pathology     TEXT NOT NULL,           -- e.g. negative_balance / dupe_citation / stuck_scheduler
      category      TEXT NOT NULL            -- economy | liveness | arc
                      CHECK (category IN ('economy', 'liveness', 'arc')),
      disposition   TEXT NOT NULL            -- healed (mechanical) | escalated (value/arc) | noted
                      CHECK (disposition IN ('healed', 'escalated', 'noted')),
      subject_id    TEXT,                    -- the affected row / scheduler / user
      detail_json   TEXT NOT NULL DEFAULT '{}',
      checked_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_health_check_log_at ON health_check_log(checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_health_check_log_disp ON health_check_log(disposition, checked_at DESC);
  `);
}

export function down(_db) {
  // forward-only
}
