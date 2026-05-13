// server/migrations/177_world_vehicles.js
//
// Concordia Phase 6 — world vehicles substrate.
//
// Pre-industrial only (animal-drawn or wind-driven). 3 archetypes:
//   - cart      (animal-drawn, 1-4 occupants + cargo, ground)
//   - boat      (wind/oar, 2-8 occupants, water)
//   - canal_taxi (rail-following along authored waterway, fare-based)
//
// Per-world entity. Owner is either a user_id (owned vehicle) or a
// realm_id (public canal taxi). Position + heading are written by
// the client's physics tick + reconciled against capacity / fare /
// realm-access checks server-side.
//
// `route_id` is optional and refers to authored transport_routes
// from mig 166 (cross-world economy). Canal taxis MUST have a route_id.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_vehicles (
      id            TEXT    PRIMARY KEY,
      world_id      TEXT    NOT NULL,
      kind          TEXT    NOT NULL CHECK (kind IN ('cart','boat','canal_taxi')),
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
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vehicle_world_kind ON world_vehicles(world_id, kind)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vehicle_owner ON world_vehicles(owner_kind, owner_id)`);

  // Many-to-many: who's currently riding which vehicle.
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicle_occupants (
      vehicle_id     TEXT    NOT NULL,
      occupant_kind  TEXT    NOT NULL CHECK (occupant_kind IN ('player','npc')),
      occupant_id    TEXT    NOT NULL,
      seat           INTEGER NOT NULL DEFAULT 0,
      boarded_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (vehicle_id, occupant_kind, occupant_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vehicle_occ_vehicle ON vehicle_occupants(vehicle_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vehicle_occ_who ON vehicle_occupants(occupant_kind, occupant_id)`);
}

export function down(_db) {
  // Forward-only.
}
