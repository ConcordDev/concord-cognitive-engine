// server/migrations/081_vehicles.js
//
// Player-controlled vehicles: cars, gliders, planes. Phase D of the unified
// implementation plan adds support for big worlds (~20km) where walking-only
// movement breaks down. Vehicles are kinematic on the client, server-validated
// against authoritative speed tiers in city-presence.js.
//
// Schema:
//   vehicles: id, owner_id, world, type, pose JSON, fuel, durability, ...
//   player_world_state.vehicle_id / vehicle_type — the player's current ride.
//
// Vehicle types and authoritative max speeds (m/s) are encoded in
// city-presence.js (server source of truth), not in the schema, so a
// migration isn't needed to introduce a new vehicle class — just add the
// type to the speed table and validate.

export function up(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id            TEXT PRIMARY KEY,
        owner_id      TEXT NOT NULL,
        world         TEXT NOT NULL DEFAULT 'concordia',
        type          TEXT NOT NULL DEFAULT 'car'
                         CHECK (type IN ('car', 'glider', 'plane')),
        pose_json     TEXT NOT NULL DEFAULT '{"x":0,"y":0,"z":0,"rx":0,"ry":0,"rz":0}',
        fuel          REAL NOT NULL DEFAULT 100,
        durability    REAL NOT NULL DEFAULT 100,
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_vehicles_owner_world ON vehicles(owner_id, world, is_active)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_vehicles_world      ON vehicles(world, is_active)`);
  } catch (e) { if (!/already exists/i.test(e?.message || "")) throw e; }

  // Add vehicle columns to player_world_state.
  for (const stmt of [
    "ALTER TABLE player_world_state ADD COLUMN vehicle_id   TEXT",
    "ALTER TABLE player_world_state ADD COLUMN vehicle_type TEXT",
    "ALTER TABLE player_world_state ADD COLUMN vehicle_pose_json TEXT",
  ]) {
    try { db.exec(stmt); }
    catch (e) { if (!/duplicate column/i.test(e?.message || "")) throw e; }
  }
}
