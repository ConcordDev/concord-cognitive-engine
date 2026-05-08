// server/migrations/112_faction_strategy.js
//
// Layer 11: faction emergent strategy.
//
// `faction_strategy_state` holds each authored faction's current
// strategic stance + cooldown clock. Factions live in
// content/world/**/factions.json (file-driven); this table only
// persists runtime drift — exactly the same pattern as
// faction_policy_state (migration 078).
//
// `faction_relations` holds pairwise opinion scores. -1 = at war,
// 0 = neutral, +1 = allied. Strategy cycles modulate this; routes
// query it for downstream NPC behaviour.
//
// `faction_strategy_log` records every executed move so the news feed
// + activity panels can surface "Faction X declared war on Faction Y"
// without scanning derived state.

export function up(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS faction_strategy_state (
      faction_id     TEXT PRIMARY KEY,
      stance         TEXT NOT NULL DEFAULT 'consolidate'
                       CHECK (stance IN
                         ('consolidate', 'expand', 'war', 'alliance', 'rebuild', 'isolation')),
      target_id      TEXT,                    -- another faction id when relevant
      phase          INTEGER NOT NULL DEFAULT 0,
      next_move_at   INTEGER NOT NULL DEFAULT 0,
      momentum       REAL NOT NULL DEFAULT 0, -- -1..+1; negative = losing, positive = winning
      last_move_id   TEXT,
      updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS faction_relations (
      faction_a    TEXT NOT NULL,
      faction_b    TEXT NOT NULL,
      score        REAL NOT NULL DEFAULT 0,    -- -1 (war) .. +1 (allied)
      kind         TEXT NOT NULL DEFAULT 'neutral'
                     CHECK (kind IN ('neutral', 'tension', 'truce', 'war', 'alliance', 'tribute')),
      since        INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (faction_a, faction_b),
      CHECK (faction_a < faction_b)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS faction_strategy_log (
      id            TEXT PRIMARY KEY,
      faction_id    TEXT NOT NULL,
      move          TEXT NOT NULL,
      target_id     TEXT,
      summary       TEXT NOT NULL,
      payload_json  TEXT NOT NULL DEFAULT '{}',
      occurred_at   INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_faction_strategy_log_faction
      ON faction_strategy_log(faction_id, occurred_at DESC)
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_faction_strategy_log_recent
      ON faction_strategy_log(occurred_at DESC)
  `).run();
}

export function down(db) {
  db.prepare('DROP INDEX IF EXISTS idx_faction_strategy_log_recent').run();
  db.prepare('DROP INDEX IF EXISTS idx_faction_strategy_log_faction').run();
  db.prepare('DROP TABLE IF EXISTS faction_strategy_log').run();
  db.prepare('DROP TABLE IF EXISTS faction_relations').run();
  db.prepare('DROP TABLE IF EXISTS faction_strategy_state').run();
}
