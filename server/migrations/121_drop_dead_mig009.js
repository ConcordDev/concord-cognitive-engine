// Migration 121 — Drop dead tables from migration 009 (Phase 4).
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
  if (!result.ok) console.warn("[migration 121]", result);
}

export function down(_db) { /* forward-only — see _drop-with-rescue.js */ }
