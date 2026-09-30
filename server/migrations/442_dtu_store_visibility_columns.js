// Migration 442 — dtu_store visibility columns
//
// Concurrency Refactor Phase 3. `dtu_store` persisted `id/title/tier/scope/
// source/created_at/updated_at` as columns but the fields the DTU visibility
// filter (server.js `userVisibleDTUs` + `dtu.list`) needs — owner, visibility,
// privacy, federation tier, location, kind — lived only inside the `data` JSON
// blob, and that blob was frequently just `JSON.stringify(dtu.body)` (the
// dtu-store.js `sniffPayload` fallback), losing them entirely. That also meant
// `rehydrateFromSQLite()` (which requires a top-level `id`) silently dropped
// body-only rows on restart.
//
// This adds the missing columns + list indexes and backfills them from any
// `data` blob that is still a full DTU object. Body-only rows can't be
// recovered here (the data is gone) — the paired dtu-store.js fix makes `data`
// always the full DTU going forward, and the boot-time migrateMemoryToSQLite →
// rehydrate cycle re-persists every in-memory DTU with the columns populated.
//
// Idempotent: ALTER TABLE ADD COLUMN has no IF NOT EXISTS in SQLite, so each is
// guarded against "duplicate column name".

export function up(db) {
  const addCol = (name, type) => {
    try {
      db.exec(`ALTER TABLE dtu_store ADD COLUMN ${name} ${type}`);
    } catch (e) {
      if (!String(e?.message || "").includes("duplicate column")) throw e;
    }
  };

  // dtu_store may not exist yet on a truly fresh DB (initDTUStore creates it at
  // boot); the CREATE IF NOT EXISTS mirrors dtu-store.js so the migration is
  // safe to run in any order.
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtu_store (
      id TEXT PRIMARY KEY,
      title TEXT,
      tier TEXT DEFAULT 'regular',
      scope TEXT DEFAULT 'global',
      tags TEXT DEFAULT '[]',
      source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL,
      content_hash TEXT,
      compressed_size INTEGER,
      rights_id TEXT,
      payload_bytes BLOB,
      payload_kind TEXT DEFAULT 'text'
    );
  `);

  addCol("owner_user_id", "TEXT");
  addCol("visibility", "TEXT");
  addCol("privacy", "TEXT");
  addCol("federation_tier", "TEXT");
  addCol("location_regional", "TEXT");
  addCol("location_national", "TEXT");
  addCol("kind", "TEXT");

  db.exec(`CREATE INDEX IF NOT EXISTS idx_dtu_store_owner ON dtu_store(owner_user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_dtu_store_visibility ON dtu_store(visibility)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_dtu_store_list ON dtu_store(scope, tier, created_at DESC)`);

  // ── backfill from full-object data blobs ──────────────────────────────────
  let rows;
  try {
    rows = db.prepare(`SELECT id, data FROM dtu_store`).all();
  } catch {
    return; // empty / no table
  }
  if (!rows.length) return;

  const upd = db.prepare(`
    UPDATE dtu_store SET
      owner_user_id = ?, visibility = ?, privacy = ?, federation_tier = ?,
      location_regional = ?, location_national = ?, kind = ?
    WHERE id = ?
  `);
  const str = (v) => (typeof v === "string" && v ? v : null);
  const tx = db.transaction(() => {
    for (const r of rows) {
      let d;
      try {
        d = JSON.parse(r.data);
      } catch {
        continue;
      }
      if (!d || typeof d !== "object" || !d.id) continue; // body-only / corrupt
      upd.run(
        str(d.author) || str(d.ownerId) || str(d.userId) || str(d.createdBy),
        str(d.visibility),
        str(d.privacy),
        str(d.federation_tier) || str(d.federationTier),
        str(d.location_regional) || str(d.locationRegional),
        str(d.location_national) || str(d.locationNational),
        str(d.machine && d.machine.kind) || str(d.kind),
        r.id,
      );
    }
  });
  tx();
}

export function down(db) {
  // SQLite can't DROP COLUMN cleanly on old versions; leave the columns (they're
  // nullable and unused when the feature is off). Just drop the indexes.
  for (const idx of ["idx_dtu_store_owner", "idx_dtu_store_visibility", "idx_dtu_store_list"]) {
    try {
      db.exec(`DROP INDEX IF EXISTS ${idx}`);
    } catch {
      /* best effort */
    }
  }
}
