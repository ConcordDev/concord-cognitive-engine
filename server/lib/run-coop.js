// server/lib/run-coop.js
//
// C4 / F4.3 — co-op run participation. Shared roster accounting so a party can
// share one extraction/horde run. The mode owns its run table (which now has a
// party_id column); this owns the participant roster + the join decision.

function tableExists(db, name) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name); }
  catch { return false; }
}

/** Add a user to a run's roster (idempotent). */
export function addRunParticipant(db, runKind, runId, userId) {
  if (!db || !runKind || !runId || !userId || !tableExists(db, "run_participants")) return { ok: false };
  db.prepare(`
    INSERT INTO run_participants (run_kind, run_id, user_id) VALUES (?, ?, ?)
    ON CONFLICT(run_kind, run_id, user_id) DO NOTHING
  `).run(runKind, runId, userId);
  return { ok: true };
}

/**
 * Active run the user owns OR joined via run_participants. Owner row wins.
 * `runTable` is extraction_runs / horde_runs. Returns the row or null.
 */
export function findActiveRunForUser(db, runTable, runKind, userId) {
  if (!db || !userId || !runTable || !tableExists(db, runTable)) return null;
  try {
    const owned = db.prepare(
      `SELECT * FROM ${runTable} WHERE user_id = ? AND ended_at IS NULL`
    ).get(userId);
    if (owned) return owned;
    if (!tableExists(db, "run_participants")) return null;
    return db.prepare(`
      SELECT r.* FROM ${runTable} r
      JOIN run_participants p ON p.run_id = r.id AND p.run_kind = ?
      WHERE p.user_id = ? AND r.ended_at IS NULL
      ORDER BY r.rowid DESC LIMIT 1
    `).get(runKind, userId) || null;
  } catch {
    return null;
  }
}

/** The user ids sharing a run. */
export function runParticipants(db, runKind, runId) {
  if (!db || !tableExists(db, "run_participants")) return [];
  try {
    return db.prepare(`SELECT user_id FROM run_participants WHERE run_kind = ? AND run_id = ? ORDER BY joined_at ASC`)
      .all(runKind, runId).map((r) => r.user_id);
  } catch { return []; }
}

/**
 * Find an active run shared by a party in the mode's own table. `runTable` is
 * the mode's runs table (extraction_runs / horde_runs); it must have party_id +
 * ended_at columns. Returns the active run id for the party, or null.
 */
export function findActivePartyRun(db, runTable, partyId) {
  if (!db || !partyId || !runTable || !tableExists(db, runTable)) return null;
  try {
    const row = db.prepare(
      `SELECT id FROM ${runTable} WHERE party_id = ? AND ended_at IS NULL ORDER BY rowid DESC LIMIT 1`
    ).get(partyId);
    return row?.id || null;
  } catch { return null; }
}
