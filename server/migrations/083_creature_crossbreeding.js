// server/migrations/083_creature_crossbreeding.js
//
// Persistent storage for the creature crossbreeding system. Two tables:
//   creature_bonds   — pair-keyed bond strength + last_seen_at, decayed on
//                      heartbeat. When bond crosses a per-pair threshold,
//                      the pair becomes eligible to crossbreed.
//   creature_lineage — append-only record of every hybrid produced; tracks
//                      parents, generation, stability, cross_world flag,
//                      and the full blueprint JSON for replay.
//
// Cross-world hybrids are flagged so the narrative system can mark them
// as legendary events (Concord Link bridge produced this).

export function up(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS creature_bonds (
        a_id           TEXT NOT NULL,
        b_id           TEXT NOT NULL,
        world_a        TEXT,
        world_b        TEXT,
        bond           REAL NOT NULL DEFAULT 0,
        environment    TEXT,
        last_seen_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (a_id, b_id)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_creature_bonds_b   ON creature_bonds(b_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_creature_bonds_lvl ON creature_bonds(bond DESC)`);
  } catch (e) { if (!/already exists/i.test(e?.message || "")) throw e; }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS creature_lineage (
        child_id     TEXT PRIMARY KEY,
        parent_a     TEXT NOT NULL,
        parent_b     TEXT NOT NULL,
        generation   INTEGER NOT NULL DEFAULT 1,
        stability    REAL NOT NULL DEFAULT 0.5,
        cross_world  INTEGER NOT NULL DEFAULT 0,
        blueprint    TEXT,
        created_at   INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_creature_lineage_parent_a ON creature_lineage(parent_a)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_creature_lineage_parent_b ON creature_lineage(parent_b)`);
  } catch (e) { if (!/already exists/i.test(e?.message || "")) throw e; }
}
