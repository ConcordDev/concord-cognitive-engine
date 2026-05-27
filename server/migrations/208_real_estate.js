// server/migrations/208_real_estate.js
//
// Phase II Wave 26 — building ownership / rental / property markets.
//
// Mig 135 added land_claims (stake the ground). This wave extends
// world_buildings with player ownership + deed DTU links, adds
// property_listings (for-sale market) + rental_agreements (recurring
// income for the landlord, sheltered by lease terms).

export function up(db) {
  const fkBefore  = db.pragma("foreign_keys", { simple: true });
  const altBefore = db.pragma("legacy_alter_table", { simple: true });
  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");

  try {
    // Add ownership columns to world_buildings if missing. world_buildings
    // schema may or may not exist depending on which migrations have run
    // in the deployed tree; we guard the ALTER per column.
    const buildingsExists = db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'world_buildings'`
    ).get();
    if (!buildingsExists) {
      // Minimal world_buildings table so the property substrate has
      // something to link against in test envs. Production envs will
      // already have the richer schema.
      db.exec(`
        CREATE TABLE world_buildings (
          id            TEXT PRIMARY KEY,
          world_id      TEXT NOT NULL,
          archetype     TEXT,
          owner_kind    TEXT NOT NULL DEFAULT 'realm'
                          CHECK (owner_kind IN ('realm','player','npc','none')),
          owner_id      TEXT,
          pos_x         REAL NOT NULL DEFAULT 0,
          pos_z         REAL NOT NULL DEFAULT 0,
          health_pct    REAL NOT NULL DEFAULT 100,
          created_at    INTEGER NOT NULL DEFAULT (unixepoch())
        );
      `);
    }

    // Add ownership-extension columns idempotently.
    const cols = db.prepare("PRAGMA table_info(world_buildings)").all();
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("deed_dtu_id"))      db.exec("ALTER TABLE world_buildings ADD COLUMN deed_dtu_id TEXT");
    if (!colNames.has("monthly_rent_cents")) db.exec("ALTER TABLE world_buildings ADD COLUMN monthly_rent_cents INTEGER NOT NULL DEFAULT 0");
    if (!colNames.has("for_sale_price_cents")) db.exec("ALTER TABLE world_buildings ADD COLUMN for_sale_price_cents INTEGER NOT NULL DEFAULT 0");
    if (!colNames.has("listed_at"))        db.exec("ALTER TABLE world_buildings ADD COLUMN listed_at INTEGER");

    // Listings: a row per active for-sale offer. Allows multiple historical
    // listings + price drops + history without losing data.
    db.exec(`
      CREATE TABLE IF NOT EXISTS property_listings (
        id              TEXT PRIMARY KEY,
        building_id     TEXT NOT NULL,
        seller_user_id  TEXT NOT NULL,
        price_cents     INTEGER NOT NULL CHECK (price_cents >= 0),
        listed_at       INTEGER NOT NULL DEFAULT (unixepoch()),
        delisted_at     INTEGER,
        sold_at         INTEGER,
        sold_to_user_id TEXT,
        sold_price_cents INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_property_listings_building ON property_listings (building_id, listed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_property_listings_seller   ON property_listings (seller_user_id, listed_at DESC);
    `);

    // Rental agreements: tenant pays landlord recurring rent. Auto-renews
    // every period_days; ends on dissolve.
    db.exec(`
      CREATE TABLE IF NOT EXISTS rental_agreements (
        id              TEXT PRIMARY KEY,
        building_id     TEXT NOT NULL,
        landlord_user_id TEXT NOT NULL,
        tenant_kind     TEXT NOT NULL CHECK (tenant_kind IN ('player','npc')),
        tenant_id       TEXT NOT NULL,
        rent_cents      INTEGER NOT NULL CHECK (rent_cents >= 0),
        period_days     INTEGER NOT NULL DEFAULT 30 CHECK (period_days >= 1 AND period_days <= 365),
        started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
        next_due_at     INTEGER NOT NULL,
        dissolved_at    INTEGER,
        last_paid_at    INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_rental_agreements_active ON rental_agreements (next_due_at, dissolved_at);
      CREATE INDEX IF NOT EXISTS idx_rental_agreements_landlord ON rental_agreements (landlord_user_id);
    `);
  } finally {
    db.pragma(`legacy_alter_table = ${altBefore ? "ON" : "OFF"}`);
    db.pragma(`foreign_keys = ${fkBefore ? "ON" : "OFF"}`);
  }
}

export const description = "Phase II Wave 26 — real estate: building ownership, property listings, rental agreements";
