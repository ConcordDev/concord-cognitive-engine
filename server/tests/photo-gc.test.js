// tests/photo-gc.test.js — real behavioral tests for server/lib/photo-gc.js.
//
// Pins the storage audit fix (2026-07-27): data/photos/ had zero orphan
// sweep. A blob left behind by a crashed/partial savePhoto() (the write
// happens before the DB insert) would strand forever with nothing to
// clean it up. These tests verify: (1) a referenced blob is never touched,
// (2) an orphan younger than the grace period is left alone (protects the
// write-then-insert race), (3) an orphan older than the grace period is
// collected, (4) disk-usage accounting is correct.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";

process.env.CONCORD_PHOTO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "concord-photo-gc-"));

const { garbageCollectPhotos, getPhotoDiskUsage } = await import("../lib/photo-gc.js");
const { PHOTO_DIR } = await import("../lib/photo-gallery.js");

let db;

before(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE user_photos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      world_id TEXT,
      taken_at INTEGER NOT NULL DEFAULT (unixepoch()),
      caption TEXT,
      dtu_id TEXT,
      blob_path TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
  `);
});

after(() => {
  db.close();
  fs.rmSync(PHOTO_DIR, { recursive: true, force: true });
});

function writeBlob(name, ageMs = 0) {
  const p = path.join(PHOTO_DIR, name);
  fs.writeFileSync(p, Buffer.from("fake-png-bytes"));
  if (ageMs > 0) {
    const past = new Date(Date.now() - ageMs);
    fs.utimesSync(p, past, past);
  }
  return p;
}

describe("photo-gc — orphan sweep", () => {
  it("never deletes a blob referenced by a user_photos row", async () => {
    const p = writeBlob("referenced.png", 2 * 60 * 60 * 1000); // old, but referenced
    db.prepare(`INSERT INTO user_photos (id, user_id, blob_path) VALUES ('ph_ref', 'u1', ?)`).run(p);

    const result = await garbageCollectPhotos(db);
    assert.equal(fs.existsSync(p), true, "referenced blob must survive GC");
    assert.equal(result.collected >= 0, true);
  });

  it("leaves a young orphan alone (write-then-insert race protection)", async () => {
    const p = writeBlob("young-orphan.png", 0); // just written, no DB row
    await garbageCollectPhotos(db);
    assert.equal(fs.existsSync(p), true, "an orphan younger than the grace period must not be collected");
  });

  it("collects an orphan older than the grace period", async () => {
    const p = writeBlob("old-orphan.png", 2 * 60 * 60 * 1000); // 2h old, no DB row
    const result = await garbageCollectPhotos(db);
    assert.equal(fs.existsSync(p), false, "an orphan past the grace period must be collected");
    assert.ok(result.collected >= 1);
    assert.ok(result.freedBytes >= 0);
  });

  it("getPhotoDiskUsage sums all files currently on disk", () => {
    fs.rmSync(PHOTO_DIR, { recursive: true, force: true });
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    writeBlob("a.png");
    writeBlob("b.png");
    const usage = getPhotoDiskUsage();
    assert.equal(usage, Buffer.from("fake-png-bytes").length * 2);
  });
});
