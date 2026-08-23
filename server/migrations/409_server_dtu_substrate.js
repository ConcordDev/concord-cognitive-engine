/**
 * Migration 409 — Server DTU Substrate (Content-Addressed)
 *
 * Sprint 33 Phase 2: CSL's permanent write destination for formal semantic claims.
 * This is a **new table**, separate from dtu_store (which remains the general DTU cache).
 *
 * server_dtu_substrate is content-addressed (hash is PK) and immutable:
 * each (hash, payload) pair is written once and never modified. Supports
 * auditable replay, consensus verification, and off-chain archival.
 *
 * Spec: docs/SPRINT-33-CSL-PLAN.md §3.4
 */

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS server_dtu_substrate (
      hash VARCHAR(64) PRIMARY KEY,
      payload JSON NOT NULL,
      payload_kind VARCHAR(32) DEFAULT 'composite' NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      CHECK (payload_kind IN ('composite', 'lattice', 'citation', 'invariant', 'archive'))
    );

    -- Lookup by payload kind: partition for recovery + audit
    CREATE INDEX IF NOT EXISTS idx_server_dtu_substrate_kind
      ON server_dtu_substrate(payload_kind);

    -- Time-ordered log: scan by creation date for replay
    CREATE INDEX IF NOT EXISTS idx_server_dtu_substrate_created
      ON server_dtu_substrate(created_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_server_dtu_substrate_created;
    DROP INDEX IF EXISTS idx_server_dtu_substrate_kind;
    DROP TABLE IF EXISTS server_dtu_substrate;
  `);
}
