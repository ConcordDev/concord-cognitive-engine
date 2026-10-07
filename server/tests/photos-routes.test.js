/**
 * POST /api/photos/:id/share is owner-gated and non-200 on failure.
 * DELETE is the same. A failed dtus insert does not stamp dtu_id.
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "concord-photos-http-"));
process.env.CONCORD_PHOTO_DIR = TMP;

const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

function freshDb({ withDtus }) {
  const db = new Database(":memory:");
  if (withDtus) {
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
  }
  upPhotos(db);
  return db;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function appFor(db, actor) {
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  app.use((req, _res, next) => {
    req.user = { id: actor.id };
    next();
  });
  app.use("/api/photos", createPhotosRouter({
    db,
    requireAuth: () => (_req, _res, next) => next(),
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
  const db = freshDb({ withDtus: true });
  const actor = { id: "owner" };
  const saved = await savePhoto(db, "owner", { dataUrl: TINY_PNG, caption: "frame" });
  assert.equal(saved.ok, true);
  const app = appFor(db, actor);
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

test("share is non-200 and does not stamp dtu_id when the dtus insert fails", async () => {
  const db = freshDb({ withDtus: false });
  const actor = { id: "owner" };
  const saved = await savePhoto(db, "owner", { dataUrl: TINY_PNG, caption: "held" });
  const app = appFor(db, actor);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(base + `/api/photos/${saved.id}/share`, { method: "POST" });
    const body = await res.json();
    assert.notEqual(res.status, 200);
    assert.equal(res.status, 500);
    assert.equal(body.ok, false);
    assert.equal(body.error, "dtu_insert_failed");
    const row = db.prepare("SELECT dtu_id, visibility FROM user_photos WHERE id = ?").get(saved.id);
    assert.equal(row.dtu_id, null);
    assert.equal(row.visibility, "private");
  } finally {
    server.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});
