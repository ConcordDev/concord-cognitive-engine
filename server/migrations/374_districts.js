// server/migrations/374_districts.js
//
// Districts as real 2D geometric regions with identity.
//
// Before this migration there was NO districts table: `district_id TEXT` is
// a bare foreign-key-ish tag scattered across `city_presence`, `ambient_chat`,
// friend-presence, etc., and `city-manager.js` only ever carried `districts`
// as an in-memory JSON array with no boundary geometry. That's enough for
// "which district is this player tagged as being in" but not enough for
// Godot Phase 2's need to render districts as legible, distinctly-lit 2D
// regions on the ground plane and answer "which district is THIS point in."
//
// This table is the geometric + identity source of truth for districts. It
// is additive — existing `district_id` tag columns elsewhere are completely
// unaffected; they may optionally resolve against this table's `id` going
// forward, but nothing here requires or rewrites them.
//
// Columns:
//   boundary_json  — JSON array of {x, z} polygon vertices in world-space
//                     (same x/z ground-plane convention as world_buildings —
//                     Y-up, so a district boundary is a polygon in the x/z
//                     plane with no y component).
//   palette_json   — {primary, secondary, accent} hex colors giving the
//                     district a distinct visual identity.
//   lighting_tag   — a named lighting preset (e.g. "warm_day", "night_glow")
//                     an engine-side renderer maps to an actual light rig.
//   elevation_hint — a rough terrain elevation for the district (informational
//                     only; the real heightfield is authoritative — this is a
//                     hint for camera/skybox tuning, not a physics value).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS districts (
      id              TEXT PRIMARY KEY,
      world_id        TEXT NOT NULL,
      name            TEXT NOT NULL,
      boundary_json   TEXT NOT NULL DEFAULT '[]',
      palette_json    TEXT NOT NULL DEFAULT '{}',
      lighting_tag    TEXT,
      elevation_hint  REAL NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_districts_world ON districts(world_id)`);
}

export const description = "Districts as real 2D geometric regions (boundary polygon + palette + lighting identity) — Godot Phase 2 prep";
