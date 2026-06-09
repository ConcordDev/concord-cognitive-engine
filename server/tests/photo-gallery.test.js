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

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "concord-photos-"));
process.env.CONCORD_PHOTO_DIR = TMP_DIR;

after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      title TEXT,
      type TEXT,
      creator_id TEXT,
      created_at INTEGER,
      body_json TEXT
    );
  `);
  upPhotos(db);
  return db;
}

// 1×1 PNG (transparent), base64-encoded.
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

describe("Phase BE1 — photo gallery", async () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("savePhoto writes blob + row", async () => {
    const r = await savePhoto(db, "u1", { worldId: "tunya", dataUrl: TINY_PNG, caption: "hi" });
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(r.blobPath));
    const list = listMyPhotos(db, "u1");
    assert.equal(list.length, 1);
    assert.equal(list[0].caption, "hi");
  });

  it("rejects invalid data URL", async () => {
    const r = await savePhoto(db, "u1", { dataUrl: "not-a-data-url" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_data_url");
  });

  it("private hides from public feed; sharePhoto flips to public + mints DTU", async () => {
    const r = await savePhoto(db, "u1", { worldId: "tunya", dataUrl: TINY_PNG, visibility: "private" });
    assert.equal(listPublicPhotosInWorld(db, "tunya").length, 0);
    const s = sharePhoto(db, r.id);
    assert.equal(s.ok, true);
    assert.ok(s.dtuId.startsWith("dtu_photo_"));
    assert.equal(listPublicPhotosInWorld(db, "tunya").length, 1);
    const dtu = db.prepare(`SELECT type, creator_id FROM dtus WHERE id = ?`).get(s.dtuId);
    assert.equal(dtu.type, "photo");
    assert.equal(dtu.creator_id, "u1");
  });

  it("share is idempotent (re-share returns alreadyShared:true)", async () => {
    const r = await savePhoto(db, "u1", { worldId: "tunya", dataUrl: TINY_PNG });
    sharePhoto(db, r.id);
    const second = sharePhoto(db, r.id);
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
    sharePhoto(db, a.id);
    const b = await savePhoto(db, "u1", { worldId: "cyber", dataUrl: TINY_PNG });
    sharePhoto(db, b.id);
    assert.equal(listPublicPhotosInWorld(db, "tunya").length, 1);
    assert.equal(listPublicPhotosInWorld(db, "cyber").length, 1);
  });
});
