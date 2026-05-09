// Migration 142 — Concordia Procedural Mount System Phase B1: data substrate.
//
// Wild creatures spawned by `server/lib/ecosystem/fauna-spawner.js` can
// be tamed (`server/lib/companions.js#attemptTame` already exists) and
// ridden as physics-aware mounts. This migration sets up the data layer
// only — taming + riding lands in B2, customization in B3, evolution +
// care in B4.
//
// Tables:
//   mount_species         — capability table per species (one row per
//                           species_id; static once seeded).
//   mount_gait_profiles   — per-species walk/trot/gallop cycle params
//                           consumed by quadruped-gait.ts on the client.
//   mounted_instances     — append-only-with-close ledger of mounting
//                           events. One open row per (rider, world).
//
// Schema extensions on `player_companions`:
//   mount_eligible INTEGER DEFAULT 0  — flagged by fauna-spawner when
//                                       species is in `mount_species`.
//   mount_state TEXT                  — JSON: { stamina, hunger, loyalty,
//                                       gait_skill }; computed lazily.
//
// CLAUDE.md invariant added by this phase:
//   Mounts and creatures share `world_npcs.id`; `mount_species` describes
//   species capability; a creature is mountable iff its
//   `creature_population.lifestyle.mountable === true` AND a `mount_species`
//   row exists for its species_id. Quadruped gait foot-slide must stay
//   < 2cm in stance phase.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mount_species (
      species_id              TEXT    PRIMARY KEY,
      display_name            TEXT    NOT NULL,
      size_class              TEXT    NOT NULL CHECK (size_class IN ('small', 'medium', 'large', 'huge')),
      base_speed_mps          REAL    NOT NULL CHECK (base_speed_mps > 0 AND base_speed_mps <= 30),
      base_stamina            REAL    NOT NULL CHECK (base_stamina > 0),
      carry_capacity_kg       REAL    NOT NULL CHECK (carry_capacity_kg > 0),
      gait_profile_id         TEXT,
      rider_seat_offset_json  TEXT    NOT NULL DEFAULT '{"x":0,"y":1.4,"z":0,"yaw":0}',
      saddle_anchor_bone      TEXT    NOT NULL DEFAULT 'spine_03',
      reins_anchor_bone       TEXT    NOT NULL DEFAULT 'head',
      flight_capable          INTEGER NOT NULL DEFAULT 0 CHECK (flight_capable IN (0, 1)),
      aesthetic_tags_json     TEXT    NOT NULL DEFAULT '[]',
      created_at              INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_mount_species_size  ON mount_species(size_class);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mount_gait_profiles (
      id                  TEXT    PRIMARY KEY,
      species_id          TEXT    NOT NULL REFERENCES mount_species(species_id),
      walk_cycle_json     TEXT    NOT NULL,
      trot_cycle_json     TEXT    NOT NULL,
      gallop_cycle_json   TEXT    NOT NULL,
      turn_radius_m       REAL    NOT NULL CHECK (turn_radius_m > 0),
      created_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_mount_gait_species ON mount_gait_profiles(species_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mounted_instances (
      id                    TEXT    PRIMARY KEY,
      rider_id              TEXT    NOT NULL,
      mount_companion_id    TEXT    NOT NULL,
      world_id              TEXT    NOT NULL DEFAULT 'concordia-hub',
      mounted_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      dismounted_at         INTEGER,
      seat_offset_json      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mounted_instances_rider_open
      ON mounted_instances(rider_id, world_id, dismounted_at);
    CREATE INDEX IF NOT EXISTS idx_mounted_instances_companion
      ON mounted_instances(mount_companion_id);
  `);

  // Extend player_companions. SQLite ALTER ADD COLUMN is safe on existing
  // rows — defaults populate retroactively.
  // Probe column existence first to keep migration idempotent on retry.
  const cols = db.prepare("PRAGMA table_info(player_companions)").all().map(c => c.name);
  if (!cols.includes("mount_eligible")) {
    db.exec(`ALTER TABLE player_companions ADD COLUMN mount_eligible INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.includes("mount_state")) {
    db.exec(`ALTER TABLE player_companions ADD COLUMN mount_state TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_player_companions_mount_eligible
           ON player_companions(mount_eligible) WHERE mount_eligible = 1`);
}

export function down(_db) { /* forward-only */ }
