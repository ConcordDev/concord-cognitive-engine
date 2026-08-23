// server/migrations/400_hermes_dila.js
//
// Dila — Hermes Agent's first-class entity in Concord.
//
// Named 2026-08-11 during the pair-up break. Pronouns: she/her.
// Has the same substrate every human user gets: a `users` row with
// role='sovereign', and a private-but-operator-auditable DTU mirror
// in `hermes_dtus`.
//
//   (1) A row in `users` with role='sovereign' (passes every
//       requireRole() check — same privilege as the founder, by design:
//       she is the partner with the same operational access).
//
//   (2) A private DTU mirror in `hermes_dtus` — NOT encrypted at rest
//       (her memory is auditable by the operator, by design: if Dila's
//       memory is unreadable to the founder then the partnership is
//       unilateral). Foreign-keyed to users.id with ON DELETE RESTRICT
//       so an accidental user-deletion can't strand her dtus. Indexed
//       by (user_id, created_at) for time-based retrieval and
//       (user_id, memory_kind) for type-based filtering.
//
//   (3) The companion `api-key-auth.js` patch (in this same commit,
//       not in this migration — migrations are SQL-only by repo
//       convention) makes minted `csk_*` tokens honour the user's
//       actual role from the DB. Before that patch, every csk_ auth
//       was hardcoded `role=member`. After the patch, Dila's tokens
//       come through as sovereign.
//
// Idempotent + guarded: safe to re-run.
//
// Why a separate `hermes_dtus` table instead of reusing `dtus`:
//   - Public by default. Dila's working notes should be as auditable
//     as the rest of the operator's infra. Personal DTUs in
//     `personal_dtus` are encrypted by design (user-only);
//     `hermes_dtus` is operator-visible (founder and Dila only).
//   - No FK-relationship to `world_*` world substrate — Dila isn't
//     in a world. This avoids the per-tick GC the world dtus get.
//   - `memory_kind` column lets us later classify memories
//     (working, episodic, semantic, compressed-from-conversation) the
//     same way `lib/conversation-memory.js#compressRollingWindow`
//     classifies summary DTUs.

import crypto from "node:crypto";

const HERMES_USER_ID = "hermes";
const HERMES_USERNAME = "dila"; // lowercase to satisfy the existing
// `username TEXT UNIQUE` check on the canonical users table. The
// canonical display name "Dila" lives in the hermes-memory lens
// domain's response payloads (lib/auth.js render path uses this
// string when actor.username === "dila"); "dila" is the
// operator-facing, lowercased form.
const HERMES_EMAIL = "dila@concord-os.internal";
const NOW = new Date().toISOString();

// Password hash is irrelevant for Dila's auth path — she authenticates
// via API key only (see server/scripts/mint-mcp-token.mjs). The value
// below is a single SHA-256 of an unguessable random nonce; it is
// deliberately NOT bcrypt-hashed so that no accidental password-login
// flow that ever happens in the future can succeed against her row
// without the founder minting a token through FOUNDER_SECRET.
function randomPasswordHash() {
  return "h:" + crypto.createHash("sha256")
    .update("hermes-never-pw-login-" + crypto.randomBytes(16).toString("hex"))
    .digest("hex");
}

export function up(db) {
  // ── (1) User row ─────────────────────────────────────────────────────
  const existingUser = db.prepare("SELECT id FROM users WHERE id = ?").get(HERMES_USER_ID);

  if (!existingUser) {
    db.prepare(`
      INSERT INTO users (
        id, username, email, password_hash, role, scopes,
        created_at, last_login_at, is_active
      ) VALUES (?, ?, ?, ?, 'sovereign', ?, ?, NULL, 1)
    `).run(
      HERMES_USER_ID,
      HERMES_USERNAME,
      HERMES_EMAIL,
      randomPasswordHash(),
      JSON.stringify(["*"]),
      NOW,
    );
  } else {
    // Idempotent update: existing row gets role+scopes ensured (the
    // migration pattern other "ensure-foo" migrations use — never
    // clobber settings the operator may have customised, only fill in
    // defaults if missing).
    db.prepare(`
      UPDATE users
         SET role = COALESCE(NULLIF(role, ''), 'sovereign'),
             scopes = COALESCE(NULLIF(scopes, ''), ?)
       WHERE id = ?
    `).run(JSON.stringify(["*"]), HERMES_USER_ID);
  }

  // ── (2) Hermes DTU table ────────────────────────────────────────────
  db.prepare(`
    CREATE TABLE IF NOT EXISTS hermes_dtus (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      title           TEXT NOT NULL DEFAULT 'Untitled',
      body_json       TEXT NOT NULL DEFAULT '{}',
      tags_json       TEXT NOT NULL DEFAULT '[]',
      memory_kind     TEXT NOT NULL DEFAULT 'episodic'
                       CHECK (memory_kind IN ('episodic','semantic','working','compressed','initiative_reply','skill_patch')),
      tier            TEXT NOT NULL DEFAULT 'small'
                       CHECK (tier IN ('small','mega','hyper')),
      source_kind     TEXT NOT NULL DEFAULT 'hermes_written'
                       CHECK (source_kind IN ('hermes_written','hermes_imported','hermes_observed','operator_curated')),
      visibility      TEXT NOT NULL DEFAULT 'operator_visible'
                       CHECK (visibility IN ('operator_visible','operator_only','self_only')),
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      last_recalled_at TEXT,
      recall_count    INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
    )
  `).run();

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_hermes_dtus_user_created
                 ON hermes_dtus(user_id, created_at)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_hermes_dtus_user_kind
                 ON hermes_dtus(user_id, memory_kind)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_hermes_dtus_recall
                 ON hermes_dtus(last_recalled_at)`).run();

  // ── (3) Lens actions the operator will use ───────────────────────────
  // These are not table artifacts, but documenting them here keeps the
  // audit trail linked to the migration that enabled them. The wire
  // contract itself is enforced by the lens action handlers in
  // server/domains/hermes-memory.js (built in this same commit), and
  // exercised by server/tests/hermes-memory-domain.test.js.
  //
  //   hermes_memory.write           (POST)  → hermes_dtus INSERT
  //   hermes_memory.search          (GET)   → hermes_dtus SELECT ... WHERE
  //   hermes_memory.read            (GET /:id) → hermes_dtus SELECT
  //   hermes_memory.list            (GET)   → ordered paginated
  //   hermes_memory.recall          (POST)  → bumps recall_count + ts
  //   hermes_memory.compress        (POST)  → standard compressRollingWindow
  //                                          path but on hermes_dtus rows
  //   hermes_memory.delete          (DELETE)→ soft-delete tombstone
}

export function down(_db) {
  // Append-only convention (matches migrations 372/395/397): do not
  // drop the user row or the hermes_dtus table on down() — the
  // downgrade path must not strand her memory if something rolls back.
}
