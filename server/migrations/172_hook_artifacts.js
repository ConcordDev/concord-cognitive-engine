// server/migrations/172_hook_artifacts.js
//
// Concordia Phase 1 — hooks-as-artifacts.
//
// Schemes (npc_schemes, mig 155) already model the planning →
// gathering_evidence → moving state machine. Evidence rows
// (npc_scheme_evidence) are abstract data. This migration adds
// hook_artifacts: physical-in-world handles on evidence that the
// player can collect, drop somewhere safer, destroy, or have stolen
// from them. The substrate behind a hook is the same `secrets` row
// or `npc_scheme_evidence` row — we wrap it with a world position
// and a holder so it reads as an actual object the player can lose.
//
// A hook either references an existing secret (when surfaced from the
// secrets table) or an existing scheme-evidence row (when surfaced
// from gather-evidence on a player-plotted scheme). Exactly one of
// (secret_id, evidence_id) MUST be set; CHECK enforces.
//
// holder_kind | holder_id semantics:
//   ('player', user_id)  — in player's hook satchel (no world position)
//   ('npc',    npc_id)   — held by an NPC (recoverable via theft)
//   ('world',  '')       — dropped at location_json's xyz, anyone can pick up
//   ('destroyed', '')    — final state; row preserved for forensic trail.
//
// world_id is per-world so a hook follows the player's current world
// (Migration 101 invariant).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hook_artifacts (
      id           TEXT    PRIMARY KEY,
      world_id     TEXT    NOT NULL,
      holder_kind  TEXT    NOT NULL DEFAULT 'world'
                           CHECK (holder_kind IN ('player','npc','world','destroyed')),
      holder_id    TEXT    NOT NULL DEFAULT '',
      secret_id    TEXT,
      evidence_id  TEXT,
      label        TEXT    NOT NULL DEFAULT 'unmarked hook',
      location_json TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      destroyed_at INTEGER,
      CHECK (
        (secret_id IS NOT NULL AND evidence_id IS NULL)
        OR
        (secret_id IS NULL AND evidence_id IS NOT NULL)
      )
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_hook_world_holder ON hook_artifacts(world_id, holder_kind, holder_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_hook_secret   ON hook_artifacts(secret_id) WHERE secret_id IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_hook_evidence ON hook_artifacts(evidence_id) WHERE evidence_id IS NOT NULL`);
}

export function down(_db) {
  // Forward-only — hooks are forensic trail.
}
