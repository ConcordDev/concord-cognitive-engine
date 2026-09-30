// server/migrations/453_compress_archived_dtus.js
//
// Archived DTUs (archived_dtus, dtu_store_archive) are now stored as gzip
// BLOBs in their `data` column (lib/dtu-at-rest.js). This compresses the rows
// written before that change. Readers accept both forms, so the migration is
// a space saving, not a format switch; re-running it skips rows that are
// already BLOBs. dtu_store_archive.compressed_size becomes the stored size.

import { packDtuData } from "../lib/dtu-at-rest.js";

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

function compressTable(db, table, { setCompressedSize }) {
  if (!tableExists(db, table)) return 0;
  const rows = db.prepare(`SELECT id, data FROM ${table} WHERE typeof(data) = 'text'`).all();
  const update = db.prepare(
    setCompressedSize
      ? `UPDATE ${table} SET data = ?, compressed_size = ? WHERE id = ?`
      : `UPDATE ${table} SET data = ? WHERE id = ?`,
  );
  for (const r of rows) {
    const packed = packDtuData(r.data);
    if (setCompressedSize) update.run(packed, packed.length, r.id);
    else update.run(packed, r.id);
  }
  return rows.length;
}

export function up(db) {
  db.transaction(() => {
    compressTable(db, "archived_dtus", { setCompressedSize: false });
    compressTable(db, "dtu_store_archive", { setCompressedSize: true });
  })();
}

export function down() {
  // Forward-only: readers handle compressed rows; decompressing would only cost space.
}

export const description = "Store archived DTU rows gzip-compressed";
