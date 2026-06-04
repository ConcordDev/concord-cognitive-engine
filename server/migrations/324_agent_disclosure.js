// server/migrations/324_agent_disclosure.js
//
// Wave 7 / Track C1 — the hard-disclosure column. The inverse of mig 314's
// verified-human badge: an autonomous Concord agent (a player-tier AI resident)
// MUST be distinguishable from a human. `is_agent` is surfaced on the NPC nameplate
// and read by the human-contact guardrail (lib/agent-guardrails.js) so a human
// always knows they're talking to an AI. Forward-only, column-existence guarded.
//
//   users.is_agent        0/1   — this account is an autonomous agent, not a human
//   users.agent_kind      TEXT  — optional sub-kind (resident | playtest | npc-brain)
//   users.agent_created_at TEXT — audit trail

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()) return;
  for (const [col, ddl] of [
    ["is_agent", "ALTER TABLE users ADD COLUMN is_agent INTEGER DEFAULT 0"],
    ["agent_kind", "ALTER TABLE users ADD COLUMN agent_kind TEXT"],
    ["agent_created_at", "ALTER TABLE users ADD COLUMN agent_created_at TEXT"],
  ]) {
    if (!columnExists(db, "users", col)) {
      try { db.exec(ddl); } catch { /* noop */ }
    }
  }
}

export function down(_db) {
  // forward-only
}
