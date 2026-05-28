// server/migrations/261_weaponise_triggers.js
//
// T2.1 — weaponise_at consumption.
//
// Authored NPCs carry `narrative_context.weaponise_at` — a one-line trigger
// describing WHEN the NPC's secret/leverage becomes active and WHAT happens
// ("Befriend Kit; the pact's details surface." / "Expose Jin and the patrol
// loses its only competent officer."). T1.3 already mined these for cold-start
// stress, but the trigger itself never fired at runtime — the authored payoff
// was dead content.
//
// This table persists the parsed trigger so it can fire exactly once. The
// parser (lib/embodied/weaponise-triggers.js) extracts a structured condition
// from the prose (befriend / convene / expose / cross_reference / narrative)
// and the content-seeder seeds one row per authored NPC that has a weaponise_at
// line. The signature UNIQUE makes seeding idempotent and firing once-only.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS weaponise_triggers (
      id               TEXT PRIMARY KEY,
      npc_id           TEXT NOT NULL,
      world_id         TEXT NOT NULL,
      trigger_kind     TEXT NOT NULL
                        CHECK (trigger_kind IN ('befriend','convene','expose','cross_reference','narrative')),
      requires_json    TEXT NOT NULL DEFAULT '{}',
      consequence_text TEXT NOT NULL,
      secret_excerpt   TEXT,
      signature        TEXT NOT NULL UNIQUE,
      fired_at         INTEGER,
      fired_by_user    TEXT,
      revelation_dtu   TEXT,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_weaponise_npc   ON weaponise_triggers(npc_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_weaponise_world ON weaponise_triggers(world_id, trigger_kind);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_weaponise_unfired ON weaponise_triggers(trigger_kind) WHERE fired_at IS NULL;`);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS weaponise_triggers;`);
}
