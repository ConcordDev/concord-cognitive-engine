// server/lib/dtu-bridge/sqlite-target.js
//
// DTU bridge — wiring slice: the SQLite apply target.
//
// Slices 0–5 shipped the bridge as a library: pack envelope, outbox,
// conflict rule, apply engine — with only a memory target for tests
// and dry runs, and nothing in the server referencing any of it. This
// module is the target the apply engine drains into on a SQLite host:
// applied bridge records persist as version chains in
// dtu_bridge_records (bridge infrastructure — the bridge's local
// replica bookkeeping, deliberately NOT substrate; see
// substrate-registry.js).
//
// The target interface is apply.js's: getChain(table, id) returns the
// held versions root → head; putRecord(record) appends one version.
// Appends are idempotent on (table, id, contentHash) — re-applying a
// version the target already holds is a no-op, never a duplicate link.
// When the Postgres side exists (slice 6), a pg target implementing
// the same two functions swaps in behind the service unchanged.

export function createSqliteTarget(db) {
  if (!db) throw new TypeError("createSqliteTarget: a better-sqlite3 db handle is required");
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtu_bridge_records (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      dtu_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      parent_hash TEXT,
      signature TEXT,
      payload_json TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      UNIQUE(table_name, dtu_id, content_hash)
    )
  `);
  const chainStmt = db.prepare(
    "SELECT * FROM dtu_bridge_records WHERE table_name = ? AND dtu_id = ? ORDER BY row_id ASC"
  );
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO dtu_bridge_records
      (table_name, dtu_id, content_hash, parent_hash, signature, payload_json, applied_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const countStmt = db.prepare(
    "SELECT COUNT(DISTINCT table_name || ':' || dtu_id) AS n FROM dtu_bridge_records"
  );
  return {
    getChain(table, id) {
      return chainStmt.all(table, id).map((r) => ({
        table: r.table_name,
        id: r.dtu_id,
        payload: JSON.parse(r.payload_json),
        provenance: {
          contentHash: r.content_hash,
          parentHash: r.parent_hash,
          signature: r.signature,
        },
      }));
    },
    putRecord(rec) {
      insertStmt.run(
        rec.table,
        rec.id,
        rec.provenance.contentHash,
        rec.provenance.parentHash ?? null,
        rec.provenance.signature ?? null,
        JSON.stringify(rec.payload),
        Date.now()
      );
    },
    /** How many distinct (table, id) chains this target holds. */
    countChains() {
      return countStmt.get().n;
    },
  };
}
