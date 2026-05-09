// Migration 143 — Drop dead tables from migration 009 (Phase 4).
//
// Renumbered twice:
//   1. 121_drop_dead_mig009.js → 142_drop_dead_mig009.js (commit 5303bff4)
//      to dodge collision with 121_understanding_evolution.js.
//   2. 142_drop_dead_mig009.js → 143_drop_dead_mig009.js (this commit)
//      to dodge collision with 142_mount_substrate.js, which B1 added
//      in parallel without knowing about the first rename.
// Idempotent (DROP TABLE IF EXISTS), so envs already at 121 or 142
// with this content safely re-apply at 143 with no data effect.
//
// The brain-want-engine subsystem was superseded by the persona substrate
// and affect engine. STATE.wants is now in-memory only; the original
// tables had zero SELECT references for years. Migration 009 itself
// documents the supersession.

import { dropDeadTables } from "./_drop-with-rescue.js";

export function up(db) {
  const result = dropDeadTables(db, [
    "preserved",
    "personality_state",
    "personality_evolution_log",
    "wants",
    "want_audit_log",
    "want_suppressions",
    "spontaneous_queue",
    "spontaneous_user_prefs",
    "want_actions",
  ]);
  if (!result.ok) console.warn("[migration 143]", result);
}

export function down(_db) { /* forward-only — see _drop-with-rescue.js */ }
