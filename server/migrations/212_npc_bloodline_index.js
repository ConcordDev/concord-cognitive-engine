// server/migrations/212_npc_bloodline_index.js
//
// Phase H — bloodline indexes so the world-population-cycle's
// `linkBloodline` lookup stays sub-millisecond at 1000+ NPCs per world.
//
// npc_ancestry already exists (migration 173) but had no index on the
// columns we filter by. Without these, picking a random authored ancestor
// in a faction does a full table scan per spawned NPC.

export function up(db) {
  // Only create indexes if the underlying table exists — keeps minimal
  // builds happy.
  try {
    const hasAncestry = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'npc_ancestry'
    `).get();
    if (hasAncestry) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_npc_ancestry_bloodline ON npc_ancestry (primary_bloodline);
        CREATE INDEX IF NOT EXISTS idx_npc_ancestry_dilution ON npc_ancestry (dilution);
      `);
    }
  } catch { /* table doesn't exist on this build */ }

  // npc_inheritance_links exists at migration 133; ensure index for the
  // bloodline-kind lookups Phase H makes.
  try {
    const hasLinks = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'npc_inheritance_links'
    `).get();
    if (hasLinks) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_npc_inheritance_kind ON npc_inheritance_links (inherited_kind);
      `);
    }
  } catch { /* table doesn't exist on this build */ }
}

export function down(db) {
  try { db.exec(`DROP INDEX IF EXISTS idx_npc_ancestry_bloodline;`); } catch { /* idempotent */ }
  try { db.exec(`DROP INDEX IF EXISTS idx_npc_ancestry_dilution;`); } catch { /* idempotent */ }
  try { db.exec(`DROP INDEX IF EXISTS idx_npc_inheritance_kind;`); } catch { /* idempotent */ }
}
