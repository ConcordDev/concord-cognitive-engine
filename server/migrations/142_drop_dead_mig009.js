// Migration 142 — Drop dead tables from migration 009 (Phase 4).
//
// Renamed from 121_drop_dead_mig009.js — collided with 121_understanding_evolution.js
// (which shipped first at 09277c4e). Same pattern as the 120→141 rename:
// the debt-cleanup commit (257b72c3) silently took numbers already
// occupied by the understanding wave. Re-numbered to 142. Idempotent
// (DROP TABLE IF EXISTS), so envs already at 121 with this content safely
// re-apply at 142 with no data effect.
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
  if (!result.ok) console.warn("[migration 142]", result);
}

export function down(_db) { /* forward-only — see _drop-with-rescue.js */ }
