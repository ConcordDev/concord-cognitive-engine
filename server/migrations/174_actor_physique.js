// server/migrations/174_actor_physique.js
//
// Concordia Phase 3 — actor physique substrate.
//
// Adds actor_physique: per-(actor_kind, actor_id) body mass + height
// + body-type tag. Used by routes/worlds.js#/combat/attack to
// modulate damage by attacker/target mass ratio (a 6'5" Sanguire
// brawler hitting a 5' Medici reads different from the inverse).
//
// `mass_kg` is the dominant signal — combat reads attacker.mass_kg /
// target.mass_kg, clamped to [0.7, 1.4] so the cap stays bounded and
// the multiplier never inverts (a 90kg fighter doesn't get *.7 vs a
// 60kg target; the inverse case gets *1.4 boost capped by the
// _validateDamageCap downstream).
//
// `body_type` aligns with combat-biomechanics.ts (slim/average/
// stocky/tall) so the client animation engine and server damage
// modulation read from the same row.
//
// Sensible defaults for unrecorded actors: mass_kg=75, height_m=1.75,
// body_type='average'. New character creation sets explicitly.
// Authored NPCs get seeded in content/world/**/npcs.json (Phase 14
// territory; this migration only creates the table).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS actor_physique (
      actor_kind     TEXT    NOT NULL CHECK (actor_kind IN ('player','npc')),
      actor_id       TEXT    NOT NULL,
      mass_kg        REAL    NOT NULL DEFAULT 75.0
                             CHECK (mass_kg BETWEEN 20 AND 300),
      height_m       REAL    NOT NULL DEFAULT 1.75
                             CHECK (height_m BETWEEN 0.8 AND 2.5),
      body_type      TEXT    NOT NULL DEFAULT 'average'
                             CHECK (body_type IN ('slim','average','stocky','tall')),
      updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (actor_kind, actor_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_actor_physique_kind ON actor_physique(actor_kind)`);
}

export function down(_db) {
  // Forward-only.
}
