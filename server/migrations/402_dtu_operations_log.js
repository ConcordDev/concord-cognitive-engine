// server/migrations/402_dtu_operations_log.js
//
// Sprint 32 — System-status DTU bloat fix.
//
// PROBLEM this migration solves
// -----------------------------
// repair-cortex was writing **every** repair action as a DTU — 51 call sites
// of `logRepairDTU()` in `server/emergent/repair-cortex.js` covering
// `guardian_started`, `repair_loop_started`, `recurring_error`,
// `event_loop_critical`, `ollama_restart_attempted`, `container_unhealthy`,
// `nginx_config_invalid`, etc. Each one entered `STATE.dtus` AND was
// persisted to `dtu_store` SQL via the write-through store. Result: a flood
// of operational log entries mixed into the user-visible knowledge substrate.
//
// Operator (2026-08-12): "There was an issue in the past where the system
// status dtus were clogging and in the way of actual content."
//
// FIX
// ---
// Create a dedicated `dtu_operations_log` table for system-status entries.
// This table is OUT of the DTU universe:
//   - Not in `dtu_store` → not in user-facing /api/dtus
//   - Not in STATE.dtus → not in lattice, autogen, or search
//   - Only readable via a dedicated `getOperationsLog(filters)` helper
//
// The 18 repair_cortex rows already in `dtu_store` get tombstoned at boot
// (see companion module `server/lib/dtu-operations-log.js`).
//
// SCHEMA
// ------
// mirrors the minimum info needed to debug a system incident:
//   id          : canonical uuid-prefixed id (e.g. "oplog_abc123")
//   ts          : ISO timestamp of the event
//   subsystem   : "repair_cortex" | "feed_manager" | etc.
//   phase       : phase from the source (PRE_BUILD | MID_BUILD | POST_BUILD | null)
//   action      : short verb ("guardian_started", "recurring_error", ...)
//   severity    : "info" | "warn" | "error" | "critical" — derived from action
//   details     : JSON blob — the payload the source code passed in
//   meta        : JSON blob — extra metadata (model, score, etc.)

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtu_operations_log (
      id          TEXT PRIMARY KEY,
      ts          TEXT NOT NULL DEFAULT (datetime('now')),
      subsystem   TEXT NOT NULL,
      phase       TEXT,
      action      TEXT NOT NULL,
      severity    TEXT NOT NULL DEFAULT 'info'
                    CHECK (severity IN ('info','warn','error','critical')),
      details     TEXT NOT NULL DEFAULT '{}',
      meta        TEXT NOT NULL DEFAULT '{}',
      archived    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_dtu_oplog_subsystem_ts
      ON dtu_operations_log(subsystem, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_dtu_oplog_severity_ts
      ON dtu_operations_log(severity, ts DESC)
      WHERE severity IN ('error','critical');
    CREATE INDEX IF NOT EXISTS idx_dtu_oplog_archived_ts
      ON dtu_operations_log(archived, ts DESC);
  `);
}

export function down(db) {
  // Forward-fixes don't get rolled back. The empty table is harmless and
  // dropping it would lose incident history.
  // (intentionally no-op)
}