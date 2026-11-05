// Phase BE1 — photo gallery tests.

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  savePhoto, sharePhoto, listMyPhotos, listPublicPhotosInWorld, deletePhoto,
} from "../lib/photo-gallery.js";
import { up as upPhotos } from "../migrations/243_photo_gallery.js";
import { up as upPhotoMetadata } from "../migrations/496_photo_metadata.js";

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "concord-photos-"));
process.env.CONCORD_PHOTO_DIR = TMP_DIR;

after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

function freshDb() {
  const db = new Database(":memory:");
  upPhotos(db);
  upPhotoMetadata(db);
  return db;
}

// 1×1 PNG (transparent), base64-encoded.
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

describe("Phase BE1 — photo gallery", async () => {
  let db;
  let STATE;
  beforeEach(() => { db = freshDb(); STATE = { dtus: new Map() }; });

  it("savePhoto writes blob + row, capturing real PNG width/height + size", async () => {
    const r = await savePhoto(db, "u1", { worldId: "tunya", dataUrl: TINY_PNG, caption: "hi" });
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(r.blobPath));
    assert.equal(r.width, 1);
    assert.equal(r.height, 1);
    assert.ok(r.bytes > 0);
    const list = listMyPhotos(db, "u1");
    assert.equal(list.length, 1);
    assert.equal(list[0].caption, "hi");
  });

  it("savePhoto stores the original filename when the caller supplies one", async () => {
    const r = await savePhoto(db, "u1", { dataUrl: TINY_PNG, originalFilename: "IMG_0042.heic" });
    const row = db.prepare("SELECT original_filename, width, height, size_bytes FROM user_photos WHERE id = ?").get(r.id);
    assert.equal(row.original_filename, "IMG_0042.heic");
    assert.equal(row.width, 1);
    assert.equal(row.height, 1);
    assert.ok(row.size_bytes > 0);
  });

  it("rejects invalid data URL", async () => {
    const r = await savePhoto(db, "u1", { dataUrl: "not-a-data-url" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_data_url");
  });

  it("private hides from public feed; sharePhoto mints into STATE.dtus (not the dead legacy dtus table) + flips public", async () => {
    const r = await savePhoto(db, "u1", { worldId: "tunya", dataUrl: TINY_PNG, visibility: "private" });
    assert.equal(listPublicPhotosInWorld(db, "tunya").length, 0);
    const s = await sharePhoto(db, r.id, { STATE });
    assert.equal(s.ok, true);
    assert.ok(s.dtuId.startsWith("dtu_photo_"));
    assert.equal(listPublicPhotosInWorld(db, "tunya").length, 1);
    // The real, findable object — this is what dtu.list/dtu.get actually read.
    const dtu = STATE.dtus.get(s.dtuId);
    assert.ok(dtu, "the minted DTU must land in the live substrate");
    assert.equal(dtu.domain, "photos");
    assert.equal(dtu.machine.kind, "photo");
    assert.equal(dtu.ownerId, "u1");
    assert.equal(dtu.visibility, "public");
    assert.equal(dtu.scope, "global");
  });

  it("fails honestly with dtu_store_unavailable when no STATE.dtus substrate is reachable", async () => {
    const r = await savePhoto(db, "u1", { worldId: "hub", dataUrl: TINY_PNG, caption: "held" });
    const s = await sharePhoto(db, r.id, { STATE: null });
    assert.equal(s.ok, false);
    assert.equal(s.error, "dtu_store_unavailable");
    const row = db.prepare("SELECT dtu_id, visibility FROM user_photos WHERE id = ?").get(r.id);
    assert.equal(row.dtu_id, null);
    assert.equal(row.visibility, "private");
    assert.equal(listPublicPhotosInWorld(db, "hub").length, 0);
  });

  it("share is idempotent (re-share returns alreadyShared:true)", async () => {
    const r = await savePhoto(db, "u1", { worldId: "tunya", dataUrl: TINY_PNG });
    await sharePhoto(db, r.id, { STATE });
    const second = await sharePhoto(db, r.id, { STATE });
    assert.equal(second.alreadyShared, true);
  });

  it("deletePhoto removes row + blob; non-owner rejected", async () => {
    const r = await savePhoto(db, "u1", { worldId: "tunya", dataUrl: TINY_PNG });
    const otherAttempt = deletePhoto(db, "u2", r.id);
    assert.equal(otherAttempt.ok, false);
    assert.equal(otherAttempt.error, "not_owner");
    assert.ok(fs.existsSync(r.blobPath), "blob preserved on rejected delete");

    const own = deletePhoto(db, "u1", r.id);
    assert.equal(own.ok, true);
    assert.equal(listMyPhotos(db, "u1").length, 0);
  });

  it("listPublicPhotosInWorld is scoped to world", async () => {
    const a = await savePhoto(db, "u1", { worldId: "tunya", dataUrl: TINY_PNG });
    await sharePhoto(db, a.id, { STATE });
    const b = await savePhoto(db, "u1", { worldId: "cyber", dataUrl: TINY_PNG });
    await sharePhoto(db, b.id, { STATE });
    assert.equal(listPublicPhotosInWorld(db, "tunya").length, 1);
    assert.equal(listPublicPhotosInWorld(db, "cyber").length, 1);
  });
});
