// server/migrations/277_npc_hooks.js
//
// D5 — CK3 "hooks": information as a spendable, expiring, inheritable asset.
//
// Secrets (mig 154) and opinions (mig 153) already model what an NPC KNOWS
// and how they FEEL. What was missing is the CK3 keystone: a *held* piece of
// leverage you can spend or sit on. A hook is the bridge between "I discovered
// your secret" and "therefore you will do this / therefore you cannot move
// against me."
//
// Semantics:
//   - weak hook   → single-use coercion (uses_left defaults to 1). Spend it to
//                   force one favour; it is consumed.
//   - strong hook → passively blocks the target from opening a hostile scheme
//                   against the holder while active, AND gives the holder a
//                   scheme-success bonus against the target. Higher uses_left so
//                   it can also coerce a few times before burning out.
//   - both decay  → expires_at (an in-world decade by default; env-tunable).
//
// A hook is held by (holder_kind, holder_id) OVER (target_kind, target_id).
// source_secret_id ties it to the secrets row that justifies it (nullable for
// non-secret origins). Idempotent per (holder, target, source_secret_id) so
// re-discovering the same secret never stacks duplicate hooks — it upgrades
// weak→strong instead (handled in lib/hooks.js#grantHook).
//
// Inheritance (the load-bearing depth lever): when an NPC dies, hooks held OVER
// it transfer to its heir (a hook over a dead lord's heir still bites), and
// hooks the deceased HELD pass to the heir as the new holder. Wired in
// npc-legacy.js#onNpcDeath.

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

export function up(db) {
  if (tableExists(db, "npc_hooks")) return;

  db.exec(`
    CREATE TABLE npc_hooks (
      id               TEXT    PRIMARY KEY,
      holder_kind      TEXT    NOT NULL CHECK (holder_kind IN ('npc','player')),
      holder_id        TEXT    NOT NULL,
      target_kind      TEXT    NOT NULL CHECK (target_kind IN ('npc','player')),
      target_id        TEXT    NOT NULL,
      strength         TEXT    NOT NULL DEFAULT 'weak' CHECK (strength IN ('weak','strong')),
      source_secret_id TEXT,
      world_id         TEXT,
      origin           TEXT    NOT NULL DEFAULT 'secret',
      uses_left        INTEGER NOT NULL DEFAULT 1,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at       INTEGER,
      last_used_at     INTEGER,
      spent_at         INTEGER
    );

    -- Idempotency: one hook per (holder, target, justifying secret). NULL
    -- source_secret_id rows are treated as distinct by SQLite, which is the
    -- intended behaviour for non-secret hooks.
    CREATE UNIQUE INDEX idx_hook_unique
      ON npc_hooks(holder_kind, holder_id, target_kind, target_id, source_secret_id);

    CREATE INDEX idx_hook_holder ON npc_hooks(holder_kind, holder_id);
    CREATE INDEX idx_hook_target ON npc_hooks(target_kind, target_id);
    CREATE INDEX idx_hook_active ON npc_hooks(target_kind, target_id, strength) WHERE spent_at IS NULL;
    CREATE INDEX idx_hook_expiry ON npc_hooks(expires_at) WHERE spent_at IS NULL;
  `);
}

export function down(_db) {
  // forward-only
}
