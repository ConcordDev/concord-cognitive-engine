// Migration 145 — DX Platform Phase A1: Per-call macro billing.
// (Renumbered from 141 on rebase: main has 141_drop_dead_mig006.js,
// 142_mount_substrate.js, 143_drop_dead_mig009.js, 144_mount_gear.js;
// next free slot is 145.)
//
// Every macro invocation through `runMacro()` writes a `macro_call_log`
// row via the `macro:afterExecute` hook. When the call carries an
// `api_key_id` (plugin / SDK clients), the row also charges the user's
// CC wallet via the existing royalty cascade — using `ref_id` UNIQUE
// for idempotency on retry.
//
// Per-user quotas (separate from the existing global rate limit at
// `EXPENSIVE_MACROS` in server.js:1173) are tracked in `user_macro_quota`
// — bounded in-memory counters flush here every 5s OR every 50 calls
// to keep the hot path off the DB.
//
// Invariant (CLAUDE.md): wallet-debit failures must NEVER throw out of
// the macro hook; debit is post-execute and best-effort. Macro execution
// completes or errors based on its own logic, not on billing state.
//
// Tables:
//   macro_call_log    — append-only one-row-per-call billing ledger
//   user_macro_quota  — sliding-window per-user quota counters

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS macro_call_log (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             TEXT,
      api_key_id          TEXT,
      domain              TEXT    NOT NULL,
      macro_name          TEXT    NOT NULL,
      cost_units          REAL    NOT NULL DEFAULT 0,
      duration_ms         INTEGER NOT NULL DEFAULT 0,
      status              TEXT    NOT NULL CHECK (status IN ('ok','error','rate_limited','quota_exceeded')),
      cascade_payment_id  TEXT,
      ref_id              TEXT    UNIQUE,
      ts                  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_macro_call_log_user_ts
      ON macro_call_log(user_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_macro_call_log_domain_macro_ts
      ON macro_call_log(domain, macro_name, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_macro_call_log_api_key_ts
      ON macro_call_log(api_key_id, ts DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_macro_quota (
      user_id        TEXT    NOT NULL,
      domain         TEXT    NOT NULL,
      macro_name     TEXT    NOT NULL,
      window_start   INTEGER NOT NULL,
      call_count     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, domain, macro_name, window_start)
    );
    CREATE INDEX IF NOT EXISTS idx_user_macro_quota_window
      ON user_macro_quota(window_start);
  `);
}

export function down(_db) { /* forward-only */ }
