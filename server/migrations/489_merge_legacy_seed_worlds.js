// Merge the legacy seed worlds into the authored regions (owner decision
// 2026-10-23).
//
// lib/world-seed.js created six "canonical" worlds before the authored
// megaworld regions existed. Three duplicate an authored region — crime-city
// (crime), superhero-world (superhero), fable-world (fantasy) — and two have
// no counterpart (war-zone, wasteland-world). The Unity client and authored
// content use the regions; no player ever entered the legacy worlds, yet each
// was simulated every tick. 45 NPCs also sat under a bare "concordia" id with
// no world row.
//
// Abandon != delete (docs/CONCORDIA_PERSISTENT_MEGAWORLD.md): nothing is
// removed. The legacy worlds' people move into the matching region — with
// their jobs, conversations and any quests they posted — and the old world
// rows are marked 'merged' / 'retired', which stops them being simulated
// (NPC simulators run for status = 'active' only). Buildings, resource nodes,
// creatures, signals and DTUs stay with the old world as its history. None of
// the moved NPCs had a home building, so no home pointer is stranded.
// war-zone and wasteland-world keep their NPCs, dormant and queryable.

const MERGES = [
  ["crime-city", "crime"],
  ["superhero-world", "superhero"],
  ["fable-world", "fantasy"],
  ["concordia", "concordia-hub"],
];
const RETIRE = ["war-zone", "wasteland-world"];

function hasColumn(db, table, column) {
  const t = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return !!t && !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
}

export function up(db) {
  if (!hasColumn(db, "world_npcs", "world_id")) return;
  const exists = (id) => hasColumn(db, "worlds", "id") && !!db.prepare("SELECT 1 FROM worlds WHERE id = ?").get(id);
  const hasMigratedAt = hasColumn(db, "world_npcs", "migrated_at");
  const hasHome = hasColumn(db, "world_npcs", "home_world_id");

  for (const [from, to] of MERGES) {
    // Only merge into a region that exists on this install.
    if (!exists(to)) continue;
    const moved = db.prepare("SELECT id FROM world_npcs WHERE world_id = ?").all(from).map((r) => r.id);
    if (moved.length) {
      db.prepare(`
        UPDATE world_npcs
           SET world_id = ?
               ${hasHome ? ", home_world_id = CASE WHEN home_world_id = ? THEN ? ELSE home_world_id END" : ""}
               ${hasMigratedAt ? ", migrated_at = unixepoch()" : ""}
         WHERE world_id = ?
      `).run(...(hasHome ? [to, from, to, from] : [to, from]));
      if (hasColumn(db, "npc_jobs", "world_id")) db.prepare("UPDATE npc_jobs SET world_id = ? WHERE world_id = ?").run(to, from);
      if (hasColumn(db, "npc_conversations", "world_id")) db.prepare("UPDATE npc_conversations SET world_id = ? WHERE world_id = ?").run(to, from);
      if (hasColumn(db, "world_quests", "giver_npc_id")) {
        db.prepare(`UPDATE world_quests SET world_id = ? WHERE world_id = ? AND giver_npc_id IN (SELECT id FROM world_npcs WHERE world_id = ?)`).run(to, from, to);
      }
    }
    if (exists(from)) db.prepare("UPDATE worlds SET status = 'merged' WHERE id = ?").run(from);
  }
  for (const id of RETIRE) {
    if (exists(id)) db.prepare("UPDATE worlds SET status = 'retired' WHERE id = ? AND status = 'active'").run(id);
  }
}

export function down() {
  // Not reversible automatically; the pre-deploy DB clone is the restore point.
}

export const description = "Merge legacy seed worlds into authored regions; retire war-zone and wasteland-world";
