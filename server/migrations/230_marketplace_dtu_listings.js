// server/migrations/230_marketplace_dtu_listings.js
//
// Smoking-gun cleanup — STATE.marketplaceListings was an in-memory
// Map at server.js:34957, 43229, 45691, 45707, 45720, 45743, 45969,
// 46044, 46045. Every restart lost the marketplace. The pre-existing
// migration-001 marketplace_listings table has a narrower shape
// (price_cents + 4-state visibility CHECK), but the in-memory listing
// carries: sourceDtuId, sellerId, scope, domain, artifact JSON,
// qualityTier, qualityScore, price (float), currency, listedAt,
// downloads, ratings JSON, status="active", repairScore, repairFlags
// JSON. This migration adds a sibling table that matches the
// in-memory shape exactly so the swap is mechanical.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_dtu_listings (
      id              TEXT PRIMARY KEY,
      source_dtu_id   TEXT NOT NULL,
      seller_id       TEXT NOT NULL,
      scope           TEXT NOT NULL DEFAULT 'marketplace',
      title           TEXT NOT NULL,
      domain          TEXT,
      description     TEXT NOT NULL DEFAULT '',
      artifact_json   TEXT,                               -- {kind, url, mime, byteSize, …} or null
      quality_tier    TEXT,
      quality_score   REAL,
      price           REAL NOT NULL DEFAULT 0,
      currency        TEXT NOT NULL DEFAULT 'concord_coin',
      listed_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      downloads       INTEGER NOT NULL DEFAULT 0,
      ratings_json    TEXT NOT NULL DEFAULT '[]',         -- array of {userId, score, comment, at}
      status          TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','removed','sold_out','draft')),
      repair_score    REAL,
      repair_flags_json TEXT,
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_mdl_seller  ON marketplace_dtu_listings(seller_id, listed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mdl_status  ON marketplace_dtu_listings(status, listed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mdl_dtu     ON marketplace_dtu_listings(source_dtu_id);
    CREATE INDEX IF NOT EXISTS idx_mdl_domain  ON marketplace_dtu_listings(domain, listed_at DESC) WHERE domain IS NOT NULL;
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS marketplace_dtu_listings;`);
}
