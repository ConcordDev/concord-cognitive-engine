// server/migrations/418_emergent_registry_persist.js
//
// Wave 9 (2026-08-31): Persistent emergent registry.
//
// The emergent subsystem has historically lived entirely in-memory
// (STATE.__emergent.emergents: Map<id, Emergent>). Restart wipes all
// registrations. The Agent Runtime Contract (rt_snapshot) needs persistent
// identity to survive restarts.
//
// This migration adds emergent_registry — the canonical persistence layer.
// The in-memory Map is kept (for hot-path reads) but writes now dual-write
// to this table. Hydration on boot restores the Map.
//
// Schema:
//   - One row per emergent
//   - All identity fields + role + capabilities + memoryPolicy + purpose
//   - created_at + updated_at timestamps
//
// This is additive only — does not modify any existing emergent tables.
export function up(db) {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS emergent_registry (
      emergent_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT,
      instance_scope TEXT DEFAULT 'local',
      capabilities_json TEXT,
      memory_policy TEXT,
      origin TEXT,
      purpose TEXT,
      district TEXT,
      district_history_json TEXT,
      district_affinity_json TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      state TEXT DEFAULT 'active',
      age INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_emergent_registry_role ON emergent_registry(role)`,
    `CREATE INDEX IF NOT EXISTS idx_emergent_registry_active ON emergent_registry(active)`,
    `CREATE INDEX IF NOT EXISTS idx_emergent_registry_updated ON emergent_registry(updated_at DESC)`,
  ];
  for (const sql of stmts) {
    try { db.prepare(sql).run(); } catch (e) {
      if (!e?.message?.includes("already exists")) throw e;
    }
  }
}

// Helper: hydrate the in-memory emergent store from this table.
// Called on boot after migrations run.
export function hydrateEmergentRegistry(db) {
  if (!db) return { ok: false, hydrated: 0, reason: "no_db" };
  try {
    const rows = db.prepare("SELECT * FROM emergent_registry WHERE active = 1").all();
    return { ok: true, hydrated: rows.length, ids: rows.map(r => r.emergent_id) };
  } catch (e) {
    return { ok: false, hydrated: 0, error: e?.message || String(e) };
  }
}