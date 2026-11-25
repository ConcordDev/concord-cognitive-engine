// Photo gallery HTTP. Mounted at /api/photos.
// Share checks the owner here. sharePhoto itself does not, because the
// photos.share macro already gated the caller before this file existed.

import path from "node:path";
import express, { Router } from "express";
import fs from "node:fs";
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
import { importPhoto, ensureDerivatives, ownedRow, cleanExportOptions, exportExif, MAX_IMPORT_BYTES } from "../lib/darkroom/store.js";
import { renderPhoto } from "../lib/darkroom/render.js";
import { getRelease, canSee, canDownload, releaseFile, releaseView, listReleases } from "../lib/darkroom/releases.js";

export function photoHttpStatus(result) {
  if (result?.ok) return 200;
  const err = result?.error || result?.reason || "";
  if (err === "not_owner") return 403;
  if (err === "release_live" || err === "release_owned") return 409;
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

export function createPhotosRouter({ db, requireAuth, STATE }) {
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

  router.post("/:photoId/share", auth, async (req, res) => {
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
    send(res, await sharePhoto(db, photoId, { STATE: STATE || globalThis.STATE || null }));
  });

  router.post("/:photoId/delete", auth, (req, res) => {
    send(res, deletePhoto(db, userIdOf(req), req.params.photoId));
  });

  router.post("/:photoId/update", auth, (req, res) => {
    const b = req.body || {};
    send(res, updatePhoto(db, userIdOf(req), req.params.photoId, { caption: b.caption, favorite: b.favorite, altText: b.altText, tags: b.tags }));
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

  // ── The Darkroom ──────────────────────────────────────────────────
  // Import a photo file exactly as it is (the body is the file's bytes).
  router.post("/upload", auth, express.raw({ type: () => true, limit: MAX_IMPORT_BYTES + 1024 }), async (req, res) => {
    try {
      const name = typeof req.query.name === "string" ? req.query.name : null;
      const out = await importPhoto(db, userIdOf(req), Buffer.isBuffer(req.body) ? req.body : null, { filename: name });
      res.status(out.ok ? 200 : 400).json(out);
    } catch (err) {
      logger.error("photos", "upload_failed", { error: err?.message });
      res.status(500).json({ ok: false, error: "the upload could not be saved" });
    }
  });

  // The preview (long edge 2048) and thumbnail the editor and library show.
  // Same gate as the image route: the owner, or anyone for a public photo.
  for (const kind of ["preview", "thumb"]) {
    router.get(`/:photoId/${kind}`, async (req, res) => {
      let row;
      try { row = db.prepare("SELECT * FROM user_photos WHERE id = ?").get(req.params.photoId); }
      catch (err) { return send(res, { ok: false, error: err?.message || "query_failed" }); }
      if (!row || (row.visibility !== "public" && row.user_id !== userIdOf(req))) return send(res, { ok: false, error: "not_found" });
      row = await ensureDerivatives(db, row);
      const file = kind === "preview" ? row.preview_path : row.thumb_path;
      if (!file || !fs.existsSync(file)) return send(res, { ok: false, error: "blob_missing" });
      res.setHeader("Cache-Control", row.visibility === "public" ? "public, max-age=3600" : "private, max-age=300");
      res.type("image/jpeg");
      res.sendFile(path.resolve(file));
    });
  }

  // The original file, untouched — owner only.
  router.get("/:photoId/original", auth, (req, res) => {
    const row = ownedRow(db, userIdOf(req), req.params.photoId);
    if (!row || !row.blob_path || !fs.existsSync(row.blob_path)) return send(res, { ok: false, error: "not_found" });
    res.setHeader("Cache-Control", "private, no-store");
    if (row.mime) res.type(row.mime);
    res.download(path.resolve(row.blob_path), row.original_filename || path.basename(row.blob_path));
  });

  // Export: the original developed with its saved edit at full (or a chosen) size.
  router.get("/:photoId/export", auth, async (req, res) => {
    const row = ownedRow(db, userIdOf(req), req.params.photoId);
    if (!row || !row.blob_path || !fs.existsSync(row.blob_path)) return send(res, { ok: false, error: "not_found" });
    const o = cleanExportOptions(req.query || {});
    let edit = {};
    try { edit = row.edit_json ? JSON.parse(row.edit_json) : {}; } catch { edit = {}; }
    const out = await renderPhoto({ path: row.blob_path, edit, format: o.format, quality: o.quality, longEdge: o.longEdge, exif: exportExif(row, o) });
    if (!out.ok) return res.status(500).json({ ok: false, error: out.error });
    const ext = o.format === "jpeg" ? "jpg" : o.format;
    const base = String(row.caption || row.original_filename || row.id).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9 _-]+/g, "").trim().slice(0, 60) || row.id;
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename="${base}.${ext}"`);
    res.setHeader("X-Photo-Width", String(out.width));
    res.setHeader("X-Photo-Height", String(out.height));
    res.type(o.format === "jpeg" ? "image/jpeg" : `image/${o.format}`).send(out.buf);
  });

  // Published releases, and one release — public reads (signed-out visitors
  // reach them here; /api/lens/run does not serve lens actions to the anonymous).
  router.get("/releases", (req, res) => {
    res.json({ ok: true, releases: listReleases(db, userIdOf(req), {}) });
  });
  router.get("/releases/:releaseId", (req, res) => {
    const rel = getRelease(db, req.params.releaseId);
    if (!canSee(db, rel, userIdOf(req))) return send(res, { ok: false, error: "not_found" });
    res.json({ ok: true, release: releaseView(db, rel, userIdOf(req)) });
  });

  // A release's watermarked proof — anyone may see a published one.
  router.get("/releases/:releaseId/proof", async (req, res) => {
    const rel = getRelease(db, req.params.releaseId);
    if (!canSee(db, rel, userIdOf(req))) return send(res, { ok: false, error: "not_found" });
    const f = await releaseFile(db, rel, "proof");
    if (!f.ok) return res.status(500).json({ ok: false, error: f.error });
    res.setHeader("Cache-Control", rel.status === "published" ? "public, max-age=600" : "private, no-store");
    res.type(f.mime).sendFile(path.resolve(f.file));
  });

  // The full file — the photographer, a buyer, or anyone when it is free.
  router.get("/releases/:releaseId/download", async (req, res) => {
    const rel = getRelease(db, req.params.releaseId);
    const uid = userIdOf(req);
    if (!canSee(db, rel, uid)) return send(res, { ok: false, error: "not_found" });
    if (!canDownload(db, rel, uid)) return res.status(402).json({ ok: false, error: `buy this photo (${rel.price_cc} CC) to download the full file` });
    const f = await releaseFile(db, rel, "full");
    if (!f.ok) return res.status(500).json({ ok: false, error: f.error });
    const ext = f.mime === "image/webp" ? "webp" : "jpg";
    const base = String(rel.title).replace(/[^A-Za-z0-9 _-]+/g, "").trim().slice(0, 60) || rel.id;
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename="${base}.${ext}"`);
    res.type(f.mime).sendFile(path.resolve(f.file));
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
