// server/migrations/167_cross_world_relationships.js
//
// Cross-world relationship graph + parallel cross-world scheme table —
// sprint 2 of the multi-world parity sequence.
//
// Boundary discipline: rather than adding `if (crossWorld)` branches to
// `npc_schemes` / `character_opinions` (the "almost-works trap"), we
// keep the existing single-world tables untouched and ship parallel
// cross-world tables that REQUIRE both world IDs explicitly.
//
// Three new tables:
//
//   1. cross_npc_relationships — per (from_world, from_npc, to_world,
//      to_npc) edge with kind + resonance_strength. Seeded from authored
//      `concord_link_resonance` fields on world NPC rosters; the runtime
//      adds new edges as players carry messages between worlds.
//
//   2. cross_world_schemes — parallel scheme state machine with explicit
//      plotter_world_id + target_world_id. CHECK constraint forces
//      different worlds (boundary discipline).
//
//   3. cross_world_scheme_consequences — append-only ledger of every
//      mutation a cross-world scheme inflicted on either world. The
//      acceptance test reads this table to confirm consequences
//      propagated to BOTH worlds (not just the target side).
//
// All cross-world ops must consult cross_world_kill_switch (mig 166).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cross_npc_relationships (
      from_world_id      TEXT    NOT NULL,
      from_npc_id        TEXT    NOT NULL,
      to_world_id        TEXT    NOT NULL,
      to_npc_id          TEXT    NOT NULL,
      kind               TEXT    NOT NULL DEFAULT 'correspondent'
                                 CHECK (kind IN
                                 ('correspondent','rival','mirror','blood_rune',
                                  'contracted','mentor','apprentice','unknown_to_each_other')),
      resonance_strength INTEGER NOT NULL DEFAULT 50
                                 CHECK (resonance_strength BETWEEN 0 AND 100),
      established_via    TEXT,
      authored           INTEGER NOT NULL DEFAULT 0,
      established_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      last_signal_at     INTEGER,
      PRIMARY KEY (from_world_id, from_npc_id, to_world_id, to_npc_id),
      CHECK (from_world_id <> to_world_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_xrel_from ON cross_npc_relationships(from_world_id, from_npc_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_xrel_to   ON cross_npc_relationships(to_world_id, to_npc_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_xrel_kind ON cross_npc_relationships(kind)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cross_world_schemes (
      id                TEXT    PRIMARY KEY,
      plotter_world_id  TEXT    NOT NULL,
      plotter_kind      TEXT    NOT NULL DEFAULT 'npc'
                                CHECK (plotter_kind IN ('npc','player')),
      plotter_id        TEXT    NOT NULL,
      target_world_id   TEXT    NOT NULL,
      target_kind       TEXT    NOT NULL CHECK (target_kind IN
                                ('npc','player','faction','kingdom')),
      target_id         TEXT    NOT NULL,
      kind              TEXT    NOT NULL CHECK (kind IN
                                ('assassinate','seduce','fabricate_secret',
                                 'claim_inheritance','blackmail','sabotage_decree')),
      phase             TEXT    NOT NULL DEFAULT 'planning'
                                CHECK (phase IN
                                ('planning','recruiting','gathering_evidence',
                                 'moving','exposed','complete','abandoned')),
      success_pct       INTEGER NOT NULL DEFAULT 20
                                CHECK (success_pct BETWEEN 0 AND 100),
      discovery_pct     INTEGER NOT NULL DEFAULT 15
                                CHECK (discovery_pct BETWEEN 0 AND 100),
      evidence_count    INTEGER NOT NULL DEFAULT 0,
      accomplice_count  INTEGER NOT NULL DEFAULT 0,
      meta_json         TEXT,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      next_tick_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at       INTEGER,
      CHECK (plotter_world_id <> target_world_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_xsch_phase   ON cross_world_schemes(phase, next_tick_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_xsch_plotter ON cross_world_schemes(plotter_world_id, plotter_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_xsch_target  ON cross_world_schemes(target_world_id, target_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cross_world_scheme_consequences (
      id                   TEXT    PRIMARY KEY,
      scheme_id            TEXT    NOT NULL,
      affected_world_id    TEXT    NOT NULL,
      consequence_kind     TEXT    NOT NULL CHECK (consequence_kind IN
                                   ('opinion_shift','death','secret_planted',
                                    'inheritance_claim','discovery','signal_carried',
                                    'plot_exposed')),
      affected_entity_kind TEXT    NOT NULL,
      affected_entity_id   TEXT    NOT NULL,
      detail               TEXT,
      applied_at           INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_xcon_scheme ON cross_world_scheme_consequences(scheme_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_xcon_world  ON cross_world_scheme_consequences(affected_world_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_xcon_entity ON cross_world_scheme_consequences(affected_entity_kind, affected_entity_id)`);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS cross_world_scheme_consequences`);
  db.exec(`DROP TABLE IF EXISTS cross_world_schemes`);
  db.exec(`DROP TABLE IF EXISTS cross_npc_relationships`);
}
