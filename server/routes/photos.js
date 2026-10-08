// Photo gallery HTTP. Mounted at /api/photos.
// Share checks the owner here. sharePhoto itself does not, because the
// photos.share macro already gated the caller before this file existed.

import path from "node:path";
import { Router } from "express";
import logger from "../logger.js";
import {
  savePhoto,
  sharePhoto,
  deletePhoto,
  listMyPhotos,
  listPublicPhotosInWorld,
  updatePhoto,
  listAlbums,
  createAlbum,
  deleteAlbum,
  setAlbumMembership,
  listAlbumPhotos,
} from "../lib/photo-gallery.js";

export function photoHttpStatus(result) {
  if (result?.ok) return 200;
  const err = result?.error || result?.reason || "";
  if (err === "not_owner") return 403;
  if (err === "no_photo" || err === "no_album" || err === "not_found" || err === "blob_missing") return 404;
  if (
    err === "missing_inputs" ||
    err === "missing_dataUrl" ||
    err === "invalid_data_url" ||
    err === "invalid_visibility" ||
    err === "blob_too_large" ||
    err === "missing_name"
  ) return 400;
  return 500;
}

function userIdOf(req) {
  return req.user?.id || req.user?.userId || null;
}

function send(res, result) {
  res.status(photoHttpStatus(result)).json(result);
}

export function createPhotosRouter({ db, requireAuth }) {
  const router = Router();
  const auth = requireAuth();

  router.post("/save", auth, async (req, res) => {
    try {
      send(res, await savePhoto(db, userIdOf(req), req.body || {}));
    } catch (err) {
      logger.error("photos", "save_failed", { error: err?.message });
      send(res, { ok: false, error: "save_failed" });
    }
  });

  router.post("/:photoId/share", auth, (req, res) => {
    const userId = userIdOf(req);
    const photoId = req.params.photoId;
    let owner;
    try {
      owner = db.prepare("SELECT user_id FROM user_photos WHERE id = ?").get(photoId);
    } catch (err) {
      return send(res, { ok: false, error: err?.message || "query_failed" });
    }
    if (!owner) return send(res, { ok: false, error: "no_photo" });
    if (owner.user_id !== userId) return send(res, { ok: false, error: "not_owner" });
    send(res, sharePhoto(db, photoId));
  });

  router.post("/:photoId/delete", auth, (req, res) => {
    send(res, deletePhoto(db, userIdOf(req), req.params.photoId));
  });

  router.post("/:photoId/update", auth, (req, res) => {
    const b = req.body || {};
    send(res, updatePhoto(db, userIdOf(req), req.params.photoId, { caption: b.caption, favorite: b.favorite }));
  });

  router.get("/albums", auth, (req, res) => {
    res.json({ ok: true, albums: listAlbums(db, userIdOf(req)) });
  });

  router.post("/albums", auth, (req, res) => {
    send(res, createAlbum(db, userIdOf(req), (req.body || {}).name));
  });

  router.post("/albums/:albumId/delete", auth, (req, res) => {
    send(res, deleteAlbum(db, userIdOf(req), req.params.albumId));
  });

  router.post("/albums/:albumId/items", auth, (req, res) => {
    const b = req.body || {};
    send(res, setAlbumMembership(db, userIdOf(req), req.params.albumId, String(b.photoId || ""), b.add !== false));
  });

  router.get("/albums/:albumId/photos", auth, (req, res) => {
    send(res, listAlbumPhotos(db, userIdOf(req), req.params.albumId));
  });

  router.get("/mine", auth, (req, res) => {
    res.json({ ok: true, photos: listMyPhotos(db, userIdOf(req), Number(req.query.limit) || 50) });
  });

  router.get("/world/:worldId/public", (req, res) => {
    res.json({
      ok: true,
      photos: listPublicPhotosInWorld(db, req.params.worldId, Number(req.query.limit) || 50),
    });
  });

  router.get("/:photoId/image", (req, res) => {
    let row;
    try {
      row = db.prepare(
        "SELECT user_id, visibility, blob_path FROM user_photos WHERE id = ?",
      ).get(req.params.photoId);
    } catch (err) {
      return send(res, { ok: false, error: err?.message || "query_failed" });
    }
    if (!row) return send(res, { ok: false, error: "not_found" });
    const userId = userIdOf(req);
    if (row.visibility !== "public" && row.user_id !== userId) {
      return send(res, { ok: false, error: "not_found" });
    }
    if (!row.blob_path) return send(res, { ok: false, error: "blob_missing" });
    res.setHeader(
      "Cache-Control",
      row.visibility === "public" ? "public, max-age=3600" : "private, no-store",
    );
    // sendFile checks the file asynchronously; a missing blob comes back here.
    res.sendFile(path.resolve(row.blob_path), (err) => {
      if (!err || res.headersSent) return;
      res.removeHeader("Cache-Control");
      send(res, { ok: false, error: err.code === "ENOENT" ? "blob_missing" : "read_failed" });
    });
  });

  return router;
}
