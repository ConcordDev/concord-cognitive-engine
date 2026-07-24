// server/migrations/392_sovereign_spell_residue.js
//
// sovereign-ruins bespoke mechanic — "Still-Running Spells".
//
// Grounded in authored lore (see server/lib/sovereign-spells.js for the
// full citation trail + implementation):
//   - content/world/sovereign-ruins/factions.json "ruins_spell_spirits":
//     goal "Complete every spell that was cast before the Cascade. Some
//     have been completing for 200+ years."; controlled_districts
//     include "the_still_casting_quarter", "the_long_summons",
//     "the_endless_blessing_grove".
//   - content/world/sovereign-ruins/npcs.json "the_long_summons_spirit":
//     cast in Year 1 (Cascade era), still calling a dead recipient's
//     name once per diurnal 187 annums later; "If a player tells it
//     the recipient is dead, it accelerates the completion to within
//     an hour."
//   - npcs.json "spell_reader_iby": "This one is a binding. Older than
//     you. Walk around it." — spell-reading is a real, skill-gated act.
//   - npcs.json scavenger gear: spell_residue_detector_amateur_grade /
//     _master_grade; factions.json "ruins_scavenger_crews" fears
//     "a still-running spell that locks them in".
//   - factions.json "ruins_archivists": "Catalog every Refusal that has
//     ever been written into the Sovereign Archive" — cataloguing a
//     still-running spell is the Archivists' stated goal, applied to
//     this world's central hazard.
//   - meta.json primary_currencies: ["concord_coin", "memory_shards"]
//     — memory_shards is this world's own named currency; cataloguing/
//     completing a site is the mechanic that actually earns it (no
//     prior code implemented this currency at all).
//
// world_id is CHECK-constrained to 'sovereign-ruins' the same way
// migration 391 scoped crucible_observer_drift_log to lattice-crucible
// — the mechanic can never leak to another world even under a coding
// mistake upstream.

export function up(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS sovereign_spell_sites (
      id            TEXT PRIMARY KEY,
      world_id      TEXT NOT NULL CHECK (world_id = 'sovereign-ruins'),
      district      TEXT NOT NULL,
      spell_kind    TEXT NOT NULL CHECK (spell_kind IN ('binding', 'summons', 'blessing', 'curse')),
      age_annums    INTEGER NOT NULL DEFAULT 0,
      difficulty    INTEGER NOT NULL DEFAULT 1,
      stability     REAL NOT NULL DEFAULT 1.0 CHECK (stability >= 0 AND stability <= 1),
      status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'catalogued', 'dissipated')),
      x             REAL NOT NULL DEFAULT 0,
      z             REAL NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      dissipated_at INTEGER
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_sovereign_spell_sites_world_status
      ON sovereign_spell_sites(world_id, status)
  `).run();

  // Per-attempt log. Also the source of truth for "has this user
  // actually read this site" (a real precondition for cataloguing/
  // completing it) and for the per-user total memory_shards earned.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS sovereign_spell_reads (
      id              TEXT PRIMARY KEY,
      site_id         TEXT NOT NULL REFERENCES sovereign_spell_sites(id),
      user_id         TEXT NOT NULL,
      revealed        INTEGER NOT NULL DEFAULT 0 CHECK (revealed IN (0, 1)),
      shards_awarded  INTEGER NOT NULL DEFAULT 0,
      action          TEXT NOT NULL CHECK (action IN ('read', 'catalogue', 'complete')),
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_sovereign_spell_reads_site_user
      ON sovereign_spell_reads(site_id, user_id)
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_sovereign_spell_reads_user
      ON sovereign_spell_reads(user_id)
  `).run();
}
