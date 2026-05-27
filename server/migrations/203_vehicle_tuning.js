// server/migrations/203_vehicle_tuning.js
//
// Phase II Wave 15 — vehicle customization substrate.
//
// Extends world_vehicles:
//   - tuning_json TEXT — manifest of currently-installed parts per slot
//                       { engine?: partId, suspension?: partId, ... }
//   - paint_color TEXT — hex string for the body fill
//   - decal_json  TEXT — array of decal layers (each a stamped DTU)
//
// New tables:
//   - vehicle_parts_catalog  — every authored or marketplace-listed part
//   - vehicle_installations  — fact table of vehicle × slot × part
//
// Each part is also registered in dtus (kind='vehicle_part') so the
// royalty cascade tracks every derivative — players can fork a part
// design, refine it, and the original author still earns from sales.
//
// Modern vehicle kinds (car/motorcycle/hovercraft/spaceship) are
// admitted via a separate CHECK extension since the original mig 177
// only allowed cart/boat/canal_taxi. The kinds chosen here cover the
// research targets (Forza-style cars + Tokyo-style street cars + a
// future-flavor hovercraft + sci-fi spaceship).

export function up(db) {
  // 1) Extend world_vehicles.kind CHECK to admit modern + speculative kinds.
  //    Use the rename-and-rebuild dance per mig 100 since SQLite can't
  //    ALTER CHECK in place.
  const fkBefore  = db.pragma("foreign_keys", { simple: true });
  const altBefore = db.pragma("legacy_alter_table", { simple: true });
  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");

  try {
    // Probe: does the new kind 'car' already pass? If so, skip rebuild.
    let needsRebuild = true;
    try {
      const probeStmt = db.prepare(`
        INSERT INTO world_vehicles (id, world_id, kind, owner_kind, owner_id)
        VALUES ('__probe_car__', '__probe__', 'car', 'none', '')
      `);
      probeStmt.run();
      db.prepare(`DELETE FROM world_vehicles WHERE id = '__probe_car__'`).run();
      needsRebuild = false;
    } catch {
      /* CHECK rejected — rebuild */
    }

    if (needsRebuild) {
      db.exec("ALTER TABLE world_vehicles RENAME TO world_vehicles_v177");
      db.exec(`
        CREATE TABLE world_vehicles (
          id            TEXT    PRIMARY KEY,
          world_id      TEXT    NOT NULL,
          kind          TEXT    NOT NULL CHECK (kind IN (
            'cart','boat','canal_taxi',
            'car','motorcycle','hovercraft','spaceship'
          )),
          owner_kind    TEXT    NOT NULL CHECK (owner_kind IN ('player','realm','npc','none')),
          owner_id      TEXT    NOT NULL DEFAULT '',
          capacity      INTEGER NOT NULL DEFAULT 2 CHECK (capacity BETWEEN 1 AND 12),
          fare_cc       INTEGER NOT NULL DEFAULT 0 CHECK (fare_cc >= 0),
          route_id      TEXT,
          pos_x         REAL    NOT NULL DEFAULT 0,
          pos_y         REAL    NOT NULL DEFAULT 0,
          pos_z         REAL    NOT NULL DEFAULT 0,
          heading       REAL    NOT NULL DEFAULT 0,
          condition_pct INTEGER NOT NULL DEFAULT 100
                        CHECK (condition_pct BETWEEN 0 AND 100),
          tuning_json   TEXT    NOT NULL DEFAULT '{}',
          paint_color   TEXT    NOT NULL DEFAULT '#888888',
          decal_json    TEXT    NOT NULL DEFAULT '[]',
          created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);
      db.exec(`
        INSERT INTO world_vehicles
          (id, world_id, kind, owner_kind, owner_id, capacity, fare_cc,
           route_id, pos_x, pos_y, pos_z, heading, condition_pct, created_at,
           updated_at)
        SELECT
          id, world_id, kind, owner_kind, owner_id, capacity, fare_cc,
          route_id, pos_x, pos_y, pos_z, heading, condition_pct, created_at,
          COALESCE(updated_at, created_at)
        FROM world_vehicles_v177
      `);
      db.exec("DROP TABLE world_vehicles_v177");
      db.exec(`CREATE INDEX IF NOT EXISTS idx_world_vehicles_world ON world_vehicles (world_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_world_vehicles_owner ON world_vehicles (owner_kind, owner_id)`);
    } else {
      // Just ensure new columns exist when CHECK already had them.
      const cols = db.prepare("PRAGMA table_info(world_vehicles)").all();
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has("tuning_json"))  db.exec("ALTER TABLE world_vehicles ADD COLUMN tuning_json TEXT NOT NULL DEFAULT '{}'");
      if (!colNames.has("paint_color"))  db.exec("ALTER TABLE world_vehicles ADD COLUMN paint_color TEXT NOT NULL DEFAULT '#888888'");
      if (!colNames.has("decal_json"))   db.exec("ALTER TABLE world_vehicles ADD COLUMN decal_json TEXT NOT NULL DEFAULT '[]'");
      if (!colNames.has("updated_at"))   db.exec("ALTER TABLE world_vehicles ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (unixepoch())");
    }

    // 2) Parts catalog. One row per part (author or marketplace listing).
    //    `manifest_json` carries the perf-delta + visual descriptor.
    //    `dtu_id` links to the royalty-cascade-tracked DTU. NULL until
    //    the part is published as a DTU; un-published parts are private.
    db.exec(`
      CREATE TABLE IF NOT EXISTS vehicle_parts_catalog (
        id              TEXT    PRIMARY KEY,
        author_user_id  TEXT    NOT NULL,
        vehicle_kind    TEXT    NOT NULL CHECK (vehicle_kind IN (
                                  'cart','boat','canal_taxi',
                                  'car','motorcycle','hovercraft','spaceship'
                                )),
        slot            TEXT    NOT NULL CHECK (slot IN (
                                  'engine','induction','exhaust','gearbox','drivetrain',
                                  'suspension','brakes','tires','aero','body_kit',
                                  'paint','livery','interior','accessory'
                                )),
        name            TEXT    NOT NULL,
        description     TEXT    NOT NULL DEFAULT '',
        manifest_json   TEXT    NOT NULL DEFAULT '{}',
        dtu_id          TEXT,
        listed_cents    INTEGER NOT NULL DEFAULT 0
                        CHECK (listed_cents >= 0),
        visibility      TEXT    NOT NULL DEFAULT 'private'
                        CHECK (visibility IN ('private','public','marketplace')),
        created_at      INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_vehicle_parts_kind_slot ON vehicle_parts_catalog (vehicle_kind, slot)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_vehicle_parts_author ON vehicle_parts_catalog (author_user_id, created_at DESC)`);

    // 3) Installations — fact table of vehicle × slot × part.
    db.exec(`
      CREATE TABLE IF NOT EXISTS vehicle_installations (
        vehicle_id   TEXT    NOT NULL,
        slot         TEXT    NOT NULL,
        part_id      TEXT    NOT NULL,
        installed_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (vehicle_id, slot)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_vehicle_installations_part ON vehicle_installations (part_id)`);
  } finally {
    db.pragma(`legacy_alter_table = ${altBefore ? "ON" : "OFF"}`);
    db.pragma(`foreign_keys = ${fkBefore ? "ON" : "OFF"}`);
  }
}

export const description = "Phase II Wave 15 — vehicle customization: parts catalog + installations + extended kinds";
