// Migration 155 — Sprint C / Track A4: NPC Schemes / Plots.
//
// CK3-tier scheme substrate. Every plot is a state machine with
// accomplices and evidence. Player counter-play is via secret discovery
// (Track A3) and exile/pardon decrees (Track D2).
//
// Resolution effects (executed in npc-schemes.js#advanceScheme):
//   - assassinate         → triggers npc-legacy#onNpcDeath chain
//   - seduce              → opinion +60 admires
//   - fabricate_secret    → inserts a synthetic secret (Track A3)
//   - claim_inheritance   → adds heir link to npc_inheritance_links
//   - blackmail           → opinion +40 (forced respect/fear)
//   - sabotage_decree     → flips decree effect_state to 'sabotaged' (Track D)

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_schemes (
      id                TEXT    PRIMARY KEY,
      plotter_kind      TEXT    NOT NULL DEFAULT 'npc'
                                CHECK (plotter_kind IN ('npc', 'player')),
      plotter_id        TEXT    NOT NULL,
      target_kind       TEXT    NOT NULL CHECK (target_kind IN
                                ('npc', 'player', 'faction', 'kingdom')),
      target_id         TEXT    NOT NULL,
      kind              TEXT    NOT NULL CHECK (kind IN
                                ('assassinate', 'seduce', 'fabricate_secret',
                                 'claim_inheritance', 'blackmail',
                                 'sabotage_decree')),
      phase             TEXT    NOT NULL DEFAULT 'planning'
                                CHECK (phase IN
                                ('planning', 'recruiting', 'gathering_evidence',
                                 'moving', 'exposed', 'complete', 'abandoned')),
      success_pct       INTEGER NOT NULL DEFAULT 30
                                CHECK (success_pct BETWEEN 0 AND 100),
      discovery_pct     INTEGER NOT NULL DEFAULT 10
                                CHECK (discovery_pct BETWEEN 0 AND 100),
      evidence_count    INTEGER NOT NULL DEFAULT 0,
      accomplice_count  INTEGER NOT NULL DEFAULT 0,
      meta_json         TEXT,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      next_tick_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_scheme_phase     ON npc_schemes(phase, next_tick_at);
    CREATE INDEX IF NOT EXISTS idx_scheme_plotter   ON npc_schemes(plotter_kind, plotter_id);
    CREATE INDEX IF NOT EXISTS idx_scheme_target    ON npc_schemes(target_kind, target_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_scheme_accomplices (
      scheme_id    TEXT    NOT NULL,
      npc_id       TEXT    NOT NULL,
      role         TEXT    NOT NULL DEFAULT 'aide',
      added_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (scheme_id, npc_id)
    );
    CREATE INDEX IF NOT EXISTS idx_acc_scheme ON npc_scheme_accomplices(scheme_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_scheme_evidence (
      id                 TEXT    PRIMARY KEY,
      scheme_id          TEXT    NOT NULL,
      evidence_kind      TEXT    NOT NULL,
      detail             TEXT,
      discovered_by_user TEXT,
      created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      discovered_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_evid_scheme ON npc_scheme_evidence(scheme_id);
    CREATE INDEX IF NOT EXISTS idx_evid_user   ON npc_scheme_evidence(discovered_by_user);
  `);
}

export function down(_db) {
  // Forward-only — scheme history is the substrate.
}
