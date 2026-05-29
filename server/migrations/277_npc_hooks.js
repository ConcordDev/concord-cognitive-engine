// server/migrations/277_npc_hooks.js
//
// D5 (depth/balance plan) — CK3-style HOOKS: spendable, expiring, inheritable
// leverage. The codebase already has deep secrets + opinions + schemes, but no
// primitive that turns "I know something" into a HELD asset you can spend or
// that passively restrains a rival. A hook is exactly that:
//   - weak   → single-use coercion (one favour/blackmail, then gone).
//   - strong → unlimited use AND passively BLOCKS the target from hostile
//              action (scheme/betrayal) against the holder, until it expires.
// Hooks are per-(holder, target), sourced from a discovered/held secret (or a
// favour), optionally expiring, and — crucially — INHERITABLE: a hook held
// over a dead rival's heir still bites, and a dead schemer's hooks pass to
// their own heir. This is the "information is a currency" depth lever.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_hooks (
      id               TEXT PRIMARY KEY,
      holder_kind      TEXT NOT NULL CHECK (holder_kind IN ('player', 'npc')),
      holder_id        TEXT NOT NULL,
      target_kind      TEXT NOT NULL CHECK (target_kind IN ('player', 'npc')),
      target_id        TEXT NOT NULL,
      strength         TEXT NOT NULL CHECK (strength IN ('weak', 'strong')),
      source           TEXT NOT NULL DEFAULT 'secret'
                            CHECK (source IN ('secret', 'favor', 'inherited', 'debt')),
      source_secret_id TEXT,
      uses_left        INTEGER,            -- NULL = unlimited (strong hooks)
      created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at       INTEGER,            -- NULL = no expiry
      spent_at         INTEGER             -- set when consumed or expired
    );
    -- Active-hook lookups by holder ("what leverage do I hold?") and by target
    -- ("is anyone restraining me?"). spent_at IS NULL ⇒ live.
    CREATE INDEX IF NOT EXISTS idx_npc_hooks_holder
      ON npc_hooks(holder_kind, holder_id, spent_at);
    CREATE INDEX IF NOT EXISTS idx_npc_hooks_target
      ON npc_hooks(target_kind, target_id, spent_at);
    -- One live hook per (holder, target, source_secret) — grantHook is idempotent
    -- against this so re-seeding/re-discovering doesn't stack duplicates.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_npc_hooks_unique_live
      ON npc_hooks(holder_kind, holder_id, target_kind, target_id, source_secret_id)
      WHERE spent_at IS NULL;
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_npc_hooks_unique_live;
    DROP INDEX IF EXISTS idx_npc_hooks_target;
    DROP INDEX IF EXISTS idx_npc_hooks_holder;
    DROP TABLE IF EXISTS npc_hooks;
  `);
}
