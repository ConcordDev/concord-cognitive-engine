// server/migrations/387_agent_marathon_turn_compaction.js
//
// Grounding-audit gap (2026-07-24): agent-marathon.js#tickMarathon builds the
// `history` array it feeds to the brain from EVERY prior turn in
// agent_marathon_turns, with no cap. A session running hundreds of turns
// over hours/days will blow the model's context window well before hitting
// `max_turns` (default 200, cap 2000).
//
// conversation-memory.js already solves the equivalent problem for regular
// chat sessions with a rolling window: once raw message count crosses
// WINDOW_THRESHOLD, the oldest COMPRESSION_BATCH messages are folded into a
// compact record and the active window stays fixed-size forever after. This
// migration adds the one column agent-marathon.js#compressMarathonHistory
// needs to apply the SAME pattern to marathon sessions: a marker that
// distinguishes the session's single synthetic rolling-checkpoint turn from
// a real user/assistant/tool turn.
//
//   is_checkpoint INTEGER NOT NULL DEFAULT 0 — 1 on the (at most one)
//                                 synthetic checkpoint turn per session,
//                                 which folds the session's oldest compacted
//                                 turns into one bounded rolling summary
//                                 (role='system' — already a legal value
//                                 under migration 171's CHECK, so no CHECK
//                                 widening is needed here). 0 (default) on
//                                 every real turn, so every pre-existing row
//                                 and every session that never crosses the
//                                 compaction threshold reads back byte-
//                                 identically to before this migration.
//
// Idempotent + guarded: no-op if agent_marathon_turns doesn't exist yet
// (minimal build) or the column is already present.

export function up(db) {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_marathon_turns'",
  ).get();
  if (!table) return; // minimal build without the marathon substrate — nothing to widen

  const cols = db.prepare(`PRAGMA table_info(agent_marathon_turns)`).all().map((c) => c.name);
  if (cols.includes("is_checkpoint")) return; // already applied

  db.exec(`ALTER TABLE agent_marathon_turns ADD COLUMN is_checkpoint INTEGER NOT NULL DEFAULT 0`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_marathon_turns_checkpoint ON agent_marathon_turns(session_id, is_checkpoint)`);
}

export function down(db) {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_marathon_turns'",
  ).get();
  if (!table) return;

  const cols = db.prepare(`PRAGMA table_info(agent_marathon_turns)`).all().map((c) => c.name);
  if (!cols.includes("is_checkpoint")) return;

  db.exec(`DROP INDEX IF EXISTS idx_marathon_turns_checkpoint`);
  try {
    db.exec(`ALTER TABLE agent_marathon_turns DROP COLUMN is_checkpoint`);
  } catch {
    // Older SQLite builds without DROP COLUMN support — leave the column in
    // place. It's inert (defaults to 0, never read unless compression logic
    // is also present) and harmless to strand on a down-migration.
  }
}
