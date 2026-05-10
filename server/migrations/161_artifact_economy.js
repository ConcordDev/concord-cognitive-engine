// server/migrations/161_artifact_economy.js
//
// Phase 9.1 — Tradeable artifact economy.
//
//   - npc_autobiography_dtus: log of composed NPC autobiographies
//     (one per NPC per ~year of in-game state). Idempotent on
//     (npc_id, generation).
//   - npc_persona_packages: serialised NPC bundles (grudges + schemes
//     + schedules + asymmetry + traits) packaged as kind='npc_persona'
//     DTUs for cross-world import.
//   - compression_art_sigils: deterministic 3D sigil descriptors
//     derived from a MEGA / HYPER DTU's source-DTU embedding cluster.
//   - inheritance_market_listings: pre-mortem listings letting players
//     buy heir slots from a dying NPC's mentor.
//
// All append-only / lazy-CREATE friendly. Pre-existing data unaffected.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_autobiography_dtus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      npc_id TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1,
      dtu_id TEXT NOT NULL,
      composer TEXT NOT NULL DEFAULT 'deterministic',
      composed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(npc_id, generation)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_npc_autobio_npc ON npc_autobiography_dtus(npc_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_persona_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin_npc_id TEXT NOT NULL,
      author_user_id TEXT NOT NULL,
      dtu_id TEXT NOT NULL,
      package_sha256 TEXT NOT NULL,
      includes_grudges INTEGER NOT NULL DEFAULT 1,
      includes_schemes INTEGER NOT NULL DEFAULT 1,
      includes_schedule INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_persona_author ON npc_persona_packages(author_user_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS compression_art_sigils (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mega_dtu_id TEXT NOT NULL UNIQUE,
      tier TEXT NOT NULL,
      shape_seed TEXT NOT NULL,
      cluster_centroid_json TEXT,
      dominant_element TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS inheritance_market_listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dying_npc_id TEXT NOT NULL,
      mentor_user_id TEXT NOT NULL,
      heir_slot_price_cc INTEGER NOT NULL,
      buyer_user_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      listed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      claimed_at INTEGER,
      resolved_at INTEGER
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_inherit_mkt_status ON inheritance_market_listings(status)`);
}
