// emergent/idle-behavior.js#recentCommunicationCount counts an emergent's
// messages in the last hour, ~70 times per MinorAgentScheduler batch. With
// only idx_comm_from(from_emergent_id), each count fetched every message the
// emergent ever sent (up to ~1,150 random reads in an 849k-row table) to test
// initiated_at — 2.3 s of blocked event loop per batch in the live CPU profile
// (2026-10-23). The composite index answers the count from the index alone:
// measured on a copy of live data, 70 counts 2,271 ms -> 5.2 ms, same results.

export function up(db) {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'emergent_communications'").get();
  if (!has) return;
  db.exec("CREATE INDEX IF NOT EXISTS idx_comm_from_time ON emergent_communications(from_emergent_id, initiated_at)");
}

export function down(db) {
  db.exec("DROP INDEX IF EXISTS idx_comm_from_time");
}

export const description = "Composite (from_emergent_id, initiated_at) index for recent-communication counts";
