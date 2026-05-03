// server/migrations/098_concordia_hub_id_reconciliation.js
//
// The hub world's id was historically 'concordia' in the authored content
// (_meta.json) but the runtime defaulted to 'concordia-hub' across most
// callsites. This migration backfills any rows that still carry the old
// id so the substrate is single-keyed going forward. _meta.json now
// declares world_id_aliases:['concordia'] for the seeder's benefit.
//
// Tables touched: any that have a world_id text column. The migration
// uses PRAGMA table_info to detect which tables exist (deployments may
// have only a subset of migrations applied) and only updates the ones
// that have the column.

const TABLES_WITH_WORLD_ID = [
  "world_npcs",
  "world_resource_nodes",
  "world_buildings",
  "creature_population",
  "creature_corpses",
  "npc_knowledge",
  "player_world_metrics",
  "world_events",
  "world_lore",
  "concord_link_walkers",
  "world_persistence",
  "dtus",
];

export function up(db) {
  for (const table of TABLES_WITH_WORLD_ID) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
      if (!cols.includes("world_id")) continue;
      db.prepare(`UPDATE ${table} SET world_id = 'concordia-hub' WHERE world_id = 'concordia'`).run();
    } catch { /* table may not exist on minimal builds — skip */ }
  }
}

export function down(_db) { /* sqlite — keep on rollback */ }
