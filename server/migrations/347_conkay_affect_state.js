// server/migrations/347_conkay_affect_state.js
//
// ConKay Voice + Affect fusion (#15) — persistent per-user affect state for the
// ConKay assistant. Real VAD (valence/arousal/dominance) derived from the user's
// own words, EMA-blended across turns so the assistant carries a mood rather than
// resetting every message. Drives TTS prosody + a one-line note injected into
// the persona context. No fabricated emotion — every value traces to analyzed
// input.
//
// Append-only; IF NOT EXISTS so re-runs are safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conkay_affect_state (
      user_id    TEXT PRIMARY KEY,
      valence    REAL NOT NULL DEFAULT 0.5,   -- 0 (negative) .. 1 (positive)
      arousal    REAL NOT NULL DEFAULT 0.3,   -- 0 (calm) .. 1 (excited)
      dominance  REAL NOT NULL DEFAULT 0.5,   -- 0 (submissive) .. 1 (in-control)
      turns      INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}
