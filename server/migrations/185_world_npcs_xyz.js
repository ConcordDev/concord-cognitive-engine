// server/migrations/185_world_npcs_xyz.js
//
// Add explicit x, y, z REAL columns to world_npcs. Many emergent
// modules and routes (fauna-spawner, creature-behaviors, nemesis,
// per-world npc proximity, combat reach validator, dialogue raycaster,
// activity-tag layer) query directly against world_npcs.x / .z. The
// JSON-encoded spawn_location / current_location columns held the
// truth so far, but every consumer was silently failing — the spawner
// inserts had a try/catch that masked it, so creatures never landed
// in world_npcs at all.
//
// This migration adds the columns + backfills from current_location
// (preferred) or spawn_location.

export function up(db) {
  const cols = db.prepare("PRAGMA table_info(world_npcs)").all().map(c => c.name);
  for (const c of ["x", "y", "z"]) {
    if (!cols.includes(c)) {
      db.exec(`ALTER TABLE world_npcs ADD COLUMN ${c} REAL`);
    }
  }
  // species_id — fauna-spawner uses this distinct from generic `species`
  // (which serves the family-tree lineage). Adding so creature INSERTs
  // succeed. Backfill from species if it happens to have the species id.
  if (!cols.includes("species_id")) {
    db.exec(`ALTER TABLE world_npcs ADD COLUMN species_id TEXT`);
    try {
      db.exec(`UPDATE world_npcs SET species_id = species WHERE species_id IS NULL AND species IS NOT NULL`);
    } catch { /* best-effort */ }
  }
  // Backfill from JSON-encoded location fields. Safe to re-run.
  try {
    const rows = db.prepare(`
      SELECT id, current_location, spawn_location FROM world_npcs
      WHERE x IS NULL OR z IS NULL
    `).all();
    const update = db.prepare(`UPDATE world_npcs SET x = ?, y = ?, z = ? WHERE id = ?`);
    const tx = db.transaction(() => {
      for (const r of rows) {
        let parsed = null;
        for (const src of [r.current_location, r.spawn_location]) {
          if (!src) continue;
          try { const j = JSON.parse(src); if (typeof j?.x === "number" && typeof j?.z === "number") { parsed = j; break; } }
          catch { /* skip */ }
        }
        if (parsed) update.run(parsed.x, parsed.y ?? 0, parsed.z, r.id);
      }
    });
    tx();
  } catch { /* best-effort backfill */ }
  // Indexes for proximity queries.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_world_npcs_world_pos ON world_npcs(world_id, x, z)`);
}

export function down(_db) {
  // Forward-only.
}
