// Migration 124 — Drop dead tables from migrations 059, 085 (Phase 4).
//
// - reasoning_sessions (mig 059): superseded by HLR engine's in-memory
//   trace store + reasoning-trace persistence.
// - plugin_installs (mig 085): plugin install tracking now flows through
//   the apps/app-maker substrate.

import { dropDeadTables } from "./_drop-with-rescue.js";

export function up(db) {
  const result = dropDeadTables(db, [
    "reasoning_sessions",
    "plugin_installs",
  ]);
  if (!result.ok) console.warn("[migration 124]", result);
}

export function down(_db) { /* forward-only */ }
