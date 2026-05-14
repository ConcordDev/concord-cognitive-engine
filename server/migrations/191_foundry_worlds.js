// server/migrations/191_foundry_worlds.js
//
// Foundry (lens #66) — Phase 2. The worldspec persistence table.
//
// A foundry_worlds row is a game/world a user is building in the
// Foundry lens. worldspec_json holds the full composable-systems spec
// (see server/lib/foundry/worldspec.js). The publish pipeline (Phase 3)
// compiles a worldspec into a real `worlds` row and stores its id on
// published_world_id; the live-preview flow (Phase 5) uses a throwaway
// `worlds` row tracked on preview_world_id.
//
// Hybrid publish model: `promoted` 0 = config overlay (a worlds row
// driven by rule_modulators/physics_modulators, no authored content
// dir); 1 = promoted to a full first-class world node with persisted
// seed content. Phase 3 ships the overlay path; promotion lands later.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS foundry_worlds (
      id                 TEXT PRIMARY KEY,
      creator_id         TEXT NOT NULL,
      name               TEXT NOT NULL,
      description        TEXT,
      worldspec_json     TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'published')),
      published_world_id TEXT,
      preview_world_id   TEXT,
      promoted           INTEGER NOT NULL DEFAULT 0,
      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_foundry_worlds_creator ON foundry_worlds(creator_id, updated_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_foundry_worlds_status ON foundry_worlds(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_foundry_worlds_published ON foundry_worlds(published_world_id)`);
}

export function down(_db) { /* forward-only */ }
