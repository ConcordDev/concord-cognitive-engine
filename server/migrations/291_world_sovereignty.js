// server/migrations/291_world_sovereignty.js
//
// Living Society — Phase 13: world-creation as the highest-stakes verb.
//
// The constitutional rule applied to creation itself: founding a world grants
// ZERO power. A world is a polity (raidable, contestable); its founder is a
// target. Two tiers (open moons vs operator-greenlit canon); a founding-grace
// window; conquerable but NEVER deletable (control transfers, the authored
// substrate is sacred).

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='worlds'").get()) return;
  const add = (col, ddl) => { if (!columnExists(db, "worlds", col)) { try { db.exec(`ALTER TABLE worlds ADD COLUMN ${col} ${ddl}`); } catch { /* noop */ } } };
  // 13a — two tiers (open | canon). Default open (fair, contestable).
  add("tier", "TEXT DEFAULT 'open'");
  add("sanctioned_by", "TEXT");
  // 13b — founding grace: a startup window where the founder's heart is protected.
  add("founder_grace_until", "INTEGER");
  // 13c — control vs founder: current_ruler can be conquered; created_by stays the
  // historical founder forever (topple, never erase).
  add("current_ruler_id", "TEXT");
  add("current_ruler_kind", "TEXT");
  add("conquered_at", "INTEGER");
  add("authored", "INTEGER DEFAULT 0"); // 1 = has authored substrate → sanctity invariant
}

export function down(_db) {
  // forward-only
}
