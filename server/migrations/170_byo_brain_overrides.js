// server/migrations/170_byo_brain_overrides.js
//
// Sprint 10 — Bring-your-own API key substrate.
//
// Per-user override of brain → provider routing. The default is the
// shared Ollama instances (concord-os.org subsidises). Users who
// already pay for Claude/GPT/Grok keys can plug them in and route
// individual brain slots to those frontier models on the fly.
//
// Privacy contract (load-bearing):
//   - Keys are stored AES-GCM encrypted at rest with a per-user
//     wrapped key. The wrapping key is derived from JWT_SECRET +
//     user_id so each user has an isolated keyspace.
//   - Keys are NEVER returned to the frontend after first save.
//     The settings UI shows a masked "*** **** ***" preview and a
//     "remove" button only.
//   - At inference time, the key is decrypted in-memory just before
//     the outbound HTTPS call to the provider. It is never logged,
//     never persisted in plaintext, never traced.
//
// Provenance (the revolving-door):
//   minted_by_provider + minted_by_model on dtus lets free-tier
//   users SEE that an answer cited a "Claude 4.5"-minted DTU, and
//   the royalty cascade pays the original creator when the citation
//   fires. Power users effectively donate frontier-tier knowledge
//   to the global corpus and get cascade royalties back.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_brain_overrides (
      user_id          TEXT    NOT NULL,
      brain_slot       TEXT    NOT NULL
                               CHECK (brain_slot IN
                               ('conscious','subconscious','utility','repair','vision')),
      provider         TEXT    NOT NULL
                               CHECK (provider IN
                               ('openai','anthropic','xai','google','ollama','concord_default')),
      model_id         TEXT,
      encrypted_key    BLOB,
      key_preview      TEXT,
      active           INTEGER NOT NULL DEFAULT 1,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      last_used_at     INTEGER,
      PRIMARY KEY (user_id, brain_slot)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_byo_user ON user_brain_overrides(user_id, active)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_byo_provider ON user_brain_overrides(provider)`);

  // DTU provenance — what minted each DTU. The royalty cascade
  // attribution already exists via dtu_citations; this column adds
  // visibility ("Claude 4.5 minted this") to the global search UI.
  // Cheap ALTER on dtus table — column is NULL for pre-existing rows.
  try {
    db.exec(`ALTER TABLE dtus ADD COLUMN minted_by_provider TEXT`);
  } catch { /* column may already exist on re-run */ }
  try {
    db.exec(`ALTER TABLE dtus ADD COLUMN minted_by_model TEXT`);
  } catch { /* same */ }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_dtu_provider ON dtus(minted_by_provider)`);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS user_brain_overrides`);
  // ALTER DROP COLUMN is a no-op on most SQLite builds — leaving the
  // columns is harmless and forward-only.
}
