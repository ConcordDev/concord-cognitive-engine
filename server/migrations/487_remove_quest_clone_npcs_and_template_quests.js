// One-time clean-up of what the old quest-emergence loop left behind
// (owner-approved 2026-10-23).
//
// The old generator posted a new "Help <archetype> with <need>" quest every
// time an NPC's need dipped (live: 53,935 open, none ever accepted), and for
// 1 in 5 it spawned a new NPC named after the last word of the title. Live
// that left 10,802 such NPCs — 10,796 named "social", none with a backstory —
// that every world simulated every tick. The generator is fixed in the same
// change (lib/quest-emergence.js); this removes the leftovers.
//
// Removed:
//   - NPCs spawned by a quest that have no authored narrative (the clones),
//     including the ones later "recruited" to another world;
//   - still-available template quests, and any still-available quest whose
//     giver or spawned NPC was a clone — never a quest a player accepted;
//   - the clones' jobs, schedules, routine state, opinions and conversations,
//     and the removed quests' objective / reward rows.
// Kept: npc_skill_acquisitions (economy history) and every row a player owns.
//
// Idempotent: a second run finds nothing. The deploy takes a full DB clone
// before boot, which is the restore point.

function hasTable(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}
function hasColumn(db, table, column) {
  return hasTable(db, table) && !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
}

export function up(db) {
  if (!hasColumn(db, "world_npcs", "spawned_by_quest")) return;

  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS _mig487_clones (id TEXT PRIMARY KEY);
    DELETE FROM _mig487_clones;
    INSERT OR IGNORE INTO _mig487_clones (id)
      SELECT id FROM world_npcs
       WHERE spawned_by_quest IS NOT NULL
         AND (narrative_context IS NULL OR narrative_context IN ('', '{}', 'null'));
  `);

  if (hasTable(db, "world_quests")) {
    const keepPlayer = hasTable(db, "player_quests") ? "AND id NOT IN (SELECT quest_id FROM player_quests)" : "";
    db.exec(`
      CREATE TEMP TABLE IF NOT EXISTS _mig487_quests (id TEXT PRIMARY KEY);
      DELETE FROM _mig487_quests;
      INSERT OR IGNORE INTO _mig487_quests (id)
        SELECT id FROM world_quests
         WHERE status = 'available'
           AND (title LIKE 'Help % with %'
                OR giver_npc_id IN (SELECT id FROM _mig487_clones)
                OR id IN (SELECT spawned_by_quest FROM world_npcs WHERE id IN (SELECT id FROM _mig487_clones)))
           ${keepPlayer};
    `);
    for (const t of ["quest_objectives", "quest_rewards"]) {
      if (hasColumn(db, t, "quest_id")) db.exec(`DELETE FROM ${t} WHERE quest_id IN (SELECT id FROM _mig487_quests)`);
    }
    db.exec("DELETE FROM world_quests WHERE id IN (SELECT id FROM _mig487_quests)");
    db.exec("DROP TABLE _mig487_quests");
  }

  for (const t of ["npc_jobs", "npc_schedules", "npc_routine_state"]) {
    if (hasColumn(db, t, "npc_id")) db.exec(`DELETE FROM ${t} WHERE npc_id IN (SELECT id FROM _mig487_clones)`);
  }
  if (hasColumn(db, "npc_opinions", "subject_id")) {
    db.exec(`DELETE FROM npc_opinions WHERE subject_id IN (SELECT id FROM _mig487_clones) OR target_id IN (SELECT id FROM _mig487_clones)`);
  }
  if (hasColumn(db, "npc_conversations", "npc_a")) {
    db.exec(`DELETE FROM npc_conversations WHERE npc_a IN (SELECT id FROM _mig487_clones) OR npc_b IN (SELECT id FROM _mig487_clones)`);
  }
  db.exec("DELETE FROM world_npcs WHERE id IN (SELECT id FROM _mig487_clones)");
  db.exec("DROP TABLE _mig487_clones");
}

export function down() {
  // Data removal. Restore from the pre-deploy DB clone if ever needed.
}

export const description = "Remove quest-spawned clone NPCs and abandoned template quests";
