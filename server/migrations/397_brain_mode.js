// server/migrations/397_brain_mode.js
//
// Private Mode / High Power Mode — per-account LLM routing.
//
// Private (the default, for every existing and new account): every LLM call
// this account triggers goes to local Ollama, full stop — no BYO override,
// no platform-funded provider, no exceptions.
//
// High Power (opt-in only): the user's own BYO override for a slot if they
// have one, else a platform-funded provider (Groq / Gemini / Mistral — see
// server/lib/platform-providers.js), else local Ollama. Explicitly and
// visibly NOT covered by the privacy guarantee — some of those providers
// train on submitted data. Disclosed to the user at the point they choose
// this mode (see the onboarding/settings copy in server/routes/auth.js and
// server/domains/byo-keys.js), never hidden.
//
// `NOT NULL DEFAULT 'private'` on an ALTER TABLE ADD COLUMN is a constant
// default in SQLite, so every pre-existing row gets 'private' for free —
// no backfill script needed to make existing accounts default-private too.
//
// brain_mode_set_at is provenance only (when did the user last make an
// explicit choice) — it is never read for gating, only for display/audit.

export function up(db) {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN brain_mode TEXT NOT NULL DEFAULT 'private'
             CHECK (brain_mode IN ('private','high_power'))`);
  } catch { /* column may already exist on re-run */ }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN brain_mode_set_at INTEGER`);
  } catch { /* same */ }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_brain_mode ON users(brain_mode)`);
}

export function down(_db) { /* sqlite — append-only convention; leave columns in place */ }
