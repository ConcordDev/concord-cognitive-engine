// server/migrations/229_lattice_quest_dialogue.js
//
// Phase AE — Skyrim-radiant LLM dialogue for procgen quests.
// Add a single column to lattice_born_quests so the composer can
// persist the 3-part dialogue (opener / midline / closer) per quest.

export function up(db) {
  try {
    db.exec(`ALTER TABLE lattice_born_quests ADD COLUMN dialogue_json TEXT NULL;`);
  } catch (err) {
    if (!String(err?.message || "").includes("duplicate column")) {
      // Tolerate missing-table on minimal builds.
      if (!String(err?.message || "").includes("no such table")) throw err;
    }
  }
}

export function down(_db) {
  // SQLite older versions can't DROP COLUMN; leave in place on down.
}
