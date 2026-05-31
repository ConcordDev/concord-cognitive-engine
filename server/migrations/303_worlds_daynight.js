// server/migrations/303_worlds_daynight.js
//
// Persisted day/night + weather on worlds.
//
// The environment-sensor heartbeat + the embodied environment sensor read
// worlds.time_of_day_s / time_of_day / weather_state (behind try/catch guards
// that always fell to computed defaults because the columns didn't exist). This
// adds them so the sensor can WRITE the live day-night clock + weather each
// cycle and other systems / the frontend can read a world's current phase from
// the DB. The producer is environment-sensor.js (this migration is the column).

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}
function addColumn(db, table, col, ddl) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) return;
  if (!columnExists(db, table, col)) { try { db.exec(ddl); } catch { /* noop */ } }
}

export function up(db) {
  addColumn(db, "worlds", "time_of_day_s", "ALTER TABLE worlds ADD COLUMN time_of_day_s REAL");
  addColumn(db, "worlds", "time_of_day", "ALTER TABLE worlds ADD COLUMN time_of_day TEXT");
  addColumn(db, "worlds", "weather_state", "ALTER TABLE worlds ADD COLUMN weather_state TEXT");
}

export function down(_db) {
  // forward-only
}
