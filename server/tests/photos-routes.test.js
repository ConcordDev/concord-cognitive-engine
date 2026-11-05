/**
 * POST /api/photos/:id/share is owner-gated and non-200 on failure.
 * DELETE is the same. Share without a reachable DTU substrate (STATE) does
 * not stamp dtu_id — it fails honestly instead of silently no-opping.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import Database from "better-sqlite3";
import { createPhotosRouter } from "../routes/photos.js";
import { savePhoto } from "../lib/photo-gallery.js";
import { up as upPhotos } from "../migrations/243_photo_gallery.js";
import { up as upPhotoMetadata } from "../migrations/496_photo_metadata.js";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "concord-photos-http-"));
process.env.CONCORD_PHOTO_DIR = TMP;

const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

function freshDb() {
  const db = new Database(":memory:");
  upPhotos(db);
  upPhotoMetadata(db);
  return db;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function appFor(db, actor, STATE) {
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  app.use((req, _res, next) => {
    req.user = { id: actor.id };
    next();
  });
  app.use("/api/photos", createPhotosRouter({
    db,
    requireAuth: () => (_req, _res, next) => next(),
    STATE,
  }));
  return app;
}

async function post(base, urlPath, actorId, appActor) {
  appActor.id = actorId;
  const res = await fetch(base + urlPath, { method: "POST" });
  const body = await res.json();
  return { status: res.status, body };
}

test("share rejects a non-owner; delete rejects a non-owner; both are non-200", async () => {
  const db = freshDb();
  const STATE = { dtus: new Map() };
  const actor = { id: "owner" };
  const saved = await savePhoto(db, "owner", { dataUrl: TINY_PNG, caption: "frame" });
  assert.equal(saved.ok, true);
  const app = appFor(db, actor, STATE);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const denied = await post(base, `/api/photos/${saved.id}/share`, "other", actor);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.ok, false);
    assert.equal(denied.body.error, "not_owner");
    const still = db.prepare("SELECT visibility, dtu_id FROM user_photos WHERE id = ?").get(saved.id);
    assert.equal(still.visibility, "private");
    assert.equal(still.dtu_id, null);

    const missing = await post(base, "/api/photos/ph_missing/share", "owner", actor);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, "no_photo");

    const shared = await post(base, `/api/photos/${saved.id}/share`, "owner", actor);
    assert.equal(shared.status, 200);
    assert.equal(shared.body.ok, true);
    assert.match(shared.body.dtuId, /^dtu_photo_/);
    const row = db.prepare("SELECT visibility, dtu_id FROM user_photos WHERE id = ?").get(saved.id);
    assert.equal(row.visibility, "public");
    assert.equal(row.dtu_id, shared.body.dtuId);
    // The real, findable object — what dtu.list/dtu.get actually read.
    const dtu = STATE.dtus.get(shared.body.dtuId);
    assert.ok(dtu, "the minted DTU must land in the live substrate");
    assert.equal(dtu.ownerId, "owner");
    assert.equal(dtu.visibility, "public");

    const delDenied = await post(base, `/api/photos/${saved.id}/delete`, "other", actor);
    assert.equal(delDenied.status, 403);
    assert.equal(delDenied.body.error, "not_owner");
    assert.equal(db.prepare("SELECT id FROM user_photos WHERE id = ?").get(saved.id).id, saved.id);

    const delMissing = await post(base, "/api/photos/ph_missing/delete", "owner", actor);
    assert.equal(delMissing.status, 404);

    const removed = await post(base, `/api/photos/${saved.id}/delete`, "owner", actor);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.ok, true);
    assert.equal(db.prepare("SELECT id FROM user_photos WHERE id = ?").get(saved.id), undefined);
  } finally {
    server.close();
  }
});

test("share is non-200 and does not stamp dtu_id when no DTU substrate (STATE) reaches the route", async () => {
  const db = freshDb();
  const actor = { id: "owner" };
  const saved = await savePhoto(db, "owner", { dataUrl: TINY_PNG, caption: "held" });
  const app = appFor(db, actor, undefined);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(base + `/api/photos/${saved.id}/share`, { method: "POST" });
    const body = await res.json();
    assert.notEqual(res.status, 200);
    assert.equal(res.status, 500);
    assert.equal(body.ok, false);
    assert.equal(body.error, "dtu_store_unavailable");
    const row = db.prepare("SELECT dtu_id, visibility FROM user_photos WHERE id = ?").get(saved.id);
    assert.equal(row.dtu_id, null);
    assert.equal(row.visibility, "private");
  } finally {
    server.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test("image: the owner gets the bytes; a blob gone from disk is a 404, not a crash", async () => {
  const db = freshDb();
  const actor = { id: "owner" };
  const saved = await savePhoto(db, "owner", { dataUrl: TINY_PNG, caption: "frame" });
  const server = await listen(appFor(db, actor));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ok = await fetch(`${base}/api/photos/${saved.id}/image`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "private, no-store");
    assert.ok((await ok.arrayBuffer()).byteLength > 0);

    const { blob_path } = db.prepare("SELECT blob_path FROM user_photos WHERE id = ?").get(saved.id);
    fs.unlinkSync(blob_path);
    const gone = await fetch(`${base}/api/photos/${saved.id}/image`);
    assert.equal(gone.status, 404);
    assert.deepEqual(await gone.json(), { ok: false, error: "blob_missing" });
  } finally {
    server.close();
  }
});

test("save: a database failure is a 500 with ok:false (savePhoto reports it; the route catch guards unexpected throws)", async () => {
  const db = freshDb();
  db.close(); // every query now fails
  const server = await listen(appFor(db, { id: "owner" }));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/photos/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataUrl: TINY_PNG }),
    });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).ok, false);
  } finally {
    server.close();
  }
});
