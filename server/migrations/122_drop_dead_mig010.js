// Migration 122 — Drop dead tables from migration 010 (Phase 4).
//
// The learning-verification tables were superseded by the citation
// cascade royalty system (royalty-cascade.js + economy_ledger) and
// drift-monitor. Migration 010 itself documents the supersession.

import { dropDeadTables } from "./_drop-with-rescue.js";

export function up(db) {
  const result = dropDeadTables(db, [
    "dtu_helpfulness",
    "retrieval_metrics",
    "novelty_daily",
    "dedup_audits",
    "pruning_history",
    "generation_quotas",
  ]);
  if (!result.ok) console.warn("[migration 122]", result);
}

export function down(_db) { /* forward-only */ }
