// Photos lens organize layer (migration 468): caption/favorite edits and
// albums, exercised through the registered macros against the real lib and
// an in-memory DB with migrations 243 + 468.

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import registerPhotosMacros from "../domains/photos.js";
import { savePhoto, deletePhoto, listMyPhotos } from "../lib/photo-gallery.js";
import { up as upPhotos } from "../migrations/243_photo_gallery.js";
import { up as upOrganize } from "../migrations/468_photo_gallery_organize.js";

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "concord-photos-org-"));
process.env.CONCORD_PHOTO_DIR = TMP_DIR;
after(() => { try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });

const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

const ACTIONS = new Map();
before(() => { registerPhotosMacros((_d, name, fn) => ACTIONS.set(name, fn)); });

let db;
beforeEach(() => {
  db = new Database(":memory:");
  upPhotos(db);
  upOrganize(db);
  upOrganize(db); // idempotent
});
const ctx = (userId) => ({ db, actor: { userId } });
const call = (name, userId, input = {}) => ACTIONS.get(name)(ctx(userId), input);

describe("photos — caption + favorite", () => {
  it("owner edits caption and favorite; list reflects it; non-owner is refused", async () => {
    const { id } = await savePhoto(db, "alice", { dataUrl: TINY_PNG, caption: "old" });
    const r = call("update", "alice", { photoId: id, caption: "  New caption  ", favorite: true });
    assert.equal(r.ok, true);
    assert.equal(r.photo.caption, "New caption");
    assert.equal(r.photo.favorite, 1);
    const mine = listMyPhotos(db, "alice");
    assert.equal(mine[0].favorite, 1);
    assert.equal(mine[0].caption, "New caption");
    assert.equal(call("update", "bob", { photoId: id, caption: "hijack" }).error, "not_owner");
    assert.equal(call("update", "alice", { photoId: id, favorite: false }).photo.favorite, 0);
    assert.equal(call("update", "alice", { photoId: id, caption: "" }).photo.caption, null);
  });
});

describe("photos — albums", () => {
  it("create, add, list with count + cover, remove, delete; owner-scoped", async () => {
    const a = (await savePhoto(db, "alice", { dataUrl: TINY_PNG, caption: "a" })).id;
    const b = (await savePhoto(db, "alice", { dataUrl: TINY_PNG, caption: "b" })).id;
    const bobs = (await savePhoto(db, "bob", { dataUrl: TINY_PNG, caption: "x" })).id;

    assert.equal(call("album-create", "alice", { name: " " }).error, "missing_name");
    const alb = call("album-create", "alice", { name: "Trip" }).album;

    assert.equal(call("album-set", "alice", { albumId: alb.id, photoId: a }).ok, true);
    assert.equal(call("album-set", "alice", { albumId: alb.id, photoId: a }).ok, true); // idempotent
    assert.equal(call("album-set", "alice", { albumId: alb.id, photoId: b }).ok, true);
    assert.equal(call("album-set", "alice", { albumId: alb.id, photoId: bobs }).error, "not_owner");
    assert.equal(call("album-set", "bob", { albumId: alb.id, photoId: bobs }).error, "no_album");

    let albums = call("albums", "alice").albums;
    assert.equal(albums.length, 1);
    assert.equal(albums[0].count, 2);
    assert.ok([a, b].includes(albums[0].cover_photo_id));
    assert.equal(call("albums", "bob").albums.length, 0);

    const inAlb = call("album-photos", "alice", { albumId: alb.id });
    assert.deepEqual(inAlb.photos.map((p) => p.id).sort(), [a, b].sort());
    assert.equal(call("album-photos", "bob", { albumId: alb.id }).error, "no_album");

    call("album-set", "alice", { albumId: alb.id, photoId: a, add: false });
    assert.equal(call("albums", "alice").albums[0].count, 1);

    // deleting a photo drops it from albums
    deletePhoto(db, "alice", b);
    albums = call("albums", "alice").albums;
    assert.equal(albums[0].count, 0);
    assert.equal(albums[0].cover_photo_id, null);

    assert.equal(call("album-delete", "bob", { albumId: alb.id }).error, "no_album");
    assert.equal(call("album-delete", "alice", { albumId: alb.id }).ok, true);
    assert.equal(call("albums", "alice").albums.length, 0);
    assert.equal(listMyPhotos(db, "alice").length, 1, "album delete keeps photos");
  });
});
