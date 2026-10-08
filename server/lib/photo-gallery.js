// server/lib/photo-gallery.js
//
// Phase BE1 — photo gallery + sharing.
//
// PhotoMode.tsx posts a data: URL (base64 PNG) to savePhoto; this
// module writes the blob under ./data/photos/<id>.png and inserts
// the row. sharePhoto mints a kind='photo' DTU so the royalty cascade
// fires when the photo is cited.

import crypto from "node:crypto";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import logger from "../logger.js";

const PHOTO_DIR = process.env.CONCORD_PHOTO_DIR ||
  path.resolve(process.cwd(), "data", "photos");
const MAX_BLOB_BYTES = 5 * 1024 * 1024; // 5 MB cap per photo

async function _ensureDir(dir) {
  try { await fsp.mkdir(dir, { recursive: true }); } catch { /* exists */ }
}

async function _writeBlob(dataUrl, blobPath) {
  // dataUrl looks like 'data:image/png;base64,iVBORw0...'.
  const m = String(dataUrl || "").match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) return { ok: false, error: "invalid_data_url" };
  const buf = Buffer.from(m[2], "base64");
  if (buf.byteLength > MAX_BLOB_BYTES) return { ok: false, error: "blob_too_large" };
  try {
    // Async fs — a ≤5 MB PNG write must not block the event loop.
    await _ensureDir(path.dirname(blobPath));
    await fsp.writeFile(blobPath, buf);
    return { ok: true, bytes: buf.byteLength };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export async function savePhoto(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const { worldId, dataUrl, caption, visibility = "private" } = opts;
  if (!dataUrl) return { ok: false, error: "missing_dataUrl" };
  if (!["private", "friends", "public"].includes(visibility)) {
    return { ok: false, error: "invalid_visibility" };
  }

  const id = `ph_${crypto.randomBytes(8).toString("hex")}`;
  const blobPath = path.join(PHOTO_DIR, `${id}.png`);
  const blob = await _writeBlob(dataUrl, blobPath);
  if (!blob.ok) return blob;

  try {
    db.prepare(`
      INSERT INTO user_photos
        (id, user_id, world_id, caption, blob_path, visibility)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, worldId || null, caption || null, blobPath, visibility);
    logger.info?.("photo-gallery", "saved", { id, userId, bytes: blob.bytes });
    return { ok: true, id, blobPath, bytes: blob.bytes };
  } catch (err) {
    // Rollback the blob.
    await fsp.unlink(blobPath).catch(() => { /* ignore */ });
    return { ok: false, error: err?.message };
  }
}

/** Mint a kind='photo' DTU so the royalty cascade can fire. */
export function sharePhoto(db, photoId, opts = {}) {
  if (!db || !photoId) return { ok: false, error: "missing_inputs" };
  try {
    const p = db.prepare(`SELECT * FROM user_photos WHERE id = ?`).get(photoId);
    if (!p) return { ok: false, error: "no_photo" };
    if (p.dtu_id) return { ok: true, dtuId: p.dtu_id, alreadyShared: true };

    const dtuId = `dtu_photo_${crypto.randomBytes(6).toString("hex")}`;
    // The public flip and the dtu_id stamp are one write. If the dtus insert
    // does not land, the photo stays private and dtu_id stays null.
    const publish = db.transaction(() => {
      db.prepare(`
        INSERT INTO dtus (id, title, type, creator_id, created_at, body_json)
        VALUES (?, ?, 'photo', ?, unixepoch(), ?)
      `).run(
        dtuId,
        p.caption || `Photo ${photoId}`,
        p.user_id,
        JSON.stringify({ source_photo_id: photoId, blob_path: p.blob_path }),
      );
      db.prepare(`UPDATE user_photos SET dtu_id = ?, visibility = 'public' WHERE id = ?`)
        .run(dtuId, photoId);
    });
    try {
      publish();
    } catch (err) {
      logger.debug?.("photo-gallery", "dtu_insert_failed", { error: err?.message });
      return { ok: false, error: "dtu_insert_failed" };
    }
    return { ok: true, dtuId };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listMyPhotos(db, userId, limit = 50) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, world_id, caption, taken_at, dtu_id, visibility, favorite
      FROM user_photos WHERE user_id = ?
      ORDER BY taken_at DESC LIMIT ?
    `).all(userId, Math.max(1, Math.min(500, limit)));
  } catch {
    // favorite column absent (pre-468 DB) — fall back to the base shape.
    try {
      return db.prepare(`
        SELECT id, world_id, caption, taken_at, dtu_id, visibility
        FROM user_photos WHERE user_id = ?
        ORDER BY taken_at DESC LIMIT ?
      `).all(userId, Math.max(1, Math.min(500, limit)));
    } catch { return []; }
  }
}

export function listPublicPhotosInWorld(db, worldId, limit = 50) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT id, user_id, caption, taken_at, dtu_id
      FROM user_photos
      WHERE world_id = ? AND visibility = 'public'
      ORDER BY taken_at DESC LIMIT ?
    `).all(worldId, Math.max(1, Math.min(500, limit)));
  } catch { return []; }
}

export function deletePhoto(db, userId, photoId) {
  if (!db || !userId || !photoId) return { ok: false, error: "missing_inputs" };
  try {
    const p = db.prepare(`SELECT user_id, blob_path FROM user_photos WHERE id = ?`).get(photoId);
    if (!p) return { ok: false, error: "no_photo" };
    if (p.user_id !== userId) return { ok: false, error: "not_owner" };
    db.prepare(`DELETE FROM user_photos WHERE id = ?`).run(photoId);
    try { db.prepare(`DELETE FROM photo_album_items WHERE photo_id = ?`).run(photoId); } catch { /* pre-468 */ }
    try { fs.unlinkSync(p.blob_path); } catch { /* may be gone */ }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export { PHOTO_DIR, MAX_BLOB_BYTES };

function _ownedPhoto(db, userId, photoId) {
  const p = db.prepare(`SELECT user_id FROM user_photos WHERE id = ?`).get(photoId);
  if (!p) return { ok: false, error: "no_photo" };
  if (p.user_id !== userId) return { ok: false, error: "not_owner" };
  return { ok: true };
}

function _ownedAlbum(db, userId, albumId) {
  const a = db.prepare(`SELECT id, user_id, name FROM photo_albums WHERE id = ?`).get(albumId);
  if (!a || a.user_id !== userId) return { ok: false, error: "no_album" };
  return { ok: true, album: a };
}

/** Edit an owned photo's caption and/or favorite flag. */
export function updatePhoto(db, userId, photoId, patch = {}) {
  if (!db || !userId || !photoId) return { ok: false, error: "missing_inputs" };
  try {
    const own = _ownedPhoto(db, userId, photoId);
    if (!own.ok) return own;
    if (patch.caption !== undefined) {
      const caption = String(patch.caption ?? "").trim().slice(0, 280);
      db.prepare(`UPDATE user_photos SET caption = ? WHERE id = ?`).run(caption || null, photoId);
    }
    if (patch.favorite !== undefined) {
      db.prepare(`UPDATE user_photos SET favorite = ? WHERE id = ?`).run(patch.favorite ? 1 : 0, photoId);
    }
    const photo = db.prepare(`SELECT id, world_id, caption, taken_at, dtu_id, visibility, favorite FROM user_photos WHERE id = ?`).get(photoId);
    return { ok: true, photo };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listAlbums(db, userId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT a.id, a.name, a.created_at,
        (SELECT COUNT(*) FROM photo_album_items i JOIN user_photos p ON p.id = i.photo_id WHERE i.album_id = a.id) AS count,
        (SELECT i.photo_id FROM photo_album_items i JOIN user_photos p ON p.id = i.photo_id WHERE i.album_id = a.id ORDER BY p.taken_at DESC LIMIT 1) AS cover_photo_id
      FROM photo_albums a WHERE a.user_id = ?
      ORDER BY a.created_at DESC
    `).all(userId);
  } catch { return []; }
}

export function createAlbum(db, userId, name) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const n = String(name || "").trim().slice(0, 80);
  if (!n) return { ok: false, error: "missing_name" };
  try {
    const id = `alb_${crypto.randomBytes(8).toString("hex")}`;
    db.prepare(`INSERT INTO photo_albums (id, user_id, name) VALUES (?, ?, ?)`).run(id, userId, n);
    return { ok: true, album: { id, name: n, count: 0, cover_photo_id: null } };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function deleteAlbum(db, userId, albumId) {
  if (!db || !userId || !albumId) return { ok: false, error: "missing_inputs" };
  try {
    const own = _ownedAlbum(db, userId, albumId);
    if (!own.ok) return own;
    db.transaction(() => {
      db.prepare(`DELETE FROM photo_album_items WHERE album_id = ?`).run(albumId);
      db.prepare(`DELETE FROM photo_albums WHERE id = ?`).run(albumId);
    })();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/** Add (add=true) or remove an owned photo from an owned album. Idempotent. */
export function setAlbumMembership(db, userId, albumId, photoId, add = true) {
  if (!db || !userId || !albumId || !photoId) return { ok: false, error: "missing_inputs" };
  try {
    const a = _ownedAlbum(db, userId, albumId);
    if (!a.ok) return a;
    const p = _ownedPhoto(db, userId, photoId);
    if (!p.ok) return p;
    if (add) db.prepare(`INSERT OR IGNORE INTO photo_album_items (album_id, photo_id) VALUES (?, ?)`).run(albumId, photoId);
    else db.prepare(`DELETE FROM photo_album_items WHERE album_id = ? AND photo_id = ?`).run(albumId, photoId);
    return { ok: true, albumId, photoId, member: !!add };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listAlbumPhotos(db, userId, albumId) {
  if (!db || !userId || !albumId) return { ok: false, error: "missing_inputs" };
  try {
    const a = _ownedAlbum(db, userId, albumId);
    if (!a.ok) return a;
    const photos = db.prepare(`
      SELECT p.id, p.world_id, p.caption, p.taken_at, p.dtu_id, p.visibility, p.favorite
      FROM photo_album_items i JOIN user_photos p ON p.id = i.photo_id
      WHERE i.album_id = ? AND p.user_id = ?
      ORDER BY p.taken_at DESC
    `).all(albumId, userId);
    return { ok: true, album: { id: a.album.id, name: a.album.name }, photos };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}
