import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { packDtuData, unpackDtuData, compressedByteLength } from "../lib/dtu-at-rest.js";
import { up } from "../migrations/453_compress_archived_dtus.js";
import { getDtuIncludingArchive } from "../lib/dtu-archive.js";

const dtu = { id: "d1", title: "Rigel", body: { claims: Array.from({ length: 20 }, (_, i) => `claim ${i} about the same star`) } };
const json = JSON.stringify(dtu);

test("pack/unpack round-trips and actually shrinks repetitive JSON", () => {
  const packed = packDtuData(json);
  assert.ok(Buffer.isBuffer(packed));
  assert.ok(packed.length < Buffer.byteLength(json) / 2, `${packed.length} vs ${json.length}`);
  assert.equal(unpackDtuData(packed), json);
  assert.equal(compressedByteLength(json), packed.length);
});

test("unpack passes legacy text rows and nulls through unchanged", () => {
  assert.equal(unpackDtuData(json), json);
  assert.equal(unpackDtuData(null), null);
  assert.equal(unpackDtuData(Buffer.from(json)), json);
});

test("migration 453 compresses legacy archive rows; readers still get the JSON", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE archived_dtus (id TEXT PRIMARY KEY, data TEXT NOT NULL);
           CREATE TABLE dtu_store (id TEXT PRIMARY KEY, data TEXT);
           CREATE TABLE dtu_store_archive (id TEXT PRIMARY KEY, data TEXT NOT NULL, compressed_size INTEGER);`);
  db.prepare("INSERT INTO archived_dtus VALUES ('d1', ?)").run(json);
  db.prepare("INSERT INTO dtu_store_archive VALUES ('d1', ?, ?)").run(json, json.length);

  up(db);
  up(db); // idempotent: already-compressed rows are skipped

  const a = db.prepare("SELECT data, typeof(data) t FROM archived_dtus").get();
  assert.equal(a.t, "blob");
  assert.deepEqual(JSON.parse(unpackDtuData(a.data)), dtu);

  const s = db.prepare("SELECT data, compressed_size FROM dtu_store_archive").get();
  assert.equal(s.compressed_size, s.data.length);
  assert.ok(s.compressed_size < json.length);

  const viaReader = getDtuIncludingArchive(db, "d1");
  assert.equal(viaReader._source, "archive");
  assert.deepEqual(JSON.parse(viaReader.data), dtu);
});

test("migration 453 is a no-op when the archive tables don't exist", () => {
  const db = new Database(":memory:");
  assert.doesNotThrow(() => up(db));
});
