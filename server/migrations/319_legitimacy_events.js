// server/migrations/319_legitimacy_events.js
//
// Temperament P6 — the legitimacy ledger. Use-of-force events (especially the
// excessive ones the P4 proportionality check flags) land here so the world can
// SCORE an actor's conduct (Graham v. Connor 3-factor) and so a CI gate can pin
// the rubric. One row per scored encounter.
//
//   kind     : a short tag ('execute_hors_de_combat', 'lethal_without_warning', …)
//   verdict  : 'legitimate' | 'excessive' | 'unlawful'
//   score    : 0..1 proportionality score (1 = fully justified)
//   factors_json : the Graham inputs (crimeSeverity / immediateThreat / activeResistance)
//
// IF NOT EXISTS for idempotency. Off (CONCORD_TEMPERAMENT) nothing writes here.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS legitimacy_events (
      id           TEXT PRIMARY KEY,
      world_id     TEXT,
      actor_id     TEXT,
      npc_id       TEXT,
      kind         TEXT NOT NULL,
      verdict      TEXT NOT NULL DEFAULT 'excessive'
                   CHECK (verdict IN ('legitimate','excessive','unlawful')),
      score        REAL NOT NULL DEFAULT 0,
      factors_json TEXT,
      at           INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_legitimacy_actor ON legitimacy_events(actor_id, at);
    CREATE INDEX IF NOT EXISTS idx_legitimacy_world ON legitimacy_events(world_id, verdict);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS legitimacy_events;`);
}
