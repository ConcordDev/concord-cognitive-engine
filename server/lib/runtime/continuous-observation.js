// server/lib/runtime/continuous-observation.js
//
// Continuous observation snapshot for executive context assembly.

export function gatherObservationSnapshot(db) {
  const snapshot = {
    ts: Date.now(),
    incidents: 0,
    opportunities: 0,
    predictions: 0,
    initiatives: 0,
    activeMissions: 0,
    failedMissions: 0,
    sentinelAlerts: 0,
  };

  if (!db) return { ok: false, reason: "no_db", snapshot };

  const safeCount = (sql, ...params) => {
    try {
      return db.prepare(sql).get(...params)?.c ?? 0;
    } catch {
      return 0;
    }
  };

  snapshot.incidents = safeCount(
    `SELECT COUNT(*) AS c FROM incidents WHERE status IN ('open','investigating')`,
  );
  snapshot.opportunities = safeCount(
    `SELECT COUNT(*) AS c FROM opportunity_signals WHERE status = 'open'`,
  );
  // prediction_tickets is Concord Predict's immutable-forecast table
  // (418_prediction_tickets) — it has no 'status' column. A ticket is "open"
  // until its outcome is recorded in prediction_outcomes. (The Dila-runtime
  // migration that would have given this table a status column was a
  // name-collision bug, now removed — see 445_runtime_stack_closure.js.)
  snapshot.predictions = safeCount(
    `SELECT COUNT(*) AS c FROM prediction_tickets t
     WHERE NOT EXISTS (SELECT 1 FROM prediction_outcomes o WHERE o.prediction_id = t.id)`,
  );
  snapshot.initiatives = safeCount(
    `SELECT COUNT(*) AS c FROM initiatives WHERE status = 'submitted'`,
  );
  snapshot.activeMissions = safeCount(
    `SELECT COUNT(*) AS c FROM mission_tasks WHERE status IN ('active','running','pending')`,
  );
  snapshot.failedMissions = safeCount(
    `SELECT COUNT(*) AS c FROM mission_tasks WHERE status = 'failed' AND updated_at > unixepoch() - 3600`,
  );
  snapshot.sentinelAlerts = safeCount(
    `SELECT COUNT(*) AS c FROM sentinel_alerts WHERE resolved_at IS NULL`,
  );

  const pressure = Math.min(1, (
    snapshot.incidents * 0.2
    + snapshot.failedMissions * 0.15
    + snapshot.activeMissions * 0.02
  ));

  return {
    ok: true,
    snapshot,
    pressure,
    summary: `obs: incidents=${snapshot.incidents} opps=${snapshot.opportunities} `
      + `predict=${snapshot.predictions} missions=${snapshot.activeMissions} pressure=${pressure.toFixed(2)}`,
  };
}
