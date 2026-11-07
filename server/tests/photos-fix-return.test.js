// Photos fix return — F4 (detail view reads "unknown" against a
// known file) + F6 (the minted DTU carries no image).
//
// F4: photos.get renders the row's width/height/size_bytes; a row
// whose columns were never populated shows "unknown" forever while
// its blob carries the truth. fillPhotoMetaFromBlob derives the
// values from the blob on read and backfills the row.
// F6: sharePhoto used to attach a bespoke artifact object no
// consumer resolves; it now registers the photo's bytes with the
// artifact store and mints the upload-DTU shape (store ref +
// meta.primaryType "display_image"), so a minted DTU opened from
// My Vault shows the photo itself.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { savePhoto, sharePhoto, fillPhotoMetaFromBlob } from "../lib/photo-gallery.js";
import registerPhotosMacros from "../domains/photos.js";
import { up as upPhotos } from "../migrations/243_photo_gallery.js";
import { up as upPhotoMetadata } from "../migrations/496_photo_metadata.js";

function freshDb() {
  const db = new Database(":memory:");
  upPhotos(db);
  upPhotoMetadata(db);
  return db;
}

// A real 64×48 PNG (158 bytes), base64 — the F4 fixture's shape.
const PNG_64x48_B64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAZUlEQVR4nO3PUQkAIBTAwBfBCEawfzpD+HEIgwW4zdrn64YLGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEteOwCabGAPWEHYOcAAAAASUVORK5CYII=";
const PNG_64x48 = `data:image/png;base64,${PNG_64x48_B64}`;
const PNG_BYTES = Buffer.from(PNG_64x48_B64, "base64");

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(name, fn); }
registerPhotosMacros(register);
function call(name, ctx, input = {}) { return ACTIONS.get(name)(ctx, input); }

describe("photos fix return — F4 derive-on-read", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  function legacyRow() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-photos-f4-"));
    const blobPath = path.join(dir, "legacy.png");
    fs.writeFileSync(blobPath, PNG_BYTES);
    db.prepare(`INSERT INTO user_photos (id, user_id, world_id, caption, blob_path, visibility, width, height, size_bytes, original_filename)
                VALUES ('ph_legacy', 'u1', NULL, 'legacy', ?, 'private', NULL, NULL, NULL, 'legacy.png')`).run(blobPath);
    return blobPath;
  }

  it("fills null dimensions/size from the blob and backfills the row", () => {
    legacyRow();
    const row = db.prepare("SELECT * FROM user_photos WHERE id = 'ph_legacy'").get();
    const filled = fillPhotoMetaFromBlob(db, row);
    assert.equal(filled.width, 64);
    assert.equal(filled.height, 48);
    assert.equal(filled.size_bytes, PNG_BYTES.byteLength);
    const after = db.prepare("SELECT width, height, size_bytes FROM user_photos WHERE id = 'ph_legacy'").get();
    assert.deepEqual([after.width, after.height, after.size_bytes], [64, 48, PNG_BYTES.byteLength], "the row itself is healed");
  });

  it("photos.get states the file's true dimensions/size for a legacy row", async () => {
    legacyRow();
    const res = await call("get", { db, actor: { userId: "u1" }, STATE: { dtus: new Map() } }, { id: "ph_legacy" });
    assert.equal(res.ok, true);
    assert.equal(res.photo.width, 64);
    assert.equal(res.photo.height, 48);
    assert.equal(res.photo.size_bytes, PNG_BYTES.byteLength);
  });

  it("a row whose blob is gone keeps its nulls — 'unknown' stays honest", () => {
    db.prepare(`INSERT INTO user_photos (id, user_id, caption, blob_path, visibility, width, height, size_bytes)
                VALUES ('ph_gone', 'u1', 'gone', '/nonexistent/ph_gone.png', 'private', NULL, NULL, NULL)`).run();
    const row = db.prepare("SELECT * FROM user_photos WHERE id = 'ph_gone'").get();
    const filled = fillPhotoMetaFromBlob(db, row);
    assert.equal(filled.width, null);
    assert.equal(filled.size_bytes, null);
  });
});

describe("photos fix return — F6 the mint carries the photo", () => {
  let db;
  let STATE;
  beforeEach(() => { db = freshDb(); STATE = { dtus: new Map() }; });

  it("sharePhoto registers the blob with the artifact store and mints the upload shape", async () => {
    const saved = await savePhoto(db, "u1", { dataUrl: PNG_64x48, caption: "harbour", originalFilename: "harbour.png" });
    assert.equal(saved.ok, true);
    const s = await sharePhoto(db, saved.id, { STATE });
    assert.equal(s.ok, true);
    const dtu = STATE.dtus.get(s.dtuId);
    assert.ok(dtu, "minted DTU in the live substrate");
    // The store ref — the shape the DTU detail view + ArtifactRenderer resolve.
    assert.equal(typeof dtu.artifact, "object");
    assert.equal(dtu.artifact.type, "image/png");
    assert.equal(dtu.artifact.sizeBytes, PNG_BYTES.byteLength);
    assert.ok(String(dtu.artifact.hash).startsWith("sha256:"));
    assert.ok(fs.existsSync(dtu.artifact.diskPath), "the photo's bytes are in the artifact store");
    assert.equal(dtu.meta.primaryType, "display_image");
    assert.equal(dtu.meta.artifactSize, PNG_BYTES.byteLength);
    assert.equal(dtu.meta.sourcePhotoId, saved.id, "provenance kept");
    assert.equal(dtu.machine.verifier.sizeBytes, PNG_BYTES.byteLength);
  });

  it("the share macro mints the same shape (awaited)", async () => {
    const saved = await savePhoto(db, "u1", { dataUrl: PNG_64x48, caption: "macro share" });
    const s = await call("share", { db, actor: { userId: "u1" }, STATE }, { photoId: saved.id });
    assert.equal(s.ok, true);
    const dtu = STATE.dtus.get(s.dtuId);
    assert.equal(dtu.artifact.type, "image/png");
    assert.equal(dtu.meta.primaryType, "display_image");
  });

  it("a photo whose blob is unreadable fails honestly and mints nothing", async () => {
    const saved = await savePhoto(db, "u1", { dataUrl: PNG_64x48, caption: "doomed" });
    fs.unlinkSync(saved.blobPath);
    const s = await sharePhoto(db, saved.id, { STATE });
    assert.equal(s.ok, false);
    assert.equal(s.error, "photo_blob_unreadable");
    assert.equal(STATE.dtus.size, 0, "no hollow DTU minted");
    const row = db.prepare("SELECT dtu_id, visibility FROM user_photos WHERE id = ?").get(saved.id);
    assert.equal(row.dtu_id, null);
    assert.equal(row.visibility, "private");
  });
});
