// FIX-photos-008 — an uploaded JPEG must stay a JPEG.
//
// The Photos import re-encoded every file to PNG through a canvas
// before upload, so the original format (and EXIF) was destroyed and
// the detail view reported "PNG" for a JPG. The client now sends the
// original bytes; savePhoto stores them under the extension the
// magic bytes earn, JPEG dimensions come from the SOF segment, and
// reads report the real format (fillPhotoMetaFromBlob sniffs the
// blob). PNG behaviour is unchanged.
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { savePhoto, fillPhotoMetaFromBlob, imageFormatOf } from "../lib/photo-gallery.js";
import { up as upPhotos } from "../migrations/243_photo_gallery.js";
import { up as upPhotoMetadata } from "../migrations/496_photo_metadata.js";

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "concord-photos-fmt-"));
process.env.CONCORD_PHOTO_DIR = TMP_DIR;
after(() => { try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });

function freshDb() {
  const db = new Database(":memory:");
  upPhotos(db);
  upPhotoMetadata(db);
  return db;
}

// Minimal JPEG: SOI + SOF0 (height 48, width 64) + EOI.
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x30, 0x00, 0x40, 0x03]),
  Buffer.from([0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]),
  Buffer.from([0xff, 0xd9]),
]);
const JPEG_URL = `data:image/jpeg;base64,${JPEG_BYTES.toString("base64")}`;
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

describe("photos format preservation (FIX-photos-008)", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("imageFormatOf reads magic bytes, not claims", () => {
    assert.equal(imageFormatOf(JPEG_BYTES).label, "JPEG");
    assert.equal(imageFormatOf(Buffer.from(TINY_PNG.split(",")[1], "base64")).label, "PNG");
    assert.equal(imageFormatOf(Buffer.from("not an image at all")), null);
  });

  it("a JPEG saves as .jpg with SOF dimensions and reports format JPEG", async () => {
    const r = await savePhoto(db, "u1", { dataUrl: JPEG_URL, caption: "jpg shot", originalFilename: "IMG_1.jpg" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.blobPath.endsWith(".jpg"), r.blobPath);
    assert.equal(r.format, "JPEG");
    assert.equal(r.width, 64);
    assert.equal(r.height, 48);
    // The stored bytes are the original bytes, byte for byte.
    assert.ok(fs.readFileSync(r.blobPath).equals(JPEG_BYTES));
    const row = db.prepare("SELECT * FROM user_photos WHERE id = ?").get(r.id);
    const filled = fillPhotoMetaFromBlob(db, row);
    assert.equal(filled.format, "JPEG");
  });

  it("a PNG still saves as .png and reports PNG", async () => {
    const r = await savePhoto(db, "u1", { dataUrl: TINY_PNG });
    assert.equal(r.ok, true);
    assert.ok(r.blobPath.endsWith(".png"), r.blobPath);
    assert.equal(r.format, "PNG");
    assert.equal(r.width, 1);
  });

  it("bytes that are not a supported image are refused, not stored under a false label", async () => {
    const junk = `data:image/png;base64,${Buffer.from("plain text really").toString("base64")}`;
    const r = await savePhoto(db, "u1", { dataUrl: junk });
    assert.equal(r.ok, false);
    assert.equal(r.error, "unsupported_image_format");
  });
});
