// server/migrations/307_onboarding_funnel.js
//
// FTUE3 — the first-10-minutes funnel ledger. Records each onboarding step a
// user FIRST reaches with the elapsed time from their funnel start, so we can
// measure time-to-first-action, time-to-hook, and drop-off between steps — the
// research's core discipline ("watch where new players stall, iterate"). You
// can't tighten the funnel you can't measure. Append-only; one row per
// (user, step) first-occurrence. Behind CONCORD_FTUE_TELEMETRY at the write site.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS onboarding_funnel (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        TEXT NOT NULL,
      step           TEXT NOT NULL,
      at             INTEGER NOT NULL,           -- ms epoch of first reach
      ms_since_start INTEGER NOT NULL DEFAULT 0, -- elapsed from this user's first funnel event
      UNIQUE(user_id, step)                      -- funnel = FIRST reach per step
    );
    CREATE INDEX IF NOT EXISTS idx_onboarding_funnel_user ON onboarding_funnel(user_id, at);
    CREATE INDEX IF NOT EXISTS idx_onboarding_funnel_step ON onboarding_funnel(step);
  `);
}
