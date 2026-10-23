// One hub id: "concordia-hub" (owner decision 2026-10-23; see lib/world-ids.js).
//
// Migration 098 moved hub data from the bare "concordia" id once, but code
// kept defaulting to "concordia", so the hub ran twice under two ids: every
// user's current_world was "concordia", the Link walkers lived there, and
// simulation tables gained a second hub copy. The code now uses
// HUB_WORLD_ID; this moves the data.
//
// Moved to "concordia-hub": users.current_world, Link walkers, NPCs,
// buildings, rooms, DTUs, zones, timeline history, and per-world rows
// (creature populations/homes, scarcity, economy state). Where the hub
// already has its own row under a unique key, the old row is kept under
// "concordia" as history (UPDATE OR IGNORE) — nothing is deleted.
// Left under "concordia" as inert history: generated mirrors the hub already
// has its own copy of (signal log, creature affect trace, boss schedule and
// runs). Moving them would double-count inside the hub.
//
// users.current_world and vehicles.world have DEFAULT 'concordia' from
// migrations 077 / 081; SQLite can't change a default without a table
// rebuild, so insert triggers map the old id instead.

const HUB = "concordia-hub";
const OLD = "concordia";

function hasColumn(db, table, column) {
  const t = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return !!t && !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
}

const MOVE = [
  ["users", "current_world"],
  ["concord_link_walkers", "home_world"],
  ["concord_link_walkers", "current_world"],
  ["world_npcs", "world_id"],
  ["world_npcs", "home_world_id"],
  ["world_buildings", "world_id"],
  ["building_rooms", "world_id"],
  ["dtus", "world_id"],
  ["event_timeline_log", "world_id"],
  ["world_zones", "world_id"],
  ["creature_population", "world_id"],
  ["creature_homes", "world_id"],
  ["regional_scarcity", "world_id"],
  ["world_economy_state", "world_id"],
  ["vehicles", "world"],
];

export function up(db) {
  for (const [table, col] of MOVE) {
    if (!hasColumn(db, table, col)) continue;
    db.prepare(`UPDATE OR IGNORE "${table}" SET "${col}" = ? WHERE "${col}" = ?`).run(HUB, OLD);
  }
  if (hasColumn(db, "users", "current_world")) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_users_hub_world_id
      AFTER INSERT ON users WHEN NEW.current_world = '${OLD}'
      BEGIN UPDATE users SET current_world = '${HUB}' WHERE rowid = NEW.rowid; END;
    `);
  }
  if (hasColumn(db, "vehicles", "world")) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_vehicles_hub_world_id
      AFTER INSERT ON vehicles WHEN NEW.world = '${OLD}'
      BEGIN UPDATE vehicles SET world = '${HUB}' WHERE rowid = NEW.rowid; END;
    `);
  }
}

export function down(db) {
  db.exec("DROP TRIGGER IF EXISTS trg_users_hub_world_id; DROP TRIGGER IF EXISTS trg_vehicles_hub_world_id;");
}

export const description = "Unify the hub world id on concordia-hub";
