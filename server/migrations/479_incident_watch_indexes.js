// INC-100b — incident_watch event-loop stall.
//
// The in-process incident_watch tick (lib/incident-engine/watch-tick.js)
// performed one synchronous better-sqlite3 .get() per signal to check the
// 5-minute class/source dedupe window. The existing index on
// incident_state(status, detected_at) did not cover the predicate
// (incident_class, source, detected_at), so each signal caused a full table
// scan of incident_state — an N+1 loop that blocked the Node event loop.
//
// This migration adds additive indexes to the auxiliary DBs used by the
// incident engine. The code fix (Batch 020b) batches the per-slice dedupe
// lookup into one set-based query and is paired with this schema change so
// the batch query uses a covering index seek.
//
// No destructive changes; no behavior change to incident decisions.

import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SHARE = join(homedir(), ".local/share/concord");

function ensureIndex(dbPath, sql) {
  if (!existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

export function up() {
  const incidentDb = join(SHARE, "incident-engine.db");
  const sentinelDb = join(SHARE, "sentinel.db");
  const traceDb = join(SHARE, "trace-fabric.db");
  const browserDb = join(SHARE, "browser_organ.db");

  ensureIndex(
    incidentDb,
    `CREATE INDEX IF NOT EXISTS idx_incident_state_class_source_detected
       ON incident_state(incident_class, source, detected_at);`,
  );

  ensureIndex(
    sentinelDb,
    `CREATE INDEX IF NOT EXISTS idx_sentinel_alerts_created_at
       ON sentinel_alerts(created_at);`,
  );

  ensureIndex(
    traceDb,
    `CREATE INDEX IF NOT EXISTS idx_trace_correlation_observed_at_event
       ON trace_correlation(observed_at, source_event);`,
  );

  ensureIndex(
    browserDb,
    `CREATE INDEX IF NOT EXISTS idx_observations_observed_at
       ON observations(observed_at);`,
  );
}
