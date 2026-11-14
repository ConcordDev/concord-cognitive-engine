// server/migrations/505_world_vehicle_name_spec.js
//
// FIX-garage-001 — vehicles gain a name and a spec note. "Add to
// fleet" spawned an unnamed veh_* cart with no name/spec form, and
// the inspector had no edit: a player's own vehicles were
// indistinguishable rows. name/spec are free-text labels the owner
// sets at spawn and can edit later (garage.update, owner-gated in
// lib/world-vehicles.js).
//
// Guarded ALTERs in the 499/504 pattern so a partially-migrated DB
// stays bootable; both columns default to '' (existing rows read as
// unnamed, exactly as they were created).

export function up(db) {
  for (const [col, ddl] of [
    ["name", "ALTER TABLE world_vehicles ADD COLUMN name TEXT NOT NULL DEFAULT ''"],
    ["spec", "ALTER TABLE world_vehicles ADD COLUMN spec TEXT NOT NULL DEFAULT ''"],
  ]) {
    try {
      const cols = db.prepare(`PRAGMA table_info(world_vehicles)`).all();
      if (Array.isArray(cols) && cols.length && !cols.some((c) => c.name === col)) {
        db.exec(ddl);
      }
    } catch { /* table absent on a minimal build — spawn paths already tolerate it */ }
  }
}

export function down() {
  // SQLite cannot drop a column portably across versions; the columns
  // are inert when unused.
}
