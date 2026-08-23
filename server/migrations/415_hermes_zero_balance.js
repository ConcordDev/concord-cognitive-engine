// server/migrations/415_hermes_zero_balance.js
//
// Forward-repair for migrations/400_hermes_dila.js: that migration's INSERT
// into `users` for the Dila/Hermes agent row (id='hermes') did not specify
// `concordia_credits`, so it silently took the column's schema DEFAULT of
// 100 (migrations/045_concordia_credits.js — a real "every human user starts
// with a welcome balance" feature). That gives an internal system/agent
// account a 100 CC starting balance out of nowhere on every fresh install —
// unbacked currency creation, inflating SUM(concordia_credits) across
// `users` by exactly 100 relative to every economy-conservation invariant
// in this codebase (found via tests/mail-domain-macros.test.js's currency-
// conservation assertion failing "800 !== 700" on a fresh migrated DB).
//
// Dila isn't a economic participant who should hold a starting bonus any
// more than she should count toward "has a human registered yet" (see the
// companion fix in server.js#AuthDB.getUserCount, same root migration).
// Zeroing her balance here (idempotent, append-only per repo convention —
// migrations/400 itself is not edited) removes the phantom 100 CC without
// touching any other user's balance.

const HERMES_USER_ID = "hermes";

export function up(db) {
  db.prepare(`UPDATE users SET concordia_credits = 0 WHERE id = ? AND concordia_credits = 100`).run(HERMES_USER_ID);
}

export function down(_db) {
  // Append-only convention: no reason to restore the phantom starting
  // balance on downgrade.
}
