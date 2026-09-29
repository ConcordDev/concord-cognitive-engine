// At-rest compression for cold DTU rows (archived_dtus, dtu_store_archive).
//
// Archived DTUs are kept whole so they can be rehydrated, but they are read
// rarely, so their JSON is stored gzip-compressed as a BLOB in the existing
// `data` column. Readers go through unpackDtuData(), which accepts both the
// compressed BLOB and legacy plain-text rows, so old and new rows coexist and
// no reader has to know which one it got.

import zlib from "node:zlib";

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/** JSON text → gzip Buffer (stored as a BLOB). */
export function packDtuData(json) {
  const text = typeof json === "string" ? json : JSON.stringify(json);
  return zlib.gzipSync(Buffer.from(text, "utf8"), { level: 9 });
}

/** Stored `data` value (gzip BLOB or legacy text) → JSON text. */
export function unpackDtuData(value) {
  if (value == null) return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buf = Buffer.from(value);
    if (buf.length >= 2 && buf[0] === GZIP_MAGIC_0 && buf[1] === GZIP_MAGIC_1) {
      return zlib.gunzipSync(buf).toString("utf8");
    }
    return buf.toString("utf8");
  }
  return value;
}

/** Bytes the JSON takes once compressed — the honest `compressed_size`. */
export function compressedByteLength(json) {
  return packDtuData(json).length;
}
